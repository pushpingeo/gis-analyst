// Headless browser check of two small things from Rob's Miri log (18 Nov): picking from the choices shows the
// person a name, not a candidate id, while the analyst still gets the id; and the scale bar sits below the zoom
// buttons. Model scripted, no network, no cost.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-choice.mjs [chrome path].
import { chromium } from "playwright-core";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);

const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
const sent = [];
await page.route(/tobler-api.*\/v1\/messages/, (r) => {
  sent.push(JSON.parse(r.request().postData()));
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }], usage: { input_tokens: 1, output_tokens: 1 } }) });
});
await page.goto("http://localhost:8000/");
await page.waitForFunction(() => window.__ws?.map?.loaded?.() || document.querySelector(".maplibregl-canvas"), null, { timeout: 30000 });
await page.waitForTimeout(1500);

// The scale bar below the zoom buttons.
const pos = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const z = r(".maplibregl-ctrl-zoom-out"), s = r(".maplibregl-ctrl-scale");
  return z && s ? { zoomBottom: z.bottom, scaleTop: s.top } : null;
});
check(pos && pos.scaleTop >= pos.zoomBottom, `desktop: scale bar below the zoom buttons (${JSON.stringify(pos)})`);

// A pick from the choices.
const cand = (id, name, lon, lat) => ({ id, name, type: "place: city", geometry: { type: "Point", coordinates: [lon, lat] }, source: { publisher: "OpenStreetMap contributors", title: "Nominatim search", url: "https://www.openstreetmap.org", licence: "ODbL 1.0" } });
await page.evaluate(([a, b]) => window.__ws.host.offerChoices({ choices: [a, b], recommended: a, reason: "The city most people mean." }), [cand("C29", "Miri", 113.988, 4.394), cand("C30", "Miri Division", 114, 4)]);
await page.waitForSelector('.choices [data-op="use"]', { state: "visible" });
await page.click('.choices [data-op="use"]');
await page.waitForFunction(() => document.querySelectorAll(".msg.analyst").length && !document.querySelector(".msg.analyst:last-child")?.textContent.includes("Thinking"), null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
const bubble = await page.evaluate(() => [...document.querySelectorAll(".msg.user")].at(-1)?.textContent || "");
check(bubble === "Use Miri (OpenStreetMap contributors).", `the person's message names the pick, no id ("${bubble}")`);
const toModel = JSON.stringify(sent.at(-1)?.messages?.at(-1)?.content || "");
check(/candidate C29/.test(toModel) && /match named_place/.test(toModel), "the analyst still gets the candidate id and how to build it");
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
