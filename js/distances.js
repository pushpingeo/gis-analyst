// Screening distances that fit the project: defaults from the asset type and size (catalogue/distances.json, a
// draft table Rob corrects), the person's own distances when they give them, and the band of any distance.
// No DOM, so the page, the scripts and the tests share it.

export const ASSET_TYPES = ["solar", "wind-onshore", "wind-offshore", "hydro", "thermal", "substation", "mine", "oil-gas-onshore",
  "platform", "oil-gas-field", "exploration-block", "seismic-survey", "pipeline-cable", "road-rail", "port-terminal", "other"];

// Tools fetch at most 50 km from a site's edge.
export const MAX_KM = 50;
const r1 = (v) => Math.round(v * 10) / 10;

// table: catalogue/distances.json. site: { asset_type, offshore, capacity_mw, tip_height_m, area_km2 }.
// person: { near, close, wider } (any of them) when the person has said.
export function chooseDistances(table, site = {}, person = {}) {
  const setting = site.offshore ? "offshore" : "onshore";
  const entry = table.assets?.[site.asset_type];
  const reasons = [];
  let base = entry?.[setting];
  if (!base) {
    base = table.fallback[setting];
    reasons.push(entry ? `no ${setting} default for ${entry.label}, so the general ${setting} one` : `${table.fallback[setting].reason}${site.asset_type && site.asset_type !== "other" ? ` (no entry for "${site.asset_type}")` : ""}`);
  } else reasons.push(`default for ${entry.label} ${setting}: ${base.reason}`);
  const d = { near: base.near, close: base.close, wider: base.wider, footprint_km: base.footprint_km };
  // A general screen of an area: distances follow its size (a 2.3 ha plot shouldn't look 20 km out).
  if (!entry && site.area_km2 > 0) {
    const rule = (table.fallback_by_size?.[setting] || []).find((r) => site.area_km2 < r.below_km2);
    if (rule) { Object.assign(d, pick(rule)); reasons.splice(0, reasons.length, rule.reason); }
  }
  for (const s of entry?.smaller || []) if (site.capacity_mw != null && s.below_mw != null && site.capacity_mw < s.below_mw) { Object.assign(d, pick(s)); reasons.push(s.reason); }
  for (const s of entry?.larger || []) {
    const hit = (s.mw != null && site.capacity_mw != null && site.capacity_mw >= s.mw) || (s.area_km2 != null && site.area_km2 != null && site.area_km2 >= s.area_km2);
    if (hit) { Object.assign(d, pick(s)); reasons.push(s.reason); }
  }
  if (entry?.tip_height && site.tip_height_m) {
    d.near = Math.max(entry.tip_height.min_near, r1(site.tip_height_m * entry.tip_height.near_per_m));
    reasons.push(`${entry.tip_height.reason}: ${site.tip_height_m} m tip height gives ${d.near} km`);
  }
  let setBy = "default";
  const given = Object.fromEntries(["near", "close", "wider"].filter((k) => Number.isFinite(+person?.[k]) && person[k] !== null && person[k] !== "").map((k) => [k, +person[k]]));
  if (Object.keys(given).length) {
    Object.assign(d, given); setBy = "person";
    reasons.unshift(`you set ${Object.entries(given).map(([k, v]) => `${k} ${v} km`).join(", ")}`);
  }
  // Keep the bands in order and within reach of the tools.
  d.wider = Math.min(MAX_KM, Math.max(d.wider, 0.5));
  if (d.wider === MAX_KM && (given.wider ?? 0) > MAX_KM) reasons.push(`wider band capped at ${MAX_KM} km, the furthest the tools fetch`);
  d.close = Math.min(d.close, d.wider);
  d.near = Math.min(d.near, d.close);
  return { ...d, set_by: setBy, asset_label: entry?.label || "site", setting, reasons, table_version: table.version };
}
const pick = (s) => Object.fromEntries(["near", "close", "wider", "footprint_km"].filter((k) => s[k] != null).map((k) => [k, s[k]]));

// The band a distance falls in, for these distances. 0 = on site.
export function bandFor(km, d) {
  if (km == null) return "unknown";
  if (km <= 0) return "on site";
  if (km <= d.near) return "near";
  if (km <= d.close) return "close";
  if (km <= d.wider) return "wider";
  return "beyond";
}

// One line for the card and the conversation: "near 2 km · close 10 km · wider 50 km (default for offshore oil field)".
export function distancesLine(d) {
  return `near ${d.near} km · close ${d.close} km · wider ${d.wider} km (${d.set_by === "person" ? "set by you" : `default for ${d.asset_label} ${d.setting}`})`;
}
