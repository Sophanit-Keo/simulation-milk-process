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

- [ ] The hero models pass their asset tests and budgets; `?greybox` still shows the boxes.
- [ ] Each of the five scenarios starts, shows its consequence, logs why, and resets; tests against H134–H138 pass.
- [ ] The yogurt tour runs stages 11–16 in about 2 minutes; the milk tour is unchanged.
- [ ] The developer watches each scenario and the yogurt tour.

## Status

Not started.
