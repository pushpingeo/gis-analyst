# Decisions log

Judgement calls made while building, newest first. Bigger product decisions live in the plan doc (`tobler-workspace-plan.md` in the claude.ai project).

## 16 Nov 2026

- **Welcome panel copy v2 (Rob's text).** "Soon" chips answer in the conversation without calling the model, so tapping them costs nothing. "Draw an area" switches the map to polygon drawing and, on a phone, lowers the sheet so the map is free. Example quote marks are drawn by CSS, so the example is sent exactly as written. All three "soon" chips get the dimmed, dashed style for consistency. The tagline is indented to line up with the title text; on a phone it stays hidden, as before.

- **Scale is worked out, in Rob's order.** The request first (the analyst passes `scale` to `make_place` only when the words say it and the shape doesn't show it), then the shape's size (unchanged thresholds: up to ~50 km local, up to ~1,000 km regional), then the zoom level for a drawn point (a point has no size, so it takes the width of the map view when dropped). The card's tooltip says which. The project summary now gives the map view's width, so the analyst knows the scale being looked at before there's a place. Points found from words with no stated scale stay local. Place-finding skill 3.2 says this.

- **Version stamps from file content, through the import map.** `scripts/stamp.mjs` gives every module, the stylesheet and every fetched file (skills, catalogue, reference data) a `?v=` from a hash of its content, written into `workspace.html`. Only files that changed are fetched again, and each module resolves to one stamped URL so none loads twice. `npm test` fails if the stamps are stale, so run `node scripts/stamp.mjs` before pushing. The page itself is still cached for up to 10 minutes by GitHub Pages; that's the remaining window for a mix of old and new, and nothing in the files can close it. `index.html` and `tools.html` keep their hand-written `?v=m2b` stamps for now.
- **Direction change (from the plan):** step 3 is places through the atlas; NTR moves to step 4; GIS file drop and web services move to phase 7; scale is derived (request, then geometry size, then zoom), never asked.
