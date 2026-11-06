[Agent plan](README.md) · Phase 20 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 20 · Hero models, yogurt faults & tour

Bring the wing up to the milk line's level of finish:
- hero models for the P8 filler and the fermentation tanks, and the cup, tray and reefer meshes;
- five yogurt fault scenarios;
- a guided tour of stages 11–16;
- the yogurt part of "About this model".

- **Entry:** gate Y2 is signed.
- **Exit:** the checklist below.
- **Weeks:** 10–11. **Critical path:** `assets`, `sim`, `ui`.

## Hero models (`assets`)

| Model | Made by | Named nodes | Budget |
|---|---|---|---|
| P8 cup filler | Script, as the forklift and the other heroes are | `carrier`, `pistons`, `seal_heads`, `foil_pick`, `uv_tunnel`, `hood`, `reject_flap` | Within the filler hero's budget |
| Fermentation tank (× 3, instanced) | Script | `agitator`, `ph_probe` | Small; shared geometry |
| 125 g cup with foil lid, 24-cup tray | Script | — | Token-sized; instanced |
| Reefer unit on the articulated truck | Script, added to `make-vehicles.mjs` | `reefer` | Small |

Each model gets a spec, a licence entry (own work) and asset tests, as in phases 5, 12 and 14.

## Fault scenarios (`process`, `sim`)

| Scenario | What happens | What the plant does |
|---|---|---|
| Slow fermentation (bacteriophage) | A tank's pH stalls at about 5.2 | The tank is flagged after its expected time plus 2 h; it is held and discarded after 8 h, and the next tank is brought forward |
| Heat treatment under temperature | The holding-cell outlet falls below 85 °C | Divert to reprocess; CIP; restart, as the UHT divert does |
| Seal temperature drift | The seal heads drift below 180 °C | Leaks rise; the next seal test fails; the cups since the last pass are held, and the batch goes to QA |
| HEPA overpressure loss | The cabin falls below +15 Pa | P8 stops; it needs a new SIP and ATP swab before it restarts |
| Cold-room excursion | The cold room warms past 6 °C for 2 h | The pallets inside are put on hold, and QA decides release or destroy |

Each scenario gets a script and expected values (H134–H138), an entry in `scenarios.json`, its Let Report mapping (as D18), and a log entry explaining why.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `assets` | The models above, with their specs, licences and tests | `assets/`, `public/models/` |
| 1 | `process` | The five scenario scripts and H134–H138; the tour captions for 11–16; the "About this model" text on yogurt | `src/data/`, `plan/` |
| 2 | `sim` | The five scenarios in `src/sim/scenarios.ts` and the yogurt modules; the reset | `src/sim/` |
| 2 | `scene` | Swapping in the heroes (keeping `?greybox`); the scenario visuals (red lamps, the held tank, the stopped hood); the yogurt tour's camera path | `src/scene/` |
| 2 | `ui` | Yogurt scenarios in the menu and the scenario log; "Yogurt tour" beside the existing tour; the yogurt section of About | `src/ui/`, `src/data/about.md` |
| 3 | `qa` | `tests/sim/yogurt/scenarios.test.ts` against H134–H138; asset tests; `e2e/yogurtScenarios.spec.ts` and `e2e/yogurtTour.spec.ts` | `tests/`, `e2e/` |

## Exit checklist

- [x] The hero models pass their asset tests and budgets; `?greybox` still shows the boxes. *Line P8 and the fermentation tank; the cup, the tray and the reefer unit are left for phase 21 (below).*
- [x] Each of the five scenarios starts, shows its consequence, logs why, and resets; tests against H134–H138 pass.
- [x] The yogurt tour runs stages 11–16 in about 2 minutes; the milk tour is unchanged.
- [ ] The developer watches each scenario and the yogurt tour.

## Status

Built on 6 November 2026 in one session, on phase 19 as merged (PR #24). Y1 and Y2 are not yet signed, and D25–D29 are still Proposed; the phase adds **D30** (the yogurt line's faults), also **Proposed**. The developer asked to go on. Lane by lane:

- **`process`:**
  - `plant.json` schema 14 adds `yogurt.faults`: the phage's stall at pH 5.2, its flag 2 h past due and discard 8 h after the start; the heat dip to 82 °C for 10 min; the seal heads' drift to 160 °C over 15 min; the HEPA cabin at +5 Pa for a 30 min repair; the cold room's cooling down for 3 h, its air toward 10 °C (τ 30 min), the hold after 2 h over 6 °C, QA's verdict 2 h after the air is back, by an 8 °C core. `checkPlantConfig` checks each does what its scenario says.
  - [D30](../DECISIONS.md#d30-the-yogurt-lines-fault-scenarios) sets the rules, the lamps and the Let Report mapping; [H134–H138](../hand-calculations.md#phase-20-the-yogurt-lines-fault-scenarios) work each script by hand, the cold room's air and cores in closed form.
  - `src/data/scenarios.json` names the five; "About this model" gains the yogurt line and its faults. The tour captions for 11–16 were written in phase 16.
- **`lead`:** contracts v12 adds the five scenario ids (`YOGURT_SCENARIO_IDS`, `UHT_SCENARIO_IDS`), `FermentTank.held`, `YogurtPallet.qaHold` and `coldRoom.excursion`. The fixtures were re-recorded; their UHT part's fingerprint is unchanged once the yogurt scenarios' entries are left out of it, as the yogurt stages are.
- **`sim`:**
  - The faults live in the yogurt line's step (`yogurtLine.ts`, `ferment.ts`, `p8.ts`, `coldChain.ts`): none queues an event or draws at random, so the UHT line's numbers stay as they were with all five running (a test checks the fingerprint).
  - `scenarios.ts` keeps their runs as it keeps the UHT faults': each claims the line's reactions by what the entry reports (`LogTag.event`), says why, and follows them to the end.
  - **The phage** stalls the filling tank, or the youngest fermenting one, on its curve; P8 never draws a held tank, and the next tank feeds it. **The heat dip** takes the outlet toward 82 °C: the CCP diverts, the wing cleans, and it runs again. **The seal drift** overrides P8's seal reading until a test fails; the failed test holds the cups and the cold chain pulls them. **The HEPA loss** overrides the cabin's reading; after the repair P8 is not cleared until a new SIP and swab pass. **The cold room** works its air and cores in closed form for each stretch, holds the room's pallets, and gives QA's verdict.
  - The lamps: a held tank turns stage 13 red, the seal heads out of their window stage 15 amber, pallets on QA hold stage 16 red.
- **`ui`:** the Scenarios menu lists the UHT line's faults and the yogurt line's five under their own headings; the scenario log marks the yogurt runs; the Let Report links carry them as yogurt reports (D30). "Yogurt tour" beside the tour walks stages 11–16, 20 s each; starting one tour stops the other, and the milk tour is unchanged. The stage 16 panel's cold room says how an excursion stands.
- **`assets`:** `make-heroes.mjs` builds `p8-filler.glb` (15,288 triangles, 8 meshes, the hood its one glass) and `ferment-tank.glb` (5,216 triangles), round the grey boxes of phase 18 as they stand, where those differ from the phase-16 specs ([hero-specs.md](../../assets/hero-specs.md#phase-20-the-yogurt-wings-models-as-built)). Their tests: size, nodes, budget, the cups' band over the carrier left clear at every stroke, the stations seen from the stage-15 camera, the tank's agitator on its axis and its pipes met.
- **`scene`:** both swap in (`?greybox` keeps the boxes); the hero's hood glows red while the cabin is under +15 Pa, a held tank lights a red lamp over its pH probe, and the cold room's alarm strip lights amber over 6 °C and red with pallets on hold, which show red. The yogurt tour's camera is the stage fly-to of phase 16.
- **`qa`:** `tests/sim/yogurt/scenarios.test.ts` (H134–H138, the releases and resets, the UHT fingerprint), the asset and scene tests above, `e2e/yogurtScenarios.spec.ts` and `e2e/yogurtTour.spec.ts`.

**Not built, for phase 21 to build or cut:**
- **The 125 g cup and the 24-cup tray models.** The scene draws P8's 1,400-odd cups as instances of 16 triangles; the spec's 80 would add some 90,000 triangles to the overview, which already reads 349 draw calls and 324,210 triangles.
- **The reefer unit.** The wing's reefers are boxes in one instanced mesh (phase 19); the unit needs the truck model at the wing's dock first, which phase 19 left for the scope freeze.
- **The `reject_flap` node** of this card: the flap stands at the check gates, 3 m past P8, and the cups' tokens draw and drive it.

