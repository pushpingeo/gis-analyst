// The welcome examples: one of each kind (find a place, shape an area, screen a site), picked afresh on every
// load from a small pool. The pool lives in the industry profile (catalogue/industries/<id>.json, "examples"), so
// each industry shows its own. Energy's are calm, global, well-covered places: no oil and gas, nothing contested,
// nowhere the atlas is thin (Rob, 18 Nov). Screening examples say where and how big, so the analyst acts rather than
// asks. Each was tried through the live analyst before it went in (docs/decisions.md).

// pool: { find: [...], shape: [...], screen: [...] }. rand: () => [0, 1), so tests can pin the pick.
export function pickExamples(pool = {}, rand = Math.random) {
  return Object.values(pool).filter((list) => Array.isArray(list) && list.length).map((list) => list[Math.floor(rand() * list.length)]);
}
