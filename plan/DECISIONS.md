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
| [D11](#d11-opening-state) | Open on day 8 with a week of history | — | Proposed (needs a contract change) |
| [D12](#d12-conveyor-models) | Kenney Factory Kit for conveyors | — | Proposed |
| [D13](#d13-phase-3-liquid-line-defaults) | Silo and mixing-tank sizes; the liquid-line keys `sim` adds in phase 3 | — | Proposed (list to complete) |

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
- **Decision:** keep the 140 °C set point. Divert when B\* < 1, computed from the live hold ([R6](REVIEW.md#r6-holding-time)). Any noise added to the holding-tube temperature is bounded at ±0.3 °C (no normal-distribution tails). It is part of the measured value, so the display and the divert check read the same number, as a real recorder would.
- **Why:** 140 °C is the value in the chart, the stage panels, the preview and every text. At 4 s the divert limit is 139.22 °C, a margin of 0.78 °C. With noise capped at ±0.3 °C the lowest reading is 139.7 °C, where B\* is 1.11, so noise alone never diverts. The displayed F0 then ranges from 4.83 to 5.55 min. It dips under the 5 min target whenever the reading is below 139.85 °C, so status colours should follow B\*, not F0.
- **Alternative for the developer:** a 140.5 °C set point gives B\* ≈ 1.32, F0 ≈ 5.81 min and a 1.28 °C margin. With the same noise, F0 ranges from 5.42 to 6.22 min. The chart, stage panels and texts would then change from 140 °C to 140.5 °C.
- **What it changes:** `uht.setpointC` 140, `uht.displayNoiseC` 0.3. Stage 4's first line ([Stage 4](03-stages-1-5-liquid-line.md#4-uht-treatment)) should read "any drop below the divert limit (B\* < 1)"; that file belongs to `lead`.
- **Phase 3 note:** Stage 4 now reads "any drop below the divert limit (B\* < 1 at the holding-tube outlet)", and plans 02, 03, 06 and 10 give the whole sequence the same way: divert for 3 min, then an 80 min CIP and 30 min of sterilizing at 125 °C or more, 113 min out. Noise can still delay a divert when the set point is close to the limit: with ±0.3 °C, only a set point under 139.22 − 0.3 = 138.92 °C diverts on the first step whatever the noise (138.9 °C on the 0.1 °C slider). At 139.0 °C a reading can be as high as 139.3 °C, where B\* is 1.017, so that step does not divert ([H88](hand-calculations.md#phase-3-acceptance-runs)).

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

- **Status:** Proposed (needs a contract change; until then D8's day-1 start stays)
- **Date:** 2026-10-12
- **Review note:** none
- **Decision:** open on day 8 at 06:00 with a week of history, as the preview does: 42 batches on hold (6 a day for 7 days; the oldest is released at 14:00 that day) and 634 pallets of released stock (two days of shipments). This needs three `plant.json` keys from `lead`: `clock.startTimeS` = 626,400, `quality.historyDays` = 7 and `warehouse.startStockPallets` = 634.
- **Why:** with a day-1 start and an empty plant, the first batch ends on day 1 at 14:00 and is released on day 8 at 14:00 at the earliest. Until then stock is zero, about 105 trucks find nothing to load, the order fill rate reads 0%, and stages 9 and 10 show nothing. That is about 63 s at ×10,000, 11 min at ×1,000 and almost 18 h at ×10.
- **What it changes:** `clock.startTimeS` and the two new keys once the contract has them. A history of about 2,450 pallets on hold (42 batches of about 58.3) also starts the quarantine view at its full size ([R9](REVIEW.md#r9-quarantine-scale)).
- **Phase 2 note:** contracts v1 did not add the three keys, so the plant still opens on day 1 at 06:00 (D8). That costs nothing yet: the static plant has no batches, stock or trucks, so the stage 9 and 10 panels show only their settings (incubation, samples, pallets per truck) and those KPIs read 0. The keys are needed by phase 4, when stages 9 and 10 go live. The grey-box racks have 384 pallet places (16 bays × 2 pallets × 4 rows × 3 levels), fewer than the 634 opening pallets, and stock grows by about 33 pallets a day after that ([H43](hand-calculations.md#counts-and-rates)). The preview drew one block per 10 pallets, 1,920 pallets in all, which holds the opening stock plus about 39 days of growth; phase 4 needs a scale like it ([G1 checklist](agent-plan/g1-checklist.md#layout-review), defect 4).

## D12. Conveyor models

- **Status:** Proposed
- **Date:** 2026-10-12
- **Review note:** none ([plan 05](05-layout-and-3d-assets.md#3d-asset-list) names the Conveyor Kit)
- **Decision:** build the conveyors, accumulation table and other stage 7–8 kit pieces from the [Kenney Factory Kit 3.0](https://kenney.nl/assets/factory-kit) (CC0). Take only the `cover-*` tunnel from the older Conveyor Kit 2.0 if the tray-shrink tunnel needs it.
- **Why:** kenney.nl no longer lists the Conveyor Kit (its page returns 404); it is still on itch.io. The Factory Kit is its successor: it holds every Conveyor Kit piece except the 12 tunnels, plus corners, T-junctions, slopes, lamps and floor markings. Both kits are CC0, and pieces from both loaded with GLTFLoader at three r186 in the phase-1 check. Details and the pieces to use are in [assets/README.md](../assets/README.md).
- **What it changes:** the Conveyors row of the [3D asset list](05-layout-and-3d-assets.md#3d-asset-list) and [assets/LICENSES.md](../assets/LICENSES.md) once phase 2 commits the pieces.
- **Phase 2 note:** twelve Factory Kit pieces and their `Textures/colormap.png` are in `public/models/kenney/`. The merged plant uses six: `conveyor-long-sides-part-end`, `conveyor-long-sides-part-middle` and `conveyor-corner` for the pack conveyors, `conveyor-bars-high` for the tray rollers, `conveyor-bars` for the pallet rollers, and one `conveyor-sides` stretched to 3.4 × 3.0 m as the accumulation table. The kit is toy scale (1.0 m wide, 0.4 m high), so each piece is scaled to the preview's routes (belt top 0.86 m, pack belts 0.85 m wide), and a grey-box conveyor stands until the pieces load. The kit has no tunnel, so the tray-shrink tunnel is a box; the Conveyor Kit's `cover-*` was not needed. The other six pieces (`conveyor-junction-t`, `conveyor-stripe-sides`, `robot-arm-a`, `scanner-high`, `warning-traffic`, `indicator-special-area`) are unused. [`assets/LICENSES.md`](../assets/LICENSES.md) lists the twelve committed pieces and where each is used.

## D13. Phase 3 liquid-line defaults

- **Status:** Proposed (the list of keys `sim` adds is still to be completed)
- **Date:** 2026-10-18
- **Review note:** none ([Phase 3](agent-plan/phase-3-liquid-line.md))
- **Decision:** the stage 1 tank sizes and start levels below, which `lead` added to `plant.json` with contracts v2, plus the keys `sim` adds for the live stage 1–6 model this phase.

| Setting | Default | `plant.json` key | Basis |
|---|---|---|---|
| Raw-milk silo | 100,000 L | `standardization.siloCapacityL` = 100,000 | Silos hold 30,000–250,000 L ([Tanks](https://dairyprocessinghandbook.tetrapak.com/chapter/tanks)); the value is a sim assumption |
| Silo start level | 60% (60,000 L) | `standardization.siloStartFrac` = 0.6 | Sim assumption |
| Mixing tank | 10,000 L | `standardization.mixTankCapacityL` = 10,000 | The top of the 250–10,000 kg batch-tank range ([Mixers](https://dairyprocessinghandbook.tetrapak.com/chapter/mixers)), litres treated as kilograms |
| Mixing-tank start level | 50% (5,000 L) | `standardization.mixTankStartFrac` = 0.5 | Sim assumption, as for the aseptic tank ([D2](#d2-missing-defaults)) |

- **Why:**
  - **Silo.** At 16,000 L/h of 3.5% milk the separator draws 16,222.22 L/h of raw milk ([H3](hand-calculations.md#formulas)), about 389,000 L a day, so 60,000 L lasts 3.7 h and a full silo 6.2 h. Dairies take milk in from tankers through the day, so the model needs an intake rule, which `sim` adds below. 100,000 L lies well inside the sources' range and gives the 3D silo a visible level change between deliveries.
  - **Mixing tank.** It sits between standardization and the UHT plant. Its inflow follows the UHT plant's draw, so at steady state its level stays where it started. At 50% it holds 5,000 L: 18.75 min of UHT feed, or room for 18.75 min of separator output while the UHT plant is stopped.
  - **Rules the acceptance runs assume** ([Phase 3 acceptance runs](hand-calculations.md#phase-3-acceptance-runs)): the intermediate-clean count runs during production, throttled or not, and a full CIP restarts it, since the plant is clean afterwards. An aseptic tank that opens above 90% throttles the UHT plant on the first step. Litres sent to the reject tank count in the mass balance as they arrive, whatever later empties the tank.
- **Keys `sim` adds in phase 3 (to complete in the next round).** Each needs its value, unit and source or "sim assumption" here, and a row in [default settings](06-simulation-model.md#default-settings). The phase-3 task card asks for:
  - [ ] Raw-milk intake: how and when tankers refill the silo, so it never runs dry. *To complete.*
  - [ ] Preheat lag (first-order time constant). *To complete.*
  - [ ] Air content before and after the deaerator (% by volume). *To complete.*
  - [ ] Heat recovered in the preheater: specific heat and recovery share, or the formula `sim` uses. *To complete.*
  - [ ] Fat-globule size against stage 1 pressure, and the creaming-risk score. *To complete.*
  - [ ] Homogenizer efficiency for the power draw (handbook example: 55.556 kW hydraulic, 68 kW drawn, about 82%, [H8](hand-calculations.md#formulas)). *To complete.*
  - [ ] Steam injected and condenser load in stage 5. *To complete.*
  - [ ] Headspace pressure in the aseptic tank (at most 3.0 bar, [D9](#d9-other-open-values)). *To complete.*
  - [ ] Filler restart margin above the 150 L stop level. *To complete.*
  - [ ] What empties the reject tank, and when. *To complete.*
  - [ ] Mixing-tank level control while the UHT plant is stopped. *To complete.*
- **What it changes:** the four `standardization` keys above, already in `plant.json` (`schemaVersion` 3), and the Raw-milk silo and Mixing tank rows in [default settings](06-simulation-model.md#default-settings). The keys `sim` adds go into both once this list is complete.

---

← [Review](REVIEW.md) · [Hand calculations](hand-calculations.md) →
