// The "rules only" baseline: the skill's distance rules applied mechanically, no AI.
// s is the summarise() output for a site; species is summariseGbif() output (or null).
const within = (s, concept, km) => !s[concept]?.not_checked && (s[concept]?.nearest?.[0]?.distance_km ?? Infinity) <= km;
const any = (s, concepts, km) => concepts.some((c) => within(s, c, km));

// Mechanical reading of skills/ntr-screening/SKILL.md. The agent should do better than this.
export function rules(s, asset, species = null) {
  const threatened = (species?.species || []).some((x) => x.nearest_km <= 5);
  const ps5 = any(s, ["settlement", "residential-land", "informal-settlement", "farmland"], 1) && !within(s, "industrial-land", 0);
  const ps6 = any(s, ["protected-area", "world-heritage", "ramsar-site"], 5) || any(s, ["wetland", "river"], 1) ||
    threatened || asset === "wind" || asset === "hydro";
  const ps7 = within(s, "indigenous-land", 5);
  const ps8 = any(s, ["world-heritage", "heritage-site", "place-of-worship"], 1);
  const high = any(s, ["protected-area", "world-heritage", "ramsar-site", "settlement", "indigenous-land"], 0) || asset === "hydro";
  const medium = [ps5, ps6, ps7, ps8].filter(Boolean).length;
  const big = ["hydro", "mine", "thermal", "wind", "oil-gas-field"].includes(asset);
  const category = high || (medium >= 2 && big) ? "A" : medium ? "B" : "C";
  return { ps5, ps6, ps7, ps8, category };
}
