// Headless browser check of a screening run in the workspace: the conversation calls screen_site, the sealed run
// fetches (atlas and model scripted, no network, no cost), the run card appears with flags first, the slider filters
// the map, re-assess replaces the flags, a flag picks out its evidence, the card switches to inside the area only and
// back, an inside-only screen, and the settings gear (units, shape colour, licence switches). Screenshots at desktop
// and phone sizes.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-run-card.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const FIELD = [-3.95, 60.98];
const east = (km) => turf.destination(FIELD, 5 + km, 90).geometry.coordinates;
const half = 5 / 111.32, halfLon = 5 / (111.32 * Math.cos(FIELD[1] * Math.PI / 180));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const SQUARE = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[FIELD[0] - halfLon, FIELD[1] - half], [FIELD[0] + halfLon, FIELD[1] - half], [FIELD[0] + halfLon, FIELD[1] + half], [FIELD[0] - halfLon, FIELD[1] + half], [FIELD[0] - halfLon, FIELD[1] - half]].map((c) => c.map(r6))] } };

function atlas(tool, args) {
  if (tool === "find_datasets" && /pipeline/i.test(args.text || "")) return { matches: 1, results: [{ id: "pipe", title: "UKCS pipelines (WGS84)", publisher: "North Sea Transition Authority", capabilities: ["query"], licence: "NSTA Open User Licence" }] };
  if (tool === "find_datasets" && /wreck/i.test(args.text || "")) return { matches: 1, results: [{ id: "wreck", title: "Worldwide wreck locations (UK Hydrographic Office)", publisher: "EMODnet Human Activities", capabilities: ["query"], licence: "Creative Commons CC-BY 4.0" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  if (tool === "fetch_features" && args.id === "pipe") {
    const line = (a, name) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, turf.destination(a, 2, 0).geometry.coordinates] }, properties: { PIPE_NAME: name } });
    return { returned: 3, features: [line(FIELD, "Rosebank 9 inch Production flowline 1"), line(east(1.5), "West of Shetland Pipeline"), line(east(30), "Clair export")] };
  }
  if (tool === "fetch_features" && args.id === "wreck") return { returned: 2, features: [
    { type: "Feature", geometry: { type: "Point", coordinates: east(2) }, properties: { name: "TROLDFOS (POSSIBLY)" } },
    { type: "Feature", geometry: { type: "Point", coordinates: east(45) }, properties: { name: "FAR WRECK" } }] };
  return { matches: 0, results: [], returned: 0, features: [] };
}

const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
const RESULT = "Screened as an offshore oil field (assumed, greenfield).\n\n" + json({ flags: [
  { risk: "Existing pipelines on and near the site (simultaneous operations)", theme: "PS4", confidence: "high", why: "Work beside live lines needs SIMOPS planning.", evidence: [{ name: "Rosebank 9 inch Production flowline 1", distance_km: 0, dataset: "UKCS pipelines (WGS84)" }, { name: "West of Shetland Pipeline", distance_km: 1.5, dataset: "UKCS pipelines (WGS84)" }] },
  { risk: "A wreck close to the field may need a survey and an exclusion zone", theme: "PS8", confidence: "medium", why: "Heritage and safety.", evidence: [{ name: "TROLDFOS (POSSIBLY)", distance_km: 2, dataset: "Worldwide wreck locations (UK Hydrographic Office)" }] },
  { risk: "Seabird colonies on Shetland may be in spill reach", theme: "PS6", confidence: "low", why: "Regional knowledge, not mapped data.", evidence: [{ name: "Foula seabird colony", distance_km: 40, dataset: "none (regional knowledge)" }] },
], checked: [], data_gaps: ["Key Biodiversity Areas not checked", "Fishing effort not checked"] });
const REASSESS = "Within 1 km only the field's own lines matter.\n\n" + json({ flags: [{ risk: "Existing flowlines on site", theme: "PS4", confidence: "high", why: "SIMOPS.", evidence: [{ name: "Rosebank 9 inch Production flowline 1", distance_km: 0, dataset: "UKCS pipelines (WGS84)" }] }], data_gaps: ["Key Biodiversity Areas not checked"] });

const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  const n = body.messages.length;
  const first = String(body.messages[0]?.content || "");
  if (/sealed non-technical risk/.test(sys)) {
    if (/^Re-assess/.test(first)) return text(REASSESS);
    if (n === 1) return toolUse(["find_data", { text: "pipeline", area: "Area 1" }], ["find_data", { text: "wreck", area: "Area 1" }]);
    if (n === 3) return toolUse(["get_data", { dataset: "D1", place: "Area 1", within_km: 5, theme: "community" }], ["get_data", { dataset: "D2", place: "Area 1", theme: "heritage" }]);
    return text(RESULT);
  }
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Screened Area 1: live pipelines on and next to the field are the main flag, then a wreck 2 km east. Key Biodiversity Areas and fishing effort weren't checked.");
  const asked = JSON.stringify(body.messages);
  return toolUse(["screen_site", { place: "Area 1", asset_type: "oil-gas-field", assumed: true, ...(/only inside/.test(asked) ? { extent: "inside" } : {}) }]);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  // The sealed run's write-up is held back 3 s, so the progress block can be seen while it runs.
  await page.route(/tobler-api.*\/v1\/messages/, async (r) => {
    const out = model(JSON.parse(r.request().postData()));
    if (out.content?.[0]?.text === RESULT) await new Promise((ok) => setTimeout(ok, 3000));
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.goto("http://localhost:8000/workspace.html");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // Drawing tools: a tray by the input; the hint has Cancel while drawing and stays clear of the panel.
  const rect = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, sel);
  const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b);
  check(await page.evaluate(() => document.getElementById("tools").hidden), `${label}: drawing tools tucked away at first`);
  await page.click("#drawbtn");
  await page.click('#tools [data-mode="polygon"]');
  let h = await page.evaluate(() => ({ text: document.querySelector("#hint .hint-text").textContent, cancel: !document.querySelector('#hint [data-hint="cancel"]').hidden, mode: window.__ws.draw.getMode(), tray: !document.getElementById("tools").hidden }));
  check(h.tray && h.mode === "polygon" && h.cancel && /corners/.test(h.text), `${label}: tray open, drawing an area, hint with Cancel (${h.text.slice(0, 30)})`);
  check(label === "phone" || !overlap(await rect("#hint"), await rect("#panel")), `${label}: hint clear of the panel`);
  await page.screenshot({ path: `/tmp/ux-${label}-drawing.png` });
  await page.click('#hint [data-hint="cancel"]');
  h = await page.evaluate(() => ({ hidden: document.getElementById("hint").hidden, mode: window.__ws.draw.getMode() }));
  check(h.hidden && h.mode === "select", `${label}: Cancel stops drawing`);
  await page.click('#tools [data-action="done"]');
  check(await page.evaluate(() => document.getElementById("tools").hidden), `${label}: Done closes the tray`);
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "words", words: "Rosebank", confidence: "high", anchor: { name: "Rosebank", source: { title: "UKCS offshore hydrocarbon fields (WGS84)", publisher: "North Sea Transition Authority", licence: "not stated" } }, steps: ["outline of Rosebank"], at: new Date().toISOString() } }), SQUARE);
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // A shape card: one row of actions; a click on the shape only focuses its card; Adjust gives handles and controls.
  const card = () => page.evaluate(() => { const c = document.querySelector(".shape"); const ws = window.__ws; return {
    accept: !c.querySelector('[data-op="accept"]').hidden, delInRow: !!c.querySelector('.actions [data-op="delete"]'), adjustOpen: !c.querySelector(".adjust").hidden,
    help: c.querySelector(".adjust-help").textContent, hint: !document.getElementById("hint").hidden, active: c.classList.contains("active"),
    selected: ws.draw.getSnapshot().some((f) => f.properties?.selected) }; });
  let c = await card();
  check(c.accept && c.delInRow && !c.adjustOpen && !c.hint, `${label}: card: Use this area, Adjust and delete in one row; no banner`);
  await page.evaluate(() => { const id = [...window.__ws.places.keys()][0]; window.__ws.draw.selectFeature(id); });
  await page.waitForTimeout(150);
  c = await card();
  check(c.active && !c.selected && !c.hint && !c.adjustOpen, `${label}: clicking the shape focuses its card, no handles, no banner`);
  await page.click('.shape [data-op="adjust"]');
  await page.waitForTimeout(150);
  c = await card();
  check(c.adjustOpen && c.selected && !c.hint && /reshape/.test(c.help), `${label}: Adjust: handles on, rotate and resize shown, help on the card, no banner`);
  await page.$eval(".shape", (e) => e.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: `/tmp/ux-${label}-adjust.png` });
  await page.click('.shape [data-op="adjust-done"]');
  await page.waitForTimeout(150);
  c = await card();
  check(!c.adjustOpen && !c.selected, `${label}: Done: controls closed, handles off`);
  await page.fill("#say", "Screen Area 1 for risks");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".progress", { timeout: 20000 });
  await page.waitForTimeout(1200);
  const pr = await page.evaluate(() => ({ title: document.querySelector(".progress-title")?.textContent || "", step: document.querySelector(".progress-step")?.textContent || "",
    width: parseFloat(document.querySelector(".progress-bar span")?.style.width || "0"), globe: document.getElementById("activity").classList.contains("busy") && getComputedStyle(document.querySelector("#activity .globe")).display !== "none" }));
  check(/usually takes about/.test(pr.title) && /\d+ s/.test(pr.step) && pr.width > 0, `${label}: progress shown while screening (${pr.title.slice(0, 60)} | ${pr.step.slice(0, 50)} | ${pr.width}%)`);
  check(pr.globe, `${label}: spinning globe while busy`);
  check(!/\b[CD]\d+\b/.test(pr.step), `${label}: no internal ids in the progress line (${pr.step.slice(0, 50)})`);
  await page.$eval(".progress", (e) => e.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: `/tmp/ux-${label}-progress.png` });
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  check(await page.evaluate(() => !document.querySelector(".progress") && /took \d+ s/.test(document.querySelector(".run .meta").textContent)), `${label}: progress gone, card says how long it took`);
  await page.waitForTimeout(800);
  const st = () => page.evaluate(() => ({
    flags: [...document.querySelectorAll(".run .flag .risk")].map((e) => e.textContent),
    beyond: document.querySelectorAll(".run .flag.beyond").length,
    stale: !document.querySelector(".run .stale").hidden,
    out: document.querySelector(".run .reach output").textContent,
    nearest: document.querySelector(".run .nearest").textContent,
    onMap: window.__ws.map.getSource("findings")._data.features.length,
    hl: window.__ws.map.getSource("hl")._data.features?.length ?? 0,
    checked: document.querySelector(".run .checked summary").textContent,
    dists: document.querySelector(".run .dists").textContent,
    scopeShown: !document.querySelector(".run .scope").hidden,
    insideChecked: document.querySelector('.run [data-scope="inside"]').getAttribute("aria-checked") === "true",
    sliderShown: !document.querySelector(".run input[type=range]").hidden,
    mask: window.__ws.map.getSource("mask")._data.features?.length ?? 0,
    rings: window.__ws.map.getSource("rings")._data.features?.length ?? 0,
    staleText: document.querySelector(".run .stale button").textContent,
    reply: [...document.querySelectorAll(".msg.analyst")].at(-1).textContent.slice(0, 120),
  }));
  let s = await st();
  check(s.flags.length === 3 && /pipelines/.test(s.flags[0]), `${label}: three flags, high first (${s.flags[0]})`);
  check(s.out === "50 km" && s.onMap === 5, `${label}: slider at 50 km, 5 findings on the map (${s.out}, ${s.onMap})`);
  check(/near 2 km · close 10 km · wider 50 km/.test(s.dists), `${label}: distances and reason shown`);
  await page.$eval(".run", (e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `/tmp/run-card-${label}-1.png` });
  await page.$eval(".run input[type=range]", (el) => { el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  s = await st();
  check(s.onMap === 1 && s.out === "1 km", `${label}: slider to 1 km leaves 1 finding on the map (${s.onMap})`);
  check(s.stale && s.beyond === 1, `${label}: re-assess offered, wreck flag dimmed as beyond (${s.beyond})`);
  check(/Nearest: community health and safety, Rosebank 9 inch Production flowline 1 \(on site\)/.test(s.nearest), `${label}: nearest-by-theme line (${s.nearest})`);
  await page.screenshot({ path: `/tmp/run-card-${label}-2.png` });
  await page.click(".run [data-op=reassess]");
  await page.waitForFunction(() => document.querySelectorAll(".run .flag").length === 1, null, { timeout: 10000 });
  s = await st();
  check(!s.stale && s.flags.length === 1, `${label}: re-assessed at 1 km: one flag, offer gone`);
  await page.$eval(".run input[type=range]", (el) => { el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  s = await st();
  check(s.onMap === 5 && s.stale, `${label}: slider back to 50 km shows all 5 again, offers re-assess (no refetch)`);
  await page.click(".run .flag summary");
  await page.waitForTimeout(300);
  s = await st();
  check(s.hl === 1, `${label}: opening a flag picks out its evidence on the map (${s.hl})`);
  await page.screenshot({ path: `/tmp/run-card-${label}-3.png` });
  // Inside the area only, from the same evidence, and back.
  check(s.scopeShown && !s.insideChecked && s.rings > 0 && s.mask === 0, `${label}: area run offers the inside switch; rings on, no mask`);
  await page.click('.run [data-scope="inside"]');
  await page.waitForTimeout(300);
  s = await st();
  check(s.insideChecked && s.onMap === 1 && s.mask === 1 && s.rings === 0 && !s.sliderShown, `${label}: inside only: 1 finding, outside dimmed, no rings, slider hidden (${s.onMap}, mask ${s.mask}, rings ${s.rings})`);
  check(/inside the area or touching its edge/.test(s.nearest) && s.stale && s.staleText === "Re-assess inside the area", `${label}: inside wording and re-assess offer (${s.staleText})`);
  await page.screenshot({ path: `/tmp/run-card-${label}-4-inside.png` });
  await page.click(".run [data-op=reassess]");
  await page.waitForFunction(() => document.querySelector(".run .stale").hidden, null, { timeout: 10000 });
  s = await st();
  check(/^Flags written for inside the area only/.test(s.dists) && s.insideChecked, `${label}: re-assessed inside; distances line says so (${s.dists.slice(0, 45)})`);
  await page.click('.run [data-scope="around"]');
  await page.waitForTimeout(300);
  s = await st();
  check(!s.insideChecked && s.onMap === 5 && s.mask === 0 && s.rings > 0 && s.out === "50 km", `${label}: back to area and surroundings at 50 km (${s.onMap}, ${s.out})`);
  // Settings: units, colour, licence switches.
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.click("#gear");
  await page.waitForSelector("#settings[open]");
  await page.screenshot({ path: `/tmp/settings-${label}.png` });
  await page.check('#settings input[name="units"][value="imperial"]');
  await page.click('#settings [data-colour="#00a0b0"]');
  await page.check('#settings input[name="esri"]');
  const set = await page.evaluate(() => ({
    out: document.querySelector(".run .reach output").textContent, dists: document.querySelector(".run .dists").textContent,
    unit: document.querySelector(".shape .unit").textContent, facts: document.querySelector(".shape .facts").textContent,
    line: window.__ws.map.getPaintProperty("aoi-red", "line-color"), css: document.documentElement.style.getPropertyValue("--pole"),
    esri: localStorage.getItem("tobler.esriLicence"), host: window.__ws.host.esriLicence(), units: localStorage.getItem("tobler.units"),
    rings: window.__ws.map.getSource("rings")._data.features.map((f) => f.properties.label).join(","),
  }));
  check(set.out === "31.1 mi" && /31.1 mi/.test(set.dists) && !/ km/.test(set.dists) && set.unit === "sq mi" && /sq mi/.test(set.facts) && /mi/.test(set.rings), `${label}: miles on the card, shape card and rings (${set.out}; ${set.unit}; ${set.rings})`);
  check(set.line === "#00a0b0" && set.css === "#00a0b0", `${label}: shape colour applied to the map and the page`);
  check(set.esri === "yes" && set.host === true && set.units === "imperial", `${label}: Esri switch and units saved`);
  await page.click("#settings .close");
  check(await page.evaluate(() => !document.getElementById("settings").open), `${label}: settings close`);
  await page.evaluate(() => localStorage.clear());
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
// An inside-only screen, asked for in words.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, async (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.goto("http://localhost:8000/workspace.html");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "drawn", at: new Date().toISOString() } }), SQUARE);
  await page.fill("#say", "Screen Area 1, only inside the area");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    note: document.querySelector(".run .inside-note").hidden ? "" : document.querySelector(".run .inside-note").textContent,
    scope: !document.querySelector(".run .scope").hidden, dists: document.querySelector(".run .dists").textContent,
    onMap: window.__ws.map.getSource("findings")._data.features.length, mask: window.__ws.map.getSource("mask")._data.features.length,
    rings: window.__ws.map.getSource("rings")._data.features.length,
  }));
  check(/inside the area only/.test(s.note) && !s.scope && /^Inside the area only/.test(s.dists), `inside screen: card says so, no switch (${s.note.slice(0, 50)})`);
  check(s.onMap === 1 && s.mask === 1 && s.rings === 0, `inside screen: only the on-site finding, outside dimmed, no rings (${s.onMap}, ${s.mask}, ${s.rings})`);
  await page.$eval(".run", (e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/tmp/run-card-inside-screen.png" });
  check(errors.length === 0, `inside screen: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
