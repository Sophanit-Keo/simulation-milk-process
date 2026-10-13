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

Pure functions, tested from phase 1 ([D10](DECISIONS.md#d10-formula-tests-in-phase-1)), except the rows marked *phase 3*. H2–H5 (the stage 1 mass balance) and H8 (homogenizer power) have no pure function yet, so phase 3 tests them against the stage 1 and stage 3 models. H20 and H23 are tested through `divertLimitC` and `f0Min`.

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
| H59 | Share of production time throttled | Throttled time ÷ production time | About 9% (one-year run: 8.8%) | ±3 points | [D2](DECISIONS.md#d2-missing-defaults) |
| H60 | Tank balance | Level change = litres in − litres out, every step | Exact to rounding | ±0.001 L | Plan 06, tank level formula |
| H61 | Pack balance | Packs made = packs on closed pallets (1,008 each, fewer on the last of a batch) + packs on open pallets + samples taken | Exact | exact | Plan 06, discrete model |
| H62 | Temperature drop at full flow and at 50% | Trigger `uhtTempDrop` in each state | Divert both times; reject tank +800 L or +400 L; back in production after 113 min | exact | H24, H35, H36 |
| H63 | Noise never diverts | 7 days at 140 °C, no faults | 0 diverts | exact | H21 |

## Line points

The temperature and flow at each measuring point of the liquid line (`Snapshot.line`, contracts v1), in flow order, for the static plant of phase 2: every stage at its `plant.json` set point, the UHT plant at full flow, both fillers running and no divert. The 3D view colours each pipe from these temperatures, blue at 4 °C through yellow to red at 140 °C ([plan 08](08-user-interface.md#colour-rules)). The static-plant test can check every row now; phase 3 checks them again against the stage 1–6 models at steady state. A point's flow is the milk leaving it, so the `separator` row is the standardized milk after the cream is remixed.

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

## Checks against the plan and the review

Every value in the review's [Checked and correct](REVIEW.md#checked-and-correct) list reproduces. The R4, R6 and R10 values agree up to rounding: B\* 2.37 (review: 2.4), F0 10.35 min (10.3), limit 136.06 °C (136.1), F0 5.81 min (5.8), margin 1.28 °C (1.3), and a blocked batch every 52 days (about 50). Five points needed a decision or a note:

1. **Fault temperature (H24, H25).** The preview's 137.6 °C gives B\* 1.40 when the plant runs at 50% and the hold is 8 s, so the temperature-drop scenario would not divert. [D2](DECISIONS.md#d2-missing-defaults) sets 135.5 °C.
2. **F0 under noise (H22, H23).** With ±0.3 °C of noise the displayed F0 falls below the 5 min target whenever the reading is under 139.85 °C. Status colours should follow B\*, not F0 ([D4](DECISIONS.md#d4-divert-rule-and-display-noise)).
3. **Pallets per batch (H28).** "About 60 pallets" is 59.5 pallet-loads at full rate and about 57.8 after mean downtime. The last pallet of each batch is part-full ([D1](DECISIONS.md#d1-batch-size)), so the model counts 60 pallets at full rate and about 58.3 after mean downtime: at most 360 pallets a day, not 357 (H38).
4. **Homogenizer pressures (H7).** 81.75 °C reads 200 bar and 30 bar as two drops in series (230 bar in total). If 200 bar were the total, the outlet would be 81.0 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).
5. **Flash vessel.** Removing exactly the water the steam added returns the milk to its temperature before the injector, 81.75 °C, while the chart shows 80 °C. That is within "about 80 °C" in the sources, so the chart keeps 80 °C ([D5](DECISIONS.md#d5-homogenizer-outlet)).

---

← [Decisions](DECISIONS.md) · [Index](README.md) →
