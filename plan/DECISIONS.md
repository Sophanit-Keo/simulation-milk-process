[Index](README.md) · Decisions · [Review](REVIEW.md)

# Decision log

This log settles the numbers and rules that the plan left open or that the [review](REVIEW.md) questioned. Each one goes into `src/data/plant.json` and the [default settings](06-simulation-model.md#default-settings) table together. Every decision stays **Proposed** until the developer approves it by changing its Status to **Approved**. Until then the values are in use, but they can still change. `process` proposes numbers and process behaviour, and `lead` proposes contracts and tooling. The arithmetic behind each number is in [Hand calculations](hand-calculations.md).

| ID | Decision | Review note | Status |
|---|---|---|---|
| [D1](#d1-batch-size) | A batch is one filler for one 8-hour shift | [R1](REVIEW.md#r1-batch-size) | Proposed |
| [D2](#d2-missing-defaults) | The eleven missing defaults, mostly from the preview | [R2](REVIEW.md#r2-missing-defaults) | Proposed |
| [D3](#d3-truck-payload) | 22 pallets per truck, one truck every 100 min | [R3](REVIEW.md#r3-truck-payload) | Proposed |
| [D4](#d4-divert-rule-and-display-noise) | Keep 140 °C; display noise at most ±0.3 °C | [R4](REVIEW.md#r4-divert-rule) | Proposed |
| [D5](#d5-homogenizer-outlet) | Homogenizer outlet about 82 °C | [R7](REVIEW.md#r7-homogenizer-outlet) | Proposed |
| [D6](#d6-units) | Unit-suffixed names; conversions only in `units.ts` | [R8](REVIEW.md#r8-units-in-typescript) | Proposed |
| [D7](#d7-versions-and-hosting) | Pinned versions and the Pages base path | [R11](REVIEW.md#r11-versions-and-hosting) | Proposed |
| [D8](#d8-clock) | Clock: start, default speed, step sizes | — | Proposed |
| [D9](#d9-other-open-values) | Shelf life, incubation, deaerator, headspace, catch-up | — | Proposed |
| [D10](#d10-formula-tests-in-phase-1) | Formula tests active from phase 1 | — | Proposed |
| [D11](#d11-opening-state) | Open on day 8 with a week of history | — | Proposed (in use since phase 4) |
| [D12](#d12-conveyor-models) | Kenney Factory Kit for conveyors | — | Proposed |
| [D13](#d13-phase-3-liquid-line-defaults) | Silo and mixing-tank sizes and the 21 liquid-line keys of schema 4 | — | Proposed |
| [D14](#d14-phase-4-packs-to-trucks-defaults) | The 8 packs-to-trucks keys of schema 5 and the rules without a key | — | Proposed |
| [D15](#d15-phase-5-fault-scenario-defaults) | The 10 fault-scenario keys of schema 6, the scenario rules, and the heroes' AO and compression | [R10](REVIEW.md#r10-rare-qa-failures) | Proposed |
| [D16](#d16-phase-7-cleaning-programmes) | The CIP and AIC as programmes of steps: the three keys of schema 7 | — | Proposed |
| [D17](#d17-phase-8-steam-and-energy) | The boiler's steam and gas, and the energy per tonne of raw milk: the two keys of schema 8 | — | Proposed |

## D1. Batch size

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R1](REVIEW.md#r1-batch-size)
- **Decision:** a batch is one filler for one 8-hour shift: 7,500 packs/h × 8 h = 60,000 packs, about 60 pallets. QA takes 16 samples per batch (one every 30 min), plus 2 after each stop. Shifts start at 06:00, 14:00 and 22:00, so the two fillers make 6 batches a day. Each pallet carries one batch, so the last pallet of a batch is closed part-full: 59 full pallets and one of 528 packs (44 trays).
- **Why:** sampling is already per filler (1 pack per filler every 30 min), so a per-filler batch puts samples and pallets in the same unit. A fault or a failed sample on one filler then blocks only that filler's shift, about 60 pallets instead of the preview's 100–119. The GS1 pallet label shows one batch number, which is why a pallet never mixes two batches. The chance that a batch fails stays 1 − 0.9998^16 ≈ 0.32% ([R10](REVIEW.md#r10-rare-qa-failures)). With the mean filler downtime from D2 (2.8%), a batch averages about 58,300 packs: 57.8 pallet-loads of 1,008 packs, or about 58.3 pallets counting the part-full last one.
- **What it changes:** `quality.batchS` 28,800, `quality.sampleEveryS` 1,800, `quality.samplesAfterStop` 2, and `quality.firstShiftStartS` 21,600 (day 1, 06:00), the start of the shift grid the model reads instead of a constant. The Batch row in [default settings](06-simulation-model.md#default-settings). Code taken from the preview must not keep its two-filler batch or its 32 samples.
- **Phase 2 note:** per-filler batches double the batches in quarantine: up to 44 at a time (42 on hold and the 2 being filled, [H49](hand-calculations.md#counts-and-rates)), where the preview's two-filler batches made about 22. The preview's grid of one 2.0 × 3.0 m block per batch, 2.55 m apart in 4 rows, fits only 28 blocks inside the quarantine outline (x −10.9 to 7.2), so phase 4 needs a denser one, for example 4 rows of 11 blocks 1.2 m wide at a 1.6 m pitch ([G1 checklist](agent-plan/g1-checklist.md#layout-review), defect 5; [R9](REVIEW.md#r9-quarantine-scale)).

## D2. Missing defaults

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R2](REVIEW.md#r2-missing-defaults)
- **Decision:** the eleven settings the plan never set, starting from the preview's values. One value differs from the preview: the fault temperature (see Why).

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Raw-milk fat | 4.0% | `standardization.rawMilkFatPct` | Sim assumption (preview) |
| Filler time between failures | Random (exponential), mean 8 h, counted while the filler runs | `fillers.mtbfMeanS` = 28,800 | Sim assumption (preview) |
| Filler repair time | 2 min fixed + random (exponential), mean 12 min; 14 min on average | `fillers.repairFixedS` = 120, `fillers.repairRandomMeanS` = 720 | Sim assumption (preview) |
| Intermediate clean (AIC) interval | Every 10 h of production, 30 min each | `cleaning.aicEveryProductionS` = 36,000 | Sim assumption (preview); 30 min from the [handbook](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk) |
| Full CIP trigger | Only after a divert: 80 min CIP, then 30 min sterilizing at 125 °C or more; with the 3 min divert, 113 min out ([H36](hand-calculations.md#counts-and-rates)) | `cleaning.cipAfterDivert` = true, `cleaning.cipS` = 4,800, `uht.sterilizeS` = 1,800, `uht.sterilizeTempC` = 125 | Sim assumption (preview) |
| Divert before cleaning | 3 min | `uht.divertBeforeCleaningS` = 180 | Sim assumption (preview) |
| Tank thresholds | Throttle to 50% above 90% (18,000 L); full flow again below 60% (12,000 L); fillers stop below 150 L | `asepticTank.throttleAboveFrac` = 0.9, `asepticTank.resumeBelowFrac` = 0.6, `asepticTank.fillersStopBelowL` = 150 | Sim assumption (preview) |
| Fault temperature | Falls to 135.5 °C (preview: 137.6 °C) | `uht.faultTempC` = 135.5 | Sim assumption; diverts at every flow |
| Demand | Trucks only (D3); a truck that finds too little released stock waits at the dock | `warehouse.palletsPerTruck`, `warehouse.truckEveryS` | Sim assumption (preview) |
| Reject tank | 6,000 L | `uht.rejectTankL` = 6,000 | Sim assumption (preview) |
| Random seed | 81006, mulberry32 | `seed` = 81006 | Sim assumption (preview) |

- **Why:** the preview ran with these values and gave a plausible plant, so they are a tested starting point.
  - **Tank band.** With a single threshold the UHT plant would switch between 50% and 100% every few steps. With the 90%/60% band, the throttled plant (8,000 L/h in, 15,000 L/h out) takes 6,000 L ÷ 7,000 L/h ≈ 51 min to get back to full flow. The fillers restart as soon as the level is back above 150 L. The UHT plant outpaces them by 1,000 L/h, so the level only rises from there.
  - **Fault temperature.** With the hold following the flow ([R6](REVIEW.md#r6-holding-time)), the hold is 8 s while the plant is throttled, and the divert limit falls to 136.06 °C. At the preview's 137.6 °C, B\* would be 1.40 and the plant would not divert. A one-year run of the preview's rules with these values has the plant throttled for about 9% of its production time, so the scenario would fail about one time in eleven. At 135.5 °C, B\* is 0.44 at 4 s and 0.88 at 8 s, so the plant diverts at either flow. 135.5 °C is still above the EU minimum of 135 °C, which shows that temperature alone is not enough without the holding time.
  - **Full CIP only after a divert.** Real plants also run a full CIP at the end of each production run, and AIC only stretches the run between them. Leaving the scheduled CIP out keeps the line producing during a demo. It belongs in [Accepted simplifications](10-risks-and-simplifications.md#accepted-simplifications).
  - **Demand.** The plan's "random daily orders" become trucks: each truck is one order of 22 pallets. Order fill rate is the share of trucks loaded in full when they arrive. Days of cover is released stock ÷ 316.8 pallets a day (D3).
  - **Reject tank.** A 3-min divert at 16,000 L/h sends 800 L, so 6,000 L holds several diverts.
- **What it changes:** the keys in the table. New rows in [default settings](06-simulation-model.md#default-settings).

## D3. Truck payload

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R3](REVIEW.md#r3-truck-payload)
- **Decision:** 22 pallets per truck, one truck every 100 min: 14.4 trucks and 316.8 ≈ 317 pallets a day.
- **Why:** a pallet of 1,008 × 1 L packs weighs about 1.1 t (about 1,040 kg of milk plus cartons, film and the pallet). 22 pallets weigh about 24 t, within the roughly 24–25 t payload of a 40 t articulated truck. The 33 pallets that fit the 13.6 m floor would weigh about 36 t. A truck every 100 min keeps the preview's daily rate (33 pallets every 2.5 h is also 316.8 a day). That is below the fillers' maximum of 360 pallets a day (357 pallet-loads of 1,008 packs) and below the roughly 350 a day (347 pallet-loads) they average after breakdowns. Stock therefore grows by about 33 pallets a day ([H43](hand-calculations.md#counts-and-rates)), and the demand-spike scenario draws it down.
- **What it changes:** `warehouse.palletsPerTruck` 22, `warehouse.truckEveryS` 6,000. The Truck row in [default settings](06-simulation-model.md#default-settings). The 33-pallet floor limit is no longer used, so nothing needs adding to Accepted simplifications.

## D4. Divert rule and display noise

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R4](REVIEW.md#r4-divert-rule)
- **Decision:** keep the 140 °C set point. Divert when B\* < 1, computed from the live hold ([R6](REVIEW.md#r6-holding-time)). Any noise added to the holding-tube temperature is bounded at ±0.3 °C (no normal-distribution tails). It is part of the measured value, as on a real recorder: the display shows the noisy reading, and the divert check reads it too (and, from phase 3, the set point as well; see the phase 3 note).
- **Why:** 140 °C is the value in the chart, the stage panels, the preview and every text. At 4 s the divert limit is 139.22 °C, a margin of 0.78 °C. With noise capped at ±0.3 °C the lowest reading is 139.7 °C, where B\* is 1.11, so noise alone never diverts. The displayed F0 then ranges from 4.83 to 5.55 min. It dips under the 5 min target whenever the reading is below 139.85 °C, so status colours should follow B\*, not F0.
- **Alternative for the developer:** a 140.5 °C set point gives B\* ≈ 1.32, F0 ≈ 5.81 min and a 1.28 °C margin. With the same noise, F0 ranges from 5.42 to 6.22 min. The chart, stage panels and texts would then change from 140 °C to 140.5 °C.
- **What it changes:** `uht.setpointC` 140, `uht.displayNoiseC` 0.3. Stage 4's first line ([Stage 4](03-stages-1-5-liquid-line.md#4-uht-treatment)) should read "any drop below the divert limit (B\* < 1)"; that file belongs to `lead`.
- **Phase 3 note:** Stage 4 now reads "any drop below the divert limit (B\* < 1 at the holding-tube outlet)", and plans 02, 03, 06 and 10 give the whole sequence the same way: divert for 3 min, then an 80 min CIP and 30 min of sterilizing at 125 °C or more, 113 min out. The live model checks B\* < 1 for both the noisy reading and the set point, and diverts if either is below 1: the reading scatters around the set point, which is the temperature the milk really has. So any set point under the limit (139.22 °C at 4 s) diverts on the first step, whatever the noise. The panel and the KPI still show the noisy reading, so during such a divert B\* can read a little over 1 in a step whose noise lifts it; the stage 4 lamp and the sterility card stay red while the plant diverts, and the log names the set point. A set point just above the limit, such as 139.3 °C, diverts only in a step whose reading falls under it. Noise alone still never diverts at 140 °C, where the lowest reading gives B\* 1.11 ([H63](hand-calculations.md#model-checks), [H88](hand-calculations.md#phase-3-acceptance-runs)). `lead` accepted this rule in phase 3.

## D5. Homogenizer outlet

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R7](REVIEW.md#r7-homogenizer-outlet)
- **Decision:** every 40 bar of pressure drop adds 1 °C, so the outlet is 76 °C + (200 + 30) bar ÷ 40 bar/°C = 81.75 °C, shown as about 82 °C. The model computes it from the pressures. A change of set point or the pressure-loss scenario moves it.
- **Why:** [Stage 3](03-stages-1-5-liquid-line.md#3-homogenization) lists the temperature rise among the things to simulate, and the handbook gives 40 bar per °C. The rise also explains why the flash vessel returns the milk to about 80 °C rather than 76 °C. The plan says the second stage "adds about 30 bar", so the total is 230 bar. If 200 bar were the total, the rise would be 5 °C and the outlet 81 °C; either way it is "about 81–82 °C".
- **What it changes:** `homogenizer.stage1Bar` 200, `homogenizer.stage2Bar` 30, `homogenizer.barPerDegreeC` 40 (the outlet is not stored). [Chart values as text](02-uht-line-at-a-glance.md#chart-values-as-text) now shows 76 °C in and about 82 °C out. The chart image (`images/sim-defaults-temperatures.png`) and the wireframe's "outlet 76 °C" (`images/ui-wireframe.png`) still show 76 °C until they are redrawn. The flash vessel stays at about 80 °C, as in the sources. The model takes water removed = steam added rather than deriving it from the 1.75 °C difference.
- **Phase 2 note:** the preview's pipe route from the homogenizer to the steam injector still carries 76–78 °C. The grey-box pipes take their temperatures from the line points (`snapshot.line`) instead, so that run starts at 81.75 °C, as the layout review confirmed in the merged plant ([H69](hand-calculations.md#line-points); [G1 checklist](agent-plan/g1-checklist.md#pipes-all-zones)). The stage 3 panel shows the outlet to the nearest degree, 82 °C.

## D6. Units

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R8](REVIEW.md#r8-units-in-typescript)
- **Decision:** every quantity is a plain `number` whose name ends in its unit (`timeS`, `flowLph`, `tempC`, `levelL`, `tankLevelPct`). Unit conversions happen only in `src/contracts/units.ts`.
- **Why:** branded types need a cast on every literal and every value read from `plant.json`. Named units keep the JSON readable, and the hand-calculation tests catch a mix-up of L/h and L/s in the formulas.
- **What it changes:** every key in `plant.json` and every contract field.

## D7. Versions and hosting

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** [R11](REVIEW.md#r11-versions-and-hosting)
- **Decision:** `three` is pinned to `0.186.1` (r186). CI's GitHub Pages build sets the Vite base to `/simulation-milk-process/` through `BASE_PATH`; every other build (Vercel, `vite preview`, local) uses `/`, so the same code deploys to either host. TypeScript is pinned to `6.0.3`.
- **Why:** an exact version keeps the build repeatable, and the preview's r170 code must be tested against it. Pages serves the project from `/<repo-name>/`. typescript-eslint 8.71 supports TypeScript `>=4.8.4 <6.1.0`, so TypeScript stays on 6.0 until a typescript-eslint release supports 6.1.
- **What it changes:** `package.json`, `vite.config.ts` (owned by `lead`).

## D8. Clock

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** none ([How time works](06-simulation-model.md#how-time-works))
- **Decision:** the clock starts on day 1 at 06:00, the start of the first shift, at ×10. It steps 1 s at a time up to ×1,000 and 10 s at a time above that (plan 06 allows 10–60 s). Each frame runs at most 500 steps and accepts at most 0.1 s of real time.
- **Why:** shifts and batches (D1) start at 06:00. At ×10,000 a 0.1 s frame is 1,000 sim seconds, or 100 steps of 10 s; at ×1,000 it is 100 steps of 1 s. Both stay under 500. A 10 s step moves the tank by at most 44 L (16,000 L/h), which is small next to the 150 L stop level and the 90%/60% band. The 0.1 s cap stops a hidden tab from jumping hours ahead. At ×10 a pallet takes about 24 s of real time and a shift 48 min; the preview opens at ×100.
- **What it changes:** `clock.startTimeS` 21,600, `clock.defaultSpeed` 10, `clock.baseStepS` 1, `clock.fastStepS` 10, `clock.fastStepAboveSpeed` 1,000, `clock.maxStepsPerFrame` 500, `clock.maxFrameS` 0.1. See D11 for the opening state.

## D9. Other open values

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** none
- **Decision:** values the plan gave only as a range or an option.

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Shelf life | 182 days (6 months) | `product.shelfLifeDays` | 6–9 months ([GEA](https://www.gea.com/en/stories/shelf-stable-milk-conscientious-convenience/)); the low end |
| Incubation | 7 days at 55 °C | `quality.incubationTempC` = 55, `quality.incubationDays` = 7 | [Regulation 853/2004](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX); 15 days at 30 °C is the other legal option |
| Deaerator drop | 4 °C (80 → 76 °C) | `preheating.deaeratorDropC` = 4 | 4–5 °C ([Deaerators](https://dairyprocessinghandbook.tetrapak.com/chapter/deaerators)) |
| Sterile-air headspace | 3.0 bar at most | `asepticTank.maxHeadspaceBar` = 3.0 | [Tetra Alsafe](https://www.machineryworld.com/wp-content/uploads/2020/11/pd10196_tetra_alsafe.pdf) |
| Tray catch-up speed | Up to 30% faster after a stop | `packaging.catchUpFrac` = 0.3 | [Tray Shrink 30](https://www.tetrapak.com/en-cz/solutions/packaging/downstream-equipment/film-wrappers/tetra-pak-tray-shrink-30) |

- **Why:** 7 days at 55 °C cuts the quarantine to less than half of 15 days at 30 °C: about 2,500 pallets on hold (7 days of output) instead of about 5,360 (15 days) ([H49](hand-calculations.md#counts-and-rates), [R9](REVIEW.md#r9-quarantine-scale)), and it matches the preview. 4 °C matches the 76 °C in the chart. The other values take the sources' figure as given.
- **What it changes:** the keys in the table. Shelf life and quarantine in [default settings](06-simulation-model.md#default-settings).

## D10. Formula tests in phase 1

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** none ([Phase 1](agent-plan/phase-1-setup.md))
- **Decision:** the formula functions (`src/sim/formulas.ts`: cream share, holding time, F0, B\*, divert limit, homogenizer outlet) and their hand-calculation tests are written and active in phase 1, instead of skipped until phase 3. Phase 3 adds the model-level tests, such as mass balance over a run, tank level and the divert sequence.
- **Why:** the functions are pure and cheap, and every expected value is already in [Hand calculations](hand-calculations.md). A wrong formula is cheaper to catch in week 1 than in week 6.
- **What it changes:** `src/sim/formulas.ts` (`sim`) and the formula tests (`qa`). The phase-1 page's "marked skipped until phase 3" (`lead`).

## D11. Opening state

- **Status:** Proposed (in use since phase 4: contracts v3 and `plant.json` schema 5 have the keys)
- **Date:** 2026-10-12; implemented 2026-10-26
- **Review note:** none
- **Decision:** open on day 8 at 06:00 with a week of history, as the preview does: 42 batches on hold (6 a day for 7 days; the oldest is released at 14:00 that day) and 634 pallets of released stock (two days of shipments). This needs three `plant.json` keys from `lead`: `clock.startTimeS` = 626,400, `quality.historyDays` = 7 and `warehouse.startStockPallets` = 634.
- **Why:** with a day-1 start and an empty plant, the first batch ends on day 1 at 14:00 and is released on day 8 at 14:00 at the earliest. Until then stock is zero, about 105 trucks find nothing to load, the order fill rate reads 0%, and stages 9 and 10 show nothing. That is about 63 s at ×10,000, 11 min at ×1,000 and almost 18 h at ×10.
- **What it changes:** `clock.startTimeS` and the two new keys once the contract has them. A history of about 2,450 pallets on hold (42 batches of about 58.3) also starts the quarantine view at its full size ([R9](REVIEW.md#r9-quarantine-scale)).
- **Phase 2 note:** contracts v1 did not add the three keys, so the plant still opens on day 1 at 06:00 (D8). That costs nothing yet: the static plant has no batches, stock or trucks, so the stage 9 and 10 panels show only their settings (incubation, samples, pallets per truck) and those KPIs read 0. The keys are needed by phase 4, when stages 9 and 10 go live. The grey-box racks have 384 pallet places (16 bays × 2 pallets × 4 rows × 3 levels), fewer than the 634 opening pallets, and stock grows by about 33 pallets a day after that ([H43](hand-calculations.md#counts-and-rates)). The preview drew one block per 10 pallets, 1,920 pallets in all, which holds the opening stock plus about 39 days of growth; phase 4 needs a scale like it ([G1 checklist](agent-plan/g1-checklist.md#layout-review), defect 4).
- **Phase 4 note:** in use. `lead` added the three keys with contracts v3 (`plant.json` schema 5), and `src/sim/packs/quality.ts` makes the history: each of the 42 shifts on hold, and the older shifts the 634 pallets of stock come from, draws its own breakdowns as the live fillers do, so the opening quarantine holds 2,453 pallets (58.4 a batch) rather than a round number. Batch ids count up from the oldest: the stock is batches 1–11, the batches on hold 12–53 and the two filling at the opening 54 and 55. The oldest batch on hold is released at 14:00 on day 8 ([H50](hand-calculations.md#counts-and-rates)). The shift grid stays on `quality.firstShiftStartS` (day 1, 06:00), so the opening falls on a shift change. Phase 3's acceptance runs keep the day-1 start through `phase3Config()` in the tests ([Phase 3 acceptance runs](hand-calculations.md#phase-3-acceptance-runs)). The racks show stock at 5 pallets a place, so the 384 places hold 1,920 pallets, as the preview did: the opening stock and about 43 days of growth at 30 a day ([D14](#d14-phase-4-packs-to-trucks-defaults)).

## D12. Conveyor models

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** none ([plan 05](05-layout-and-3d-assets.md#3d-asset-list) names the Conveyor Kit)
- **Decision:** build the conveyors, accumulation table and other stage 7–8 kit pieces from the [Kenney Factory Kit 3.0](https://kenney.nl/assets/factory-kit) (CC0). Take only the `cover-*` tunnel from the older Conveyor Kit 2.0 if the tray-shrink tunnel needs it.
- **Why:** kenney.nl no longer lists the Conveyor Kit (its page returns 404); it is still on itch.io. The Factory Kit is its successor: it holds every Conveyor Kit piece except the 12 tunnels, plus corners, T-junctions, slopes, lamps and floor markings. Both kits are CC0, and pieces from both loaded with GLTFLoader at three r186 in the phase-1 check. Details and the pieces to use are in [assets/README.md](../assets/README.md).
- **What it changes:** the Conveyors row of the [3D asset list](05-layout-and-3d-assets.md#3d-asset-list) and [assets/LICENSES.md](../assets/LICENSES.md) once phase 2 commits the pieces.
- **Phase 2 note:** twelve Factory Kit pieces and their `Textures/colormap.png` are in `public/models/kenney/`. The merged plant uses six: `conveyor-long-sides-part-end`, `conveyor-long-sides-part-middle` and `conveyor-corner` for the pack conveyors, `conveyor-bars-high` for the tray rollers, `conveyor-bars` for the pallet rollers, and one `conveyor-sides` stretched to 3.4 × 3.0 m as the accumulation table. The kit is toy scale (1.0 m wide, 0.4 m high), so each piece is scaled to the preview's routes (belt top 0.86 m, pack belts 0.85 m wide), and a grey-box conveyor stands until the pieces load. The kit has no tunnel, so the tray-shrink tunnel is a box; the Conveyor Kit's `cover-*` was not needed. The other six pieces (`conveyor-junction-t`, `conveyor-stripe-sides`, `robot-arm-a`, `scanner-high`, `warning-traffic`, `indicator-special-area`) are unused. [`assets/LICENSES.md`](../assets/LICENSES.md) lists the twelve committed pieces and where each is used.

## D13. Phase 3 liquid-line defaults

- **Status:** Proposed
- **Date:** 2026-10-18; the keys `sim` added completed 2026-10-19
- **Review note:** none ([Phase 3](agent-plan/phase-3-liquid-line.md))
- **Decision:** the stage 1 tank sizes and start levels, which `lead` added to `plant.json` with contracts v2 (schema 3), and the 21 keys `sim` added for the live stage 1–6 model (schema 4). No value needed changing.

Tank sizes and start levels (schema 3):

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Raw-milk silo | 100,000 L | `standardization.siloCapacityL` = 100,000 | Silos hold 30,000–250,000 L ([Tanks](https://dairyprocessinghandbook.tetrapak.com/chapter/tanks)); the value is a sim assumption |
| Silo start level | 60% (60,000 L) | `standardization.siloStartFrac` = 0.6 | Sim assumption |
| Mixing tank | 10,000 L | `standardization.mixTankCapacityL` = 10,000 | The top of the 250–10,000 kg batch-tank range ([Mixers](https://dairyprocessinghandbook.tetrapak.com/chapter/mixers)), litres treated as kilograms |
| Mixing-tank start level | 50% (5,000 L) | `standardization.mixTankStartFrac` = 0.5 | Sim assumption, as for the aseptic tank ([D2](#d2-missing-defaults)); the level control holds it while the UHT plant draws |

The keys `sim` added (schema 4), with the formulas in `src/sim/liquid/stageModels.ts`:

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Specific heat of milk | 3.9 kJ/(kg·K) | `product.cpKjPerKgK` = 3.9 | Sim assumption between whole milk (3.77) and skim milk (3.98–4.02) in [Engineering ToolBox](https://www.engineeringtoolbox.com/specific-heat-capacity-food-d_295.html); litres count as kilograms |
| Mixing tank while the UHT plant stops | Fills to 80% (8,000 L) | `standardization.mixTankIdleFrac` = 0.8 | Sim assumption |
| Mixing-tank level control | First-order, 10 min time constant | `standardization.mixTankLagS` = 600 | Sim assumption |
| Raw-milk tanker | 25,000 L | `standardization.tankerL` = 25,000 | Sim assumption (road milk tankers carry about 25,000–30,000 L) |
| Tanker unloading rate | 30,000 L/h | `standardization.tankerUnloadLph` = 30,000 | Sim assumption; above the 16,222.22 L/h the separator draws at full flow (H3), so the silo never runs dry |
| Tanker call level | Silo below 40% (40,000 L) | `standardization.tankerBelowFrac` = 0.4 | Sim assumption; a tanker arriving at 40,000 L cannot overfill the silo (65,000 L even with no draw) |
| Preheater and deaerator lag | First-order, 30 s time constant | `preheating.lagS` = 30 | Sim assumption |
| Air in raw milk | 6% by volume | `preheating.rawAirPct` = 6 | 5.5–7.0% after milking, 6% on average ([Deaerators](https://dairyprocessinghandbook.tetrapak.com/chapter/deaerators)) |
| Air after the deaerator | 0.5% by volume | `preheating.deaeratedAirPct` = 0.5 | Sim assumption; the handbook gives no figure after vacuum deaeration |
| Homogenizer efficiency | 82% | `homogenizer.efficiencyFrac` = 0.82 | 55.556 kW hydraulic for 68 kW drawn in the handbook example, 81.7% ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers); [H8](hand-calculations.md#formulas)) |
| Fat globules in raw milk | 3.5 µm | `homogenizer.rawGlobuleUm` = 3.5 | "An average of 3.5 µm" ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)) |
| Globules after homogenizing | 0.8 µm at 200 bar | `homogenizer.globuleRefBar` = 200, `homogenizer.globuleRefUm` = 0.8 | "Below 1 µm" ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)); 0.8 µm is a sim assumption |
| Globule size against pressure | Size × (200 bar ÷ stage 1 pressure)^0.6, at most 3.5 µm | `homogenizer.globuleExponent` = 0.6 | Sim assumption; the size falls with pressure and levels off at high pressure, but the exponent is not checked against a source |
| Creaming risk | 0% at 1 µm or less, rising linearly to 100% at 2 µm | `homogenizer.creamingOkUm` = 1.0, `homogenizer.creamingFullUm` = 2.0 | Under 1 µm no cream layer forms, and smaller globules cream more slowly ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)); 2 µm is a sim assumption |
| Stage 4 amber | B\* below 1.1 | `uht.bStarWarnBelow` = 1.1 | Sim assumption, just under the 1.1101 of the lowest noisy reading at 140 °C ([H21](hand-calculations.md#formulas)) |
| Latent heat of steam | 2,200 kJ/kg | `uht.steamLatentKjPerKg` = 2,200 | Sim assumption between the steam-table values of about 2,145 kJ/kg at 140 °C and 2,308 kJ/kg at 80 °C |
| Filler restart level | Above 500 L | `asepticTank.fillersRestartAboveL` = 500 | Sim assumption |
| Headspace pressure | 2.0 bar when empty, rising with the level to 3.0 bar when full | `asepticTank.headspaceMinBar` = 2.0 | Sim assumption under the 3.0 bar maximum ([D9](#d9-other-open-values)) |
| CIP lye temperature | 75 °C | `cleaning.cipTempC` = 75 | The handbook's programme for circuits with heated surfaces "(UHT, etc.)": alkaline detergent at 0.5–2% for about 30 min at 75 °C, then acid at 70 °C ([Cleaning of dairy equipment](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment)) |

- **Why:**
  - **Silo.** At 16,000 L/h of 3.5% milk the separator draws 16,222.22 L/h of raw milk ([H3](hand-calculations.md#formulas)), about 389,000 L a day, so 60,000 L lasts 3.7 h and a full silo 6.2 h. Dairies take milk in from tankers through the day. With a 25,000 L tanker called at 40%, one arrives about every 92 min at full flow (about 16 a day) and unloads in 50 min. 100,000 L lies well inside the sources' range and gives the 3D silo a visible level change between deliveries.
  - **Mixing tank.** It sits between standardization and the UHT plant. Its inflow follows the UHT plant's draw, so at steady state its level stays where it started. While the UHT plant cleans, the separator fills it toward 80%, which leaves 2,000 L of room.
  - **Stage values at full flow.** With these keys the live model shows 1,317.33 kW of heat recovered (16,000 L/h from 4 to 80 °C), 124.66 kW drawn by the homogenizer (102.22 kW hydraulic at 230 bar ÷ 0.82), globules of 0.8 µm with no creaming risk, 1,652 L/h of steam injected and flashed off (about 10% of the flow, to lift the milk from 81.75 to 140 °C), and a 1,010 kW condenser load. The homogenizer-pressure-loss scenario raises the globules to 1.21 µm at 100 bar (risk 21%) and 1.84 µm at 50 bar (risk 84%).
  - **CIP lye.** The handbook also says to clean alkaline at the temperature the product reached, but at least 70 °C, and UHT lines are often cleaned hotter. The model shows 75 °C, the handbook's programme for heated circuits including UHT, as a timed state; it is a display value, not a cleaning model.
  - **Rules the acceptance runs assume** ([Phase 3 acceptance runs](hand-calculations.md#phase-3-acceptance-runs)): the intermediate-clean count runs during production, throttled or not, and a full CIP restarts it, since the plant is clean afterwards. An aseptic tank that opens above 90% throttles the UHT plant on the first step. Litres sent to the reject tank count in the mass balance as they arrive, whatever later empties the tank.
  - **Rules with no key** (`src/sim/liquidLine.ts`): the full CIP pumps the reject tank out, empty by the CIP's end (reject milk leaves by road); a full reject tank stops the UHT flow; a full aseptic tank takes only what the fillers draw.
- **What it changes:** the four `standardization` keys of schema 3 and the 21 keys of schema 4, all already in `plant.json`, and the matching rows in [default settings](06-simulation-model.md#default-settings).

## D14. Phase 4 packs-to-trucks defaults

- **Status:** Proposed
- **Date:** 2026-10-26
- **Review note:** none ([Phase 4](agent-plan/phase-4-packs-to-trucks.md))
- **Decision:** the keys `sim` added to `plant.json` for the live stage 7–10 model (schema 5, beside D11's three), and the rules the model follows without a key.

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Seal-check rejects | 0.2% of packs | `fillers.rejectFrac` = 0.002 | Sim assumption; gives OEE quality Q = 0.998 ([H52](hand-calculations.md#counts-and-rates)). The preview left quality out of OEE |
| Batch change on the packer | 2 min at each shift change | `packaging.batchChangeS` = 120 | Sim assumption: the packer closes the last pallet of the batch part-full ([D1](#d1-batch-size)), changes its batch code and starts a new pallet; packs queue on the conveyor meanwhile and the catch-up clears them |
| Blocked batch kept in quarantine | 1 day, then destroyed | `quality.blockedHoldS` = 86,400 | Sim assumption: long enough to see the red block in the 3D view at ×1,000 (86 s) |
| Truck loading | 20 min | `warehouse.truckLoadS` = 1,200 | Sim assumption; 22 pallets at under a minute each by forklift |
| Dock doors | 3 | `warehouse.dockDoors` = 3 | The three loading docks of the grey-box warehouse (`DOOR_X_M` in `src/scene/equipment/packs/layout.ts`; [plan 05](05-layout-and-3d-assets.md) names the loading docks); a truck that finds every door taken waits in the yard |

- **Rules with no key:**
  - **Fillers** (`src/sim/packs/filler.ts`): a breakdown is counted only while a filler runs, not while it is starved or set to 0 packs/h. A repair takes the random part (`fillers.repairRandomMeanS`), shown as *broken down*, then the fixed part (`fillers.repairFixedS`), shown as *re-sterilizing*: the filler's aseptic zone is sterilized again before it restarts. Each restart owes 2 more samples ([D1](#d1-batch-size)). A starved filler restarts when the tank is back above 500 L ([D13](#d13-phase-3-liquid-line-defaults)).
  - **OEE** per filler since the plant opened: availability = running time ÷ time open; performance = packs made ÷ (8,000 packs/h × running time); quality = good packs ÷ packs made. The KPI strip shows the mean of the two fillers, and the OEE card each filler's.
  - **Packaging** (`src/sim/packs/packaging.ts`): one tray packer and pallet per filler line. The packer is rated for the filler's 8,000 packs/h maximum and catches up at up to 30% over it (`packaging.catchUpFrac`, [D9](#d9-other-open-values)), 10,400 packs/h, until its queue is clear. A pallet holds packs of one batch only.
  - **Samples** are taken from the filler's good packs on a 30 min grid from the first shift (`quality.firstShiftStartS`), so a batch of 8 h at full rate has 16 (H29), and the packs on its pallets are 60,000 − rejects − samples (H98).
  - **Quality** (`src/sim/packs/quality.ts`): the incubation result is drawn once, when incubation ends, with the chance 1 − (1 − p)^n that one of the batch's n samples spoils ([R10](REVIEW.md#r10-rare-qa-failures)). A QA override from the batch list blocks a batch at once (even one still filling, whose later pallets then go straight into its blocked block), or releases it when its incubation ends without the draw.
  - **Warehouse** (`src/sim/packs/warehouse.ts`): trucks arrive every 100 min from the opening ([D3](#d3-truck-payload)), take the free door with the lowest number, and load only when released stock holds a full 22-pallet load, picked first-expired-first-out; trucks waiting at the doors or in the yard load in arrival order as stock is released. The order fill rate counts the trucks that found a full load on arrival; with no truck yet it reads 100%.
  - **Random numbers:** the packs model draws from its own seeded stream (the plant seed mixed with a constant, `packsSeed` in `src/sim/index.ts`), so the fillers' breakdowns and the QA draws are the same at 1 s and 10 s steps and do not change when the liquid line's noise does.
  - **3D view:** the belts, palletizer and pallet traffic show a sample of the packs, not every pack (plan 06: at ×10,000 the plant makes about 40 packs a real millisecond); a pallet sets off for the quarantine at most every 2 s of real time. The racks show stock at 5 pallets a place (D11 note), and each batch on hold is one block of up to 64 pallets with one lamp ([R9](REVIEW.md#r9-quarantine-scale)).
- **Cut list at G2:** nothing cut for phase 4. The silo-to-truck run works, so the Could items built so far stay in: the stretch wrapper (it turns and wraps each pallet that leaves the palletizer) and the boiler house. The CIP station (Could) was never built: it is not in the preview ([G1 checklist](agent-plan/g1-checklist.md)), and cleaning stays a timed state of the UHT plant; it is left for phase 5 to build or cut. The hero models are in behind `?heroes`, with the grey boxes the default until phase 5.
- **Why:** each value is a sim assumption chosen so the plant shows what the plan describes at the default speeds, and none moves a hand-calculated count: the batch change and catch-up keep every pallet of a batch on its own pallets, the rejects and samples come out of the batch's packs, and the trucks keep D3's 316.8 pallets a day. The [Phase 4 acceptance runs](hand-calculations.md#phase-4-acceptance-runs) (H97–H103) and the 60-day run check the model against them.
- **What it changes:** the five keys above and D11's three, all already in `plant.json`, and the matching rows in [default settings](06-simulation-model.md#default-settings).


## D15. Phase 5 fault-scenario defaults

- **Status:** Proposed
- **Date:** 2026-10-27
- **Review note:** [R10](REVIEW.md#r10-rare-qa-failures) ([Phase 5](agent-plan/phase-5-detail-and-scenarios.md))
- **Decision:** the keys `sim` added to `plant.json` for the six fault scenarios (schema 6, section `scenarios`), the rules they follow without a key, and, for `lead`, how the hero models were finished.

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Steam dip | The outlet falls to the fault temperature with a 15 s time constant | `scenarios.steamFaultLagS` = 15 | Sim assumption: fast enough to divert within 3 s at the 4 s hold ([H104](hand-calculations.md#phase-5-scenario-scripts)), slow enough to see the outlet fall |
| Filler breakdown (menu) | 60 min of repair, then the 2 min re-sterilizing | `scenarios.fillerRepairS` = 3,600 | Sim assumption: long enough that the tank reaches 90% and the plant throttles (H105). The random breakdowns keep D2's mean of 12 min |
| Sterile-air filter | Replaced 2 h after it fails | `scenarios.filterReplaceS` = 7,200 | Sim assumption: about the time to fit and integrity-test a new filter cartridge |
| Spoil chance after a filter failure | 5% per sample | `scenarios.filterFailurePerPack` = 0.05 | Sim assumption, 250 times the 0.02% per pack: a batch of 16 samples then fails 56% of the time, so the scenario shows both outcomes over a few tries ([R10](REVIEW.md#r10-rare-qa-failures)) |
| Homogenizer fault | Stage 1 falls to 50 bar for 1 h | `scenarios.homogenizerFaultBar` = 50, `scenarios.homogenizerRepairS` = 3,600 | Sim assumption: below the 100 bar slider minimum, so the creaming risk (84%) is beyond anything a viewer can set ([D13](#d13-phase-3-liquid-line-defaults)'s globule rule) |
| Sensory check | Fails a batch whose creaming risk is 50% or more | `scenarios.sensoryFailAbovePct` = 50 | Sim assumption: half-way along D13's 1–2 µm creaming scale |
| Demand spike | 12 extra trucks, one every 5 min | `scenarios.spikeTrucks` = 12, `scenarios.spikeEveryS` = 300 | Sim assumption: a day's 14.4 trucks (H41) in an hour, so the yard fills and the stock drops by 264 pallets, 0.8 days of cover |
| Late trucks | No truck for 24,000 s (6 h 40 min), then the 4 due arrive together | `scenarios.lateTruckDelayS` = 24,000 | Sim assumption: four regular intervals (D3), one more truck than the 3 doors take |

- **Rules with no key:**
  - **Triggers** come from the menu as `triggerScenario` (contracts v4); demand spike and late trucks are one scenario, `demandSpikeOrLateTruck`, with a variant. Filler breakdowns and failed incubations also happen at random, from D2's time between failures and the 0.02% per pack; the menu runs them on demand. A scenario that cannot start now says why in the menu and in the event log ("Scenario not started: …"), and starts nothing.
  - **Runs** (`src/sim/scenarios.ts`): each trigger opens a run that claims the plant's own log entries it caused (the divert, the CIP, the fillers' stop, the throttle, the verdicts, each truck) and adds a *why* to each; the run follows its consequences until they are over (back in production and the fillers running again; the last extra truck gone), so its log reads as one story. The 12 newest runs are kept.
  - **Reset** puts every running fault right at once: the steam supply, the filter and the homogenizer are restored, a repair ends (the 2 min re-sterilizing still follows) and the extra trucks still to come are cancelled; held-up trucks arrive now. What the faults caused runs its course: a divert still cleans and re-sterilizes, flagged batches stay under investigation until their verdict.
  - **Batches under investigation** carry the fault as a flag (`sterileAir`, `creaming`, contracts v4) and blink their lamp in quarantine until they are judged at the end of their incubation; batches started while the fault acts are flagged too.
  - **Random numbers:** the scenarios draw from the packs stream (D14), so the same seed and the same triggers at the same sim times give the same scenario log.
- **Hero models (`assets`, for `lead`):** the plan's AO bake and compression, adapted to models made in code. The AO is baked per vertex into the vertex colours (32 rays a vertex over 0.4 m, up to 85% darker, each rigid body shading only itself), not into a 1024² ORM texture, because the models have no UVs or textures; so there is no KTX2 step either. The geometry is meshopt-compressed losslessly with glTF-Transform (new pinned dev dependencies: `@gltf-transform/core`, `@gltf-transform/extensions` 4.5.1, `meshoptimizer` 1.3.0), without quantization, which would put a scale on the moving nodes. The app loads the heroes by default; `?greybox` keeps the grey boxes ([assets/hero-specs.md](../assets/hero-specs.md#phase-5-final-models)).
- **Why:** each value is a sim assumption chosen so a scenario plays out visibly within a few minutes at the default speeds, and none moves a phase 3 or 4 count when no scenario runs: the scenario keys act only while a scenario does. The [Phase 5 scenario scripts](hand-calculations.md#phase-5-scenario-scripts) (H104–H110) check them.
- **What it changes:** the ten keys above in `plant.json` (schema 6), contracts v4's additive fields (the scenario runs, log entries' `scenario` and `why`, batches' `flags` and `creamingRiskPct`), and the matching rows in [default settings](06-simulation-model.md#default-settings).

## D16. Phase 7: cleaning programmes

- **Status:** Proposed
- **Date:** 2026-10-27
- **Review note:** none (the roadmap's stretch item "animated CIP cleaning", taken as phase 7)
- **Decision:** the full CIP and the intermediate clean run as programmes of steps, each with its fluid, time and temperature, so the panel and the 3D view can show what circulates. Three keys in `plant.json` (schema 7):

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| CIP steps | Pre-rinse, warm water, 10 min, 45 °C; lye, 30 min, 75 °C; rinse, warm water, 5 min, 45 °C; acid, 20 min, 70 °C; post-rinse, cold water, 7 min, 20 °C; gradual cooling, cold water, 8 min, 20 °C | `cleaning.cipSteps` | The handbook's programme for circuits with heated surfaces, UHT plants among them ([Cleaning of dairy equipment](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment)): steps, fluids, times and the 75 °C and 70 °C. Sim assumptions: "warm" as 45 °C, "cold" as 20 °C, and the post-rinse's 7 min, the rest of D2's 80 min |
| AIC steps | Water displaces the product, 5 min; lye, 20 min; rinse, water, 5 min; all at the UHT set point | `cleaning.aicSteps` | The handbook gives the AIC's 30 min "without losing aseptic conditions" ([Long-life dairy products](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-dairy-products)), not its steps: they are a sim assumption, and the set point keeps the plant sterile |
| Circulation | 24,000 L/h in both programmes | `cleaning.circulateLph` | Sim assumption: 1.5 × the product flow, about 2.0 m/s in a 65 mm bore, inside the handbook's 1.5–3.0 m/s for CIP (H114) |

- **Rules with no key:**
  - The programmes fill their modes' times (checked: cipSteps add up to cleaning.cipS, aicSteps to aicS), so the step under way follows from the time spent in the mode, and the CIP still takes 80 min and the plant 113 min out after a divert (H36, H104).
  - A CIP step sets the temperature the preheater (with its 30 s lag) and the holding-tube outlet run at; the lye's is cleaning.cipTempC (checked). An AIC step has no temperature of its own.
  - The cleaning fluids are not part of the milk's balance, and `Snapshot.line` carries no cleaning flow: the snapshot's `liquid.cleaning` (contracts v5) gives the step, fluid, temperature, time left and the circulation, and the 3D view draws them.
  - The CIP station cleans the UHT plant from the balance tank to the tubular cooler's outlet. The aseptic tank, which feeds the fillers during an AIC, and the divert line are not in the circuit.
- **Why:** the handbook gives a programme with times that come within 7 min of D2's 80 min, so the model can show the real sequence of fluids and temperatures without changing any time the scenarios and tests rely on.
- **What it changes:** the three keys above in `plant.json` (schema 7), contracts v5's `liquid.cleaning`, the matching rows in [default settings](06-simulation-model.md#default-settings), and the "Cleaning is a timed machine state" simplification, which now reads that the steps run but the fluids are not part of the balance.

## D17. Phase 8: steam and energy

- **Status:** Proposed
- **Date:** 2026-10-29
- **Review note:** none (the roadmap's stretch item "a steam and energy model", taken as phase 8)
- **Decision:** the boiler house raises the steam the injector uses, burning gas for it, and the plant counts its energy as the EU's dairy benchmark does: heat and electricity per tonne of raw milk. Two keys in `plant.json` (schema 8):

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Boiler heat | 2,391.13 kJ to raise 1 kg of steam | `energy.boilerHeatKjPerKg` | US DOE [Steam Tip Sheet #15](https://www1.eere.energy.gov/manufacturing/tech_assistance/pdfs/steam15_benchmark.pdf), Table 1: 1,028 Btu/lb for saturated steam at 150 psig from 200 °F feedwater, 2,391.13 kJ/kg (H115). Sim assumption: that row of the table, a common steam main and a feed tank kept hot; direct injection returns no condensate, so all the feedwater is make-up |
| Boiler efficiency | 85.7% | `energy.boilerEfficiencyFrac` | The same tip sheet, Table 2: natural gas, "based on boilers equipped with feedwater economizers or air preheaters and 3% oxygen in flue gas" |

- **Rules with no key:**
  - Steam heats whatever passes the injector, from the temperature it arrives at to the holding-tube outlet's, at uht.steamLatentKjPerKg and the milk's specific heat (D13): the milk in production and while diverting, from the homogenizer outlet; a cleaning step's fluid and the re-sterilizing water, circulating at cleaning.circulateLph (D16), from the deaerator outlet, as the homogenizer stands. The fluids count as milk (3.9 kJ/(kg·K), where water's is 4.19). Nothing else uses steam.
  - The preheater keeps its 30 s lag (D13, D16), so the steam peaks while a step's temperature rises and stops while it falls. The totals integrate the lags exactly, so they do not depend on the step size.
  - The electricity is the homogenizer's (D13). The separator, the pumps, the fillers and the packaging line are left out: no source gives their power for this plant.
  - Regeneration is the share of the milk's heating to UHT temperature that the preheater gives it, heat recovered ÷ (heat recovered + steam heat), while milk flows: 56.6% at the defaults (H116). Sources give up to 90% for indirect plants ([GEA, UHT systems](https://www.gea.com/en/products/liquid-processing/uht-systems/)); a direct plant gives some of it up for its flash cooling.
  - The energy per tonne is the gas and the electricity since the plant opened ÷ the raw milk drawn since then, litres counted as kilograms: BAT's indicator, "final energy consumption" (heat and electricity) per tonne of raw materials ([Decision (EU) 2019/2031](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019D2031), BAT 21). The model's 92 kWh/t over a day (H119) sits under BAT's 100–600 kWh/t for market milk, which counts a whole dairy.
  - The snapshot carries it all in `liquid.energy` (contracts v6): the steam, what it heats, the gas, the electricity, the regeneration, the totals and the energy per tonne. Stage 4 lists the steam and the gas, stage 2 the regeneration.
- **Why:** the model already worked out the steam injected and the heat recovered (D13); a boiler and a benchmark turn them into what a plant pays for, and show what a divert costs: 113 min of steam with no product (H118). The two keys come from one public table each, and no earlier number changes.
- **What it changes:** the two keys above in `plant.json` (schema 8), contracts v6's `liquid.energy`, stage 4's `steamKgPerH` and `gasKw` and stage 2's `regenerationPct`, the matching rows in [default settings](06-simulation-model.md#default-settings), and an accepted simplification on what the energy leaves out.
---

← [Review](REVIEW.md) · [Hand calculations](hand-calculations.md) →
