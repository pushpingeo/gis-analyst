// tobler-api: Tobler's own Cloudflare Worker.
//
//   POST /v1/messages  Claude proxy. Holds the Anthropic key, pins the model, caps max_tokens,
//                      and limits calls per visitor and in total per day.
//   POST /atlas        Read-only calls to the AI Living World Atlas (find_datasets, get_dataset,
//                      fetch_features, vocabulary), adding the atlas key, through the ATLAS service
//                      binding (a Worker can't fetch another Worker on the account by workers.dev: 1042).
//   POST /firms        NASA FIRMS active fire / thermal hotspot detections (VIIRS, MODIS) for a box, with the
//                      FIRMS MAP_KEY added here. Returns GeoJSON. Open data under NASA's open data policy.
//   POST /logs         A trimmed log of one conversation turn, sent by the page while "Share my sessions" is on
//                      (on by default; the welcome card says so). Stored for 90 days, one store per day.
//   GET  /logs?day=    Reads a day's logs back, for the weekly digest (scripts/log-digest.mjs). Needs the read key:
//                      sha256("tobler-logs:" + ATLAS_MCP_KEY) in hex, so no new secret is needed in the repo.
//   GET  /health       Liveness check, no counters.
//
// Only allowed origins are served. Counters live in a Durable Object (one per visitor per day, one for
// the daily total), not KV: KV refuses more than one write a second to a key, and the page sends ten
// atlas calls at once. A Durable Object handles its calls one at a time, so the counts are exact.

import { DurableObject } from "cloudflare:workers";

const ATLAS_TOOLS = new Set(["find_datasets", "get_dataset", "fetch_features", "vocabulary"]);
const MAX_BODY = 120_000;
// FIRMS sources Tobler may ask for (near real-time; the archive "_SP" ones too, for a date).
const FIRMS_SOURCES = new Set(["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "MODIS_SP", "LANDSAT_NRT"]);
const FIRMS_MAX_DEG2 = 400; // keeps one call to a few FIRMS transactions

// FIRMS CSV → GeoJSON points. Numbers stay numbers; acq_date + acq_time become one ISO time.
export function firmsCsvToGeoJSON(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length || !/latitude/i.test(lines[0])) return { type: "FeatureCollection", features: [] };
  const head = lines[0].split(",");
  const iLat = head.indexOf("latitude"), iLon = head.indexOf("longitude");
  const features = [];
  for (const line of lines.slice(1)) {
    const v = line.split(",");
    if (v.length < head.length) continue;
    const p = {};
    head.forEach((h, i) => { if (i !== iLat && i !== iLon) p[h] = v[i] !== "" && !isNaN(+v[i]) && !/date|time|satellite|instrument|version|daynight|confidence/.test(h) ? +v[i] : v[i]; });
    if (p.acq_date && p.acq_time) { const t = String(p.acq_time).padStart(4, "0"); p.acquired_utc = `${p.acq_date} ${t.slice(0, 2)}:${t.slice(2)} UTC`; }
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [+v[iLon], +v[iLat]] }, properties: p });
  }
  return { type: "FeatureCollection", features };
}
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

// Session logs: one object per day. SQLite-backed, so a day's logs can be listed in order and paged.
// The whole day is deleted 90 days after its first log (LOG_RETENTION_DAYS).
export class LogStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, visitor TEXT, session TEXT, seq INTEGER, page TEXT, body TEXT)");
  }

  async add(rec, retentionDays) {
    this.ctx.storage.sql.exec("INSERT INTO logs (at, visitor, session, seq, page, body) VALUES (?, ?, ?, ?, ?, ?)",
      rec.at, rec.visitor, rec.session, rec.seq, rec.page, rec.body);
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + retentionDays * DAY_MS);
    return { ok: true };
  }

  // Oldest first, `limit` at a time after id `after`.
  async list(after = 0, limit = 200) {
    return this.ctx.storage.sql.exec("SELECT id, at, visitor, session, seq, page, body FROM logs WHERE id > ? ORDER BY id LIMIT ?", after, limit)
      .toArray().map((r) => ({ ...r, log: JSON.parse(r.body), body: undefined }));
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

async function sha256hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const logReadKey = (atlasKey) => sha256hex(`tobler-logs:${atlasKey}`);

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

    // Reading logs back: for the digest Action, not the page, so no origin; the read key instead.
    if (request.method === "GET" && url.pathname === "/logs") {
      const auth = request.headers.get("authorization") || "";
      if (!env.ATLAS_MCP_KEY || auth !== `Bearer ${await logReadKey(env.ATLAS_MCP_KEY)}`) return reply(401, { message: "Not allowed" });
      const day = url.searchParams.get("day") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply(400, { message: "day must be YYYY-MM-DD" });
      const after = Math.max(0, Math.floor(+url.searchParams.get("after") || 0));
      const limit = Math.min(500, Math.max(1, Math.floor(+url.searchParams.get("limit") || 200)));
      const entries = await env.LOGS.get(env.LOGS.idFromName(`logs:${day}`)).list(after, limit);
      return reply(200, { day, entries, more: entries.length === limit });
    }

    const route = request.method === "POST" && ["/v1/messages", "/atlas", "/firms", "/logs"].includes(url.pathname) ? url.pathname : null;
    if (!route) return reply(404, { message: "Not found" });
    if (!okOrigin) return reply(403, { message: "This endpoint only serves Tobler." });

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { message: "Conversation too long. Start a new chat." });
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, { message: "Bad request" }); }

    const day = new Date().toISOString().slice(0, 10);
    const visitor = counter(env, `${day}:${await visitorId(request)}`);

    if (route === "/logs") {
      if (env.LOGS_ENABLED !== "yes") return reply(200, { ok: false, message: "Session logging is off." });
      const { session, seq, page, log } = body || {};
      if (!/^[a-z0-9-]{8,64}$/i.test(String(session || ""))) return reply(400, { message: "session id missing" });
      if (!Number.isInteger(seq) || seq < 0 || seq > 10000) return reply(400, { message: "seq must be a whole number" });
      if (!log || typeof log !== "object") return reply(400, { message: "log missing" });
      const vid = await visitorId(request);
      const used = await visitor.hit("logs", +env.LOGS_PER_VISITOR_DAILY || 300);
      if (!used.ok) return reply(429, { message: "Log limit reached for today." });
      await env.LOGS.get(env.LOGS.idFromName(`logs:${day}`)).add({
        at: new Date().toISOString(), visitor: vid, session, seq,
        page: String(page || "").slice(0, 200), body: JSON.stringify(log),
      }, +env.LOG_RETENTION_DAYS || 90);
      return reply(200, { ok: true });
    }

    if (route === "/firms") {
      const { source, bbox, days = 5, date } = body || {};
      if (!FIRMS_SOURCES.has(source)) return reply(400, { message: `Unknown FIRMS source. Use one of: ${[...FIRMS_SOURCES].join(", ")}` });
      if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((v) => typeof v !== "number" || !isFinite(v))) return reply(400, { message: "bbox must be [west, south, east, north]" });
      const [w, so, e, n] = bbox;
      if (w >= e || so >= n || w < -180 || e > 180 || so < -90 || n > 90) return reply(400, { message: "bbox out of range" });
      if ((e - w) * (n - so) > FIRMS_MAX_DEG2) return reply(400, { message: `Area too large for one call (max ${FIRMS_MAX_DEG2} square degrees).` });
      const d = Math.round(+days);
      if (!(d >= 1 && d <= 5)) return reply(400, { message: "days must be 1 to 5 (NASA FIRMS allows no more)" });
      if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return reply(400, { message: "date must be YYYY-MM-DD" });
      if (!env.FIRMS_MAP_KEY) return reply(500, { message: "FIRMS isn't set up (FIRMS_MAP_KEY missing)." });
      const used = await visitor.hit("firms", +env.FIRMS_PER_VISITOR_DAILY || 300);
      if (!used.ok) return reply(429, { message: "You've reached today's limit for satellite fire searches." });
      const area = [w, so, e, n].map((v) => Math.round(v * 1e4) / 1e4).join(",");
      const firmsUrl = `${env.FIRMS_URL || "https://firms.modaps.eosdis.nasa.gov/api/area/csv"}/${env.FIRMS_MAP_KEY}/${source}/${area}/${d}${date ? `/${date}` : ""}`;
      let r;
      try { r = await fetch(firmsUrl, { cf: { cacheTtl: 900 } }); }
      catch (err) { return reply(502, { message: `NASA FIRMS didn't answer: ${String(err.message || err).slice(0, 120)}` }); }
      const text = await r.text();
      if (!r.ok || !/latitude/i.test(text.slice(0, 200))) {
        // FIRMS answers errors as plain text (e.g. "Invalid MAP_KEY."); never echo the key.
        if (r.ok && !text.trim()) return reply(200, { type: "FeatureCollection", features: [], source, days: d });
        return reply(502, { message: `NASA FIRMS answered: ${text.replaceAll(env.FIRMS_MAP_KEY, "…").slice(0, 160)}` });
      }
      return reply(200, { ...firmsCsvToGeoJSON(text), source, days: d, ...(date ? { date } : {}) });
    }

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
