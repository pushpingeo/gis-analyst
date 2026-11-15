// Spatial tools for the NTR skill. Deterministic: no AI in here.
// Works in the browser (bare imports resolved by the import map in index.html) and in Node (npm packages).
import * as turf from "@turf/turf";
import osmtogeojson from "osmtogeojson";

export const FOOTPRINT_KM = {
  thermal: 0.5, substation: 0.5, terminal: 0.5, solar: 1, wind: 3, mine: 3, hydro: 5, other: 1,
};

// ---- Overpass -------------------------------------------------------------

function tagFilter([k, v]) {
  return v === "*" ? `["${k}"]` : `["${k}"="${v}"]`;
}

// One request per site: every concept's filters, searched around the site and (for areas) containing it.
export function buildOverpassQuery(catalogue, lon, lat, footprintKm) {
  const lines = [];
  const contain = [];
  for (const c of Object.values(catalogue.concepts)) {
    const r = Math.round((footprintKm + c.radius_km) * 1000);
    for (const m of c.match) {
      lines.push(`nwr${tagFilter(m)}(around:${r},${lat},${lon});`);
      if (c.containing) contain.push(`way(pivot.a)${tagFilter(m)};rel(pivot.a)${tagFilter(m)};`);
    }
  }
  // Clip returned geometry to a box round the search area so big parks don't blow up the response.
  const maxKm = footprintKm + Math.max(...Object.values(catalogue.concepts).map((c) => c.radius_km));
  const dLat = maxKm / 111.32;
  const dLon = maxKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((x) => x.toFixed(5)).join(",");
  // Areas that contain the site come back as tags only (distance 0); everything else with clipped geometry.
  return `[out:json][timeout:60];
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

export async function fetchOverpass(query, endpoint = "https://overpass-api.de/api/interpreter", fetchFn = fetch) {
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
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
      if (turf.booleanPointInPolygon(site, g)) return 0;
      return lineDistance(site, turf.polygonToLine(g));
    }
    default:
      return Infinity;
  }
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
  return concept.match.some(([k, v]) => tags[k] !== undefined && (v === "*" || tags[k] === v));
}

// ---- The main tool --------------------------------------------------------

// Returns, per concept, the features near the site with distance from the footprint edge.
export function screen(osmJson, catalogue, lon, lat, footprintKm) {
  const site = turf.point([lon, lat]);
  const out = {};
  for (const [id, c] of Object.entries(catalogue.concepts)) out[id] = { label: c.label, ps: c.ps, radius_km: c.radius_km, features: [] };

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
    for (const [id, c] of Object.entries(catalogue.concepts)) {
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
