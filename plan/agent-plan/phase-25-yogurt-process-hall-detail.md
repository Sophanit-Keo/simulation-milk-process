[Agent plan](README.md) · Phase 25 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 25 · The yogurt process hall in detail

The developer's request after phase 24: "more details on the yogurt processing hall, stages 12 to 14, and the machine animation details". Phase 23 put the first moving parts on these machines; this phase gives the machines their missing parts and moves more of them with the line.

- **Entry:** phase 24 is merged.
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## What it adds

| Stage | Machine | New detail | New motion (driven by the live sim) |
|---|---|---|---|
| 12 | Deaerator | The vapour condenser on top, the vacuum line down to the pump, its motor, the tangential inlet, a level transmitter | The vacuum gauge's needle at −0.8 bar while mix flows |
| 12 | Homogenizer | The motor and belt guard behind, the liquid end the pistons stroke into, the two-stage homogenizing valve and its hydraulic actuators, a drip tray | The flywheel turns with the pistons; two pressure gauges read the 1st and 2nd stage |
| 12 | Plate heat exchanger | The guide bar, the tie bolts, the plates' edges, the connector plates between the sections, the ports on the fixed head; the hot-water set east of it: its tank, pump and steam valve | The hot-water pump turns; the steam valve's stem opens with the steam the heating draws |
| 12 | Holding cell | The CCP's temperature recorder at the outlet | Its pen follows the outlet temperature across the chart, red under 85 °C |
| 12 | Reprocess tank | Its pump-out pump | The pump turns while the wing's clean pumps the tank out to rework |
| 13 | Culture dosing | The culture freezer chest beside the dosing vessel | — |
| 13 | Fermentation tanks | The valve matrix: a mix-proof valve on each tank's inlet and outlet | A valve's stem lifts and turns green while the tank fills (inlet) or empties (outlet); both open amber while it cleans |
| 14 | Smoothing valve, plate cooler | The strainer; the cooler's tie bolts, plate edges and chilled-water ports, and its ice-water pump | The ice-water pump turns while it cools |
| 14 | Fruit tank, P8 buffer | The fruit preparation's IBC; the buffer's sterile-air filter and pressure transmitter, and its outlet valve | The buffer's outlet valve opens while P8 runs on it |

The new parts are drawn in each machine's existing materials, and the new moving parts in the shared box mesh (phase 23), so the overview keeps its 350 draw calls. The panel's process flow gains two steps: the hot-water set (stage 12) and the valve matrix (stage 13).

## Exit checklist

- [x] Each machine of stages 12–14 shows its new parts, clear of the pipes and of the other machines.
- [x] Each new moving part moves, reads or lights with the live sim, and stands still while it is paused.
- [x] The panel shows the hot-water set's and the valve matrix's readings.
- [x] `npm run check`, the browser tests and the draw-call budget pass.
- [ ] The developer watches the hall at ×1 and ×10.

## Status

Built on 7 November 2026, on phase 24 as merged (PR #28). Lane by lane:

- **`scene`, the parts:** `src/scene/equipment/yogurtLine.ts` draws them.
  - **In the machines' own materials:** each part joins a mesh its machine already has (dark steel without a shadow, or the paint, or the steel). The tanks take theirs through the vessel builder's new `detail` hook.
  - **Where they stand:** `yogurt/layout.ts` places the parts the motion shares: the gauges, the liquid end, the hot-water set, the recorder, the pumps and the valves.
  - **Moved for the stage's camera:**
    - the hot-water set stands east of the heat exchanger, not behind it, where the 1.6 m packs would hide it;
    - the ice-water pump stands at the cooler's east end, in front of the line;
    - the culture freezer stands west of the dosing skid, clear of the culture line;
    - the homogenizer's liquid end is low enough, and its pistons far enough forward, that the pistons stay in view as they stroke into it.
- **`scene`, the motion:** `yogurt/wingMotion.ts` adds 37 parts to phase 23's 33, all instances in the shared box mesh.
  - **Parts that travel:** a part can now travel to a place instead of turning: its phase eases to a target (0–1) at its rate, on animation time. A valve's stem and a gauge's needle are such parts.
  - **Readings:** such a part reports its reading (`…Reading`) and how far it has gone (`…Lift`) in its machine's debug state.
  - **The gauges:** each has a white face and a red needle that sweeps 270°. The deaerator's reads 0.8 bar of vacuum while the mix flows. The homogenizer's two read 180 bar and the second stage at the UHT's share of the first (30 of 200 bar), 27 bar, both on a 250 bar scale.
  - **The flywheel** turns with the pistons' crank, turn for turn.
  - **The steam valve's stem** lifts with `energy.steamKgPerH` against the 255 kg/h the heating takes at full flow from 68 to 92 °C, and shows yellow while steam flows.
  - **The CCP recorder:** its chart runs while the heat treatment does. The red line marks 85 °C. The pen writes the outlet across 80–95 °C, blue, and red under the limit.
  - **The pumps:** the hot-water pump turns while the mix is heated, the reprocess pump while the clean empties its tank, and the ice-water pump while the cooler cools.
  - **The valve matrix:** a valve on each tank's inlet branch and one under its cone, each a body, its actuator and its stem. The stem lifts and shows green while its tank fills (inlet) or empties (outlet); both open amber while the tank cleans.
  - **The buffer's outlet valve** opens while P8 runs on a buffer that has yogurt. P8 draws a cycle's cups at a time, so its outflow pulses, but the valve does not.
- **Found and fixed (from phase 23):**
  - **The cause:** the shared box mesh's bounding sphere was the cold chain's alone, centred at x 28.7 with a 32 m radius, but phase 23 had put moving parts as far as the silo, at x −52.
  - **What it did:** a closer look at stages 11–14 put the sphere outside the camera's view, and three.js culled every moving part there: the pistons, the heat exchanger's strips, the tanks' sight glasses.
  - **The fix:** `wingSphere()` bounds the whole wing and its reefer yard. A test holds every shown instance inside it.
- **`process`, `ui`:** two new steps in the panel's process flow:
  - stage 12's **hot-water set**, a branch after the heating: "255 kg/h of steam into the circuit";
  - stage 13's **valve matrix**, after the culture dosing: "tank 2 filling · tank 1 emptying", amber while only a clean has valves open, and skipped on the set route while every valve is shut.
- **`qa`:**
  - `tests/scene/wingMotion.test.ts` checks the bounding sphere. On the live sim it also checks:
    - the opening: tank 1's open outlet, the buffer's valve, the gauges at rest, and the clean's amber valves;
    - production: the gauges' readings and needles, the flywheel in step with the pistons, the steam valve's stem, the pen at 92 °C, and the filling tank's inlet;
    - an under-temperature divert: the pen red under the limit, then the reprocess pump in the clean;
    - a pause: every needle stands half way.
  - `tests/ui/processFlow.test.ts` checks the two new steps.
  - `e2e/yogurtMotion.spec.ts` checks the valves, the gauges, the steam valve, the recorder and both panel readings in the browser.
- **Checks:**
  - `npm run check`: 1,852 of 1,854 unit tests pass, and the 114 asset tests. The two that fail are `warehouseMotion.test.ts`'s forklift and truck runs, which time out under the parallel run here (as in phase 24) and pass alone, 29 of 29.
  - `npm run build` passes.
  - The browser tests `yogurtMotion` and `yogurtFlow` pass.
  - **Draw calls:** the overview reads **350** draw calls and 384,214 triangles (the [baseline](../../tests/perf/baseline.md#phase-25-the-yogurt-process-hall-in-detail)). The stops at stages 11–13 read two more than in phase 24, because their moving parts now draw instead of being culled.
