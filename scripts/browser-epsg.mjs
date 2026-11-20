// Headless browser check of the coordinate reference tools: the skill loads, there is no datum setting,
// transformation_options chooses through the page's Worker client, and transform applies
// EPSG:1311 to an ED50 well typed in the chat and puts the moved point on the map with its record. The model and
// the EPSG registry are faked (test/fake-epsg.mjs), so this checks the page and tools, not the model or EPSG.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-epsg.mjs [chrome path].
import { chromium } from "playwright-core";
import { fakeEpsg } from "../test/fake-epsg.mjs";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const epsg = fakeEpsg();
const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const outputs = [];
let toolNames = [];
let wellMode = false;
function model(body) {
  toolNames = body.tools.map((t) => t.name);
  const last = body.messages.at(-1);
  if (typeof last.content === "string") return toolUse(["load_skill", { name: "coordinate-reference" }]);
  const res = last.content.find((b) => b.type === "tool_result");
  const raw = typeof res.content === "string" ? res.content : res.content[0].text;
  const out = raw.startsWith("Skill ") ? { skill: raw.split(".")[0].slice(6), method: raw } : JSON.parse(raw);
  outputs.push(out); if (process.env.DEBUG) console.log(JSON.stringify(out).slice(0, 400));
  if (wellMode) {
    if (out.skill) return toolUse(["find_place", { query: "57 30 00 N, 1 45 00 E" }]);
    if (out.candidates || out.found != null || Array.isArray(out.results)) { const id = JSON.stringify(out).match(/"(C\d+)"/)?.[1]; return toolUse(["transform", { operation: "1311", source: "4230", target: "4326", at: id }]); }
    if (out.applied) return toolUse(["make_place", { anchor: out.points[0].candidate, shape: "point", match: "named_place", words: "My well is at 57 30 00 N, 1 45 00 E in ED50", name: "Well" }]);
    return text(`Moved ${outputs.find((o) => o.applied)?.points[0].moved_m} m by EPSG:1311.`);
  }
  if (out.skill) return toolUse(["transformation_options", { source: "27700", target: "4326", at: "55.97, -3.60" }]);
  return text(out.chosen ? `Using EPSG:${out.chosen}.` : "Here are the options.");
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  outputs.length = 0;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|overpass|wikidata|nominatim/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/epsg/, async (r) => {
    try { const j = await epsg(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: "application/json", body: typeof j === "string" ? j : JSON.stringify(j) }); }
    catch (e) { r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route(/tobler-api.*\/(atlas|logs)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));

  // No datum setting any more (Rob, 20 Nov late night): transformations are chosen for the person.
  await page.click("#gear");
  check(!(await page.$('input[name="tfm"]')), `${label}: the settings have no datum transformation choice`);
  await page.keyboard.press("Escape");

  const ask = async (q) => {
    const before = outputs.length;
    await page.fill("#say", q);
    await page.click("#ask button[type=submit]");
    await page.waitForFunction((n) => window.__outputsDone >= n, before + 2, { timeout: 1 }).catch(() => {});
    for (let i = 0; i < 60 && outputs.length < before + 2; i++) await page.waitForTimeout(250);
    return outputs.slice(before);
  };
  let [sk, tfm] = await ask("Which transformation should I use from British National Grid at Linlithgow?");
  check((sk?.method || "").length > 5000 && /Choosing a transformation/i.test(sk.method), `${label}: the coordinate-reference skill loads with its method`);
  check(toolNames.includes("crs_lookup") && toolNames.includes("transformation_options"), `${label}: the analyst has crs_lookup and transformation_options`);
  check(tfm?.chosen === 1314 && tfm?.recommended === 7710 && tfm?.ask === false, `${label}: chosen for the person: 1314 at Linlithgow (7710 recommended, needs a grid)`);

  // An ED50 well typed in the chat: read, transformed by 1311 in the page, and placed where WGS 84 puts it.
  wellMode = true;
  const before = outputs.length;
  await page.fill("#say", "My well is at 57 30 00 N, 1 45 00 E in ED50. Put it on the map in WGS 84.");
  await page.click("#ask button[type=submit]");
  for (let i = 0; i < 80 && !outputs.slice(before).some((o) => o.place); i++) await page.waitForTimeout(250);
  wellMode = false;
  const tr = outputs.slice(before).find((o) => o.applied);
  check(toolNames.includes("transform"), `${label}: the analyst has transform`);
  check(tr && Math.abs(tr.points[0].output.lat - 57.49936045) < 2e-8 && Math.abs(tr.points[0].output.lon - 1.74843851) < 2e-8 && Math.abs(tr.points[0].moved_m - 117.6) < 0.1,
    `${label}: transform moves the well by 1311 to 57.49936045, 1.74843851 (117.6 m)${tr ? "" : ": no transform result"}`);
  check(tr?.record?.operation === "EPSG:1311" && tr?.record?.accuracy_m === 1 && tr?.record?.epsg_version === "13.106", `${label}: the result records EPSG:1311, 1 m and the EPSG version`);
  const well = await page.evaluate(() => { const p = window.__ws.host.places().find((x) => x.name === "Well"); return p && { c: p.feature.geometry.coordinates, t: p.origin?.anchor?.extra?.transformation }; });
  check(well && Math.abs(well.c[1] - 57.49936045) < 1e-7 && Math.abs(well.c[0] - 1.74843851) < 1e-7, `${label}: the well is placed at the transformed position${well ? ` (${well.c})` : ": not placed"}`);
  check(well?.t?.operation === "EPSG:1311", `${label}: the place keeps the transformation it was built from`);
  await page.screenshot({ path: `/tmp/epsg-${label}.png` });
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
