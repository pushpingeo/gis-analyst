// Agent loop test with a scripted fake model: tool calls, a web search pause, then a final answer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAgent, prepareData, systemPrompt, toolDefs, userPrompt } from "../js/agent.js";

const catalogue = JSON.parse(readFileSync("catalogue/catalogue.json"));
const { sites } = JSON.parse(readFileSync("data/eval-sites.json"));
const site = sites.find((s) => s.name.startsWith("Upper Trishuli"));
const osm = JSON.parse(readFileSync(`data/osm/${site.id}.json`)).osm;
const gbifSnap = JSON.parse(readFileSync(`data/gbif/${site.id}.json`));
const wd = JSON.parse(readFileSync(`data/wikidata/${site.id}.json`)).wikidata;
const data = prepareData({ catalogue, site, footprintKm: 5, osm, gbif: gbifSnap, wikidata: wd });

// The project name must never reach the model.
assert.ok(!userPrompt(site, 5).includes("Trishuli"));
assert.ok(!systemPrompt({ skillOn: true, skillText: readFileSync("skills/ntr-screening/SKILL.md", "utf8"), deskResearch: true }).includes("Trishuli"));
assert.equal(toolDefs({ deskResearch: false }).length, 4);
assert.equal(toolDefs({ deskResearch: true }).at(-1).type, "web_search_20250305");

const script = [
  { stop_reason: "tool_use", content: [
    { type: "thinking", thinking: "plan", signature: "sig" },
    { type: "text", text: "Checking the catalogue." },
    { type: "tool_use", id: "t1", name: "list_concepts", input: {} },
    { type: "tool_use", id: "t2", name: "find_features", input: { concepts: ["protected-area", "settlement", "nonsense"] } },
  ] },
  { stop_reason: "pause_turn", content: [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Haku Rasuwa Tamang" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://x", title: "x", encrypted_content: "zzz" }] },
  ], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } } },
  { stop_reason: "tool_use", content: [
    { type: "text", text: "Now species.", citations: [{ type: "web_search_result_location", url: "https://x" }] },
    { type: "tool_use", id: "t3", name: "threatened_species_records", input: {} },
    { type: "tool_use", id: "t4", name: "named_places", input: { type_contains: "settlement" } },
  ] },
  { stop_reason: "end_turn", content: [{ type: "text", text: 'Done.\n```json\n{"ps5": true, "ps6": true, "ps7": false, "ps8": true, "category": "A"}\n```' }] },
];
const sent = [];
let i = 0;
const fake = async (req) => { sent.push(JSON.parse(JSON.stringify(req))); return script[i++]; };
const events = [];
const out = await runAgent({ site, footprintKm: 5, skillOn: true, skillText: "x", deskResearch: true, data, callClaude: fake, onEvent: (e) => events.push(e) });

assert.deepEqual(out.result, { ps5: true, ps6: true, ps7: false, ps8: true, category: "A" });
assert.equal(out.usage.web_searches, 1);
// Request 2 (after tool results): thinking stripped from the earlier assistant turn.
assert.ok(!JSON.stringify(sent[1].messages).includes('"thinking"'));
// Request 3 (continuing a paused turn): the paused assistant turn is sent as-is, last.
assert.equal(sent[2].messages.at(-1).content[0].type, "server_tool_use");
// Request 4: web search payloads and citations stripped from history.
const m4 = JSON.stringify(sent[3].messages);
assert.ok(!m4.includes("encrypted_content") && !m4.includes("citations"));
// Every tool_use is answered in the next message.
for (let k = 0; k < sent.length; k++) {
  const msgs = sent[k].messages;
  msgs.forEach((m, j) => {
    const ids = m.role === "assistant" ? m.content.filter((b) => b.type === "tool_use").map((b) => b.id) : [];
    if (ids.length) {
      const res = (msgs[j + 1]?.content || []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
      assert.deepEqual(res.sort(), ids.sort(), `tool results for request ${k}`);
    }
  });
}
const ff = events.find((e) => e.type === "tool" && e.name === "find_features");
assert.equal(ff.output["protected-area"].counts.on_site, 1);
assert.ok(ff.output._unknown.includes("nonsense"));
const sp = events.find((e) => e.name === "threatened_species_records");
assert.ok(sp.output.species.length > 0);
console.log("Agent loop tests passed.", JSON.stringify(sent.at(-1)).length, "bytes in the last request");
