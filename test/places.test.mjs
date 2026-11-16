// Tests for place finding tools and the conversation loop, with the network and the model faked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { createPlaceTools, placeToolDefs, projectSummary } from "../js/placetools.js";
import { buildMessages, runTurn, parseSkill } from "../js/converse.js";
import { BLOCK_REF } from "../js/gazetteer.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));
const anchors = JSON.parse(readFileSync(new URL("../catalogue/anchors.json", import.meta.url))).sources;
const skill = parseSkill(readFileSync(new URL("../skills/place-finding/SKILL.md", import.meta.url), "utf8"));

// Fake network: NSTA answers for Jackdaw and block 30/2, Nominatim finds nothing.
const calls = [];
const fetchFn = async (url) => {
  calls.push(String(url));
  const u = decodeURIComponent(String(url));
  const json = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  if (u.includes("nominatim")) return json([]);
  if (u.includes("surface points") && u.includes("JACKDAW")) return json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2.37924, 56.90038] }, properties: { NAME: "JACKDAW", INF_TYPE: "PLATFORM", CRS_NAME: "TM 0 N, ED50" } }] });
  if (u.includes("UKCS_blocks") && u.includes("'30/2'")) return json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: turf.bboxPolygon([2.1985, 56.8327, 2.3985, 56.9994]).geometry, properties: { BLOCK_REF: "30/2", TYPE: "OFFSHORE" } }] });
  return json({ type: "FeatureCollection", features: [] });
};

function memoryHost() {
  const list = [];
  return {
    ref, anchors, fetchFn, headers: {}, list,
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: () => skill.body,
    addPlace({ feature, origin }) { const p = { name: `Area ${list.length + 1}`, feature, origin, status: "proposed", edits: [] }; list.push(p); return p; },
    updatePlace(name, feature, words) { const p = this.findPlace(name); p.feature = feature; p.edits.push({ change: words }); },
    renamePlace(name, to) { this.findPlace(name).name = to; },
  };
}

await test("skill file parses", () => {
  assert.equal(skill.name, "place-finding");
  assert.match(skill.description, /Turn words into a place/);
  assert.ok(skill.body.includes("## Confidence"));
});

await test("block references are recognised", () => {
  assert.deepEqual("block 30/2a".match(BLOCK_REF).slice(1, 4), ["30", "2", "a"]);
  assert.equal("the 3 km² square".match(BLOCK_REF), null);
});

await test("find_place finds Jackdaw in the NSTA layer", async () => {
  const t = createPlaceTools(memoryHost());
  const r = await t.exec("find_place", { query: "Jackdaw platform" });
  const c = r.candidates.find((x) => x.name === "JACKDAW");
  assert.ok(c, JSON.stringify(r));
  assert.match(c.source, /North Sea Transition Authority/);
  assert.ok(calls.some((u) => u.includes("nominatim")), "OpenStreetMap searched too");
});

await test("make_place builds a 3 km² square on the anchor and records how", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  const id = r.candidates.find((x) => x.name === "JACKDAW").id;
  const out = await t.exec("make_place", { anchor: id, shape: "square", area_km2: 3, words: "a 3 km² block around Jackdaw", confidence: "high", reason: "NSTA platform matched by name" });
  assert.equal(out.place, "Area 1");
  near(host.list[0].feature && turf.area(host.list[0].feature) / 1e6, 3, 0.01, "area");
  near(turf.distance(turf.centroid(host.list[0].feature), [2.37924, 56.90038]), 0, 0.01, "centred on the platform (km)");
  assert.equal(host.list[0].origin.anchor.source.publisher, "North Sea Transition Authority");
  assert.equal(out.offshore, true);
});

await test("feature shape uses the block outline; edits resize and rotate on the ground", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "30/2" });
  const blk = r.candidates.find((x) => x.name === "30/2");
  assert.ok(blk && blk.area_km2 > 200, JSON.stringify(r));
  await t.exec("make_place", { anchor: blk.id, shape: "feature", words: "block 30/2", confidence: "high", reason: "NSTA block reference" });
  const e = await t.exec("edit_place", { place: "Area 1", resize_to: 100, rotate_deg: 30 });
  near(e.area_km2, 100, 0.5, "resized area");
  assert.match(e.changed, /rotated 30°.*resized to 100/);
  const g = await t.exec("get_place", { place: "Area 1" });
  assert.equal(g.how_made.words, "block 30/2");
  assert.equal(g.edits.length, 1);
});

await test("offset and circle", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  const id = r.candidates.find((x) => x.name === "JACKDAW").id;
  await t.exec("make_place", { anchor: id, shape: "circle", radius_km: 2, offset_km: 10, bearing_deg: 0, words: "2 km circle 10 km north of Jackdaw", confidence: "low", reason: "offset from a single anchor" });
  const c = turf.centroid(host.list[0].feature).geometry.coordinates;
  near(turf.distance(c, [2.37924, 56.90038]), 10, 0.05, "10 km away");
  near(turf.bearing([2.37924, 56.90038], c), 0, 1, "to the north");
  near(turf.area(host.list[0].feature) / 1e6, Math.PI * 4, 0.1, "area of a 2 km circle");
});

await test("unknown anchors give a useful error", async () => {
  const t = createPlaceTools(memoryHost());
  await assert.rejects(() => t.exec("make_place", { anchor: "C99", shape: "point", words: "x", confidence: "low", reason: "x" }), /Use find_place first/);
});

await test("project summary has no coordinates", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  await t.exec("make_place", { anchor: r.candidates[0].id, shape: "square", area_km2: 3, words: "3 km² around Jackdaw", confidence: "high", reason: "x" });
  const s = await projectSummary(ref, host.list, "Area 1");
  assert.match(s, /Area 1 \[in focus\] \(proposed\): 3 km², offshore/);
  assert.doesNotMatch(s, /56\.9|2\.379/);
});

await test("messages alternate and start with the user", () => {
  const m = buildMessages({ recent: [{ role: "assistant", text: "hi" }, { role: "user", text: "(I accepted Area 1.)" }, { role: "user", text: "make it bigger" }, { role: "assistant", text: "done" }], summary: "- Area 1", userText: "rotate it" });
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert.match(m[0].content, /accepted Area 1[\s\S]*make it bigger/);
  assert.match(m.at(-1).content, /^<project>\n- Area 1\n<\/project>\n\nrotate it$/);
});

await test("a turn runs tools and every tool_use gets a result", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const script = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "load_skill", input: { name: "place-finding" } }, { type: "tool_use", id: "b", name: "find_place", input: { query: "Jackdaw" } }] },
    { stop_reason: "tool_use", content: [{ type: "text", text: "Found it." }, { type: "tool_use", id: "c", name: "make_place", input: { anchor: "C1", shape: "square", area_km2: 3, words: "w", confidence: "high", reason: "r" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Here's a 3 km² square around JACKDAW. Is that what you meant?" }] },
  ];
  const seen = [];
  const res = await runTurn({
    system: "s", messages: [{ role: "user", content: "x" }], tools: placeToolDefs([skill]),
    exec: (n, i) => t.exec(n, i),
    callClaude: async ({ messages }) => { seen.push(messages); return script.shift(); },
  });
  assert.match(res.text, /Is that what you meant/);
  const toolResults = seen[1].at(-1).content;
  assert.deepEqual(toolResults.map((r) => r.tool_use_id), ["a", "b"]);
  assert.equal(host.list.length, 1);
});

console.log(`${passed} place tests passed`);
