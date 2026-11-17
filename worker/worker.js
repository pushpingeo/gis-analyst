// tobler-api: Tobler's own Cloudflare Worker.
//
//   POST /v1/messages  Claude proxy. Holds the Anthropic key, pins the model, caps max_tokens,
//                      and limits calls per visitor and in total per day.
//   POST /atlas        Read-only calls to the AI Living World Atlas (find_datasets, get_dataset,
//                      fetch_features, vocabulary), adding the atlas key, through the ATLAS service
//                      binding (a Worker can't fetch another Worker on the account by workers.dev: 1042).
//   GET  /health       Liveness check, no counters.
//
// Only allowed origins are served. Counters live in a Durable Object (one per visitor per day, one for
// the daily total), not KV: KV refuses more than one write a second to a key, and the page sends ten
// atlas calls at once. A Durable Object handles its calls one at a time, so the counts are exact.

import { DurableObject } from "cloudflare:workers";

const ATLAS_TOOLS = new Set(["find_datasets", "get_dataset", "fetch_features", "vocabulary"]);
const MAX_BODY = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class Counter extends DurableObject {

  // Adds one to `name` unless it has reached `limit`. Returns { ok, count }.
  // Calls to one object run one at a time, so check-and-add can't race.
  async hit(name, limit) {
    const s = this.ctx.storage;
    const count = (await s.get(name)) || 0;
    if (count >= limit) return { ok: false, count };
    await s.put(name, count + 1);
    // Each object covers one day; clear it out two days later so storage doesn't pile up.
    if ((await s.getAlarm()) == null) await s.setAlarm(Date.now() + 2 * DAY_MS);
    return { ok: true, count: count + 1 };
  }

  async peek(name) {
    return (await this.ctx.storage.get(name)) || 0;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

async function visitorId(request) {
  // Counters are keyed by a hash of the visitor's IP, so no IP is stored.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(bytes).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function counter(env, name) {
  return env.COUNTER.get(env.COUNTER.idFromName(name));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (status, obj) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return reply(200, { ok: true, service: "tobler-api" });

    const route = request.method === "POST" && (url.pathname === "/v1/messages" || url.pathname === "/atlas") ? url.pathname : null;
    if (!route) return reply(404, { message: "Not found" });
    if (!okOrigin) return reply(403, { message: "This endpoint only serves Tobler." });

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { message: "Conversation too long. Start a new chat." });
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, { message: "Bad request" }); }

    const day = new Date().toISOString().slice(0, 10);
    const visitor = counter(env, `${day}:${await visitorId(request)}`);

    if (route === "/atlas") {
      if (body?.method !== "tools/call" || !ATLAS_TOOLS.has(body?.params?.name)) return reply(403, { message: "Not allowed" });
      const used = await visitor.hit("atlas", +env.ATLAS_PER_VISITOR_DAILY || 2000);
      if (!used.ok) return reply(429, { message: "You've reached today's limit for map searches." });
      if (!env.ATLAS) return reply(500, { message: "The atlas link isn't set up (service binding ATLAS missing)." });
      let upstream;
      try {
        upstream = await env.ATLAS.fetch("https://atlas-mcp/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.ATLAS_MCP_KEY}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, method: "tools/call", params: { name: body.params.name, arguments: body.params.arguments || {} } }),
        });
      } catch (e) {
        return reply(502, { message: `The atlas didn't answer: ${String(e.message || e).slice(0, 120)}` });
      }
      return new Response(upstream.body, { status: upstream.status, headers: { ...cors, "content-type": "application/json" } });
    }

    // /v1/messages: the visitor's allowance first, then the day's total.
    const mine = await visitor.hit("claude", +env.PER_VISITOR_DAILY || 200);
    if (!mine.ok) return reply(429, { message: "You've reached today's limit for the free demo." });
    const all = await counter(env, `${day}:all`).hit("claude", +env.TOTAL_DAILY || 5000);
    if (!all.ok) return reply(429, { message: "Tobler has reached its daily limit. Try again tomorrow." });

    let upstream;
    try {
      upstream = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: env.MODEL,
          max_tokens: Math.min(+body.max_tokens || 4000, +env.MAX_TOKENS || 8000),
          system: body.system,
          messages: body.messages,
          tools: body.tools,
        }),
      });
    } catch (e) {
      return reply(502, { message: `Claude didn't answer: ${String(e.message || e).slice(0, 120)}` });
    }
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, "content-type": "application/json" } });
  },
};
