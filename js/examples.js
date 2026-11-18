// The welcome examples: one of each kind (find a place, shape an area, screen a site), picked afresh on every
// load from a small pool. Kept to calm, global, well-covered places: no oil and gas, nothing contested, nowhere the
// atlas is thin (Rob, 18 Nov). Screening examples say where and how big, so the analyst acts rather than asks. Each was tried through the live analyst before it went in (docs/decisions.md).
export const EXAMPLES = {
  find: ["Show me Linlithgow Palace and 5 km around it", "Show me Lake Tekapo in New Zealand"],
  shape: ["Draw a 2 km square around the Kinderdijk windmills", "Mark out 10 km around Peggy's Cove, Nova Scotia", "Mark out 3 km around Mont-Saint-Michel"],
  screen: ["Screen a 1 km² wind farm site 3 km south-east of Lemvig, Denmark", "Screen a 1 km² solar farm site 5 km west of Évora, Portugal"],
};

// rand: () => [0, 1), so tests can pin the pick.
export function pickExamples(pool = EXAMPLES, rand = Math.random) {
  return Object.values(pool).filter((list) => list.length).map((list) => list[Math.floor(rand() * list.length)]);
}
