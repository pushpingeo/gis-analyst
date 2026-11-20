# Decisions log

Judgement calls made while building, newest first. Bigger product decisions live in the plan doc (`tobler-workspace-plan.md` in the claude.ai project).

## 18 Nov 2026 (22:30): welcome examples: global, calm, rotating (Rob)
- The examples (Jackdaw, block 30/2, Linlithgow) were UK and oil-and-gas. Now one of each kind (find, shape, screen)
  is picked at random on every load from a small pool (`js/examples.js`): find: Linlithgow Palace and 5 km around
  it; Lake Tekapo, New Zealand. Shape: a 2 km square round the Kinderdijk windmills; 10 km round Peggy's Cove,
  Nova Scotia; 3 km round Mont-Saint-Michel. Screen: a small wind farm site near Lemvig, Denmark; a small solar
  farm site near Évora, Portugal. The page's own HTML holds one set, so it still reads right before the script runs.
- Chosen by running candidates through the live analyst (`try-requests`, Haiku and the real atlas, three rounds):
  kept: Linlithgow 8 s; Lake Tekapo outline (OSM); Kinderdijk 10 s (centred on the village; the mills fall inside);
  Peggy's Cove 7 s; Mont-Saint-Michel as "mark out 3 km" (read as a radius; "draw 3 km around" was read as across);
  Lemvig: placed and screened in one go, 91 s, designated nature, a power line, Natura 2000 nearby; Évora 77 s,
  other solar farms nearby, Natura 2000 at 6.5 km. Dropped: "what's around Lake Tekapo" (30 s of searching, no
  shape); a solar farm "just outside Tucson" (the analyst's guessed spot fell in Saguaro National Park); "the Jutland
  coast" (too vague; the site ended up in a fjord); Marana (asked questions first); Red Rock, Arizona (three
  places of that name; the screen landed in a national forest); Herning (screened a town); Tabernas (centred on the
  town); Bakersfield (asked questions first). Places in Australia, northern Canada and the Amazon left out of the
  welcome on purpose (screens there rightly raise Indigenous land, which is heavy for a first click), as are
  places where the atlas is thin.
- Screening examples say where and how big ("Screen a 1 km² wind farm site 3 km south-east of Lemvig, Denmark";
  "a 1 km² solar farm site 5 km west of Évora, Portugal"): live in Rob's browser, "a small solar farm site near
  Évora" made the analyst ask where and how big, though the same words had gone straight ahead in Actions. The
  explicit wording went straight to a screen 4 times out of 4 (Évora 50–63 s, Lemvig 71–98 s, consistent flags).
- Found on the way: a name the analyst gives a place ("Tabernas solar site (placeholder)") is now used as given;
  tidying had cut the brackets, so its next call missed the place. `try-requests` now keeps place names as the
  page does.

## 18 Nov 2026 (22:00): a quieter composer (Rob)
- The links under the input (how the screening was tested, the earlier agent page, the code) moved into the
  settings dialog under "About", with one line on what Tobler does and what's coming next (draft wording, for Rob).
- Chips: "Find a place" and "Draw an area" removed (typing finds; the Draw button draws); the two "· soon" chips
  removed (now mentioned in About). One chip remains, "Screen this location for risks", shown only once there's a
  place; it fills "Screen <place in focus, or the latest place> for risks" in the input.
- Tested: headless Chrome 73 checks at desktop and phone sizes.

## 18 Nov 2026 (21:45): shape cards: Adjust instead of a banner (Rob)
- Rob found the drag/reshape/delete banner too prominent. Now the banner shows only while drawing (with Cancel).
- Each shape card has one row: "Use this area" and "Not quite" (while proposed), **Adjust**, then a zoom icon
  and the bin (moved down from the header). Adjust turns on the shape's drag handles on the map and opens a small
  panel on the card: how to drag and reshape, the rotate buttons and the resize box (all moved in from the always-on
  row), and Done. Adjust again, Done, Escape or a click on the empty map ends it.
- Clicking a shape on the map no longer gives it handles: it just brings its card forward and makes it the place
  in focus, so a stray drag can't move a site. A newly drawn shape is focused, not selected.
- Tested: headless Chrome 67 checks at desktop and phone sizes (card row, click focuses without handles, Adjust
  gives handles and controls without a banner, Done closes).

## 18 Nov 2026 (21:30): places named after what they were built from (Rob)
- Rob expected names, not "Area 1". The 17 Nov fix had put feature names on the map labels for findings; places
  themselves were still counted ("Area 1", "Point 2"). Now `make_place` names a place after its anchor and shape:
  a square, circle or rectangle as "Jackdaw 3 km²", a published outline by its own name ("Linlithgow Loch"), a
  corridor as "M9 corridor", a point by the anchor's name. The analyst can pass a shorter `name` in the person's
  words. Names are tidied (register capitals to title case, tracker suffixes like "Oil and Gas Field (Nigeria)"
  dropped, 40 characters at most) and kept unique ("(2)"). A shape the person draws keeps "Area 1" until renamed.
  Every place still answers to its counted name too, so "Area 1" in a tool call or the Screen chip still works.
- Tested: unit test of the naming rules; all suites; browser regression.

## 18 Nov 2026 (21:00): UX pass: screening progress, globe, tools by the input, hint placement (Rob)
- **A screen says it takes time, with an estimate.** When `screen_site` starts, the reply shows a progress block
  at once: "Screening Area 1. This usually takes about 70 seconds (typical for an offshore site)…", a bar and
  the step in hand with seconds so far. The estimate is the median of this browser's last screens of the same
  kind (offshore, onshore, inside only; kept in `tobler.screenTimes`, last 5 each), or a typical figure until
  there are two (offshore 70 s, onshore 100 s, inside 45 s, from the smoke tests). The bar is a proxy: the
  baseline is the first fifth, then the analyst's rounds (usually 5–8), then the write-up, never ahead of what's
  done and never past 96%; past 1.3× the estimate it says "taking longer than usual". The card's header then
  says how long it took. Engine events added: `screen_start`, `baseline`.
- **A spinning globe** replaces the pulsing dot in the activity line (meridians sweep while busy; still when idle).
- **Drawing tools moved from the map to a tray above the input**, opened by a Draw button at the left of the
  input (or the "Draw an area" chip). "Done" closes it. The map's top-right corner now belongs to the map key,
  which used to sit on top of the tools. On a phone the sheet still folds down while drawing, and the tray stays
  in view with the input.
- **The hint moved out from behind the panel**: on desktop it sits at the foot of the map, centred on the part
  the panel doesn't cover; on a phone, at the top. It carries Cancel while drawing and "Delete shape" when a shape
  is selected (the toolbar's select and delete buttons went with the toolbar).
- No ids in progress or activity lines ("Fetching heritage data for Area 1", not "Fetching D2").
- Tested: headless Chrome `scripts/browser-run-card.mjs` 63 checks at desktop and phone sizes (tray, Cancel,
  Done, hint clear of the panel, Delete on a selected shape, progress block with estimate and step, globe, no
  ids, progress gone and the time on the card), all unit suites.

## 18 Nov 2026 (20:00): inside-the-area option for area screens; the settings gear (Rob)
- **Area screens default to the area and its surroundings** (unchanged: fetched out to the wider band). Rob asked
  for the option to keep a screen within the polygon. Two ways in, one idea:
  - **On the run card (any area screen):** a switch, "Area and surroundings | Inside the area only". Inside uses
    the evidence already fetched (distance 0 = inside or touching the edge), so it's instant and free; the map dims
    everything outside the area, the rings go, the slider hides, and "Re-assess inside the area" rewrites the flags
    for the inside only (one model call, as the slider's re-assess). Switching back returns to the last distance.
    Chosen over asking up front: the default stays fast to start, and the person can compare both views of one run.
  - **Asked for in words** ("only inside the block"): `screen_site` takes `extent: "inside"` (areas only; a point
    or line is screened with its surroundings and the run says so). The run fetches only inside (within 0 km), so
    it's quicker on big areas; the analyst is told the surroundings weren't screened and to put that in the gaps;
    the card says so and has no switch (nothing outside was fetched). The record carries `extent`.
- **Settings gear** (panel header; a dialog; saved in the browser): the Esri licence and non-commercial switches
  (the existing `tobler.esriLicence` / `tobler.nonCommercial`, read live, so they apply to the next search);
  units (kilometres, miles, nautical miles: display only via `js/units.js`; cards, slider, rings, scale bar and
  shape cards convert; the analyst is told the person's units and still measures in km, giving both); shape
  colour (four presets chosen away from the findings' theme colours, plus any colour; map, drawing tool and
  page follow; errors now have their own fixed red); your own Anthropic key (kept for the tab only, as before;
  this is its first UI in the workspace). Basemap choice and web search left for later.
- Tested: 4 new unit tests (inside-only run, inside ignored for a point, re-assess inside, units); headless
  Chrome `scripts/browser-run-card.mjs` now 41 checks at 1280×820 and 390×844 (scope switch, re-assess inside and
  back, mask and rings, an inside-only screen, settings: miles, colour, Esri switch). Live in Rob's desktop-app
  browser (Haiku, real atlas): a 4 km² box round Linlithgow Palace screened as 20 MW solar (6 flags, 287 findings
  to 20 km); "Inside the area only" left 9, dimmed the outside and re-assessed in 37 s (5 flags); miles and the
  colour applied; settings put back afterwards. Fixed from that: after re-assessing inside, the distances line
  read "near 0 · close 0 · wider 0"; it now says the flags are for inside the area only. Seen, not changed: whole-sea
  and regional layers (North West European waters, "Eastern Scotland") count as "on site" for an onshore box.

## 18 Nov 2026 (19:00): NTR skill 3.4-draft live (Rob approved)
- Changes: start from the baseline; named biodiversity sources (national protected areas, EEA/Natura 2000, WDPA
  only when switched on, IMMAs, coral, MARPOL, national critical habitat; search for IBAs and EBSAs); KBAs "not
  available under licence" once, with what was checked instead; a cross-border (transboundary) flag under context
  with confidence rules and the "indicative, no legal standing" line; weak evidence (unnamed, attribute-less or
  whole-sea scoring layers) at low confidence unless the score shows the risk; non-commercial and boundary data rules.
- Smoke tests (Haiku, real atlas): Rosebank 88 s, 6 flags incl. the UK–Faroe boundary at 10.7 km (medium, traced);
  Bonga: the carousel offered the candidates (GEM answered this time), then the screen found Bonga Southwest Aparo
  at 7.7 km and Bonga North at 24.8 km as neighbours, FIRMS hotspots at 21 km, and the ProtectedSeas layer now low;
  Linlithgow solar 89 s, 6 flags (loch on site, Bo'mains Meadow 1.1 km, Firth of Forth SPA/Ramsar 3 km, cumulative
  solar, schools). Seen: Linlithgow Loch also used as "land" evidence; the analyst said the CDDA licence wasn't
  recorded; HES heritage still failing in the atlas.
- The disclaimer wording stays as drafted (live since late morning) until Rob changes it.

## 18 Nov 2026 (evening): non-commercial data switch; place finding keeps namesakes (Rob)
- **Non-commercial data off by default, like Esri's.** New licence class rule (`licenceBlock` in `js/licence.js`):
  "No commercial use" and similar now classify as non-commercial; such layers are left out of `find_data`,
  `get_data`, `find_features_near` and `find_place` unless the browser setting `tobler.nonCommercial` is "yes"
  (the settings gear will carry it, beside the Esri switch). Each search says what it left out and why. The licence
  rule now applies to the near-feature and named searches too; before, only `find_data`/`get_data` applied it, so
  Esri-licensed layers could come through `find_features_near`. The WDPA baseline layer shows as "not checked
  (non-commercial licence)" unless switched on. `NON_COMMERCIAL=yes` for `try-requests`.
- **Place finding keeps namesakes.** Bonga: the field search accepted outlines only, so Global Energy Monitor's
  field points were skipped and only the ministry's Bonga Main came back. Now fields (and wind farms) prefer
  outlines but accept points, outlines sorted first; for kinds global trackers hold (fields, plants, mines, wind)
  the search asks a second batch when only one layer matched. Live: Bonga 4.4–6.2 s with four candidates when the
  GEM layer answers; Jackdaw 2.1 s, unchanged; Linlithgow Loch 4.8 s (stops at the first match). The carousel
  (`offer_choices`) already exists; the skill offers it when several candidates fit. Not yet seen end to end: the GEM
  layer failed in the atlas on two of three tries ("tile 0_0 unreadable"; request filed).

## 18 Nov 2026 (17:00): fixes from Rob's Bonga log
- **Multi-part outlines.** Bonga Main (Nigeria's ministry layer) is a MultiPolygon; the drawing tool takes single
  shapes only, so `make_place` failed and the analyst fell back to a pin (a 77 km² field screened as a 5 km circle).
  Now the drawing tool holds the largest part and the place keeps the rest (`extraParts`); the place, the map, the
  card, edits from chat and screening use the whole outline; the card notes "published in N parts". Map fill
  layers take MultiPolygons too. Browser-tested headless: a two-part outline draws whole and survives a chat edit.
- **A mistyped id isn't a gap.** The analyst passed a candidate (C1) to `get_data`; the run listed "C1" as a
  source not checked. Now only real datasets and feature searches count as checked or not checked.
- **No land in reach.** Offshore with the coast beyond the wider band (Bonga: 124 km), the first message says
  onshore receptors are out of reach, so the analyst doesn't search for settlements or list them as gaps.
- **The log explains the card.** Baseline checks (boundaries and baseline layers) now appear in the session log and
  in "How I worked this out", marked baseline; the run's flags, checked list and gaps go in the log too.
- Seen, not fixed: the analyst flagged "fishing-protection area overlaps site" from ProtectedSeas' global Level of
  Fishing Protection layer (one unnamed polygon, no attributes shown; the layer scores 1–5 and covers whole seas),
  probably a false flag. The global WDPA in the atlas says "No commercial use" (as does WDPA's own licence): the
  EMODnet WDPA baseline layer carries the same underlying terms. Both raised with Rob.

## 18 Nov 2026 (late morning): screening baseline in code, boundaries, disclaimer (Rob)
- Rob: KBAs aren't the only biodiversity source, and a site near an international boundary is an NTR (effects spill
  over). Split agreed: **catalogue** names the must-check layers (`catalogue/trusted.json` "baseline"), **tools** fetch
  and measure them in code before the analyst starts, **skill** says what they mean (draft 3.4 sent to Rob first).
- Baseline layers (each tested 18 Nov at Rosebank, Mars and Linlithgow): WDPA via EMODnet (European seas and coasts
  only), EEA nationally designated areas (CDDA) and Natura 2000 (EU, not UK since 2021), IUCN Important Marine Mammal
  Areas, UNEP-WCMC coral reefs (tropics), MARPOL special areas, NOAA critical habitat (US). Each applies by box and
  setting ("sea" = offshore or coast within the wider band). Licences recorded with "check before commercial use"
  where the terms aren't open. Baseline datasets get B ids so the analyst's D ids don't shift.
- Boundaries (`js/boundaries.js`): other countries within the wider band from Natural Earth (Tobler's reference;
  onshore that's the land border), maritime boundary lines from VLIZ Maritime Boundaries v12 (CC-BY 4.0 per
  marineregions.org, though the atlas record says "contact VLIZ") with the territories either side and line type.
  Every boundary feature carries the caveat: indicative, no legal standing; VLIZ data isn't for legal,
  resource-exploration or navigation use. No maritime call when there's no sea within reach.
- The first message lists what the baseline found ("Already checked by the run…"); the run record keeps
  `baseline` and `disclaimer`. A boundary named by its territories traces to the line.
- Disclaimer (`js/disclaimer.js`, draft wording for Rob): on the run card and first in every run download; later
  exports and the PDF use the same text.
- Smoke tests (real atlas, Haiku): Rosebank flags the Faroe–UK treaty line at 10.7 km and the Sponge Belt at 20 km;
  Mars flags loggerhead critical habitat on site, no boundary in reach; Linlithgow picks up 59 nationally designated
  areas from the EEA layer. Heritage at Linlithgow still weak (HES layers fail in the atlas; request open).

## 18 Nov 2026 (10:30): FIRMS key on the live Worker
- Rob's live screen reported NASA FIRMS "API key missing". Cause: the Worker's last good deploy (17 Nov 18:34) came
  before `FIRMS_MAP_KEY` was a repo secret, and the two deploys after it (20:06, 20:07) failed their live FIRMS check
  because the secret was still empty. Redeployed (push under `worker/`): the key loaded and the live FIRMS check
  answers 200. Same deploy: the Worker accepts 1–5 days, NASA's limit (was 1–10). Lesson: after adding a repo secret
  the Worker needs, push under `worker/` (or run Worker deploy) and read the log.

## 18 Nov 2026 (05:10): chip, tagline, delete on the card (Rob)
- "Screen for risks" chip live: it fills "Screen <place in focus> for risks" (or "Screen " with no place) and waits
  for Send. Tagline: "Your geospatial screening analyst." Shape cards get a small trash button (deletes the shape
  and greys the card, as the map's delete does), so shapes the analyst made can go without the map tools.
- Tested headless at desktop and phone sizes: chip text with and without a place, delete removes the shape and the
  place, no page errors.

## 18 Nov 2026 (early): step 4 core — sealed NTR runs and the run card
- **Rob's calls (asked first):** the slider re-sorts evidence instantly and flags are re-assessed on tap (one model
  call on the stored evidence, no new fetching); one "show findings up to" slider, not three band handles (bands
  change in chat); smoke tests only, no IFC rerun; core first (out-of-date marking, tray and settings next).
- **Sealed runs (`js/ntrrun.js`).** `screen_site` (conversation tool) starts a run: its own `runTurn` loop with the NTR
  skill in the system prompt, the fence rule, and only `get_place`, `find_data`, `get_data`, `find_features_near`.
  Its tools get their own host: the only place is the site footprint, nothing can be built or renamed, and findings
  go into the run instead of the map. The conversation gets a headline (counts, top flags, what failed); detail
  through `get_run`. The conversation no longer loads the NTR skill itself.
- **Fetch once, to the wider band.** The run raises `get_data.within_km` and `find_features_near.radius_km` to the
  wider band (max 50 km) whatever the model asks, so the slider works inside what was fetched.
- **Run record = GeoJSON FeatureCollection** with a `tobler_run` member (schema `tobler-run/1`): skill and version,
  model, times, site (how found, confidence, anchor source, footprint, setting, asset, stage), distances with
  reasons, method line, flags, checked, gaps, the model's own checked list, usage, past assessments. Features: the
  site (role site) and every feature the tools returned (role evidence) with fid, theme, distance, band, dataset,
  publisher, licence, checked time. Downloadable from the card; the export schema builds on this.
- **Traced evidence.** Each evidence item the model gives is matched to a fetched feature (name, then dataset and
  distance within max(0.5 km, 15%)). Matched items take the fetched distance, band, dataset, licence and date;
  unmatched ones are shown as "not traced to fetched data" (regional knowledge is honestly untraced).
- **"What was checked" comes from the tools**, not the model: each `get_data`/`find_features_near` result is
  features (n), none in dataset, or not checked with the reason.
- **Scale-aware distances (`catalogue/distances.json`, `js/distances.js`), a draft for Rob:** near/close/wider and a
  footprint radius per asset type and setting, with size rules (solar under 5 MW smaller, 100 MW+ wider; wind near =
  10 × tip height, at least 1 km; mine 20 km²+ wider; thermal 500 MW+ wider; offshore wind 1 GW+ wider) and a reason
  shown on the card. The person's own distances win; wider is capped at 50 km (the tools' reach). Points are screened
  as a footprint circle, said on the card.
- **Run card:** flags first (confidence chip, theme swatch, risk, nearest distance), opening a flag picks out its
  evidence on the map; slider with the nearest finding per theme; flags whose evidence is all beyond the slider are
  dimmed; "Re-assess at X km" when the slider differs from the distance the flags were written for; distances and
  why; what was checked; gaps; show on map; download. Showing a run replaces other findings on the map.
- **NTR 3.3-draft:** distances and footprint come from the run when it gives them; method otherwise unchanged.
- **Tested:** `test/ntrrun.test.mjs` (11, atlas and model faked); `scripts/browser-run-card.mjs` in headless Chrome
  at 1280×820 and 390×844 (scripted model and atlas, outline basemap): 20 checks pass, no page errors.
- **Smoke tests (real atlas, Haiku, `try-requests`, 18 Nov ~05:30):** Rosebank (57 s, 6 flags, 43 evidence features;
  pipelines on site, wrecks at 1.9 and 2.4 km, Faroe-Shetland Sponge Belt at 20 km, all traced), Linlithgow Palace as a
  20 MW solar farm (116 s, 6 flags; Linlithgow Loch on site, Bo'mains Meadow 1.1 km, St Michael's Hospital; heritage
  layers not checked because HES fetches fail in the atlas), Mars (44 s, 5 flags; some evidence untraced because the
  model named leases by tool id). Fixes found on the way: (1) Haiku thinks by default and the thinking counts against
  the 8,000-token cap, so big screens were cut off before the JSON: the run now asks for a compact result and short
  thinking, and if the result is cut off asks once for the JSON alone from the same evidence (dropping signed thinking
  blocks); the card says so. (2) NASA FIRMS now accepts 1–5 days (was 10): trusted.json and `get_data` default to 5.
  (3) `find_data` with a concept that finds nothing searches the words alone (wrecks are tagged seabed habitat).
- **Seen, not fixed:** slow screens on busy onshore sites (Linlithgow 7 rounds, 427 evidence features); evidence
  named by tool id stays untraced; the analyst sometimes passes a stage the person didn't give.
- **Not done yet:** out-of-date marking when the site is edited; the places-and-runs tray; settings; per-receptor
  distances in the skill. The "Screen for risks · soon" chip is unchanged (public text: Rob's call).

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

## 18 Nov (late evening): the workspace is the front page (Rob's call)
- `workspace.html` → `index.html` (asktobler.com). The earlier IFC agent page (was `index.html`) → `lab.html`; the lab results page (was `lab.html`) → `lab-results.html` (Rob chose this over `agent.html`).
- `workspace.html` stays as a tiny redirect to `/`, keeping `?query` and `#hash`, so old links and future share links still land.
- Links updated: About in settings → `lab-results.html` and `lab.html`; the results page's "Try the agent" → `lab.html`; the agent page now links to the results, the tools page and the workspace.
- `scripts/stamp.mjs` now stamps `index.html`; `scripts/browser-run-card.mjs` loads `/`. `noindex` header unchanged.
- Tested: `npm test`; browser checks 73/73 locally; redirect locally; live in Rob's desktop-app browser (front page is the workspace, no console errors, About links right, all four pages 200, `/workspace.html` redirects). Not tested: a real phone.

## 18 Nov (late evening): from Rob's Miri log
- **No candidate ids in front of the person.** Picking from the choices sent "Use C29: Miri (…)" as the person's message. Now the person sees "Use Miri (OpenStreetMap contributors)."; the analyst gets that plus a note with the candidate id and to build it as the person's choice (`match: named_place`), so it doesn't search again (it did in the log, and then said "Your C1 isn't in this search's results" although C1 was still there). `send(text, forModel)`; the log keeps both (`user`, `sent`).
- **No ids in place names.** The analyst named a place "Miri city (OpenStreetMap C29)". `placeName` drops candidate ids (and a bracket holding one); the place still answers to the analyst's own wording (`given`), so its next call finds it. The `make_place` name description says no ids or sources.
- **Countries only clipped at the edge.** Miri Division came out "across Indonesia, Malaysia and Brunei" (it borders both, and 1:10m borders clip its edge), and the analyst then told Rob the outline was probably wrong. `countrySplit` samples a grid over the area: countries under 2% are `touches_at_edge` ("in Malaysia, touching Brunei and Indonesia at its edge"). 20–60 ms on big areas. The screening baseline (`boundaries.js`) is unchanged and still sees every country touched.
- **Scale bar below the zoom buttons** (MapLibre stacks bottom controls upwards, so the scale goes in first).
- Tested: `npm test` (new cases in places and workspace tests), `browser-run-card.mjs` 73/73, new `scripts/browser-choice.mjs` (pick message, id to the analyst, scale bar position).

## 18 Nov (night): run card gaps grouped; wide areas "around the site"
- **Gaps in three groups** (`js/gaps.js`): "Couldn't check" (sources the tools couldn't check, first, unless the analyst already named them; then the analyst's lines about failures and things not checked), "No data" (nothing published or in the catalogue for it here), "Caveats" (everything else). Sorted by wording in code, so the analyst's output and the skill are unchanged. The summary reads "Gaps: 3 couldn't check, 1 no data, 1 caveat". The run record keeps `data_gaps` as written.
- **Wide areas the site lies within are "around the site", not "on site".** A polygon that contains or touches the site and is at least 1,000 km² and 200 times the site's area (`aroundSiteKm2` in `js/datatools.js`) gets `surrounds: true` and band "around the site" in the run record; `get_data` marks it `around_site` with its area and a note; the baseline summary says "(around the site: a wide area it lies within)"; the screening analyst is told such areas aren't findings on the site and to mention one only where being inside it matters (a large protected area, a MARPOL special area offshore). The card counts them apart ("The site also lies within a wide area: North West European waters"), leaves them out of "nearest per theme", and evidence and map pop-ups say "around the site". They stay on the map, faint, and still go to the analyst. Thresholds are a judgement: a large real designation the site sits in (a national park, a marine park) is labelled the same way, which is accurate.
- Tested: `npm test` (new `test/gaps.test.mjs`; ntrrun test now has MARPOL's NW European waters around the field), `browser-run-card.mjs` 77/77 (grouped gaps, the wide-area line, map counts).

## 19 Nov: Local / Regional / Global buttons removed from shape cards (Rob)
- They spilled out of the panel, and they did little: scale only goes into the analyst's project summary; screening distances come from the asset type and size. Scale is still worked out (from the request, the shape's size, or the zoom for a drawn point) and passed to the analyst; `make_place` can still set it when the request says so ("screen the whole country"). It's no longer shown or set on the card.
- Tested: `npm test`, `browser-run-card.mjs` 77/77, `browser-choice.mjs`; screenshots at desktop and phone sizes.

## 19 Nov (evening): water depth and AIS vessel traffic in screens at sea (Rob)
- **Rob reviewed the offshore part of the NTR skill:** working well; add water depth (what's possible and what it
  costs changes with depth) and shipping lanes from historic AIS. Review item closed.
- **Read in code as part of the baseline**, like boundaries (`js/seavalues.js`), not left to the analyst's searches:
  - **Water depth** on offshore sites: up to 25 points over the footprint in one `getSamples` call to NOAA NCEI's
    **DEM Global Mosaic** ImageServer (global; GEBCO-based in deep water, finer surveys where NOAA has them; US federal,
    public domain inferred, GEBCO attributed). Typical (median), shallowest and deepest; points above sea level counted.
  - **Vessel traffic (AIS)** when the sea is within the close band: EMODnet Human Activities' vessel density
    (hours per km² a month, 1 km cells, EU waters and neighbours, CC-BY 4.0), by WMS GetFeatureInfo at up to 9 points on
    the site and 24 on two rings (half the close band and the close band, from the site's edge); then fishing,
    passenger, cargo and tanker at the busiest point. **2023 asked for explicitly**: EMODnet's default year, 2024, lost
    satellite AIS from June (its own note). Outside coverage the service returns nothing: "no data here", never zero.
  - Why not through the atlas: GEBCO is there only as pictures (no values) or Esri ImageServers with vertical
    exaggeration; EMODnet's bathymetry record shows "licence not stated". Request in `docs/atlas-requests.md`; the
    sources sit in `catalogue/trusted.json` "values" until the atlas tags value-returning services.
  - Both services send CORS headers (checked from GitHub's runner with Origin asktobler.com), so the page calls them
    directly; no Worker change.
- **On the card:** one short line under the setup ("Water depth about 120 m, 110–130 m across the site (NOAA). Vessel
  traffic: light on the site (0.3 h/km² a month) (AIS 2023, EMODnet)."); the full lines, with sources, go to the
  analyst's baseline, `get_run` and the run record (`tobler_run.sea`); each source is in "What was checked".
  The busiest point sampled becomes a finding (community health and safety) only when traffic is at least moderate,
  so light traffic doesn't clutter "nearest per theme".
- **Words for density, a judgement for Rob to correct** (`trafficWord`): under 0.5 light, under 5 moderate, under 20
  busy, otherwise very busy. From sampled places: Rosebank 0.005, central North Sea 0.07, southern North Sea 2.6,
  Dover Strait 4.6, Aberdeen approaches 24.9.
- **NTR skill 3.5-draft:** the baseline gives depth and traffic; busy traffic on site or close is a PS4 flag (collision,
  simultaneous operations, safety zones displacing shipping), with what the figure is and that AIS misses small boats;
  depth is context, a flag only where it makes the asset as described impractical or unusually costly, with rough
  guides labelled as rules of thumb (fixed-bottom wind to ~60 m; jack-ups to ~120–150 m; divers to ~50 m; deepwater
  over ~500 m, ultra-deep over ~1,500 m). **For Rob to check.** Shipping lanes, traffic separation schemes and fairways
  stay catalogue searches (more search words). `operations.md` has the new operation.
- Tested: `npm test` (new `test/seavalues.test.mjs`; two new ntrrun tests: values in the record, the first message and
  the evidence; services down → not checked and the analyst told), `browser-run-card.mjs` 79/79 with depth and traffic
  faked (card line checked at desktop and phone sizes).

## 20 Nov (early): elevation for every skill; one sign convention (Rob)
- **Rob:** do topography as well as bathymetry; make it a tool other skills can use; manage the sign, since services
  disagree (some give depth as positive). NTR should mention elevation only when it matters (near sea level or
  flood-prone; high altitude: oxygen, etc.), so results aren't crowded. Slope: my call.
- **One convention inside Tobler: elevation in metres, positive up, relative to sea level.** Land positive, seabed
  negative; records and tools store only that. Each source in `catalogue/trusted.json` "values" → "elevation" (a list,
  finest first) declares `sign` ("up" = elevations, "down" = depths positive down), `units` and `vertical_datum`;
  `toElevation` converts as values are read and refuses a source that doesn't say. Water depth is a way of showing
  elevation at sea (depth = -elevation, from the below-sea-level points only), decided by whether the site is at sea,
  never by the sign: land can lie below sea level (polders). Tested with a depth-positive source giving the same
  seabed as an elevation source.
- **Shared tool `get_elevation`** (`js/elevation.js`, in the conversation and the screening run, read-only): typical,
  lowest and highest of up to 25 points over a place or candidate; water depth at sea; "notable" on land when
  low-lying or high; cell size, datum, source, licence. Listed in `skills/README.md` as a shared operation and in the
  NTR `operations.md` ("Elevation over a place").
- **Source:** NOAA NCEI DEM Global Mosaic (already used for depth). On land and in open ocean it's ETOPO 2022 at
  15 arc-seconds (about 460 m; checked 20 Nov: Linlithgow 109 m, Zermatt area 3,553 m, Bolivian altiplano 3,776 m),
  finer coastal and survey DEMs where NOAA holds them (mostly US); mostly EGM2008, some tidal datums. Fine for
  "high altitude" or "low-lying"; too coarse for slope or real flood work.
- **NTR (skill 3.6-draft):** the baseline reads elevation on every site; on land it's recorded (`tobler_run.elevation`)
  and in "What was checked", but shown on the card and given to the analyst only when significant
  (`elevationSignificance`, thresholds for Rob: typical 10 m or less low-lying; under 0 below sea level; 2,500 m or
  more high altitude; 3,500 m very high). The skill says what each means and to pair low-lying with flood-zone data.
  A failed read is told to the analyst. Flags citing elevation trace to the value read.
- **Slope: later, with area discounting (my call).** Done the GIS way: fetch an elevation grid over the area and work
  out slope cell by cell (Horn's method) in a local projection, summarised as share steeper than a threshold and the
  steepest place. Needs a finer land model: Copernicus GLO-30 (open, commercial use with attribution) sits on AWS as
  Cloud-Optimised GeoTIFFs, but the bucket sends no CORS header (checked 20 Nov), so it needs a Worker route that
  passes range requests through, and a GeoTIFF reader in the page. `get_elevation` is shaped to take a grid source
  then.
- Tested: `npm test` (new `test/elevation.test.mjs`: signs, units, a depth-positive source, sea points only for depth,
  fallbacks, significance, the tool at sea, high and mixed; a new ntrrun test: recorded always, reported only when
  significant, failure said, tracing), `browser-run-card.mjs` 79/79, `browser-choice.mjs`.
