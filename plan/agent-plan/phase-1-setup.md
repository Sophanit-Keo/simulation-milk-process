[Agent plan](README.md) · Phase 1 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 1 · Setup (week 1)

Get a running Vite + three.js + TypeScript project with CI, the contracts every agent builds against, and a `plant.json` with every default settled.

- **Entry:** the developer has read the plan and the [review](../REVIEW.md), and approved the agent roster.
- **Exit:** the week-1 deliverable: the project runs, and `plant.json` holds the default settings.
- **Critical path:** `lead` (scaffold and contracts) and `process` (decisions and `plant.json`). Every other lane waits on one of them.

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `lead` | Scaffold Vite + TypeScript with the plan's [folder structure](../07-tech-stack-and-architecture.md#folder-structure), plus `src/contracts/`, `tests/` and `e2e/`. Pin `three` to an exact version (r186 is `0.186.0` on npm) along with `lil-gui`, `chart.js`, `vitest` and `eslint` ([R11](../REVIEW.md#r11-versions-and-hosting)). Set `base: '/simulation-milk-process/'` in `vite.config.ts` for GitHub Pages. Add CI (typecheck, lint, test, build, Pages deploy) and a lint rule that bans `three` imports in `src/sim/`. Draft contracts v0 (`PlantConfig`, `Snapshot`, `Command`, `ViewEvent`) and pick the units rule ([R8](../REVIEW.md#r8-units-in-typescript)). Open `plan/DECISIONS.md` and the task board. | Contracts v0, folder ownership map, `npm run check` |
| `process` | Settle [R1](../REVIEW.md#r1-batch-size): a batch is one filler × 8 h. Add the eleven [R2](../REVIEW.md#r2-missing-defaults) defaults, starting from the preview's values. Settle [R3](../REVIEW.md#r3-truck-payload): 22 pallets per truck, or keep 33 as an accepted simplification. Settle [R4](../REVIEW.md#r4-divert-rule): a 140.5 °C set point, or noise kept under ±0.3 °C. Settle [R7](../REVIEW.md#r7-homogenizer-outlet): about 82 °C at the homogenizer outlet. Log each decision with its reason, update the [default settings](../06-simulation-model.md#default-settings) table, and write `src/data/plant.json`. Write a hand-calculation table for QA from the review's "Checked and correct" list and R6. | `plant.json`, decision log entries, hand-calculation table |
| `sim` | `clock.ts`: sim time, pause, speeds ×1 to ×10,000, and the step-size rule (1 s; 10–60 s above ×1,000). `eventQueue.ts`: a binary heap that keeps equal-time events in insertion order. `rng.ts`: seeded mulberry32. `index.ts`: `createSim(config)` with `step()`, `dispatch(command)` and `snapshot()`. `mock.ts`: a plausible snapshot built from `plant.json`. | Mock snapshot for `scene` and `ui` |
| `scene` | `world.ts`: renderer, camera, OrbitControls, one shadow-casting light, floor, resize handling, and a hook into the frame loop. Read the preview's layout constants (zones, camera stops, pipe routes) to plan the phase-2 port. | Empty world that reads a snapshot |
| `ui` | `index.html` grid (top bar, stage rail, 3D view, info panel, KPI strip) and the colour tokens with light and dark themes, ported from the preview. A top-bar clock that shows the mock snapshot's time. | App shell |
| `qa` | Vitest set up. Tests for the clock (speeds, pause, step size) and the event queue (order, ties, popping due events). A test that `plant.json` matches `PlantConfig` with no missing keys. Formula tests written now from the hand-calculation table, marked skipped until phase 3. A browser smoke test: the page loads, the canvas exists, and there are no console errors. | Test harness; formula tests that define "done" for phase 3 |
| `assets` | Set up the asset pipeline: folders, GLB naming, polygon and texture budgets, `assets/LICENSES.md`. Download the [Kenney Conveyor Kit](https://kenney-assets.itch.io/conveyor-kit) (CC0) and check it loads with GLTFLoader at the pinned three.js version. | Asset rules |

## How they work together

1. **Day 1.** `lead` pushes the scaffold and a contracts v0 draft. At the same time, `process` starts on the decisions, which don't depend on any code.
2. **Day 2.** `sim`, `scene`, `ui` and `qa` comment on contracts v0 in one review round, then `lead` merges v0. `process` posts the hand-calculation table.
3. **Days 2–4, in parallel.** `sim` builds the clock, event queue, RNG and mock. `scene` builds the world, `ui` the shell, and `qa` the harness and the formula tests written first. `process` writes `plant.json` and `assets` sets up the pipeline.
4. **Day 5.** `lead` merges in order (contracts, `sim`, `scene` and `ui`, tests), runs the app and deploys the first Pages build. The developer approves the decision log.

## Hand-offs

- `lead` → all: contracts v0 and the ownership map.
- `process` → `sim`, `qa`: `plant.json` and the hand-calculation table.
- `sim` → `scene`, `ui`: the mock snapshot, so both can start before the model exists.
- `qa` → `sim`: skipped formula tests, the target for phase 3.

## Exit checklist

- [ ] `npm run dev` shows the app shell, an empty 3D floor and a ticking sim clock.
- [ ] `npm run check` and CI pass, and the Pages build loads with the right `base`.
- [ ] `three` is pinned to an exact version in `package.json`.
- [ ] `plant.json` holds every default, including the R2 rows, and the config test passes.
- [ ] The developer has approved R1, R2, R3, R4, R7 and R8 in `plan/DECISIONS.md`.
- [ ] Contracts v0 are merged.

## Watch for

- **Arguing over contracts.** v0 is a skeleton, and fields are added in each phase. Close the review after one round.
- **Code copied from the preview.** The preview loads three.js r170 from a CDN. Test anything copied against the pinned version ([R11](../REVIEW.md#r11-versions-and-hosting)).

---

← [Agent plan](README.md) · [Phase 2. Grey-box plant](phase-2-grey-box.md) →
