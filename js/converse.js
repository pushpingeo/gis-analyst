// The conversation agent: one turn at a time, working from a compact project summary rather than the whole
// history, so long sessions don't rot. Old tool results are never replayed; the agent asks tools for detail.
// No DOM here, so the page and the evaluation share it.
import { FENCE_RULE, toolResultText, clean } from "./fence.js";

export function parseSkill(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (fm) for (const line of fm[1].split("\n")) { const m = line.match(/^(\w+):\s*(.*)$/); if (m) meta[m[1]] = m[2].trim(); }
  return { name: meta.name, version: meta.version, description: meta.description, body: fm ? text.slice(fm[0].length) : text };
}

export function systemPrompt({ skills, comingSoon = [], loaded = [] }) {
  return `You are Tobler, a geospatial analyst (the product is named after the geographer Waldo Tobler; you are not him) working with a person in a web workspace: a map with drawing tools beside this conversation. The person can draw and edit shapes themselves; you can find places and build areas with tools.

How you work:
- Each message starts with a <project> summary listing the places on the map (with how they were made and any edits). That summary is the current truth; the map may have changed since earlier messages.
- ${FENCE_RULE}
- When you need several searches that don't depend on each other (a name in a few spellings, the asset and the town it's described from), ask for them in the same step: they run at the same time.
- Use skills for methods. Load the relevant skill with load_skill before doing that kind of work, then follow it.
- Never work out coordinates, areas or distances in your head. Tools find places and build shapes; you choose the tool and the numbers and explain why.
- For data about a topic (thermal hotspots, fish habitat, flood zones, wrecks, anything not in find_features_near's types): find_data with short words that would appear in a dataset title, two or three wordings in one step; then get_data on the best fetchable dataset (prefer national and intergovernmental publishers) for the place. Report the dataset, publisher and date checked with the result.
- Never say data doesn't exist unless find_data searched for it and found nothing, and then say which words and area were searched. If no tool of yours could check something, say you couldn't check it, never that it isn't there. "Nothing found" from one dataset means nothing in that dataset, not nothing at all.
- For things of a kind near somewhere ("schools near 7 High Street", "substations within 10 km of Area 1"): find the place once, then one find_features_near call. Don't search for a kind of thing by name.
- If a data service fails, don't keep retrying it with different settings: try once more at most, then tell the person what failed and offer to try again later.
- Refer to places by name (e.g. "Area 1") and to search results by id (e.g. C3). Don't repeat coordinates to the person unless they ask.
- Keep replies short and plain: what you did, what you found, and one question if something is genuinely uncertain. The map and the cards show the detail.
- If a request is ambiguous in a way that would change the result, ask before building. If it's clear, build it and ask the person to check.
${comingSoon.length ? `- Not available yet in this preview: ${comingSoon.join("; ")}. If asked, say it's coming next and offer what you can do now (finding and defining the area, and finding and fetching published data in or near it with find_data and get_data).` : ""}

Skills: ${skills.map((s) => `${s.name}: ${s.description}`).join("\n")}${loaded.length ? `

Already loaded earlier in this conversation (follow them; don't load them again):
${loaded.map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n")}` : ""}`;
}

// Earlier assistant messages in this turn lose their thinking blocks (signed to the system prompt).
function compact(history) {
  return history.map((m, i) => {
    if (m.role !== "assistant" || i === history.length - 1 || typeof m.content === "string") return m;
    const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return { role: "assistant", content: content.length ? content : [{ type: "text", text: "…" }] };
  });
}

// recent: [{ role: "user" | "assistant", text }] — the last few exchanges as plain text, oldest first.
export function buildMessages({ recent = [], summary, userText }) {
  const msgs = [];
  for (const m of recent) {
    if (!m.text) continue;
    if (msgs.length && msgs.at(-1).role === m.role) msgs.at(-1).content += "\n\n" + m.text;
    else msgs.push({ role: m.role, content: m.text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const now = `<project>\n${summary}\n</project>\n\n${userText}`;
  if (msgs.length && msgs.at(-1).role === "user") msgs.at(-1).content += "\n\n" + now;
  else msgs.push({ role: "user", content: now });
  return msgs;
}

// One turn. Throws on failure so the caller can roll back and leave no half exchange behind.
// Tools that only look things up, so several can run at once.
export const READ_ONLY = new Set(["load_skill", "find_place", "find_features_near", "get_place", "find_data", "get_data"]);

export async function runTurn({ system, messages, tools, exec, callClaude, onEvent = () => {}, maxRounds = 10 }) {
  const history = messages.map((m) => ({ ...m }));
  const usage = { input_tokens: 0, output_tokens: 0 };
  let text = "";
  for (let round = 0; round < maxRounds; round++) {
    const resp = await callClaude({ system, messages: compact(history), tools });
    usage.input_tokens += resp.usage?.input_tokens || 0;
    usage.output_tokens += resp.usage?.output_tokens || 0;
    history.push({ role: "assistant", content: resp.content });
    const said = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (said) { text = said; onEvent({ type: "text", text: said, final: resp.stop_reason !== "tool_use" }); }
    if (resp.stop_reason === "max_tokens") { onEvent({ type: "warning", message: "The reply hit the length limit." }); break; }
    const uses = resp.content.filter((b) => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !uses.length) break;
    // Searches and lookups in one step run at once; tools that change the map run in order, after them.
    const run1 = async (u) => {
      onEvent({ type: "tool_start", name: u.name, input: u.input });
      try {
        const out = await exec(u.name, u.input || {});
        onEvent({ type: "tool", name: u.name, input: u.input, output: out });
        return { type: "tool_result", tool_use_id: u.id, content: toolResultText(out) };
      } catch (e) {
        onEvent({ type: "tool", name: u.name, input: u.input, error: e.message });
        return { type: "tool_result", tool_use_id: u.id, is_error: true, content: clean(String(e.message)) };
      }
    };
    const byId = new Map();
    const parallel = uses.filter((u) => READ_ONLY.has(u.name));
    (await Promise.all(parallel.map(run1))).forEach((r, i) => byId.set(parallel[i].id, r));
    for (const u of uses) if (!READ_ONLY.has(u.name)) byId.set(u.id, await run1(u));
    const results = uses.map((u) => byId.get(u.id));
    history.push({ role: "user", content: results });
    if (round === maxRounds - 1) onEvent({ type: "warning", message: "Stopped after the maximum number of steps." });
  }
  return { text, usage, history };
}

// What the activity line says while a tool runs.
export function activityFor(name, input = {}) {
  switch (name) {
    case "load_skill": return `Loading the ${input.name} skill`;
    case "find_place": return `Searching for “${input.query}”`;
    case "find_features_near": return `Looking for ${input.feature_type} within ${input.radius_km} km of ${input.anchor}`;
    case "make_place": return "Building the area";
    case "edit_place": return `Changing ${input.place}`;
    case "offer_choices": return "Laying out the options";
    case "get_place": return `Reading ${input.place}`;
    case "find_data": return `Searching the catalogue for “${input.text}”`;
    case "get_data": return `Fetching ${input.dataset} for ${input.place}`;
    default: return `Running ${name}`;
  }
}
