[Agent plan](README.md) · Phase 26 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 26 · Every machine of the yogurt process hall in more detail

The developer's request after phase 25: "make more details on each machine on yogurt hall 12–14". Phase 25 gave the hall's machines their main missing parts and moving gauges and valves. This phase adds the fittings a visitor would see on each one: manways, vents and spray lines, flanges, probes, nameplates, a control cabinet, the tanks' jackets and CIP header, and a few lamps and displays that follow the sim.

- **Entry:** phase 25 is merged (PR #29).
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## What it adds

| Stage | Machine | New fittings | Following the sim |
|---|---|---|---|
| 12 | Deaerator | A manway with its handle, a sight glass, the CIP spray line and vacuum relief valve on the dome, the pump's base frame | The sight glass shows the mix while it flows |
| 12 | Homogenizer | A control cabinet with its screen, lamps and emergency stop; louvres on its east end; the lube-oil unit with its cooler and oil sight glass; the motor's fins and terminal box | The screen lights blue while it runs and amber in the clean; a green lamp for the one, an amber lamp for the other |
| 12 | Plate heat exchanger | The tie bolts' nuts, thermometers on the fixed head, a nameplate; on the hot-water set, the expansion vessel, the safety valve and the controller | The controller's display shows the heating's temperature, in the pipes' colours |
| 12 | Holding cell | Two beams under the serpentine on their posts, a clamp over each pass, a brace on each long side, temperature probes at the inlet and the outlet | — |
| 12 | Divert valve | The flanges of its three ports, the actuator's solenoid valve and its air line | — |
| 12 | Reprocess tank | Its outlet valve, a manway, the vent's gooseneck, the CIP inlet, a high-level switch | — |
| 13 | Culture dosing | The vessel's lid and stirrer motor, the scale under it, a controller on a post, the freezer's grille and display | The controller's display is lit while it doses |
| 13 | Fermentation tanks | Each tank's jacket risers into the shell with their valve, a sampling valve with its red handle, a drop from the CIP header over the tanks | The jacket valve opens to warm water while the tank ferments and to chilled water once it is ready, until it is empty |
| 14 | Smoothing valve | The actuator's positioner, a pressure gauge on the line after it | — |
| 14 | Plate cooler | Temperature transmitters on the product line in and out, the ice-water lines down from its back ports, a nameplate | The ice-water control valve opens while it cools |
| 14 | Fruit tank | The transfer pump from the IBC and its line over the dome, a manway, a level probe | — |
| 14 | P8 buffer | A manway, the CIP line, a temperature transmitter, a sampling valve with its red handle | — |
| 11–14 | Every vessel of the wing | A pad under each leg (stage 11's mix tank too, as it shares the vessel builder) | — |

The grey parts join meshes their machines already have, and the coloured fittings are instances in the shared box mesh, so the overview keeps its 350 draw calls.

## Exit checklist

- [x] Each machine of stages 12–14 shows its new fittings, clear of the pipes and of the other machines.
- [x] Each machine is drawn in as many meshes as before.
- [x] The fittings that follow the sim do, and stand as they are while it is paused.
- [x] `npm run check`, the browser tests and the draw-call budget pass.
- [ ] The developer looks over the hall at ×1, zoomed in.

## Status

Built on 7 November 2026, on phase 25 as merged (PR #29). Lane by lane:

- **`scene`, the grey parts:** `src/scene/equipment/yogurtLine.ts` adds them in each machine's own materials.
  - The tanks take theirs through the vessel builder's `detail` hook (phase 25). Every vessel's legs now stand on pads, the mix tank's of stage 11 too.
  - `yogurt/layout.ts` places what the grey parts and the coloured ones share: the homogenizer's cabinet and lube unit, the culture controller and freezer, the ice-water valve, the smoothing valve's gauge, the tanks' jackets and CIP header.
  - **Moved:** the homogenizer's control box, a thin box on its east end since phase 25, is now a cabinet standing east of it, its face to the aisle.
- **`scene`, the coloured fittings:** `yogurt/hallDetail.ts` lists them, 50 instances. `yogurt/wingMotion.ts` draws them after its own parts, so those keep their instances.
  - **Split out:** the parts' shape, colours and helpers moved from `wingMotion.ts` to `yogurt/motionParts.ts`, which both files use.
  - **The valve stem** now shows what flows: product green, a clean amber, a jacket's warm water orange, chilled water blue.
  - **The fermentation tanks:** their model replaces their grey boxes, so their jackets, sampling valves and the CIP header are all instances.
- **`qa`:**
  - `tests/scene/yogurtLine.test.ts` holds each stage 12–14 machine to its mesh count, so a fitting that would add a draw call fails.
  - `tests/scene/wingMotion.test.ts` checks every machine's fittings and the jacket's water for each tank state. On the live sim it checks the opening (two tanks chilled, one warm, the ice water on, the screens dark), production (the screen blue, the green lamp, the mix in the sight glass, the hot water's display, the culture dosing) and the clean after a divert (amber).
  - `e2e/yogurtMotion.spec.ts` checks a fermenting tank's warm jacket and the homogenizer's screen, dark and then lit.
- **Checks:**
  - `npm run check`: 1,857 of 1,860 unit tests pass, and the 114 asset tests. The three that fail time out under the parallel run here and pass alone, 88 of 88: `warehouseMotion.test.ts`'s forklift and truck runs (as in phases 24 and 25) and `sim.test.ts`'s 30-day event-queue run.
  - `npm run build` passes.
  - The browser tests `yogurtMotion`, `yogurtFlow` and `yogurtWing` pass.
  - **Draw calls:** the overview reads **350** draw calls and 388,650 triangles (the [baseline](../../tests/perf/baseline.md#phase-26-every-machine-of-the-yogurt-process-hall-in-more-detail)).
