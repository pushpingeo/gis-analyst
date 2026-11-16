# Tobler

*Formerly GIS Analyst. Named after Waldo Tobler, whose first law of geography says near things are more related than distant ones. Domains: asktobler.com, .ai, .io (not yet pointed at the site). The repo was renamed from `gis-analyst` on 16 November 2026; the site is at pushpingeo.github.io/tobler.*

An AI geospatial analyst built the way you'd want one built: an agent that follows **skills** (written-down method), calls **tools** (deterministic spatial operations) and looks things up in a **catalogue** (what the data is, who publishes it, and on what terms).

The first skill is non-technical risk (NTR) screening of a project site, framed in IFC Performance Standard terms. It's tested against 45 real IFC-financed projects whose locations were checked by hand.

## Status
Milestone 1: the skill text, the concept catalogue and the spatial tools. No AI yet.

- `skills/ntr-screening/SKILL.md`: the method the agent will follow.
- `catalogue/catalogue.json`: concepts (protected area, settlement, farmland…) mapped to sources. OpenStreetMap only for now.
- `js/tools.js`: one Overpass request per site, then distances and bands with Turf.
- `index.html`: a page to run the tools on any evaluation site and see the results on a map.
- `data/eval-sites.json`: the 45 evaluation sites, with IFC's own answers for checking.

## Workspace (in progress)
`workspace.html` is the new public interface: a map and a conversation in one place, where you mark or describe an area and the agent works through it. The plan is in the project notes; it's being built in steps.

- **Step 1 (this):** the layout, drawing and editing tools (point, line, area, rectangle, circle; move, reshape, add or remove corners, rotate, resize), and reference data from Natural Earth that says where a shape is, how big it is and what scale of work it looks like. No AI yet.
- `js/geometry.js`: deterministic shape operations (rotate, resize, square or circle of a given area). The agent will use the same functions.
- `js/reference.js`: country, coast distance, nearby towns and scale for any shape.
- `data/ref/`: Natural Earth layers, built by `scripts/build-reference.mjs`.
- `js/vendor/`, `fonts/`: MapLibre, Terra Draw, Turf and Public Sans, bundled by `scripts/build-vendor.mjs` so the page doesn't depend on CDNs.

## Run the tests
```
npm install
npm test
```
