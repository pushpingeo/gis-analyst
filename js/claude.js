// Calls Claude through the Worker, or directly with a visitor's own key (kept for this tab only).
import { CONFIG } from "./config.js";

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

export async function callClaude({ system, messages, tools }) {
  const body = { model: CONFIG.model, max_tokens: CONFIG.maxTokens, system, messages, tools };
  const key = getUserKey();
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
