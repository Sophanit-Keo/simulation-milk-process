[Agent plan](README.md) · Phase 5 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 5 · Detail & scenarios (weeks 10–11)

Swap the four hero models in for their grey boxes, make all six fault scenarios play out with visible consequences, and add the guided tour.

- **Entry:** G2 signed, contracts v3 frozen, the cut list recorded.
- **Exit:** the week-11 deliverable: hero models, six fault scenarios, guided tour.
- **Critical path:** `assets` (hero models) and `sim` (scenarios), in parallel. `process` writes each scenario's expected outcome first, and the other lanes build to it.

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `process` | Write a script for each of the six [fault scenarios](../06-simulation-model.md#fault-scenarios): trigger, expected state changes and KPIs with timings, what the viewer should see, and two lines on why. Finish the tour captions and review the "About this model" panel on screen. | Scenario scripts, final captions |
| `sim` | `scenarios.ts`, with all six scenarios behind `triggerScenario` and a reset: **UHT temperature drop** to `uht.faultTempC` (135.5 °C, [D2](../DECISIONS.md#d2-missing-defaults)), which diverts at a 4 s and at an 8 s hold ([H24](../hand-calculations.md#formulas)): a 3-minute divert, then flush, clean and re-sterilize while the fillers drain the tank. **Filler breakdown,** random and manual. **Sterile-air filter failure:** a deviation, tank contents put on hold, and a higher incubation failure chance ([R10](../REVIEW.md#r10-rare-qa-failures)). **Failed incubation:** manual, or from that higher chance. **Homogenizer pressure loss:** creaming risk rises, and the sensory check fails days later. **Demand spike or late truck:** stock runs down, or the dock backs up. Every scenario writes log entries saying what happened and why. Additive contract fields only. | Six scenarios |
| `assets` | Finish the separator, homogenizer, filler and palletizer. Bake ambient occlusion, compress the GLBs, stay within the polygon and texture budget, and record licences. Keep the node names from the specs. Hand modelling the developer does in Blender goes through the same export checks. | Final hero GLBs |
| `scene` | Load the hero GLBs into the existing equipment classes and animate their named nodes. Add the fault visuals: lamps, steam and vapour, a gauge needle dropping, red pallet lamps, trucks queuing. Guided-tour camera path: the 10 phase-2 camera stops, about 3 minutes in total. | Hero scene, tour camera |
| `ui` | Scenario menu with trigger and reset. A scenario log view ("what happened and why"). Guided-tour mode showing each stage's two-line caption. The "About this model" panel, and a legend for the pipe colours. | Scenario and tour screens |
| `qa` | A test per scenario from `process`'s script: trigger it, then check the state changes and KPIs within the scripted sim time. The same seed must give the same scenario log. A perf check with the hero models loaded (60 fps). A browser test that starts and stops the tour. | Scenario tests, perf report |
| `lead` | Integrate, reject any contract change that isn't additive, and tick the week-11 deliverable. | Week-11 build |

## How they work together

- **Week 10.** On Monday `process` delivers the six scenario scripts. `qa` turns them into failing tests by Tuesday, and `sim` implements scenarios until the tests pass. `scene` and `ui` add each scenario's visuals as soon as its log entries and state fields land. `assets` delivers the separator and homogenizer, and `scene` swaps them in.
- **Week 11.** `assets` delivers the filler and palletizer. `scene` builds the tour camera, and `ui` the tour captions and About panel. `qa` reruns the perf check with all four hero models. The second half of the week is for fixes.

## Hand-offs

- `process` → `qa`, `sim`: scenario scripts, the spec for both tests and code.
- `qa` → `sim`: failing scenario tests.
- `assets` → `scene`: final hero GLBs.
- `process` → `ui`: final captions.

## Exit checklist

- [ ] All four hero models are in place, and 60 fps holds. *(In place; 60 fps needs a real GPU.)*
- [x] All six scenarios start from the menu, show their visual reaction, and log what happened.
- [x] The guided tour runs about 3 minutes, with captions.
- [x] Scenario tests pass, and the same seed gives the same log.

**Status (2026-10-27, all lanes):**

- **`process`.** A script for each scenario, [H104–H110](../hand-calculations.md#phase-5-scenario-scripts): trigger, state changes and KPIs with their sim times, what the viewer sees, and why. The ten scenario keys and the rules without a key are [D15](../DECISIONS.md#d15-phase-5-fault-scenario-defaults); the [default settings](../06-simulation-model.md#default-settings) and the fault table follow. The tour captions (two lines a stage, `src/data/stages.json`) are final, and the About text gained the fault scenarios, the tour and two simplifications.
- **`lead`.** Contracts v4, additive only: `triggerScenario` with a variant and `resetScenarios`, the snapshot's `scenarios` (runs and why a scenario cannot start), log entries' `scenario` and `why`, batches' `flags` and `creamingRiskPct`. `plant.json` schema 6 with the `scenarios` section. New pinned dev dependencies for the hero compression: `@gltf-transform/core`, `@gltf-transform/extensions` 4.5.1 and `meshoptimizer` 1.3.0 (D15).
- **`sim`.** `src/sim/scenarios.ts`: all six behind `triggerScenario`, each run claiming the log entries it causes and saying why, followed until its consequences are over; Reset puts every running fault right. The steam dip lags the outlet toward 135.5 °C and cuts the step at the divert-limit crossing.
- **`qa`.** `tests/sim/scenarios.test.ts` runs every script (H104–H110, the 8 s hold too), the resets, the reasons a scenario cannot start and the same seed giving the same log. In the browser, `e2e/scenarios.spec.ts` starts a filler breakdown from the menu and follows it through the banner, the event log, the scenario log and Reset, checks the mock's menu, and starts and stops the tour three ways; the smoke test loads the heroes by default and none with `?greybox`. The whole suite passes but for `shell.spec.ts`'s pixel-ratio test, which fails the same way since the phase 3 merge on this machine's Chromium 153. Perf with the heroes: 207 draw calls and 232,346 triangles at the overview ([perf baseline](../../tests/perf/baseline.md#phase-5-hero-models)).
- **`assets`.** The four heroes finished in `assets/scripts/make-heroes.mjs`: faces cut into 0.2 m cells, AO baked into the vertex colours, geometry meshopt-compressed losslessly. 2,048 to 6,252 triangles and 43 to 97 KB each, node names and rest transforms unchanged ([hero-specs.md](../../assets/hero-specs.md#phase-5-final-models), licences in [LICENSES.md](../../assets/LICENSES.md)).
- **`scene`.** The heroes load by default with three's meshopt decoder (`?greybox` keeps the grey boxes). Fault visuals: the divert valve's lamp and the reject tank as before, the steam injector sputters while the steam dips, the homogenizer's needle drops to 50 bar, the batches under investigation blink in quarantine and the blocked ones turn red, trucks queue in the yard beside the docks. The tour flies to each stage and orbits slowly while its caption shows (not with reduced motion).
- **`ui`.** The Scenarios menu in the top bar (each fault, or why it cannot start now; Reset; the scenario log), the banner over the 3D view, the scenario log dialog with every step and its why, the tour's caption with its progress and Stop, the stage 6 sterile-air row and the batch list's investigation fact. The pipe-colour legend sits over the 3D view.
- **Open.** 60 fps needs a real GPU ([To do on a real GPU](../../tests/perf/baseline.md#to-do-on-a-real-gpu)); the developer reviews D15 and its deviations (per-vertex AO, no KTX2).

## Watch for

- **Hero models eating the schedule.** If a hero model isn't ready by Wednesday of week 11, ship its grey box. The equipment class works with either.
- **Waiting for random failures.** At 0.02% per pack a failed incubation shows up only about once every 50 simulated days ([R10](../REVIEW.md#r10-rare-qa-failures)). Demos use the manual trigger.

---

← [Phase 4. Packs to trucks](phase-4-packs-to-trucks.md) · [Phase 6. Polish & present](phase-6-polish-and-present.md) →
