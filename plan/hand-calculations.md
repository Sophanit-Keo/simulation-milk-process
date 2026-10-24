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
| H52 | Long-run OEE | 0.97166 × 0.9375 × 1 | 0.91093 (91.1%) | ±0.00001 | Same |

## Clock

H53–H55 are tested in phase 1 ([D8](DECISIONS.md#d8-clock)): H53 through the shift grid (`quality.firstShiftStartS`, which stays at 06:00 if [D11](DECISIONS.md#d11-opening-state) moves the clock's start), H54 with the config and H55 with `clock.ts`. H56 is tested with `clock.ts` at ×10,000 and 60 fps. H57 explains the 10 s step and has no test of its own; phase 3's step-size test covers the tank.

| # | What | Formula with inputs | Expected | Tolerance | Source |
|---|---|---|---|---|---|
| H53 | Start time and first shift | 6 h × 3,600 | 21,600 s (day 1, 06:00): `clock.startTimeS` and `quality.firstShiftStartS` | exact | [D8](DECISIONS.md#d8-clock); [D1](DECISIONS.md#d1-batch-size) |
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

- **Config.** Take `copyConfig()` from `tests/helpers/plantConfig.ts`, change only the keys the row names, then call `createSim(config)`. The seed stays 81006. *Noise off* means `uht.displayNoiseC` = 0: the holding-tube reading is then the set point, so F0, B\* and the divert limit can be checked to their H-row tolerance. With the default ±0.3 °C, check the noise band instead (H21, H22).
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

## Checks against the plan and the review

Every value in the review's [Checked and correct](REVIEW.md#checked-and-correct) list reproduces. The R4, R6 and R10 values agree up to rounding: B\* 2.37 (review: 2.4), F0 10.35 min (10.3), limit 136.06 °C (136.1), F0 5.81 min (5.8), margin 1.28 °C (1.3), and a blocked batch every 52 days (about 50). Five points needed a decision or a note:

1. **Fault temperature (H24, H25).** The preview's 137.6 °C gives B\* 1.40 when the plant runs at 50% and the hold is 8 s, so the temperature-drop scenario would not divert. [D2](DECISIONS.md#d2-missing-defaults) sets 135.5 °C.
2. **F0 under noise (H22, H23).** With ±0.3 °C of noise the displayed F0 falls below the 5 min target whenever the reading is under 139.85 °C. Status colours should follow B\*, not F0 ([D4](DECISIONS.md#d4-divert-rule-and-display-noise)).
3. **Pallets per batch (H28).** "About 60 pallets" is 59.5 pallet-loads at full rate and about 57.8 after mean downtime. The last pallet of each batch is part-full ([D1](DECISIONS.md#d1-batch-size)), so the model counts 60 pallets at full rate and about 58.3 after mean downtime: at most 360 pallets a day, not 357 (H38).
4. **Homogenizer pressures (H7).** 81.75 °C reads 200 bar and 30 bar as two drops in series (230 bar in total). If 200 bar were the total, the outlet would be 81.0 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).
5. **Flash vessel.** Removing exactly the water the steam added returns the milk to its temperature before the injector, 81.75 °C, while the chart shows 80 °C. That is within "about 80 °C" in the sources, so the chart keeps 80 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).

---

← [Decisions](DECISIONS.md) · [Index](README.md) →
