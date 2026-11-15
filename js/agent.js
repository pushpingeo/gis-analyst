// The NTR agent loop. No DOM in here, so the same code runs in the page and in the evaluation script.
// The model only sees the site's coordinates, country and asset type, never the project name.
import { screen, summarise, summariseGbif, summariseWikidata, tagFilter } from "./tools.js";

// Lenders' disclosure sites are blocked for web search so the agent can't read the answer.
export const BLOCKED_DOMAINS = [
  "ifc.org", "miga.org", "worldbank.org", "ebrd.com", "eib.org", "adb.org", "afdb.org", "aiib.org", "isdb.org",
  "dfc.gov", "proparco.fr", "fmo.nl", "bii.co.uk", "deginvest.de", "jbic.go.jp", "kfw.de", "iadb.org", "idbinvest.org",
  "equator-principles.com",
];

const OUTPUT_SPEC = `Finish with a short summary for a person, then exactly one JSON block in a \`\`\`json fence:
{
  "themes": [{"ps": "PS5", "rating": "high|medium|low|not_assessed", "triggered": true,
              "evidence": [{"concept": "", "name": "", "distance_km": 0, "source": ""}],
              "desk_research": [{"finding": "", "url": "", "date": ""}], "gaps": ""}],
  "ps5": true, "ps6": true, "ps7": false, "ps8": false,
  "category": "A|B|C",
  "category_drivers": [""],
  "context": {"country_risk": [], "social": []},
  "data_gaps": [""]
}
"ps5" to "ps8" mean: would IFC expect this Performance Standard to apply to the project?`;

export function systemPrompt({ skillOn, skillText, deskResearch }) {
  const base = `You are a geospatial analyst doing a desk-based screen of a project site for environmental and social (non-technical) risk, in IFC Performance Standard terms. You can only see the site's location, country and asset type. Use the tools to look at open data around the site.${deskResearch ? " You can also search the web." : ""}

${OUTPUT_SPEC}`;
  if (!skillOn) return base + "\n\nUse your own judgement about which data to check and how to interpret it.";
  return base + "\n\nFollow this skill exactly:\n\n<skill>\n" + skillText.replace(/^---[\s\S]*?---\n/, "") + "\n</skill>";
}

export function userPrompt(site, footprintKm) {
  return `Site: latitude ${site.lat}, longitude ${site.lon}, ${site.country}.
Asset type: ${site.asset_type}. Footprint: treat it as a circle of ${footprintKm} km radius around the point; the tools measure distances from its edge.
Screen this site.`;
}

export function toolDefs({ deskResearch }) {
  const tools = [
    {
      name: "list_concepts",
      description: "List the data concepts the catalogue can search for this site: id, label, the Performance Standard it informs, source, search radius and caveats.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "find_features",
      description: "Map features near the site for one or more catalogue concepts (OpenStreetMap). Returns counts by distance band (on site, within 1 km, 1-5 km, 5-20 km) and the nearest named features with distances from the footprint edge.",
      input_schema: {
        type: "object",
        properties: { concepts: { type: "array", items: { type: "string" }, description: "Concept ids from list_concepts" } },
        required: ["concepts"],
      },
    },
    {
      name: "threatened_species_records",
      description: "GBIF occurrence records within 5 km of the footprint for species the IUCN Red List rates Critically Endangered or Endangered, grouped by species, plus a species count within 20 km. Records are sightings and specimens, not ranges.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "named_places",
      description: "Named places and features within 20 km from Wikidata (settlements, municipalities, rivers, protected and heritage sites), with types, distances and Wikipedia links. Point locations only. Useful for desk research.",
      input_schema: { type: "object", properties: { type_contains: { type: "string", description: "Optional filter on the type text, e.g. 'settlement', 'protected', 'heritage'" } } },
    },
  ];
  if (deskResearch) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5, blocked_domains: BLOCKED_DOMAINS });
  return tools;
}

// Prepare the data the tools answer from (from saved snapshots or live responses).
// osmQuery: the Overpass query a saved snapshot was made with. Concepts it didn't ask for are marked
// "not checked" so an older snapshot can't be read as "nothing there".
export function prepareData({ catalogue, site, footprintKm, osm, gbif, wikidata, osmQuery }) {
  const osmSummary = osm ? summarise(screen(osm, catalogue, site.lon, site.lat, footprintKm), 5) : null;
  if (osmSummary && osmQuery) {
    for (const [id, c] of Object.entries(catalogue.concepts)) {
      if (c.source !== "osm-overpass" || !osmSummary[id]) continue;
      if (!c.match.some((m) => osmQuery.includes(tagFilter(m)))) osmSummary[id] = { label: c.label, ps: c.ps, not_checked: "This concept wasn't in the saved data for this site. Treat it as a data gap, not as absence." };
    }
  }
  const species = gbif ? summariseGbif(gbif.near, gbif.wide, site.lon, site.lat, footprintKm) : null;
  const places = wikidata ? summariseWikidata(wikidata, footprintKm) : null;
  return { catalogue, osmSummary, species, places };
}

function runTool(name, input, data) {
  const { catalogue, osmSummary, species, places } = data;
  if (name === "list_concepts") {
    return Object.entries(catalogue.concepts).map(([id, c]) => ({
      id, label: c.label, ps: c.ps, source: c.source, radius_km: c.radius_km,
      note: c.note || undefined,
      caveat: catalogue.sources[c.source]?.caveat,
      tool: c.source === "gbif" ? "threatened_species_records" : c.source === "wikidata" ? "named_places" : "find_features",
    }));
  }
  if (name === "find_features") {
    if (!osmSummary) throw new Error("OpenStreetMap data is not available for this site.");
    const ids = Array.isArray(input.concepts) ? input.concepts : [];
    const out = {}; const unknown = [];
    for (const id of ids) (osmSummary[id] ? (out[id] = osmSummary[id]) : unknown.push(id));
    if (unknown.length) out._unknown = `Not OpenStreetMap concepts: ${unknown.join(", ")}. Use list_concepts.`;
    out._source = "© OpenStreetMap contributors (ODbL). Missing features are not evidence of absence.";
    return out;
  }
  if (name === "threatened_species_records") {
    if (!species) throw new Error("GBIF data is not available for this site.");
    return { ...species, species: species.species.slice(0, 15) };
  }
  if (name === "named_places") {
    if (!places) throw new Error("Wikidata is not available for this site.");
    const f = (input.type_contains || "").toLowerCase();
    const items = places.items.filter((x) => x.name && (!f || x.types.join(" ").toLowerCase().includes(f) || (x.heritage || "").toLowerCase().includes(f)));
    return { source: places.source, caveat: places.caveat, total: items.length, items: items.slice(0, 40) };
  }
  throw new Error(`Unknown tool ${name}`);
}

// Earlier turns are sent back without thinking (signed to the old system prompt) and without
// web search payloads (large, and citations point into them). The trace keeps everything.
function compact(history) {
  return history.map((m, i) => {
    if (m.role !== "assistant" || i === history.length - 1) return m;
    const content = m.content
      .filter((b) => !["thinking", "redacted_thinking", "server_tool_use", "web_search_tool_result"].includes(b.type))
      .map((b) => (b.type === "text" ? { type: "text", text: b.text } : b));
    return { role: "assistant", content: content.length ? content : [{ type: "text", text: "(searched the web)" }] };
  });
}

export function parseResult(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// callClaude({system, messages, tools}) -> API response. onEvent(event) receives trace events.
export async function runAgent({ site, footprintKm, skillOn, skillText, deskResearch, data, callClaude, onEvent = () => {}, maxRounds = 10 }) {
  const system = systemPrompt({ skillOn, skillText, deskResearch });
  const tools = toolDefs({ deskResearch });
  const history = [{ role: "user", content: userPrompt(site, footprintKm) }];
  onEvent({ type: "start", system, user: history[0].content, tools: tools.map((t) => t.name) });
  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0 };
  let finalText = "";

  for (let round = 0; round < maxRounds; round++) {
    const t0 = Date.now();
    const resp = await callClaude({ system, messages: compact(history), tools });
    usage.input_tokens += resp.usage?.input_tokens || 0;
    usage.output_tokens += resp.usage?.output_tokens || 0;
    usage.web_searches += resp.usage?.server_tool_use?.web_search_requests || 0;
    onEvent({ type: "response", round, ms: Date.now() - t0, stop_reason: resp.stop_reason, content: resp.content, usage: resp.usage });
    history.push({ role: "assistant", content: resp.content });

    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (text) finalText = text;

    if (resp.stop_reason === "pause_turn") continue; // server tool (web search) paused a long turn: carry on
    if (resp.stop_reason === "max_tokens") {
      onEvent({ type: "warning", message: "The response hit the length limit before finishing." });
      break;
    }
    const uses = resp.content.filter((b) => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !uses.length) break;

    const results = [];
    for (const u of uses) {
      try {
        const out = runTool(u.name, u.input || {}, data);
        onEvent({ type: "tool", name: u.name, input: u.input, output: out });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
      } catch (e) {
        onEvent({ type: "tool", name: u.name, input: u.input, error: e.message });
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: String(e.message).slice(0, 500) });
      }
    }
    history.push({ role: "user", content: results });
  }

  const result = parseResult(finalText);
  onEvent({ type: "done", result, usage });
  return { result, text: finalText, history, usage };
}
