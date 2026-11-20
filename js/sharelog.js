// Session logs for improving Tobler. While "Share my sessions" is on (the default; the welcome card says so),
// each finished turn's log goes to Tobler's Worker (POST /logs), trimmed: shapes become a summary, long text and
// long lists are cut, and anything that looks like an API key is removed. The full log stays in the page for
// "Download the log". Sending never blocks or breaks the page: failures are ignored.

const MAX_TEXT = 4000;      // the person's words and the analyst's reply
const MAX_STRING = 600;     // any other string
const MAX_LIST = 40;        // items kept from a long list
const MAX_CHARS = 100_000;  // the whole turn, under the Worker's 120k body limit
const KEY = /sk-ant-[A-Za-z0-9_-]{8,}/g;

const isPosition = (a) => Array.isArray(a) && a.length >= 2 && a.length <= 4 && a.every((n) => typeof n === "number");

// A GeoJSON geometry becomes its type, vertex count and bounding box: enough to see where and how big.
function geometrySummary(g) {
  const pts = [];
  const walk = (c) => { if (isPosition(c)) pts.push(c); else if (Array.isArray(c)) c.forEach(walk); };
  if (g.type === "GeometryCollection") (g.geometries || []).forEach((x) => walk(x.coordinates)); else walk(g.coordinates);
  if (!pts.length) return { type: g.type };
  const r = (n) => Math.round(n * 1e4) / 1e4;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return pts.length === 1 ? { type: g.type, at: pts[0].slice(0, 2).map(r) }
    : { type: g.type, vertices: pts.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r) };
}

function trim(v, key = "") {
  if (typeof v === "string") {
    const s = v.replace(KEY, "[key removed]");
    const max = key === "user" || key === "sent" || key === "reply" ? MAX_TEXT : MAX_STRING;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
  if (Array.isArray(v)) {
    if (v.length && v.every(isPosition)) return { positions: v.length };
    const kept = v.slice(0, MAX_LIST).map((x) => trim(x));
    if (v.length > MAX_LIST) kept.push(`…${v.length - MAX_LIST} more left out`);
    return kept;
  }
  if (v && typeof v === "object") {
    if (typeof v.type === "string" && ("coordinates" in v || v.type === "GeometryCollection")) return geometrySummary(v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, k)]));
  }
  return v;
}

function longestArray(v, best = null) {
  if (Array.isArray(v)) {
    if (!best || v.length > best.length) best = v;
    for (const x of v) best = longestArray(x, best);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) best = longestArray(x, best);
  return best;
}

// One turn's log, ready to send. Halves the longest list until it fits; cuts outright as a last resort.
export function trimLog(entry, { maxChars = MAX_CHARS } = {}) {
  const v = trim(entry);
  let text = JSON.stringify(v);
  while (text.length > maxChars) {
    const arr = longestArray(v);
    if (!arr || arr.length < 2) break;
    arr.length = Math.ceil(arr.length / 2);
    v.trimmed = true;
    text = JSON.stringify(v);
  }
  return text.length > maxChars ? { cut: true, head: text.slice(0, maxChars - 200) } : v;
}

// A random id for this page load, so a session's turns can be put back together. Not tied to the person.
export function newSessionId() {
  try { return crypto.randomUUID(); } catch { return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

// Sends one entry. `enabled` is read at send time, so the switch applies at once.
export function createLogSharer({ url, enabled, session = newSessionId(), fetchFn = (...a) => fetch(...a) }) {
  let seq = 0;
  return {
    session,
    share(entry) {
      if (!url || !enabled()) return null;
      const body = JSON.stringify({ session, seq: seq++, page: globalThis.location?.pathname || "/", log: trimLog(entry) });
      // keepalive lets a send finish if the tab closes, but only for bodies under 64 KB.
      return fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: body.length < 60_000 })
        .then((r) => r.ok).catch(() => false);
    },
  };
}
