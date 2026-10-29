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

Measured on 17 October 2026 on the merged phase 2 plant at `660a30d`, after the G1 review's fixes (33 machines, a production build served by `vite preview`, in headless Chromium 141.0.7390.37). Earlier baselines: at `1700d82`, before the carton and tray tokens and the empty racks, the overview read 179 draw calls and 104,810 triangles; at `c4af915` it read 178 and 98,558, as now. The review fixes changed only the stage stops: the KPI strip gained a line of secondary values (74 px tall at these sizes, 55 px before), so the 3D view is a little shorter and some stops take in a little more of the plant.

The machine: a Linux 6.18 x64 VM, `nproc` 4, CPU `Intel(R) Xeon(R) Processor @ 2.10GHz` (from `/proc/cpuinfo`), 16 GB RAM, no GPU, Node 22.22.0. No other browser ran during the measurement. The load average of about 3.5 to 4 is the measurement's own SwiftShader threads.

### Draw calls and triangles

These are the same on any GPU.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **178** | **98,558** | **178** | **98,558** |
| 1 Standardization | 83 | 58,052 | 83 | 58,052 |
| 2 Preheating | 81 | 57,996 | 83 | 58,064 |
| 3 Homogenization | 83 | 57,864 | 83 | 57,864 |
| 4 UHT | 90 | 67,020 | 90 | 67,020 |
| 5 Flash cooling | 83 | 64,948 | 83 | 64,948 |
| 6 Aseptic tank | 73 | 56,108 | 73 | 56,108 |
| 7 Filling | 88 | 60,840 | 89 | 61,068 |
| 8 Packaging | 94 | 67,462 | 95 | 67,630 |
| 9 Quarantine & QA | 112 | 83,680 | 115 | 83,872 |
| 10 Warehouse | 119 | 71,856 | 126 | 77,260 |

The overview uses 178 draw calls, about half the budget of 350. Each stage stop draws fewer, because the camera's frustum leaves most of the plant out. 1280 × 720 is the browser tests' viewport; its wider view takes in a little more at some stops. With stock in the racks (`?mock`, about 300 pallets) the overview reads about 181 draw calls and 110,000 triangles.

The table shows the settled scene. In the first frames the overview reads about 179 draw calls and 76,710 triangles; the Kenney conveyor pieces and the vehicles then replace their grey boxes and the counts settle within about a second.

### Phase 3: the live liquid line

Re-measured on 18 October 2026 on the `scene` lane's phase 3 work (stages 1–6 live from the snapshot), same machine, browser and method, on the static plant (no `?mock`). The live line adds 10 draw calls at the overview: a milk bar on each of the three level gauges (two silos, the mixing tank), the deaerator's sight glass and its instanced bubbles, two gauge needles on the homogenizer, the instanced steam puffs and vapour plume, and the divert valve's lamp. None of them casts a shadow. The heat exchanger's glow and the lit divert route change materials only, not draw calls. The bubbles, puffs and plume are hidden, and drawn by nobody, while their stream is off (no flow, or not producing).

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **188** | **105,046** | **188** | **105,046** |
| 1 Standardization | 89 | 64,108 | 89 | 64,108 |
| 2 Preheating | 85 | 64,036 | 87 | 64,104 |
| 3 Homogenization | 89 | 63,928 | 89 | 63,928 |
| 4 UHT | 95 | 73,368 | 96 | 73,380 |
| 5 Flash cooling | 87 | 71,284 | 87 | 71,284 |
| 6 Aseptic tank | 76 | 62,092 | 76 | 62,092 |
| 7 Filling | 91 | 66,824 | 92 | 67,052 |
| 8 Packaging | 97 | 73,446 | 98 | 73,614 |
| 9 Quarantine & QA | 117 | 89,688 | 121 | 89,936 |
| 10 Warehouse | 128 | 77,992 | 136 | 83,748 |

The frame rates of this run are left out: other lanes' browsers shared the machine (load average about 18), so they say nothing about the scene. The software-GL figures below are still those of phase 2.

### Phase 3: the merged build

Re-measured on 19 October 2026 by `qa` on the merged phase 3 build at `6c275fb` (contracts v2, the live sim, the `scene`, `ui`, `assets` and `process` work and the "About this model" dialog), same machine, browser and method, on the live sim (no `?mock`), a production build served by `vite preview`. 33 machines; no console errors or failed requests; within the overview budget.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **188** | **105,046** | **188** | **105,046** |
| 1 Standardization | 89 | 64,108 | 89 | 64,108 |
| 2 Preheating | 85 | 64,036 | 90 | 64,284 |
| 3 Homogenization | 89 | 63,928 | 91 | 68,376 |
| 4 UHT | 95 | 73,368 | 97 | 73,428 |
| 5 Flash cooling | 87 | 71,284 | 88 | 71,340 |
| 6 Aseptic tank | 76 | 62,092 | 76 | 62,092 |
| 7 Filling | 91 | 66,824 | 92 | 67,052 |
| 8 Packaging | 97 | 73,446 | 99 | 77,562 |
| 9 Quarantine & QA | 117 | 89,688 | 130 | 90,456 |
| 10 Warehouse | 128 | 77,992 | 137 | 83,916 |

The overview holds at 188 draw calls, the `scene` lane's figure, a little over half the budget of 350; at 1440 × 900 every stop matches the `scene` lane's table. At 1280 × 720 some stops take in a few more machines than in that table (stage 9: 130 draw calls, 121 before). That table was measured on the `scene` lane's branch, before the `ui` lane's panels and event-log card were merged; the layout around the 3D view, and so the part of the plant each stage camera frames at this size, has changed since. In the first frames at 1280 × 720 the overview read 189 draw calls and 83,198 triangles before the Kenney pieces and vehicles settled.

Frame rates are again left out: other lanes' builds and browser tests shared the 4 cores (load average 18 to 19), and the readings (1 to 4 fps) measure that, not the scene. **The 60 fps exit criterion stays open** until it is measured on a real GPU ([To do on a real GPU](#to-do-on-a-real-gpu)).

### Phase 4: packs to trucks

Measured on 27 October 2026 by `qa` on the phase 4 branch (after `74323b9`, with the hero flag and the KPI fixes; contracts v3, the live packs model and the stage 7–10 scene), same machine and method, a production build served by `vite preview`, on the live sim without `?heroes`. The project's Playwright (1.56) has no matching headless shell on this machine, so the script ran on the installed Chromium 153 through a local copy with `executablePath`; that browser also asks for `/favicon.ico`, which the app does not have, and its 404 is the one console error the script reported (exit code 1). The app itself logged none. 33 machines; within the overview budget.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **194** | **187,786** | **194** | **187,786** |
| 1 Standardization | 92 | 103,744 | 92 | 103,744 |
| 2 Preheating | 88 | 103,672 | 90 | 103,740 |
| 3 Homogenization | 90 | 100,516 | 90 | 100,516 |
| 4 UHT | 98 | 110,196 | 99 | 110,208 |
| 5 Flash cooling | 90 | 108,112 | 90 | 108,112 |
| 6 Aseptic tank | 79 | 98,920 | 79 | 98,920 |
| 7 Filling | 95 | 103,856 | 95 | 103,856 |
| 8 Packaging | 102 | 110,250 | 103 | 110,418 |
| 9 Quarantine & QA | 122 | 171,420 | 129 | 174,776 |
| 10 Warehouse | 129 | 115,624 | 139 | 121,620 |

Six draw calls more than phase 3 at the overview: the moving packs, trays and pallets, the quarantine blocks and their lamps, and the trucks are instanced meshes of a draw or two each. The triangles grow by about 83,000, most of them the 2,453 pallets on hold at the opening (one instance of 12 triangles each, drawn in both passes) and the stock in the racks; that is still under the 300,000 a frame the asset budget plans for ([assets/README.md](../../assets/README.md#budgets)). The first frames read 193 draw calls and 165,914 triangles, before the Kenney pieces and vehicles replaced their grey boxes. Software GL gave 3.9 fps at the overview at 1440 × 900 (4.3 at 1280 × 720), against 7.2 in phase 2, with the measurement's own SwiftShader threads the only load (load average 3.9): the triangles cost a CPU renderer more than a GPU. **The G2 item "60 fps with tokens on screen" stays open** until it is measured on a real GPU ([To do on a real GPU](#to-do-on-a-real-gpu)).

### Phase 5: hero models

Measured on 27 October 2026 by `qa` on the phase 5 branch (contracts v4, the fault scenarios, and the four hero models loaded by default: AO baked into the vertex colours, meshopt geometry), same machine and method, a production build served by `vite preview`, on the live sim with no scenario running. As in phase 4 the script ran on the installed Chromium 153 through a local copy with `executablePath`, and that browser's request for `/favicon.ico` is the one console error it reported (exit code 1); the app logged none. 33 machines; within the overview budget.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **207** | **232,346** | **207** | **232,346** |
| 1 Standardization | 105 | 129,940 | 105 | 129,940 |
| 2 Preheating | 101 | 129,708 | 102 | 129,720 |
| 3 Homogenization | 102 | 126,944 | 102 | 126,944 |
| 4 UHT | 109 | 136,400 | 111 | 136,636 |
| 5 Flash cooling | 103 | 129,912 | 103 | 129,912 |
| 6 Aseptic tank | 92 | 120,720 | 92 | 120,720 |
| 7 Filling | 106 | 137,576 | 106 | 137,576 |
| 8 Packaging | 116 | 138,894 | 117 | 139,062 |
| 9 Quarantine & QA | 133 | 202,888 | 140 | 211,616 |
| 10 Warehouse | 141 | 146,448 | 151 | 152,444 |

The same build with `?greybox` reads exactly phase 4's figures (overview 194 draw calls and 187,786 triangles at 1440 × 900), so the difference is the heroes': 13 draw calls more at the overview, as each hero mesh draws in the main and the shadow pass (29 meshes, the filler's glass casting no shadow), against the grey boxes' merged parts; and 44,560 triangles more, the heroes' 24,204 a pass drawn twice, less the grey boxes they hide. The first frames read 206 draw calls and 210,474 triangles, before the Kenney pieces and vehicles replaced their grey boxes. A first cut of the heroes with 0.12 m AO cells read 280,986 triangles at the overview, close to the 300,000 a frame the asset budget plans for; the 0.2 m cells shipped give the same shading at the stage cameras for half the triangles ([hero-specs.md](../../assets/hero-specs.md#phase-5-final-models)). Software GL gave 4.1 fps at the overview at 1440 × 900 (4.3 at 1280 × 720) against 4.2 with `?greybox` measured the same way, load average about 4. **The exit item "60 fps holds" stays open** until it is measured on a real GPU ([To do on a real GPU](#to-do-on-a-real-gpu)).

### Phase 6: the 60 fps check and the step time

**The camera path (gate G3).** `node tests/perf/measure.mjs --path 60` adds the G3 check to the usual stops: from the whole plant, a click on every stage in rail order, 6 s at each (the 1.2 s flight included), 60 s in all, once at ×1 and once at ×10,000, with every frame's time noted by a `requestAnimationFrame` loop of the script's own. It reports each run's average fps, its 1% low (the mean fps of the slowest 1% of frames) and its slowest frame, and `pathTargetMet` is true when both runs reach an average of 57 fps (within 5% of a 60 Hz screen, which caps the rate) and a 1% low of 30 fps. On software GL it gives no verdict (`null`), and a miss on a real GPU makes the exit code 1.

Run on 27 October 2026 on this machine (software GL, headless Chromium 153, 1440 × 900, the phase 6 build), only to check that the script works:

| Speed | Frames in 60 s | Average fps | 1% low fps | Slowest frame |
|---|---:|---:|---:|---:|
| ×1 | 414 | 5.0 | 2.7 | 400 ms |
| ×10,000 | 403 | 4.9 | 2.7 | 400 ms |

The two speeds draw alike: at ×10,000 the sim advances 7 days a minute but the scene shows a sample of the packs and pallets, so the frame costs about the same. **The G3 check itself runs on the target laptop**: `npm run build`, then `node tests/perf/measure.mjs --path 60 --headed --channel chrome`, and again with `--channel msedge`.

**The sim's step time.** Headless in Node (`createSim`, the shipped config), 3,600 frames of 1/60 s, step and snapshot timed together as the app's loop runs them:

| Speed | Sim time per frame | Mean | 99th percentile | Slowest |
|---|---:|---:|---:|---:|
| ×10 | 0.17 s (1 step of 1 s every 6 frames) | 0.03 ms | 0.15 ms | 2.7 ms |
| ×1,000 | 16.7 s (17 steps of 1 s) | 0.08 ms | 0.40 ms | 4.5 ms |
| ×10,000 | 167 s (17 steps of 10 s) | 0.06 ms | 0.26 ms | 1.2 ms |

At ×10,000 the 60 s covered 7.5 sim days. The sim takes well under 1% of a 16.7 ms frame at every speed; the frame time is the renderer's.

### Phase 7: the CIP station

Measured on 27 October 2026 on the phase 7 branch (contracts v5, the CIP station and the CIP lines), same machine, browser and method as phase 5, on the live sim with no scenario running. 34 machines; within the overview budget; no console errors.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **221** | **242,154** | **221** | **242,154** |
| 1 Standardization | 109 | 134,520 | 109 | 134,520 |
| 2 Preheating | 106 | 136,440 | 107 | 136,452 |
| 3 Homogenization | 107 | 133,676 | 107 | 133,676 |
| 4 UHT | 122 | 146,040 | 125 | 146,444 |
| 5 Flash cooling | 117 | 139,720 | 117 | 139,720 |
| 6 Aseptic tank | 98 | 127,716 | 100 | 127,932 |
| 7 Filling | 110 | 142,156 | 110 | 142,156 |
| 8 Packaging | 120 | 143,474 | 121 | 143,642 |
| 9 Quarantine & QA | 141 | 212,048 | 148 | 220,776 |
| 10 Warehouse | 147 | 154,720 | 162 | 161,868 |

14 draw calls more than phase 5 at the overview: the station's steel body and its pump (each in the main and the shadow pass), a band and a lamp per tank (main pass only: they sit on the tanks, inside their shadow; casting their own read 224), and the CIP supply and return lines (both passes). The shadow pass draws the body, the pump and the two lines from any camera, so every stop draws at least 4 more; stages 4 and 5 frame the station itself. Cleaning changes colours and a shader uniform only, not draw calls. Software GL gave 3.0 fps at the overview at 1440 × 900 (3.7 at 1280 × 720), at a load average of about 4.5 against phase 5's 4: not comparable, and not the 60 fps check, which runs on the target laptop.

### Phase 8: the boiler house's plume

Measured on 29 October 2026 on the phase 8 branch (contracts v6, the live boiler house), a production build served by `vite preview`, in headless Chromium 153.0.8010.12 on SwiftShader, on the live sim with no scenario running. 34 machines; within the overview budget; no console errors.

| Camera | Draw calls, 1440 × 900 | Triangles, 1440 × 900 | Draw calls, 1280 × 720 | Triangles, 1280 × 720 |
|---|---:|---:|---:|---:|
| **Overview** | **222** | **244,266** | **222** | **244,266** |
| 1 Standardization | 110 | 136,632 | 110 | 136,632 |
| 2 Preheating | 107 | 138,552 | 108 | 138,564 |
| 3 Homogenization | 108 | 135,788 | 108 | 135,788 |
| 4 UHT | 123 | 148,152 | 126 | 148,556 |
| 5 Flash cooling | 118 | 141,832 | 118 | 141,832 |
| 6 Aseptic tank | 99 | 129,828 | 101 | 130,044 |
| 7 Filling | 111 | 144,268 | 111 | 144,268 |
| 8 Packaging | 121 | 145,586 | 122 | 145,754 |
| 9 Quarantine & QA | 142 | 214,160 | 149 | 222,888 |
| 10 Warehouse | 148 | 156,832 | 163 | 163,980 |

One draw call and 2,112 triangles more than phase 7 at every camera: the chimney's plume, six puffs in one `InstancedMesh` (main pass only, as the flash vessel's vapour). Its copies move, so it is not frustum-culled, and it shows from any camera whenever the boiler burns gas, nearly all the time. Software GL gave 3.8 fps at the overview at 1440 × 900 (3.9 at 1280 × 720), at a load average of about 4: as phase 7's, and not the 60 fps check, which runs on the target laptop.

### Frame rate: software GL only, not representative

> **These numbers come from SwiftShader, Chromium's software renderer, running on the CPU of a VM with no GPU. They say nothing about the 60 fps target.** WebGL renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.

| Camera | fps, 1440 × 900 | fps, 1280 × 720 |
|---|---:|---:|
| Overview | 7.2 | 8 |
| 1 Standardization | 9 | 11.3 |
| 2 Preheating | 8.9 | 12.4 |
| 3 Homogenization | 8.1 | 11.2 |
| 4 UHT | 7.6 | 10.1 |
| 5 Flash cooling | 7.4 | 10.4 |
| 6 Aseptic tank | 9.9 | 13.1 |
| 7 Filling | 7.4 | 9 |
| 8 Packaging | 5.6 | 8 |
| 9 Quarantine & QA | 8.7 | 9.6 |
| 10 Warehouse | 5.9 | 8.5 |

Software GL draws every pixel on the CPU, so the frame rate follows the pixel count and whatever else the machine is doing more than the draw calls. Two pages rendering at once, as in a parallel Playwright run, roughly halve each other's frame rate on this machine, so `playwright.config.ts` runs the browser tests one page at a time.

## To do on a real GPU

G1 asks for 60 fps on the grey-box plant on a mid-range laptop. Only the developer can sign that, on real hardware:

1. On the laptop, plugged in, with other heavy apps closed: `npm ci`, `npm run build`, then `node tests/perf/measure.mjs 5505 --headed --channel chrome`. Headed Chrome uses the GPU; headless Chromium can fall back to software GL. Without Chrome installed, leave out `--channel chrome`, keep `--headed`, and check the renderer as in step 2.
2. In the JSON, check that `gl.renderer` names the real GPU and that `gl.software` is `false`. `fpsTargetMet` then gives the verdict for the overview (59 fps or more). Read the stage stops too: the warehouse (stage 10) and the packaging hall (stage 8) are the slowest stops here.
3. Without the script: open the app with `?debug` in a normal Chrome window at the laptop's usual size, wait a few seconds, run `__scene.fps()` in the console at the overview, then click stages 8 and 10 on the rail and run it again at each.
4. Record in this file: the laptop model, the GPU, the browser and its version, the screen's size, scaling and refresh rate, the window size, and the fps at the overview and at each stop. On a 60 Hz screen, 60 fps is the ceiling, so 59 to 60 is a pass.

If the laptop falls short, look first at the shadow map (2048 px with a soft radius, in `src/scene/world.ts`) and at the pixel ratio, which is capped at 2. Draw calls are not the problem at 178.
