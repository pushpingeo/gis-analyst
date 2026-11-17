// Open catalogue search and data fetch: the analyst's way to answer "what data is there about X here?"
// and "what does that dataset show in or near this place?". Built on the atlas's find_datasets (text and
// area) and fetch_features (one dataset, an area). Geometry stays here; the model gets names, distances,
// a few attributes, the publisher and the licence. No DOM, so the page and the scripts share it.
import * as turf from "./vendor/turf.js";
import { atlasCandidate, pickName, edgeDistanceKm } from "./atlasfeatures.js";

const round = (v, d = 2) => (v == null ? v : Math.round(v * 10 ** d) / 10 ** d);

export const DATA_TOOL_DEFS = [
  {
    name: "find_data",
    description: "Search the AI Living World Atlas catalogue (about 256,000 published map layers worldwide) for datasets about a topic in an area: thermal hotspots, fish habitat, flood zones, coral, shipwrecks, seismic surveys, anything. Matches words in dataset titles and publishers, so use short distinctive words ('VIIRS', 'thermal', 'fish habitat', 'coral', 'flood') and put two or three wordings in one step: they run at the same time. Returns datasets with ids (D1, D2…), publisher, licence, coverage and whether features can be fetched (can_fetch). Then use get_data on the best one.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One to three words that would appear in the dataset's title or publisher, e.g. 'VIIRS', 'essential fish habitat', 'NOAA coral'" },
        area: { type: "string", description: "A place name (e.g. Area 1), a candidate id, or a country name (its waters included). Leave out to use the map view." },
        concept: { type: "string", description: "Optional atlas concept id to narrow the search, e.g. protected-area, natural-hazard, seabed-habitat, marine-activity, habitat, species-occurrence, oil-gas, settlement. Leave out if unsure." },
      },
      required: ["text"],
    },
  },
  {
    name: "get_data",
    description: "Fetch features from one catalogue dataset (an id from find_data) in or near a place, measured from the place's edge. Puts them on the map as candidates (C ids), and returns how many lie inside the place and within the distance, the nearest ones with key attributes (dates, types, names), the publisher, the licence and when it was checked. A dataset that answers with nothing means nothing in that dataset at that time, not nothing at all.",
    input_schema: {
      type: "object",
      properties: {
        dataset: { type: "string", description: "A dataset id from find_data, e.g. D2" },
        place: { type: "string", description: "Place name (e.g. Area 1) or candidate id" },
        within_km: { type: "number", description: "Also count features up to this far outside the place (0 to 50 km). Default 0 for an area, 10 for a point." },
        name: { type: "string", description: "Optional: only features with this text in a name-like field" },
      },
      required: ["dataset", "place"],
    },
  },
];

const DATE_KEY = /date|time|acq|year|updated|created|observ|detect/i;
const USEFUL_KEY = /name|title|type|class|categor|status|designat|confidence|frp|bright|satellite|instrument|daynight|species|habitat|depth|operator|commod/i;
const SKIP_KEY = /^(objectid|fid|gid|id|shape.*|st_.*|globalid|ogc_fid)$/i;

// A few attributes worth showing: dates first (as dates), then names, types and measures. Epoch-millisecond
// numbers in date-like fields (ArcGIS) become ISO dates.
export function keyAttributes(p = {}, max = 6) {
  const out = {};
  const entries = Object.entries(p).filter(([k, v]) => !SKIP_KEY.test(k) && v != null && v !== "" && (typeof v !== "string" || v.length < 120));
  const asDate = (v) => (typeof v === "number" && v > 1e11 && v < 5e12 ? new Date(v).toISOString().slice(0, 16).replace("T", " ") + " UTC" : v);
  for (const [k, v] of entries.filter(([k]) => DATE_KEY.test(k))) { if (Object.keys(out).length >= Math.ceil(max / 2)) break; out[k] = asDate(v); }
  for (const [k, v] of entries.filter(([k]) => !DATE_KEY.test(k) && USEFUL_KEY.test(k))) { if (Object.keys(out).length >= max) break; out[k] = v; }
  return out;
}

// Distance between two geometries in km: 0 if they touch, else the shortest vertex-to-edge distance both ways.
// Vertex-based, so it can overstate the gap between two long straight edges a little; fine for screening.
export function geometryDistanceKm(a, b) {
  const fa = { type: "Feature", properties: {}, geometry: a }, fb = { type: "Feature", properties: {}, geometry: b };
  try { if (turf.booleanIntersects(fa, fb)) return 0; } catch { /* odd geometry: measure instead */ }
  const verts = (g) => { const out = []; const walk = (c) => (typeof c[0] === "number" ? out.push(c) : c.forEach(walk)); walk(g.coordinates); return out; };
  const sample = (pts) => (pts.length > 400 ? pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0) : pts);
  let best = Infinity;
  const one = (pt, g) => (g.type === "Point" ? turf.distance(pt, g.coordinates) : g.type === "MultiPoint" ? Math.min(...g.coordinates.map((c) => turf.distance(pt, c))) : edgeDistanceKm(pt, g));
  for (const p of sample(verts(a))) { const d = one(p, b); if (d != null && d < best) best = d; }
  for (const p of sample(verts(b))) { const d = one(p, a); if (d != null && d < best) best = d; }
  return best === Infinity ? null : best;
}

const shortLicence = (l) => {
  if (!l) return "not stated";
  if (/esri master license/i.test(l)) return "Esri Master License Agreement (check terms before commercial use)";
  return l.length > 140 ? l.slice(0, 139) + "…" : l;
};

// host: { atlas(tool, args), resolve(ref) → { feature, lonlat, label }, area(ref) → { bbox, label } | null,
//         keep(candidate) → id, onCandidates(list), now() }
export function createDataTools(host) {
  const datasets = new Map();
  let n = 0;
  const keepDataset = (d) => {
    for (const [id, x] of datasets) if (x.id === d.id) return id;
    const id = `D${++n}`; datasets.set(id, d); return id;
  };

  async function callWithRetry(tool, args) {
    try { return await host.atlas(tool, args); }
    catch (e) {
      // The atlas database sheds load for a few seconds at a time ("D1 DB is overloaded"): one retry after a pause.
      if (!/overload|too many|timed out|50\d/i.test(e.message || "")) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 + Math.random() * 1500));
      return host.atlas(tool, args);
    }
  }

  return {
    datasets,
    async find_data({ text, area, concept }) {
      if (!host.atlas) return { not_checked: "The atlas isn't connected here, so the catalogue couldn't be searched." };
      const where = await host.area(area);
      if (!where) return { not_checked: `"${area}" isn't a place, candidate or country I can find, and there's no map view.` };
      let r;
      try {
        r = await callWithRetry("find_datasets", { text: String(text).trim(), bbox: where.bbox, limit: 25, ...(concept ? { concept } : {}) });
      } catch (e) {
        return { searched: { text, area: where.label }, not_checked: `The catalogue search failed: ${String(e.message || e).slice(0, 160)}. Say it couldn't be checked; don't say the data doesn't exist.` };
      }
      // One entry per title and publisher (the same layer is often listed by several portals), fetchable first,
      // then the atlas's own order.
      const seen = new Set();
      const list = (r.results || []).filter((d) => !d.extent_may_be_overstated).filter((d) => {
        const k = `${d.title}|${d.publisher}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
      });
      list.sort((a, b) => (b.capabilities || []).includes("query") - (a.capabilities || []).includes("query"));
      const shown = list.slice(0, 8).map((d) => ({
        id: keepDataset(d), title: d.title, publisher: d.publisher, coverage: d.coverage,
        can_fetch: (d.capabilities || []).includes("query"),
        ...((d.capabilities || []).includes("time") ? { time_aware: true } : {}),
        ...(d.geometry?.length ? { geometry: d.geometry.join("/") } : {}),
        licence: shortLicence(d.licence),
      }));
      return {
        searched: { text, area: where.label, ...(concept ? { concept } : {}) },
        matches: r.matches ?? list.length, datasets: shown,
        ...(list.length > shown.length ? { more: list.length - shown.length } : {}),
        note: shown.length ? undefined : `No dataset titles or publishers contain "${text}" for ${where.label}. Try other words before saying there's no such data, and say what you searched.`,
      };
    },

    async get_data({ dataset, place, within_km, name }) {
      if (!host.atlas) return { not_checked: "The atlas isn't connected here." };
      const d = datasets.get(String(dataset).trim().toUpperCase());
      if (!d) throw new Error(`"${dataset}" isn't a dataset id from find_data in this conversation. Use find_data first.`);
      if (!(d.capabilities || []).includes("query")) return { dataset: d.title, not_checked: "This dataset is a picture service only (can_fetch false): its features can't be fetched. Pick one with can_fetch true." };
      const p = host.resolve(place);
      const isPoint = p.feature.geometry.type === "Point";
      const within = Math.max(0, Math.min(50, within_km ?? (isPoint ? 10 : 0)));
      const b = turf.bbox(turf.buffer(p.feature, Math.max(within, 0.05), { units: "kilometers", steps: 8 }));
      const checkedAt = host.now ? host.now() : new Date().toISOString();
      let g;
      try {
        g = await callWithRetry("fetch_features", { id: d.id, bbox: b.map((v) => round(v, 5)), limit: 100, ...(name ? { text: name } : {}) });
      } catch (e) {
        return { dataset: d.title, publisher: d.publisher, checked_at: checkedAt, not_checked: `The publisher's service didn't answer: ${String(e.message || e).slice(0, 160)}. Report it as not checked, not as nothing found.` };
      }
      const found = [];
      for (const f of g.features || []) {
        if (!f.geometry) continue;
        const dist = geometryDistanceKm(p.feature.geometry, f.geometry);
        if (dist == null || dist > within) continue;
        let c;
        try { c = atlasCandidate(f, d, pickName(f.properties || {}) || d.title); } catch { continue; }
        c.distance_km = round(dist, 2);
        c.extra = keyAttributes(f.properties || {});
        found.push(c);
      }
      // Nearest first; features inside the place are ordered by distance from its centre.
      const centre = isPoint ? p.feature.geometry.coordinates : turf.centroid(p.feature).geometry.coordinates;
      found.forEach((c) => { c._fromCentre = turf.distance(centre, c.lonlat); });
      found.sort((x, y) => x.distance_km - y.distance_km || x._fromCentre - y._fromCentre);
      const kept = found.map((c) => ({ ...c, id: host.keep(c) }));
      if (kept.length) host.onCandidates?.(kept);
      const inside = kept.filter((c) => c.distance_km === 0).length;
      const returned = g.returned ?? (g.features || []).length;
      return {
        dataset: d.title, publisher: d.publisher, licence: shortLicence(d.licence), checked_at: checkedAt,
        place: p.label, within_km: within,
        inside_or_touching: inside, within_distance: kept.length,
        nearest: kept.slice(0, 12).map((c) => ({ id: c.id, name: c.name, type: c.type, distance_km: c.distance_km, ...(Object.keys(c.extra).length ? { details: c.extra } : {}) })),
        ...(kept.length > 12 ? { more: kept.length - 12 } : {}),
        ...(returned >= 100 ? { capped: "The service returned its 100-feature limit for this box, so there may be more." } : {}),
        ...((d.capabilities || []).includes("time") ? { time_note: "A live, time-aware layer: it shows recent detections only (often the last 24 hours to 7 days). Say so when reporting." } : {}),
      };
    },
  };
}
