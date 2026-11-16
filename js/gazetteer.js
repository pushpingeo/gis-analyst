// Finding places and features by name: the "anchors" that areas are built around.
// Sources: authoritative named-feature layers listed in catalogue/anchors.json (from the atlas),
// OpenStreetMap through Nominatim, Natural Earth towns, and OpenStreetMap features near a point (Overpass).
// No DOM, so it runs in the page and in the evaluation. fetchFn is injectable for tests and for Node.
import * as turf from "./vendor/turf.js";
import { fetchOverpass, OVERPASS_ENDPOINTS } from "./tools.js";

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

// A candidate keeps its full geometry here; the model only ever sees a compact description.
export function candidate({ name, type, geometry, source, extra = {} }) {
  const f = { type: "Feature", properties: {}, geometry };
  const at = geometry.type === "Point" ? geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates;
  const c = { name, type, geometry, source, extra, lonlat: at.map((v) => round(v, 5)) };
  if (/Polygon/.test(geometry.type)) c.area_km2 = round(turf.area(f) / 1e6, 3);
  if (/LineString/.test(geometry.type)) c.length_km = round(turf.length(f), 2);
  return c;
}

// ---- authoritative layers from the atlas -------------------------------------------------
export const BLOCK_REF = /\b(\d{1,3})\s*\/\s*(\d{1,2})([a-z])?\b/i;

const esc = (s) => String(s).replace(/'/g, "''").toUpperCase();
const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export async function searchAnchors(sources, term, { near = null, fetchFn = fetch, limit = 8 } = {}) {
  const out = [];
  const block = term.match(BLOCK_REF);
  for (const s of sources) {
    if (near && !intersects(s.coverage, [near[0] - 2, near[1] - 2, near[0] + 2, near[1] + 2])) continue;
    let where;
    if (s.search === "block_ref") {
      if (!block) continue;
      where = `${s.name_field} = '${block[1]}/${block[2]}'`;
    } else {
      const words = term.replace(BLOCK_REF, "").replace(/\b(platform|field|installation|fpso|the)\b/gi, " ").trim();
      if (words.length < 3) continue;
      where = `UPPER(${s.name_field}) LIKE '%${esc(words)}%'`;
    }
    if (s.where) where = `(${where}) AND ${s.where}`;
    const fields = [s.name_field, s.type_field, ...(s.extra_fields || [])].filter(Boolean).join(",");
    const url = `${s.url}/query?where=${encodeURIComponent(where)}&outFields=${fields}&outSR=4326&f=geojson&resultRecordCount=${limit}`;
    try {
      const r = await fetchFn(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      for (const f of j.features || []) {
        if (!f.geometry) continue;
        const p = f.properties || {};
        out.push(candidate({
          name: p[s.name_field], type: [s.kind, p[s.type_field]].filter(Boolean).join(": "), geometry: f.geometry,
          source: { id: s.id, title: s.title, publisher: s.publisher, licence: s.licence || "not stated", url: s.landing_page, atlas_id: s.atlas_id },
          extra: {
            ...Object.fromEntries((s.extra_fields || []).map((k) => [k, p[k]]).filter(([, v]) => v != null && String(v).trim())),
            ...(s.search === "block_ref" && block[3] ? { note: `This layer has whole blocks only; part-block ${block[1]}/${block[2]}${block[3]} is a licensed subdivision of it.` } : {}),
          },
        }));
      }
    } catch (e) {
      out.push({ error: `${s.title}: ${e.message}` });
    }
  }
  return out;
}

// ---- OpenStreetMap: Nominatim ------------------------------------------------------------
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
let lastNominatim = 0;

export async function searchNominatim(term, { near = null, country = null, fetchFn = fetch, limit = 6, headers = {} } = {}) {
  // Nominatim's policy is at most one request a second.
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const q = new URLSearchParams({ q: term, format: "jsonv2", limit: String(limit), polygon_geojson: "1", polygon_threshold: "0.0005", addressdetails: "1" });
  if (country) q.set("countrycodes", country.toLowerCase());
  if (near) q.set("viewbox", [near[0] - 1, near[1] + 1, near[0] + 1, near[1] - 1].join(","));
  const r = await fetchFn(`${NOMINATIM}?${q}`, { headers });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const j = await r.json();
  return j.map((x) => candidate({
    name: x.name || x.display_name.split(",")[0],
    type: `${x.category}: ${x.type}`.replace(/_/g, " "),
    geometry: x.geojson && x.geojson.type !== "Point" && x.category !== "boundary" && x.category !== "place"
      ? x.geojson : { type: "Point", coordinates: [+x.lon, +x.lat] },
    source: { id: "osm-nominatim", title: "OpenStreetMap (Nominatim search)", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}` },
    extra: { place: x.display_name, country: x.address?.country, importance: round(x.importance || 0, 3) },
  }));
}

// ---- Natural Earth towns (already loaded for the reference layer) ------------------------------
export function searchNaturalEarth(places, term, limit = 5) {
  const t = term.toLowerCase().trim();
  return places
    .filter((p) => p.name && p.name.toLowerCase() === t)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit)
    .map((p) => candidate({
      name: p.name, type: "populated place", geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      source: { id: "natural-earth", title: "Natural Earth populated places", publisher: "Natural Earth", licence: "Public domain", url: "https://www.naturalearthdata.com/" },
      extra: { country: p.country, region: p.region, population: p.pop },
    }));
}

// ---- OpenStreetMap features of a kind near a point (Overpass) ---------------------------------
// Used to find the asset itself ("the solar farm north of Mocuba") once a town or feature anchors the search.
export const FEATURE_TYPES = {
  "solar farm": ['nwr["power"="plant"]["plant:source"="solar"]', 'way["power"="generator"]["generator:source"="solar"]'],
  "wind farm": ['nwr["power"="plant"]["plant:source"="wind"]', 'node["power"="generator"]["generator:source"="wind"]'],
  "hydro or dam": ['nwr["power"="plant"]["plant:source"="hydro"]', 'way["waterway"="dam"]', 'nwr["water"="reservoir"]'],
  "thermal power plant": ['nwr["power"="plant"]["plant:source"~"coal|gas|oil|diesel|biomass|biogas|waste"]'],
  "power plant (any)": ['nwr["power"="plant"]'],
  "substation": ['nwr["power"="substation"]'],
  "mine or quarry": ['nwr["landuse"="quarry"]', 'nwr["industrial"~"mine|mining"]', 'nwr["man_made"="mineshaft"]'],
  "port or terminal": ['nwr["landuse"="port"]', 'nwr["industrial"~"port|terminal|lng|oil"]', 'nwr["man_made"~"pier|jetty"]["name"]'],
  "offshore platform": ['nwr["man_made"="offshore_platform"]'],
  "industrial area": ['way["landuse"="industrial"]'],
  "airport": ['nwr["aeroway"="aerodrome"]'],
  "settlement": ['node["place"~"city|town|village|hamlet"]'],
};

export async function findFeaturesNear(lonlat, featureType, radiusKm, { name = null, fetchFn = fetch, limit = 12, headers = {} } = {}) {
  const parts = FEATURE_TYPES[featureType];
  if (!parts) throw new Error(`Unknown feature type. Use one of: ${Object.keys(FEATURE_TYPES).join(", ")}.`);
  const r = Math.min(Math.max(radiusKm, 0.5), 50) * 1000;
  const nameFilter = name ? `["name"~"${name.replace(/["\\]/g, "")}",i]` : "";
  const q = `[out:json][timeout:40];(${parts.map((p) => `${p}${nameFilter}(around:${r},${lonlat[1]},${lonlat[0]});`).join("")});out geom 80;`;
  let json, lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try { json = await fetchOverpass(q, ep, fetchFn, 45000, headers); break; } catch (e) { lastErr = e; }
  }
  if (!json) throw new Error(`OpenStreetMap search failed: ${lastErr?.message}`);
  const cands = [];
  let turbines = 0;
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (t["generator:source"] === "wind" && el.type === "node") { turbines++; continue; } // counted, not listed
    let geometry;
    if (el.type === "node") geometry = { type: "Point", coordinates: [el.lon, el.lat] };
    else if (el.type === "way" && el.geometry?.length > 3 && sameXY(el.geometry[0], el.geometry.at(-1))) geometry = { type: "Polygon", coordinates: [el.geometry.map((p) => [p.lon, p.lat])] };
    else if (el.type === "way" && el.geometry) geometry = { type: "LineString", coordinates: el.geometry.map((p) => [p.lon, p.lat]) };
    else if (el.bounds) geometry = turf.bboxPolygon([el.bounds.minlon, el.bounds.minlat, el.bounds.maxlon, el.bounds.maxlat]).geometry;
    if (!geometry) continue;
    const c = candidate({
      name: t.name || t["name:en"] || null, type: describeTags(t), geometry,
      source: { id: "osm-overpass", title: "OpenStreetMap (Overpass)", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${el.type}/${el.id}` },
      extra: pick(t, ["operator", "plant:output:electricity", "start_date", "generator:output:electricity"]),
    });
    c.distance_km = round(turf.distance(lonlat, c.lonlat), 2);
    c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
    if (el.type === "relation") c.extra.note = "relation: outline approximated by its bounding box";
    cands.push(c);
  }
  cands.sort((a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || a.distance_km - b.distance_km);
  return { candidates: cands.slice(0, limit), total: cands.length, wind_turbines: turbines || undefined };
}

const sameXY = (a, b) => a.lat === b.lat && a.lon === b.lon;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));
function describeTags(t) {
  for (const k of ["power", "man_made", "landuse", "industrial", "waterway", "water", "aeroway", "place"]) {
    if (t[k]) return `${k}=${t[k]}${t["plant:source"] ? ` (${t["plant:source"]})` : t["generator:source"] ? ` (${t["generator:source"]})` : ""}`;
  }
  return "feature";
}
