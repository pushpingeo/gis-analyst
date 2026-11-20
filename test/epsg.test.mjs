// Coordinate reference tools (js/epsgtools.js) against a fake EPSG registry shaped like apps.epsg.org/api/v1.
import assert from "node:assert/strict";
import { createEpsgTools, pointInGeoJSON, inBox, rankOptions, decide } from "../js/epsgtools.js";

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`ok  ${name}`); };

import { fakeEpsg, TF, box, rect } from "./fake-epsg.mjs";

const locate = (ref) => { const [x, y] = String(ref).split(",").map(Number); if (!isFinite(x) || !isFinite(y)) throw new Error(`"${ref}" isn't a place`); return [x, y]; };
const tools = (setting = "choose", tfs) => createEpsgTools({ epsg: fakeEpsg(tfs), transformationChoice: () => setting }, locate);

const LINLITHGOW = "-3.60,55.97", LONDON = "-0.13,51.51", BERWICKISH = "-2.0,55.75", PARIS = "2.35,48.86";

await t("geometry helpers: point in polygon with holes; boxes across the antimeridian", async () => {
  const holed = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(pointInGeoJSON([2, 2], holed), true);
  assert.equal(pointInGeoJSON([5, 5], holed), false);
  assert.equal(pointInGeoJSON([5, 5], { type: "MultiPolygon", coordinates: [rect(4, 4, 6, 6).coordinates] }), true);
  assert.equal(inBox([179, 0], box(170, -10, -170, 10)), true);
  assert.equal(inBox([-175, 0], box(170, -10, -170, 10)), true);
  assert.equal(inBox([0, 0], box(170, -10, -170, 10)), false);
});

await t("Linlithgow: ranked by accuracy, not by smallest area; Scotland (18 m) comes after 1314 (2 m)", async () => {
  const r = await tools().transformation_options({ source: "27700", target: "4326", at: LINLITHGOW });
  assert.equal(r.listed, 7, "one search, no duplicates");
  assert.equal(r.source.given, 27700);
  assert.equal(r.source.base, 4277);
  assert.deepEqual(r.options.map((o) => o.code), [7710, 5339, 1314, 1198, 1197], "each once; superseded 5339 after 7710");
  assert.equal(r.recommended, 7710);
  assert.equal(r.options[1].superseded_by.code, 7710);
  assert.equal(r.chosen, 1314, "the best one that can be applied in the page");
  assert.equal(r.ask, false);
  assert.match(r.why, /needs a grid file/);
  assert.equal(r.options[0].can_apply, false);
  assert.match(r.options[0].grid_file, /OSTN15/);
  assert.equal(r.options.some((o) => o.reversed), false);
  assert.ok(r.not_covering.some((x) => /England/.test(x)), "England's transformation is outside Scotland's outline");
  assert.equal(r.deprecated_dropped, 1);
  assert.equal(r.outlines_checked > 0, true);
  assert.match(r.wgs84_note, /2 m/);
});

await t("London: England's (10 m) covers, Scotland's doesn't; 1314 still chosen", async () => {
  const r = await tools().transformation_options({ source: "EPSG:4277", at: LONDON });
  assert.deepEqual(r.options.map((o) => o.code), [7710, 5339, 1314, 1196]);
  assert.equal(r.chosen, 1314);
  assert.ok(!r.options.some((o) => o.code === 1198));
});

await t("Overlapping boxes near the border are settled by the outlines", async () => {
  const r = await tools().transformation_options({ source: "4277", at: BERWICKISH });
  assert.ok(r.options.some((o) => o.code === 1198) && !r.options.some((o) => o.code === 1196), "55.75°N is in Scotland's outline here");
  assert.equal(r.options.find((o) => o.code === 1198).checked_by, "area-of-use outline");
});

await t("'Ask me' offers the options and chooses nothing", async () => {
  const r = await tools("ask").transformation_options({ source: "4277", at: LINLITHGOW });
  assert.equal(r.chosen, null);
  assert.equal(r.ask, true);
  assert.equal(r.setting, "ask");
  assert.equal(r.recommended, 7710);
});

await t("'Choose for me' still asks when the best that can be applied is worse than 25 m", async () => {
  const poor = { 1197: { ...TF[1197], Accuracy: 30 } };
  const r = await tools("choose", poor).transformation_options({ source: "4277", at: LINLITHGOW });
  assert.equal(r.chosen, null);
  assert.equal(r.ask, true);
  assert.match(r.why, /30 m/);
});

await t("Nowhere covered: says so rather than borrowing one from elsewhere", async () => {
  const r = await tools().transformation_options({ source: "4277", at: PARIS });
  assert.equal(r.options.length, 0);
  assert.equal(r.chosen, null);
  assert.match(r.why, /No transformation .* covers this place/);
});

await t("Same base CRS: a conversion only, no transformation", async () => {
  const r = await tools().transformation_options({ source: "27700", target: "4277", at: LINLITHGOW });
  assert.equal(r.same_base, true);
});

await t("Inputs: codes required; place must resolve; no registry → not_checked", async () => {
  assert.match((await tools().transformation_options({ source: "OSGB36", at: LINLITHGOW })).error, /crs_lookup/);
  assert.match((await tools().transformation_options({ source: "4277", at: "nowhere" })).error, /isn't a place/);
  assert.match((await createEpsgTools({}, locate).crs_lookup({ code: "4277" })).not_checked, /isn't connected/);
});

await t("crs_lookup: projected CRS gives its base and datum; WGS 84 is an ensemble; deprecated says what replaces it; words search", async () => {
  const T = tools();
  const bng = await T.crs_lookup({ code: "EPSG:27700" });
  assert.equal(bng.kind, "projected");
  assert.equal(bng.base.code, 4277);
  assert.match(bng.datum.name, /1936/);
  const w = await T.crs_lookup({ code: "4326" });
  assert.equal(w.datum.ensemble, true);
  assert.equal(w.area_of_use.code, 4390);
  assert.deepEqual(w.area_of_use.bbox, [-9, 49.75, 2.01, 61.01]);
  const old = await T.crs_lookup({ code: "4135" });
  assert.equal(old.deprecated, true);
  assert.equal(old.replaced_by.code, 4136);
  const s = await T.crs_lookup({ search: "ED50" });
  assert.equal(s.results[0].code, 4230);
  assert.match((await T.crs_lookup({ code: "99999" })).hint, /No such code/);
});

await t("rank and decide on their own", async () => {
  const r = rankOptions([
    { code: 1, contains: false, accuracy_m: 1 },
    { code: 2, contains: true, accuracy_m: null },
    { code: 3, contains: true, accuracy_m: 5, _area: 100 },
    { code: 4, contains: true, accuracy_m: 5, _area: 10 },
  ]);
  assert.deepEqual(r.map((o) => o.code), [4, 3, 2, 1]);
  const d = decide(r.map((o) => ({ ...o, name: `T${o.code}`, can_apply: true })), "choose");
  assert.equal(d.chosen, 4);
});

console.log(`\n${pass} passed`);
