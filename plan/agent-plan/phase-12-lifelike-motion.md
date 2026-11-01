[Agent plan](README.md) · Phase 12 · [Roadmap](../09-development-roadmap.md)

# Phase 12 · Lifelike motion at the end of the line

Make the end of the teaching plant (stages 8 and 10) move the way the real machines do ([D22](../DECISIONS.md#d22-lifelike-motion-at-the-end-of-the-line)): the palletizer robot picks each tray off the belt and stacks it layer by layer; the stretch wrapper spins the pallet and winds film round it, bottom to top and down again; forklifts pick pallets up, lift them into the racks and load them onto trucks; trucks drive in, open their doors, back up to the dock, take on their load and pull away. Today these parts only hint at it: the arm swings without picking, the turntable turns with no film, the forklifts shuttle along one line with nothing on their forks, and the trucks slide in and out tail first.

Nothing the sim computes changes, and no contract in `src/contracts/` changes: every motion is drawn from the snapshot the scene already reads (contracts v6). Like the cartons on the belts, the motion is a sample. At ×1 and ×10 every move plays in full; at higher speeds the scene shortens or skips moves so it never falls behind the sim.

- **Entry:** phase 11 is merged.
- **Exit:** the checklist below; the developer watches stage 8 and stage 10 at ×1 and ×10 and judges the motion believable.
- **After it:** the factory floor (`factory.html#3d`) has no palletizing or warehouse yet; when it does, it can reuse these modules.

## What moves, and how

The numbers are visual assumptions, set so the motion reads like the real machine at ×1, unless a source is given. "Motion seconds" are real seconds times `motionRate(speed)` (`src/scene/motion.ts`: 1 at ×1, 1.5 at ×10, 3 at ×10,000).

### Stage 8 · Palletizer robot (`palletizer`)

| Step | What you see | Joint (hero node) | Time (motion s) |
|---|---|---|---|
| 1. To pick | The arm swings to the end of the tray line, the long way round via −z as now | `arm` rotation.y → pick angle | 1.6 |
| 2. Pick | The gripper drops to the tray on the belt (belt surface 0.86 m), the clamps close, it lifts the tray clear | `arm_lift` down 0 → about 0.6 m, `arm_clamp_1`/`_2` in 0.045 m each (where they meet a 0.24 m tray; the hero allows 0.10), `arm_lift` up | 1.4 |
| 3. To place | The arm swings to the pallet with the tray; the wrist turns so the tray stays square to the pallet | `arm`, `arm_wrist` rotation.y = −arm + tray angle | 1.8 |
| 4. Place | The gripper lowers the tray onto its place in the current layer (down to about 1.07 m for the bottom layer), the clamps open, the tray joins the stack, the gripper lifts | `arm_lift`, clamps | 1.4 |

- **Reach (added by lane A):** `arm_lift` also slides out along the boom, `position.x` from about 1.9 to 2.95 m, because a fixed 2.45 m reach cannot set trays on all 12 places of a layer; the boom is about 3.05 m long.

- One pick and place in about 6.2 motion seconds (now 12.6 with no pick). A real robot palletizer with a single-tray gripper makes about 10 to 20 picks a minute; 1,250 trays an hour is 21 a minute, so the arm shows a sample, like the belts.
- **The stack is trays, not a box:** 84 trays per pallet (`traysPerPallet`) stand as **7 layers of 12**, 3 × 4 trays of 0.40 × 0.25 m in plan (the trays' 0.60 × 0.50 m token, laid in a column-stack pattern; adjust the pattern, not the count, if the token's size does not fit a 1.2 × 1.0 m pallet). The number shown is the sim's own `palletTrays` (the fuller lane's, as now); the tray in the gripper is the one being added. One `InstancedMesh` with the tray print; the old scaled `stack` box goes.
- When the pallet closes, the full stack rides off to the wrapper (as now) and a fresh empty pallet stands under the place point.
- Idle (no packer lane packing): the arm finishes its move and parks over the pick point, gripper up, clamps open.
- The grey box gets `arm_lift`, `arm_wrist`, `arm_clamp_1`, `arm_clamp_2` as groups with the hero's rest transforms (`assets/hero-specs.md`, Palletizer), so the grey box and the hero move the same.
- **Could:** a low safety fence round the cell (posts and rails, the floor-marking yellow), open on the tray and pallet sides; merged, at most 2 draw calls.

### Stage 8 · Stretch wrapper (`stretch-wrapper`)

| Step | What you see | Time (motion s) |
|---|---|---|
| 1. In | The pallet rides onto the turntable and stops; the film tail is clamped at the base | — |
| 2. Base wraps | The turntable turns at 24 rpm; the film carriage at the bottom winds 2 turns round the base | 5 |
| 3. Up | The carriage climbs the mast over 3 turns, the film band rising up the load | 7.5 |
| 4. Top wraps | 1 turn at the top, with the carriage at about 0.88 m, where the roll still covers the load's top edge (it does from 0.37 to 0.90 m) | 2.5 |
| 5. Down | The carriage comes down over 2 turns | 5 |
| 6. Cut | The turntable stops square, the film is cut and wiped on; the wrapped pallet rides off | 1 |

- About 21 motion seconds a pallet (now 2.5). Real turntable wrappers turn at about 10 to 15 rpm and wrap a pallet in about a minute; this one turns about twice as fast so the cycle fits the 4 minutes between pallets at ×1 and still shows at ×10.
- **The film shows:** a translucent web from the roll on the carriage to the load's corner, turning with the pallet, and a film shell on the load that grows up and is complete by the top wraps. A wrapped pallet keeps its film all the way to quarantine.
- **One pallet on the turntable at a time:** the next one waits on the rollers just before it. At high speed, pallets that would queue past the pool are not shown (as now).
- The stretch wrapper gets a hero model (`assets`, below), swapped in like the other heroes, with the grey box keeping the same node names.

### Stage 10 · Forklifts (`forklift-1`, `forklift-2`)

Each forklift has one job, so their paths never cross:

- **`forklift-1`, put-away:** when stock rises (a batch is released from quarantine), it drives to the quarantine's west edge, lowers its forks, drives them into a pallet, lifts it 0.15 m, backs out, drives down a rack aisle to the next free rack place, turns to face it, lifts to the place's level (floor, 1.61 or 3.21 m), drives in, lowers, backs out and lowers its forks. Then the next, while stock keeps coming; then home to its spot.
- **`forklift-2`, loading:** while a truck is loading at a door, it takes a pallet from the racks' last filled place (lifting to its level), drives to that door, lifts the pallet to the trailer's deck (1.3 m), drives up until the pallet stands on the trailer's tail, lowers it, backs out and lowers. The pallet then shows in the trailer (below). Then the next, while the truck loads; then home.
- **Moving like a forklift:** it drives at 2.2 m/s empty and 1.8 m/s loaded, slows to 0.6 m/s to enter or leave a rack or trailer and in turns, turns smoothly (no flips; heading eased through corners), and never lifts while it drives faster than 0.6 m/s. Forks rise and fall at 0.5 m/s (typical for a counterbalance truck); the inner mast follows at half the forks' lift (the 2:1 chain, `assets/hero-specs.md`, Vehicles).
- A pallet on the forks while it carries one (stretch-wrapped, as from the wrapper). The amber beacon on its roof flashes while it moves (about 1.5 Hz) and is dark while parked.
- Clipping a rack upright by a few centimetres in a tight turn is accepted; driving through a rack is not.

### Stage 10 · Trucks and docks (`truck`, `docks`)

| Step | What you see | Time (motion s) |
|---|---|---|
| 1. Arrive | The truck drives in forward from the road, past its door, and stops | 8 |
| 2. Doors | The rear doors swing open, 270°, flat against the trailer's sides | 3 |
| 3. Back in | It reverses into the dock along a curve, tractor and trailer articulated at the fifth wheel, at walking pace, and stops at the bumpers | 10 |
| 4. Dock | The roller door rises; the dock lamp turns red (truck at the dock: do not drive off) | 3 |
| 5. Load | Pallets fill the trailer from the front, two by two, as `forklift-2` brings them: the number shown is the sim's own (22 pallets over `truckLoadS`, from `remainingS`) | sim |
| 6. Leave | The roller door comes down, the lamp turns green, the doors close, the truck pulls out and drives away | 3 + 8 |

- **Articulated:** the trailer's path is the curve; the tractor follows its kingpin, turned along the kingpin's direction of travel, never more than 0.6 rad off the trailer.
- **Fits the sim's time:** a truck has `remainingS ÷ speed` real seconds left at the dock; when that is less than the moves still to play, they play faster or are skipped, so a truck never stands at the dock after the sim has sent it away. A waiting truck (no stock yet) stands docked with its doors open and its trailer empty.
- **Docks:** each door's roller door rises while a truck is docked there and is down otherwise; a lamp beside each door, red while a truck is docked, green otherwise (the lamp colours of `lamps.ts`, glowing in the dark theme).
- Trucks waiting in the yard stand parked with their doors closed, as now.
- The apron may grow toward +z if the manoeuvre needs room (`src/scene/layout.ts`, `APRON`), as long as the overview still frames the plant.

## Contracts (`lead`, before the agents start)

Nothing in `src/contracts/` changes. The lanes share these names instead:

**Model nodes** (`assets` makes them, `scene` drives them; a model short of a node keeps the grey box, as `swapInHero` already does, and the grey box carries the same names):

| Model | Node | Parent | Origin (model frame, m) | Motion |
|---|---|---|---|---|
| `vehicles/truck.glb` | `tractor` | scene | the fifth wheel's kingpin, (0, 1.3, 3.7) | Turns about +y, ±0.6 rad: everything ahead of the trailer's landing legs that belongs to the tractor (cab, chassis, both tractor axles, tank, steps, exhaust) |
| | `door_left`, `door_right` | scene | the rear hinges on the posts' outer edges, (∓1.275, 1.3, −8.25) | Turn about +y from 0 (shut): `door_left` to **+3π/2**, `door_right` to **−3π/2** (open, folded flat against its own side; the other sign swings a door through the trailer). Left is −x. The open trailer shows its load space: floor at 1.3 m, walls at ±1.215 m, z −8.1 to 5.29 (`TRUCK_CARGO_M`) |
| `vehicles/forklift.glb` | `beacon` | scene | the beacon's foot on the guard, (0, 2.15, −0.95) | Its own material, `forklift_beacon` (amber, emissive), so the scene can flash it |
| | `forks`, `mast_inner` | scene | as now | as now |
| `hero/stretch-wrapper.glb` (new) | `turntable` | scene | (0, 0.125, 0), the turntable's centre | Turns about +y; its rollers line up with the pallet rollers at multiples of π, so it stops there |
| | `carriage` | scene | (−1.25, 0.45, −0.9), the carriage's foot on the mast | Slides along +y, 0 to 1.05 m; carries the film roll and its rollers. The film leaves from the exit roller, at (−1.191, −0.709) in the model frame at rest (`WRAPPER_FILM`) |

The stretch wrapper's machine origin is world (21.6, 0, 14.4), the turntable's centre (`WRAPPER_M`). Turntable radius 1.05 m, top flush with the pallet rollers at 0.25 m; mast at (−1.45, 0, −1.05), 2.7 m tall; the model stays below 3.0 m (the label at 3.1 m). The truck keeps its outer size and facing, so `fitVehicle` still fits it at scale 1; the truck may have at most 7 meshes, the forklift 5, the stretch wrapper 6.

**Debug state** (`window.__scene.equipmentState(id)` with `?debug`; `qa` writes against these keys; the lanes may add keys, not rename these):

| Id | Keys |
|---|---|
| `palletizer` | `stackFrac`, `armRad` (kept); `phase` (`'idle' \| 'toPick' \| 'pick' \| 'toPlace' \| 'place'`), `liftM`, `carrying` (boolean), `traysShown`, `layers` |
| `stretch-wrapper` | `wrapping`, `turnRad` (kept); `filmFrac` (0–1, the film's height on the load), `carriageM` |
| `pallet-conveyor` | `riding`, `wrapping` (kept); `queued` (pallets waiting before the wrapper) |
| `forklift-1`, `forklift-2` | `job` (`'parked' \| 'toPick' \| 'pick' \| 'toDrop' \| 'drop' \| 'home'`), `carrying` (boolean), `liftM`, `xM`, `zM`, `headingRad`, `beacon` (boolean, lit now) |
| `truck` | `shown`, `docked`, `doors`, `yard` (kept); `phases` (each door's: `'away' \| 'arriving' \| 'opening' \| 'reversing' \| 'docked' \| 'closing' \| 'leaving'`, comma-separated), `doorsOpen` (trucks with their rear doors open), `loaded` (pallets in each door's trailer, comma-separated, `-` for none) |
| `docks` | `doorsUp` (roller doors up), `lamps` (each door's: `'red' \| 'green'`, comma-separated) |

**Budgets** (`tests/scene/packsLine.test.ts`):

- The packs line's draw calls, shadow pass included: 150 → **185** (lane A at most +12, lane B at most +20, `assets`' extra meshes counted in lane B's), with grey boxes and with the kit.
- The packs line's own materials: 5 → **10** (lane A at most +2: the film and the film shell; lane B at most +3: a lit beacon, the dock lamps and one spare).
- The overview in the app stays under the 400 ceiling of `e2e/stages.spec.ts`, and `qa` reports it against 222 now. No new shadow-casting light; no per-frame allocation.

**Reduced motion:** these motions show what runs, as the grey-box motion does, so they stay on under `prefers-reduced-motion`; only decoration (the beacon's flash) may stop.

## Who does what

The agents' definitions are in `.claude/agents/`; `assets` is new in this phase. Each lane in wave 1 works in its own git worktree and commits there; `lead` merges in the order assets, lane A, lane B.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | This card, D22, the node and debug-state contracts above, the `assets` definition, the README and roadmap rows | `plan/`, `.claude/agents/`, `README.md` |
| 1 | `assets` | The truck split into trailer, `tractor` and the two rear doors; the forklift's `beacon`; the new stretch-wrapper hero (`make-heroes.mjs`) with `turntable` and `carriage`; the specs, the licences, the committed GLBs and their tests | `assets/` (scripts, specs, `LICENSES.md`), `public/models/vehicles/`, `public/models/hero/stretch-wrapper.glb` |
| 1 | `scene` · lane A (stage 8) | The palletizer's pick-and-place with its sub-joints in the grey box and the hero, the tray stack in layers, the fresh pallet; the stretch wrapper's cycle, film web and film shell, its hero swap (`HERO_MODELS.stretchWrapper`); one pallet on the turntable at a time, the wrapped look to quarantine | `src/scene/equipment/heroes.ts`, `src/scene/equipment/packs/` (new `palletizing.ts`, `stretchWrap.ts`; `palletTraffic.ts`), the stage 8 functions of `packsLine.ts`, `tests/scene/palletizing.test.ts` (new), the palletizer's tests in `packsLine.test.ts` |
| 1 | `scene` · lane B (stage 10) | The forklifts' jobs (put-away and loading), forks, mast, carried pallet, beacon, smooth turns; the trucks' arrival, doors, articulated reversing, loads, departure, fitted to the sim's time; the docks' roller doors and lamps | `src/scene/equipment/packs/` (new `forkliftJobs.ts`, `truckMoves.ts`; `vehicles.ts`), the stage 10 functions of `packsLine.ts`, `src/scene/layout.ts` (the apron only), `tests/scene/warehouseMotion.test.ts` (new), the vehicles' tests in `packsLine.test.ts` |
| 2 | `qa` | The full checks on the merged work; `e2e/motion.spec.ts` (new) against the debug-state keys; `e2e/smoke.spec.ts` with the fifth hero file; the overview's draw calls; screenshots of stages 8 and 10 at ×1 and ×10 in both themes | `e2e/` |
| 2 | `lead` | Review the screenshots and diffs, the perf baseline's new rows, this card's status | `plan/`, `tests/perf/baseline.md` |

The two `scene` lanes both touch `packsLine.ts`: lane A only its stage 8 functions (`palletizer`, `stretchWrapper`, `palletConveyor`) and lane B only its stage 10 ones (`docks`, `buildVehicle`, `forklift`, `trucks`); the factory list at the top changes only if a fixture's arguments do. New code goes in the new modules, so the merge stays small.

## Exit checklist

- [ ] `npm run check` and `npm run build` pass, with the budgets above.
- [ ] `tests/scene/palletizing.test.ts`: the arm goes through its four steps in order and picks only while a packer lane packs; the clamps close only with a tray in the gripper; the stack shows the sim's trays in layers of 12 and empties when a pallet closes; the wrapper turns only with a pallet on it, its film rises with the carriage and is whole by the top wraps; never two pallets on the turntable; the grey box and a stub hero with the node names move the same; nothing moves while paused.
- [ ] `tests/scene/warehouseMotion.test.ts`: forklift-1 puts away when stock rises, forklift-2 loads while a truck loads, each carries a pallet only between pick and drop, lifts only at low speed, and parks when idle; the inner mast at half the forks' lift; a truck arrives, opens its doors, reverses articulated within ±0.6 rad, docks, shows its load from `remainingS`, closes and leaves; at ×1,000 the moves fit the sim's time; the roller doors and lamps follow the docked trucks; a model short of a node keeps the grey box.
- [ ] `node --test assets/scripts/*.test.mjs`: the new nodes with their origins, the truck still 16.5 × 4.0 × 2.55 m at scale 1, the stretch wrapper within its envelope, the committed GLBs rebuilt byte for byte.
- [ ] `e2e/motion.spec.ts`: in the app with `?debug`, the palletizer goes through `pick` and `place` with `carrying` true between them; the wrapper's `filmFrac` rises to 1; a forklift carries a pallet; a truck reaches `docked` with `doorsOpen` ≥ 1, its door's roller door up and its lamp red; no console errors. The five hero files load (`e2e/smoke.spec.ts`).
- [ ] The overview's draw calls stay under 400 in the app; the new count is in `tests/perf/baseline.md`.
- [ ] Screenshots of stages 8 and 10 at ×1 and ×10, in both themes, reviewed.
- [ ] The developer watches stages 8 and 10 and judges the motion believable.

## Status

Planned on 1 November 2026. Wave 0 (`lead`) is done with this card; wave 1 starts next.
