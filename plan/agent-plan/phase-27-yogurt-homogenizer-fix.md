[Agent plan](README.md) · Phase 27 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 27 · The yogurt homogenizer, rebuilt

The developer's request after phase 26: "fix the homogenizer machine details and animation". The yogurt homogenizer had grown from boxes over phases 16, 23 and 25, and from the stage's camera it read as boxes:
- the pistons stood behind the liquid end's top edge, so they showed as flat grey tiles on it;
- the liquid end hung in front of the body on two legs and a bracket;
- the flywheel was a thin bar on the far side;
- the gauges were small, on the liquid end's face.

This phase rebuilds it on the UHT line's homogenizer model's layout (`buildHomogenizer` in `assets/scripts/make-heroes.mjs`). Swapping that model in would add about six draw calls to an overview already at its budget of 350, so the grey parts stay in the homogenizer's two meshes and its moving parts stay instances.

- **Entry:** phase 26 is merged (PR #30).
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## What changes

| Part | Before | Now |
|---|---|---|
| Body | A painted box with a dark crank case on top | A crankcase on a base frame, a top cover, seal covers where the pistons leave it, an inspection cover over the gap |
| Pistons | Three boxes behind the liquid end, at 2.5 strokes a second | Three pistons in the open gap between four tie rods over a drip tray, each with a collar that shows its stroke, at the UHT homogenizer's crank speed (7 rad/s) |
| Liquid end | A block in front, on two legs and a bracket | A low block on its pedestal, its top under the camera's line to the pistons, a valve cover over each piston, the two-stage homogenizing valve at its east end with its two actuators |
| Gauges | Two dials on the liquid end's face | Two dials on the top cover, facing up, where the camera reads them; their needles sweep from seven-thirty to four-thirty |
| Drive | A box behind, a thin flywheel bar on the west side | A round main motor along x with its fan cowl, end shield, feet and terminal box, and the belt guard on the east side with the flywheel's two spokes turning on it |
| Motion | The pistons started and stopped at once | The crank spins up over 0.8 s as the mix flows and runs down over 0.8 s once it stops; pistons, collars and flywheel turn together |

The cabinet and its screen and lamps (phase 26) stay. The lube-oil unit moves behind the west end, clear of the belt guard.

## Exit checklist

- [x] The pistons show in the gap from the stage's camera, and their ends stay in the crankcase and the liquid end all stroke.
- [x] The crank spins up and runs down; pistons, collars and flywheel turn together; they stand while paused.
- [x] The homogenizer is still two meshes, clear of the pipes and its neighbours.
- [x] `npm run check`, the browser tests and the draw-call budget pass.
- [ ] The developer watches it at ×1.

## Status

Built on 7 November 2026, on phase 26 as merged (PR #30).

- **`scene`:**
  - `yogurt/layout.ts` holds the layout, `HOMOGENIZER_FRAME`, in offsets from the homogenizer's middle; the gauges move to the top cover.
  - `yogurtLine.ts` draws the grey parts from it.
  - `yogurt/wingMotion.ts` moves the pistons, the collars and the flywheel's two spokes.
  - **Parts that ease:** a turning part can now take `easeS`, the time it takes to spin up or run down.
  - **Upward gauges:** `yogurt/motionParts.ts` gains `topGauge`, a gauge that faces up.
- **`qa`:** `tests/scene/wingMotion.test.ts` checks three things:
  - each piston's ends stay in the crankcase and the liquid end, and its collar in the gap, all stroke;
  - the stage 12 camera's line over the liquid end passes under the pistons' tops over most of the gap;
  - on the live sim, the crank spins up, the pistons, collars and flywheel turn together, and they run down to a stop when the clean stops the flow.
- **Checks:**
  - `npm run check`: 1,860 of 1,863 unit tests pass, and the 114 asset tests. The three that fail are the same timeouts as in phase 26 (`warehouseMotion.test.ts` and `sim.test.ts` under the parallel run), and pass alone, 88 of 88.
  - `npm run build` passes.
  - The browser tests `yogurtMotion` and `yogurtWing` pass.
  - **Draw calls:** the overview reads **350** draw calls and 389,490 triangles (the [baseline](../../tests/perf/baseline.md#phase-27-the-yogurt-homogenizer-rebuilt)).
