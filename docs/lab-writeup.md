# GIS Analyst lab: does an NTR skill make an AI agent better?

*Write-up of the evaluation work on 15 November 2026. Repo: github.com/pushpingeo/gis-analyst. Live pages: [agent](https://pushpingeo.github.io/gis-analyst/), [lab results](https://pushpingeo.github.io/gis-analyst/lab.html), [tools without AI](https://pushpingeo.github.io/gis-analyst/tools.html).*

## 1. The question

geoanalyst.ai is a demo of a GeoAI agent built from three layers: a **skill** (a written method, here non-technical risk (NTR) screening in IFC Performance Standard terms), **tools** (deterministic spatial lookups) and a **catalogue** (which data answers which concept). The lab asks whether the skill earns its place: does Claude with the skill screen sites better than Claude with the same tools and no skill?

## 2. Test set and ground truth

- **Sites:** 45 IFC projects, each with an Environmental and Social Review Summary (ESRS) listing which Performance Standards apply. Rob verified every location against satellite imagery. Mix: 12 mines, 10 thermal plants, 8 hydro, 8 solar, 6 wind, 1 terminal; 32 Category A, 13 Category B.
- **What is scored:** PS5 (land and resettlement), PS6 (biodiversity), PS7 (Indigenous Peoples) and PS8 (cultural heritage): the location-driven standards. IFC applied them to 28, 34, 4 and 18 of the 45 projects. PS7 is too rare to read much into.
- **Split:** after the first full run, the sites were split into 25 for developing the skill and 20 held back, balanced by asset type and with two PS7 cases in each half (fixed seed, `data/eval-split.json`). The held-back sites were scored once, at the end.

## 3. What the agent sees and uses

- **Input:** coordinates, country, asset type and a default footprint radius (thermal 0.5 km, solar 1, wind 3, mine 3, hydro 5). Optional project stage was added for v2 but not used in scoring. **Never the project name.**
- **Tools** (`js/tools.js`, `js/agent.js`):
  - `list_concepts`: the catalogue.
  - `find_features`: OpenStreetMap features by concept, with counts by distance band (on site, ≤1, 1–5, 5–20 km) and the nearest named features.
  - `threatened_species_records`: GBIF records of IUCN Critically Endangered and Endangered species within 5 km.
  - `named_places`: Wikidata places within 20 km, with Wikipedia links.
  - `web_search`: for desk research, in one arm only.
- **Catalogue 0.4:** 20 concepts covering protected areas, World Heritage, Ramsar, wetland, river, forest, Indigenous land, settlements, residential and informal settlements, farmland, industrial land, heritage, places of worship and cemeteries, schools and health facilities, energy infrastructure, main roads, international and disputed boundaries, threatened species and named places.
- **Data frozen in snapshots** (`data/osm`, `data/gbif`, `data/wikidata`), fetched by GitHub Actions, so every arm sees identical data. 41 of 45 sites are on catalogue 0.4. Four (Tobene, Yaramoko, Upper Trishuli, Reko Diq) kept timing out on Overpass and use older data; concepts missing from those are reported to the agent as "not checked", not "none".
- **Model:** Claude Haiku 5.5, max 8,000 output tokens, up to 10 tool rounds. This matches the public site.

## 4. The arms

| Arm | What it is |
|---|---|
| Rules only | The skill's distance rules applied mechanically in code. No AI. |
| Skill off | Claude with the tools and the output format, told to use its own judgement. |
| Skill on | The same, plus the skill text in the system prompt. |
| Skill + web | Skill on, plus web search (up to 5 searches) for desk research. |

Every AI arm ran twice per site, to measure consistency.

## 5. Keeping it honest

- The project name and IFC's answer never reach the model. Tests check this.
- Web search blocks IFC, MIGA, World Bank and other development-finance sites (`BLOCKED_DOMAINS` in `js/agent.js`).
- **Leak check:** any web run whose searches or results contain the distinctive part of the project name is flagged, and scored both with and without.
- Rules in skill v2 carry a one-line reason from IFC guidance or field practice. No rule was added just to fix a particular site.
- Development and held-back sites are kept separate.
- **Hindsight can't be removed**, and is stated: today's OpenStreetMap shows many of these projects as built, and today's web knows what happened after IFC's decision.

## 6. Measures

- **Agreement and kappa** with IFC's yes/no per standard. Kappa corrects for chance, which matters because IFC applies PS5 and PS6 to most projects. Saying yes to everything scores 62% and 76% on those, with kappa 0.
- **Category** A/B/C agreement.
- **Consistency** between the two runs.
- **Flag recall** (v2): for each standard IFC applied, did at least one of the agent's flags point to it? This is the measure that fits how screening is actually used.
- **Flags per site** and share of low-confidence flags: the cost of flagging liberally.
- **Evidence traceability:** the share of features the agent cites (name and distance) that appear in what the tools actually returned. The rest are paraphrased, translated or invented. The matcher strips decorations like "(village)" and accepts exact distance matches for names translated from non-Latin scripts.

## 7. Skill v1 and what went wrong

v1 (`skill_sha c1d81420c9ca`) gave each Performance Standard a rating from distance rules. For example, PS5 was high if a settlement was on site and medium if one was within 1 km, and an industrial area on site pointed to low.

**Results, all 45 sites:**

| | Rules only | Skill off | Skill on | Skill + web | Yes to everything |
|---|---|---|---|---|---|
| Agreement | 66% | 71% | 69% | 70% | 47% |
| Kappa | 0.29 | 0.43 | 0.38 | 0.40 | 0 |
| PS5 agreement (kappa) | 33% (−0.17) | 62% (0) | 51% (−0.04) | 52% | 62% (0) |
| PS6 agreement (kappa) | 76% (0.43) | 76% (0) | 76% (0.41) | 76% | 76% (0) |
| Category | 49% | 70% | 50% | 57% | – |
| Evidence traceable | – | 77% | 87% | 91% | – |
| Consistency | – | 97% | 98% | 96% | – |

**Findings:**
1. **Skill off said yes to PS5 and PS6 on every site.** It scored well on agreement but with kappa 0: no judgement, just the base rate.
2. **The skill added real signal on PS6** (kappa 0.41).
3. **The skill made PS5 worse,** for two reasons found by reading the traces of the development sites:
   - **The map shows the finished project.** At Thar, Riau and Elengy, OSM tags the project itself as industrial land, so the rule "site inside industrial land, so low" fired on the project. This is a hindsight effect.
   - **"No settlement within 1 km" isn't "no PS5".** At Mocuba, Manatuto, Mazar and Rincon the agent wrote that grazing and customary use couldn't be ruled out, then rated PS5 low because the rule said so. IFC applied PS5 to all four.
4. **False PS5 alarms come from information the agent lacks.** Refinancings, phase 2 expansions and state-land leases (Bujagali 2, Tobene Phase 2, the Jordan sites) don't need new land. Neither arm can know this from coordinates.
5. **Category:** the skill called A whenever any theme was high, and occasionally C. No-skill tracked asset size and type and did better. The test set has no C projects.
6. **PS8 was weak for everyone.** Places of worship near a site rarely led IFC to apply PS8. IFC's yes calls tended to come from heritage surveys for big earthworks.
7. **PS7:** v1's "not assessed unless mapped" rule missed Upper Trishuli (Tamang communities). Skill off used regional knowledge and got it right.
8. **Web search found the project itself in 54 of 90 runs,** despite the blocked domains: news, company pages and other documents. The web arm can't be a blind test. The 36 clean runs scored 74% (kappa 0.48), but they're a skewed subset.
9. **One operational bug:** answers that hit the length limit were rejected by the parser. Fixed, and rescored from the saved answers.

**The main lesson:** a strong general model already has decent instincts about IFC screening. A skill that replaces those instincts with crude thresholds makes the model worse.

## 8. Rob's reframing

The real job isn't to predict IFC's calls. As Rob put it, a GIS analyst flags anything that might be a risk, a concern or a cause of delay, so the opportunity manager can decide whether to act on it. A missed risk costs far more than a flag that turns out not to matter. That changed both the skill and the measures.

## 9. Skill v2

v2 (`skill_sha fbfa685ccb29`, `skills/ntr-screening/SKILL.md`, frontmatter `version: 2`):
- **Output is a flag list.** Each flag gives the risk, the evidence (feature, distance, source), why it matters, a confidence level (high = mapped and close; low = regional knowledge or a data gap where the risk is common) and the related standard. The IFC view (which standards apply, likely category) comes last, as a translation.
- **"When in doubt, flag it and say the evidence is weak."**
- **PS5:** any greenfield land take; settlements change the severity, not the trigger. Industrial land on site may be the project itself, so it only lowers the risk inside an established multi-occupant estate or port, or for an expansion or refinancing.
- **PS6:** any natural habitat in the footprint, as well as protected areas, threatened species, dams, wind farms and induced access.
- **PS7:** mapped land, or a strong regional signal (South and Southeast Asian highlands, central African and Amazon forests, Andes, East African and Sahel drylands, Arctic and boreal), labelled *regional knowledge*.
- **PS8:** graves, cemeteries, shrines, places of worship or listed heritage **inside** the footprint; World Heritage within 1 km; large earthworks in areas with long settlement history (heritage survey needed). Places of worship **nearby** become a community-sensitivity flag under PS4. Always a chance-finds procedure.
- **PS4:** schools, hospitals and clinics as sensitive receptors (Rob's point). Also no main road within 10 km, and borders.
- **Category:** decided by scale and reversibility, following IFC's own definitions. Any physical project is at least B.
- **Project stage** (greenfield, expansion, refinancing) is an optional input. It defaults to greenfield.
- **Context** reported outside the IFC view: country risk (only with a dated source), and who lives around the site, including contrasts in wealth or land holding (Rob's Karoo example).
- **KBAs not checked** is always listed as a gap (KBA data is commercial-only through IBAT).

## 10. Skill v2 results

**Development sites (25 sites, 2 runs each):**

| | v1 skill on | v2 skill off | v2 skill on |
|---|---|---|---|
| Agreement (kappa) | 71% (0.41) | 69% (0.40) | 68% (0.38) |
| PS5 agreement | 40% | 68% | 64% |
| Category | 64% | 74% | 72% |
| Flag recall PS5 / PS6 / PS7 / PS8 | – | 100 / 100 / 75 / 81% | 100 / 100 / 50 / 94% |
| Flags per site | – | 5.6 | 7.5 |
| Evidence traceable | 88% | 79% | 88% |

**Held-back sites (20 sites, 2 runs each, scored once): the headline**

| | Rules only | Skill off | Skill on | Skill + web |
|---|---|---|---|---|
| Agreement (kappa) | 63% (0.23) | 73% (0.45) | 69% (0.39) | 70% (0.41) |
| Flag recall PS5 / PS6 / PS7 / PS8 | – | 100 / 100 / 75 / 70% | **100 / 100 / 100 / 90%** | 100 / 100 / 100 / 85% |
| IFC's yes calls that were missed | 26 of 38 (one run) | 13 of 76 | **6 of 76** | 5 of 76 |
| Standards applied that IFC didn't (false alarms) | 4 | 31 | 44 | 43 |
| Flags per site (low-confidence share) | – | 5.6 (37%) | 6.8 (41%) | 6.9 (41%) |
| Evidence traceable | – | 84% | **92%** | 78% |
| Category | 35% | 55% | 55% | 57% |
| Consistency | – | 95% | 95% | 90% |
| Web runs that found the project | – | – | – | 25 of 40 |

*IFC applied 38 of the scored standards across the 20 sites; with two runs per AI arm that's 76 calls to catch. False alarms are counted the same way.*

**Reading it:**
1. **On matching IFC's yes/no calls, the skill ties with a strong general model.** Kappa is within noise, and neither beats "yes to everything" on PS5.
2. **On what screening is for, the skill wins clearly on unseen sites:**
   - It **halves the missed risks** (13 to 6), catching every PS7 case and 90% of PS8 against 70%.
   - It **cites evidence that traces to the data** more often (92% against 84%).
   - The cost is about one more flag per site (31 to 44 false alarms in IFC terms), which matches the "flag it and let the manager decide" brief.
3. **The development results held up on the held-back sites,** so the gains aren't tuning to the 25.
4. **Web search adds little to the scores, and evidence traceability drops** (web findings can't be matched to tool output by design). It found the project in most runs. Treat it as a feature of the public tool, not as evaluated evidence.
5. **Consistency is high** (90–98%) in every arm.

## 11. What we learned (for the write-up and the pitch)

- **A strong general model is a high bar.** On headline accuracy, a good skill matches it rather than beating it.
- **A skill that overrides the model's judgement with rigid thresholds makes it worse.** v1 showed this clearly.
- **A skill's value is in what the model doesn't do by itself:** covering the less obvious risks (heritage surveys, unmapped customary use, regional Indigenous presence), tying every claim to evidence, stating gaps, and working the way the end user works.
- **Measure what the job needs.** Agreement with a reference hid the real difference; recall of risks and traceable evidence showed it.
- **Evaluation hygiene matters more than expected:** hidden names, blocked domains, leak detection, development and held-back sites, frozen data, saved traces, and rescoring without re-running.
- **Hindsight is everywhere in geospatial evaluation:** today's map shows the built project, and today's web knows the outcome. State it plainly.

## 12. Limitations

- 45 sites, of which 20 are held back. PS7 has only 2 held-back positives. Differences of a few points are noise.
- IFC's calls rest on field surveys, project design and stage as well as location, so 100% agreement isn't the target.
- Point footprints miss linear assets: Riau's PS7 comes from a 40 km pipeline.
- OSM coverage is uneven; four sites are on older snapshots.
- Haiku only. Larger models may behave differently with and without the skill.
- The evidence matcher is approximate: it can't verify paraphrased or translated names without an exact distance match, or anything from desk research.
- The skill was developed by looking at the development sites' answers. The held-back score is the honest one.

## 13. Cost

About $8 of API spend in total: about $5.50 for the v1 full run (most of it the web arm), $0.50 for the v2 development runs, $1.90 for the held-back run, and small change for smoke tests. Haiku 5.5 is $0.10 per million input tokens and $0.50 per million output; web search is about $0.01 per search. Without web search a site costs under 1 cent per run; with it, about 4–6 cents.

## 14. Where things are

| Path | What |
|---|---|
| `skills/ntr-screening/SKILL.md` | The skill (v2) |
| `catalogue/catalogue.json` | Concepts and sources (0.4) |
| `js/tools.js` | Spatial tools: Overpass, GBIF, Wikidata, distances |
| `js/agent.js` | Agent loop, prompts, output parsing, leak check |
| `js/rules.js` | Rules-only baseline |
| `scripts/run-eval.mjs` | Evaluation runner and scoring |
| `scripts/fetch-snapshots.mjs` | Data snapshots |
| `.github/workflows/eval.yml` | Runs the evaluation (key in the `ANTHROPIC_API_KEY` secret) |
| `.github/eval-request` | Pushing a change to this file starts a run, e.g. `--label=v3-dev --arms=off,on --repeats=2 --sites=dev` |
| `eval/runs/<label>/` | Every run's full trace, and `summary.json` |
| `data/eval-sites.json`, `data/eval-split.json` | Sites with IFC answers; the fixed split |
| `index.html`, `lab.html`, `tools.html` | Agent, results and tools pages |

**Rescore without API calls:** `node scripts/run-eval.mjs --label=v1 --arms=rules,off,on,web --repeats=2 --reparse`. To score one run's saved answers on a subset: `--label=v1-dev --from=v1 --sites=dev`.

## 15. Open questions and next steps

- **Public site:** pin anywhere, flags-first report, a working map, sharing. Keep the skill switch and trace in a "how it works" panel.
- **Footprints** for linear and large assets (pipelines, reservoirs).
- **Project stage:** score with and without it to show how much knowing it helps. This needs the stage taken from IFC project descriptions, checked by Rob.
- **Bigger set,** especially more PS7 cases, before claiming anything about Indigenous Peoples.
- **Try Sonnet or Opus,** to see whether the skill's value changes with model size.
- **Night lights and terrain** (raster tools), and country risk and demographic sources (licences to check).
- **CAP analysis** (constraints, access and proximity) as a sister skill.
