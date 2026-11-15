# GIS Analyst

An AI geospatial analyst built the way you'd want one built: an agent that follows **skills** (written-down method), calls **tools** (deterministic spatial operations) and looks things up in a **catalogue** (what the data is, who publishes it, and on what terms).

The first skill is non-technical risk (NTR) screening of a project site, framed in IFC Performance Standard terms. It's tested against 45 real IFC-financed projects whose locations were checked by hand.

## Status
Milestone 1: the skill text, the concept catalogue and the spatial tools. No AI yet.

- `skills/ntr-screening/SKILL.md`: the method the agent will follow.
- `catalogue/catalogue.json`: concepts (protected area, settlement, farmland…) mapped to sources. OpenStreetMap only for now.
- `js/tools.js`: one Overpass request per site, then distances and bands with Turf.
- `index.html`: a page to run the tools on any evaluation site and see the results on a map.
- `data/eval-sites.json`: the 45 evaluation sites, with IFC's own answers for checking.

## Run the tests
```
npm install
npm test
```
