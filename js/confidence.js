// Place-finding confidence, worked out in code from the evidence, not chosen by the model.
// v3's evaluation showed the model's own "high" was less reliable than its "medium": gazetteer
// points 10–40 km out were called high, once even after a distance check had failed.
//
// The rules (skill v4):
//   1. Start from where the anchor came from and how it matched the asset:
//      - an authoritative layer (from the atlas) matched by name: high
//      - Wikidata or OpenStreetMap, matched by name and type, or a feature of the right type found where the clues point: medium
//      - a settlement or region, a name-only match (type unknown or wrong), or nothing: low
//   2. Checks: each clue the description gives ("village X is 25 km east of the site") is measured
//      from the place built. Any failed check caps confidence at low.
//   3. A gazetteer match with at least one passing check, or a type match with two, rises to high.
//   4. Placed by an offset from a reference (the asset itself not found): at most medium.
//   5. A large feature (salt flat, reservoir, concession, district…) given as a point: at most medium.
import * as turf from "./vendor/turf.js";

const GAZETTEER = new Set(["wikidata", "osm-nominatim", "osm-overpass"]);
const SETTLEMENT = /\b(city|town|village|hamlet|suburb|locality|settlement|municipality|populated place|neighbourhood|quarter|county|district|province|state|region|administrative)\b/i;
const LARGE = /\b(county|council|administrative|boundary|municipality|state|salar|salt (flat|pan|lake)|lake|reservoir|basin|bay|lagoon|concession|licen[cs]e|lease|district|region|province|island|forest|park|reserve|desert|valley|plateau|mountain range|field)\b/i;
const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
const LEVELS = ["low", "medium", "high"];

// named_place: the person asked for this place itself ("5 km round Linlithgow Palace", "block 30/2", "Fife"),
// so finding it by name is the whole job. The others are for finding an asset (a mine, a dam, a solar farm).
export const MATCHES = ["named_place", "name_and_type", "type_near_clues", "name_only", "settlement_or_region", "none"];

export function tierOf(cand) {
  if (!cand) return "settlement";
  const id = cand.source?.id || "";
  if (id === "natural-earth") return "settlement";
  // Atlas features carry whether their publisher is a government or intergovernmental body; others (a university's
  // copy, a third-party summary) count like a gazetteer. Hand-picked anchors (NSTA, Crown Estate) are authoritative.
  if (cand.source?.atlas_id) return cand.source.authoritative === false ? "gazetteer" : "authoritative";
  if (!GAZETTEER.has(id) && id) return "authoritative";
  return "gazetteer";
}

const angleDiff = (a, b) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d; };
const toBearing = (dir) => (dir == null ? null : typeof dir === "number" ? dir : COMPASS[String(dir).trim().toUpperCase()] ?? null);

// One check: the feature `target` should lie `expected_km` from the site, in `direction` (travelling from the site to it).
export function runCheck(siteLonLat, target, { expected_km, direction }) {
  const actual = turf.distance(siteLonLat, target.lonlat);
  const tol = Math.max(3, 0.35 * expected_km);
  const distOk = Math.abs(actual - expected_km) <= tol;
  const want = toBearing(direction);
  const got = (turf.bearing(siteLonLat, target.lonlat) + 360) % 360;
  // Bearings mean little at very short range, so only test them beyond 2 km.
  const dirOk = want == null || actual < 2 || angleDiff(want, got) <= 45;
  const pts = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], pt = (deg) => pts[Math.round(deg / 45) % 8];
  const km = Math.round(actual * 10) / 10, who = target.name || target.id;
  return {
    against: who, expected_km, actual_km: km,
    // Spelled out both ways, because "X is SE of the site" and "the site is SE of X" are easy to swap.
    reads: `The site is ${km} km ${pt((got + 180) % 360)} of ${who}; ${who} is ${pt(got)} of the site.`,
    ...(want != null ? { direction: String(direction), actual_bearing_deg: Math.round(got) } : {}),
    pass: distOk && dirOk,
    ...(distOk && dirOk ? {} : { why: !distOk ? `${Math.round(actual * 10) / 10} km, not about ${expected_km} km` : `bearing ${Math.round(got)}°, not ${direction}` }),
  };
}

// cand: the anchor candidate (or null for an existing place); match: one of MATCHES;
// checks: results of runCheck; offset: whether the place was moved from the anchor; shape; anchorType.
export function rateConfidence({ cand, match = "none", checks = [], offset = false, shape }) {
  const rules = [];
  const tier = tierOf(cand);
  let level;
  // An asset "found" as a town or village is the town, not the asset (Sierra Rutile in v3: a town sharing the project area's name).
  if (match === "name_and_type" && looksLikeSettlement(cand)) { match = "settlement_or_region"; rules.push("the match is a settlement, not the asset"); }
  if (match === "named_place") {
    level = tier === "settlement" && cand?.source?.id === "natural-earth" ? 1 : 2;
    rules.push(level === 2 ? "the place the person named, found by name: high" : "the place the person named, from a coarse town list: medium");
  } else if (match === "settlement_or_region" || match === "none" || match === "name_only" || tier === "settlement") {
    level = 0;
    rules.push(match === "name_only" ? "matched by name only, not by type: low" : "anchored on a settlement, region or nothing specific: low");
  } else if (tier === "authoritative") {
    level = 2; rules.push(`matched in an authoritative layer (${cand.source.publisher}): high`);
  } else {
    level = 1; rules.push(match === "type_near_clues" ? "a feature of the right type where the clues point: medium" : "matched by name and type in Wikidata or OpenStreetMap: medium");
  }
  const passed = checks.filter((c) => c.pass).length, failed = checks.length - passed;
  if (level === 1 && failed === 0 && passed >= (match === "type_near_clues" ? 2 : 1)) { level = 2; rules.push(`${passed} distance check${passed > 1 ? "s" : ""} passed: high`); }
  if (level === 0 && offset && failed === 0 && passed >= 1) { level = 1; rules.push("placed by offset, confirmed by a passing check: medium"); }
  if (offset && level > 1) { level = 1; rules.push("placed by an offset from a reference, not found itself: at most medium"); }
  const type = `${cand?.type || ""} ${cand?.name || ""}`;
  if (shape === "point" && LARGE.test(type) && level > 1) { level = 1; rules.push("a point for a large feature: the site could be anywhere in it, so at most medium"); }
  if (failed) { level = 0; rules.push(`${failed} check${failed > 1 ? "s" : ""} failed: low`); }
  if (!checks.length && level === 1) rules.push("no distance checks given, so it stays medium");
  return { confidence: LEVELS[level], rules };
}


export const looksLikeSettlement = (cand) => SETTLEMENT.test(cand?.type || "");
