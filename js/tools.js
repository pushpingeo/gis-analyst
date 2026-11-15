// Spatial tools for the NTR skill. Deterministic: no AI in here.
// Works in the browser (bare imports resolved by the import map in index.html) and in Node (npm packages).
import * as turf from "@turf/turf";
import osmtogeojson from "osmtogeojson";

export const FOOTPRINT_KM = {
  thermal: 0.5, substation: 0.5, terminal: 0.5, solar: 1, wind: 3, mine: 3, hydro: 5,
  "oil-gas-plant": 1, "oil-gas-field": 5, other: 1,
};

// ---- Overpass -------------------------------------------------------------

// A match value of "*" means any value; "~text" is a case-insensitive regular expression.
function tagFilter([k, v]) {
  if (v === "*") return `["${k}"]`;
  if (v.startsWith("~")) return `["${k}"~"${v.slice(1)}",i]`;
  return `["${k}"="${v}"]`;
}

const osmConcepts = (catalogue) => Object.values(catalogue.concepts).filter((c) => c.source === "osm-overpass");
const osmEntries = (catalogue) => Object.entries(catalogue.concepts).filter(([, c]) => c.source === "osm-overpass");

// One request per site: every concept's filters, searched around the site and (for areas) containing it.
export function buildOverpassQuery(catalogue, lon, lat, footprintKm) {
  const lines = [];
  const contain = [];
  for (const c of osmConcepts(catalogue)) {
    const r = Math.round((footprintKm + c.radius_km) * 1000);
    const types = c.osm_types || ["node", "way", "relation"];
    for (const m of c.match) {
      // Only ask for the element types that make sense (settlements are nodes, rivers are ways): far cheaper.
      for (const t of types) lines.push(`${t}${tagFilter(m)}(around:${r},${lat},${lon});`);
      if (c.containing) contain.push(`way(pivot.a)${tagFilter(m)};rel(pivot.a)${tagFilter(m)};`);
    }
  }
  // Clip returned geometry to a box round the search area so big parks don't blow up the response.
  const maxKm = footprintKm + Math.max(...osmConcepts(catalogue).map((c) => c.radius_km));
  const dLat = maxKm / 111.32;
  const dLon = maxKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((x) => x.toFixed(5)).join(",");
  // Areas that contain the site come back as tags only (distance 0); everything else with clipped geometry.
  return `[out:json][timeout:90];
is_in(${lat},${lon})->.a;
(
${contain.join("\n")}
)->.inside;
.inside out tags;
(
${lines.join("\n")}
);
out geom(${bbox});`;
}

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function fetchOverpass(query, endpoint = OVERPASS_ENDPOINTS[0], fetchFn = fetch, timeoutMs = 100000, extraHeaders = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
      body: "data=" + encodeURIComponent(query),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `timed out after ${timeoutMs / 1000} s` : e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- Geometry -------------------------------------------------------------

// Distance in km from the site point to a feature (0 if the point is inside a polygon).
export function distanceKm(site, feature) {
  const g = feature.geometry;
  if (!g) return Infinity;
  switch (g.type) {
    case "Point":
      return turf.distance(site, g, { units: "kilometers" });
    case "LineString":
    case "MultiLineString":
      return lineDistance(site, g);
    case "Polygon":
    case "MultiPolygon": {
      // Geometry clipped to the search box can leave rings open; close them before testing.
      const closed = closeRings(g);
      try {
        if (turf.booleanPointInPolygon(site, closed)) return 0;
      } catch (e) { /* degenerate ring: fall back to edge distance */ }
      return lineDistance(site, turf.polygonToLine(closed));
    }
    default:
      return Infinity;
  }
}

function closeRing(r) {
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r = [...r, r[0]];
  while (r.length < 4) r = [...r, r[0]];
  return r;
}
function closeRings(g) {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(closeRing) };
  return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(closeRing)) };
}

function lineDistance(site, g) {
  const geom = g.type === "Feature" || g.type === "FeatureCollection" ? g : turf.feature(g);
  let best = Infinity;
  turf.flattenEach(geom, (f) => {
    if (f.geometry.type === "LineString" && f.geometry.coordinates.length > 1) {
      best = Math.min(best, turf.pointToLineDistance(site, f, { units: "kilometers" }));
    }
  });
  return best;
}

export function band(dFootprintKm) {
  if (dFootprintKm <= 0) return "on_site";
  if (dFootprintKm <= 1) return "near";
  if (dFootprintKm <= 5) return "close";
  if (dFootprintKm <= 20) return "wider";
  return "outside";
}

function matchesConcept(tags, concept) {
  return concept.match.some(([k, v]) => tags[k] !== undefined &&
    (v === "*" || (v.startsWith("~") ? new RegExp(v.slice(1), "i").test(tags[k]) : tags[k] === v)));
}

// ---- The main tool --------------------------------------------------------

// Returns, per concept, the features near the site with distance from the footprint edge.
export function screen(osmJson, catalogue, lon, lat, footprintKm) {
  const site = turf.point([lon, lat]);
  const out = {};
  for (const [id, c] of osmEntries(catalogue)) out[id] = { label: c.label, ps: c.ps, radius_km: c.radius_km, features: [] };

  // Elements with tags but no geometry came from the "contains the site" set.
  const hasGeom = (e) => e.lat !== undefined || e.geometry || (e.members || []).some((m) => m.geometry || m.lat !== undefined);
  const inside = osmJson.elements.filter((e) => e.tags && !hasGeom(e));
  const insideIds = new Set(inside.map((e) => `${e.type}/${e.id}`));
  const fc = osmtogeojson({ ...osmJson, elements: osmJson.elements.filter(hasGeom) });
  const items = [
    ...inside.map((e) => ({ id: `${e.type}/${e.id}`, tags: e.tags, d: 0, gtype: "contains site" })),
    ...fc.features
      .filter((f) => !insideIds.has(f.id))
      .map((f) => ({ id: f.id, tags: f.properties.tags || f.properties || {}, d: distanceKm(site, f), gtype: f.geometry && f.geometry.type })),
  ];
  const seen = new Set();
  for (const { id: fid, tags, d, gtype } of items) {
    if (seen.has(fid) || !isFinite(d)) continue;
    seen.add(fid);
    const dFoot = Math.max(0, d - footprintKm);
    for (const [id, c] of osmEntries(catalogue)) {
      if (!matchesConcept(tags, c)) continue;
      if (dFoot > c.radius_km) continue;
      out[id].features.push({
        osm_id: fid,
        name: tags.name || tags["name:en"] || null,
        type: c.match.filter(([k]) => tags[k] !== undefined).map(([k]) => `${k}=${tags[k]}`)[0],
        distance_km: Math.round(dFoot * 100) / 100,
        band: band(dFoot),
        geometry_type: gtype,
      });
    }
  }
  for (const v of Object.values(out)) v.features.sort((a, b) => a.distance_km - b.distance_km);
  return out;
}

// Compact summary for a model or a person: counts per band and the nearest few named features.
export function summarise(result, top = 5) {
  const s = {};
  for (const [id, v] of Object.entries(result)) {
    const counts = { on_site: 0, near: 0, close: 0, wider: 0 };
    for (const f of v.features) counts[f.band] = (counts[f.band] || 0) + 1;
    s[id] = {
      label: v.label, ps: v.ps, searched_km: v.radius_km, total: v.features.length, counts,
      nearest: v.features.slice(0, top).map(({ name, type, distance_km }) => ({ name, type, distance_km })),
    };
  }
  return s;
}

// ---- GBIF: threatened species records -------------------------------------
// Occurrence records (sightings and specimens) of species the IUCN Red List rates Critically Endangered
// or Endangered. Records, not ranges: absence of records means nothing.

export const GBIF_API = "https://api.gbif.org/v1/occurrence/search";
export const GBIF_CATEGORIES = ["CR", "EN"];

export function gbifUrl(lon, lat, radiusKm, { limit = 300, facetOnly = false } = {}) {
  const p = new URLSearchParams({
    geoDistance: `${lat},${lon},${radiusKm.toFixed(1)}km`,
    hasGeospatialIssue: "false", occurrenceStatus: "PRESENT", limit: String(facetOnly ? 0 : limit),
  });
  for (const c of GBIF_CATEGORIES) p.append("iucnRedListCategory", c);
  if (facetOnly) { p.set("facet", "speciesKey"); p.set("facetLimit", "500"); }
  return `${GBIF_API}?${p}`;
}

// Keep only what the screen needs; full records are ~4 KB each.
export function slimGbif(json) {
  return {
    count: json.count,
    results: (json.results || []).map((r) => ({
      key: r.key, speciesKey: r.speciesKey, species: r.species, vernacularName: r.vernacularName || null,
      category: r.iucnRedListCategory, class: r.class || null, lat: r.decimalLatitude, lon: r.decimalLongitude,
      uncertainty_m: r.coordinateUncertaintyInMeters ?? null, year: r.year ?? null,
      basis: r.basisOfRecord, dataset: r.datasetName || r.datasetKey, license: r.license,
    })),
    facets: json.facets,
  };
}

// near: records within footprint + 5 km; wide: species facet within footprint + 20 km.
export function summariseGbif(near, wide, lon, lat, footprintKm) {
  const site = turf.point([lon, lat]);
  const bySpecies = new Map();
  for (const r of near.results) {
    if (r.lat == null || r.lon == null) continue;
    const d = Math.max(0, turf.distance(site, turf.point([r.lon, r.lat]), { units: "kilometers" }) - footprintKm);
    const k = r.speciesKey || r.species;
    const e = bySpecies.get(k) || { species: r.species, common_name: r.vernacularName, category: r.category, group: r.class,
      records: 0, nearest_km: Infinity, latest_year: null, licences: new Set() };
    e.records++;
    e.nearest_km = Math.min(e.nearest_km, d);
    if (r.year && (!e.latest_year || r.year > e.latest_year)) e.latest_year = r.year;
    if (!e.common_name && r.vernacularName) e.common_name = r.vernacularName;
    e.licences.add((r.license || "").replace(/^https?:\/\/creativecommons.org\/(licenses|publicdomain)\//, "").replace(/\/legalcode$/, ""));
    bySpecies.set(k, e);
  }
  const species = [...bySpecies.values()]
    .map((e) => ({ ...e, nearest_km: Math.round(e.nearest_km * 100) / 100, band: band(e.nearest_km), licences: [...e.licences] }))
    .sort((a, b) => (a.category === b.category ? 0 : a.category === "CR" ? -1 : 1) || a.nearest_km - b.nearest_km);
  const wideCounts = wide?.facets?.[0]?.counts || [];
  return {
    source: "GBIF occurrence records filtered by IUCN Red List category (CR, EN)",
    searched_km: 5, records_found: near.count, records_read: near.results.length,
    truncated: near.count > near.results.length,
    species,
    wider_20km: wide ? { records: wide.count, species: wideCounts.length } : null,
    caveat: "Records are sightings and specimens, not ranges. Many places are under-recorded and some sensitive species are blurred. No records is not evidence of absence.",
  };
}

// ---- Wikidata: named places and features near the site --------------------
// A gazetteer for desk research: settlements, protected and heritage sites, rivers, with Wikipedia links.
// Point coordinates only, so large areas (parks) are found only if their centre point is near.

export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

export function wikidataQuery(lon, lat, radiusKm, limit = 120) {
  return `SELECT ?item ?itemLabel ?dist (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
  (SAMPLE(?heritageLabel) AS ?heritage) (SAMPLE(?article) AS ?wikipedia) (SAMPLE(?whs) AS ?whs_id) WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm.toFixed(1)}" . bd:serviceParam wikibase:distance ?dist . }
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?item wdt:P1435 ?h . ?h rdfs:label ?heritageLabel . FILTER(LANG(?heritageLabel) = "en") }
  OPTIONAL { ?item wdt:P757 ?whs . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" . }
} GROUP BY ?item ?itemLabel ?dist ORDER BY ?dist LIMIT ${limit}`;
}

export function wikidataUrl(lon, lat, radiusKm, limit) {
  return `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(wikidataQuery(lon, lat, radiusKm, limit))}`;
}

export function summariseWikidata(json, footprintKm) {
  const seen = new Map();
  for (const b of json.results.bindings) {
    const qid = b.item.value.split("/").pop();
    const d = Math.max(0, parseFloat(b.dist.value) - footprintKm);
    const name = b.itemLabel?.value;
    if (seen.has(qid) && seen.get(qid).distance_km <= d) continue;
    seen.set(qid, {
      qid, name: name && name !== qid ? name : null,
      types: b.types?.value ? b.types.value.split("|") : [],
      distance_km: Math.round(d * 100) / 100, band: band(d),
      heritage: b.heritage?.value || null, world_heritage_id: b.whs_id?.value || null,
      wikipedia: b.wikipedia?.value || null,
    });
  }
  const items = [...seen.values()].sort((a, b) => a.distance_km - b.distance_km);
  return {
    source: "Wikidata (CC0)", items,
    caveat: "Point locations only: large areas such as parks appear only if their centre point is within the search radius.",
  };
}
