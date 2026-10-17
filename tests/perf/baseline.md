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

It prints one JSON object with the machine (CPU, cores, load average; Windows has no load average, so it reads `null` there), the WebGL renderer (`gl.software` is `true` on software GL), the counts of the first frames, the numbers per stop and any console errors or failed requests. The exit code is 0 if the overview is within the draw-call budget and the page logged no errors, 1 if not, and 2 if it could not measure.

`renderer.info` counts every draw in a `render()` call, the shadow pass included, so each figure below is the whole frame. The CSS labels and the HUD add no draw calls.

## Results

Measured on 16 October 2026 on the merged phase 2 plant at `c4af915` (every lane merged, including the scene-g1 fixes: carton and tray tokens, rack loads from the stock KPI, the longer apron). 33 machines, a production build served by `vite preview`, in headless Chromium 141.0.7390.37. The first baseline, at `1700d82` before the scene-g1 fixes, read 179 draw calls and 104,810 triangles at the overview: the tokens add 2 draw calls and about 1,300 triangles, and the now empty racks (0 pallets in stock on the static plant) save 3 draw calls and about 7,500 triangles.

The machine: a Linux 6.18 x64 VM, `nproc` 4, CPU `Intel(R) Xeon(R) Processor @ 2.10GHz` (from `/proc/cpuinfo`), 16 GB RAM, no GPU, Node 22.22.0. No other browser ran during the measurement. The load average of about 3.5 to 4 is the measurement's own SwiftShader threads.

### Draw calls and triangles

These are the same on any GPU.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **178** | **98,558** | **178** | **98,558** |
| 1 Standardization | 83 | 58,052 | 83 | 58,052 |
| 2 Preheating | 81 | 57,996 | 81 | 57,996 |
| 3 Homogenization | 83 | 57,864 | 83 | 57,864 |
| 4 UHT | 89 | 66,964 | 90 | 67,020 |
| 5 Flash cooling | 83 | 64,948 | 83 | 64,948 |
| 6 Aseptic tank | 73 | 56,108 | 73 | 56,108 |
| 7 Filling | 88 | 60,840 | 89 | 61,068 |
| 8 Packaging | 94 | 67,462 | 95 | 67,630 |
| 9 Quarantine & QA | 108 | 82,604 | 114 | 83,860 |
| 10 Warehouse | 118 | 71,332 | 122 | 76,060 |

The overview uses 178 draw calls, about half the budget of 350. Each stage stop draws fewer, because the camera's frustum leaves most of the plant out. 1280 × 720 is the browser tests' viewport; its wider view takes in a little more at some stops. With stock in the racks (`?mock`, about 300 pallets) the overview reads about 181 draw calls and 110,000 triangles.

The table shows the settled scene. In the first frames the overview reads about 179 draw calls and 76,710 triangles; the Kenney conveyor pieces and the vehicles then replace their grey boxes and the counts settle within about a second.

### Frame rate: software GL only, not representative

> **These numbers come from SwiftShader, Chromium's software renderer, running on the CPU of a VM with no GPU. They say nothing about the 60 fps target.** WebGL renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.

| Camera | fps, 1440 × 900 | fps, 1280 × 720 |
|---|---:|---:|
| Overview | 7.4 | 7.7 |
| 1 Standardization | 9.4 | 12.3 |
| 2 Preheating | 10.2 | 12.4 |
| 3 Homogenization | 9.3 | 12.9 |
| 4 UHT | 8.8 | 11.3 |
| 5 Flash cooling | 9.7 | 12.3 |
| 6 Aseptic tank | 11.5 | 14.8 |
| 7 Filling | 8 | 11 |
| 8 Packaging | 6.5 | 9.1 |
| 9 Quarantine & QA | 9.2 | 11.3 |
| 10 Warehouse | 7 | 8.7 |

Software GL draws every pixel on the CPU, so the frame rate follows the pixel count and whatever else the machine is doing more than the draw calls. Two pages rendering at once, as in a parallel Playwright run, roughly halve each other's frame rate on this machine, so `playwright.config.ts` runs the browser tests one page at a time.

## To do on a real GPU

G1 asks for 60 fps on the grey-box plant on a mid-range laptop. Only the developer can sign that, on real hardware:

1. On the laptop, plugged in, with other heavy apps closed: `npm ci`, `npm run build`, then `node tests/perf/measure.mjs 5505 --headed --channel chrome`. Headed Chrome uses the GPU; headless Chromium can fall back to software GL. Without Chrome installed, leave out `--channel chrome`, keep `--headed`, and check the renderer as in step 2.
2. In the JSON, check that `gl.renderer` names the real GPU and that `gl.software` is `false`. `fpsTargetMet` then gives the verdict for the overview (59 fps or more). Read the stage stops too: the warehouse (stage 10) and the packaging hall (stage 8) are the slowest stops here.
3. Without the script: open the app with `?debug` in a normal Chrome window at the laptop's usual size, wait a few seconds, run `__scene.fps()` in the console at the overview, then click stages 8 and 10 on the rail and run it again at each.
4. Record in this file: the laptop model, the GPU, the browser and its version, the screen's size, scaling and refresh rate, the window size, and the fps at the overview and at each stop. On a 60 Hz screen, 60 fps is the ceiling, so 59 to 60 is a pass.

If the laptop falls short, look first at the shadow map (2048 px with a soft radius, in `src/scene/world.ts`) and at the pixel ratio, which is capped at 2. Draw calls are not the problem at 178.
