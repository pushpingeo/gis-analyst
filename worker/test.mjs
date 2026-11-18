// Local tests for tobler-api: runs worker.js in workerd (Miniflare, what `wrangler dev` uses) with real
// Durable Object counters and fake upstreams for Claude and the atlas. No network, no cost.
//   cd worker && npm install && npm test
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";

const upstreamCalls = { claude: [], atlas: [] };
const mf = new Miniflare({
  scriptPath: new URL("./worker.js", import.meta.url).pathname,
  modules: true,
  compatibilityDate: "2026-08-01",
  durableObjects: { COUNTER: "Counter" },
  bindings: {
    MODEL: "claude-haiku-5-5", MAX_TOKENS: "8000",
    ALLOWED_ORIGINS: "https://asktobler.com,https://pushpingeo.github.io,http://localhost:8000",
    // Small limits so they can be reached in a test.
    PER_VISITOR_DAILY: "5", TOTAL_DAILY: "8", ATLAS_PER_VISITOR_DAILY: "25",
    ANTHROPIC_API_KEY: "sk-test", ATLAS_MCP_KEY: "atlas-test", FIRMS_MAP_KEY: "firmskey123", FIRMS_PER_VISITOR_DAILY: "3",
  },
  // Fake atlas, behind the service binding.
  serviceBindings: {
    ATLAS: async (req) => {
      const body = await req.json();
      upstreamCalls.atlas.push({ url: req.url, auth: req.headers.get("authorization"), body });
      await new Promise((ok) => setTimeout(ok, 20));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { echo: body.params.name } } }), { headers: { "content-type": "application/json" } });
    },
  },
  // Fake Anthropic: every outbound fetch lands here.
  outboundService: async (req) => {
    if (req.url.includes("firms")) {
      upstreamCalls.firms = [...(upstreamCalls.firms || []), req.url];
      if (req.url.includes("/MODIS_NRT/")) return new Response("Invalid MAP_KEY firmskey123.", { status: 400 });
      if (req.url.includes("/VIIRS_NOAA21_NRT/")) return new Response("latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n", { status: 200 });
      return new Response("latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n28.17,-89.20,330.5,2026-11-16,0712,N20,n,4.2,N\n28.30,-89.10,301.2,2026-11-15,1904,N20,l,1.1,D\n", { status: 200 });
    }
    const body = await req.json();
    upstreamCalls.claude.push({ url: req.url, key: req.headers.get("x-api-key"), body });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], model: body.model }), { headers: { "content-type": "application/json" } });
  },
});

const ORIGIN = "https://asktobler.com";
const post = (path, body, { origin = ORIGIN, ip = "1.1.1.1" } = {}) =>
  mf.dispatchFetch(`https://tobler-api.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const msg = (extra = {}) => ({ model: "claude-opus-anything", max_tokens: 50000, system: "s", messages: [{ role: "user", content: "hi" }], ...extra });
const atlas = (name = "find_datasets") => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: { q: "x" } } });

let passed = 0;
async function t(name, fn) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

try {
  await t("health", async () => {
    const r = await mf.dispatchFetch("https://tobler-api.example/health");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).service, "tobler-api");
  });

  await t("CORS preflight echoes an allowed origin", async () => {
    const r = await mf.dispatchFetch("https://tobler-api.example/v1/messages", { method: "OPTIONS", headers: { Origin: "https://pushpingeo.github.io" } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://pushpingeo.github.io");
  });

  await t("other origins and no origin are refused", async () => {
    assert.equal((await post("/v1/messages", msg(), { origin: "https://evil.example" })).status, 403);
    assert.equal((await post("/v1/messages", msg(), { origin: null })).status, 403);
    assert.equal((await post("/atlas", atlas(), { origin: "https://evil.example" })).status, 403);
    assert.equal(upstreamCalls.claude.length + upstreamCalls.atlas.length, 0);
  });

  await t("unknown paths 404; bad JSON 400; oversize 413", async () => {
    assert.equal((await post("/other", {})).status, 404);
    assert.equal((await post("/v1/messages", "{nope")).status, 400);
    assert.equal((await post("/v1/messages", "x".repeat(120_001))).status, 413);
  });

  await t("Claude: model pinned, max_tokens capped, key added, CORS on reply", async () => {
    const r = await post("/v1/messages", msg({ tools: [{ name: "t" }], temperature: 2 }), { ip: "2.2.2.2" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    const sent = upstreamCalls.claude.at(-1);
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent.key, "sk-test");
    assert.equal(sent.body.model, "claude-haiku-5-5");
    assert.equal(sent.body.max_tokens, 8000);
    assert.equal(sent.body.temperature, undefined);
    assert.deepEqual(sent.body.tools, [{ name: "t" }]);
  });

  await t("Claude: per-visitor limit (5) is exact, even with calls at once", async () => {
    // 2.2.2.2 has used 1. Fire 10 at once: exactly 4 more get through.
    const rs = await Promise.all(Array.from({ length: 10 }, () => post("/v1/messages", msg(), { ip: "2.2.2.2" })));
    const codes = rs.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 200).length, 4, codes.join(","));
    assert.equal(codes.filter((c) => c === 429).length, 6);
    const j = await rs.find((r) => r.status === 429).json();
    assert.match(j.message, /today's limit/);
  });

  await t("Claude: daily total (8) across visitors", async () => {
    // 5 used so far in total. Another visitor gets 3, then the total stops everyone.
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post("/v1/messages", msg(), { ip: "3.3.3.3" })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const r = await post("/v1/messages", msg(), { ip: "4.4.4.4" });
    assert.equal(r.status, 429);
    assert.match((await r.json()).message, /daily limit/);
    assert.equal(upstreamCalls.claude.length, 8);
  });

  await t("Atlas: only read tools; key added; sent over the binding", async () => {
    assert.equal((await post("/atlas", atlas("reload_everything"))).status, 403);
    assert.equal((await post("/atlas", { method: "tools/list" })).status, 403);
    const r = await post("/atlas", atlas("vocabulary"), { ip: "5.5.5.5" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await r.json()).result.structuredContent.echo, "vocabulary");
    const sent = upstreamCalls.atlas.at(-1);
    assert.equal(sent.url, "https://atlas-mcp/mcp");
    assert.equal(sent.auth, "Bearer atlas-test");
    assert.equal(sent.body.id, 7);
  });

  await t("Atlas: per-visitor limit (25) is exact with 40 calls at once (the KV bug)", async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, () => post("/atlas", atlas(), { ip: "6.6.6.6" })));
    const codes = rs.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 200).length, 25);
    assert.equal(codes.filter((c) => c === 429).length, 15);
  });

  await t("Atlas and Claude allowances are separate", async () => {
    // 6.6.6.6 has used its atlas allowance but no Claude calls; the Claude total is used up though,
    // so check the reverse: 2.2.2.2 used its Claude allowance and can still use the atlas.
    assert.equal((await post("/atlas", atlas(), { ip: "2.2.2.2" })).status, 200);
  });

  await t("FIRMS: key added, CSV becomes GeoJSON, empty is empty, NASA's errors don't leak the key", async () => {
    const r = await post("/firms", { source: "VIIRS_NOAA20_NRT", bbox: [-90, 27.5, -88.5, 29], days: 5 }, { ip: "7.7.7.7" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.features.length, 2);
    assert.deepEqual(j.features[0].geometry.coordinates, [-89.2, 28.17]);
    assert.equal(j.features[0].properties.acquired_utc, "2026-11-16 07:12 UTC");
    assert.equal(j.features[0].properties.frp, 4.2);
    assert.equal(j.features[0].properties.confidence, "n");
    assert.match(upstreamCalls.firms.at(-1), /\/api\/area\/csv\/firmskey123\/VIIRS_NOAA20_NRT\/-90,27.5,-88.5,29\/5$/);
    const empty = await (await post("/firms", { source: "VIIRS_NOAA21_NRT", bbox: [0, 0, 1, 1], days: 1 }, { ip: "7.7.7.7" })).json();
    assert.equal(empty.features.length, 0);
    const bad = await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], days: 1 }, { ip: "7.7.7.7" });
    assert.equal(bad.status, 502);
    assert.doesNotMatch(JSON.stringify(await bad.json()), /firmskey123/);
  });

  await t("FIRMS: checks inputs, and its own daily limit (3)", async () => {
    assert.equal((await post("/firms", { source: "EVIL", bbox: [0, 0, 1, 1] }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 30, 30] }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], days: 6 }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], date: "17/11/2026" }, { ip: "8.8.8.8" })).status, 400);
    // 7.7.7.7 has used 3 (two OK, one NASA error): the next is refused.
    assert.equal((await post("/firms", { source: "VIIRS_NOAA20_NRT", bbox: [0, 0, 1, 1] }, { ip: "7.7.7.7" })).status, 429);
  });

  console.log(`\n${passed} passed`);
} finally {
  await mf.dispose();
}
