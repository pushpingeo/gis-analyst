# Decisions log

Judgement calls made while building, newest first. Bigger product decisions live in the plan doc (`tobler-workspace-plan.md` in the claude.ai project).

## 17–18 Nov 2026 (overnight): cartography, step 3 closed
- **Findings by theme** (`js/findings.js`): biodiversity green, land and livelihoods ochre, Indigenous Peoples
  violet, cultural heritage pink, community health and safety blue, operating context slate; red stays for the
  person's site. Checked with the dataviz palette validator (lightness, chroma, normal-vision pass; green/ochre in
  the CVD 6–8 band, so the key and labels carry the theme too). The analyst tags each search with a theme
  (`theme` on `find_features_near` and `get_data`; NTR 3.2-draft says to); otherwise feature type or atlas concept
  decides, then "context".
- **Emphasis by distance from the site's edge:** on site or within 1 km strong, 1–5 km medium, beyond faint.
  Areas over 200 km² get an outline and the faintest fill and sit underneath; operating-context areas are quieter
  still. Labels only for features within 1 km and the nearest three per theme; tap a point or outline for its name,
  theme, distance and source. Dashed distance rings (1/5/20 km onshore, 2/10/50 km offshore) round the site searched.
- **Map key** ("On the map", top right; below the hint on phones, closed by default there): one row per theme with a
  count and a switch, and Clear. Rob's call to live with it for a day or two and revisit.
- **Corridor clipping:** `make_place` takes `clip { to, within_km }` (to within a distance of a feature, or to an
  outline). "A 1 km corridor along the M9 within 5 km of Linlithgow": 12.2 km² cut to 10.2 km², 25 s.
- **Labels:** source, project and supplier columns and short all-capital codes aren't taken as names (road numbers
  still are); descriptive fields (habitat, class, designation) are the fallback.
- **Turn speed measured** (model and tool time per round in the log and the replay): corridor 25 s (8 s model over
  4 rounds; was ~90 s), Rosebank screen 45 s (24 s model, 7 rounds), Linlithgow solar screen 28 s (16 s model,
  5 rounds). Slowest single searches 10–15 s (settlement and protected-area searches waiting on OpenStreetMap or many
  atlas layers). No further cuts needed now.
- **Step 3 closed.** Parked, with reasons: atlas name index and catalogue export (atlas chat); admin boundaries as
  places (OpenStreetMap outlines cover most asks); held-out confidence check and atlas-feature evaluation set (until a
  place-finding evaluation rerun is wanted).
- **Seen in testing, not fixed:** the analyst sometimes picks an odd theme (a place of worship as "indigenous",
  flood zones as "context"); the key opens on a desktop-sized load even if the window is later narrowed.

## 17 Nov 2026 (night): fixes from Rob's Rosebank test
- **Distances from the edge:** `find_features_near` measured from an area's centre; for areas and lines it now searches a
  circle covering the shape plus the radius and measures from the shape's edge (0 = inside), and reports `found` vs
  `listed` (nearest 15 listed) so counts don't drift.
- **Findings stay on the map:** features from `find_features_near` and `get_data` go to their own layer (orange,
  labelled by name) for the session; a later search never wipes them (before, one shared layer was replaced by each
  search, including empty ones). `show_on_map` fits the view to some or all findings, or clears them.
- **No ids for the person:** ids (C3, D2) are tool handles only; map labels are names. Place-finding 4.11.
- **Session log:** every turn's tool inputs and outputs are kept in the page (`window.toblerLog`) and can be saved
  from any "How I worked this out" ("Download the log"), so Rob can attach a log instead of pasting.
- **`get_data`** reports what the service returned for the box and hints when it returned nothing at all.
- **NTR 3.1-draft:** fetch out to the wider band (50 km offshore) then sort into bands; suspect the dataset when an
  expected layer comes back empty.
- **Atlas requests:** an NSTA "(WGS84)" pipeline record that points at *removed* pipelines (why Rosebank showed none);
  EMODnet layers held as WMS only with "licence not stated", though EMODnet offers WFS and CC-BY 4.0 (Rob's wrecks find).
- **Tested live:** Rosebank found and screened; "protected areas within 50 km … show them on the map" found 4 NatureScot
  features measured from the field edge (Faroe-Shetland Sponge Belt ~20 km) and fitted the map to them.
- **Rough edge:** layers without a name field get a poor label (e.g. "JNCC", taken from a source column).

## 17 Nov 2026 (late evening): NTR for the workspace, trusted services, licence rule, FIRMS
- **NTR split (Rob):** the evaluated IFC skill is frozen as `skills/ntr-screening-ifc` (method byte-identical; only the
  header name changed) for the lab page and the evaluation. A new `skills/ntr-screening` (3.0-draft) is the
  workspace skill: onshore and offshore, IFC themes kept as structure but not IFC's verdicts, and it says *what
  evidence to look for* (with search words) so the analyst finds the datasets itself with `find_data`/`get_data`.
  Few evaluations from here: smoke tests on hand-checked cases unless one adds real value.
- **Distances:** default bands per setting (onshore 1/5/20 km, offshore 2/10/50 km, the offshore ones a draft for Rob
  to correct); the person can change any of them in chat and the skill keeps theirs for the conversation. A settings
  editor comes with the run card in step 4.
- **Licence rule (Rob):** data under Esri's Master License Agreement isn't used unless the person holds an Esri
  licence (setting `tobler.esriLicence` = "yes" in the browser; the settings gear comes in step 4). Classes in
  `js/licence.js`: open, esri-mla, non-commercial, unknown (not stated), stated (other). `find_data` leaves Esri copies
  out and says how many; `get_data` refuses them. Open and trusted sources rank first.
- **Trusted global services (`catalogue/trusted.json`):** services Tobler calls directly (NASA FIRMS VIIRS and MODIS,
  because the atlas only has Esri's copy) and trusted publishers (NASA, ESA/Copernicus, NOAA, USGS, UNEP, FAO,
  GEBCO, EMODnet, national nature and heritage bodies…) ranked first among atlas results. Long term the atlas should
  carry a trusted tier (requested).
- **FIRMS:** `tobler-api` has `POST /firms` (sources allow-listed, box ≤ 400 square degrees, 1–10 days, CSV to GeoJSON,
  300 calls per visitor a day, NASA's error text never echoes the key). `get_data` on a FIRMS service asks all
  three VIIRS satellites at once. The key (`FIRMS_MAP_KEY`) wasn't visible in the repo secrets at the time of writing,
  so FIRMS is untested live; the deploy no longer loads empty secrets over ones set elsewhere.
- **find_place:** the catalogue also searches the name without kind words ("Mars platform" → "Mars").
- **Workspace analyst:** 14 rounds a turn (a screening asks many datasets); NTR no longer "coming soon" in the prompt.
  The "Screen for risks · soon" chip is unchanged (public text: Rob's call).
- **Blocked by the atlas (20:10 UTC):** `fetch_features` fails with "No dataset with id …" for nearly every dataset
  after the atlas's shard change (commit daf3023); requested as urgent. Replays after that are mostly "not checked":
  Linlithgow solar screen (settlements, schools and rivers found; SEPA flood, HES monuments, Hutton land capability
  not checked) and Mars (not found, because the NOAA platform layer couldn't be fetched).

## 17 Nov 2026 (evening): catalogue tools, confidence from the place, no false absence
- **`find_data`** (`js/datatools.js`): searches the atlas catalogue by words in dataset titles and publishers for an
  area (`find_datasets` with `text` and a bbox). One entry per title and publisher; fetchable datasets first; short
  ids (D1…); the Esri Master License Agreement is named and flagged for checking before commercial use. Retries once
  when the atlas says it's overloaded. When nothing matches it says what was searched and to try other words.
- **`get_data`**: fetches one dataset's features for a place's box plus a margin (`fetch_features` with `id`, `bbox`,
  limit 100), measures each from the place's edge (0 inside or touching; vertex-based, fine for screening), keeps
  those within `within_km` (default 0 for areas, 10 for points), nearest first (inside: nearest the centre), and puts
  them on the map as candidates. Returns a few key attributes (dates as ISO, ArcGIS epoch milliseconds converted),
  publisher, licence and the time checked. Picture-only datasets and failed services come back as "not checked",
  never as nothing found. Time-aware layers carry a note that they show recent detections only.
- **Confidence inherited:** a shape built on a place already on the map starts from that place's confidence (a
  drawing counts as high); offsets cap it at medium, failed checks at low; checks don't raise it. Mars: the 20 km
  circle was "low" because the anchor rules read the platform point as nothing specific.
- **No false absence:** the conversation prompt says never to claim data doesn't exist unless `find_data` searched
  for it, with the words and area; if no tool could check, say so. The "coming soon" line now offers the catalogue tools.
- **Areas for catalogue searches:** country aliases (United States, UK…); for countries spanning the date line
  (USA, Russia, Fiji, New Zealand) the largest part only, because the USA's box covered the world; common seas and
  basins by name (Gulf of Mexico/America, North Sea, Gulf of Guinea…); any other named area via OpenStreetMap;
  then the map view. This also fixes `find_place` with `kind` and `area`, which had silently searched nothing for
  "United States" and "Gulf of America".
- **Tested:** 8 unit tests (`test/data.test.mjs`, atlas faked); Rob's Mars conversation replayed through
  `try-requests` (Haiku, real atlas): VIIRS and MODIS found and checked, EFH 32 species areas inside the circle,
  failed services reported as not checked; after the area fix, Mars found in one search, 46 s and 11 s turns. Live on
  asktobler.com (desktop-app browser): "Put a 20 km circle round the Mars platform in the Gulf of America and check it
  for thermal anomalies" → high-confidence circle, NASA VIIRS checked, no detections, snapshot caveat given.
- **Known rough edges:** fetched features replace the map's candidate layer (two `get_data` calls at once show only
  the last); the analyst sometimes shows D ids to the person; NTR itself is still "coming soon", so "environmentally
  sensitive" is answered from whichever datasets the analyst picks, not from a written method.

## 17 Nov 2026 (evening): scope reset, Tobler is a screening tool
- After Rob's Mars test (the analyst wrongly said VIIRS isn't in the catalogue; the atlas holds 7 VIIRS datasets,
  including NASA's global thermal hotspots layer), Rob set the scope: Tobler is a geospatial screening tool, NTR first,
  area discounting after. Place finding supports screening. Speed and ease of use count as screening needs, so
  corridor clipping stays and the atlas name index is requested again.
- No tuning around the model; it stays one config setting. Quality comes from tools and skills.
- Modular: the atlas stands alone; tools stay in the page; skills are written to lift out (standard SKILL.md header,
  method in plain terms naming operations rather than Tobler functions, a short "Tools in Tobler" mapping, nothing about
  Tobler's screens). NTR's evaluated method stays word for word, or the evaluation is rerun.
- Next, in order: catalogue tools (find data, get data); confidence inherited from the anchor; never claim absence
  without a way to check; skills in the portable format; NTR on places; corridor clipping and turn speed; name index
  (atlas). Full list and the Mars test write-up in the plan doc's handover.

## 17 Nov 2026 (evening): Tobler's own Worker, tobler-api
- Tobler's Claude and atlas calls now go through `tobler-api` (code in `worker/`, see `worker/README.md`), not demo 1's `north-sea-geo-demo`. Switched in one line (`proxyUrl` in `js/config.js`); demo 1's Worker is untouched and still serves demo 1.
- Deployed by the **Worker deploy** Action on changes under `worker/`: tests, `wrangler deploy`, secrets loaded with `wrangler secret bulk` from the repo secrets, then a live check. Secrets used: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `ATLAS_MCP_KEY` (checked first with the harmless **Worker secrets check** workflow).
- The Worker's Anthropic key is `ANTHROPIC_API_KEY`, the same secret the evaluations use (it was the only Anthropic secret in the repo). One key, one spend limit in the Console; split later if page use and evaluation spend need tracking separately.
- Counters in a Durable Object (SQLite-backed, one per visitor per day plus one daily total) instead of KV, so the caps are exact under parallel calls. Visitors are keyed by a hash of the IP. Calls are counted before going upstream (simpler and tighter than counting after; failed calls count).
- Same limits as demo 1 (200 Claude calls per visitor a day, 5,000 in total, 2,000 atlas calls per visitor), as vars in `worker/wrangler.toml`.
- Allowed origins: asktobler.com, www.asktobler.com, pushpingeo.github.io, localhost:8000. Not asktobler.ai/.io (they don't serve the site).
- Only `system`, `messages`, `tools` and a capped `max_tokens` are forwarded to Claude, as before.
- `compatibility_date` 2026-08-01, because local workerd (Miniflare 4) doesn't support later dates yet. Miniflare 4 is pinned for the tests because the Miniflare that ships with the latest wrangler is a beta with a different options format.
- `index.html` (the earlier agent page) also reads `js/config.js`, so it moved to tobler-api too.

## 17 Nov 2026 (early hours)

- **Place-finding v4 evaluation (skill 4.2, atlas on, Overpass down throughout):** 46 of 48 described sites placed (v3: 43), median 2.46 km, 70% within 5 km. On the 42 sites both placed, accuracy is unchanged (74–76% within 5 km, 86% within 10 km). What changed is confidence: low now means worse (median 5.6 km, against 1.6 for high), and 14 failed checks pulled placements to low. Two high-confidence misses remained (Nachtigal 22 km, Kinguélé Aval 11 km). The atlas supplied 8 anchors; 15 of 84 feature searches failed.
- **Only tight checks raise confidence (skill 4.7).** A check within max(3 km, 35%) of a 250 km clue passes almost anywhere; a distance without a direction is a ring. Tight (tolerance ≤ 5 km) directional checks count 2, tight distance-only 1; high needs 2. Replayed on the v4 results: high goes from 11 sites at 1.6 km median to 5 at 0.7 km; Nachtigal drops to medium. Drawn from the same 48 sites, so it needs a held-out check.
- **Atlas layer choice:** national and intergovernmental publishers first, local bodies and unknown publishers claiming global extents last, up to 20 of the top 100 layers; pieces of one site within a layer merged; `fetch_features` can search by name inside a layer (atlas change, same night).

## 16 Nov 2026 (night)

- **The atlas is a feature source alongside OpenStreetMap** (`js/atlasfeatures.js`). `find_features_near` asks both at once: the atlas finds layers with the right concept around the point (skipping layers flagged with an overstated extent), fetches from up to five, and the results are merged. Each source is reported as found, or "not checked" with the reason; a failed source is never reported as "none". The evaluation calls the atlas with `ATLAS_MCP_KEY`; the page calls it through the Worker's `/atlas` route, which doesn't exist yet (see `docs/worker-atlas-route.md`, for Rob), so on the live site the atlas shows as "not connected" until then.
- **Atlas features count as authoritative only when the publisher is a government or intergovernmental body.** A university's copy or a third-party summary counts like a gazetteer (medium until a check passes).
- **Holes in published outlines are filled, with the area it adds stated** (Beatrice: 2 holes, 0.06 km²). The map editor can't hold holes; before this the analyst swapped the outline for a circle of the same area and called it high confidence.
- **Checks spell out direction both ways** ("the site is 68 km NW of Lubumbashi; Lubumbashi is SE of the site"), after the analyst inverted one in a live test.

- **Place-finding skill v4: confidence is worked out in code (`js/confidence.js`), not chosen by the model.** v3 showed the model's "high" was less reliable than its "medium". The model now says how the anchor matched (`named_place`, `name_and_type`, `type_near_clues`, `name_only`, `settlement_or_region`, `none`) and passes every distance clue as a check; the tool measures each check from the place it built (pass if within max(3 km, 35%) and, beyond 2 km, within 45° of the stated direction). Rules: authoritative layer or the place the person named → high; Wikidata/OSM by name and type, or right type where clues point → medium; settlement, region, name only → low. Any failed check → low. Medium rises to high with one passing check (two for a type-only match). Offsets and points for large features cap at medium. A "name and type" match that is actually a village is treated as a settlement (the Sierra Rutile case). The thresholds are first guesses, to be judged on the v4 evaluation, not tuned to single sites.
- **Overpass from GitHub's runners:** a probe (`scripts/probe-overpass.mjs`, workflow `overpass-probe.yml`, no API cost) found all three public servers timing out on a trivial query at 14:13. The evaluation now probes before it starts and records the result and the count of failed feature searches in its summary, so a run without OpenStreetMap can't be mistaken for a method result.

- **Welcome panel copy v2 (Rob's text).** "Soon" chips answer in the conversation without calling the model, so tapping them costs nothing. "Draw an area" switches the map to polygon drawing and, on a phone, lowers the sheet so the map is free. Example quote marks are drawn by CSS, so the example is sent exactly as written. All three "soon" chips get the dimmed, dashed style for consistency. The tagline is indented to line up with the title text; on a phone it stays hidden, as before.

- **Scale is worked out, in Rob's order.** The request first (the analyst passes `scale` to `make_place` only when the words say it and the shape doesn't show it), then the shape's size (unchanged thresholds: up to ~50 km local, up to ~1,000 km regional), then the zoom level for a drawn point (a point has no size, so it takes the width of the map view when dropped). The card's tooltip says which. The project summary now gives the map view's width, so the analyst knows the scale being looked at before there's a place. Points found from words with no stated scale stay local. Place-finding skill 3.2 says this.

- **Version stamps from file content, through the import map.** `scripts/stamp.mjs` gives every module, the stylesheet and every fetched file (skills, catalogue, reference data) a `?v=` from a hash of its content, written into `workspace.html`. Only files that changed are fetched again, and each module resolves to one stamped URL so none loads twice. `npm test` fails if the stamps are stale, so run `node scripts/stamp.mjs` before pushing. The page itself is still cached for up to 10 minutes by GitHub Pages; that's the remaining window for a mix of old and new, and nothing in the files can close it. `index.html` and `tools.html` keep their hand-written `?v=m2b` stamps for now.
- **Direction change (from the plan):** step 3 is places through the atlas; NTR moves to step 4; GIS file drop and web services move to phase 7; scale is derived (request, then geometry size, then zoom), never asked.

## 17 Nov: place finding searches the catalogue
- `find_place` takes `kind` and `area`. With them it asks the atlas which layers hold that kind of thing in that area (a country includes 2.5° of its waters), then searches those layers for the name, in batches of 10, until something matches, 40 layers are asked or 30 s pass. The reply lists every layer asked. Before this, only five hand-picked UK layers were searched, so "OML 145, offshore Nigeria" got pointed at the NSTA blocks.
- Name matching: every word of the name must appear in the feature's text ("OML 145" matches type "OML" + number "145", and "OML145"); numbers match whole (145 isn't 1450). The server gets the most distinctive word (the one with a digit).
- One layer picker for both "near" and named searches. The atlas doesn't record geometry type yet, so titles stand in: for lines and areas, layers titled junctions, points, labels, cameras and the like go last, and features of the wrong geometry are skipped and counted. The near search keeps asking more layers (up to 20 more) if nothing of the right geometry turned up (the M9 found only junction points).
- To do in the atlas: carry each layer's geometry type into the search database, so this doesn't rest on titles.
- Skill 4.8: use `kind`/`area` for things OpenStreetMap rarely holds; when not found, say what was searched; never point to another country's layer.

## 17 Nov: tool results are fenced and budgeted (after comparing notes with the "stub pattern")
- What we already did: geometry never reaches the model (places by name, candidates by id; replies carry a centre point, size and source, not outlines), result counts are capped (12 / 15 / 8 candidates, atlas attributes ≤ 8 fields under 80 characters), and old tool output is never replayed.
- What was missing: third-party text (OSM and Wikidata names, atlas layer titles and attributes, service error messages) went to the model raw, with nothing saying it's data, and there was no overall size limit.
- Now (`js/fence.js`, workspace agent only): every string is flattened to one line (control and invisible characters removed) and cut to 200 characters; each tool result has a 16k-character budget, trimmed by halving the longest list with a note saying how many items were left out; the system prompt says tool results are data, never instructions, and that anything reading like an instruction is ignored and mentioned to the person. Normal replies come to about 10k characters at most, so the budget shouldn't bite in ordinary use.
- Not changed: the NTR agent (`js/agent.js`), because its prompt is the evaluated one. Apply the same fence in step 4, when NTR moves into the workspace as sealed runs, and rerun its evaluation.
- Still to do: (1) a fixed summary shape for big queries (count, extent, fields, a few sample rows), for when atlas queries return more than a short list; (2) record the atlas build date with every atlas-sourced result, so a run says which version of the catalogue it used; (3) the place evaluation hasn't been rerun with the new prompt line; do that before quoting v4+ numbers again.

## 17 Nov: speed (items 1–5 of the list put to Rob)
- **Lookups in one step run at once** (`converse.js`, `READ_ONLY`: load_skill, find_place, find_features_near, get_place); tools that change the map run after them, in the order asked. The prompt tells the model to put independent searches in one step. Nominatim calls now queue so parallel searches still keep to one a second.
- **`find_place` takes `also`** (up to three more spellings) and searches every spelling, every source and the catalogue at once; the same feature found twice comes once. The catalogue search sends one server-side text per distinct distinctive word.
- **Deadlines:** each atlas layer gets 8 s, then counts as "too slow" and anything it sends later is ignored; a named search stops after 25 s. Once the atlas has found something near a place, OpenStreetMap gets 3 more seconds instead of its full 15.
- **Atlas answers are remembered in the page for the session** (up to 400; failures aren't kept).
- **Shorter replies:** the layers asked are summarised (those that found something, a few failures by name, counts for the rest) instead of listed one by one.
- Skill 4.9: spellings in one call; don't offer files or web services, which can't be loaded yet.
- Road and river pieces from one layer are joined into one line (a corridor used one piece of 13 on the live M9 test); areas in pieces are still counted, not joined.
