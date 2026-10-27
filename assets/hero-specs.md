# Hero model specs

What the four hero models must be so they can replace their grey boxes in phase 5 with no code change: the separator (stage 1), homogenizer (stage 3), aseptic filler (stage 7, used twice) and palletizer (stage 8). Owned by the `assets` agent ([agent plan](../plan/agent-plan/README.md)); the general rules, budgets and Blender export checklist are in [README.md](README.md).

The numbers come from the merged grey boxes in `src/scene/equipment/liquidLine.ts` and `packsLine.ts` (the code the heroes replace), checked against `uht-plant-preview.html`. The separator, homogenizer and palletizer match the preview exactly; the filler adds an outfeed hood and sealing jaws that the preview lacks.

| Hero | File | Machine id(s) | Stage | Moving nodes the code drives today |
|---|---|---|---|---|
| Separator | `public/models/hero/separator.glb` | `separator` | 1 | `bowl` |
| Homogenizer | `public/models/hero/homogenizer.glb` | `homogenizer` | 3 | `piston_1`, `piston_2`, `piston_3` |
| Aseptic filler | `public/models/hero/aseptic-filler.glb` | `filler-a`, `filler-b` | 7 | `reel`, `jaws` |
| Palletizer | `public/models/hero/palletizer.glb` | `palletizer` | 8 | `arm` (sub-joints `arm_lift`, `arm_wrist`, `arm_clamp_1`, `arm_clamp_2` for phase 4) |

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

A column palletizer: a round base and column, a horizontal arm that swings on top of the column between the pick point (where the tray line ends) and the place point (the pallet being built), and a tray gripper on a lift rod at the arm's end. Machine origin: world (28.3, 0, 13.2), on the column's axis.

| Part (grey box) | Shape and size (m) | Centre, from the origin (m) |
|---|---|---|
| Base | cylinder, radius 0.55, height 0.60 | (0, 0.30, 0) |
| Column | cylinder, radius 0.22, height 1.70 | (0, 1.45, 0) |
| `arm`: boom | box 2.45 × 0.20 × 0.26 | (1.22, 0, 0) in `arm` |
| `arm`: lift rod | cylinder along y, radius 0.06, length 0.60 | (2.45, −0.35, 0) in `arm` |
| `arm`: gripper | box 0.55 × 0.14 × 0.45 | (2.45, −0.70, 0) in `arm` |

- **Bounds, arm at rest along +x:** x −0.55 to +2.725, y 0 to 2.45, z −0.55 to +0.55, so **3.28 × 2.45 × 1.10 m**. Swinging, the arm sweeps a disc of radius 2.73 m round the column between y 1.58 and 2.45. Envelope (5%): reach ≤ 2.87 m, height ≤ 2.57 m.
- **Reach:** the pick point is 2.53 m from the column and the place point 2.42 m, so keep the gripper's centre 2.45 m out along the arm.
- **Label anchor:** (0, 3.00, 0). Keep the model below 2.95 m.
- **Not part of the hero:** the pallet and the part-built `stack` of trays at the place point belong to the fixture as tokens. The model holds only base, column and arm.

| Node | Parent | Rest position (m) | Motion | Driven by |
|---|---|---|---|---|
| `arm` | scene | (0, 2.35, 0), the hinge on top of the column | Turns about +y. At rest it points along +x; it swings between 0.91 rad (52°, the pick point) and 3.66 rad (210°, the place point), the way round via −z | `arm.rotation.y = 0.91 + 2.75·(0.5 − 0.5·cos φ)`, φ advancing 0.5 rad/s while stage 8 runs: one pick and place in about 12.6 s |
| `arm_lift` | `arm` | (2.45, 0, 0) | Slides down along −y, 0 to 1.20 m, to take a tray off the belt (surface at 0.86 m) or set it on the pallet (empty deck at 0.41 m) | Phase 4 |
| `arm_wrist` | `arm_lift` | (0, −0.63, 0), the top of the gripper | Turns about +y so the tray stays square to the pallet: `rotation.y = −arm.rotation.y + tray angle` | Phase 4 |
| `arm_clamp_1`, `arm_clamp_2` | `arm_wrist` | (0, −0.07, −0.225), (0, −0.07, +0.225) | Close towards each other along z, 0 to 0.10 m each, to grip a tray | Phase 4 |

Design notes: the lift rod, gripper and clamps hang under `arm_lift`, so the boom stays put when it lowers. Until phase 4 drives the sub-joints they stay at rest, which must look like the grey box: gripper raised, clamps open.

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
| 5 | Final models, baked AO, compression; `scene` swaps them in. |

## Phase 3 block-outs

`assets/scripts/make-heroes.mjs` builds all four from boxes, cylinders and cones with three.js and writes them with GLTFExporter to `public/models/hero/`, the same way `make-vehicles.mjs` makes the truck and forklift (no Blender, no new packages, same bytes on every run). Each is built round its machine origin with +y up, product along +x and the operator side at +z. Static parts are merged into one mesh per material. Every moving node is one mesh of its own, named as in the tables above, at its rest position with no rotation and scale 1, and its geometry hangs so that the node's origin is on its joint. There are no textures: two vertex-coloured materials per model (`<model>_paint`, satin, and `<model>_matte`) in plain greys, plus `aseptic_filler_glass` (alpha-blended) for the aseptic zone. Nothing carries text or a brand mark.

| File | Bounds, x / y / z (m) | Against the grey box | Triangles | Meshes (draw calls), materials | Nodes |
|---|---|---|---|---|---|
| `separator.glb`, 122.5 KB | −0.85…0.85 / 0…2.30 / −2.05…0.85 | Same | 1,944 | 3, 2 | `bowl` |
| `homogenizer.glb`, 149.0 KB | −1.25…1.25 / 0…1.368 / −1.77…1.32 | z +0.145 m at the front, all at rest: the liquid end (z 1.06 to 1.32) that the design notes allow; 3.09 m deep, inside the envelope | 2,328 | 5, 2 | `piston_1`, `piston_2`, `piston_3` |
| `aseptic-filler.glb`, 79.7 KB | −1.63…1.90 / 0…3.56 / −1.60…1.135 | x −0.03 m (the product-in flange, proud of the −x face) and z +0.035 m (the control panel on the +z face) | 1,116 | 7, 3 | `reel`, `jaws` > `jaw_1`, `jaw_2` |
| `palletizer.glb`, 67.4 KB | −0.55…2.725 / 0…2.45 / −0.55…0.55 | Same | 964 | 7, 2 | `arm` > `arm_lift` > `arm_wrist` > `arm_clamp_1`, `arm_clamp_2` |

Block-out notes, by model:

- **Separator.** A frame hood (radius 0.72 m, up to y 1.38) hides the lower half of the bowl. Above it the bowl shows its lock ring, eight bolts, the top cone, the fin from the grey box, a dark stripe opposite the fin and an outlet stub, so a turn reads from the stage-1 camera. The two nozzles end in flanges at x ±0.85 m.
- **Homogenizer.** The liquid end is kept low (y 0.66 to 0.94, valve covers to 0.98) so the stage-3 camera, about 30° above the floor, sees the three pistons across the gap between it and the crankcase (z 0.65 to 1.06). Each piston is 0.70 m long (z −0.40 to +0.30 from its node), with a dark collar that stays in that gap all stroke. At ±0.12 m its back end stays inside the crankcase and its front end inside the liquid end. The two gauges sit on the top cover at the spec's points.
- **Aseptic filler.** The outfeed hood is open below and at the front: packs on the belt (y 0.86, 0.85 m wide) pass under it into a dark opening in the +x face. The paper tube, its forming ring and the jaws show through the glass. The reel has a hub, the grey box's bar and a splice mark on both faces, so its turn reads on filler B, the mirrored copy.
- **Palletizer.** The arm is a turntable hub on the column axis, the boom, and a head that guides the lift rod. `arm_lift` is the rod (y −0.63 to +0.10 from the node, its top hidden in the head). `arm_wrist` is the gripper's rotary unit, frame and rails, and the clamps are plates on the gripper's z faces, open at rest. The arm reaches 2.734 m from the column axis, inside the 2.87 m allowed.

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

**Phase 4:** done behind a flag. With `?heroes` in the URL, `src/scene/equipment/heroes.ts` follows steps 1–4 below: it loads each model into its machine's root (filler B mirrored), hides the grey parts it replaces and keeps the ones it leaves out (the homogenizer's needles, the palletizer's pallet and load), points the update code at the model's `bowl`, `piston_1` to `piston_3`, `reel`, `jaws` and `arm`, and turns shadows on for every mesh but the glass. A model that lacks one of those nodes is left out with a console warning, and the grey box stays. Without the flag nothing loads, so the grey boxes stay the default until phase 5 makes the swap permanent. `tests/scene/heroes.test.ts` checks the swap, and `e2e/smoke.spec.ts` that the four files load in the app without errors.

1. **Load and place.** `ctx.loadModel('hero/<file>')` into the machine's root group, as is: no offset, rotation or scale, except filler B, which takes `scale.z = -1`. The second filler should be a clone of the first load (`loadModel` already returns clones of one load).
2. **Hide the grey parts and drop their node names.** With the grey box and the hero both in the root, `root.getObjectByName('bowl')` (and `piston_N`, `reel`, `jaws`, `arm`) finds the **grey** node first, because the grey children come first. Either remove the grey parts from the root or look the nodes up in the loaded scene (`hero.getObjectByName(...)`), then point the existing update code at those nodes. The update code then works unchanged: it writes only `bowl.rotation.y`, `piston_N.position.z`, `reel.rotation.z`, `jaws.position.y` and `arm.rotation.y`.
3. **Picking and shadows.** Picking (`src/scene/picking.ts`) walks up from the mesh hit to the machine's object and skips hidden parts, so hero meshes inside the root select their stage with no change. GLTFLoader leaves `castShadow` off: set it on the hero's meshes (the static `body_*` meshes and the moving nodes; the filler's `body_glass` should not cast).
4. **Glass.** `aseptic_filler_glass` loads as transparent with `depthWrite` off (glTF `BLEND`), like the scene's own `glass` material.
5. **Materials and theme.** The heroes bring their own materials, so the theme does not re-colour them (the grey `steel` and `steelDark` darken in the dark theme). If they look too bright on the dark floor, phase 5 can swap `<model>_paint` for a themed material.
6. **Draw calls.** The heroes make 3 (separator), 5 (homogenizer), 7 (each filler) and 7 (palletizer) draw calls per pass, against 5 to 12 for the grey boxes, shadow pass included.

Not done in the block-outs, for phase 4 and 5:

- `arm_lift`'s rod is 0.73 m long and its top is hidden in the boom's head, so it stays in the head only for the first 0.20 m of lift. Lowering the full 1.20 m needs a telescopic rod (a second node under `arm_lift`) or a longer rod above the boom, which would break the 2.57 m height limit.
- `jaw_1` and `jaw_2`, and `arm_wrist` and the clamps, are in place but not driven yet.
- No textures, UVs or baked AO yet (phase 4 and 5), and no `.blend` sources: the models come from the script.
