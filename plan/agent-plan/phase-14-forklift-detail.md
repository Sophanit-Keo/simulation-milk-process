[Agent plan](README.md) · Phase 14 · [Roadmap](../09-development-roadmap.md)

# Phase 14 · The forklifts in detail

Make the two warehouse forklifts read as a real electric counterbalance truck, modelled on a 2 t class datasheet ([D24](../DECISIONS.md#d24-the-forklifts-in-detail)): an operator on the seat, a mast that tilts back with its load, rear wheels that steer, the lift at the datasheet's speeds, the blue safety spot on the floor, and a label that says what each one is doing. Phase 12's jobs, routes and clearances stay as they are; nothing in the sim or the contracts changes.

- **Entry:** phase 13 is merged.
- **Exit:** the checklist below; the developer watches a put-away and a truck being loaded and judges the forklifts believable.

## What changes

| Part | Now | After |
|---|---|---|
| Model | Body, guard, mast, forks, beacon; no driver | A seated operator in a hi-vis vest and hard hat; the battery hood and its charging socket (electric: no exhaust); lift cylinders, chains and hoses on the mast; mirrors, a grab handle, a step, work and tail lights and a blue-spot lamp |
| Mast | Fixed upright | A `mast` node that tilts: back 8° while carrying, level to pick up or set down, at 4° a second. The inner mast and forks ride in it, so the forks and the pallet tilt with it |
| Steering | Rear wheels fixed | `steer_left` and `steer_right` turn with the motion, up to 85°: straight on a straight run, turned in a curve, nearly crosswise when it turns on the spot |
| Lift | 0.5 m/s up and down | 0.56 m/s laden and 0.64 m/s empty up, 0.57 m/s down (the datasheet) |
| Blue spot | — | A blue spot on the floor 3 m ahead in the direction of travel while it drives, and none while it stands |
| Label | "Forklift" | What it does: "parked", "to the pallet", "picking up", "to rack place 14 · forks 1.6 m", "loading door 2", "back to its spot" |

## Contracts (`lead`)

- **Model nodes** (`vehicles/forklift.glb`; a model short of one keeps the grey box, which has the same groups):

| Node | Parent | Origin (model frame, m) | Motion |
|---|---|---|---|
| `mast` | scene | the mast's pivot on the drive axle, (0, 0.32, 0.61) | Turns about +x: −8° (back) to +5° (forward) |
| `mast_inner`, `forks` | `mast` | as before, now in the mast's frame | Slide along the mast's y as before (the 2:1 chain) |
| `steer_left`, `steer_right` | scene | the rear wheels' centres, (∓0.45, 0.24, −1.3) | Turn about +y, ±85° |
| `beacon` | scene | as before | as before |

- **Debug state** (`forklift-1`, `forklift-2`): new keys `tiltRad` (negative is back), `steerRad` and `blueSpot` (boolean); the others stay.
- **Budgets:** the forklift model at most 8 meshes. The packs line stays within its 185 draw calls and 10 own materials (the blue spot takes one).

## Who does what

The developer asked for this as one change; `lead` builds it lane by lane in one session, within the agents' ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | This card, D24 | `plan/` |
| 2 | `assets` | The forklift model: the operator, battery hood, mast details, mirrors, lights; the `mast` node with the inner mast and forks in it; the steer wheels as nodes; the specs and tests | `assets/scripts/make-vehicles.mjs` and its test, `assets/README.md`, `public/models/vehicles/forklift.glb` |
| 3 | `scene` | The grey forklift's same groups; mast tilt; steering from the motion; the lift speeds; the blue spot; the tilted carried pallet; the label; the debug keys | `src/scene/equipment/packs/`, `src/scene/equipment/packsLine.ts`, `tests/scene/` |
| 4 | `qa` | `e2e/motion.spec.ts`: the mast tilts back while carrying, the wheels steer, the blue spot shows while it drives | `e2e/` |

## Exit checklist

- [ ] `npm run check` and `npm run build` pass, within the budgets.
- [ ] `assets/scripts/make-vehicles.test.mjs`: the new nodes with their parents and origins; the forklift still 3.5 × 2.2 × 1.2 m; the operator under the guard's roof; the forks clear of the floor at 5° forward and the mast clear of the guard at 8° back.
- [ ] `tests/scene/warehouseMotion.test.ts`:
  - the tilt back while carrying, and level at a pick or set-down;
  - the lift speeds;
  - the steer angle along the rear axle's motion;
  - the blue spot while driving;
  - the carried pallet riding on the tilted forks;
  - the label words.
- [ ] `e2e/motion.spec.ts`: the same in the app.
- [ ] The developer watches the forklifts.

## Status

Planned on 4 November 2026.
