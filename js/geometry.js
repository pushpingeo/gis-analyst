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

// ---- local projection --------------------------------------------------------------
// Rotating and resizing happen on a flat map centred on the shape (azimuthal equidistant), never on
// longitude/latitude or Web Mercator, so a large shape keeps its true shape and size on the ground.
const R = 6371.0088; // mean Earth radius in km, as Turf uses
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

export function toLocal([lon, lat], [lon0, lat0]) {
  const p = rad(lat), p0 = rad(lat0), dl = rad(lon - lon0);
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
  const k = c < 1e-12 ? 1 : c / Math.sin(c);
  return [R * k * Math.cos(p) * Math.sin(dl), R * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl))];
}

export function fromLocal([x, y], [lon0, lat0]) {
  const p0 = rad(lat0), rho = Math.hypot(x, y);
  if (rho < 1e-12) return [lon0, lat0];
  const c = rho / R;
  const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho);
  const lon = rad(lon0) + Math.atan2(x * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
  return [((deg(lon) + 540) % 360) - 180, deg(lat)];
}

// Apply fn([x, y]) -> [x, y] to every vertex, in a local projection centred on `centre`.
function mapLocal(feature, centre, fn) {
  const f = clone(feature);
  const walk = (c) => (typeof c[0] === "number" ? fromLocal(fn(toLocal(c, centre)), centre) : c.map(walk));
  f.geometry.coordinates = walk(f.geometry.coordinates);
  return f;
}

// Rotate about the centroid, clockwise in degrees.
export function rotate(feature, degrees) {
  if (feature.geometry.type === "Point") return clone(feature);
  const t = rad(degrees), cos = Math.cos(t), sin = Math.sin(t);
  return mapLocal(feature, anchorOf(feature), ([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
}

// Scale lengths by a factor about the centroid (area changes by factor²).
export function scaleBy(feature, factor) {
  if (feature.geometry.type === "Point") return clone(feature);
  return mapLocal(feature, anchorOf(feature), ([x, y]) => [x * factor, y * factor]);
}

// Resize a polygon to a target area (km²), or a line to a target length (km), keeping its shape and centre.
// A second pass corrects the small difference between the flat map and the curved Earth on very large shapes.
export function resizeTo(feature, target) {
  const g = feature.geometry.type;
  const size = /Polygon/.test(g) ? (f) => turf.area(f) / 1e6 : /LineString/.test(g) ? (f) => turf.length(f) : null;
  if (!size) throw new Error("A point has no size to change.");
  const power = /Polygon/.test(g) ? 0.5 : 1;
  let f = scaleBy(feature, (target / size(feature)) ** power);
  f = scaleBy(f, (target / size(f)) ** power);
  return f;
}

// Move by a distance (km) along a bearing (degrees from north).
export function move(feature, km, bearing) {
  return turf.transformTranslate(clone(feature), km, bearing);
}

// A rectangle of the given width and height (km) centred on a point, sides north–south and east–west
// unless rotated (degrees clockwise). Built on the ground, so it's true to size anywhere.
export function rectangleAround(lonlat, widthKm, heightKm, rotation = 0) {
  const w = widthKm / 2, h = heightKm / 2;
  const ring = [[-w, -h], [w, -h], [w, h], [-w, h], [-w, -h]].map((xy) => fromLocal(xy, lonlat));
  const r = turf.polygon([ring]);
  return rotation ? rotate(r, rotation) : r;
}

// A square of the given area (km²) centred on a point.
export function squareAround(lonlat, areaKm2, rotation = 0) {
  const side = Math.sqrt(areaKm2);
  return rectangleAround(lonlat, side, side, rotation);
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

// Removes interior rings (holes) from a polygon or multipolygon. Returns the new feature, how many holes, and the area they add.
export function fillHoles(feature) {
  const g = feature.geometry;
  if (!g || !/Polygon/.test(g.type)) return { feature, holes: 0, addedKm2: 0 };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const holes = polys.reduce((n, p) => n + p.length - 1, 0);
  if (!holes) return { feature, holes: 0, addedKm2: 0 };
  const outer = polys.map((p) => [p[0]]);
  const geometry = g.type === "Polygon" ? { type: "Polygon", coordinates: outer[0] } : { type: "MultiPolygon", coordinates: outer };
  const out = { ...feature, geometry };
  return { feature: out, holes, addedKm2: (turf.area(out) - turf.area(feature)) / 1e6 };
}

// Keeps the largest part of a multipolygon (the map editor holds one polygon). Returns what was dropped.
export function largestPart(feature) {
  const g = feature.geometry;
  if (!g || g.type !== "MultiPolygon" || g.coordinates.length < 2) return { feature, dropped: 0, droppedKm2: 0 };
  const parts = g.coordinates.map((c) => ({ c, a: turf.area(turf.polygon(c)) })).sort((x, y) => y.a - x.a);
  return { feature: { ...feature, geometry: { type: "Polygon", coordinates: parts[0].c } }, dropped: parts.length - 1, droppedKm2: parts.slice(1).reduce((n, p) => n + p.a, 0) / 1e6 };
}
