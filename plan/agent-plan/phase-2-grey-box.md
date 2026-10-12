[Agent plan](README.md) · Phase 2 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 2 · Grey-box plant (weeks 2–3)

Build every zone, machine and pipe as simple shapes, make a stage click fly the camera there, and drive the frame loop from the real sim clock.

- **Entry:** phase 1 exit checklist done, contracts v0 merged.
- **Exit:** **gate G1**: a grey-box plant with all seven zones, pipes and camera fly-to.
- **Critical path:** `scene`. The other lanes feed it or build against the mock snapshot.

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `scene` | Lay out the seven zones in a U, porting the preview's zone layout, and add zone labels. Grey-box every Must item in the [asset list](../05-layout-and-3d-assets.md#3d-asset-list) as an `equipment/` class with `build()` and `update(snapshot)`, each tagged with its stage for picking. `pipes.ts`: `TubeGeometry` runs along curves, vertex-coloured blue → yellow → red from snapshot temperatures, with a flowing texture. Camera fly-to per stage (port the preview's camera stops), raycast picking that sends `selectStage`, and one CSS2D label per machine. | Clickable grey-box plant |
| `ui` | Top bar: clock, pause, the five speed presets, next event, and an empty scenario menu, all sending `Command`s. Stage rail 1–10 with status lamps from the snapshot; a click sends `selectStage`. Info panel skeleton: name and description from `stages.json`, plus live values listed from the snapshot. KPI strip with every slot from [KPIs on screen](../06-simulation-model.md#kpis-on-screen). HUD updates throttled to 4 a second. | Full screen layout on mock data |
| `sim` | A static plant: `createSim` returns all 10 stages with values equal to the `plant.json` set points, status lamps, and a working clock and next-event jump. Agree the per-stage fields of contracts v1 with `scene` and `ui`. | Static snapshot that replaces the mock |
| `process` | `src/data/stages.json`: name, zone, one-line description, the list of live values, and a first draft of the two-line tour caption for each stage, all from the [stage research](../03-stages-1-5-liquid-line.md). The set-point temperature on every pipe segment, from the [chart values](../02-uht-line-at-a-glance.md#chart-values-as-text) and the R7 decision. Review the grey-box plant against the [floor plan](../05-layout-and-3d-assets.md#zones-as-text): zone order, flow direction, no Must item missing. | `stages.json`, pipe temperatures, layout review |
| `assets` | Kenney conveyors placed. Plain, brand-free carton, tray and pallet meshes with an invented logo texture. CC0 truck and forklift (Should). Hero model specs for the separator, homogenizer, filler and palletizer: outer dimensions that match the grey boxes, named moving nodes (`bowl`, `piston_1`–`piston_3`, `reel`, `jaws`, `arm_*`) and a polygon budget, so the swap in phase 5 needs no code changes. | Kit, token meshes, hero specs |
| `qa` | Browser tests: each rail button selects its stage and moves the camera, the speed buttons change the sim speed, and there are no console errors. A perf baseline (fps and `renderer.info` draw calls) recorded in `tests/perf/baseline.md`. A conformance test that the static sim's output matches `Snapshot` and has 10 stages. | G1 test report, perf baseline |
| `lead` | Wire the [frame loop](../07-tech-stack-and-architecture.md#every-frame) in `main.ts`: input → sim step → snapshot → scene → HUD → render. Add the view-event bus between `ui` and `scene`. Publish contracts v1 and run G1 with the developer. | Contracts v1, G1 review |

## How they work together

- **Week 2.** On Monday `lead` posts the contracts v1 draft (stage status, per-stage values, view events), and `sim`, `scene` and `ui` agree it by Tuesday. `process` delivers `stages.json` by Wednesday, because the info panel needs it. Meanwhile `scene` blocks out zones and machines, `ui` builds the bar, rail and panel on the mock snapshot, `sim` builds the static plant, and `assets` places the kit.
- **Week 3.** `scene` adds pipes, fly-to and picking. `lead` connects rail clicks and 3D clicks through the view-event bus, so both select the same stage. `sim`'s static plant replaces the mock. `qa` runs the browser tests and records the perf baseline. On Friday the developer walks through the G1 checklist.

## Hand-offs

- `process` → `ui`, `scene`: `stages.json` and pipe temperatures.
- `assets` → `scene`: conveyor and token meshes, and the hero specs with node names.
- `sim` → all: the static snapshot (contracts v1) replaces the mock.
- `qa` → `lead`: the perf baseline and the G1 test report.

## Gate G1 checklist

- [ ] All seven zones and every Must item exist as grey boxes, and the pipes are coloured by temperature.
- [ ] A rail click and a 3D click select the same stage, the camera flies there, and the panel shows that stage's text.
- [ ] The top bar drives the sim clock: pause, ×1 to ×10,000, next event.
- [ ] 60 fps on the grey-box plant, with the draw-call count recorded.
- [ ] CI and the browser smoke tests pass.
- [ ] The developer signs G1.

## Watch for

- **Polishing too early.** Grey boxes only. Should and Could models wait, and detail waits for phase 5.
- **Camera stops tuned by eye.** Store them in one table per stage, so the guided tour in phase 5 can reuse them.

---

← [Phase 1. Setup](phase-1-setup.md) · [Phase 3. Liquid line](phase-3-liquid-line.md) →
