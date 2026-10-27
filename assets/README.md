# Assets

How 3D models and textures get into the plant: where files go, the rules every model follows, the polygon and texture budgets, and the checks a model passes before `scene` loads it. Owned by the `assets` agent ([agent plan](../plan/agent-plan/README.md)), which has the final say on model budgets and node names.

## Where files go

| Path | What | In git |
|---|---|---|
| `public/models/hero/` | The four hero models, `separator.glb`, `homogenizer.glb`, `aseptic-filler.glb`, `palletizer.glb`: phase-3 block-outs made by `assets/scripts/make-heroes.mjs`, replaced by the final models in phase 5 | Yes, from phase 3 |
| `public/models/kenney/` | Kit pieces, unmodified, plus the `Textures/colormap.png` they point to and the kit's `License.txt` | Yes, from phase 2 |
| `public/models/vehicles/` | `truck.glb`, `forklift.glb`: our own, made by `assets/scripts/make-vehicles.mjs` | Yes, from phase 2 |
| `public/textures/` | Textures that code applies: `carton.png`, `tray.png`, `pallet.png`, made by `assets/scripts/make-textures.mjs` | Yes, from phase 2 |
| `assets/source/` | Blender sources (`.blend`) for our own models, under 20 MB each, if any are made by hand (the phase 3 block-outs come from `make-heroes.mjs`) | When there are any |
| [`assets/hero-specs.md`](hero-specs.md) | Specs for the four hero models: size, origin, named moving nodes, budgets | Yes |
| `assets/scripts/` | The GLB checks, the vehicle, hero and texture generators, and their tests | Yes |
| `assets/screenshots/` | Small fit-check screenshots of the heroes in the scene (each under 150 kB) | Yes, from phase 3 |
| [`assets/LICENSES.md`](LICENSES.md) | One row for every file in `public/models/` and `public/textures/` | Yes |

## What is committed now (phases 2 to 4)

| What | Files | Size | Status |
|---|---|---|---|
| Kenney Factory Kit pieces | 12 GLBs in `public/models/kenney/` + `Textures/colormap.png` | 253 KB | CC0. Six are placed as conveyors and rollers (stages 7–8); six are spares. [LICENSES.md](LICENSES.md) lists each. |
| Truck and forklift | `public/models/vehicles/truck.glb`, `forklift.glb` | 139 KB + 78 KB | Own work (no CC0 kit has them, see [Vehicles](#vehicles)). They replace the grey boxes at the docks. |
| Token textures | `public/textures/carton.png`, `tray.png`, `pallet.png` | 8, 19, 35 KB | Own work, brand-free. Printed on the static tokens since G1: the cartons on both pack lines, the trays on the tray line, and the pallets at the palletizer and in the racks. Phase 4 moves the same tokens. See [Token textures](#token-textures). |
| Hero specs | [`hero-specs.md`](hero-specs.md) | | Separator, homogenizer, aseptic filler, palletizer. The models follow in phases 3–5. |
| Hero block-outs (phase 3) | `public/models/hero/separator.glb`, `homogenizer.glb`, `aseptic-filler.glb`, `palletizer.glb` | 123, 149, 80, 67 KB | Own work, plain grey, at the grey boxes' size with every moving node the scene drives. Since phase 4 the scene loads them behind `?heroes` (`src/scene/equipment/heroes.ts`); the grey boxes stay the default until phase 5. See [hero-specs.md](hero-specs.md#phase-3-block-outs). |

Vite copies `public/` to the build as it is. Load files through the base URL, so the same code works in dev and on Vercel (`/`) and on GitHub Pages (`/simulation-milk-process/`):

```ts
const url = `${import.meta.env.BASE_URL}models/hero/separator.glb`;
```

## Rules for every model

- **GLB only.** Binary glTF 2.0 with its textures embedded. No `.gltf` + `.bin` pairs, FBX or OBJ in `public/`. The only exception is the Kenney kit, whose 60+ pieces share one external palette texture (see below).
- **File names in kebab-case:** `separator.glb`, `aseptic-filler.glb`. Kit pieces keep Kenney's names, which are kebab-case already.
- **Metres, Y up.** One unit is one metre. Blender's glTF exporter turns Blender's Z-up into Y-up (keep "+Y Up" ticked).
- **Origin at the footprint centre, on the floor.** (0, 0, 0) is the centre of the model's footprint seen from above, and y = 0 is its lowest point. `scene` places every model by that point. The heroes are the exception: their origin is the machine origin their spec gives, so the footprint-centre warning from `glb-stats` is expected for them.
- **Facing.** Product flows along +X: it enters on the −X side and leaves on +X, as on the Kenney conveyors. The operator side faces +Z, which is the side Blender's Front view shows (−Y in Blender).
- **Named moving nodes.** Every part that moves is its own node, with the name from its hero spec: `bowl`, `piston_1` to `piston_3`, `reel`, `jaws`, `arm_*`. Each node's origin sits on its joint (the bowl on its spin axis, an arm segment on its hinge), and the spec gives the axis and range of motion. `scene` finds parts with `getObjectByName()`, so swapping a grey box for a hero model needs no code change.
- **Names three.js keeps.** Use only `a-z`, `0-9` and `_`, keep every node name unique, and never reuse the scene's name. three.js' GLTFLoader (r186) drops `[ ] . : /`, turns spaces into `_` and adds `_1`, `_2` to a name already taken, so Blender's `piston.001` would load as `piston001`. `glb-stats` warns about this.
- **No baked animation, lights or cameras.** Motion comes from code, driven by the snapshot. The plant's lights and cameras live in `src/scene/`.
- **Brand-free.** No real brands or logos. Cartons and trays get an invented logo ([plan 05](../plan/05-layout-and-3d-assets.md#3d-asset-list)).
- **Materials:** PBR metallic-roughness (Blender's Principled BSDF). Bake procedural nodes to images, because the exporter drops them. Use alpha blending only for glass, and double-sided materials only where a face is seen from both sides.

## Budgets

The target is 60 fps on a mid-range laptop, with one shadow-casting light ([plan 07](../plan/07-tech-stack-and-architecture.md#performance-budget)).

| Kind | Triangles | Textures | Materials, meshes | GLB after phase-5 compression |
|---|---|---|---|---|
| Hero: separator, homogenizer, aseptic filler, palletizer | ≤ 30,000 each | Base colour ≤ 2048²; ORM and normal ≤ 1024² | ≤ 8 materials, ≤ 20 meshes | ≤ 2 MB |
| Other models: kit pieces, truck, forklift, racks | ≤ 5,000 each | ≤ 1024² | ≤ 4 materials | ≤ 500 KB |
| Tokens: carton, tray, pallet | Plain boxes, 12 each, built in code as `InstancedMesh` | One print each in `public/textures/`, ≤ 1024² (512² is enough) | 1 | none |

Why these numbers fit:

- **Triangles.** Five heroes on the floor (the filler twice) come to at most 150k. About 150 kit and other pieces at a few hundred each add about 50k. Say 5,000 carton tokens at 12 each add 60k, and the pipes add a few tens of thousands. That is under 300k a frame, comfortable for an integrated GPU. `qa` measures the real figure ([phase 2 perf baseline](../plan/agent-plan/phase-2-grey-box.md)).
- **Texture memory.** A 2048² RGBA texture with mipmaps takes about 22 MB of GPU memory, and a 1024² one about 6 MB. One hero's set (2048² + 2 × 1024²) is therefore about 34 MB, and four heroes about 135 MB. KTX2 in phase 5 cuts that to a quarter or less. The second filler reuses the first one's GLB (`clone()`, not a second load), so it adds no texture memory.
- **Draw calls.** Each mesh × material is one draw call. Moving parts must be separate meshes, so heroes stay at 20 meshes or fewer, and repeated kit pieces are instanced or merged by `scene`.

Check a model's triangles with `node assets/scripts/glb-stats.mjs <file> --max-triangles 30000` (or `5000`). The budget counts the larger of "triangles in the file" and "triangles as placed", so a mesh used three times counts three times.

## Baked ambient occlusion (heroes)

With one shadow-casting light, the contact shadows inside a machine come from a bake. For each hero:

1. Give the model one UV map with no overlaps (a second UV map is not needed; three.js reads the occlusion map from the UV set glTF names).
2. Bake ambient occlusion in Cycles (128 samples or more) to a 1024² image.
3. Plug it into the Occlusion input of a "glTF Material Output" node group. The exporter writes it as the glTF occlusion texture, which can share one ORM image with roughness (G) and metalness (B). three.js loads it as `aoMap`.

## Compression (phase 5)

Leave GLBs uncompressed until phase 5, so they stay easy to inspect. Then:

- **Geometry:** meshopt (`EXT_meshopt_compression`). three.js' decoder is plain JavaScript (`three/addons/libs/meshopt_decoder.module.js`), so there is nothing extra to host. Draco also works but needs its wasm decoder copied to `public/`.
- **Textures:** KTX2 / Basis Universal (`KHR_texture_basisu`): UASTC for normal maps, ETC1S for base colour and ORM. This cuts GPU memory, not just download size. `KTX2Loader` needs `three/examples/jsm/libs/basis/` copied to `public/` and `detectSupport(renderer)`.
- **Tool:** glTF-Transform (`@gltf-transform/cli`) or gltfpack. Either one is a new dev dependency for `lead` to approve in phase 5. None is added in phase 1.
- **After compressing,** run both checks again. `glb-stats` lists the new extensions with unchanged triangle counts. `glb-load-check` already sets up the Draco, KTX2 and meshopt decoders, but they stay untested until a compressed file exists. The app's loader in `src/scene/` needs the same decoders.

## Export checklist (Blender)

For every model we make, including any the developer models by hand:

1. Scene units are Metric with unit scale 1.0, and the model is real size.
2. The footprint centre is at the world origin and the lowest point at Z = 0 in Blender. The operator side faces Front (−Y), and product flows along +X.
3. Transforms are applied (Ctrl+A → All Transforms) on static meshes, with no negative scale. Moving parts keep their origin on the joint.
4. Moving parts are named as in the hero spec, and every name is unique, uses only `a-z0-9_`, and differs from the scene name.
5. The triangle count in the Statistics overlay is within budget.
6. Materials are Principled BSDF with image textures only, and the AO is baked (heroes).
7. Export with File → Export → glTF 2.0: format glTF Binary (.glb), which embeds the images; +Y Up; Apply Modifiers; UVs, normals and materials on; animation, lights, cameras and compression off. Save as `public/models/<kebab-name>.glb`, and save the `.blend` as `assets/source/<kebab-name>.blend`.
8. `node assets/scripts/glb-stats.mjs public/models/<name>.glb --max-triangles <budget>` gives no warnings, the budget is OK, the node names match the spec, and the bounds match the grey box within 5%.
9. `node assets/scripts/glb-load-check.mjs public/models/<name>.glb` prints `OK` with three r186. Add `--shots <dir>` to look at a render.
10. Add the model to [LICENSES.md](LICENSES.md).

## Scripts

| Script | What it does |
|---|---|
| `node assets/scripts/glb-stats.mjs <file.glb> [--max-triangles N] [--json]` | Parses the GLB header and JSON chunk, then prints the node tree, meshes and primitives, triangles per mesh and in total, world bounds in metres, materials, textures, and the sizes of embedded images (PNG, JPEG, WebP, KTX2). It warns about the rules above that it can check from the file. Exit 1 if over `--max-triangles`, 2 for an unreadable file. It treats the file as untrusted data: it only parses it, never opens the URIs it names, and escapes its strings before printing them. It has no dependencies. |
| `node assets/scripts/glb-load-check.mjs <file.glb>... [--port 5186] [--shots <dir>]` | Loads each GLB with GLTFLoader at the pinned three.js in Playwright's Chromium and renders it once. Fails on a load error, a 404 (a missing texture, say) or any console error. It serves only three.js and each model's own folder, on 127.0.0.1:5186, and stops when done. Needs `npm ci`. |
| `node assets/scripts/make-vehicles.mjs [--out <dir>]` | Builds the truck and the forklift from boxes and cylinders with three.js and writes them with GLTFExporter to `public/models/vehicles/`. Same bytes on every run. |
| `node assets/scripts/make-heroes.mjs [--out <dir>]` | Builds the four hero block-outs the same way, round each machine origin from [hero-specs.md](hero-specs.md), and writes them to `public/models/hero/`. Same bytes on every run. |
| `node assets/scripts/make-textures.mjs [--out <dir>]` | Draws the carton, tray and pallet prints as SVG and renders them to PNG in Playwright's Chromium, into `public/textures/`. The page loads nothing from the network. Same bytes on every run with the pinned Playwright. |
| `npm run test:assets` | Runs every `assets/scripts/*.test.mjs` with Node's test runner, also in `npm run check` and CI: `glb-stats` on GLBs built in memory (including broken and hostile ones), `glb-load-check`'s server, URL filter and command line, the vehicles (size, facing, nodes, budget, and that the committed files match the script), the hero block-outs (size and envelope, node names and rest positions, budget, nozzles, the moving parts seen from their stage camera and kept in their envelope through their travel, and the committed files byte for byte) and the textures (size and budget). |

## Kenney kits: phase-1 check (2026-10-12)

**Result: the kit loads with GLTFLoader at three.js 0.186.1 (r186).** No kit files were committed in phase 1. Phase 2 committed 12 Factory Kit pieces to `public/models/kenney/` ([LICENSES.md](LICENSES.md) lists them and where each is used).

| | Conveyor Kit 2.0 | Factory Kit 3.0 |
|---|---|---|
| Source | [kenney-assets.itch.io/conveyor-kit](https://kenney-assets.itch.io/conveyor-kit) ("Download Now", then "No thanks, just take me to the downloads") | [kenney.nl/assets/factory-kit](https://kenney.nl/assets/factory-kit) ("Download") |
| File | `kenney_conveyor-kit.zip`, 1.3 MB, created 2023-10-31 | `kenney_factory-kit_3.0.zip`, 4.5 MB, created 2026-05-01 |
| SHA-256 | `5ae214fb…ee50` | `7e31fb23…b0a7` |
| Licence (`License.txt`) | CC0 1.0 | CC0 1.0 |
| GLB models | 61 (also FBX and OBJ) | 143 (also FBX and OBJ) |
| Triangles per piece | 2–472 | 2–938 |

`kenney.nl/assets/conveyor-kit` now returns 404. kenney.nl lists the Factory Kit instead, tagged "conveyor". It holds every Conveyor Kit piece except the 12 `cover-*` tunnels, plus corners, T-junctions, 0.5 m end and middle segments, slopes, warning lamps, screens and floor markings. **Recommendation: use the Factory Kit 3.0 in phase 2,** and take the `cover-*` tunnel from the Conveyor Kit if needed. Both are CC0.

**Load check.** `glb-load-check` loaded 13 pieces in Chromium: Conveyor Kit `conveyor`, `conveyor-long-stripe-sides`, `cover-window`, `scanner-high`, `robot-arm-a` and `conveyor-bars-fence`, and Factory Kit `conveyor`, `conveyor-corner`, `conveyor-long-sides-part-middle`, `conveyor-long-sides-part-end`, `robot-arm-a`, `warning-traffic` and `scanner-high`. All were OK: `THREE.REVISION` was 186, the 512² texture loaded, the drawn triangles matched `glb-stats`, and there were no console errors. With the texture folder missing, the check fails as it should (404, "Couldn't load texture").

**What every kit piece has in common** (from `glb-stats` on all 204 files):

- Exported by UnityGLTF: one node per piece, Y up, 1 unit = 1 m, laid out on a 1 m grid with the long axis along X.
- The origin is at the footprint centre on the floor for all conveyors, covers, scanners, lamps and robot arms. Some other pieces break that rule, and `glb-stats` names them: 35 in the Factory Kit (arrows, catwalks, cogs, cranes, doors, pipe bends, screens, walls and corners, `machine-bed`, `oopi`) and 10 in the Conveyor Kit (doors, walls and corners).
- One material, `colormap`: a 512² palette PNG with nearest filtering, double-sided and using `KHR_texture_transform`, which three.js supports. **The PNG is an external file** (`Textures/colormap.png`), so copy it next to the GLBs, keeping that relative path.
- Every file has a node that three.js renames on load. The root node shares the scene's name (every Factory Kit file and 51 Conveyor Kit files), so it loads as `<name>_1`. Ten multi-part Conveyor Kit conveyors repeat the name `Group`. Use `gltf.scene` and don't look kit nodes up by name.

**Pieces for stages 7–8** (Factory Kit unless marked CK; size is x × y × z in metres):

| Piece | Triangles | Size (m) | Use |
|---|---|---|---|
| `conveyor-long-sides-part-end`, `-part-middle` | 184, 76 | 0.5 × 0.4 × 1.0 | Pack conveyors of any length from the fillers |
| `conveyor-stripe-sides`, `conveyor-sides` | 276, 228 | 1.0 × 0.4 × 1.0 | Straight 1 m runs |
| `conveyor-corner` | 234 | 1.0 × 0.45 × 1.0 | Turns in the U layout |
| `conveyor-junction-t` | 120 | 1.0 × 0.4 × 1.0 | Two filler lines merging |
| `conveyor-bars`, `conveyor-bars-high` | 240, 204 | 1.0 × 0.25 / 0.42 × 1.0 | Roller conveyors for trays and pallets |
| `cover-window`, `cover` (CK) | 116, 64 | 1.0 × 1.2 × 1.4 | Tray-shrink tunnel |
| `scanner-high`, `scanner-low` | 240 each | 0.5–0.7 × 1.1–1.3 × 1.6–1.8 | Inline check after the filler |
| `robot-arm-a` | 472 | 1.0 × 3.2 × 1.0 | Palletizer stand-in until the hero; nodes `element-a` to `element-f`, `claw-a`, `claw-b` |
| `warning-traffic`, `warning-orange` | 176, 154 | 0.4 × 1.55 / 1.29 × 0.4 | Machine status lamps |
| `indicator-special-lines`, `-area` | 16, 18 | 1.0 × 0 × 1.0 | Floor markings, such as the quarantine zone |

**For phase 2:**

- **Scale.** The kit has toy proportions: a conveyor is 1.0 m wide and 0.4 m high. Scale each piece to the grey-box layout, non-uniformly if needed.
- **Moving belt.** One palette texture with nearest filtering colours the whole piece, so scrolling its UVs would shift every colour. Lay a thin plane with its own belt texture on the belt and scroll that, or let the moving cartons show the motion.
- **Texture copies.** Each GLB load makes its own copy of `colormap.png`, about 1.4 MB of GPU memory each. Turn on `THREE.Cache` or give all kit pieces one shared material, and instance repeated pieces.

## Vehicles

**No CC0 kit has an articulated truck or a forklift** (checked 2026-10-13). Kenney's [Car Kit 3.1](https://kenney.nl/assets/car-kit) has toy-proportioned cars and a rigid box truck (1.50 × 1.30 × 2.95 m) that the scene's fit would shrink to a 5 m van at a dock built for a 16.5 m truck, and no forklift; none of Kenney's other 3D kits (City Kit Industrial, Roads, Mini Market, Toy Car Kit and the rest of kenney.nl's 3D list) has either vehicle. The CC0 candidates elsewhere were a semi-trailer on OpenGameArt that exists only as a `.blend` (no Blender here to convert it) and a PSX-style forklift on itch.io whose texture is traced from a photo. So both vehicles are our own, built by `make-vehicles.mjs`, which avoids any licence or brand question and fits the scene exactly.

| | `truck.glb` | `forklift.glb` |
|---|---|---|
| Native size (x × y × z) | 2.55 × 4.00 × 16.50 m | 1.20 × 2.20 × 3.50 m |
| Facing | Cab at +z, trailer tail at −z | Forks at +z, counterweight at −z |
| Origin | Footprint centre, on the floor | Footprint centre, on the floor |
| Triangles, draw calls | 2,040; 3 meshes (`body_paint`, `body_matte`, `body_glass`) | 1,076; 4 meshes (`body_paint`, `body_matte`, `mast_inner`, `forks`) |
| Materials | 3, no textures: painted and matte parts take vertex colours (`COLOR_0`), plus glass | 2, no textures |
| Moving nodes | None: phase 4 drives the whole truck | `forks` (carriage and forks; origin at the forks' underside, (0, 0.03, 0.75)) and `mast_inner` (origin at its foot, (0, 0.10, 0.64)), both children of the root. To lift a pallet by `liftM` (0 to 3.3 m; the top rack beam is at 3.21 m) add `liftM` to `forks.position.y` and `liftM / 2` to `mast_inner.position.y` (a 2:1 chain), which keeps the inner mast 0.45 m inside the outer one at full lift |

The scene's `fitVehicle()` (`src/scene/equipment/packs/vehicles.ts`) scales a model's bounding box into 16.5 × 4.0 × 2.55 m and 3.5 × 2.2 × 1.2 m, turning a model that is longer in x than in z to face +z. Built at exactly those sizes and facing +z, both load at scale 1, unturned. A test (`make-vehicles.test.mjs`) keeps it that way. The colours are brand-free: the preview's blue cab and white trailer, a safety-yellow forklift.

In the app (vite build and vite preview, 1440 × 900, SwiftShader), the models add 4 draw calls and about 7,000 triangles (both passes) over the grey boxes they replace: 179 draw calls and 104,810 triangles at the overview against 175 and 97,842 without them, with no console errors. Those figures predate the scene's G1 fixes (the first perf baseline, at `1700d82`, read the same 179 and 104,810). The tokens and the now empty racks have changed the overview since: [the perf baseline](../tests/perf/baseline.md#draw-calls-and-triangles) has the current 178 draw calls and 98,558 triangles.

To change them, edit `make-vehicles.mjs`, run it, then `npm run test:assets` and `node assets/scripts/glb-load-check.mjs public/models/vehicles/*.glb --port 5507 --shots <dir>`.

## Token textures

| File | Size | What it shows |
|---|---|---|
| `carton.png` | 128 × 256 | The front face of a 1 L brick (95 × 195 mm): white, an invented round milk-drop logo and the made-up name "SIM DAIRY", "UHT MILK", "1 L", a blue wave band with "LONG LIFE · 3.5% FAT" and "DEMO PACK · NOT FOR SALE" |
| `tray.png` | 256 × 256 | A shrink-wrapped tray from the side: four packs over a corrugated cardboard base, under clear film with two glossy streaks and creases |
| `pallet.png` | 256 × 256 | The top deck of a wooden pallet: five boards with grain, the gaps between them and nail heads |

How the scene uses them (since G1):

- `src/scene/equipmentHost.ts` (`loadTexture`) loads each file once with `TextureLoader` from `` `${import.meta.env.BASE_URL}textures/<name>.png` `` and sets `colorSpace = THREE.SRGBColorSpace`. Every caller shares that one texture.
- The colours are baked in, so `print()` in `src/scene/equipment/packs/kit.ts` draws them with a white material (`color: 0xffffff`), one per print; the shared `carton` or `wood` colours would tint them a second time.
- `printOn()` in `src/scene/equipment/packsLine.ts` gives that material to the cartons (`pack-conveyors`), the trays (`tray-conveyor`), the pallet at the palletizer and the rack pallets (`racks`) once the image has loaded. Until then, or if the file is missing, they keep the plain `carton` or `wood` material. `src/scene/equipment/packs/tokens.ts` places the cartons and trays; phase 4 moves the same tokens, so it needs no second texture load or material.
- `BoxGeometry`'s UVs put the whole image on every face. That is right for the carton's front and back (95 × 195 mm, the image's 1:2), squeezes it on the narrow sides and the top, and is fine at token size. The tray and pallet prints read on every face.
- To change one, edit its SVG in `make-textures.mjs` and run it.

## Hero model specs

[`hero-specs.md`](hero-specs.md) specifies the separator, homogenizer, aseptic filler and palletizer: outer dimensions measured from the merged grey boxes, the machine origin each model is built round, the named moving nodes (`bowl`, `piston_1` to `piston_3`, `reel`, `jaws`, `arm` with `arm_lift`, `arm_wrist`, `arm_clamp_1` and `arm_clamp_2`) with their rest positions, axes, ranges and the code that drives them, nozzle points for the pipes, budgets and the export checklist, so the phase-5 swap needs no code change. Its [Phase 3 block-outs](hero-specs.md#phase-3-block-outs) section lists the block-outs, the fit check in the scene and what `scene` needs for the swap. To change a block-out, edit `make-heroes.mjs`, run it, then `npm run test:assets` and `node assets/scripts/glb-load-check.mjs public/models/hero/*.glb --port 5507 --shots <dir>`.
