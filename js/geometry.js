// Deterministic shape operations: the agent and the editing buttons both use these, so the model never
// does geometry in its head. No DOM, so they run in the page and in the tests.
import * as turf from "./vendor/turf.js";

const clone = (f) => JSON.parse(JSON.stringify(f));

// Coordinates rounded to 7 decimals (about 1 cm), which is what the drawing tools accept.
export function roundCoords(feature, digits = 7) {
  const k = 10 ** digits;
  const r = (c) => (typeof c[0] === "number" ? c.map((v) => Math.round(v * k) / k) : c.map(r));
  const f = clone(feature);
  f.geometry.coordinates = r(f.geometry.coordinates);
  return f;
}
const anchorOf = (f) => turf.centroid(f).geometry.coordinates;

// Rotate about the centroid, clockwise in degrees.
export function rotate(feature, degrees) {
  if (feature.geometry.type === "Point") return clone(feature);
  return turf.transformRotate(clone(feature), degrees, { pivot: anchorOf(feature) });
}

// Scale lengths by a factor about the centroid (area changes by factor²).
export function scaleBy(feature, factor) {
  if (feature.geometry.type === "Point") return clone(feature);
  return turf.transformScale(clone(feature), factor, { origin: anchorOf(feature) });
}

// Resize a polygon to a target area (km²), or a line to a target length (km), keeping its shape and centre.
export function resizeTo(feature, target) {
  const g = feature.geometry.type;
  if (g === "Polygon" || g === "MultiPolygon") return scaleBy(feature, Math.sqrt(target / (turf.area(feature) / 1e6)));
  if (g === "LineString" || g === "MultiLineString") return scaleBy(feature, target / turf.length(feature));
  throw new Error("A point has no size to change.");
}

// Move by a distance (km) along a bearing (degrees from north).
export function move(feature, km, bearing) {
  return turf.transformTranslate(clone(feature), km, bearing);
}

// A square of the given area (km²) centred on a point, sides aligned north–south unless rotated.
export function squareAround(lonlat, areaKm2, rotation = 0) {
  const half = Math.sqrt(areaKm2) / 2;
  const n = turf.destination(lonlat, half, 0).geometry.coordinates[1];
  const s = turf.destination(lonlat, half, 180).geometry.coordinates[1];
  // East–west offset measured at the centre latitude, so the square is square on the ground.
  const dLon = turf.destination(lonlat, half, 90).geometry.coordinates[0] - lonlat[0];
  const sq = turf.polygon([[[lonlat[0] - dLon, s], [lonlat[0] + dLon, s], [lonlat[0] + dLon, n], [lonlat[0] - dLon, n], [lonlat[0] - dLon, s]]]);
  return rotation ? rotate(sq, rotation) : sq;
}

// A circle of the given area (km²) or radius (km) around a point.
export function circleAround(lonlat, { areaKm2, radiusKm }) {
  const r = radiusKm ?? Math.sqrt(areaKm2 / Math.PI);
  return turf.circle(lonlat, r, { steps: 96, units: "kilometers" });
}

// Compares two versions of a shape and says what changed, for the conversation ("rotated 20°, now 3.4 km²").
export function describeChange(before, after) {
  const out = [];
  const g = after.geometry.type;
  const c0 = anchorOf(before), c1 = anchorOf(after);
  const moved = turf.distance(c0, c1);
  if (moved > 0.005) out.push(`moved ${fmt(moved)} km ${compass(turf.rhumbBearing(c0, c1))}`);
  if (g === "Polygon" || g === "MultiPolygon") {
    const a0 = turf.area(before) / 1e6, a1 = turf.area(after) / 1e6;
    if (Math.abs(a1 - a0) / a0 > 0.005) out.push(`area ${fmt(a0)} → ${fmt(a1)} km²`);
  } else if (g === "LineString" || g === "MultiLineString") {
    const l0 = turf.length(before), l1 = turf.length(after);
    if (Math.abs(l1 - l0) / l0 > 0.005) out.push(`length ${fmt(l0)} → ${fmt(l1)} km`);
  }
  const v0 = vertexCount(before), v1 = vertexCount(after);
  if (v1 !== v0) {
    const k = Math.abs(v1 - v0);
    out.push(`${k} ${k > 1 ? "vertices" : "vertex"} ${v1 > v0 ? "added" : "removed"}`);
  }
  else if (!out.length && JSON.stringify(before.geometry) !== JSON.stringify(after.geometry)) out.push("reshaped");
  return out.join(", ");
}

export function vertexCount(f) {
  const g = f.geometry;
  if (g.type === "Point") return 1;
  if (g.type === "LineString") return g.coordinates.length;
  if (g.type === "Polygon") return g.coordinates.reduce((n, r) => n + r.length - 1, 0);
  return JSON.stringify(g.coordinates).split("],[").length;
}

const fmt = (v) => (v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, "");
function compass(b) {
  const pts = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return pts[Math.round((((b % 360) + 360) % 360) / 45) % 8];
}
