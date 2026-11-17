// Tests for the catalogue tools (find_data, get_data) and confidence inherited from a place, with the atlas faked.
// The Mars case (17 Nov): a platform point, a 20 km circle round it, then "any thermal anomalies?".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { createPlaceTools } from "../js/placetools.js";
import { keyAttributes, geometryDistanceKm } from "../js/datatools.js";
import { rateConfidence } from "../js/confidence.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));

const MARS = [-89.2229, 28.1698];
const VIIRS = { id: "cddf4d1585ae354c", title: "Satellite (VIIRS) Thermal Hotspots and Fire Activity", publisher: "NASA", publisher_type: "curated-collection", coverage: "global", capabilities: ["query", "time"], licence: "This work is licensed under the Esri Master License Agreement. View Summary | View Terms of Use" };
const WMS = { id: "wms1", title: "Thermal Stress Percentage", publisher: "NOAA", capabilities: ["render"], licence: "x" };
const atlasCalls = [];
let overloadOnce = false;
async function atlas(tool, args) {
  atlasCalls.push([tool, args]);
  if (overloadOnce) { overloadOnce = false; throw new Error("atlas: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window."); }
  if (tool === "find_datasets") {
    if (/viirs|thermal/i.test(args.text)) return { matches: 3, results: [WMS, VIIRS, { ...VIIRS, id: "dup" }] };
    return { matches: 0, results: [] };
  }
  if (tool === "fetch_features") {
    if (args.id === "broken") throw new Error("atlas: Couldn't fetch features");
    // Three detections: one 3 km from the platform, one 15 km, one 40 km (outside a 20 km circle).
    const at = (km, brg) => turf.destination(MARS, km, brg).geometry.coordinates;
    return { returned: 3, features: [
      { type: "Feature", geometry: { type: "Point", coordinates: at(15, 90) }, properties: { OBJECTID: 2, acq_date: 1763337600000, confidence: "nominal", frp: 3.1, satellite: "N" } },
      { type: "Feature", geometry: { type: "Point", coordinates: at(3, 0) }, properties: { OBJECTID: 1, acq_date: 1763337600000, confidence: "high", frp: 12.4, satellite: "N", daynight: "N" } },
      { type: "Feature", geometry: { type: "Point", coordinates: at(40, 180) }, properties: { OBJECTID: 3, acq_date: 1763337600000 } },
    ] };
  }
  throw new Error(`unexpected ${tool}`);
}

function host() {
  const list = [];
  let shown = [];
  return {
    ref, anchors: [], headers: {}, list, atlas, fetchFn: async () => ({ ok: true, json: async () => [] }),
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: () => "",
    onCandidates: (l) => { shown = l; },
    shown: () => shown,
    addPlace({ feature, origin }) { const p = { name: `${feature.geometry.type === "Point" ? "Point" : "Area"} ${list.length + 1}`, feature, origin, status: "proposed", edits: [] }; list.push(p); return p; },
    view: () => [-90, 27.5, -88.5, 28.8],
  };
}

await test("a circle built on a high-confidence point is high confidence (was low)", async () => {
  const h = host();
  h.list.push({ name: "Point 1", feature: turf.point(MARS), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const r = await t.exec("make_place", { anchor: "Point 1", shape: "circle", radius_km: 20, words: "20 km", match: "settlement_or_region", reason: "round the platform" });
  assert.equal(r.confidence, "high", JSON.stringify(r.why));
  assert.match(r.why[0], /built on Point 1/);
});

await test("inherited confidence: drawn places count as high, offsets cap at medium, failed checks at low", () => {
  assert.equal(rateConfidence({ inherit: { name: "Area 1", drawn: true } }).confidence, "high");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "medium" } }).confidence, "medium");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "high" }, offset: true }).confidence, "medium");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "high" }, checks: [{ pass: false }] }).confidence, "low");
  // A medium place doesn't rise to high from checks on a shape built round it.
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "medium" }, checks: [{ pass: true, tight: true, direction: "N" }] }).confidence, "medium");
});

await test("find_data: fetchable first, duplicates folded, ids D1…, licence shortened", async () => {
  const h = host();
  const t = createPlaceTools(h);
  const r = await t.exec("find_data", { text: "VIIRS" });
  assert.equal(r.datasets.length, 2);
  assert.equal(r.datasets[0].title, VIIRS.title);
  assert.equal(r.datasets[0].can_fetch, true);
  assert.equal(r.datasets[0].time_aware, true);
  assert.equal(r.datasets[1].can_fetch, false);
  assert.match(r.datasets[0].id, /^D\d+$/);
  assert.match(r.datasets[0].licence, /Esri Master License Agreement \(check terms/);
  assert.match(r.searched.area, /map view/);
});

await test("find_data says what was searched when nothing matches, and retries once when the atlas is overloaded", async () => {
  const h = host();
  const t = createPlaceTools(h);
  overloadOnce = true;
  const r = await t.exec("find_data", { text: "seismic" });
  assert.equal(r.datasets.length, 0);
  assert.match(r.note, /No dataset titles or publishers contain "seismic"/);
  assert.match(r.note, /Try other words/);
});

await test("get_data: features within the circle, measured from its edge, nearest first, dates readable", async () => {
  const h = host();
  h.list.push({ name: "Area 1", feature: turf.circle(MARS, 20, { units: "kilometers", steps: 64 }), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const f = await t.exec("find_data", { text: "VIIRS", area: "Area 1" });
  const r = await t.exec("get_data", { dataset: f.datasets[0].id, place: "Area 1" });
  assert.equal(r.inside_or_touching, 2);
  assert.equal(r.within_distance, 2);
  assert.equal(r.nearest[0].details.confidence, "high");
  assert.match(r.nearest[0].details.acq_date, /^2025-11-17|^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.match(r.time_note, /recent detections only/);
  assert.equal(r.publisher, "NASA");
  assert.ok(h.shown().length === 2 && h.shown()[0].id.startsWith("C"), "shown on the map as candidates");
  // The bbox asked for covers the circle.
  const box = atlasCalls.filter(([tool]) => tool === "fetch_features").at(-1)[1].bbox;
  assert.ok(box[0] < -89.4 && box[2] > -89.03, box.join(","));
  // From the point instead, with a 20 km reach: the 15 km one too, the 40 km one not.
  h.list.push({ name: "Point 2", feature: turf.point(MARS), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const r2 = await t.exec("get_data", { dataset: f.datasets[0].id, place: "Point 2", within_km: 20 });
  assert.deepEqual(r2.nearest.map((c) => Math.round(c.distance_km)), [3, 15]);
});

await test("get_data: a picture-only dataset or a failed service is 'not checked', never 'nothing found'", async () => {
  const h = host();
  h.list.push({ name: "Area 1", feature: turf.circle(MARS, 20, { units: "kilometers" }), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const f = await t.exec("find_data", { text: "thermal" });
  const wms = f.datasets.find((d) => !d.can_fetch);
  assert.match((await t.exec("get_data", { dataset: wms.id, place: "Area 1" })).not_checked, /picture service/);
  t.datasets.set("D99", { id: "broken", title: "Broken", publisher: "X", capabilities: ["query"] });
  assert.match((await t.exec("get_data", { dataset: "D99", place: "Area 1" })).not_checked, /didn't answer/);
  await assert.rejects(() => t.exec("get_data", { dataset: "D42", place: "Area 1" }), /Use find_data first/);
});

await test("catalogue areas: country aliases, the USA's main part (not the world), seas by name", async () => {
  const t = createPlaceTools(host());
  const boxes = [];
  for (const area of ["United States", "USA", "Gulf of America", "the North Sea", "United Kingdom"]) {
    await t.exec("find_data", { text: "VIIRS", area });
    const [, args] = atlasCalls.filter(([tool]) => tool === "find_datasets").at(-1);
    boxes.push(args.bbox);
  }
  const [us, usa, gom, ns, uk] = boxes;
  assert.ok(us[2] - us[0] < 70 && us[0] < -120 && us[2] > -70, `US box ${us}`);
  assert.deepEqual(us, usa);
  assert.deepEqual(gom, [-98, 17.5, -80, 31]);
  assert.ok(ns[0] < 0 && ns[2] > 5, `North Sea ${ns}`);
  assert.ok(uk[0] < -8 && uk[2] < 5, `UK ${uk}`);
  const r = await t.exec("find_data", { text: "VIIRS", area: "Gulf of America" });
  assert.match(r.searched.area, /Gulf of Mexico \(Gulf of America\)/);
});

await test("keyAttributes and geometryDistanceKm", () => {
  const k = keyAttributes({ OBJECTID: 5, Shape__Area: 3, acq_date: 1763337600000, name: "X", junk: "y" });
  assert.deepEqual(Object.keys(k), ["acq_date", "name"]);
  assert.match(k.acq_date, /UTC$/);
  const sq = turf.bboxPolygon([0, 0, 1, 1]).geometry;
  assert.equal(geometryDistanceKm(sq, { type: "Point", coordinates: [0.5, 0.5] }), 0);
  const d = geometryDistanceKm(sq, turf.bboxPolygon([1.1, 0, 2, 1]).geometry);
  assert.ok(Math.abs(d - 11.1) < 0.3, String(d));
});

console.log(`${passed} data tests passed`);
