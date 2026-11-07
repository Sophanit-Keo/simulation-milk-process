[Agent plan](README.md) · Phase 22 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 22 · The yogurt line's process flow, step by step

The developer's request after Y3: "add the details to each processing flow and the animation", for the yogurt line (stages 11–16). This phase does the panel's part; [phase 23](phase-23-yogurt-machines-in-motion.md) the 3D view's.

Each yogurt stage's panel gains a **Process flow**: the order the product passes through that stage's equipment, what happens at each step, and the live reading there, on an animated track. The track's dots run at the live flow, stop where nothing flows, turn amber or red where a step warns or diverts, and fade on a step the current route skips (set yogurt skips the tanks, the smoothing and the cooler; stirred skips the warm room).

- **Entry:** phase 21 is merged.
- **Exit:** the checklist below.
- **Critical path:** `process`, `ui`.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | `src/data/yogurtFlow.json`: each stage's steps in flow order, with a name and one sentence on what happens there, from [plan 12](../12-yogurt-line.md#stage-research-1116) and the [P8 SOP](../yogurt-sop-p8.md) | `src/data/` |
| 2 | `ui` | `src/ui/processFlow.ts`: each step's live reading and state from the snapshot, and the panel part that draws the track; its styles in both themes; reduced motion respected | `src/ui/`, `src/styles/` |
| 3 | `qa` | `tests/ui/processFlow.test.ts` (every step has a reading, the states for the routes, a divert and a fault); `e2e/yogurtFlow.spec.ts` (the track on each yogurt stage, live, and red in a divert) | `tests/`, `e2e/` |

No contract changes: the flow reads the snapshot of contracts v12.

## Exit checklist

- [x] Stages 11–16 each show their process flow, with a live reading at every step.
- [x] The track's dots run with the live flow, and stand still when the sim is paused or nothing flows.
- [x] A divert, a stop or a hold shows on the step where it happens; a step the route skips fades.
- [x] `npm run check` and the new browser tests pass; the panel still fits at 1280 × 720 and 1440 × 900.
- [ ] The developer reads each stage's flow.

## Status

Built on 7 November 2026, on phase 21 as merged (PR #26). Lane by lane:

- **`process`:** `src/data/yogurtFlow.json` gives 36 steps: stage 11's five (the silo, standardization, the powder, the stabilizer, the mix tank), 12's seven (the deaerator to the cooling section, with the divert's reprocess tank as a branch), 13's five (the culture, set yogurt's route past the tanks as a branch, the three tanks), 14's four, P8's nine stations and checks, and 16's six. Each sentence follows [plan 12](../12-yogurt-line.md#stage-research-1116) and the SOP, and its numbers are `plant.json`'s.
- **`ui`:** `src/ui/processFlow.ts` reads each step's live value and state from the snapshot. The panel part draws them on a track below the live values:
  - its dots run at the stage's live flow (1.6 s a dash at the full rate, slower as it falls) and pause with the sim;
  - a tank fermenting or a room holding pallets shows a hollow node;
  - amber marks a clean, a changeover or a wait near its limit; red a divert, a stopped P8, a held tank or pallets on QA hold;
  - a step this shift's route skips fades.

  Reduced motion stops the dots. No contract changed.
- **`qa`:**
  - `tests/ui/processFlow.test.ts` checks the data's shape and a reading for every step, then the states on the live sim: at the opening, on the set route, in a divert and its clean, and in a HEPA loss.
  - `e2e/yogurtFlow.spec.ts` checks every stage's steps on screen with a live reading, the dots running, pausing with Space and stopping in a HEPA loss.

- **Checks:**
  - `npm run check`: 1,831 of 1,834 unit tests pass and the 105 asset tests. The three that fail are timeouts under the parallel run (two warehouse-motion runs and a core run); each passes alone, as in phases 20 and 21.
  - `npm run build` passes, and both new browser tests pass.

The panel scrolls as before; the one-screen layout test (stage 4) is unchanged.
