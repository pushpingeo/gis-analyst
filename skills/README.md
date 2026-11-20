# Skills

Each skill is a folder that can be lifted out and used in another AI workflow (decided 17 Nov 2026).

```
skills/<name>/
  SKILL.md        the method: standard header (name, version, description), then how to do the job
  operations.md   what each operation the method uses does, in general terms, and which Tobler tool does it
```

**SKILL.md** says what to check, at what distances, what counts as a flag, how confidence is judged and what to
say when a source wasn't checked. Where it names an operation (e.g. `find_place`), that name stands for the general
operation defined in `operations.md`, not only for Tobler's function.

**operations.md** has two parts per operation: what it must do anywhere (inputs, what comes back, how failures are
reported), and the Tobler tool that does it. To use a skill elsewhere, map each operation to a tool in that setting,
or give the agent `operations.md` and let it do the mapping.

Rules:
- Nothing about Tobler's screens in the method. Where an older line mentions "the map" or "a card", read it as
  whatever shows the person the result in that setting; tidy such lines when the skill is next revised.
- Evaluated text stays put. `ntr-screening/SKILL.md` (v2) is the evaluated method: change it only with an
  evaluation rerun (about $2). Its pointer to `operations.md` is added in step 4, when NTR moves into the workspace
  and is re-evaluated anyway.
- Provenance and honesty rules live in the method, not in the tools: any setting that runs the skill should report
  sources, licences and "not checked" the same way.

Shared operations (any skill may use them; each skill's `operations.md` describes the ones it relies on):
- **Elevation over a place** (`get_elevation`, 20 Nov 2026): metres, positive up, relative to sea level, whatever
  sign the source uses; water depth at sea is -elevation. Slope will join it as a grid when area discounting needs it.
