// Plays a list of requests through the workspace's analyst (same skill, tools and turn loop as the page),
// with the atlas on, and prints each conversation. For finding problems by using it, not for scoring.
// Each line of REQUESTS is one conversation; " >> " separates follow-up turns.
import { readFileSync } from "node:fs";
import * as turf from "@turf/turf";
import * as R from "../js/reference.js";
import { createPlaceTools, placeToolDefs, projectSummary } from "../js/placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn } from "../js/converse.js";
import { atlasCall } from "./atlas-client.mjs";
import { firmsCall } from "./firms-client.mjs";

const UA = { "User-Agent": "tobler-try/1.0 (+https://github.com/pushpingeo/tobler)" };
const ref = R.createReference(async (n) => JSON.parse(readFileSync(`data/ref/${n}.json`, "utf8")));
const anchors = JSON.parse(readFileSync("catalogue/anchors.json", "utf8")).sources;
const trusted = JSON.parse(readFileSync("catalogue/trusted.json", "utf8"));
const skill = parseSkill(readFileSync("skills/place-finding/SKILL.md", "utf8"));
const ntr = parseSkill(readFileSync("skills/ntr-screening/SKILL.md", "utf8"));
const allSkills = [skill, ntr];
let spend = { input: 0, output: 0 };

async function callClaude({ system, messages, tools }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 8000, system, messages, tools }),
    });
    if (r.ok) { const j = await r.json(); spend.input += j.usage?.input_tokens || 0; spend.output += j.usage?.output_tokens || 0; return j; }
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1))); continue; }
    throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("API kept failing");
}

const convs = (process.env.REQUESTS || "").split("\n").map((l) => l.trim()).filter(Boolean);
for (const conv of convs) {
  const list = [];
  const host = {
    ref, anchors, headers: UA, list, trusted,
    firms: process.env.FIRMS_MAP_KEY ? firmsCall : null,
    esriLicence: () => process.env.ESRI_LICENCE === "yes",
    offerChoices(o) { console.log(`   [choices offered: ${o.question || ""} ${(o.options || []).map((x) => x.label || x).join(" / ")}]`); },
    fetchFn: (url, opts = {}) => fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }),
    atlas: process.env.ATLAS_MCP_KEY ? (tool, args) => atlasCall(tool, args) : null,
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: (n) => (allSkills.find((x) => x.name === n) || skill).body,
    addPlace({ feature, origin }) { const p = { name: `Area ${list.length + 1}`, feature, origin, status: "proposed", edits: [] }; list.push(p); return p; },
    updatePlace(name, feature, words) { const p = this.findPlace(name); p.feature = feature; p.edits.push({ change: words }); },
    renamePlace(name, to) { this.findPlace(name).name = to; },
  };
  const tools = createPlaceTools(host);
  const recent = [];
  let loaded = [];
  console.log(`\n==================== ${conv}`);
  for (const text of conv.split(" >> ")) {
    const t0 = Date.now();
    console.log(`\n> ${text}`);
    try {
      const res = await runTurn({
        system: systemPrompt({ skills: allSkills, loaded, comingSoon: ["net developable area and constraints-and-access analysis"] }),
        messages: buildMessages({ recent, summary: await projectSummary(ref, list, list.at(-1)?.name), userText: text }),
        tools: placeToolDefs(allSkills),
        maxRounds: 14,
        exec: (name, input) => tools.exec(name, input),
        callClaude,
        onEvent: (ev) => {
          if (ev.type !== "tool") return;
          if (ev.name === "load_skill") { const k = allSkills.find((x) => x.name === ev.input?.name); if (k && !loaded.includes(k)) loaded = [...loaded, k]; }
          const o = ev.output || {};
          const brief = ev.error ? `ERROR ${ev.error}`
            : ev.name === "find_features_near" ? `${o.found} found; sources ${JSON.stringify(o.sources)}; top: ${(o.candidates || []).slice(0, 5).map((c) => `${c.name} (${c.distance_km} km, ${c.source})`).join("; ")}`
            : ev.name === "find_place" ? `${(o.candidates || []).length} found: ${(o.candidates || []).slice(0, 5).map((c) => `${c.id} ${c.name} [${c.type}] ${c.source}`).join("; ")}`
            : ev.name === "find_data" ? `${o.matches ?? 0} matches: ${(o.datasets || []).map((d) => `${d.id} ${d.title} (${d.publisher}${d.can_fetch ? "" : ", picture only"})`).join("; ")}${o.not_checked ? ` NOT CHECKED: ${o.not_checked}` : ""}`
            : ev.name === "get_data" ? (o.not_checked ? `NOT CHECKED: ${o.not_checked}` : `${o.dataset}: ${o.inside_or_touching} inside, ${o.within_distance} within ${o.within_km} km; nearest: ${(o.nearest || []).slice(0, 4).map((c) => `${c.name} ${c.distance_km} km ${JSON.stringify(c.details || {})}`).join("; ")}`)
            : ev.name === "make_place" ? `${o.summary} | ${o.how} | ${o.confidence}: ${(o.why || []).join("; ")}`
            : JSON.stringify(o).slice(0, 200);
          console.log(`   · ${ev.name} ${JSON.stringify(ev.input).slice(0, 160)}\n     → ${brief.slice(0, 700)}`);
        },
      });
      recent.push({ role: "user", text }, { role: "assistant", text: res.text });
      console.log(`\n${res.text}\n   (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) { console.log(`TURN FAILED: ${e.message}`); }
  }
}
console.log(`\nTokens: ${spend.input} in, ${spend.output} out`);
