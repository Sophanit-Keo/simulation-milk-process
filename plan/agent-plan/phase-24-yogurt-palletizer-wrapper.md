[Agent plan](README.md) · Phase 24 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 24 · The yogurt palletizer and stretch wrapper in detail

The developer's request after phase 23: "add more details to the palletizer and the stretch wrapper, and the machine animation", for the yogurt wing (stage 16), in the 3D view and in the panel. Phase 19 meant them to be instances of phase 12's robot and wrapper; they were built as grey boxes, a column whose arm swings and a turntable that spins.

- **Entry:** phase 23 is merged.
- **Exit:** the checklist below.
- **Critical path:** `assets`, `scene`.

## The line

Trays of 24 cups leave the tray packer on an infeed belt. A **gantry palletizer** picks each one off the belt's end and sets it on the pallet:
- the bridge runs along the line, the trolley across it, and the lift lowers a vacuum head;
- 8 trays a layer (4 along the line by 2 across), 15 layers: 120 trays, a tray every 4 s at P8's 21,600 cups/h.

An **empty-pallet dispenser** behind the gantry slides a fresh pallet onto the place when the full one leaves. The full pallet rides on rollers to the **stretch wrapper**, the UHT line's model (phase 12):
- the turntable turns it 8 times while the carriage climbs the mast and comes down;
- the film grows up the load and is cut.

Then the pallet rides on to the staging row, where the cold chain's tokens take it over (phase 19).

The pallet's load is drawn 0.85 m tall, as the cold chain draws it downstream, so a pallet keeps its look from the palletizer to the reefer. The real stack of 15 layers of 75 mm trays is about 1.1 m.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `assets` | `yogurt-palletizer.glb` in `make-heroes.mjs`: the frame, the infeed belt, the pallet place's rollers, the dispenser's guides, and the nodes `bridge`, `trolley` and `lift`; its spec, licence and tests | `assets/`, `public/models/` |
| 2 | `scene` | `src/scene/equipment/yogurt/palletLine.ts`: the gantry's cycle, the stack, the pallet's ride, wrap and departure, drawn in the cold chain's box mesh; the palletizer and the wrapper swapped for their models; the wrap's film for a 0.85 m load | `src/scene/` |
| 2 | `process`, `ui` | Stage 16's process flow: the palletizer's and the wrapper's steps apart, with their live readings | `src/data/`, `src/ui/` |
| 3 | `qa` | Unit tests of the cycle and the traffic; the asset tests; `e2e/yogurtPalletLine.spec.ts`; the overview's draw calls | `tests/`, `e2e/` |

## Exit checklist

- [x] The gantry picks each tray off the belt and sets it on its place, layer by layer, while P8 fills; the stack follows the sim's trays.
- [x] A closed pallet rides to the wrapper, turns while the film is wound up and down it, and rides on to the staging row; a fresh pallet comes from the dispenser.
- [x] The panel's process flow shows the palletizer's layer and trays and the wrapper's last pallet, live.
- [x] `?greybox` keeps the boxes; the asset tests, `npm run check` and the new browser test pass; the overview keeps its draw-call budget.
- [ ] The developer watches the line at ×1 and ×10.

## Status

Built on 7 November 2026, on phase 23 as merged (PR #27). Lane by lane:

- **`assets`:** `make-heroes.mjs` builds `yogurt-palletizer.glb`, 3,292 triangles in 4 meshes ([hero-specs.md](../../assets/hero-specs.md#phase-24-the-yogurt-wings-gantry-palletizer)):
  - the frame, the tray infeed, the place's rollers and the dispenser's guides are one painted body;
  - the nodes are `bridge`, `trolley` (under it) and `lift` (under that, its origin the vacuum head's underside).

  Its tests check the head reaches the pick point and every place within its travel, the mast stays in the trolley, the head clears a full stack, and the frame leaves the pallet's path clear.
- **`scene`:** `src/scene/equipment/yogurt/palletLine.ts` holds the line's motion, headless.
  - **The gantry:** its cycle of six moves, 3.6 motion seconds a tray, picks at the infeed's end and sets each tray on the next free place. Each layer fills from the far end, the back row first. The stack follows the sim's open pallet, and never shows more than one tray past it.
  - **A closed pallet** (the sim's newest pallet) rides at 0.4 m/s to the turntable and wraps on the UHT wrapper's cycle (`wrapPoseAt`, now given the wing's lower load). It turns there, then rides on to the staging row, which stands on the outfeed rollers.
  - **The fresh pallet** slides on from the dispenser in 3 s.
  - **At high speeds** a pallet on its way finishes its ride and its wrap, and the stack simply starts again.
  - **Drawing:** the pallets, the stacks, the tray in the head and the dispenser's stack are instances in the cold chain's box mesh, beside phase 23's motion.
  - **The machines:** the palletizer swaps in its model. The wrapper loads the UHT line's model, and keeps the wing's rollers, the film web and a film shell that grows up the load and stays on it to the staging row.
  - **Draw calls:** five were taken back elsewhere in the wing (the [baseline](../../tests/perf/baseline.md#phase-24-the-yogurt-palletizer-and-stretch-wrapper)), so the overview reads **350**.
- **`process`, `ui`:** stage 16's process flow splits the old "Palletizer and wrapper" step in two.
  - **Gantry palletizer:** "layer 3 of 15 · 21 of 120 trays".
  - **Stretch wrapper:** "last: pallet 168 of P8-008-1, 120 trays · closed 4 min ago". The sim keeps no wrap time, so the reading says when the pallet closed.
- **`qa`:**
  - `tests/scene/palletLine.test.ts` checks the stack's places, the cycle within the model's travel (against `GANTRY`), and on the live sim: trays laid while P8 fills, a closed pallet's ride, its 8-turn wrap with the film growing and its departure, a fresh pallet, and nothing moving while paused.
  - `tests/ui/processFlow.test.ts` checks the two readings.
  - `e2e/yogurtPalletLine.spec.ts` checks the same in the browser, from the gantry's first tray to the wrapped pallet leaving the line.
- **Checks:**
  - `npm run check`: 1,847 of 1,848 unit tests pass and the 114 asset tests. The one that fails is the warehouse-motion run that times out under the parallel run here and passes alone.
  - `npm run build` passes.
  - The new browser test passes, and so do `yogurtFlow`, `yogurtColdChain` and `yogurtWing`, which read stage 16's machines and pallets.
