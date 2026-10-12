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
| `sim` | `scenarios.ts`, with all six scenarios behind `triggerScenario` and a reset: **UHT temperature drop** to 137.6 °C, a 3-minute divert, then flush, clean and re-sterilize while the fillers drain the tank. **Filler breakdown,** random and manual. **Sterile-air filter failure:** a deviation, tank contents put on hold, and a higher incubation failure chance ([R10](../REVIEW.md#r10-rare-qa-failures)). **Failed incubation:** manual, or from that higher chance. **Homogenizer pressure loss:** creaming risk rises, and the sensory check fails days later. **Demand spike or late truck:** stock runs down, or the dock backs up. Every scenario writes log entries saying what happened and why. Additive contract fields only. | Six scenarios |
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

- [ ] All four hero models are in place, and 60 fps holds.
- [ ] All six scenarios start from the menu, show their visual reaction, and log what happened.
- [ ] The guided tour runs about 3 minutes, with captions.
- [ ] Scenario tests pass, and the same seed gives the same log.

## Watch for

- **Hero models eating the schedule.** If a hero model isn't ready by Wednesday of week 11, ship its grey box. The equipment class works with either.
- **Waiting for random failures.** At 0.02% per pack a failed incubation shows up only about once every 50 simulated days ([R10](../REVIEW.md#r10-rare-qa-failures)). Demos use the manual trigger.

---

← [Phase 4. Packs to trucks](phase-4-packs-to-trucks.md) · [Phase 6. Polish & present](phase-6-polish-and-present.md) →
