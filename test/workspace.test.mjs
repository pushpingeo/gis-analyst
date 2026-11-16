// Tests for the workspace's reference lookups and shape operations. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as G from "../js/geometry.js";
import * as R from "../js/reference.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));

// ---- geometry ----
await test("square of 3 km² is 3 km² and centred", () => {
  const sq = G.squareAround([1.97, 57.0], 3);
  near(turf.area(sq) / 1e6, 3, 0.01, "area");
  const c = turf.centroid(sq).geometry.coordinates;
  near(turf.distance(c, [1.97, 57.0]), 0, 0.01, "centre");
});

await test("square is square on the ground at high latitude", () => {
  const sq = G.squareAround([20, 70], 4);
  const [a, b, c] = sq.geometry.coordinates[0];
  near(turf.distance(a, b), turf.distance(b, c), 0.01, "sides");
});

await test("rotate keeps area and centre", () => {
  const sq = G.squareAround([-3.6, 56], 2);
  const r = G.rotate(sq, 30);
  near(turf.area(r), turf.area(sq), 1, "area m²");
  assert.match(G.describeChange(sq, r), /reshaped/);
});

await test("resizeTo hits the target area and length", () => {
  const sq = G.squareAround([36.98, -16.84], 3);
  near(turf.area(G.resizeTo(sq, 5)) / 1e6, 5, 0.01, "polygon");
  const ln = turf.lineString([[-2, 57], [0, 58]]);
  near(turf.length(G.resizeTo(ln, 50)), 50, 0.2, "line");
  assert.throws(() => G.resizeTo(turf.point([0, 0]), 2));
});

await test("circleAround by area", () => {
  near(turf.area(G.circleAround([0, 51.5], { areaKm2: 10 })) / 1e6, 10, 0.05, "area");
});

await test("describeChange reports moves, area and vertices", () => {
  const sq = G.squareAround([0, 51.5], 1);
  assert.match(G.describeChange(sq, G.move(sq, 2, 90)), /moved 2 km east/);
  assert.match(G.describeChange(sq, G.resizeTo(sq, 2)), /area 1 → 2 km²/);
  const five = turf.polygon([[...sq.geometry.coordinates[0].slice(0, 4), [0, 51.52], sq.geometry.coordinates[0][0]]]);
  assert.match(G.describeChange(sq, five), /1 vertex added/);
});

// ---- reference ----
await test("country lookup: on land, offshore", async () => {
  const countries = await ref.get("countries");
  assert.equal(R.countryAt(countries, [-3.6, 55.976])?.name, "United Kingdom");
  assert.equal(R.countryAt(countries, [36.98, -16.84])?.name, "Mozambique");
  assert.equal(R.countryAt(countries, [1.97, 57.0]), null);
});

await test("coast distance: Linlithgow is a few km from the Forth", async () => {
  const d = R.coastDistanceKm(await ref.get("coastline"), [-3.6, 55.976]);
  assert.ok(d > 1 && d < 8, String(d));
});

await test("Jackdaw area: offshore, local scale, far from the coast", async () => {
  const d = await R.describe(ref, G.squareAround([1.97, 57.0], 3));
  assert.equal(d.scale, "local");
  assert.equal(d.offshore, true);
  assert.ok(d.coast_km > 150, String(d.coast_km));
  assert.match(R.summaryLine(d), /^3 km², offshore/);
});

await test("scale from size", () => {
  assert.equal(R.deduceScale(turf.point([0, 0])), "local");
  assert.equal(R.deduceScale(G.squareAround([0, 10], 400 * 400)), "regional");
  assert.equal(R.deduceScale(turf.bboxPolygon([32, -26, 40, -11])), "global");
});

await test("a shape across a border names both countries", async () => {
  const d = await R.describe(ref, turf.lineString([[7.55, 47.45], [7.7, 47.7]])); // Basel to Lörrach
  assert.ok(d.countries.includes("Switzerland") && d.countries.includes("Germany"), d.countries.join());
});

console.log(`${passed} workspace tests passed`);
