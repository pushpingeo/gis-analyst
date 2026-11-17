// Settings for the agent page.
export const CONFIG = {
  // Tobler's own Cloudflare Worker (worker/): holds the keys, pins the model, limits use per visitor.
  // To switch back to demo 1's Worker: "https://north-sea-geo-demo.robdunfey.workers.dev".
  proxyUrl: "https://tobler-api.robdunfey.workers.dev",
  model: "claude-haiku-5-5",
  maxTokens: 8000,
  maxRounds: 10,
  // The workspace analyst: a screening asks for many datasets, so it gets more rounds per turn.
  workspaceRounds: 14,
};
