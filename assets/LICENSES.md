# Asset licences

One row for every third-party or own asset in `public/models/` and `public/textures/`, plus kits we checked but haven't committed. The rules:

- Prefer CC0. CC-BY is fine if the "About this model" panel credits the author. Never use NC, ND or unclear licences, or anything with a real brand on it.
- Keep each kit's `License.txt` with its zip (outside the repo), and record the source URL and the zip's SHA-256, so the download can be checked again.
- Our own models and textures get a row too, with "own work" as the source and the script or `.blend` that makes them.

## Kits

| Asset | Source URL | Licence | Author | Date added | Where used |
|---|---|---|---|---|---|
| Factory Kit 3.0 (`kenney_factory-kit_3.0.zip`, SHA-256 `7e31fb2308e90304672bd15cd18fa9d9f02c03731a8cbc57a8e3e1c181dfb0a7`) | <https://kenney.nl/assets/factory-kit> | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (per `License.txt`, committed next to the pieces) | Kenney ([kenney.nl](https://www.kenney.nl)) | 2026-10-12 (12 pieces committed, listed below) | Conveyors and rollers of stages 7–8 (`src/scene/equipment/packs/conveyors.ts`) |
| Conveyor Kit 2.0 (`kenney_conveyor-kit.zip`, SHA-256 `5ae214fb473cc5d4aa75828da2a61310c0f88abefbfb1fb6c7da592b18d0ee50`) | <https://kenney-assets.itch.io/conveyor-kit> | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (per `License.txt`) | Kenney ([kenney.nl](https://www.kenney.nl)) | 2026-10-12 (checked, not committed) | Phase 1 load check. Its `cover-*` tunnel could dress the tray-shrink tunnel (stage 8) |
| Car Kit 3.1 (`kenney_car-kit.zip`, SHA-256 `fac7dacac5c7874348cf19729af3ef205f3d366493edaf0a827d93f4fdf3d0c4`) | <https://kenney.nl/assets/car-kit> | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (per `License.txt`) | Kenney ([kenney.nl](https://www.kenney.nl)) | 2026-10-13 (checked, not committed) | Not used: it has no forklift and no articulated truck; its rigid `truck` is toy-sized (1.50 × 1.30 × 2.95 m) and would fit the dock as a 5 m van. See README, "Vehicles" |

## Files in `public/models/kenney/`

Copied unmodified from the Factory Kit 3.0 zip's `Models/GLB format/` folder (SHA-256 of each file checked against the zip, 2026-10-13). CC0 1.0, by Kenney; date added 2026-10-12. Sizes are x × y × z in metres, as `glb-stats` reports them.

| File | Triangles | Size (m) | Where used |
|---|---|---|---|
| `conveyor-long-sides-part-end.glb` | 184 | 0.50 × 0.40 × 1.00 | Pack conveyors, stage 7: belt ends |
| `conveyor-long-sides-part-middle.glb` | 76 | 0.50 × 0.40 × 1.00 | Pack conveyors, stage 7: belt runs |
| `conveyor-corner.glb` | 234 | 1.00 × 0.45 × 1.00 | Pack conveyors and roller lines: 90° turns |
| `conveyor-sides.glb` | 228 | 1.00 × 0.40 × 1.00 | Accumulation table, stage 7 |
| `conveyor-bars-high.glb` | 204 | 1.00 × 0.42 × 1.01 | Tray rollers, stage 8 |
| `conveyor-bars.glb` | 240 | 1.00 × 0.25 × 1.00 | Pallet rollers, stage 8 |
| `conveyor-stripe-sides.glb` | 276 | 1.00 × 0.40 × 1.00 | Not used yet (spare straight belt) |
| `conveyor-junction-t.glb` | 120 | 1.00 × 0.40 × 1.00 | Not used yet (the two pack lines merging) |
| `scanner-high.glb` | 240 | 0.48 × 1.27 × 1.77 | Not used yet (inline pack check after the filler) |
| `warning-traffic.glb` | 176 | 0.40 × 1.55 × 0.40 | Not used yet (machine status lamp) |
| `robot-arm-a.glb` | 472 | 1.00 × 3.20 × 1.00 | Not used yet (palletizer stand-in until the hero) |
| `indicator-special-area.glb` | 18 | 1.00 × 0.00 × 1.00 | Not used yet (floor marking, e.g. quarantine) |
| `Textures/colormap.png` | — | 512 × 512 PNG, 11.5 KB | The palette texture every piece above points to |
| `License.txt` | — | — | The kit's CC0 licence text, kept with the pieces |

## Own work

| Asset | Made by | Licence | Date added | Where used |
|---|---|---|---|---|
| `public/models/vehicles/truck.glb` (articulated truck, 16.5 × 4.0 × 2.55 m, 2,040 triangles, 139 KB) | `assets/scripts/make-vehicles.mjs` (three.js boxes and cylinders, exported with GLTFExporter) | Own work; no third-party content | 2026-10-13 | The truck at the middle dock door, stage 10 (`src/scene/equipment/packs/vehicles.ts`) |
| `public/models/vehicles/forklift.glb` (counterbalance forklift, 3.5 × 2.2 × 1.2 m, 1,076 triangles, 78 KB) | `assets/scripts/make-vehicles.mjs` | Own work; no third-party content | 2026-10-13 | `forklift-1` and `forklift-2`, stage 10 |
| `public/textures/carton.png` (128 × 256), `tray.png` and `pallet.png` (256 × 256) | `assets/scripts/make-textures.mjs` (SVG rendered in Playwright's Chromium) | Own work. The invented "SIM DAIRY" logo is not a real brand. The carton's lettering is set in Barlow Condensed ([SIL OFL 1.1](https://openfontlicense.org), from `@fontsource/barlow-condensed`, the app's own UI font), rasterised; the font file itself is not in the texture | 2026-10-13 | Printed on the static tokens since G1: the cartons on both pack lines, the trays on the tray line, and the pallets at the palletizer and in the racks (`printOn()` in `src/scene/equipment/packsLine.ts`). Phase 4 moves the same tokens |
| `public/models/hero/separator.glb` (separator, 1.70 × 2.30 × 2.90 m, 4,592 triangles, 83 KB; block-out 2026-10-18, final with baked AO and meshopt 2026-10-27) | `assets/scripts/make-heroes.mjs` (three.js boxes, cylinders and cones, exported with GLTFExporter, compressed with glTF-Transform) | Own work; no third-party content | 2026-10-18 | The `separator`, stage 1 (`src/scene/equipment/heroes.ts`) |
| `public/models/hero/homogenizer.glb` (homogenizer, 2.50 × 1.37 × 3.09 m, 5,060 triangles, 97 KB) | `assets/scripts/make-heroes.mjs` | Own work; no third-party content | 2026-10-18 | The `homogenizer`, stage 3 |
| `public/models/hero/aseptic-filler.glb` (aseptic filler, 3.53 × 3.56 × 2.73 m, 6,252 triangles, 80 KB) | `assets/scripts/make-heroes.mjs` | Own work; no third-party content | 2026-10-18 | `filler-a` and, mirrored, `filler-b`, stage 7 |
| `public/models/hero/palletizer.glb` (palletizer, 3.28 × 2.45 × 1.10 m, 2,048 triangles, 43 KB) | `assets/scripts/make-heroes.mjs` | Own work; no third-party content | 2026-10-18 | The `palletizer`, stage 8 |

## Fonts and libraries in the bundle

Not assets in `public/`, but third-party work the built app ships; checked on 2026-10-27 (phase 6) against each package's `package.json` at the version `package.json` pins. The About panel credits the fonts, three.js and Chart.js.

| Package | Version | Licence | In the app |
|---|---|---|---|
| `@fontsource/barlow`, `@fontsource/barlow-condensed`, `@fontsource/ibm-plex-mono` | 5.3.0 | [SIL OFL 1.1](https://openfontlicense.org) | The UI fonts, bundled by Vite from `src/styles/fonts.css`; no request leaves the site |
| `three` (with its meshopt decoder, `three/addons/libs/meshopt_decoder.module.js`) | 0.186.1 | MIT | The 3D view; the decoder unpacks the hero models |
| `chart.js` | 4.5.1 | MIT | The trend charts in the stage panel |
| `lil-gui` | 0.21.0 | MIT | The debug panel, only with `?debug` and loaded on demand |

Build tools that touch the assets but ship nothing: `@gltf-transform/core` and `@gltf-transform/extensions` 4.5.1 and `meshoptimizer` 1.3.0 (MIT), which compress the hero models in `make-heroes.mjs`.
