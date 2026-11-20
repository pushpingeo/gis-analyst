# Site footprint vs search area (20 Nov 2026)

From Rob's Cnoc Buidhe screen. Code: `js/siterole.js`; decisions log, 20 Nov (evening).

## The problem
`find_place` found no outline for the Cnoc Buidhe Wind Energy Hub (39 wind-farm layers for Kintyre, nothing), so
`make_place` built a 2.5 km-radius circle (19.6 km²) 2.5 km east of Bellochantuy. The screen measured from its edge
and called anything touching it "on site": "SPA, Ramsar site and IBA (Kintyre Goose Roosts) on site", high
confidence. The roost clips the circle's eastern edge, and nobody knows where the 29 turbines are. The circle is a
statement about where the site might be, not the site.

## What a place is (set in code, never by the model)
| Role | When | Screened as |
|---|---|---|
| `footprint` | a published outline (`shape: "feature"`, not moved, not a namesake or region), or drawn by the person | the site: "on site" |
| `area` | a shape the person asked for round a found place (`match: named_place`: "3 km² round Jackdaw") | the site: "on site" |
| `search_area` | built from clues round an anchor that isn't the asset; a region or namesake outline; the default footprint round a point | "in the search area", share covered, confidence capped |
| `point` | a point | (screened on its default footprint: a search area) |

## A screen of a search area
- Each feature inside: `in_search_area`, `coverage` (share of the area, overlay in a Lambert azimuthal equal-area
  projection centred on it), `side` (middle, or which side). Band "in the search area".
- Flags resting on it: `relation: "in the search area"`; confidence capped at medium, or low when every area inside
  covers under 10% (`LOW_COVERAGE`, for Rob); severity unchanged; `confidence_capped` records it.
- The analyst is told in its first message and sees "in_search_area" in tool output. Its "on site" wording is changed
  in code (`reword`). The headline tells the conversation to say so.
- Map: thin dashed outline, "· search area" label. Place card: "What it is". Run card and report: a lead line,
  "Screened a 19.6 km² search area (built from clues round Bellochantuy), because the site's outline wasn't found…".

## Still to do
- **Self-match:** before and during a screen, a feature of the asset's own type with a similar name overlapping the
  search area is offered as the footprint. Needs name search in the right layers (atlas request, 20 Nov evening).
  NatureScot's wind farm proposals were checked by hand: no Cnoc Buidhe (layer revision Sept 2024; the application is
  2025).
- **Evaluation:** known footprints (NatureScot wind farms, NSTA fields, mines with outlines) rebuilt as search areas
  from described locations; count "on site" claims the footprint doesn't support, before and after.
- **A way to say "this is the outline"** for a place built from words (a toggle on the shape card). Drawing it works
  today.
- Seen in the same run, not fixed: "nearest town Ayr, 66.2 km" at site scale (Natural Earth's list; Campbeltown is
  about 7 km away); the Wikidata Bellochantuy point is ~1.4 km south of OpenStreetMap's.
