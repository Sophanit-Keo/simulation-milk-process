[Agent plan](../../plan/agent-plan/README.md) · [Phase 2](../../plan/agent-plan/phase-2-grey-box.md) · qa lane

# Performance baseline: grey-box plant

The draw calls, triangles and frame rate of the grey-box plant at gate G1, measured with [`measure.mjs`](measure.mjs). Draw calls and triangles depend only on the scene and the camera, so they hold on any machine. The frame rate depends on the GPU, and the only GL here is software GL, so **the 60 fps criterion of G1 is still open**: see [To do on a real GPU](#to-do-on-a-real-gpu).

## Budget

| What | Budget | Source |
|---|---|---|
| Draw calls at the overview | about 350 | Phase 2 task card (`lead`) |
| Frame rate on the grey-box plant | 60 fps on a mid-range laptop | [Plan 07, performance budget](../../plan/07-tech-stack-and-architecture.md#performance-budget); gate G1 |
| Shadow-casting lights | 1 | Plan 07, performance budget |

The browser tests guard the draw calls too: `e2e/stages.spec.ts` fails if the overview takes more than 400. The room above the budget means that only a real regression trips it, such as a lost `InstancedMesh` or a material per machine.

## How to run

```sh
npm run build
node tests/perf/measure.mjs 5505                       # serves dist/ with vite preview on port 5505, then stops it
node tests/perf/measure.mjs http://localhost:5173/     # or measures an app that is already running
```

The script is not part of `npm test` or `npm run check`, because it needs a build and a browser. Options: `--width` and `--height` (the viewport, 1440 × 900 by default), `--hold` (how long the counts must hold still at the overview before it is measured, 2 s by default), `--samples` (one-second fps readings per stop, default 3), `--headed`, and `--channel chrome` (the installed Chrome instead of Playwright's Chromium).

What it does:

1. It opens the app with `?debug` in Chromium, launched with `--enable-unsafe-swiftshader` so that a machine without a GPU still gets WebGL.
2. It waits until the page has fetched everything and `window.__scene.drawCalls()` and `triangles()` hold still for `--hold` seconds. The Kenney conveyor pieces and the two vehicles load about a second after the first frame and change both counts.
3. It reads the overview: draw calls, triangles and `fps()` (an average over the last second, read once a second).
4. It clicks each stage on the rail, waits for `#viewport[data-focus-stage]`, waits for the counts to hold still for a second, and reads the same numbers.

It prints one JSON object with the machine (CPU, cores, load average), the WebGL renderer (`gl.software` is `true` on software GL), the counts of the first frames, the numbers per stop and any console errors or failed requests. The exit code is 0 if the overview is within the draw-call budget and the page logged no errors, 1 if not, and 2 if it could not measure.

`renderer.info` counts every draw in a `render()` call, the shadow pass included, so each figure below is the whole frame. The CSS labels and the HUD add no draw calls.

## Results

Measured on 16 October 2026 on the merged phase 2 plant at `1700d82` (all lanes but qa and scene-g1 merged, vehicles and token textures included). 33 machines, a production build served by `vite preview`, in headless Chromium 141.0.7390.37.

The machine: a Linux 6.18 x64 VM, `nproc` 4, CPU `Intel(R) Xeon(R) Processor @ 2.10GHz` (from `/proc/cpuinfo`), 16 GB RAM, no GPU, Node 22.22.0. No other browser ran during the measurement. The load average of about 3.5 is the measurement's own SwiftShader threads.

### Draw calls and triangles

These are the same on any GPU. Two runs at 1440 × 900 gave identical counts.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **179** | **104,810** | **179** | **104,810** |
| 1 Standardization | 86 | 65,648 | 86 | 65,648 |
| 2 Preheating | 84 | 65,592 | 84 | 65,592 |
| 3 Homogenization | 86 | 65,460 | 86 | 65,460 |
| 4 UHT | 90 | 69,496 | 91 | 69,552 |
| 5 Flash cooling | 84 | 67,480 | 84 | 67,480 |
| 6 Aseptic tank | 74 | 58,640 | 74 | 58,640 |
| 7 Filling | 88 | 62,124 | 89 | 62,352 |
| 8 Packaging | 93 | 68,650 | 94 | 68,818 |
| 9 Quarantine & QA | 109 | 86,420 | 116 | 90,208 |
| 10 Warehouse | 121 | 78,928 | 125 | 83,656 |

The overview uses 179 draw calls, about half the budget of 350. Each stage stop draws fewer, because the camera's frustum leaves most of the plant out. 1280 × 720 is the browser tests' viewport; its wider view takes in a little more at some stops.

The table shows the settled scene. In the first frames the overview reads about 176 to 180 draw calls and 76,000 to 83,000 triangles, depending on how many pieces have loaded by then; the Kenney conveyor pieces and the vehicles then replace their grey boxes and the counts settle at 179 and 104,810 within about a second.

### Frame rate: software GL only, not representative

> **These numbers come from SwiftShader, Chromium's software renderer, running on the CPU of a VM with no GPU. They say nothing about the 60 fps target.** WebGL renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.

| Camera | fps, 1440 × 900 (two runs) | fps, 1280 × 720 |
|---|---:|---:|
| Overview | 5.9, 6.3 | 6.7 |
| 1 Standardization | 8.3, 8.2 | 10.0 |
| 2 Preheating | 8.8, 8.5 | 10.2 |
| 3 Homogenization | 8.5, 8.1 | 9.9 |
| 4 UHT | 7.6, 7.6 | 9.7 |
| 5 Flash cooling | 8.2, 8.2 | 10.1 |
| 6 Aseptic tank | 9.6, 8.5 | 12.2 |
| 7 Filling | 6.9, 6.7 | 9.0 |
| 8 Packaging | 5.5, 6.0 | 8.1 |
| 9 Quarantine & QA | 7.0, 8.0 | 8.8 |
| 10 Warehouse | 5.1, 5.0 | 6.6 |

Software GL draws every pixel on the CPU, so the frame rate follows the pixel count and whatever else the machine is doing more than the draw calls. Two pages rendering at once, as in a parallel Playwright run, roughly halve each other's frame rate on this machine, so `playwright.config.ts` runs the browser tests one page at a time.

## To do on a real GPU

G1 asks for 60 fps on the grey-box plant on a mid-range laptop. Only the developer can sign that, on real hardware:

1. On the laptop, plugged in, with other heavy apps closed: `npm ci`, `npm run build`, then `node tests/perf/measure.mjs 5505 --headed --channel chrome`. Headed Chrome uses the GPU; headless Chromium can fall back to software GL. Without Chrome installed, leave out `--channel chrome`, keep `--headed`, and check the renderer as in step 2.
2. In the JSON, check that `gl.renderer` names the real GPU and that `gl.software` is `false`. `fpsTargetMet` then gives the verdict for the overview (59 fps or more). Read the stage stops too: the warehouse (stage 10) and the packaging hall (stage 8) are the slowest stops here.
3. Without the script: open the app with `?debug` in a normal Chrome window at the laptop's usual size, wait a few seconds, run `__scene.fps()` in the console at the overview, then click stages 8 and 10 on the rail and run it again at each.
4. Record in this file: the laptop model, the GPU, the browser and its version, the screen's size, scaling and refresh rate, the window size, and the fps at the overview and at each stop. On a 60 Hz screen, 60 fps is the ceiling, so 59 to 60 is a pass.

If the laptop falls short, look first at the shadow map (2048 px with a soft radius, in `src/scene/world.ts`) and at the pixel ratio, which is capped at 2. Draw calls are not the problem at 179.
