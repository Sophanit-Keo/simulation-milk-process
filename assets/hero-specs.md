# Hero model specs

What the hero models must be so they can replace their grey boxes with no code change: the separator (stage 1), homogenizer (stage 3), aseptic filler (stage 7, used twice) and palletizer (stage 8), swapped in since phase 5, and the stretch wrapper (stage 8), added in phase 12 ([Stretch wrapper](#stretch-wrapper)). Owned by the `assets` agent ([agent plan](../plan/agent-plan/README.md)); the general rules, budgets and Blender export checklist are in [README.md](README.md).

The numbers come from the merged grey boxes in `src/scene/equipment/liquidLine.ts` and `packsLine.ts` (the code the heroes replace), checked against `uht-plant-preview.html`. The separator, homogenizer and palletizer match the preview exactly; the filler adds an outfeed hood and sealing jaws that the preview lacks.

| Hero | File | Machine id(s) | Stage | Moving nodes the code drives today |
|---|---|---|---|---|
| Separator | `public/models/hero/separator.glb` | `separator` | 1 | `bowl` |
| Homogenizer | `public/models/hero/homogenizer.glb` | `homogenizer` | 3 | `piston_1`, `piston_2`, `piston_3` |
| Aseptic filler | `public/models/hero/aseptic-filler.glb` | `filler-a`, `filler-b` | 7 | `reel`, `jaws` |
| Palletizer | `public/models/hero/palletizer.glb` | `palletizer` | 8 | `arm` and its sub-joints `arm_lift`, `arm_wrist`, `arm_clamp_1`, `arm_clamp_2` (phase 12); `arm_trolley` (phase 12, from this model on; the scene does not drive it yet, see [Phase 12: the palletizer's boom and trolley](#phase-12-the-palletizers-boom-and-trolley)) |
| Stretch wrapper | `public/models/hero/stretch-wrapper.glb` (phase 12) | `stretch-wrapper` | 8 | `turntable`, `carriage` (the grey box's carriage becomes a group in phase 12) |

## How the swap works, and what that requires

Each machine is a group (its "root") at the machine origin in the tables below, on the floor. Its grey parts and its moving nodes sit in that group, in metres relative to the origin. In phase 5 `scene` is to load the GLB into the same root, hide the grey parts, and drive the hero's nodes, found with `getObjectByName()`, instead of its own. The update code writes **absolute** values into some of those nodes (`piston_N.position.z`, `jaws.position.y`, `arm.rotation.y`), so:

1. **Origin = machine origin.** (0, 0, 0) is the point the table gives, at floor level, even where that is not the footprint centre. `glb-stats` will then warn "footprint centre is at …": that warning is expected for the separator, homogenizer, filler and palletizer. Check the bounds against this spec instead.
2. **Moving nodes are direct children of the GLB's scene** (sub-joints are children of their joint), and no node above them has a transform.
3. **Rest transform:** each moving node sits at the position this spec gives, with no rotation and scale 1. The geometry hangs under the node so that the node's origin is on its joint: on the spin axis, on the hinge, or on the slide axis.
4. **Axes:** +y up, product flows along +x, and **+z is the operator side, the side every stage camera looks from** (the cameras in `src/scene/layout.ts` all sit at +z and above).
5. **Size:** the outer bounds match the grey box within 5% (the envelope column). Stay below the machine's label anchor, where its floating label sits.
6. **Pipes:** `src/scene/pipes.ts` draws the product lines through each machine at the nozzle points given (pipe radius 0.11 m). Put a nozzle or flange of about 0.24 m outer diameter there; the casing hides the pipe inside.
7. **Picking:** every mesh in the model is clickable and selects the machine's stage, so add no invisible helper meshes, and no cameras, lights or animations (the README rules).

### Budgets (from README.md)

| | Per hero |
|---|---|
| Triangles | ≤ 30,000, counted as placed. Spend them where the stage camera looks: the moving parts and the +z face. |
| Meshes, materials | ≤ 20 meshes, ≤ 8 materials. Each mesh × material is a draw call, in the shadow pass too, so merge every static part into one mesh per material. **Aim for ≤ 10 draw calls**; the grey boxes have 3 to 8 meshes and make 5 (separator) to 12 (filler) draw calls, shadow pass included. |
| Textures | Base colour ≤ 2048², ORM (baked AO, roughness, metalness) and normal ≤ 1024², one UV map. |
| File | ≤ 2 MB after the phase-5 meshopt and KTX2 compression; uncompressed until then. |
| Glass | Only where the spec says glass (the filler's aseptic zone, an optional separator hood window): one alpha-blended material. |

## Separator

A disc-stack separator: frame and drive (motor behind, at −z), and the bowl, which must be seen to spin. Machine origin: world (−51.5, 0, −14), on the bowl's spin axis.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Frame | box 1.70 × 0.80 × 1.70 | (0, 0.40, 0) |
| Motor | box 0.80 × 0.80 × 1.00 | (0, 0.40, −1.55) |
| `bowl`: bowl body | 8-sided cylinder, radius 0.60, height 1.10 | (0, 0, 0) in `bowl` (y 0.80–1.90) |
| `bowl`: top cone | cone, radius 0.60 to 0.13, height 0.40 | (0, 0.75, 0) in `bowl` (y 1.90–2.30) |
| `bowl`: fin | box 0.12 × 0.90 × 0.16 | (0.56, 0, 0) in `bowl` |

- **Bounds:** x −0.85 to +0.85, y 0 to 2.30, z −2.05 to +0.85, so **1.70 × 2.30 × 2.90 m**. Envelope (5%): 1.79 × 2.42 × 3.05 m round the same origin.
- **Label anchor:** (0, 2.75, 0). Keep the model below 2.70 m.
- **Nozzles:** milk in at (−0.80, 1.20, 0) on the −x side; skim and cream out at (+0.80, 1.20, 0) on the +x side.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `bowl` | scene | (0, 1.35, 0) | Spins about its +y axis without limit | `bowl.rotation.y += ω·dt`, ω easing to 4 rad/s while milk flows through the separator and to 0 when it stops |

Design notes: everything that spins (bowl, disc stack, the top of the spindle) goes under `bowl`, and nothing else does. A closed real bowl hood would hide the spin, so leave the bowl's upper part exposed, or put it behind a glass window, and give it something that breaks its symmetry (bolts on the lid, a painted stripe, an outlet nozzle on its side) so the turn reads from the stage-1 camera.

## Homogenizer

A three-piston high-pressure pump: crankcase and motor (motor behind, at −z), three pistons stroking along z at the front, and the two stage gauges on top. Machine origin: world (−20.5, 0, −14), the centre of the base frame.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Base frame | box 2.50 × 0.20 × 1.50 | (0, 0.10, 0) |
| Crankcase | box 2.20 × 1.10 × 1.30 | (0, 0.75, 0) |
| Main motor | cylinder along x, radius 0.42, length 1.20 | (0, 0.55, −1.35) |
| Gauges (stage 1, stage 2) | cylinder along y, radius 0.13, height 0.06 | (−0.50, 1.34, 0.25) and (+0.40, 1.34, 0.25) |
| `piston_1`, `piston_2`, `piston_3` | cylinder along z, radius 0.09, length 0.55 | at their nodes |

- **Bounds:** x −1.25 to +1.25, y 0 to 1.37, z −1.77 to +1.175 at rest (+1.295 at full stroke), so **2.50 × 1.37 × 2.95 m**. Envelope (5%): x ±1.31, y 0 to 1.44, z −1.77 to **+1.32** (3.09 m deep; the pistons' full stroke must stay inside it).
- **Label anchor:** (0, 1.90, 0). Keep the model below 1.85 m.
- **Nozzles:** milk in at (−1.15, 0.70, 0) on the −x side, out at (+1.15, 0.90, 0) on the +x side.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `piston_1` | scene | (−0.60, 0.80, 0.90) | Slides along z, ±0.12 m about z = 0.90 | `piston_N.position.z = 0.90 + 0.12·sin(crank + (N−1)·2π/3)`; the crank turns at 7 rad/s × (flow / 16,000 L/h) |
| `piston_2` | scene | (0, 0.80, 0.90) | as above | as above |
| `piston_3` | scene | (+0.60, 0.80, 0.90) | as above | as above |

The code writes only `position.z`; x, y, rotation and scale stay as exported. Pistons are numbered left to right seen from the front (+z), that is, along +x.

Design notes: the pistons may be any length that keeps them attached through the whole stroke. A liquid end (pump block) at the front fits the envelope if its front face stays at z ≤ 1.32: for example a block from z 1.00 to 1.32 with pistons 0.70 long (−0.40 to +0.30 from their node), whose back ends stay inside the crankcase (z ≤ 0.65) and front ends inside the block at every point of the stroke. The homogenizing valve with its two gauges sits on top.

## Aseptic filler

A roll-fed aseptic filler: cabinet, the glass aseptic zone with the paper tube and sealing jaws, the paper reel on its side, and the outfeed where sealed packs leave onto the belt along +x. Machine origin: world (20, 0, −17.5) for filler A and (20, 0, −10.5) for filler B, the centre of the cabinet.

**One GLB for both.** Build filler A: reel on the −z side. Filler B is the same model mirrored front to back (scale z −1, which three.js renders correctly), so its reel faces +z. Because of the mirror, **nothing on the filler may carry readable text** (it would read backwards on B); use plain panels and symbols.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Cabinet | box 3.20 × 2.40 × 2.20 | (0, 1.20, 0) |
| Aseptic zone (glass) | box 2.00 × 1.10 × 1.60 | (0, 2.95, 0) |
| Paper tube, full of milk | cylinder along y, radius 0.13, height 1.00 | (−0.30, 2.95, 0) |
| Roof of the aseptic zone | box 2.10 × 0.06 × 1.70 | (0, 3.53, 0) |
| Outfeed hood | box 0.30 × 0.60 × 0.80 | (+1.75, 1.20, 0) |
| Reel spindle | cylinder along z, radius 0.08, length 0.20 | (−0.80, 1.00, −1.20) |
| `reel`: paper reel | cylinder along z, radius 0.78, width 0.34 | (0, 0, 0) in `reel` |
| `reel`: bar across it | box 1.20 × 0.10 × 0.36 | (0, 0, 0) in `reel` |
| `jaws`: two jaw bars | box 0.34 × 0.10 × 0.08 each | (0, 0, ±0.18) in `jaws` |

- **Bounds (filler A):** x −1.60 to +1.90, y 0 to 3.56, z −1.60 to +1.10 (the reel's bar reaches z −1.60), so **3.50 × 3.56 × 2.70 m** (filler B: z −1.10 to +1.60). Envelope (5%): 3.68 × 3.74 × 2.84 m.
- **Label anchor:** (0, 4.00, 0). Keep the model below 3.95 m.
- **Nozzles and belt:** product in at (−1.60, 0.55, 0) on the −x face; inside, the line rises into the bottom of the paper tube at (−0.30, 2.50, 0) (the tube spans y 2.45 to 3.45). Packs leave through an opening in the +x face under the hood, onto a belt whose surface is at y 0.86, 0.85 m wide and centred on z = 0.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `reel` | scene | (−0.80, 1.00, −1.42) | Turns about its +z axis (the reel's axle) without limit | `reel.rotation.z -= 0.9 rad/s × dt` while the filler runs (paper unwinds off the top) |
| `jaws` | scene | (−0.30, 2.60, 0) | Rides down 0.12 m along y and back | `jaws.position.y = 2.60 − 0.12·(0.5 − 0.5·cos φ)`, φ advancing 2.4 rad/s, about one stroke every 2.6 s |
| `jaw_1`, `jaw_2` | `jaws` | (0, 0, −0.18), (0, 0, +0.18) | Optional, for phase 5: close towards each other along z, 0 to 0.10 m each | Not driven yet; at rest they are open |

Design notes: the aseptic zone is the one glass part (alpha-blended), so the paper tube and the jaws show through it from the stage-7 camera. The reel is paper-coloured with a visible feature (a printed edge band, the hub's spokes) so its turn reads. Mirroring flips the reel to +z on filler B, the side the stage-7 camera sees.

## Palletizer

A column palletizer: a round base and column, a horizontal arm that swings on top of the column between the pick point (where the tray line ends) and the pallet being built, and a tray gripper that a trolley carries along the boom, on a lift rod. Machine origin: world (28.3, 0, 13.2), on the column's axis.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Base | cylinder, radius 0.55, height 0.60 | (0, 0.30, 0) |
| Column | cylinder, radius 0.22, height 1.70 | (0, 1.45, 0) |
| `arm`: boom | box 3.055 × 0.20 × 0.26 since phase 12 (`MAX_REACH_M + 0.1`; 2.45 m before) | (1.53, 0, 0) in `arm` |
| `arm_lift`: lift rod (`lift-rod`) | cylinder along y, radius 0.07, from the top of the gripper up to the boom's top (y +0.10 in `arm`), stretched every frame as the lift lowers | on the lift's axis |
| `arm_wrist`: gripper | box 0.55 × 0.12 × 0.45 | (0, −0.06, 0) in `arm_wrist` |

- **Bounds, arm at rest along +x** (grey box since phase 12): x −0.55 to +3.055, y 0 to 2.45, z −0.55 to +0.55, so **3.61 × 2.45 × 1.10 m**. Envelope (5%): x −0.64 to +3.145, height ≤ 2.57 m, z ±0.578. Swinging, the boom sweeps a disc of radius about 3.06 m round the column; keep the model's sweep inside 3.145 m.
- **Reach** (phase 12, `src/scene/equipment/packs/palletizing.ts`): the pick point is 2.53 m from the column (`PICK_REACH_M`); the 12 places of a layer are 1.89 to 2.955 m out (`MAX_REACH_M`). The lift stands out along the boom over each one, so the boom must run past 2.955 m with the trolley on it: its tip at least 3.055 m out.
- **Lift** (phase 12): down 0.605 m to a tray on the belt (surface at 0.86 m), 0.235 to 1.075 m onto the stack's top to bottom layer (an empty pallet's deck at 0.39 m).
- **Label anchor:** (0, 3.00, 0). Keep the model below 2.95 m.
- **Not part of the hero:** the pallet and the `stack` of trays at the place point belong to the fixture as tokens, and since phase 12 so do the lift rod above the gripper's mount (`lift-rod`) and the tray in the gripper (`carried-tray`), which the scene hangs on the model's `arm_lift` and `arm_wrist`. The model holds base, column, arm, trolley and gripper.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `arm` | scene | (0, 2.35, 0), the hinge on top of the column | Turns about +y. At rest it points along +x; it swings between 0.91 rad (52°, the pick point) and about 3.46 to 3.89 rad (the places on the pallet), the way round via −z | Phase 12: `arm.rotation.y = pose.armRad` (`palletizing.ts`) |
| `arm_trolley` (phase 12) | `arm` | (2.45, 0, 0), on the lift's axis at the boom's centre line | Slides along +x with the lift, about 1.89 to 2.955 m, riding the boom's rails; never down | **Not driven yet**: the scene is to write `arm_trolley.position.x = pose.reachM` (the same value as `arm_lift.position.x`). Until it does, the trolley stays at 2.45 m |
| `arm_lift` | `arm` | (2.45, 0, 0) | Slides along +x, about 1.89 to 2.955 m (`position.x = reachM`), and down along −y, 0 to about 1.1 m (`position.y = −liftM`), to take a tray off the belt (surface at 0.86 m) or set it on its place on the pallet | Phase 12: `arm_lift.position.set(pose.reachM, −pose.liftM, 0)` |
| `arm_wrist` | `arm_lift` | (0, −0.63, 0), the top of the gripper | Turns about +y so the tray stays square to the pallet: `rotation.y = −arm.rotation.y + tray angle` | Phase 12: `pose.wristRad` |
| `arm_clamp_1`, `arm_clamp_2` | `arm_wrist` | (0, −0.07, −0.225), (0, −0.07, +0.225) | Close towards each other along z, 0 to 0.10 m each, to grip a tray | Phase 12: `pose.clampM` |

Design notes: the gripper and clamps hang under `arm_lift`, so the boom stays put when it lowers. The trolley is a node of its own under `arm`, not under `arm_lift`: `arm_lift` also goes down, and the trolley must stay on the boom. The lift rod between the trolley and the gripper changes length with the lift (0.73 m with the gripper raised, 1.8 m at the bottom layer), more than a rigid rod could slide through the trolley under the 2.95 m limit, so the scene draws it stretched; the model's trolley takes its top end and the model's gripper mount its foot. At rest everything must look like the grey box: gripper raised, clamps open.

## Stretch wrapper

A turntable stretch wrapper in line on the pallet rollers, added in phase 12 ([phase card](../plan/agent-plan/phase-12-lifelike-motion.md)): a pallet rides on along +x and stops on the turntable, which turns while the film carriage climbs the mast and comes down again; then it rides off along +x. Machine origin: world (21.6, 0, 14.4) (`WRAPPER_M` in `src/scene/equipment/packs/layout.ts`), on the turntable's axis at the floor.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| `turntable`: disc | cylinder, radius 1.05, height 0.25 | (0, 0, 0) in `turntable` (y 0 to 0.25) |
| `turntable`: bar across it | box 1.89 × 0.01 × 0.12 | (0, 0.13, 0) in `turntable` |
| Mast foot | box 0.50 × 0.10 × 0.50 | (−1.45, 0.05, −1.05) |
| Mast | box 0.20 × 2.70 × 0.20 | (−1.45, 1.35, −1.05) |
| Carriage (a mesh in the grey box today) | box 0.32 × 0.22 × 0.50 | (−1.25, 0.60, −0.90) |

- **Bounds (grey box):** x −1.70 to +1.05, y 0 to 2.70, z −1.30 to +1.05, so **2.75 × 2.70 × 2.35 m**. Envelope (5%): x −1.769 to +1.119, y 0 to 2.835, z −1.359 to +1.109.
- **Turntable:** radius 1.05 m, its top flush with the pallet rollers either side at y 0.25 (`PALLET_ROLLER_TOP_M`).
- **Label anchor:** (−0.6, 3.1, −0.5). Keep the model below 3.0 m.
- **Pallet clearance:** a pallet is 1.2 m along x and 1.0 m along z, its load's top at 1.39 m. Riding through along x (z ±0.5 m, from the rollers' top up) and turning on the turntable (a circle of radius 0.79 m round the axis), it meets nothing but the turntable, at any carriage height.
- **No nozzles.** The film web and the film shell on the load are the scene's (phase 12, lane A), not the model's.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `turntable` | scene | (0, 0.125, 0), on the axis at the turntable's mid-height | Turns about +y without limit. Its roller deck runs across the line at rotation.y = kπ, so a pallet rides on and off along x when the turntable stops at a multiple of π ("square"); at an odd multiple of π/2 the rollers lie along the line | Phase 12: `turntable.rotation.y` advancing while a pallet is wrapped (24 rpm) |
| `carriage` | scene | (−1.25, 0.45, −0.9), the carriage's foot on the mast | Slides along +y, 0 to 1.05 m: `position.y` from 0.45 to 1.50. Carries the film roll, the two pre-stretch rollers and the exit roller | Phase 12: `carriage.position.y = 0.45 + carriageM` |

Where the film runs, in the `carriage` node's frame (its origin the carriage's foot, its axes the model's; add the node's position for the model frame). `make-heroes.mjs` exports these as `WRAPPER_FILM`:

| | Axis (x, z) | Radius | y in the node | Model frame at rest |
|---|---|---|---|---|
| Film roll | (0.194, 0.005) | 0.12 | 0.045 to 0.575 | axis at (−1.056, −0.895), y 0.495 to 1.025, 1.38 m from the turntable's axis |
| Exit roller, where the film leaves for the load | (0.059, 0.191) | 0.025 | 0.04 to 0.58 | axis at (−1.191, −0.709), y 0.49 to 1.03 |

The turntable turns the +y way, so the load's face nearest the carriage moves toward +z: the film runs off the exit roller on the operator side (+z) of the roll and meets the load at its tangent on that side.

Design notes: the mast and the carriage face the turntable's centre, turned −35.9° about +y (`WRAPPER_YAW_RAD`), as on a real in-line wrapper. With the card's 1.05 m of travel the roll spans y 0.495 to 1.025 at the bottom and 1.545 to 2.075 at the top, so it covers the load's top edge (1.39 m) only while `carriageM` is between 0.37 and 0.90 m; above 0.90 m the whole roll is over the load. Wrap the top turns in that range, or clamp the film band to the load.

## Export checklist (heroes)

The Blender checklist in [README.md](README.md#export-checklist-blender) applies, with these differences and additions:

1. Model at real size round the **machine origin** of this spec, not the footprint centre; product flows +x, the operator side (Blender Front, −Y) faces +z.
2. Name the moving nodes exactly as in the node tables (`a-z0-9_` only, unique, never the scene's name). In Blender: an Empty or the part's own object at the joint, transforms applied on the static mesh, and the moving object's origin on its joint with rotation 0 and scale 1.
3. Parent sub-joints under their joint and every top-level moving node directly under the scene root, with no transformed parent above it.
4. Merge every static part into one object per material.
5. One UV map, AO baked into the ORM texture (README, "Baked ambient occlusion").
6. Export to the file name in the first table; save the `.blend` in `assets/source/`.
7. Check it:
   - `node assets/scripts/glb-stats.mjs public/models/hero/<name>.glb --max-triangles 30000`: within budget; the node tree shows the moving nodes with their names unchanged; the bounds match this spec within 5% (the footprint-centre warning is expected).
   - `node assets/scripts/glb-load-check.mjs public/models/hero/<name>.glb --port 5507 --shots <dir>`: `OK`, and the render looks right.
8. Add a row to [LICENSES.md](LICENSES.md) (own work).

## Schedule

| Phase | Hero work (`assets`) |
|---|---|
| 2 | This spec. |
| 3 | Block-outs: the bounds, the named nodes at their rest positions, no detail. `scene` can test the swap with them. Done: see [Phase 3 block-outs](#phase-3-block-outs). |
| 4 | First-pass GLBs with materials. |
| 5 | Final models, baked AO, compression; `scene` swaps them in. Done: see [Phase 5 final models](#phase-5-final-models). |

## Phase 3 block-outs

`assets/scripts/make-heroes.mjs` builds all four from boxes, cylinders and cones with three.js and writes them with GLTFExporter to `public/models/hero/`, the same way `make-vehicles.mjs` makes the truck and forklift (no Blender, no new packages, same bytes on every run). Each is built round its machine origin with +y up, product along +x and the operator side at +z. Static parts are merged into one mesh per material. Every moving node is one mesh of its own, named as in the tables above, at its rest position with no rotation and scale 1, and its geometry hangs so that the node's origin is on its joint. There are no textures: two vertex-coloured materials per model (`<model>_paint`, satin, and `<model>_matte`) in plain greys, plus `aseptic_filler_glass` (alpha-blended) for the aseptic zone. Nothing carries text or a brand mark.

| File | Bounds, x / y / z (m) | Against the grey box | Triangles | Meshes (draw calls), materials | Nodes |
|---|---|---|---|---|---|
| `separator.glb`, 122.5 KB | −0.85…0.85 / 0…2.30 / −2.05…0.85 | Same | 1,944 | 3, 2 | `bowl` |
| `homogenizer.glb`, 149.0 KB | −1.25…1.25 / 0…1.368 / −1.77…1.32 | z +0.145 m at the front, all at rest: the liquid end (z 1.06 to 1.32) that the design notes allow; 3.09 m deep, inside the envelope | 2,328 | 5, 2 | `piston_1`, `piston_2`, `piston_3` |
| `aseptic-filler.glb`, 79.7 KB | −1.63…1.90 / 0…3.56 / −1.60…1.135 | x −0.03 m (the product-in flange, proud of the −x face) and z +0.035 m (the control panel on the +z face) | 1,116 | 7, 3 | `reel`, `jaws` > `jaw_1`, `jaw_2` |
| `palletizer.glb`, 67.4 KB (phase 3; [phase 12](#phase-12-the-palletizers-boom-and-trolley) lengthened the boom) | −0.55…2.725 / 0…2.45 / −0.55…0.55 | Same | 964 | 7, 2 | `arm` > `arm_lift` > `arm_wrist` > `arm_clamp_1`, `arm_clamp_2` (and `arm_trolley` under `arm` since phase 12) |

Block-out notes, by model:

- **Separator.** A frame hood (radius 0.72 m, up to y 1.38) hides the lower half of the bowl. Above it the bowl shows its lock ring, eight bolts, the top cone, the fin from the grey box, a dark stripe opposite the fin and an outlet stub, so a turn reads from the stage-1 camera. The two nozzles end in flanges at x ±0.85 m.
- **Homogenizer.** The liquid end is kept low (y 0.66 to 0.94, valve covers to 0.98) so the stage-3 camera, about 30° above the floor, sees the three pistons across the gap between it and the crankcase (z 0.65 to 1.06). Each piston is 0.70 m long (z −0.40 to +0.30 from its node), with a dark collar that stays in that gap all stroke. At ±0.12 m its back end stays inside the crankcase and its front end inside the liquid end. The two gauges sit on the top cover at the spec's points.
- **Aseptic filler.** The outfeed hood is open below and at the front: packs on the belt (y 0.86, 0.85 m wide) pass under it into a dark opening in the +x face. The paper tube, its forming ring and the jaws show through the glass. The reel has a hub, the grey box's bar and a splice mark on both faces, so its turn reads on filler B, the mirrored copy.
- **Palletizer** (until phase 12, which replaced the head with a trolley on a longer boom: [below](#phase-12-the-palletizers-boom-and-trolley)). The arm is a turntable hub on the column axis, the boom, and a head that guides the lift rod. `arm_lift` is the rod (y −0.63 to +0.10 from the node, its top hidden in the head). `arm_wrist` is the gripper's rotary unit, frame and rails, and the clamps are plates on the gripper's z faces, open at rest. The arm reaches 2.734 m from the column axis, inside the 2.87 m allowed.

`make-heroes.test.mjs` (part of `npm run test:assets`) checks each GLB: size within 5% of the grey box and inside the envelope, on the floor, under the label; every node at its rest position under the right parent with no rotation and scale 1; the budget, with the footprint-centre warning as the only one allowed and glass on the filler only; a flange about 0.24 m across at every nozzle; that the moving parts are visible from their stage camera; and that the parts stay on their joints and inside their envelopes through their travel (bowl turns, piston stroke, reel turns, jaws down and closed, filler B mirrored, the arm from pick to place, the lift lowered 1.2 m, the clamps closed). It also checks that a rerun gives the same bytes as the committed files.

### Fit check in the scene (2026-10-18)

How: a throwaway page (not committed) served by the Vite dev server built the liquid line and the packs line with the app's own `createEquipmentHost`, `liquidLine` and `packsLine`, at the app's layout positions. For each machine it loaded the hero GLB into the machine's root group (filler B with scale z −1), copied each grey node's driven value onto the hero node of the same name (the bowl's and arm's `rotation.y`, the pistons' `position.z`, the reel's `rotation.z`, the jaws' `position.y`), and rendered three views from the stage camera (`STAGE_VIEWS`) and from close by: the grey box, the hero in its place, and the hero with the grey box drawn over it as a red wireframe. Chromium with `--enable-unsafe-swiftshader`, three r186, no console errors.

Result: every hero sits on its grey box. Bounds measured in the machine root's frame from the vertices (the palletizer's arm at rest, the pallet and stack left out):

| Machine | Grey box (m) | Hero (m) |
|---|---|---|
| `separator` | −0.85…0.85 / 0…2.30 / −2.05…0.85 | the same |
| `homogenizer` | −1.25…1.25 / 0…1.37 / −1.77…1.175 | −1.25…1.25 / 0…1.368 / −1.77…1.32 |
| `filler-a` | −1.60…1.90 / 0…3.56 / −1.60…1.10 | −1.63…1.90 / 0…3.56 / −1.60…1.135 |
| `filler-b` (mirrored) | −1.60…1.90 / 0…3.56 / −1.10…1.60 | −1.63…1.90 / 0…3.56 / −1.135…1.60 |
| `palletizer` | −0.55…2.725 / 0…2.45 / −0.55…0.55 | the same |

The nozzles meet the pipes, the outfeed hood meets the pack belt, filler B's reel faces the stage-7 camera, and with the grey arm's angle copied the hero arm lies on the grey one at the pick point. The first homogenizer had a liquid end up to y 1.05 with valve actuators on it, which hid the pistons from the stage-3 camera; it was lowered (above), and a test now checks the view.

Screenshots (hero with the grey box as a red wireframe, from close by; and the homogenizer from its stage camera): [separator](screenshots/separator-fit.jpg), [homogenizer](screenshots/homogenizer-fit.jpg), [homogenizer, stage 3](screenshots/homogenizer-stage-3.png), [both fillers](screenshots/aseptic-filler-fit.jpg), [palletizer](screenshots/palletizer-fit.jpg).

### What `scene` needs for the swap (phase 5)

**Phase 5:** the swap is the default; `?greybox` in the URL keeps the grey boxes (for comparison, or on a machine where the models are too heavy). **Phase 4:** done behind a flag. With `?heroes` in the URL, `src/scene/equipment/heroes.ts` follows steps 1–4 below: it loads each model into its machine's root (filler B mirrored), hides the grey parts it replaces and keeps the ones it leaves out (the homogenizer's needles, the palletizer's pallet and load), points the update code at the model's `bowl`, `piston_1` to `piston_3`, `reel`, `jaws` and `arm`, and turns shadows on for every mesh but the glass. A model that lacks one of those nodes is left out with a console warning, and the grey box stays. Without the flag nothing loads, so the grey boxes stay the default until phase 5 makes the swap permanent. `tests/scene/heroes.test.ts` checks the swap, and `e2e/smoke.spec.ts` that the four files load in the app without errors.

1. **Load and place.** `ctx.loadModel('hero/<file>')` into the machine's root group, as is: no offset, rotation or scale, except filler B, which takes `scale.z = -1`. The second filler should be a clone of the first load (`loadModel` already returns clones of one load).
2. **Hide the grey parts and drop their node names.** With the grey box and the hero both in the root, `root.getObjectByName('bowl')` (and `piston_N`, `reel`, `jaws`, `arm`) finds the **grey** node first, because the grey children come first. Either remove the grey parts from the root or look the nodes up in the loaded scene (`hero.getObjectByName(...)`), then point the existing update code at those nodes. The update code then works unchanged: it writes only `bowl.rotation.y`, `piston_N.position.z`, `reel.rotation.z`, `jaws.position.y` and `arm.rotation.y`.
3. **Picking and shadows.** Picking (`src/scene/picking.ts`) walks up from the mesh hit to the machine's object and skips hidden parts, so hero meshes inside the root select their stage with no change. GLTFLoader leaves `castShadow` off: set it on the hero's meshes (the static `body_*` meshes and the moving nodes; the filler's `body_glass` should not cast).
4. **Glass.** `aseptic_filler_glass` loads as transparent with `depthWrite` off (glTF `BLEND`), like the scene's own `glass` material.
5. **Materials and theme.** The heroes bring their own materials, so the theme does not re-colour them (the grey `steel` and `steelDark` darken in the dark theme). If they look too bright on the dark floor, phase 5 can swap `<model>_paint` for a themed material.
6. **Draw calls.** The heroes make 3 (separator), 5 (homogenizer), 7 (each filler) and 7 (palletizer; 8 since phase 12) draw calls per pass, against 5 to 12 for the grey boxes, shadow pass included.

Not done in the block-outs, for phase 4 and 5:

- `arm_lift`'s rod is 0.73 m long and its top is hidden in the boom's head, so it stays in the head only for the first 0.20 m of lift. Lowering the full 1.20 m needs a telescopic rod (a second node under `arm_lift`) or a longer rod above the boom, which would break the 2.57 m height limit. Phase 12: the scene draws the rod stretched from the gripper to the boom, and the model's trolley takes its top end ([below](#phase-12-the-palletizers-boom-and-trolley)).
- `jaw_1` and `jaw_2`, and `arm_wrist` and the clamps, are in place but not driven yet.
- No textures, UVs or `.blend` sources: the models come from the script. Phase 5 bakes their AO into the vertex colours instead (below).

## Phase 5 final models

The block-outs above, finished in the same script for the swap: every box face cut into a grid and every cylinder into rings of 0.2 m or less, the AO baked into the vertex colours, and the geometry meshopt-compressed (README, [Baked ambient occlusion](README.md#baked-ambient-occlusion-heroes) and [Compression](README.md#compression-phase-5)). Shapes, sizes, materials, node names and rest transforms are the block-outs', so everything in [Phase 3 block-outs](#phase-3-block-outs) still holds; only the triangle counts and file sizes change.

| File | Triangles (block-out) | Vertices | Meshes (draw calls), materials | Size, compressed (uncompressed) |
|---|---|---|---|---|
| `separator.glb` | 4,592 (1,944) | 4,709 | 3, 2 | 82.7 KB (195.9 KB) |
| `homogenizer.glb` | 5,060 (2,328) | 5,439 | 5, 2 | 97.3 KB (226.5 KB) |
| `aseptic-filler.glb` | 6,252 (1,116) | 5,174 | 7, 3 | 79.7 KB (220.5 KB) |
| `palletizer.glb` (phase 12: boom to 3.13 m and the trolley, [below](#phase-12-the-palletizers-boom-and-trolley)) | 3,020; 2,048 before phase 12 (964) | 3,708; 2,254 before | 8, 2; 7, 2 before | 69.1 KB (156.8 KB); 42.7 KB (98.9 KB) before |
| `stretch-wrapper.glb` (phase 12, made final, no block-out) | 3,108 | 4,154 | 4, 2 | 82.2 KB (168.9 KB) |

All four are within the budgets: at most 6,252 of 30,000 triangles, 7 of 20 meshes (under the 10 draw calls aimed for), 3 of 8 materials, and 97 KB of 2 MB. With the filler drawn twice the heroes come to 24,204 triangles a pass, 16,736 more than the block-outs (7,468), and the shadow pass draws them again. The first cut, 0.12 m cells, gave 49,964 a pass and took the overview to 280,986 triangles a frame, close to the 300,000 the README plans for; at 0.2 m the stage cameras show the same shading, since the AO varies over 0.4 m, for half the triangles ([perf baseline](../tests/perf/baseline.md#phase-5-hero-models)).

What the AO shows: contact shading where the cabinets, crankcase and frames stand on their plinths and where those meet the floor, under the filler's control panel and outfeed hood, between the homogenizer's tie rods and in the gap round its pistons, under the separator's hood rim and in the corners of the palletizer's base. The moving parts shade only themselves (the bowl's lock ring and bolts, the reel's hub and bar), so the spin, stroke and swing leave no shadow behind.

**Deviations from the plan**, for `lead`: the AO is per vertex, not a 1024² ORM texture, because the models have no UVs; and there is no KTX2 step, because they have no textures. A Blender hero would follow the README's texture bake and the Blender checklist instead.

`glb-load-check` loads all four in Chromium with three's meshopt decoder: OK, no console errors. `make-heroes.test.mjs` also checks the bake (darker in corners and at the floor, never by more than 85%, open faces nearly untouched, no shade cast between bodies) and that the compressed files decode to exactly what the script built.

## Phase 12: the stretch wrapper model

`buildStretchWrapper()` in `make-heroes.mjs` makes it the way the phase-5 models are made (faces cut for the AO, AO baked into the vertex colours, meshopt-compressed, two vertex-coloured materials `stretch_wrapper_paint` and `stretch_wrapper_matte`, plain greys), to the [spec above](#stretch-wrapper):

- **Static (`body_paint`, `body_matte`):** a low round base (radius 0.98 m, 0.0625 m high) under the turntable; the mast, turned to face the turntable: a 0.40 m foot plate with four bolts, a base collar, the 0.22 m square column with a dark guide strip on its front face, a top cap at 2.70 m, the lift motor at the back of its foot, a control box (screen, three buttons, a stop button) on its operator side at 0.95 to 1.45 m, and a base frame from the foot to the turntable's base, under the turntable's rim.
- **`turntable`:** a disc of radius 1.05 m (y 0.08 to 0.16) and on it a roller deck: 12 rollers of 0.08 m across the line, 0.13 m apart, between two side frames, their tops at y 0.25. A dark plate on the disc's +z side (at rest) breaks the deck's half-turn symmetry, so the turn shows. The rollers are not cut into rings: in a deck of like rollers the shade does not change along a roller.
- **`carriage`:** guide shoes on the mast's front face and corners, a housing over the pre-stretch gearing with its motor on top, frame plates over and under the film roll (y 0 to 0.03 and 0.59 to 0.62 in the node), the film roll on its two chucks, the two rubber pre-stretch rollers and the steel exit roller on the operator side, and a photocell on the top plate. It is 0.69 m tall (y 0.45 to 1.14 at rest, 1.50 to 2.19 at the top).

| | Bounds, x / y / z (m) | Against the grey box |
|---|---|---|
| At rest | −1.752…1.05 / 0…2.70 / −1.329…1.05, so 2.80 × 2.70 × 2.38 m | +1.9% in x (the lift motor and control box behind the mast), +1.2% in z (the mast's foot plate), inside the envelope |
| Carriage at the top | the same; the carriage's top at 2.19 m | Under the mast's top (2.70) and the label (3.0) |

Clearances: above the rollers' top nothing but the turntable comes nearer the axis than 1.24 m (the carriage's front plates), 0.45 m outside the turning pallet; and nothing reaches further toward the pallet's path than z −0.611, 0.11 m clear of its side. The turntable's base stands 1.75 cm under its disc, the base frame 2 cm, and the carriage's shoes 1 to 2 cm off the column, its strip and the control box, so nothing touches at any angle or height. `make-heroes.test.mjs` checks all of it at carriage heights 0, 0.525 and 1.05 m and at eight turntable angles.

### What `scene` needs for the swap (phase 12, lane A)

1. `HERO_MODELS.stretchWrapper = 'hero/stretch-wrapper.glb'` and `swapInHero(ctx, root, { path, nodes: ['turntable', 'carriage'] }, …)`, the model loaded into the wrapper's root at (21.6, 0, 14.4) as it is.
2. The grey box's `carriage` is a mesh centred at (−1.25, 0.6, −0.9) today; to drive the same `position.y` as the hero it becomes a group named `carriage` at (−1.25, 0.45, −0.9) with the grey box hung 0.15 m above it. Its `turntable` group already sits at (0, 0.125, 0).
3. The film web and the film shell stay the scene's, outside the model (keep them in `swap.keep` if they are children of the root). Take the web's start from `WRAPPER_FILM.exit` above, plus the carriage's position.
4. 4 draw calls per pass (2 static, 2 moving), against the grey box's 5 parts; both materials opaque, so every mesh casts a shadow.

## Phase 12: the palletizer's boom and trolley

Phase 12's scene (lane A) stands `arm_lift` out along the boom over each tray's place, 1.89 to 2.955 m from the column, as well as down, up to 1.075 m (the [node table](#palletizer)). The phase-3 boom ended at 2.57 m, so at the far places the gripper stood past its end, and the model's 0.73 m lift rod left the gripper hanging under nothing once it was down more than about 0.2 m. `buildPalletizer()` now makes, round the same origin and with the same nodes at the same rest transforms:

- **Boom (in `arm`, `PALLETIZER_BOOM`):** closed from the hub to 1.55 m, then two beams with a 0.17 m slot between them for the lift rod, out to an end plate at **3.13 m** from the column (0.175 m past the farthest place; the grey boom is 3.055 m). A steel guide rail on each beam (1.59 to 3.09 m) with a rubber end stop at each end, and a rack on the +z side. 0.30 m wide (z ±0.15, the end plate ±0.16), 0.20 m tall as before, the rails and stops 2 to 3 cm above it.
- **Trolley (new node `arm_trolley` under `arm`, rest (2.45, 0, 0)):** it straddles the boom, 0.27 m long: a carriage plate on four guide blocks over the rails (2 mm clear of them), skirts down both sides 1 cm off the beams, a yoke under the beams with the guide bush the rod runs through (radius 0.095, 0.15 m tall, with a wiper ring), a bearing cap on top, and a drive on each side (gearbox and motor, across the boom; the +z one faces the stage camera). It spans y −0.31 to +0.20 from the boom's centre line, so the model's top is at 2.55 m.
- **Gripper mount (`arm_lift`):** the rod's foot clamp on the gripper (radius 0.08, 5 cm) and the rod itself (radius 0.06) from the gripper up into the trolley as it stands at rest, 1 cm short of the boom's top. `arm_wrist` and the clamps are unchanged.

**The rod (option a).** The rod that shows is the scene's `lift-rod` (`PALLETIZER_LIFT_ROD`: radius 0.07, 12 sides, from the top of the gripper to 0.10 m over the boom's centre line, stretched every frame), as the pallet and the stack are the scene's. A rod of the model's own cannot do it: with the gripper raised a rigid rod would have to stand 1.1 m above the boom (to 3.5 m, over the 2.95 m limit), and a telescopic one needs a middle stage moving at half the lift, a node the scene would have to drive. The model's own rod is 1 cm thinner than the scene's and always inside its length, so in the scene it never shows; it is there so the model reads whole on its own at rest. The scene's rod runs through the slot 1.5 cm clear of the beams, into the guide bush, and ends under the carriage plate, inside the trolley, at every reach and lift.

**Why `arm_trolley` is a node of its own, and what it needs.** The trolley must follow the lift along the boom but not down it. Under `arm_lift` it would drop up to 1.1 m below the boom with every pick and place, so it hangs under `arm`, and the scene has to move it: `arm_trolley.position.x = pose.reachM`, the value it already writes into `arm_lift.position.x`. Until it does, the trolley stays at its rest place, 2.45 m out: at the pick point (2.53 m) the rod comes up 8 cm off the bush, and at the far places it comes up through the slot up to 0.56 m from the trolley. That is still better than before (the rod now always meets the boom), but it is not right; see the scene change below.

| | Before (phase 3 to 12) | Now |
|---|---|---|
| Bounds, arm at rest (m) | −0.55…2.725 / 0…2.45 / −0.55…0.55, 3.28 × 2.45 × 1.10 | −0.55…3.13 / 0…2.55 / −0.55…0.55, **3.68 × 2.55 × 1.10**: against the grey box (3.61 × 2.45 × 1.10) +2.1% in x, +4.1% in y; inside the envelope (x ≤ 3.145, y ≤ 2.57) |
| Reach, swinging | 2.734 m | 3.134 m (the end plate's corners) |
| Triangles, vertices | 2,048, 2,254 | 3,020, 3,708 (+972: the arm, hub and boom, 688 (was 396); the trolley 616 (new); the gripper mount 224 (was 160)) |
| Meshes (draw calls), materials | 7, 2 | 8, 2 |
| File, compressed (uncompressed) | 42.7 KB (98.9 KB) | 69.1 KB (156.8 KB) |

`make-heroes.test.mjs` checks: the boom's tip at least 0.1 m past the farthest place (`PALLETIZER_TRAVEL`, worked out from the scene's layout as `palletizing.ts` does); the trolley under `arm`, not `arm_lift`, on the rod's axis, and staying put when the lift lowers; and at reaches 1.89, 2.45, 2.53 and 2.955 m and lifts 0, 0.605, 1.075 and 1.2 m, with the trolley moved as the scene is to move it: the trolley, the gripper and the scene's rod never touch the boom, the guide blocks stay between the end stops, the rod's top end is inside the trolley seen from above, from both sides and from the stage-8 camera, the rod runs into the guide bush, the scene's rod (not the model's) shows between the bush and the gripper, and nothing rises above 2.57 m (under the 2.95 m limit). `glb-load-check` loads it with no errors. Screenshot, with a stand-in for the scene's rod and a tray in the gripper: [at rest, and at the farthest place's bottom layer](screenshots/palletizer-trolley.png).

### What `scene` needs (phase 12, lane A follow-up)

1. **Drive the trolley.** In `palletizer()` (`src/scene/equipment/packsLine.ts`): a grey group `arm_trolley` under `arm` at `ARM_LIFT_AT_M` (a small box on it if the grey box should show one), `trolley` in `ArmJoints`, `'arm_trolley'` in the swap's `nodes`, `trolley: nodes.arm_trolley` in the swap callback, and in `applyPose()` `joints.trolley.position.x = pose.reachM`. In `tests/scene/heroes.test.ts` and `palletizing.test.ts`, the stand-in models' palletizer node lists gain `arm_trolley`.
2. **Keep the rod.** `lift-rod` stays as it is (radius 0.07, from the top of the gripper to `BOOM_TOP_M`, hung on the model's `arm_lift`); the trolley is built round it. Do not thicken it past 0.08 m: the slot is 0.085 m each side of the axis.
3. **Nothing else:** the rest transforms, the node names the scene already drives and the 2.45 m rest reach are unchanged. The grey boom can stay 3.055 m long. 8 draw calls per pass, both materials opaque.

## Phase 16: the yogurt line's heroes (specs for phase 20)

The yogurt wing's grey boxes stand since phase 16 ([phase card](../plan/agent-plan/phase-16-yogurt-grey-box.md), [plan 12](../plan/12-yogurt-line.md)); phase 20 swaps in these models. Specs only for now: no model is made in phase 16. The positions come from `src/scene/equipment/yogurt/layout.ts` and the grey boxes from `src/scene/equipment/yogurtLine.ts`; the general rules above ("How the swap works", the budgets, the export checklist) all apply. Axes as everywhere: +x along the flow, +y up, **+z toward the stage cameras**, which for the wing look north (−z) from the aisle between the wing and the milk row.

| Hero | File | Machine id(s) | Stage | Moving nodes the scene will drive |
|---|---|---|---|---|
| Line P8 cup filler | `public/models/hero/p8-filler.glb` | `p8-filler` | 15 | `carrier`, `pistons`, `seal_heads`, `foil_pick`, `hood` |
| Fermentation tank | `public/models/hero/ferment-tank.glb` | `ferment-tank-1`, `-2`, `-3` | 13 | `agitator` |
| 125 g cup with its foil lid | `public/models/tokens/cup-125g.glb` | (instanced tokens, phase 18) | 15–16 | none |
| 24-cup tray | `public/models/tokens/tray-24-cups.glb` | (instanced tokens, phase 19) | 16 | none |
| Reefer unit | `public/models/vehicles/reefer-unit.glb` | (on the truck at the reefer dock, phase 19) | 16 | `fan` |

### Line P8 cup filler

A linear cup filler, 12 lanes across, product flowing along +x under a clear HEPA hood: de-nester and cup magazines, ionized air and UV-C, piston fillers, foil pick and sealing heads, coder, then out at +x to the check gates (SOP Part 2). Machine origin: world (6.5, 0, −47), the footprint centre on the floor.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Machine body | box 10.0 × 0.95 × 1.20 | (0, 0.475, 0) |
| Carrier chain | box 10.0 × 0.08 × 1.30 | (0, 0.99, 0) |
| Cup magazines | 4 boxes 0.30 × 0.80 × 0.90 | x −4.20, −3.75, −3.30, −2.85; y 1.40 |
| Piston manifold | box 1.20 × 0.60 × 0.90 | (1.20, 1.30, 0) |
| Foil magazines and sealing heads | box 0.90 × 0.70 × 0.90 | (2.80, 1.35, 0) |
| HEPA hood (glass) | box 10.20 × 1.35 × 1.60 | (0, 1.625, 0) |
| Filter housing | box 9.00 × 0.30 × 1.20 | (0, 2.45, 0) |

- **Bounds:** x −5.10 to +5.10, y 0 to 2.60, z −0.80 to +0.80, so **10.2 × 2.6 × 1.6 m**. Envelope (5%): 10.71 × 2.73 × 1.68 m.
- **Label anchor:** (0, 3.10, 0). Keep the model below 3.0 m.
- **Nozzle:** the product from the P8 buffer at (−5.00, 0.70, 0), on the −x end (pipe radius 0.08 m: a flange of about 0.18 m).
- **Glass:** the hood only, one alpha-blended material, so the carrier, the pistons and the sealing heads show from the stage-15 camera.
- **Cups:** phase 18 rides the cup tokens on the carrier: 12 lanes at 0.09 m pitch across z (−0.495 to +0.495), the cup rims at y 1.09 (the carrier's top 1.03 plus a 0.06 m cup). Leave that band clear under the hood.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `carrier` | scene | (0, 0.99, 0) | Indexes along +x by one pitch (0.10 m) per cycle, then returns to rest unseen (the chain's links repeat at the pitch) | Phase 18: `carrier.position.x` = the cycle's share of a pitch, at 30 cycles a minute |
| `pistons` | scene | (1.20, 1.55, 0), the heads' top | Stroke along −y, 0 to 0.12 m, once a cycle; the 12 anti-drip nozzles hang below the node | Phase 18: `pistons.position.y = 1.55 − strokeM` |
| `seal_heads` | scene | (2.80, 1.65, 0) | Down 0.10 m, dwell 1.0 s (the seal time), up, once a cycle | Phase 18: `seal_heads.position.y` |
| `foil_pick` | scene | (2.20, 1.60, 0), its arm's pivot | Swings about +z between the foil magazine (0 rad) and the cups (−0.6 rad) once a cycle | Phase 18: `foil_pick.rotation.z` |
| `hood` | scene | (0, 1.625, 0) | Static; a node of its own so the scene can tint its glass by the HEPA pressure (green at or above +15 Pa, red below) | Phase 18: its material's emissive |

Design notes: the stations in order along +x as the SOP has them: de-nester under the magazines (x −4.5 to −2.5), ionized air and vacuum shroud (−2.3), UV-C tunnel (−1.6 to −0.4, a violet glow strip the scene may light), pistons (+1.2), foil pick (+2.2), sealing heads (+2.8), coder (+4.0, a small head on the +z side). Budget: ≤ 30,000 triangles and **≤ 10 draw calls** with the glass.

### Fermentation tank

An insulated, cone-bottomed process tank of 10,000 L (D26) on four legs, with a top-mounted slow agitator; the same model three times. Machine origin: world (x, 0, −48.5) for x −24, −20 and −16, on the tank's axis at the floor.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Legs | 4 cylinders, radius 0.07, 1.20 tall, on a circle of radius 1.01 (the first at 0.4 rad) | y 0.60 |
| Cone bottom | cone, radius 1.40 to 0.31, 0.50 tall | (0, 0.95, 0) |
| Body (insulated shell) | cylinder, radius 1.40, 2.60 tall | (0, 2.50, 0) |
| Dome | half sphere, radius 1.40, 0.40 tall | from y 3.80 |
| Agitator drive | box 0.40 × 0.44 × 0.40 | (0, 4.42, 0) |

- **Bounds:** x −1.40 to +1.40, y 0 to 4.64, z −1.40 to +1.40, so **2.8 × 4.64 × 2.8 m**.
- **Label anchor:** (0, 5.14, 0). Keep the model below 5.0 m.
- **Level gauge:** the scene draws it, down the +z face at z +1.42 from y 1.30 to 3.70, 0.10 m wide. Keep that strip of the shell plain.
- **Nozzles:** the inoculated mix in at (0, 1.40, +1.40) on the +z face; out at the cone's tip, (0, 0.60, 0), to the manifold at −z.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `agitator` | scene | (0, 4.20, 0), on the shaft's axis at the dome's top | Turns about +y without limit, slowly (a low-shear anchor stirrer). Holds the shaft coupling above the dome, so the turn shows outside, and the stirrer inside, seen through a manway sight glass on the +z face at y 3.2 | Phase 17: `agitator.rotation.y += ω·dt` while the tank fills or ferments |

Design notes: stainless cladding over the insulation, a manway on the dome, a pH probe port on the +z side at y 1.8 (its label shows the pH since phase 15). Budget: ≤ 15,000 triangles and ≤ 6 draw calls: there are three.

### 125 g cup and 24-cup tray

Instanced tokens: thousands at once (phase 18 and 19), so they are tiny.

| Token | Size (m) | Origin | Budget | Materials |
|---|---|---|---|---|
| `cup-125g` | rim Ø 0.075, base Ø 0.055, 0.060 tall; foil lid 0.078 square with a tab | the base's centre, on the floor of the carrier pocket | ≤ 80 triangles | vertex colours: white cup, metallic foil (one material) |
| `tray-24-cups` | 0.470 × 0.320 × 0.065 (6 × 4 cups at 0.078 pitch in a 0.040-tall card tray) | the tray's bottom centre | ≤ 800 triangles, the cups merged in | vertex colours, one material |

### Reefer unit

The refrigeration unit on the front wall of the articulated truck's trailer (`public/models/vehicles/truck.glb`, whose root is the trailer), for the reefer trucks at the cold store's north dock (phase 19). Origin: on the trailer's centre line at its front wall, model frame of the truck: (0, 0, 5.35).

- **Size:** 2.20 wide (x) × 1.70 tall (y 2.20 to 3.90) × 0.45 deep (z 5.35 to 5.80).
- **Clearance:** the tractor turns about its kingpin up to its limit (make-vehicles.mjs); the unit must clear the cab's back wall and roof deflector at every angle. Check it with `assets/scripts/clearance.mjs` as the forklift's mast was (phase 14).
- **Node:** `fan`, the condenser fan behind the front grille, rest (0, 3.30, 5.70), turning about +z while the unit runs.
- **Budget:** ≤ 2,000 triangles, ≤ 2 materials.


## Phase 20: the yogurt wing's models, as built

`make-heroes.mjs` builds `p8-filler.glb` and `ferment-tank.glb` as the phase-5 heroes are built: faces cut for the AO, the AO baked into the vertex colours, meshopt geometry, plain greys, own work. `make-heroes.test.mjs` checks both as it checks the others, and adds the yogurt wing's own checks (below). The scene swaps them in (`src/scene/equipment/yogurt/p8Machine.ts`, `yogurtLine.ts`); `?greybox` keeps the boxes.

**Where they follow phase 18, not the phase-16 specs above.** Phase 18 built P8's grey box after these specs were written, and the swap must drive the hero's nodes with the grey nodes' writes, so the models follow the grey box as it stands:

| | Phase-16 spec | As built (the grey box of phase 18) |
|---|---|---|
| P8's bounds | x ±5.10 | x −5.10 to **+5.80**: the ramp from the carrier down to the check gates' belt is part of the machine |
| Cup magazines | 4 boxes | **12 tubes**, one over each lane, at x −4.20 |
| `pistons` | (1.20, 1.55, 0) | **(0.50, 1.39, 0)**, the stroke 0.12 m down, the nozzles' tips 0.11 m under the node |
| `foil_pick` | (2.20, 1.60, 0), a swing about +z | **(1.80, 1.41, 0)**, stroking down 0.09 m with the heads: the grey box's one lidder beam drives both |
| `seal_heads` | (2.80, 1.65, 0) | **(2.80, 1.41, 0)** |
| `carrier` | indexed by the scene | **Body, not a node:** the cups index over it (phase 18) and the chain's slats repeat at the pitch, so nothing moves it; merged, it costs no draw call |
| `uv_tunnel` (phase card) | — | **Body, not a node**, as the carrier; the violet glow under its roof stays the scene's |
| `hood` | (0, 1.625, 0) | **(0, 0.95, 0)**, the glass from the cabinet's top to the filter housing, the model's one glass material; the scene tints it red while the cabin is under +15 Pa |
| `reject_flap` (phase card) | — | **Not in the model:** the flap stands at the check gates (x 14.45), 3 m past P8's end, and the scene's cups (`p8Cups`) draw and drive it |
| The tank's `ph_probe` (phase card) | a port | **Body, not a node**, at (0.99, 1.80, 0.99): the scene hangs the tank's hold lamp over that point |
| The tank's `agitator` | (0, 4.20, 0) | **(0, 4.64, 0)**, the coupling and paddle over the drive, as the grey box's |

| Model | Triangles | Meshes | File | Kept by the scene |
|---|---|---|---|---|
| `p8-filler.glb` | 15,288 | 6 (2 body, 4 nodes) | 241 KB | the UV glow, the HEPA lamp |
| `ferment-tank.glb` | 5,216 | 3 (2 body, the agitator) | 94 KB | the gauge's level, the hold lamp |

**Draw calls:** as first built, with the carrier, the tunnel and the probe as nodes and every opaque mesh casting a shadow, the overview read 370 draw calls. With those merged, and the scene casting no shadow from the small moving parts or the matte bodies (as the grey boxes' dark parts cast none), it reads 350, the budget ([baseline](../tests/perf/baseline.md#phase-20-the-yogurt-wings-heroes)).

**The extra checks:** P8 leaves the cups' band over the carrier clear (x −4.2 to 5.0, y 1.035 to 1.10, |z| < 0.56) with every station at the bottom of its stroke; its pistons, foil pick, sealing heads and UV tunnel show from the stage-15 camera through the hood; the hood holds every station. The tank's agitator turns on its axis over the drive; the agitator and the pH probe show from the stage-13 camera; the inlet's flange meets its pipe along z, the outlet valve is under the cone, and only the gauge's frame stands proud in the gauge's strip.

**Not built in phase 20, and cut in phase 21:** the 125 g cup and the 24-cup tray (the scene's 1,400-odd instanced cups draw 16 triangles each; at the spec's 80 they would add some 90,000 triangles to the overview), and the reefer unit (the wing's reefers are boxes in one instanced mesh, phase 19; the unit needs the truck model at the wing's dock first).

## Phase 24: the yogurt wing's gantry palletizer

`make-heroes.mjs` builds `yogurt-palletizer.glb` ([phase 24](../plan/agent-plan/phase-24-yogurt-palletizer-wrapper.md)), round the centre of its pallet place on the floor, world (24.8, 0, −47). It replaces phase 19's grey column and arm with a gantry:

- **The frame:** four posts and two beams, 2.05 m up, over the place.
- **The tray infeed belt:** from the tray packer to the pick point.
- **The pallet place:** a roller deck, its top at 0.25 m as the UHT line's.
- **The empty-pallet dispenser:** four corner guides, behind the place.

It is all one painted mesh. The layout is `GANTRY` in the script; the scene's motion (`src/scene/equipment/yogurt/palletLine.ts`) keeps to it, and a test checks the two agree.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `bridge` | scene | (−0.60, 2.10, 0) | Along x on the beams, −1.70 (the pick point) to +0.45 | `palletLine.ts` gantry cycle |
| `trolley` | `bridge` | (0, 0, 0) | Along z on the bridge, ±0.25 (the layer's two rows) | Likewise |
| `lift` | `trolley` | (0, −0.55, 0), the vacuum head's underside at 1.55 m | Down to a tray on the belt (0.82 m) or its place on the stack (0.44 to 1.24 m), the mast sliding through the trolley | Likewise |

- **Budget:** 3,292 triangles in 4 meshes, 73 KB.
- **No shadows:** the scene casts none from it, nor from the wing's stretch wrapper, which loads the UHT line's `stretch-wrapper.glb` with the wing's own rollers and film. Each shadow would cost a draw call, and the overview stands at its budget.
- **`make-heroes.test.mjs` checks:**
  - the head reaches the pick point and all 8 places of a layer within its travel, between the posts;
  - the mast stays in the trolley at the bottom of its travel;
  - the head clears a full stack, with a tray in it, at rest;
  - the frame leaves the pallet's path clear, from the dispenser onto the place and out along the line.
