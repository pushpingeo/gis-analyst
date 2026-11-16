// Calls Claude through the Worker, or directly with a visitor's own key (kept for this tab only).
import { CONFIG } from "./config.js?v=m2b";

const KEY_STORE = "gisanalyst.anthropicKey";
let memKey = "";

export function getUserKey() {
  try { return sessionStorage.getItem(KEY_STORE) || memKey; } catch { return memKey; }
}
export function setUserKey(k) {
  memKey = k;
  try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ }
}

export class LimitReached extends Error {}

export async function callClaude(args) {
  // A dropped connection (Safari says "Load failed") gets one quiet retry before it's reported.
  try { return await callOnce(args); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    await new Promise((ok) => setTimeout(ok, 1500));
    try { return await callOnce(args); }
    catch (e2) {
      if (e2 instanceof TypeError) throw new Error("the connection to the analyst dropped (twice). Check your connection, keep this tab in front, and try again");
      throw e2;
    }
  }
}

async function callOnce({ system, messages, tools }) {
  // Cache the system prompt and tool definitions: every round of a turn sends them unchanged.
  const cachedTools = tools?.length ? tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t)) : tools;
  const body = { model: CONFIG.model, max_tokens: CONFIG.maxTokens, system: typeof system === "string" ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system, messages, tools: cachedTools };
  const key = getUserKey();
  const size = JSON.stringify(body).length;
  if (size > 100000) console.warn(`Claude request is ${Math.round(size / 1000)} kB; the Worker refuses over 120 kB.`);
  const res = key
    ? await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify(body),
      })
    : await fetch(CONFIG.proxyUrl.replace(/\/$/, "") + "/v1/messages", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw new LimitReached(j.message || "The demo's daily limit has been reached.");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || j.message || `Claude request failed (${res.status})`);
  }
  return res.json();
}
