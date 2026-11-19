// Values read off rasters at sea, done in code as part of a screen's baseline (not left to the analyst's searches):
// - water depth over the site, from NOAA NCEI's DEM Global Mosaic (an ImageServer that returns pixel values;
//   GEBCO-based in deep water, finer national surveys where NOAA holds them). One getSamples call for up to 25 points.
// - vessel traffic from AIS, from EMODnet Human Activities' vessel density (hours per km² a month, 1 km cells, EU waters
//   and neighbours), read with WMS GetFeatureInfo: at the site, and on two rings out to the close band, so a lane
//   just off the site still shows. 2023 is asked for explicitly: EMODnet's default year, 2024, lost satellite AIS data
//   from June (its own note).
// Both services send CORS headers, so the page calls them directly. Sources, licences and URLs: catalogue/trusted.json
// "values". A failed call is "not checked"; no data in coverage is "no data here", never zero.
import * as turf from "./vendor/turf.js";
import { geometryDistanceKm } from "./datatools.js";

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// Up to n points spread over a feature: the point itself; points evenly along a line; the centre plus a grid inside a polygon.
export function samplePoints(feature, n = 25) {
  const g = feature.geometry;
  if (g.type === "Point") return [g.coordinates];
  if (/LineString/.test(g.type)) {
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    const segs = [];
    let total = 0;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const km = turf.distance(line[i - 1], line[i]);
      segs.push({ a: line[i - 1], b: line[i], start: total, km });
      total += km;
    }
    if (!segs.length || total === 0) return [lines[0][0]];
    const pts = [];
    for (let k = 0; k < n; k++) {
      const at = (total * k) / (n - 1);
      const s = segs.find((x) => at <= x.start + x.km) || segs.at(-1);
      const f = s.km ? Math.min(1, (at - s.start) / s.km) : 0;
      pts.push([s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f]);
    }
    return pts;
  }
  const inside = (p) => { try { return turf.booleanPointInPolygon(p, feature); } catch { return false; } };
  const pts = [turf.pointOnFeature(feature).geometry.coordinates];
  const [w, s, e, nn] = turf.bbox(feature);
  // A finer grid until enough points fall inside (thin or odd shapes), capped.
  for (const k of [5, 7, 10, 14]) {
    const grid = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const p = [w + ((i + 0.5) * (e - w)) / k, s + ((j + 0.5) * (nn - s)) / k];
      if (inside(p)) grid.push(p);
    }
    if (grid.length >= Math.min(n - 1, 12) || k === 14) {
      const step = Math.max(1, Math.ceil(grid.length / (n - 1)));
      for (let i = 0; i < grid.length && pts.length < n; i += step) pts.push(grid[i]);
      break;
    }
  }
  return pts;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const withTimeout = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

// Water depth over the footprint. Returns { depth, checked } (depth null when not checked or no sea).
export async function waterDepth({ site, source, fetchFn = globalThis.fetch, timeoutMs = 12000, now = () => new Date().toISOString() }) {
  const pts = samplePoints(site, 25);
  const base = { evidence: "water depth", dataset: source.title, publisher: source.publisher, licence: source.licence, checked_at: now() };
  try {
    const geometry = JSON.stringify({ points: pts.map((p) => [r2(p[0] * 1000) / 1000, r2(p[1] * 1000) / 1000]), spatialReference: { wkid: 4326 } });
    const url = `${source.url}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryMultipoint&returnFirstValueOnly=true&f=json`;
    const res = await fetchFn(url, { signal: withTimeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "service error");
    const vals = (j.samples || []).map((s) => parseFloat(s.value)).filter((v) => Number.isFinite(v) && v > -12000 && v < 9000);
    if (!vals.length) return { depth: null, checked: { ...base, result: "none in dataset", why: "no values returned for the site" } };
    const sea = vals.filter((v) => v < 0).map((v) => -v);
    const resM = (j.samples || []).map((s) => +s.resolution).find((x) => x > 0);
    const depth = {
      points: vals.length, sea_points: sea.length, land_points: vals.length - sea.length,
      typical_m: sea.length ? Math.round(median(sea)) : null, min_m: sea.length ? Math.round(Math.min(...sea)) : null, max_m: sea.length ? Math.round(Math.max(...sea)) : null,
      cell_m: resM ? Math.round(resM * 111320) : null,
      dataset: source.title, publisher: source.publisher, licence: source.licence, attribution: source.attribution, checked_at: base.checked_at,
    };
    return { depth, checked: { ...base, result: sea.length ? "features" : "none in dataset", count: sea.length, ...(sea.length ? {} : { why: "the site is above sea level in this model" }) } };
  } catch (e) {
    return { depth: null, checked: { ...base, result: "not checked", why: String(e.message || e).slice(0, 160) } };
  }
}

// Rough reading of EMODnet density (hours per km² a month), from sampled places (central North Sea under 0.1; Dover
// Strait about 5; Aberdeen approaches about 25). A judgement for Rob to correct.
export function trafficWord(h) {
  if (h == null) return "";
  if (h < 0.5) return "light";
  if (h < 5) return "moderate";
  if (h < 20) return "busy";
  return "very busy";
}

// Vessel traffic at and around the site. Returns { traffic, checked, evidence } (evidence: the busiest point sampled
// near the site, as an ordinary finding, when there's traffic).
export async function vesselTraffic({ site, closeKm = 10, source, fetchFn = globalThis.fetch, timeoutMs = 10000, concurrency = 8, now = () => new Date().toISOString() }) {
  const base = { evidence: "vessel traffic (AIS)", dataset: source.title, publisher: source.publisher, licence: source.licence, checked_at: now() };
  const year = source.year;
  const read = async (layer, p) => {
    const d = 0.002;
    const url = `${source.url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&SRS=EPSG:4326`
      + `&BBOX=${p[0] - d},${p[1] - d},${p[0] + d},${p[1] + d}&WIDTH=3&HEIGHT=3&X=1&Y=1&INFO_FORMAT=application/json${year ? `&TIME=${year}-01-01T00:00:00Z` : ""}`;
    const res = await fetchFn(url, { signal: withTimeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t = await res.text();
    if (!t.trim().startsWith("{")) throw new Error("service exception");
    const f = JSON.parse(t).features?.[0];
    const v = f ? +Object.values(f.properties || {})[0] : NaN;
    return Number.isFinite(v) && v >= 0 ? v : null; // null = no data here (outside coverage)
  };
  const pool = async (jobs) => {
    const out = new Array(jobs.length);
    let i = 0, failed = 0, lastErr = null;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { out[k] = undefined; failed++; lastErr = e; } }
    }));
    return { out, failed, lastErr };
  };
  const sitePts = samplePoints(site, 9);
  const centre = turf.pointOnFeature(site).geometry.coordinates;
  const ring = [];
  // Rings out from the site's edge (roughly: the centre's distance to the nearest side of its bounding box), at half the
  // close band and the close band, so every ring point is within the close band of the edge.
  const [w, s, e, n] = turf.bbox(site);
  const reach = Math.min(50, ...[[w, centre[1]], [e, centre[1]], [centre[0], s], [centre[0], n]].map((c) => turf.distance(centre, c)));
  const edge = site.geometry.type === "Point" ? 0 : reach;
  for (const km of [closeKm / 2, closeKm]) for (let b = 0; b < 360; b += 30) ring.push(turf.destination(centre, edge + km, b).geometry.coordinates);
  const pts = [...sitePts, ...ring];
  const all = await pool(pts.map((p) => () => read(source.layers.all, p)));
  if (all.failed === pts.length) return { traffic: null, evidence: [], checked: { ...base, result: "not checked", why: String(all.lastErr?.message || "no answer").slice(0, 160) } };
  const got = pts.map((p, k) => ({ p, v: all.out[k], site: k < sitePts.length })).filter((x) => x.v != null);
  if (!got.length) return { traffic: null, evidence: [], checked: { ...base, result: "none in dataset", why: `no data here: ${source.coverage_note}` } };
  const atSite = got.filter((x) => x.site);
  const siteMax = atSite.length ? atSite.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const busiest = got.reduce((a, b) => (b.v > a.v ? b : a));
  // Measured from the site's edge, like every other finding.
  const busiestKm = busiest.site ? 0 : r1(geometryDistanceKm(site.geometry, { type: "Point", coordinates: busiest.p }) ?? turf.distance(centre, busiest.p));
  // Vessel types at the busiest point near the site.
  const types = Object.entries(source.layers.types);
  const tv = await pool(types.map(([, layer]) => () => read(layer, busiest.p)));
  const byType = Object.fromEntries(types.map(([k], i) => [k, tv.out[i] == null ? null : r2(tv.out[i])]).filter(([, v]) => v != null));
  const unit = "hours per km² a month";
  const traffic = {
    unit, year, at_site: siteMax ? r2(siteMax.v) : null, at_site_word: siteMax ? trafficWord(siteMax.v) : "",
    busiest: { value: r2(busiest.v), word: trafficWord(busiest.v), distance_km: busiestKm, within_km: closeKm, by_type: byType },
    points: got.length, partly_failed: all.failed ? `${all.failed} of ${pts.length} samples failed` : null,
    dataset: source.title, publisher: source.publisher, licence: source.licence, attribution: source.attribution, checked_at: base.checked_at,
  };
  // A finding on the map only when it's more than light traffic; light traffic is the card's line, not a finding.
  const evidence = busiest.v >= 0.5 ? [{
    name: `Vessel traffic ${r2(busiest.v)} h/km² a month (${trafficWord(busiest.v)}, AIS ${year})`, type: "vessel traffic density (AIS)",
    geometry: { type: "Point", coordinates: busiest.p }, distance_km: busiestKm,
    source: { title: source.title, publisher: source.publisher, licence: source.licence },
    extra: { hours_per_km2_month: r2(busiest.v), year, ...Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v])), note: "busiest of the points sampled near the site, not the busiest cell" },
  }] : [];
  return { traffic, evidence, checked: { ...base, result: "features", count: got.length } };
}

const typeLine = (bt) => Object.entries(bt || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");

// The run card's short line: depth and traffic only, sources named briefly (the full provenance is under
// "What was checked" and in the run record).
export function seaShort(sea, { units = (km) => `${km} km` } = {}) {
  const out = [];
  const d = sea?.depth;
  if (d?.typical_m != null) out.push(`Water depth about ${d.typical_m} m${d.min_m !== d.max_m ? `, ${d.min_m}–${d.max_m} m across the site` : ""} (NOAA).`);
  const t = sea?.traffic;
  if (t) {
    const at = t.at_site == null ? "no reading on the site" : `${t.at_site_word} on the site (${t.at_site} h/km² a month)`;
    const near = t.busiest.distance_km > 0 && t.busiest.word !== t.at_site_word ? `, ${t.busiest.word} ${units(t.busiest.distance_km)} away (${t.busiest.value})` : "";
    out.push(`Vessel traffic: ${at}${near} (AIS ${t.year}, EMODnet).`);
  }
  return out.join(" ");
}

// One line each for the analyst's baseline and the run record (depths in metres, traffic in EMODnet's own unit).
export function seaLines(sea, { units = (km) => `${km} km` } = {}) {
  const out = [];
  const d = sea?.depth;
  if (d?.typical_m != null) {
    const range = d.min_m !== d.max_m ? ` (${d.min_m}–${d.max_m} m across the ${d.points > 1 ? `${d.points} points sampled` : "site"})` : "";
    out.push(`Water depth about ${d.typical_m} m${range}${d.land_points ? `; ${d.land_points} point${d.land_points === 1 ? "" : "s"} above sea level` : ""}. ${d.dataset} (${d.publisher}).`);
  }
  const t = sea?.traffic;
  if (t) {
    const at = t.at_site == null ? "no reading on the site" : `${t.at_site} ${t.unit} on the site (${t.at_site_word})`;
    const near = t.busiest.distance_km > 0 ? `; busiest point sampled within ${units(t.busiest.within_km)}: ${t.busiest.value} (${t.busiest.word}) at ${units(t.busiest.distance_km)}` : "";
    const types = typeLine(t.busiest.by_type);
    out.push(`Vessel traffic (AIS, ${t.year} annual average): ${at}${near}${types ? `; by type there: ${types}` : ""}. ${t.dataset} (${t.publisher}).`);
  }
  return out;
}
