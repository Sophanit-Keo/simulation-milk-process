[Index](README.md) · Hand calculations · [Decisions](DECISIONS.md)

# Hand calculations

These are the expected values QA tests the model against. Each row is worked by hand from the values in `src/data/plant.json` ([decision log](DECISIONS.md)), and every one was rechecked with a short script. Tolerances are absolute and in the unit of the expected value. A test computes the value from `plant.json` and compares it with the Expected column; it never recomputes the expected value with the same formula. Only `process` changes an expected value, with a source (ownership rule 4 in the [agent plan](agent-plan/README.md#ownership-rules)).

Formulas, from [Simulation model](06-simulation-model.md#core-formulas):

- Cream share: x = (f_target − f_skim) ÷ (f_cream − f_skim)
- Holding time: t_hold = V_tube ÷ Q
- F0 = (t_hold ÷ 60) × 10^((T − 121.1) ÷ 10), in minutes
- B\* = (t_hold ÷ 10.1) × 10^((T − 135) ÷ 10.5)
- Divert limit (B\* = 1): T = 135 + 10.5 × log10(10.1 ÷ t_hold)

## Formulas

Pure functions, tested from phase 1 ([D10](DECISIONS.md#d10-formula-tests-in-phase-1)), except the rows marked *phase 3*. H2–H5 (the stage 1 mass balance) and H8 (homogenizer power) are tested through `surplusCreamFrac` and `hydraulicPowerKw` (phase 3) and against the stage 1 and stage 3 models. H20 and H23 are tested through `divertLimitC` and `f0Min`.

| # | What | Formula with inputs | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H1 | Cream share to remix | (3.5 − 0.05) ÷ (40 − 0.05) = 3.45 ÷ 39.95 | 0.08636 (plan: 0.086) | ±0.00001 | [Core formulas](06-simulation-model.md#core-formulas); [review](REVIEW.md#checked-and-correct) |
| H2 | Surplus cream, as a share of raw milk at 4.0% fat (*phase 3*) | (4.0 − 3.5) ÷ (40 − 3.5) = 0.5 ÷ 36.5 | 0.01370 | ±0.00001 | [D2](DECISIONS.md#d2-missing-defaults) |
| H3 | Raw milk needed for 16,000 L/h of 3.5% milk (*phase 3*) | 16,000 ÷ (1 − 0.013699) = 16,000 ÷ 0.986301 | 16,222.22 L/h | ±0.01 | Mass balance; litres treated as kilograms (sim assumption) |
| H4 | Surplus cream at 16,000 L/h (*phase 3*) | 16,222.22 − 16,000 | 222.22 L/h | ±0.01 | Stage 1, "surplus cream (L/h)" |
| H5 | The fat balance closes (*phase 3*) | (16,222.22 × 4.0 − 16,000 × 3.5) ÷ 222.22 = (64,888.89 − 56,000) ÷ 222.22 | 40.000% (the cream fat) | ±0.001 | Mass balance |
| H6 | Deaerator outlet | 80 − 4 | 76 °C | exact | [Chart values](02-uht-line-at-a-glance.md#chart-values-as-text); [D9](DECISIONS.md#d9-other-open-values) |
| H7 | Homogenizer outlet | 76 + (200 + 30) ÷ 40 = 76 + 5.75 | 81.75 °C (shown as about 82 °C) | ±0.001 | [R7](REVIEW.md#r7-homogenizer-outlet); [D5](DECISIONS.md#d5-homogenizer-outlet) |
| H8 | Homogenizer hydraulic power, handbook example (*phase 3*) | 10,000 L/h ÷ 3,600 = 2.778 L/s; 0.002778 m³/s × 20,000,000 Pa = 55,556 W | 55.556 kW (68 kW drawn means about 82% efficiency) | ±0.001 | [Review](REVIEW.md#checked-and-correct); Stage 3 |
| H9 | Holding-tube volume | 16,000 L/h ÷ 3,600 × 4 s = 4.444 L/s × 4 s | 17.778 L | ±0.001 | [R6](REVIEW.md#r6-holding-time) |
| H10 | Hold at 50% flow | 17.778 L ÷ (8,000 ÷ 3,600) L/s = 17.778 ÷ 2.222 | 8.000 s | ±0.001 | [R6](REVIEW.md#r6-holding-time) |
| H11 | F0 at 140 °C, 4 s | (4 ÷ 60) × 10^((140 − 121.1) ÷ 10) = 0.06667 × 10^1.89 = 0.06667 × 77.625 | 5.175 min (plan: 5.2; review: 5.17) | ±0.001 | [Core formulas](06-simulation-model.md#core-formulas); [review](REVIEW.md#checked-and-correct) |
| H12 | B\* at 140 °C, 4 s | (4 ÷ 10.1) × 10^((140 − 135) ÷ 10.5) = 0.39604 × 10^0.47619 = 0.39604 × 2.99358 | 1.1856 (plan: 1.19) | ±0.0001 | Same |
| H13 | Divert limit at 4 s | 135 + 10.5 × log10(10.1 ÷ 4) = 135 + 10.5 × 0.40226 = 135 + 4.2237 | 139.224 °C | ±0.001 | [Review](REVIEW.md#checked-and-correct) |
| H14 | Margin at 140 °C | 140 − 139.224 | 0.776 °C (review: 0.8) | ±0.001 | [R4](REVIEW.md#r4-divert-rule); [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H15 | B\* at 140 °C, 8 s (50% flow) | (8 ÷ 10.1) × 2.99358 = 0.79208 × 2.99358 | 2.3712 (review: 2.4) | ±0.0001 | [R6](REVIEW.md#r6-holding-time) |
| H16 | F0 at 140 °C, 8 s | (8 ÷ 60) × 77.625 = 0.13333 × 77.625 | 10.350 min (review: 10.3) | ±0.001 | [R6](REVIEW.md#r6-holding-time) |
| H17 | Divert limit at 8 s | 135 + 10.5 × log10(10.1 ÷ 8) = 135 + 10.5 × 0.10123 = 135 + 1.0629 | 136.063 °C (review: 136.1) | ±0.001 | [R6](REVIEW.md#r6-holding-time) |
| H18 | B\* at 140.5 °C, 4 s | 0.39604 × 10^(5.5 ÷ 10.5) = 0.39604 × 3.34048 | 1.3230 (review: 1.32) | ±0.0001 | [R4](REVIEW.md#r4-divert-rule) |
| H19 | F0 at 140.5 °C, 4 s | 0.06667 × 10^1.94 = 0.06667 × 87.096 | 5.806 min (review: 5.8) | ±0.001 | [R4](REVIEW.md#r4-divert-rule) |
| H20 | Margin at 140.5 °C | 140.5 − 139.224 | 1.276 °C (review: 1.3) | ±0.001 | [R4](REVIEW.md#r4-divert-rule) |
| H21 | Lowest reading with ±0.3 °C noise: B\* at 139.7 °C, 4 s | 0.39604 × 10^(4.7 ÷ 10.5) = 0.39604 × 2.80297 | 1.1101 (no divert) | ±0.0001 | [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H22 | F0 at the edges of the noise band, 4 s | 139.7 °C: 0.06667 × 10^1.86 = 0.06667 × 72.444; 140.3 °C: 0.06667 × 10^1.92 = 0.06667 × 83.176 | 4.830 and 5.545 min | ±0.001 | [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H23 | Temperature where F0 = 5 min at 4 s | 121.1 + 10 × log10(5 × 60 ÷ 4) = 121.1 + 10 × 1.87506 | 139.851 °C | ±0.001 | [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H24 | Fault temperature diverts at either flow: B\* at 135.5 °C | 4 s: 0.39604 × 10^(0.5 ÷ 10.5) = 0.39604 × 1.11588; 8 s: 0.79208 × 1.11588 | 0.4419 and 0.8839 (both below 1) | ±0.0001 | [D2](DECISIONS.md#d2-missing-defaults) |
| H25 | The preview's fault temperature: B\* at 137.6 °C | 4 s: 0.39604 × 10^(2.6 ÷ 10.5) = 0.39604 × 1.76856; 8 s: 0.79208 × 1.76856 | 0.7004 and 1.4008 (no divert at 8 s) | ±0.0001 | [D2](DECISIONS.md#d2-missing-defaults) (flag 1) |

## Counts and rates

Arithmetic on `plant.json` values. The config test checks H26, H27, H29, H31, H32, H38 and H42 now, and the formula test checks H51; the other rows can be checked against the config the same way. Phase 3 checks the tank and divert rows (H31–H37) against the model, and phase 4 the pack, pallet, batch and truck rows against its counters.

A **pallet-load** is 1,008 packs (H26). The last pallet of each batch is closed part-full ([D1](DECISIONS.md#d1-batch-size), H28), so a batch at full rate is 59.52 pallet-loads but 60 pallets. The model's pallet counters (pallets made, on hold and in stock) and the trucks count pallets. Rows that divide packs by 1,008 give pallet-loads and say so. The pallet-load figures after breakdowns (H40, H43) are tested from D2's mean failure and repair times; the matching pallet figures come from a 20,000-day run of those times and are context, not tested.

| # | What | Formula with inputs | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H26 | Packs per pallet | 12 packs × 84 trays | 1,008 packs (1,008 L, "about 1,000 L") | exact | [Review](REVIEW.md#checked-and-correct) |
| H27 | Packs per batch | 7,500 packs/h × 28,800 s ÷ 3,600 | 60,000 packs | exact | [D1](DECISIONS.md#d1-batch-size); [review](REVIEW.md#checked-and-correct) |
| H28 | Pallets per batch | 60,000 ÷ 1,008 = 59.52: 59 × 1,008 = 59,472, and 60,000 − 59,472 = 528 = 44 trays | 59 full pallets + 1 of 528 packs | exact | [D1](DECISIONS.md#d1-batch-size) (flag 3) |
| H29 | Samples per batch | 28,800 s ÷ 1,800 s | 16, plus 2 per stop | exact | [D1](DECISIONS.md#d1-batch-size) |
| H30 | Batches per day | 2 fillers × 86,400 s ÷ 28,800 s | 6 | exact | [D1](DECISIONS.md#d1-batch-size) |
| H31 | Tank gain at full flow | 16,000 − 2 × 7,500 | +1,000 L/h | exact | [Review](REVIEW.md#checked-and-correct) |
| H32 | Intermediate clean draw | 2 × 7,500 L/h × 1,800 s ÷ 3,600 | 7,500 L; the 10,000 L start level (0.5 × 20,000) leaves 2,500 L | exact | [Review](REVIEW.md#checked-and-correct) |
| H33 | Time from start to first throttle, with no stops or cleans | (0.9 × 20,000 − 10,000) ÷ 1,000 L/h = 8,000 ÷ 1,000 | 8 h | exact | [D2](DECISIONS.md#d2-missing-defaults) |
| H34 | Throttled, from 90% back to 60% | (18,000 − 12,000) L ÷ (15,000 − 8,000) L/h = 6,000 ÷ 7,000 h | 51.43 min | ±0.01 | [D2](DECISIONS.md#d2-missing-defaults) |
| H35 | Divert volume | 16,000 L/h × 180 s ÷ 3,600 | 800 L at full flow (400 L at 50%) | exact | [D2](DECISIONS.md#d2-missing-defaults) |
| H36 | UHT plant out after a divert | 3 min divert + 80 min CIP + 30 min sterilizing | 113 min | exact | [D2](DECISIONS.md#d2-missing-defaults) |
| H37 | Tank runs dry after a divert from 50% | (10,000 − 150) L ÷ 15,000 L/h = 0.6567 h | 39.4 min; the fillers would need 15,000 × 113 ÷ 60 = 28,250 L, more than the whole tank | ±0.01 | [Fault scenarios](06-simulation-model.md#fault-scenarios) |
| H38 | Most pallets a day | 2 × 7,500 packs/h × 24 h ÷ 1,008; 6 batches (H30) × 60 pallets (H28) | 357.14 pallet-loads; 360 pallets | ±0.01; exact | [R9](REVIEW.md#r9-quarantine-scale); [D1](DECISIONS.md#d1-batch-size) |
| H39 | Filler availability | 28,800 s ÷ (28,800 + 120 + 720) s = 480 min ÷ 494 min | 0.97166 | ±0.00001 | [D2](DECISIONS.md#d2-missing-defaults) |
| H40 | Pallets a day after breakdowns | 357.14 × 0.97166 | 347.02 pallet-loads (about 350 pallets, 58.3 a batch) | ±0.01 (pallets: context) | [D3](DECISIONS.md#d3-truck-payload) |
| H41 | Trucks a day | 86,400 s ÷ 6,000 s | 14.4 | exact | [D3](DECISIONS.md#d3-truck-payload) |
| H42 | Pallets shipped a day | 14.4 × 22; the preview: 33 × 24 ÷ 2.5 | 316.8 (about 317) | exact | [D3](DECISIONS.md#d3-truck-payload); [R3](REVIEW.md#r3-truck-payload) |
| H43 | Stock growth | 347.02 − 316.8 | +30.22 a day with output in pallet-loads; in pallets, as the stock counts them, about +33 (350 − 316.8) | ±0.01 (pallets: context) | [D3](DECISIONS.md#d3-truck-payload) |
| H44 | Days of cover | Released stock ÷ 316.8; for 634 pallets: 634 ÷ 316.8 | 2.00 days | ±0.01 | [D2](DECISIONS.md#d2-missing-defaults) |
| H45 | Truck weight | 22 × 1.1 t; 33 × 1.1 t | 24.2 t; 36.3 t | ±0.1 (context, not tested) | [R3](REVIEW.md#r3-truck-payload) |
| H46 | Batch failure chance | 1 − 0.9998^16 = 1 − 0.9968048 | 0.0031952 (0.32%) | ±0.0000001 | [R10](REVIEW.md#r10-rare-qa-failures) |
| H47 | Batch failure chance with one stop (18 samples) | 1 − 0.9998^18 | 0.0035939 (0.36%) | ±0.0000001 | [R10](REVIEW.md#r10-rare-qa-failures) |
| H48 | Days between random blocked batches | 1 ÷ (6 × 0.0031952) = 1 ÷ 0.019171 | 52.16 days (review: about 50) | ±0.01 | [R10](REVIEW.md#r10-rare-qa-failures) |
| H49 | Pallets in quarantine (7 days) | 7 days of output: 357.14 × 7. At full rate: 42 batches on hold (21 shift changes × 2 fillers) × 60, plus up to 2 × 60 on the two open batches | 2,500 pallet-loads; 2,520 pallets just after a release, up to 2,640 just before the next | ±0.1; exact | [R9](REVIEW.md#r9-quarantine-scale); [D1](DECISIONS.md#d1-batch-size) |
| H50 | First release, starting empty on day 1 | Batch 1 ends day 1, 14:00; + 7 days | Day 8, 14:00 (sim time 655,200 s) | exact | [D11](DECISIONS.md#d11-opening-state) |
| H51 | OEE example: one filler, one 8-hour shift, one 14-min stop | A = (480 − 14) ÷ 480 = 0.97083; P = 7,500 ÷ 8,000 = 0.9375; Q = 1 (no reject rate yet); OEE = 0.97083 × 0.9375 × 1 | 0.91016 (91.0%); 466 ÷ 60 × 7,500 = 58,250 packs | ±0.00001 | [OEE](06-simulation-model.md#core-formulas) |
| H52 | Long-run OEE | 0.97166 × 0.9375 × 1 | 0.91093 (91.1%); *phase 4*: with the seal check's 0.2% rejects (`fillers.rejectFrac`, [D14](DECISIONS.md#d14-phase-4-packs-to-trucks-defaults)) Q = 0.998, so 0.90911 (90.9%) | ±0.00001; the 60-day run ±0.004 | Same |

## Clock

H53–H55 are tested in phase 1 ([D8](DECISIONS.md#d8-clock)): H53 through the shift grid (`quality.firstShiftStartS`, which stays at 06:00 if [D11](DECISIONS.md#d11-opening-state) moves the clock's start), H54 with the config and H55 with `clock.ts`. H56 is tested with `clock.ts` at ×10,000 and 60 fps. H57 explains the 10 s step and has no test of its own; phase 3's step-size test covers the tank.

| # | What | Formula with inputs | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H53 | Start time and first shift | 6 h × 3,600; *phase 4*: 7 days × 86,400 + 21,600 | 21,600 s (day 1, 06:00): `quality.firstShiftStartS`, and `clock.startTimeS` until phase 4; since [D11](DECISIONS.md#d11-opening-state) the plant opens at 626,400 s (day 8, 06:00), on the same shift grid | exact | [D8](DECISIONS.md#d8-clock); [D1](DECISIONS.md#d1-batch-size) |
| H54 | 7 days at ×10,000 | 7 × 86,400 s ÷ 10,000 = 604,800 ÷ 10,000 | 60.48 s of real time (about a minute) | ±0.01 | [How time works](06-simulation-model.md#how-time-works); [review](REVIEW.md#checked-and-correct) |
| H55 | Steps in a capped 0.1 s frame | ×10,000: 0.1 × 10,000 ÷ 10 s; ×1,000: 0.1 × 1,000 ÷ 1 s | 100 steps each, under the 500 cap | exact | [D8](DECISIONS.md#d8-clock) |
| H56 | Steps per frame at ×10,000 and 60 fps | 10,000 ÷ 60 = 166.7 s ÷ 10 s | 16.7 | ±0.1 | [D8](DECISIONS.md#d8-clock) |
| H57 | Largest tank change in one 10 s step | 16,000 L/h × 10 s ÷ 3,600 | 44.4 L | ±0.1 | [D8](DECISIONS.md#d8-clock) |

## Model checks

Run the model with seed 81006 and compare. These are for phases 3 and 4; the long-run values come from a one-year run of the preview's rules with these settings, so they carry wider tolerances.

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H58 | Output over 30 days | Pallets made ÷ 30 | About 350 pallets a day (347 pallet-loads, H40); a one-year run of the preview, which carries part-full pallets over, gave 346.9 pallet-loads | ±3% | [D2](DECISIONS.md#d2-missing-defaults) |
| H59 | Share of production time throttled | Throttled time ÷ production time | About 9% (one-year run: 8.8%). Phase 4 only: the 9% comes from filler breakdowns, which let the tank fill. With phase 3's filler stub, which never stops, the plant throttles 3.125% of its production time in the long run: each 10 h of production has to shed the tank's net gain of 10,000 − 7,500 = 2,500 L, and a throttled hour sheds 8,000 L more than a full-flow hour, so 2,500 ÷ 8,000 = 0.3125 h in 10 h. A 90-day run gives 3.13% | ±3 points | [D2](DECISIONS.md#d2-missing-defaults) |
| H60 | Tank balance | Level change = litres in − litres out, every step | Exact to rounding | ±0.001 L | Plan 06, tank level formula |
| H61 | Pack balance | Packs made = packs on closed pallets (1,008 each, fewer on the last of a batch) + packs on open pallets + samples taken | Exact | exact | Plan 06, discrete model |
| H62 | Temperature drop at full flow and at 50% | Trigger `uhtTempDrop` in each state | Divert both times; reject tank +800 L or +400 L; back in production after 113 min | exact | H24, H35, H36 |
| H63 | Noise never diverts | 7 days at 140 °C, no faults | 0 diverts | exact | H21 |

## Line points

The temperature and flow at each measuring point of the liquid line (`Snapshot.line`, contracts v1), in flow order, for the static plant of phase 2: every stage at its `plant.json` set point, the UHT plant at full flow, both fillers running and no divert. The 3D view colours each pipe from these temperatures, blue at 4 °C through yellow to red at 140 °C ([plan 08](08-user-interface.md#colour-rules)). The static-plant test can check every row now; phase 3 checks them again against the stage 1–6 models at steady state. A point's flow is the milk leaving it, so the `separator` row is the standardized milk after the cream is remixed. Where the milk is heated or cooled between two points, as across the plates or along the cooler passes, the pipe's colour ramps linearly from one to the next (`src/scene/pipes.ts`); only the points themselves are expected values.

| # | Point (`LinePointId`) | Temperature | Flow | Tolerance | Source |
|---|---|---|---|---|---|
| H64 | `silo`: raw milk to the separator | 4 °C | 16,000 L/h; *phase 3*: 16,222.22 L/h, the raw milk that 16,000 L/h of 3.5% milk needs (H3) | exact; ±0.01 in phase 3 | [Chart values](02-uht-line-at-a-glance.md#chart-values-as-text); `standardization.siloTempC`, `uht.capacityLph` |
| H65 | `separator`: standardized milk to the mixing tank | 60 °C | 16,000 L/h; the 222.22 L/h of surplus cream (H4) leaves the line here | exact | Chart values; `standardization.separatorTempC` |
| H66 | `feedTank`: the mixing tank, which feeds the UHT plant | 4 °C | 16,000 L/h | exact | Chart values; `standardization.feedTankTempC` |
| H67 | `preheater` outlet | 80 °C | 16,000 L/h | exact | Chart values; `preheating.preheatTempC` |
| H68 | `deaerator` | 80 − 4 = 76 °C | 16,000 L/h | exact | H6; [D9](DECISIONS.md#d9-other-open-values) |
| H69 | `homogenizer` outlet | 76 + (200 + 30) ÷ 40 = 81.75 °C | 16,000 L/h | ±0.001 °C; flow exact | H7; [D5](DECISIONS.md#d5-homogenizer-outlet) |
| H70 | `holdingTube` outlet | 140 °C | 16,000 L/h | exact | Chart values; [D4](DECISIONS.md#d4-divert-rule-and-display-noise); `uht.setpointC`, `uht.capacityLph` |
| H71 | `divert`: the line to the reject tank | 140 °C (the holding-tube outlet) | 0 L/h | exact | No divert in the static plant; `linePoints` in `src/sim/staticPlant.ts` |
| H72 | `flashVessel` outlet | 80 °C | 16,000 − 0 = 16,000 L/h | exact | Chart values; D5 (80 °C, not 81.75 °C); `flashCooling.flashTempC` |
| H73 | `cooler` outlet | 20 °C | 16,000 L/h | exact | Chart values; `flashCooling.coolerTempC` |
| H74 | `asepticTank` outlet to the fillers | 20 °C | 2 × 7,500 packs/h × 1 L = 15,000 L/h | exact | Chart values; H31; `asepticTank.tempC`, `fillers.count`, `fillers.ratePacksPerH`, `product.packVolumeL` |
| H75 | `filler` | 20 °C | 15,000 L/h, both fillers together | exact | Chart values; `fillers.tempC`; H74 |

How the flows move once phases 3 and 4 make them live, for the tests that follow:

- **Throttled** (tank above 90%): every point from `silo` to `cooler` carries 8,000 L/h (`silo` 8,111.11 L/h), the hold doubles to 8 s (H10) and the temperatures stay as above.
- **Divert:** `divert` carries the whole UHT flow and `flashVessel` and `cooler` carry 0, so the reject tank gains 800 L in 3 min at full flow (H35, H62).
- **Fillers:** `asepticTank` and `filler` carry 7,500 L/h per running filler, and 0 while both are stopped or the tank is below 150 L.

## Phase 3 acceptance runs

These runs check the live stage 1–6 model against the rows above. `qa` automates them, and `process` signs them off for the [phase-3 exit checklist](agent-plan/phase-3-liquid-line.md#exit-checklist). Four runs follow the phase-3 card: (a) a normal run, H76–H87; (b) set 139 °C, which must divert, H88–H91; (c) throttle to 50%, H92–H93; (d) an intermediate clean covered by the buffer, H94. H95 and H96 check mass balance and step size. The values the hand calculations don't give a row of their own (air content, heat recovered, globule size, creaming risk, power, steam, condenser load, headspace pressure) are worked from the [D13](DECISIONS.md#d13-phase-3-liquid-line-defaults) keys and checked in `tests/sim/acceptanceQa.test.ts`.

How to run them:

- **Config.** Take `copyConfig()` from `tests/helpers/plantConfig.ts`, change only the keys the row names, then call `createSim(config)`. *Since phase 4* take `phase3Config()` instead: the shipped config with the clock back at day 1, 06:00 and no filler breakdowns, the plant these rows were worked for. The packs model's breakdowns ([H39](#counts-and-rates)) change the tank's course, and [D11](DECISIONS.md#d11-opening-state) moved the opening to day 8. The seed stays 81006. *Noise off* means `uht.displayNoiseC` = 0: the holding-tube reading is then the set point, so F0, B\* and the divert limit can be checked to their H-row tolerance. With the default ±0.3 °C, check the noise band instead (H21, H22).
- **Time.** t is sim time since the plant opened, `snapshot.timeS` − 21,600 (day 1, 06:00). "At t = 0" means before the first step.
- **Stepping.** At the default ×10, each `step(0.1)` advances exactly 1 s. After `dispatch({ type: 'setSpeed', speed: 1000 })`, each `step(0.1)` advances 100 s in 1 s steps; at ×10,000 it advances 1,000 s in 10 s steps (`clock.fastStepS`). A step never crosses a shift change (t = 28,800, 57,600 and 86,400 s), and those lie on every step grid used here.
- **Set points.** `dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value })` takes effect on the next step.
- **Crossings.** The model cuts each step at a threshold crossing and switches at the exact time, so levels and switch times are the same at any step size up to the 60 s cap. A snapshot shows the switch at the end of the step in which it happened; time tolerances below allow for that.

### Normal run, at the defaults

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H76 | Line points at steady state | Noise off; read `snapshot.line` at t = 600 s, when any start-up lag has settled | `silo` 4 °C, 16,222.22 L/h; `separator` 60 °C, `feedTank` 4 °C, `preheater` 80 °C, `deaerator` 76 °C, `homogenizer` 81.75 °C, `holdingTube` 140 °C, `flashVessel` 80 °C, `cooler` 20 °C, each 16,000 L/h; `divert` 140 °C, 0 L/h; `asepticTank` and `filler` 20 °C, 15,000 L/h | ±0.01 °C; ±0.01 L/h | H3, H64–H75 |
| H77 | Stage 1 values | Same run, `stages[1].values` at t = 600 s | `rawMilkLph` 16,222.22; `surplusCreamLph` 222.22; `creamShareFrac` 0.08636; `rawMilkFatPct` 4.0, `productFatPct` 3.5; `mixTankLevelPct` 50, since the mixing tank's inflow follows the UHT draw; `siloLevelPct` above 0 and at most 100 (the intake rule comes from D13) | ±0.01 L/h; ±0.00001; ±0.5 points | H1–H4; [D13](DECISIONS.md#d13-phase-3-liquid-line-defaults) |
| H78 | Stage 2 values | Same | `preheatTempC` 80, `deaeratorTempC` 76 | ±0.01 °C | H6, H67, H68 |
| H79 | Stage 3 values | Same | `stage1Bar` 200, `stage2Bar` 30, `inletTempC` 76, `outletTempC` 81.75. Context for `powerKw`: the hydraulic power at 16,000 L/h and 230 bar is 4.444 L/s × 23 MPa = 102.22 kW, before the efficiency in D13 | ±0.001 °C; bar exact | H7, H8; [D5](DECISIONS.md#d5-homogenizer-outlet) |
| H80 | Stage 4 values and KPIs | Same; then the same read with the default noise | Noise off: `setpointC` 140, `tempC` 140, `flowLph` 16,000, `holdS` 4.000, `f0Min` 5.175, `bStar` 1.1856, `divertLimitC` 139.224, `rejectLevelL` 0; KPIs `uhtFlowLph` 16,000, `f0Min` and `bStar` as the stage, `divertedL` 0; `liquid.uhtMode` 'production'. Default noise: `tempC` 139.7–140.3, `bStar` 1.1101–1.2662, `f0Min` 4.830–5.545, the limit unchanged, and stage 4 never 'bad' | H-row tolerances; bands inclusive | H9, H11–H13, H21, H22; [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H81 | Stage 5 values | Same | Flash vessel 80 °C, cooler 20 °C, 16,000 L/h through both (H72, H73) | ±0.01 °C; ±0.01 L/h | H72, H73; [D5](DECISIONS.md#d5-homogenizer-outlet) |
| H82 | Stage 6 and the liquid snapshot at the start | Same run, at t = 0 and t = 600 s | At t = 0: `levelL` 10,000, `levelPct` 50, `capacityL` 20,000, `tempC` 20, `nextCleanS` 36,000; tanks: silo 60,000 of 100,000 L, mixing tank 5,000 of 10,000 L, aseptic tank 10,000 of 20,000 L, reject tank 0 of 6,000 L; `throttled` false, `fillersRunning` 2, `fillersStarved` false, `divertCount` 0, `modeRemainingS` 0; KPI `tankLevelPct` 50. At t = 600 s: `inflowLph` 16,000, `outflowLph` 15,000, `levelL` 10,166.67, `nextCleanS` 35,400, `headspaceBar` above 0 and at most 3.0 | ±0.01 L; ±0.01 L/h; ±1 s | H31; [D2](DECISIONS.md#d2-missing-defaults), [D9](DECISIONS.md#d9-other-open-values), [D13](DECISIONS.md#d13-phase-3-liquid-line-defaults) |
| H83 | The tank rises 1,000 L/h | ×1,000 from t = 0; read at t = 14,400 s (4 h) | `levelL` 14,000 (70%); every step, the level changes by exactly (inflow − outflow) × step | ±0.1 L; per step as H60 | H31, H60 |
| H84 | First throttle | Same run to t = 28,801 s | The level reaches 18,000 L at t = 28,800 s (8 h, day 1 14:00) and `throttled` turns true on the next step; from then `silo` carries 8,111.11 L/h and `separator` to `cooler` 8,000 L/h; one log entry; `nextCleanS` 7,200 | ±1 s; ±5 L; ±0.01 L/h | H33 |
| H85 | Throttled time | Same run to t = 32,000 s | `throttled` turns false at t = 31,885.7 s (8 h 51.43 min), when the level falls below 12,000 L; throttled for 3,085.7 s = 51.43 min; exactly one switch each way | ±3 s | H34; [D2](DECISIONS.md#d2-missing-defaults) |
| H86 | First intermediate clean | Same run to t = 37,900 s | `uhtMode` 'aic' from t = 36,000 s (10 h of production; throttled time counts) to 37,800 s, with `modeRemainingS` counting down from 1,800; `feedTank` to `cooler` carry 0 L/h; the level falls from 13,142.86 L to 5,642.86 L, exactly 7,500 L; `fillersRunning` stays 2; `nextCleanS` back to 36,000 when production resumes | ±1 s; ±5 L | H32; [D2](DECISIONS.md#d2-missing-defaults), [D13](DECISIONS.md#d13-phase-3-liquid-line-defaults) |
| H87 | 24 h without faults | Same run to t = 86,400 s | Second clean from t = 73,800 to 75,600 s (15,642.86 L → 8,142.86 L, no throttle before it); `levelL` 11,142.86 at 24 h; 1 throttle, 2 cleans, 0 diverts; `fillersStarved` never true (lowest level 5,642.86 L); the UHT plant made 361,142.86 L and the fillers drew 360,000 L | ±1 s; ±5 L | H31–H34 |

### Set 139 °C: divert

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H88 | 139 °C diverts within one step at full flow | Noise off; at t = 0 set `uhtSetpointC` 139, step once at ×10, then set it back to 140 | After the first step: `uhtMode` 'divert', `divertCount` 1, stage 4 'bad', `bStar` 0.9521, `f0Min` 4.111; `divert` carries 16,000 L/h, `flashVessel` and `cooler` 0; one log entry. Setting 140 °C again does not stop the sequence. The model diverts when B\* < 1 for either the noisy reading or the set point ([D4](DECISIONS.md#d4-divert-rule-and-display-noise)), so with the default noise 139 °C also diverts on the first step, even when the reading is as high as 139.3 °C (B\* 1.0169); check it over several seeds. A set point above the limit, such as 139.3 °C, diverts only in a step whose reading falls under 139.224 °C | B\* ±0.0001; F0 ±0.001; the step exact | H13; [D4](DECISIONS.md#d4-divert-rule-and-display-noise) |
| H89 | Reject volume at full flow | Same run to t = 181 s | The reject tank (`rejectLevelL`, `liquid.tanks.rejectTank`) gains 800 L over the 180 s divert; KPI `divertedL` 800; `uhtMode` 'cip' from t = 180 s | ±5 L; ±1 s | H35 |
| H90 | Back in production after 113 min | Same run to t = 7,000 s | 'cip' from t = 180 to 4,980 s, 'sterilize' to 6,780 s, 'production' from 6,780 s (113 min); `modeRemainingS` counts down through each; log entries for divert, CIP, sterilizing and production; no second divert at 140 °C; `nextCleanS` 36,000 when production resumes (a full CIP restarts the count). The aseptic tank gets no milk from t = 0: the fillers stop at 150 L at t = 2,364 s (39.4 min) with `fillersStarved` true, and the level stays within one step's draw (4.17 L) of 150 L until production resumes | ±2 s; ±5 L | H36, H37; [D2](DECISIONS.md#d2-missing-defaults), [D13](DECISIONS.md#d13-phase-3-liquid-line-defaults) |
| H91 | The same set point at 50% flow | `asepticTank.startFrac` = 0.95, default noise; set 139 °C at t = 60 s, then 135.5 °C at t = 120 s | 139 °C does not divert: at 8 s its lowest reading, 138.7 °C, gives B\* 1.7830. 135.5 °C (the [D2](DECISIONS.md#d2-missing-defaults) fault temperature) diverts on the next step: its highest reading, 135.8 °C, gives B\* 0.9440. The plant stays throttled (the level is still about 18,000 L at the end of the divert), so the reject tank gains 400 L by t = 300 s; then CIP and sterilizing as H90 | ±5 L; ±1 s | H24, H35 |

### Throttle to 50%

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H92 | The R6 values | `asepticTank.startFrac` = 0.95 (19,000 L), noise off; read at t = 60 s | `throttled` true from the first step; stage 4 `flowLph` 8,000, `holdS` 8.000, `bStar` 2.3712, `f0Min` 10.350, `divertLimitC` 136.063; `silo` 8,111.11 L/h, `surplusCreamLph` 111.11, `separator` to `cooler` 8,000 L/h; the tank falls 7,000 L/h (18,883.33 L at t = 60 s). With the default noise: `bStar` 2.2202–2.5324, `f0Min` 9.659–11.090. The default run (H84) shows the same values between t = 28,801 and 31,885 s | H-row tolerances; ±0.01 L/h; ±5 L | H10, H15–H17; [R6](REVIEW.md#r6-holding-time) |
| H93 | Back to full flow | Same run to t = 3,610 s | The level reaches 12,000 L at t = 3,600 s (7,000 L in 1 h) and `throttled` turns false on the next step; then `holdS` 4.000, `bStar` 1.1856, `divertLimitC` 139.224 again | ±2 s; ±5 L | H34 |

### Intermediate clean covered by the buffer

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H94 | The tank covers a clean from 50% | `cleaning.aicEveryProductionS` = 10, so the clean starts from about 10,000 L; ×10 to t = 1,900 s | 'aic' from t = 10 to 1,810 s; the level falls from 10,002.78 L to 2,502.78 L, exactly the 7,500 L the fillers draw in 30 min; `fillersRunning` 2 and `fillersStarved` false throughout | ±1 s; ±5 L | H32; [review](REVIEW.md#checked-and-correct) |

### Mass balance and step size

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H95 | Mass balance over 24 h | H76–H87's run, and H88's divert run, each for 24 h (t = 0 to 86,400 s) at ×1,000 | Litres drawn from the silo = litres to the fillers + litres sent to the reject tank (`divertedL`, not its level, which may be emptied) + surplus cream + change in mixing-tank contents + change in aseptic-tank contents. Steam drops out, since the flash vessel removes what it added. Without faults: fillers 360,000 L, aseptic tank +1,142.86 L, reject 0; if the mixing tank ends at its start level, 366,158.73 L drawn and 5,015.87 L of cream | 0.1% of the litres drawn | H3, H31–H35, H60 |
| H96 | 1 s and 60 s steps agree | H87's run at 1 s steps (×1,000), and again with `clock.fastStepS` = 60 at ×10,000 | At t = 86,400 s, every tank level, `divertedL`, litres drawn from the silo and litres to the fillers within 1% of the 1 s run; the same number of throttles (1), cleans (2) and diverts (0). Context: the model switches at the exact crossing at either step (throttle at t = 28,800 s, full flow again at 31,885.7 s), so the 60 s run ends at the same 11,142.86 L | ±1% | H57; [D8](DECISIONS.md#d8-clock) |

## Phase 4 acceptance runs

These runs check the live stage 7–10 model (`src/sim/packsLine.ts` and `src/sim/packs/`) against the logistics rows above, for the [phase-4 card](agent-plan/phase-4-packs-to-trucks.md#who-does-what). `process` worked them, and `tests/sim/acceptancePacks.test.ts` runs them through `createSim`. The rows at the defaults over a long run (H52, H58, H59, H41–H43 and the R9 range) run in `tests/sim/packsLongRun.test.ts` over 60 days.

How to run them:

- **Config.** The *full-rate plant* is `emptyPlantConfig()` from `tests/helpers/packsRun.ts` with `fillers.mtbfMeanS` = 10¹² s: no breakdowns, no batches on hold and no stock at the opening, so every count follows from the rates. The other rows take the shipped config. Seed 81006.
- **Time.** The plant opens on day 8 at 06:00 (626,400 s, [D11](DECISIONS.md#d11-opening-state)); t is sim time since then. Shift changes fall at t = 0, 28,800 and 57,600 s each day.
- **Stepping.** At ×10,000 each 0.1 s frame advances 1,000 s in 10 s steps, cut at every queued event (a breakdown, a truck, a shift change), so events happen at their exact times.

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H97 | Pallets a day at full rate | The full-rate plant for 9 days; pallets made in each day from 06:00 to 06:00 | 360 a day: 6 batches (H30) × 60 pallets, the last of each part-full. 357.14 pallet-loads (H38) | exact | H38; [D1](DECISIONS.md#d1-batch-size) |
| H98 | One batch at full rate | Same run, every closed batch | 60,000 packs made (H27); the seal check rejects 0.2%, 120 packs; 16 samples go to the incubators (H29); 60,000 − 120 − 16 = 59,864 packs on 60 pallets: 59 full (59,472) and one of 392. H28's 528 is the count before rejects and samples | exact | H27–H29; [D14](DECISIONS.md#d14-phase-4-packs-to-trucks-defaults) |
| H99 | Quarantine at 7 days of incubation, full rate | Same run, pallets in quarantine from day 7 to day 9 | 2,520 just after each release (42 batches on hold × 60); up to 2,640 just before one, with the two open batches nearly full (H49). The run reaches 2,636: the open pallets are counted in packaging until they close | 2,520 exact; at most 2,640 | H49; [R9](REVIEW.md#r9-quarantine-scale) |
| H100 | OEE at full rate | Same run, `kpis.oeePct` and each filler's `oeePct` | A = 1 (never stopped), P = 7,500 ÷ 8,000 = 0.9375, Q = 0.998: 0.935625 (93.6%). The plant opens at 93.75%, before its first reject | ±0.00001 | H51, H52 |
| H101 | Truck interval | The shipped config for one day; each truck's `arrivedS` | The first 6,000 s (100 min) after opening, then one every 6,000 s: 1.67 h, which matches R3's "about one every 1.7 h" for 22 pallets; 14 arrive in the first day (14.4 a day, H41), each takes 22 pallets (316.8 a day, H42) | ±0.001 s | H41, H42; [R3](REVIEW.md#r3-truck-payload) |
| H102 | SSCC check digit | GS1 mod 10 over the 17 digits of extension 3, company prefix 0614141 and serial 000054001 (batch 54, pallet 1): from the right, weights 3, 1, 3, 1…: 1×3 + 0 + 0 + 4 + 5×3 + 0 + 0 + 0 + 0 + 1 + 4×3 + 1 + 4×3 + 1 + 6×3 + 0 + 3×3 = 76; (10 − 76 mod 10) mod 10 | 4: SSCC 306141410000540014, shown as "(00) 3 0614141 000054001 4" | exact | [GS1 SSCC](https://gs1uk.org/support-training/help-to-use-and-implement-gs1-standards/logistics-labels-and-ssccs) |
| H103 | Days of cover at the opening | The shipped config at t = 0 | 634 pallets ÷ 316.8 a day = 2.00 days (H44) | ±0.01 | H44; D11 |

At the defaults, the 60-day run gives (seed 81006): 349.8 pallets a day (H58: about 350), OEE 91.0% against H52's 90.91%, 8.5% of production time throttled (H59: about 9%), 2,421–2,626 pallets in quarantine with a mean of 2,508 (R9), 14.38 trucks a day, every one loaded on arrival, and stock growing by 30.1 pallets a day (H43). The 42 batches on hold at the end average 58.5 pallets (H40: 58.3) and 18 samples, 16 plus 2 per restart. Three batches were blocked in the 60 days, against about 1.2 expected at H47's rate; a run of 3 or more has a chance of about 12%, so the test allows up to 6.

**Label fields (`process`, checked against GS1).** A pallet's logistics label carries its SSCC under application identifier (00): 18 digits, an extension digit, the GS1 company prefix, a serial reference and a mod-10 check digit, as `src/contracts/sscc.ts` builds it. The model uses 0614141, the example prefix in GS1's own documents, and the serial is batch × 1,000 + pallet number, so a batch holds at most 999 pallets (`plant.json` is checked for it). The batch list also shows each pallet's batch (AI 10) and best-before date (AI 15), the other two fields a dairy pallet label carries. The model draws no barcode.

**OEE (`process`, checked).** OEE = availability × performance × quality ([Simulation model](06-simulation-model.md#core-formulas)): availability is running time over the time the filler was open (since the plant opened), performance is packs made over the maximum rate (8,000 packs/h) times running time, and quality is good packs over packs made. Starved time counts against availability, not as a breakdown; a filler set to 0 packs/h counts as open but not running.

## Phase 5 scenario scripts

One script for each of the six [fault scenarios](06-simulation-model.md#fault-scenarios), for the [phase-5 card](agent-plan/phase-5-detail-and-scenarios.md#who-does-what): the trigger, the state changes and KPIs it must cause with their sim times, what the viewer should see, and two lines on why. `process` wrote them, `sim` built `src/sim/scenarios.ts` to them, and `tests/sim/scenarios.test.ts` runs each through `createSim`. The keys are [D15](DECISIONS.md#d15-phase-5-fault-scenario-defaults)'s.

How to run them:

- **Config.** The shipped config, seed 81006. Each scenario is triggered as the plant opens: day 8 at 06:00 (626,400 s, [D11](DECISIONS.md#d11-opening-state)), full flow, the aseptic tank at 10,000 L, both fillers on batches 54 and 55 (06:00 to 14:00), 42 batches on hold, 634 pallets in stock, the first truck due at 100 min. t is sim time since the trigger.
- **Stepping.** ×10 (1 s steps, cut at the steam dip's divert-limit crossing and at every queued event) unless a row says ×1,000 or ×10,000.
- **What the viewer sees** is checked in the browser (`e2e/scenarios.spec.ts`) and by the scene's unit tests; every scenario also shows its banner over the 3D view and its steps, each with its why, in the scenario log.

| # | Scenario | Trigger | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H104 | UHT temperature drop | Menu at t = 0 | The steam supply dips: the outlet falls as 135.5 + 4.5 e^(−t/15) °C toward the fault temperature (`uht.faultTempC`, lag `scenarios.steamFaultLagS` = 15 s). At the 4 s hold it crosses the divert limit, 135 + 10.5 log10(10.1 ÷ 4) = 139.22 °C, at t = 15 ln(4.5 ÷ 3.7237) = 2.84 s, or up to 1.2 s earlier on a reading 0.3 °C low (D4): divert. 3 min to the reject tank, 16,000 L/h × 180 s = 800 L; full CIP 80 min; sterilizing 30 min at 125 °C; back in production 113 min after the divert (H36), when the steam is restored. The fillers drain the tank: 10,000 + 0.8 L down to 150 L at 15,000 L/h, 2,364 s (39.4 min) after the divert (H37), and restart 350 L ÷ 16,000 L/h = 78.75 s after production resumes. At 50% flow (8 s hold) the limit is 136.06 °C, crossed by 31.2 s, and the reject tank gains 400 L | Divert 1.68–2.85 s (2.84 ±0.01 without noise); 800 L exact; each later step ±1e-6 s; restart ±0.01 s; 50%: 24.8–31.2 s | H24, H35–H37, H62; D2 |
| H105 | Filler breakdown | Menu at t = 0 (the first running filler, A) | A jammed sealing jaw stops filler A: 60 min of repair (`scenarios.fillerRepairS` = 3,600 s) and 2 min re-sterilizing (`fillers.repairFixedS`), so it fills again at 3,720 s. The tank rises 16,000 − 7,500 = 8,500 L/h from 10,000 L to 90% (18,000 L) at 8,000 ÷ 8,500 h = 3,388.2 s: the UHT plant throttles to 50%. With A back, the tank falls 15,000 − 8,000 = 7,000 L/h from 18,046 L to 60% (12,000 L) at 6,829.4 s: full flow again. Line A makes 3,720 s × 7,500 packs/h = 7,750 packs fewer than B. Filler A's breakdown count is 1 | ±0.5 s; ±2 packs | H31, H33; D2, D14 |
| H106 | Sterile-air filter failure | Menu at t = 0 | The tank's sterile-air filter fails its integrity test: a process deviation. The batches filling now, 54 and 55, go under investigation (`flags` = `sterileAir`), and so would any batch started before the filter is replaced at 2 h (`scenarios.filterReplaceS` = 7,200 s). Stage 6 is amber for those 2 h. Each batch is judged when its incubation ends, its shift end plus 7 days (8 h + 7 d = 633,600 s), with a 5% chance per sample of a spoiled one (`scenarios.filterFailurePerPack` = 0.05) instead of 0.02% per pack: 1 − 0.95^n for its n samples, at least 16 (1 − 0.95^16 = 56%) | Verdicts ±1e-6 s; the chance exact | R10; D15 |
| H107 | Failed incubation | Menu at t = 0 | The oldest batch on hold, 12 (59 pallets), fails incubation at once: a blown pack at the incubator check. It is blocked (`qaResult` fail): 41 batches on hold, 1 blocked, stage 9 red. A day later (`quality.blockedHoldS` = 86,400 s) its 59 pallets leave quarantine for destruction | exact | R10; D14 |
| H108 | Homogenizer pressure loss | Menu at t = 0, ×10,000 | Stage 1 holds 50 bar (`scenarios.homogenizerFaultBar`) for 1 h (`scenarios.homogenizerRepairS` = 3,600 s): globules 0.8 × (200 ÷ 50)^0.6 = 1.838 µm, creaming risk (1.838 − 1) ÷ (2 − 1) = 83.79%, outlet 76 + (50 + 30) ÷ 40 = 78 °C, stage 3 red. Back at 200 bar after the repair. Batches 54 and 55 are flagged with the creaming risk; at the end of their incubation (633,600 s) the sensory check finds a cream layer, risk 84% ≥ 50% (`scenarios.sensoryFailAbovePct`), and blocks both | ±1e-9 µm and °C; ±0.01%; verdicts ±1e-6 s | H7, D5, D13 |
| H109 | Demand spike | Menu at t = 0 (variant `demandSpike`) | 12 extra trucks (`scenarios.spikeTrucks`) every 5 min (`scenarios.spikeEveryS` = 300 s) from t = 0, each taking 22 pallets in 20 min at one of 3 doors: the docks take one every 400 s against one every 300 s, so up to 3 wait in the yard, and the 12th starts at 4,200 s and leaves at 5,400 s. Stock 634 − 12 × 22 = 370 pallets, 370 ÷ 316.8 = 1.17 days of cover. Order fill 25%: only the 3 that found a free door on arrival count as filled | Yard and times exact; days ±1e-9 | H41–H44; D3, D14 |
| H109 | Late trucks | Menu at t = 0 (variant `lateTrucks`), ×1,000 | No truck until 24,000 s (`scenarios.lateTruckDelayS`); the 4 due at 6,000, 12,000, 18,000 and 24,000 s arrive together: 3 dock, 1 waits in the yard and leaves at 26,400 s. Stock 634 − 88 = 546 pallets (no release before 14:00), order fill 75%; the schedule goes on with the next truck due, at 30,000 s | exact | H41; D3, D14 |
| H110 | Resets, and what cannot start | Menu → Reset scenarios | Reset puts the running faults right at once and lets what they caused run its course: the steam is restored (before the divert, the run is called off: no divert); a filler's repair ends and it re-sterilizes 2 min (repaired at 600 s, sterile at 720 s); the filter is replaced and the homogenizer repaired, while the batches stay under investigation; extra trucks still to come are cancelled ("9 extra trucks cancelled" at 610 s) and held-up trucks arrive now. A scenario that cannot start says why: the steam already down or the plant cleaning; every filler down; no batch on hold; trucks already disrupted. The same seed gives the same scenario log, entry for entry | exact | D15 |

Why, in two lines each:

- **UHT temperature drop.** Below the divert limit the milk is not commercially sterile (B\* < 1), so the divert valve sends it to the reject tank automatically. Everything after the valve has then seen unsterile product, so the plant is cleaned and re-sterilized before it may make product again, and the aseptic tank feeds the fillers meanwhile.
- **Filler breakdown.** A filler that stops no longer draws from the aseptic tank, which takes up the difference until it is 90% full. Then the UHT plant throttles to half flow so the tank cannot overflow, rather than stopping and needing a full clean.
- **Sterile-air filter failure.** The filter keeps the tank's headspace sterile; when it fails its integrity test, unsterile air may have reached product. The batches filled meanwhile cannot be released on the usual incubation sample alone, so they are held under investigation with a much higher chance of a spoiled sample.
- **Failed incubation.** One blown pack among a batch's incubated samples means the batch may not be sterile, so all of it is blocked and destroyed. At 0.02% per pack this happens about once in 50 simulated days ([R10](REVIEW.md#r10-rare-qa-failures)), so the demo has a manual trigger.
- **Homogenizer pressure loss.** At low pressure the fat globules are not broken small enough. In a pack stored for weeks they rise into a cream layer, which only the sensory check at the end of incubation finds, days after the fault.
- **Demand spike or late trucks.** Extra trucks draw stock down faster than the plant releases it and queue at the docks; late ones bunch up and back the dock up. Either way the stock and the order fill rate show it, not the production line.

## Phase 7: the cleaning programmes

The full CIP and the intermediate clean (AIC) as programmes of steps, for the stretch item "animated CIP cleaning" ([roadmap](09-development-roadmap.md); [D16](DECISIONS.md#d16-phase-7-cleaning-programmes)). The CIP follows the Dairy Processing Handbook's programme for circuits with heated surfaces, UHT plants among them ([Cleaning of dairy equipment](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment)): "Rinsing with warm water for about 10 minutes. Circulation of an alkaline detergent solution (0.5 – 2%) for about 30 minutes at 75 °C. Rinsing out alkaline detergent with warm water for about five minutes. Circulation of acid solution (0.5 – 1.5%) for about 20 minutes at 70 °C. Post-rinsing with cold water. Gradual cooling with cold water for about eight minutes." The handbook's UHT chapter gives the AIC's 30 min, "without losing aseptic conditions" ([Long-life dairy products](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-dairy-products)), but not its steps. The modes keep their times (H36: 113 min out after a divert), so every earlier row still holds. `tests/sim/cleaning.test.ts` runs these rows.

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H111 | The programmes | `plant.json` cleaning.cipSteps and aicSteps | CIP: pre-rinse, warm water, 10 min at 45 °C; lye (NaOH), 30 min at 75 °C; rinse, warm water, 5 min at 45 °C; acid (HNO3), 20 min at 70 °C; post-rinse, cold water, 7 min at 20 °C; gradual cooling, cold water, 8 min at 20 °C: 10 + 30 + 5 + 20 + 7 + 8 = 80 min, the CIP's time (cipS). AIC: water displaces the product, 5 min; lye, 20 min; rinse, 5 min: 30 min (aicS), all three at the UHT set point | exact | Handbook; D16 |
| H112 | The CIP after the temperature drop | H104's run | The CIP starts 2.84 + 180 = 182.84 s after the trigger, so its steps start at 182.84 s plus 0, 10, 40, 45, 65 and 72 min: 182.84, 782.84, 2,582.84, 2,882.84, 4,082.84 and 4,502.84 s, and it ends at 4,982.84 s, when sterilizing starts (H104 unchanged). The holding-tube outlet reads each step's temperature: 45, 75, 45, 70, 20, 20 °C. The preheater follows with its 30 s lag, still about 45 °C as the acid starts | Steps ±1 s (seen at ×10); temperatures exact; preheater ±0.5 °C | H104; D16 |
| H113 | The first AIC | The shipped config, no scenario | After 10 h of production (cleaning.aicEveryProductionS), at 16:00 on day 8 (36,000 s): water at 36,000 s, lye at 36,300 s, water at 37,500 s, back in production at 37,800 s. The outlet stays at the set point, 140 °C ± 0.3 °C, so the plant stays sterile | ±1 s; ±0.3 °C | R2; D16 |
| H114 | The circulation | cleaning.circulateLph | 24,000 L/h = 6.67 L/s; in a 65 mm bore (π × 0.0325² = 3.32 × 10⁻³ m²) that is 2.01 m/s, inside the handbook's 1.5–3.0 m/s for CIP | ±0.01 m/s | Handbook; D16 |

## Phase 8: the steam and energy model

The boiler house's steam and gas and the homogenizer's electricity, for the stretch item "a steam and energy model" ([roadmap](09-development-roadmap.md); [D17](DECISIONS.md#d17-phase-8-steam-and-energy)). The boiler numbers are the US Department of Energy's ([Steam Tip Sheet #15](https://www1.eere.energy.gov/manufacturing/tech_assistance/pdfs/steam15_benchmark.pdf)): Table 1 gives the heat to raise a pound of saturated steam, "the difference between the enthalpies of saturated steam and feedwater", and Table 2 a natural-gas boiler's combustion efficiency. The benchmark is the EU's best available techniques for dairies ([Decision (EU) 2019/2031](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019D2031), BAT 21, Table 8): 0.1–0.6 MWh per tonne of raw materials for market milk, a yearly average of the heat and electricity used. The steam-table values are from [Engineering ToolBox](https://www.engineeringtoolbox.com/saturated-steam-properties-d_457.html). Nothing here changes a litre, a temperature or a time, so every earlier row still holds. `tests/sim/energy.test.ts` runs these rows.

| # | What | How | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H115 | The boiler | `plant.json` energy.boilerHeatKjPerKg and boilerEfficiencyFrac | Raising 1 kg of saturated steam at 150 psig (11.4 bar absolute, 186 °C) from 200 °F (93 °C) feedwater takes 1,028 Btu/lb × 2.326 = 2,391.13 kJ/kg; at 85.7% the boiler burns 2,391.13 ÷ 0.857 = 2,790.11 kJ of gas for it, 0.775 kWh a kilogram. The same steam (h_g 2,780.8 kJ/kg) condensing into the milk and leaving it as water at 140 °C (h_f 589.1 kJ/kg) gives up 2,191.6 kJ/kg, the model's 2,200 kJ/kg (uht.steamLatentKjPerKg) within 0.4% | ±0.01 kJ/kg | DOE; steam tables; D17 |
| H116 | Production | The defaults: 16,000 L/h at 140 °C | The milk reaches the injector at the homogenizer outlet, 81.75 °C (H7): 16,000 × 3.9 × (140 − 81.75) ÷ 2,200 = 1,652.18 kg/h of steam, the water stage 5 removes; gas 1,652.18 ÷ 3,600 × 2,790.11 = 1,280.49 kW; electricity, the homogenizer's 124.66 kW (102.22 kW hydraulic at 230 bar ÷ 0.82). Regeneration gives the milk 1,317.33 kW (4 → 80 °C) and the steam 1,009.67 kW (81.75 → 140 °C): 56.6% of its heating. Per tonne of raw milk (16,222.22 L/h, H3): (1,280.49 + 124.66) ÷ 16.222 = 86.62 kWh/t. At 50% flow every rate halves; the regeneration and the energy per tonne stay | ±0.01 kg/h, kW and kWh/t; ±0.1 % | H3, H7, H8; D17 |
| H117 | Cleaning and re-sterilizing | An AIC, a full CIP and the re-sterilizing after it | The circulation, 24,000 L/h (cleaning.circulateLph), reaches the injector at the deaerator outlet, the preheater's temperature less 4 °C, as the homogenizer stands. AIC at the set point: 24,000 × 3.9 × (140 − 76) ÷ 2,200 = 2,722.91 kg/h (2,110.34 kW of gas), 1,361.45 kg in its 30 min. Re-sterilizing at 125 °C, once the preheater is back at 80 °C: 2,084.73 kg/h (1,615.73 kW). A CIP step, once the preheater has the step's temperature: 24,000 × 3.9 × 4 ÷ 2,200 = 170.18 kg/h (131.90 kW), the deaerator's 4 °C. Where the temperature rises by ΔT, the preheater's 30 s lag leaves the steam a gap of ΔT e^(−t/30 s) to make up, 0.3545 kg a kelvin; where it falls by ΔT, the steam stops until the preheater is within 4 °C, 4 × 30 × (1 + ln(ΔT ÷ 4)) K·s less | ±0.01 kg/h and kW | D16; D17 |
| H118 | The cost of a divert | H104's run, display noise off | No milk is made for 113 min, but the steam runs on. The divert's 180 s from 2.84 s heat the milk toward the falling outlet, 135.5 + 4.5 e^(−t/15) °C: 76.67 kg. The CIP runs 80 min at 4 K, rises 30 K (lye) and 25 K (acid), and falls 35 K (into the pre-rinse), 30 K (rinse) and 50 K (post-rinse): 19,684.8 K·s × 0.011818 kg/(K·s) = 232.64 kg. Re-sterilizing, 49 K for 30 min and a rise of 60 K: 90,000 K·s, 1,063.64 kg. In all 1,372.94 kg of steam and 1,064.07 kWh of gas, against 3,111.61 kg in 113 min of production | ±0.5 kg; ±0.5 kWh | H104, H112; D17 |
| H119 | A day at the defaults | H83–H87's run: 24 h at ×1,000 from day 1, 06:00 | The 361,142.86 L through the UHT plant (H95) take 0.10326 kg of steam a litre, 37,292.10 kg, and the two AICs 2,722.91 kg: 40,015.01 kg of steam, 31,012.91 kWh of gas. The homogenizer: 361,142.86 L ÷ 3,600 × 23 kW per L/s ÷ 0.82 = 2,813.78 kWh. Per tonne of the 366,158.73 L of raw milk drawn: 92.38 kWh/t, below BAT's 100–600 kWh/t for market milk, which counts a whole dairy (cooling, every tank's CIP, compressed air, packaging, buildings) where the model counts the UHT plant's steam and its homogenizer | ±0.1 % | H95; BAT; D17 |

## Checks against the plan and the review

Every value in the review's [Checked and correct](REVIEW.md#checked-and-correct) list reproduces. The R4, R6 and R10 values agree up to rounding: B\* 2.37 (review: 2.4), F0 10.35 min (10.3), limit 136.06 °C (136.1), F0 5.81 min (5.8), margin 1.28 °C (1.3), and a blocked batch every 52 days (about 50). Five points needed a decision or a note:

1. **Fault temperature (H24, H25).** The preview's 137.6 °C gives B\* 1.40 when the plant runs at 50% and the hold is 8 s, so the temperature-drop scenario would not divert. [D2](DECISIONS.md#d2-missing-defaults) sets 135.5 °C.
2. **F0 under noise (H22, H23).** With ±0.3 °C of noise the displayed F0 falls below the 5 min target whenever the reading is under 139.85 °C. Status colours should follow B\*, not F0 ([D4](DECISIONS.md#d4-divert-rule-and-display-noise)).
3. **Pallets per batch (H28).** "About 60 pallets" is 59.5 pallet-loads at full rate and about 57.8 after mean downtime. The last pallet of each batch is part-full ([D1](DECISIONS.md#d1-batch-size)), so the model counts 60 pallets at full rate and about 58.3 after mean downtime: at most 360 pallets a day, not 357 (H38).
4. **Homogenizer pressures (H7).** 81.75 °C reads 200 bar and 30 bar as two drops in series (230 bar in total). If 200 bar were the total, the outlet would be 81.0 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).
5. **Flash vessel.** Removing exactly the water the steam added returns the milk to its temperature before the injector, 81.75 °C, while the chart shows 80 °C. That is within "about 80 °C" in the sources, so the chart keeps 80 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).

---

← [Decisions](DECISIONS.md) · [Index](README.md) →
