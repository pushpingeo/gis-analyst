// Boundaries near a site, measured from its edge, done in code (not left to the model's choice of dataset):
// - countries: other countries' territory within reach, from Tobler's own Natural Earth reference (public domain,
//   1:10m, good to about a kilometre). Onshore that is the distance to the land border; offshore, to a foreign coast.
// - maritime: boundary lines from the Flanders Marine Institute's Maritime Boundaries (v12, CC-BY 4.0) through the
//   atlas, with the territories on each side and the line type (treaty, median line, joint regime, disputed…).
// Indicative only: VLIZ says its data has no legal value and isn't for legal or resource-exploration purposes.
import * as turf from "./vendor/turf.js";
import { countriesTouched } from "./reference.js";
import { geometryDistanceKm } from "./datatools.js";

export const MARITIME_BOUNDARIES = {
  id: "9760b5061ea298eb", title: "Maritime Boundaries (v12, world, 2023)", publisher: "Flanders Marine Institute (VLIZ) - Marine Regions",
  licence: "CC-BY 4.0 (marineregions.org)", attribution: "Flanders Marine Institute (2023). Maritime Boundaries Geodatabase, version 12. marineregions.org",
};
export const COUNTRIES_SOURCE = { title: "Natural Earth 1:10m countries (Tobler reference)", publisher: "Natural Earth", licence: "Public domain" };
export const BOUNDARY_CAVEAT = "Indicative only: boundaries are approximate and have no legal standing. Marine Regions' data is not for legal, resource-exploration or navigation purposes; Natural Earth's countries are good to about a kilometre.";

// Only the part of a big polygon near the site (the vendored Turf has intersect, not bboxClip).
function clipToBox(f, box) {
  try { const g = turf.intersect(turf.featureCollection([f, turf.bboxPolygon(box)])); return g ? g.geometry : null; }
  catch { return f.geometry; }
}
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const grow = (b, km) => {
  const dy = km / 111.32, dx = km / (111.32 * Math.max(0.1, Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180)));
  return [Math.max(-180, b[0] - dx), Math.max(-90, b[1] - dy), Math.min(180, b[2] + dx), Math.min(90, b[3] + dy)];
};

// site: GeoJSON Feature (the footprint). Returns { evidence: [candidates], checked: [...] }, candidates shaped like
// the data tools' (name, type, geometry, distance_km, source, extra) so the run keeps them as ordinary evidence.
export async function nearestBoundaries({ ref, site, withinKm, atlas = null, sea = true, now = () => new Date().toISOString() }) {
  const evidence = [], checked = [];
  const box = grow(turf.bbox(site), withinKm + 5);
  // Countries (reference data, always available).
  try {
    const countries = await ref.get("countries");
    const own = new Set(countriesTouched(countries, site).map((c) => c.name));
    for (const c of countries.features) {
      const cb = c.bbox || turf.bbox(c);
      if (cb[2] < box[0] || cb[0] > box[2] || cb[3] < box[1] || cb[1] > box[3]) continue;
      const clipped = { geometry: clipToBox(c, box) };
      if (!clipped.geometry) continue;
      if (own.has(c.properties.name)) continue; // the site's own country isn't evidence of anything
      const km = geometryDistanceKm(site.geometry, clipped.geometry);
      if (km == null || km > withinKm) continue;
      evidence.push({
        name: c.properties.name,
        type: own.size ? `neighbouring country (land border at this distance; site in ${[...own].join(" and ")})` : "country with coast or territory within reach",
        geometry: clipped.geometry, distance_km: r2(km), source: { ...COUNTRIES_SOURCE },
        extra: { iso: c.properties.iso, sovereign: c.properties.sovereign, caveat: BOUNDARY_CAVEAT },
      });
    }
    if (own.size > 1) evidence.unshift({ name: `Land border between ${[...own].join(" and ")}`, type: "land border crossing the site", geometry: site.geometry, distance_km: 0, source: { ...COUNTRIES_SOURCE }, extra: { caveat: BOUNDARY_CAVEAT } });
    const foreign = evidence;
    checked.push({ evidence: "transboundary", dataset: COUNTRIES_SOURCE.title, publisher: COUNTRIES_SOURCE.publisher, licence: COUNTRIES_SOURCE.licence, checked_at: now(),
      result: foreign.length ? "features" : "none in dataset", count: foreign.length });
  } catch (e) {
    checked.push({ evidence: "transboundary", dataset: COUNTRIES_SOURCE.title, result: "not checked", why: String(e.message || e).slice(0, 160) });
  }
  // Maritime boundary lines (atlas). Only where there's sea within reach.
  if (!sea) {
    checked.push({ evidence: "transboundary", dataset: MARITIME_BOUNDARIES.title, publisher: MARITIME_BOUNDARIES.publisher, result: "none in dataset", count: 0, why: `no sea within ${withinKm} km of the site, so no maritime boundary in reach` });
  } else if (atlas) {
    try {
      const fc = await atlas("fetch_features", { id: MARITIME_BOUNDARIES.id, bbox: box, limit: 50 });
      let n = 0;
      for (const f of fc?.features || []) {
        if (!f.geometry) continue;
        const km = geometryDistanceKm(site.geometry, f.geometry);
        if (km == null || km > withinKm) continue;
        const p = f.properties || {};
        const sides = [p.territory1, p.territory2].filter(Boolean);
        const sov = [p.sovereign1, p.sovereign2].filter(Boolean);
        n++;
        const geometry = f.geometry;
        evidence.push({
          name: p.line_name || (sides.length ? sides.join(" – ") : "Maritime boundary"),
          type: `maritime boundary${p.line_type ? ` (${p.line_type})` : ""}`, geometry, distance_km: r2(km),
          source: { title: MARITIME_BOUNDARIES.title, publisher: MARITIME_BOUNDARIES.publisher, licence: MARITIME_BOUNDARIES.licence },
          extra: { line_type: p.line_type || null, sides: sides.join(" / ") || null, sovereigns: [...new Set(sov)].join(" / ") || null, caveat: BOUNDARY_CAVEAT },
        });
      }
      checked.push({ evidence: "transboundary", dataset: MARITIME_BOUNDARIES.title, publisher: MARITIME_BOUNDARIES.publisher, licence: MARITIME_BOUNDARIES.licence, checked_at: now(),
        result: n ? "features" : "none in dataset", count: n });
    } catch (e) {
      checked.push({ evidence: "transboundary", dataset: MARITIME_BOUNDARIES.title, publisher: MARITIME_BOUNDARIES.publisher, result: "not checked", why: String(e.message || e).slice(0, 160) });
    }
  } else {
    checked.push({ evidence: "transboundary", dataset: MARITIME_BOUNDARIES.title, result: "not checked", why: "The atlas isn't connected here." });
  }
  return { evidence: evidence.sort((a, b) => a.distance_km - b.distance_km), checked };
}
