[Agent plan](README.md) · Phase 6 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 6 · Polish & present (week 12)

Make the simulation fast, stable and deployed, then produce the demo video, report and presentation.

- **Entry:** the week-11 deliverable is done. From now on, no new features, only fixes.
- **Exit:** **gate G3**: 60 fps check, demo video, report and presentation.
- **Critical path:** `qa` (performance and regression) and `lead` (release and documents).

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `qa` | The 60 fps check on a mid-range laptop: a fixed camera path for 60 s at ×1 and ×10,000, recording the average and the 1% low. A full regression run of unit, scenario and browser tests. A Chrome and Edge check. A bug list ranked by what the demo will show. | Perf report, ranked bug list |
| `scene` | Performance fixes the perf report asks for: merge static meshes, check instancing, keep one shadow-casting light, shrink oversized textures. Visual polish only where the demo camera goes. | Fast scene |
| `ui` | Loading screen, error and empty states, keyboard focus on the rail and top bar, a final copy edit. | Finished screen |
| `sim` | Fixes from the bug list only. Check step time at ×10,000. | Stable model |
| `assets` | Final compression and licence check. No new models. | Final assets |
| `process` | A final check of on-screen numbers against the review's "Checked and correct" table. An in-app list of sources. The technical chapter of the report. The demo script: which scenarios to show, in what order, and the numbers to expect. | Demo script, report chapter |
| `lead` | Tag `v1.0`, deploy to GitHub Pages, and check the link from a clean browser. A README with how to run and test. Put the report and slides together. A demo video script from `process`'s demo script. | Release, report, slides |

**The developer** records the demo video and gives the presentation.

## How they work together

1. **Monday.** Bug bash: every agent runs the demo script, and `qa` ranks the list.
2. **Tuesday–Wednesday.** Fixes in rank order. `lead` merges each one only after `qa` reruns the affected tests.
3. **Thursday.** Code freeze. `lead` tags a release candidate and deploys, `qa` repeats the 60 fps check on that build, and the developer records the video.
4. **Friday.** The developer walks through the G3 checklist, then presents.

## Hand-offs

- `qa` → all: the ranked bug list and the perf report.
- `process` → `lead`: the demo script and the report chapter.
- `lead` → developer: the release link, video script, report and slides.

## Gate G3 checklist

- [ ] The 60 fps check passes on the target laptop.
- [ ] The deployed link works in a clean Chrome and Edge.
- [ ] The full regression run passes.
- [ ] The demo video, report and presentation are done.
- [ ] Every Must item is done, and the status of each Should and Could item is recorded.
- [ ] The developer signs G3.

**Status (2026-10-27, the agents' part):**

- **Bug bash, ranked by what the demo shows.**
  1. *Fixed:* two faults on the same batches (the homogenizer fault and the filter failure, as the demo runs them) judged each batch with the first run's why, and the other run waited for a verdict that had already come, showing "verdict day 16" (the destruction date) forever. A blocked verdict now names its cause, and every waiting run settles. Regression test in `tests/sim/scenarios.test.ts`.
  2. *Fixed:* the OEE flickered as the plant opened, the first thing the demo shows: performance counted whole packs only, so a filler read 90% one second in and 92–94% for the first minutes. It now counts the pack being formed, and reads 93.75% until the first reject, then 93.56%. Found by the regression run (`e2e/kpis.spec.ts` read the per-filler OEE at the wrong moment).
  3. *Fixed:* the empty scenario log opened blank (phase 5 PR).
  4. *Fixed:* a frame that threw froze the plant without a word; the view now says the simulation stopped, with a Reload button.
  5. *Fixed:* the browser asked for `/favicon.ico`, a 404 on every load; the icon is now inline.
  6. *Open, not a demo risk:* `e2e/shell.spec.ts`'s pixel-ratio test fails on the agents' Chromium 153 (since phase 3). CI's own Chromium has not run it yet (next item).
  7. *Open, blocks the release:* every CI run on `master` since phase 3 fails within 3 seconds, before its first step, with no log; so the browser tests and the GitHub Pages deploy have never run there, and the deployed link may not exist. A job that never starts points to the account (Actions disabled, or a billing or spending-limit hold) rather than the code. The developer checks the run page, fixes the setting, and re-runs CI on `master`.
- **Regression run** (the agents' machine, Chromium 153): `npm run check` passes, 1,101 unit tests and 69 asset tests; the browser suite passes 59 of 60, all but the pixel-ratio test (item 6), after item 2's fix.
- **`qa`.** `tests/perf/measure.mjs --path 60` is the 60 fps check: a fixed camera path through every stage for 60 s, at ×1 and ×10,000, with the average and the 1% low and a pass at 57 fps and 30 fps ([perf baseline](../../tests/perf/baseline.md)). It needs the target laptop's GPU: run it there with `--headed --channel chrome` and `--channel msedge`. `tests/sim/demoScript.test.ts` replays the demo script and checks every number it quotes.
- **`sim`.** Items 1 and 2 above. The step time at ×10,000 is 0.06 ms a frame (0.26 ms at the 99th percentile), well under 1% of a 60 fps frame ([perf baseline](../../tests/perf/baseline.md)).
- **`ui`.** A loading note until the first frame, the stopped state, the in-app list of sources and credits in About. Empty states were already in place (the stage panel, the batch list, the dock, the stock, the scenario log), and every control shows the focus ring.
- **`assets`.** No new models. The hero GLBs are meshopt-compressed; the vehicles (139 and 78 KB) and the Kenney pieces stay uncompressed, under the 500 KB budget. Every file in `public/` has a row in [LICENSES.md](../../assets/LICENSES.md).
- **`process`.** The on-screen numbers checked against the review's table ([report, 2.3](../../docs/report.md#23-verification)); the [demo script](../../docs/demo-script.md); the report's technical chapter.
- **`lead`.** [README](../../README.md) with how to use, run and test; the [report](../../docs/report.md), [slides](../../docs/slides.md) and [video script](../../docs/video-script.md). Tagging `v1.0` and the clean-browser check of the deployed link wait for the developer.

**Scope at G3** ([asset list](../05-layout-and-3d-assets.md#3d-asset-list)): every Must item is built and animated. Should: the standardization skid and the balance tank with its pump are built but static (their valve and impeller animations were not done); the tray-shrink tunnel, the palletizer (a hero model) and the racks, forklifts and trucks are built and move. Could: the stretch wrapper (turns) and the boiler house are built; the CIP station is not, and cleaning stays a timed state of the UHT plant (phase 7 built both the station and the cleaning steps, below).

## Afterwards

If the term runs longer, take the roadmap's stretch list one item per week: animated CIP cleaning, a steam and energy model, a switch between direct and indirect UHT, and a mobile layout. Each one follows the same task loop, so it starts with `process` writing the expected numbers.

**Phase 7 (2026-10-27): animated CIP cleaning**, the first stretch item, through the same task loop:

- **`process`.** The programmes, their numbers and sources: H111–H114 in the [hand calculations](../hand-calculations.md#phase-7-the-cleaning-programmes) and [D16](../DECISIONS.md#d16-phase-7-cleaning-programmes). The full CIP is the Dairy Processing Handbook's six steps for heated circuits (80 min: pre-rinse 45 °C, lye 75 °C, rinse, acid 70 °C, post-rinse, cooling); the AIC is water, lye and water at the set point (30 min); both circulate at 24,000 L/h, about 2 m/s. The circuit runs from the balance tank to the tubular cooler's outlet.
- **`lead` + `sim`.** Contracts v5 add `liquid.cleaning` (the programme, step, fluid, its place, the time left, a CIP step's temperature, the flow), and `plant.json` schema 7 the steps. The step follows from the time spent in the mode, so the modes keep their times: H36, H104 and the demo script hold unchanged.
- **`scene`.** The CIP station (the Could item never built) behind the flash vessel: a tank per fluid with a band of its colour and a lamp that lights while that fluid circulates, its pump and return header, and the supply and return lines. While the plant cleans, the circuit's pipes and the CIP lines take the fluid's colour and their stripes flow at the circulation rate. 221 draw calls at the overview, 14 more than phase 5, of the 350 budget ([perf baseline](../../tests/perf/baseline.md#phase-7-the-cip-station)).
- **`ui`.** A "Cleaning step" row in the stage 4 panel ("Lye (NaOH), 75 °C · 2 of 6 · 29 min left"), and the fluids in the pipe legend while a programme runs, the one in the circuit marked. About explains the programmes; the simplification now reads that the steps run on a timer and the fluids are not part of the balance.
- **`qa`.** `tests/sim/cleaning.test.ts` runs H111–H114; `e2e/cleaning.spec.ts` follows the CIP after the UHT temperature drop frame by frame (pipes, station lamp, panel, legend). `npm run check` passes, 1,124 unit tests and 69 asset tests; the browser suite passes 60 of 61 on the agents' Chromium 153, the new test among them; the one failure is the pixel-ratio test of bug-bash item 6, as before.

**Phase 8 (2026-10-29): a steam and energy model**, the second stretch item, through the same task loop:

- **`process`.** The boiler from the US DOE's [Steam Tip Sheet #15](https://www1.eere.energy.gov/manufacturing/tech_assistance/pdfs/steam15_benchmark.pdf): 2,391 kJ to raise a kilogram of steam at 150 psig from 93 °C feedwater, 85.7% efficient on natural gas. Steam heats whatever passes the injector: the milk from the homogenizer outlet, or the cleaning and re-sterilizing circulation from the deaerator outlet. The energy is counted as the EU's dairy benchmark counts it ([Decision (EU) 2019/2031](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019D2031), BAT 21), gas and electricity per tonne of raw milk: 92 kWh/t over a day, under BAT's 100–600 kWh/t for a whole dairy. H115–H119 in the [hand calculations](../hand-calculations.md#phase-8-the-steam-and-energy-model) and [D17](../DECISIONS.md#d17-phase-8-steam-and-energy); no earlier number changes.
- **`lead` + `sim`.** Contracts v6 add `liquid.energy` (the steam and what it heats, the gas, the electricity, the regeneration, the totals since opening, the energy per tonne), and `plant.json` schema 8 the boiler's two keys. The steam over each cut is integrated exactly as the preheater lags and a steam dip's outlet falls, so the totals agree to 1e-9 at 1, 7, 10 and 60 s steps. Stage 4 lists the steam and the gas, stage 2 the regeneration; the mock sim gives the same keys.
- **`scene`.** The boiler house is live: its label reads the steam it raises, and its chimney's plume grows with the gas, one more draw call. The steam injector also puffs while it heats the cleaning and re-sterilizing circulation.
- **`ui`.** The stage 4 panel's "Steam to injector", "Boiler gas" and "Energy since opening" ("86.6 kWh/t raw milk" in production; about 278 kWh/t right after a divert near the opening), and stage 2's "Regeneration" (56.6 %). About explains the model, its sources and what it leaves out.
- **`qa`.** `tests/sim/energy.test.ts` runs H115–H119 and the step-size check; `e2e/energy.spec.ts` follows the boiler house and the panels through production and the re-sterilizing after a UHT temperature drop. The demo script's step 4 adds the steam and the energy per tonne, and its replay checks them.

---

← [Phase 5. Detail & scenarios](phase-5-detail-and-scenarios.md) · [Agent plan](README.md) →
