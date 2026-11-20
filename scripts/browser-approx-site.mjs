// Headless browser check of an approximate site (Rob, 20 Nov late night: "it shouldn't be low confidence just because
// it's a centre point"). Cnoc Buidhe's centre (169700 E, 630800 N) with a circle of the estimated size round it, built
// as make_place does with site_centre. The map draws it dashed and labels it; its card says what it is; a screen of
// it (model and atlas scripted, no network, no cost) leads with the approximate-site line; a monument near the middle
// is on site at full confidence; a goose roost clipping the eastern edge is "at the site's edge", capped at medium.
// The report says the same. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-approx-site.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const CENTRE = [-5.649540, 55.516482];
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const circle = turf.circle(CENTRE, 2.2, { units: "kilometers", steps: 48 });
const SEARCH = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle.geometry.coordinates[0].map((c) => c.map(r6))] } };
// A goose roost clipping the circle's eastern edge, and a monument point inside it.
const ROOST = turf.circle(turf.destination(CENTRE, 2.4, 90).geometry.coordinates, 0.8, { units: "kilometers", steps: 24 }).geometry;
const MONUMENT = turf.destination(CENTRE, 0.6, 300).geometry.coordinates;

function atlas(tool, args) {
  if (tool === "find_datasets" && /protection/i.test(args.text || "")) return { matches: 1, results: [{ id: "spa", title: "Special Protection Areas", publisher: "NatureScot", capabilities: ["query"], licence: "Open Government Licence" }] };
  if (tool === "find_datasets" && /monument/i.test(args.text || "")) return { matches: 1, results: [{ id: "sm", title: "Scheduled Monuments", publisher: "Historic Environment Scotland", capabilities: ["query"], licence: "Historic Environment Scotland" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  if (tool === "fetch_features" && args.id === "spa") return { returned: 1, features: [{ type: "Feature", geometry: ROOST, properties: { NAME: "Kintyre Goose Roosts" } }] };
  if (tool === "fetch_features" && args.id === "sm") return { returned: 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: MONUMENT }, properties: { DES_TITLE: "Killocraw, cup marked stone" } }] };
  return { matches: 0, results: [], returned: 0, features: [] };
}
const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
const RESULT = "Screened as onshore wind. A Special Protection Area is on site and a scheduled monument is on the site.\n\n" + json({ decision: "major issue", decision_why: "A protected bird roost on site.", flags: [
  { risk: "Special Protection Area (Kintyre Goose Roosts) on site", theme: "PS6", severity: "high", confidence: "high", next_step: "Ornithology review", why: "Collision and displacement.", evidence: [{ name: "Kintyre Goose Roosts", distance_km: 0, dataset: "Special Protection Areas" }] },
  { risk: "Scheduled monument on the site", theme: "PS8", severity: "high", confidence: "high", next_step: "Setting assessment", why: "Consent needed.", evidence: [{ name: "Killocraw, cup marked stone", distance_km: 0, dataset: "Scheduled Monuments" }] },
], checked: [], data_gaps: ["The site's outline wasn't found"] });
const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const firsts = [];
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  const n = body.messages.length;
  if (/sealed non-technical risk/.test(sys)) {
    if (n === 1) { firsts.push(String(body.messages[0].content)); return toolUse(["find_data", { text: "protection", area: "Cnoc Buidhe" }], ["find_data", { text: "monument", area: "Cnoc Buidhe" }]); }
    if (n === 3) return toolUse(["get_data", { dataset: "D1", place: "Cnoc Buidhe", theme: "biodiversity" }], ["get_data", { dataset: "D2", place: "Cnoc Buidhe", theme: "heritage" }]);
    return text(RESULT);
  }
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Screened Cnoc Buidhe.");
  return toolUse(["screen_site", { place: "Cnoc Buidhe", asset_type: "wind-onshore" }]);
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
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/gis\.ngdc\.noaa\.gov/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ samples: [150, 190, 240].map((v) => ({ value: String(v), resolution: 0.004 })) }) }));
  await page.route(/emodnet-humanactivities/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ features: [{ properties: { GRAY_INDEX: 0.04 } }] }) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // The place make_place builds round the centre the person gave, at an estimated size (site_centre).
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, name: "Cnoc Buidhe", origin: { method: "words", words: "Cnoc Buidhe, centred at 169700 E, 630800 N, about 15 km²", confidence: "high",
    match: "named_place", shape: "circle", anchor: { name: "NR 69700 30800", lonlat: [-5.649540, 55.516482], source: { id: "typed", title: "coordinates you typed", publisher: "You" } },
    role: "approximate_site", role_why: "round the site centre given; size from your estimate",
    steps: ["circle of 15.2 km²"], at: new Date().toISOString() } }), SEARCH);
  await page.waitForTimeout(400);
  const map = await page.evaluate(() => {
    const m = window.__ws.map;
    const d = m.getSource("aoi")._data?.features?.[0]?.properties || m.getSource("aoi").serialize().data.features?.[0]?.properties;
    return { role: d?.role, label: d?.label, solidFilter: JSON.stringify(m.getFilter("aoi-red")), dashed: !!m.getLayer("aoi-search") && JSON.stringify(m.getPaintProperty("aoi-search", "line-dasharray")) };
  });
  check(map.role === "approximate_site" && / · approximate site/.test(map.label || ""), `${label}: the map knows it's an approximate site and labels it (${map.label})`);
  check(/approximate_site/.test(map.solidFilter || "") && map.dashed === "[2.5,2]", `${label}: drawn thin and dashed, not as a ranging pole`);
  const what = await page.evaluate(() => { const c = document.querySelector(".shape .facts"); const dts = [...c.querySelectorAll("dt")].map((e) => e.textContent); return { first: dts[0], text: c.querySelector("dd").textContent }; });
  check(what.first === "What it is" && /^An approximate site \(round the site centre given; size from your estimate\): the centre is known, the boundary estimated/.test(what.text), `${label}: the place card says what it is (${what.text.slice(0, 60)})`);
  await page.fill("#say", "Screen Cnoc Buidhe for risks");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  const card = await page.evaluate(() => ({
    note: document.querySelector(".run .search-note").hidden ? "" : document.querySelector(".run .search-note").textContent,
    setup: document.querySelector(".run .setup").textContent,
    flags: [...document.querySelectorAll(".run .flag")].map((li) => ({ risk: li.querySelector(".risk").textContent, conf: li.querySelector(".conf").textContent, dist: li.querySelector(".dist").textContent, why: li.querySelector(".why").textContent, ev: li.querySelector(".ev li").textContent })),
    sea: document.querySelector(".run .sea").hidden ? "" : document.querySelector(".run .sea").textContent,
    body: document.querySelector(".run").textContent,
  }));
  check(/^Screened an approximate site of 15\.\d km² \(round the site centre given/.test(card.note), `${label}: the card leads with the approximate-site line (${card.note.slice(0, 70)})`);
  const spa = card.flags.find((f) => /Goose/.test(f.risk));
  const mon = card.flags.find((f) => /monument/i.test(f.risk));
  check(spa && /at the site's edge/.test(spa.risk) && spa.dist === "site edge" && spa.conf === "medium", `${label}: the roost on the edge: worded so, medium (${spa?.risk}, ${spa?.conf}, ${spa?.dist})`);
  check(spa && /at the site's edge \(its eastern side\)/.test(spa.ev) && /Confidence high → medium: only in the outer part/.test(spa.why), `${label}: the roost's evidence says where; the cap is explained (${spa?.ev.slice(0, 80)})`);
  check(mon && mon.conf === "high" && /on (the )?site/i.test(mon.risk) && /on site/.test(mon.ev), `${label}: the monument near the middle: on site, high, no cap (${mon?.conf}, ${mon?.ev.slice(0, 60)})`);
  check(card.sea === "", `${label}: no "At sea" line for an onshore site`);
  check(/centre is known but its boundary is estimated/.test(firsts.at(-1) || "") && !/This is a search area/.test(firsts.at(-1) || ""), `${label}: the analyst was told it's an approximate site, not a search area`);
  await page.screenshot({ path: `/tmp/approx-${label}-card.png` });
  // The report: the same line, a dashed outline, "in the search area".
  const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
  await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 40000 });
  const rep = await rp.evaluate(() => ({
    note: document.querySelector(".search-note")?.textContent || "",
    key: [...document.querySelectorAll(".key li")].map((e) => e.textContent),
    nearest: [...document.querySelectorAll("table.findings td.dist")].map((e) => e.textContent),
    ev: document.querySelector("table.findings .ev li")?.textContent || "",
    atSea: [...document.querySelectorAll(".facts dt")].some((e) => e.textContent === "At sea"),
    rating: document.querySelector("table.findings .rating")?.textContent || "",
    dash: JSON.stringify(window.__report.maps[0].getPaintProperty("site-line", "line-dasharray")),
  }));
  check(/^Screened an approximate site of 15\.\d km²/.test(rep.note), `${label}: report leads with the approximate-site line`);
  check(rep.key.includes("The approximate site") && rep.dash === "[3,2]", `${label}: report draws and keys the approximate site dashed`);
  check(rep.nearest.includes("at the site's edge") && rep.nearest.includes("on site"), `${label}: report rows: one at the site's edge, one on site (${rep.nearest.join(", ")})`);
  check(!rep.atSea, `${label}: report has no "At sea" row for an onshore site`);
  await rp.screenshot({ path: `/tmp/approx-${label}-report.png`, fullPage: true });
  await rp.close();
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
