// Settings for the agent page.
export const CONFIG = {
  // Same Cloudflare Worker as demo 1: it holds the API key, pins the model and limits use per visitor.
  proxyUrl: "https://north-sea-geo-demo.robdunfey.workers.dev",
  model: "claude-haiku-5-5",
  maxTokens: 8000,
  maxRounds: 10,
};
