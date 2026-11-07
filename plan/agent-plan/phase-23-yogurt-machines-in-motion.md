[Agent plan](README.md) · Phase 23 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 23 · The yogurt machines in motion

The 3D half of the developer's request after Y3 ([phase 22](phase-22-yogurt-process-flow.md) is the panel's): the yogurt line's machines show what happens inside them, moving with the sim's live state.

- **Entry:** phase 22 is merged.
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `scene` | `src/scene/equipment/yogurt/wingMotion.ts`: each machine's moving parts, driven by the snapshot; drawn in the cold chain's box mesh so they cost no draw call | `src/scene/` |
| 2 | `qa` | `tests/scene/wingMotion.test.ts` on the live sim; `e2e/yogurtMotion.spec.ts`; the overview's draw calls | `tests/`, `e2e/` |

| Stage | Machine | What moves | When |
|---|---|---|---|
| 11 | Powder station | The rotary valve under the hopper turns | While the mix line runs |
| 11 | High-shear mixer | Its rotor spins in the funnel | Likewise |
| 11 | Stabilizer skid | The dosing pump's plunger strokes | Likewise |
| 12 | Deaerator | The vacuum pump's fan turns | While mix flows through the heat treatment |
| 12 | Homogenizer | Three pistons stroke, a third of a turn apart | Likewise |
| 12 | Plate heat exchanger | A strip on each pack in the pipes' temperature colours: regeneration at 68 °C, heating at the outlet, cooling at 43 °C | Lit while mix flows |
| 13 | Culture pump | The plunger strokes | While the heat treatment sends mix forward |
| 13 | Fermentation tanks | A sight glass on each shows what is inside at its level: the mix's white at pH 6.6 turning to cream yogurt by pH 4.55; dark above the level | Always |
| 14 | Smoothing valve | A flow meter's vane spins on the pipe after it | While a ready tank empties |
| 14 | Plate cooler | A strip in the colour of its outlet | Likewise |
| 14 | Fruit tank | Its dosing pump's plunger strokes | While fruit is dosed |
| 15 | Line P8 | The coder flashes once a cycle; the three check gates flash in turn as the row reaches them | While P8 fills |
| 16 | Blast chiller | Three fans on its unit turn | While it holds pallets |
| 16 | Cold room | Three evaporators between the dock doors, their fans turning | While its cooling works; still in a cooling failure (D30) |

## Exit checklist

- [x] Each yogurt stage's machines show what happens inside them, moving with the live state, and stand still while the sim is paused.
- [x] The overview stays within its budget of about 350 draw calls.
- [x] `npm run check` and the new browser test pass.
- [ ] The developer watches the wing at ×1.

## Status

Built on 7 November 2026, on phase 22. Lane by lane:

- **`scene`:** `wingMotion.ts` gives 19 machines 33 moving or lit parts (the table above; the three tanks and the three gates each count). Each part is a box instance, coloured per instance, casting no shadow and taking no clicks. They move on animation time (`motion.ts`), as the plant's other motion does.
  - **No draw call of their own:** a mesh of their own made the overview read 351 draw calls, over the budget, so they are drawn in the cold chain's box mesh, ahead of its pallets (`SharedBoxes`). The overview reads **350** draw calls and 367,034 triangles, and the yogurt stages' stops 128 to 141.
  - Each machine with parts reports them in its `debugState`: how far each part has turned, whether it moves, and its colour.
  - The cold room's evaporators hang between the dock doors, where the stage-16 camera sees them over the south wall.
- **`qa`:**
  - `tests/scene/wingMotion.test.ts` checks the parts on the live sim: at the opening, while paused, in production, P8's flashes, the sight glasses through a tank's cycle, the evaporators clear of the doors, and the fans in a cooling failure and after its repair.
  - `e2e/yogurtMotion.spec.ts` checks the same in the browser through the `?debug` hook.

- **Checks:**
  - `npm run check`: 1,840 of 1,841 unit tests pass and the 105 asset tests. The one that fails is the warehouse-motion run that times out under the parallel run here and passes alone.
  - `npm run build` passes. The new browser test passes, and so do `yogurtWing` and `yogurtColdChain`'s first tests, which read the same machines and the cold chain's boxes.

**Not built:** the yogurt line's own hero models of the smaller machines (the mixer, the pumps, the chiller's unit): the parts are drawn on their grey boxes.
