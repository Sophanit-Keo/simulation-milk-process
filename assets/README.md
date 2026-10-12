# Assets

How 3D models and textures get into the plant: where files go, the rules every model follows, the polygon and texture budgets, and the checks a model passes before `scene` loads it. Owned by the `assets` agent ([agent plan](../plan/agent-plan/README.md)), which has the final say on model budgets and node names.

## Where files go

| Path | What | In git |
|---|---|---|
| `public/models/` | GLBs the app loads, one per model: `separator.glb`, `homogenizer.glb`, `aseptic-filler.glb`, `palletizer.glb`, ... | Yes |
| `public/models/kenney/` | Kit pieces, unmodified, plus the `Textures/colormap.png` they point to | Yes, from phase 2 |
| `public/textures/` | Textures that code applies: carton print, belt, floor decals | Yes |
| `assets/source/` | Blender sources (`.blend`) for our own models, under 20 MB each | Yes |
| `assets/specs/` | Hero model specs, one per hero (phase 2) | Yes |
| `assets/scripts/` | `glb-stats.mjs`, `glb-load-check.mjs` and their tests | Yes |
| [`assets/LICENSES.md`](LICENSES.md) | One row for every file in `public/models/` and `public/textures/` | Yes |

Vite copies `public/` to the build as it is. Load files through the base URL, so the same code works in dev and on Vercel (`/`) and on GitHub Pages (`/simulation-milk-process/`):

```ts
const url = `${import.meta.env.BASE_URL}models/separator.glb`;
```

## Rules for every model

- **GLB only.** Binary glTF 2.0 with its textures embedded. No `.gltf` + `.bin` pairs, FBX or OBJ in `public/`. The only exception is the Kenney kit, whose 60+ pieces share one external palette texture (see below).
- **File names in kebab-case:** `separator.glb`, `aseptic-filler.glb`. Kit pieces keep Kenney's names, which are kebab-case already.
- **Metres, Y up.** One unit is one metre. Blender's glTF exporter turns Blender's Z-up into Y-up (keep "+Y Up" ticked).
- **Origin at the footprint centre, on the floor.** (0, 0, 0) is the centre of the model's footprint seen from above, and y = 0 is its lowest point. `scene` places every model by that point.
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
| `node --test assets/scripts/glb-stats.test.mjs` | Tests for `glb-stats` on GLBs built in memory, including broken and hostile ones. Runs in `npm run check` and CI as `npm run test:assets`. |

## Kenney kits: phase-1 check (2026-10-12)

**Result: the kit loads with GLTFLoader at three.js 0.186.1 (r186).** No kit files are committed in phase 1. Phase 2 copies the pieces it needs.

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

## Hero model specs (phase 2)

Phase 2 writes `assets/specs/<name>.md` for the separator, homogenizer, aseptic filler and palletizer. Each spec gives the outer dimensions (matching the grey boxes), the named moving nodes with their pivots, axes and ranges, and the triangle budget, so the phase-5 swap needs no code change.
