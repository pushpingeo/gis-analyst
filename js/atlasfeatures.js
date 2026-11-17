// Features near a point from the AI Living World Atlas: find the datasets that hold this kind of thing here,
// then fetch their features. Thousands of publishers' servers stand behind it, so no single outage
// (like OpenStreetMap's Overpass on 16 Nov) stops the search.
// The transport is injected: in the evaluation it calls the atlas MCP server with the key from the environment;
// in the page it goes through the Worker, which holds the key. No DOM, so it runs in both.
import * as turf from "./vendor/turf.js";
import { candidate } from "./gazetteer.js";

// Tobler's feature types → the atlas's concepts, and an optional test on the feature's own type field.
export const ATLAS_CONCEPTS = {
  "solar farm": { concept: "power-plant", keep: /solar|photovoltaic|\bpv\b/i },
  "wind farm": { concept: "power-plant", keep: /wind/i, also: "offshore-wind-site" },
  "hydro or dam": { concept: "power-plant", keep: /hydro|dam|reservoir/i },
  "thermal power plant": { concept: "power-plant", keep: /coal|gas|oil|diesel|biomass|thermal|steam|combined/i },
  "power plant (any)": { concept: "power-plant" },
  "mine or quarry": { concept: "mineral-extraction" },
  "offshore platform": { concept: "oil-gas" },
  "port or terminal": { concept: "port-airport", keep: /port|terminal|harbour|harbor|jetty|wharf/i },
  "airport": { concept: "port-airport", keep: /airport|aerodrome|airfield/i },
  "settlement": { concept: "settlement" },
  "school": { concept: "school" },
  "hospital or clinic": { concept: "health-facility" },
  "park or green space": { concept: "greenspace" },
  "main road": { concept: "road" },
  "railway": { concept: "rail" },
  "river": { concept: "river" },
  "pipeline": { concept: "pipeline" },
  "power line": { concept: "power-line" },
  "protected area": { concept: "protected-area" },
  "heritage site": { concept: "heritage-site" },
};

// The atlas's publisher types for official bodies: "central-gov", "local-gov", "public-body", "intergovernmental"…
const AUTHORITATIVE = /gov|public-body|intergov|regulator|mapping-agency/i;
const NAME_KEYS = /^(name|site_?name|plant_?name|plant___project_name|project_?name|mine_?name|facility_?name|dep_?name|title|label|nom|nombre|naam|bezeichnung)$/i;
const NAMEISH = /name|project|plant|site|mine|facility|title|^ref$|road_?num|roadnumber|route/i;
const TYPEISH = /^(type|.*_?type|commod.*|fuel|technology|source|status|primary_fuel|dep_type)$/i;

function pickName(p) {
  const k = Object.keys(p).find((k) => NAME_KEYS.test(k) && typeof p[k] === "string" && p[k].trim())
    || Object.keys(p).find((k) => NAMEISH.test(k) && typeof p[k] === "string" && p[k].trim() && p[k].length < 120);
  return k ? p[k].trim() : null;
}
function pickType(p) {
  return Object.entries(p).filter(([k, v]) => TYPEISH.test(k) && typeof v === "string" && v.trim() && v.length < 80).map(([, v]) => v).slice(0, 2).join(", ");
}

// call(tool, args) → structuredContent. Returns { candidates, total, checked: [ { dataset, publisher, returned | error } ] }.
export async function atlasFeaturesNear(lonlat, featureType, radiusKm, { call, name = null, limit = 15, maxDatasets = 8 } = {}) {
  const map = ATLAS_CONCEPTS[featureType];
  if (!map) return null; // not a kind of thing the atlas indexes; OpenStreetMap only
  const r = Math.min(Math.max(radiusKm, 0.5), 50);
  const finds = await Promise.all([map.concept, map.also].filter(Boolean).map((concept) =>
    call("find_datasets", { lon: lonlat[0], lat: lonlat[1], radius_km: r, concept, capability: "query", limit: 12 }).catch(() => ({ results: [] }))));
  // Layers flagged with a possibly overstated extent are usually local layers claiming the world: skip them.
  const datasets = finds.flatMap((f) => f.results || []).filter((d) => !d.extent_may_be_overstated).slice(0, maxDatasets);
  const checked = [];
  const cands = [];
  await Promise.all(datasets.map(async (d) => {
    try {
      const g = await call("fetch_features", { id: d.id, lon: lonlat[0], lat: lonlat[1], radius_km: r, limit: 100 });
      checked.push({ dataset: d.title, publisher: d.publisher, returned: g.returned });
      for (const f of g.features || []) {
        if (!f.geometry) continue;
        const p = f.properties || {};
        const nm = pickName(p);
        const ty = pickType(p);
        if (map.keep && !map.keep.test(`${ty} ${d.title}`)) continue;
        // A name filter matches any text attribute: road numbers ("M9") often sit in their own field.
        if (name && !Object.values(p).some((v) => typeof v === "string" && v.toLowerCase().includes(name.toLowerCase()))) continue;
        let c;
        try {
          c = candidate({
            name: nm, type: ty || d.title, geometry: f.geometry,
            source: { id: "atlas", atlas_id: d.id, title: d.title, publisher: d.publisher, publisher_type: d.publisher_type,
              authoritative: AUTHORITATIVE.test(d.publisher_type || ""), licence: d.licence || "not stated" },
            extra: {},
          });
        } catch { continue; }
        c.distance_km = Math.round(turf.distance(lonlat, c.lonlat) * 100) / 100;
        if (c.distance_km > r * 1.2) continue;
        c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
        cands.push(c);
      }
    } catch (e) {
      checked.push({ dataset: d.title, publisher: d.publisher, error: String(e.message || e).slice(0, 120) });
    }
  }));
  // The same feature often appears in more than one layer: keep one per name within 1 km.
  const seen = [];
  const uniq = cands.filter((c) => {
    const dup = seen.find((s) => s.name && c.name && s.name.toLowerCase() === c.name.toLowerCase() && turf.distance(s.lonlat, c.lonlat) < 1);
    if (!dup) seen.push(c);
    return !dup;
  });
  uniq.sort((a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || a.distance_km - b.distance_km);
  return { candidates: uniq.slice(0, limit), total: uniq.length, checked, datasets_found: datasets.length };
}
