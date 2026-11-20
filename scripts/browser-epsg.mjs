// Headless browser check of the coordinate reference tools: the skill loads, the settings switch is saved and read,
// and transformation_options answers through the page's Worker client with "choose" and with "ask". The model and
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
function model(body) {
  toolNames = body.tools.map((t) => t.name);
  const last = body.messages.at(-1);
  if (typeof last.content === "string") return toolUse(["load_skill", { name: "coordinate-reference" }]);
  const res = last.content.find((b) => b.type === "tool_result");
  const raw = typeof res.content === "string" ? res.content : res.content[0].text;
  const out = raw.startsWith("Skill ") ? { skill: raw.split(".")[0].slice(6), method: raw } : JSON.parse(raw);
  outputs.push(out); if (process.env.DEBUG) console.log(JSON.stringify(out).slice(0, 400));
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

  // Settings: default is "choose"; switching to "ask" is saved.
  await page.click("#gear");
  const def = await page.$eval('input[name="tfm"]:checked', (r) => r.value);
  check(def === "choose", `${label}: the datum setting defaults to "Choose for me"`);
  const visible = await page.isVisible('input[name="tfm"][value="ask"]').catch(() => false) || await page.$eval('input[name="tfm"][value="ask"]', (r) => !!r.closest("label").getClientRects().length);
  check(visible, `${label}: the "Ask me" option is in the dialog`);

  const ask = async (q) => {
    const before = outputs.length;
    await page.fill("#say", q);
    await page.click("#ask button[type=submit]");
    await page.waitForFunction((n) => window.__outputsDone >= n, before + 2, { timeout: 1 }).catch(() => {});
    for (let i = 0; i < 60 && outputs.length < before + 2; i++) await page.waitForTimeout(250);
    return outputs.slice(before);
  };
  await page.keyboard.press("Escape");
  let [sk, tfm] = await ask("Which transformation should I use from British National Grid at Linlithgow?");
  check((sk?.method || "").length > 5000 && /Choosing a transformation/i.test(sk.method), `${label}: the coordinate-reference skill loads with its method`);
  check(toolNames.includes("crs_lookup") && toolNames.includes("transformation_options"), `${label}: the analyst has crs_lookup and transformation_options`);
  check(tfm?.chosen === 1314 && tfm?.recommended === 7710 && tfm?.ask === false, `${label}: "choose" picks 1314 at Linlithgow (7710 recommended, needs a grid)`);

  await page.click("#gear");
  await page.check('input[name="tfm"][value="ask"]');
  const saved = await page.evaluate(() => localStorage.getItem("tobler.transformationChoice"));
  check(saved === "ask", `${label}: "Ask me" is saved`);
  await page.keyboard.press("Escape");
  [, tfm] = await ask("And again, please?");
  check(tfm?.chosen === null && tfm?.ask === true && tfm?.options?.length === 5, `${label}: "ask" offers 5 options and chooses none`);

  await page.click("#gear");
  await page.check('input[name="tfm"][value="choose"]');
  check(await page.evaluate(() => localStorage.getItem("tobler.transformationChoice")) === null, `${label}: back to "Choose for me" clears the saved value`);
  await page.screenshot({ path: `/tmp/epsg-${label}.png` });
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
