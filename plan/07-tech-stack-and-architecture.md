[Index](README.md) · Part 7 of 11 · [Review](REVIEW.md)

# Tech stack & architecture

Use three.js with Vite and TypeScript, keep the simulation core free of 3D code, and let the 3D view and the UI read one shared state snapshot every frame.

| Need | Choice | Why |
|---|---|---|
| 3D engine | [three.js](https://github.com/mrdoob/three.js/releases) r186, npm package `three` | Latest release, September 2026 |
| Build and dev server | [Vite](https://threejs.org/manual/en/installation.html) | The three.js manual's recommended setup: `npm install --save three`, `npm install --save-dev vite`, `npx vite` |
| Language | TypeScript (plain JavaScript also works) | Types catch unit mix-ups such as L/h versus L/s |
| Camera | [OrbitControls](https://threejs.org/docs/OrbitControls.html) + a scripted tour | Free look plus guided stage-by-stage flights |
| Labels | [CSS2DRenderer](https://threejs.org/docs/CSS2DRenderer.html) | HTML labels stay sharp and clickable |
| Cartons, trays, pallets | [InstancedMesh](https://threejs.org/docs/InstancedMesh.html) | Thousands of copies in one draw call |
| Pipes | [TubeGeometry](https://threejs.org/docs/TubeGeometry.html) along curves | One mesh per pipe run, recoloured by temperature |
| Models | Blender → GLB → [GLTFLoader](https://threejs.org/docs/GLTFLoader.html) | Standard web 3D format |
| Debug sliders | [lil-gui](https://lil-gui.georgealways.com/) | Floating panel to change set points live |
| Live charts | [Chart.js](https://www.chartjs.org/) | Trend lines for temperature, tank level, OEE |
| Tests | [Vitest](https://vitest.dev/) | Vite-native; tests for F0, mass balance and the event queue |
| Hosting | GitHub Pages or Vercel | One link to share with your teacher |

> **Review note:** TypeScript only catches L/h versus L/s with branded unit types. Pin the three.js version npm installs, and set Vite's `base` for GitHub Pages. See [R8](REVIEW.md#r8-units-in-typescript) and [R11](REVIEW.md#r11-versions-and-hosting).

![Architecture. plant.json (default settings) and user input (commands: speed, set points, fault triggers) feed the simulation core in src/sim, which has no three.js imports. Inside it, the clock and event queue drive the models (liquid line 1–6, filler 7, packaging 8, quality 9, warehouse 10), and scenarios inject faults into the models. Each frame one snapshot goes to the 3D view (src/scene: machines, pipe colours, carton tokens, renderer) and to the UI (src/ui: HUD, info panel, charts, guided tour). Clicks and sliders on the UI loop back as user input.](images/architecture.png)

*architecture · src/ folders and data flow per frame*

Because the core is plain TypeScript with no 3D code, Vitest can test it without a browser.

## Folder structure

```text
src/
  main.ts            boot: load config, start the frame loop
  sim/
    clock.ts         sim time, speed, pause
    eventQueue.ts    priority queue of timed events
    liquidLine.ts    stages 1–6: flows, temperatures, levels, F0/B*, divert
    filler.ts        stage 7: one state machine per filler
    packaging.ts     stage 8: trays, pallets, SSCC numbers
    quality.ts       stage 9: batches, samples, incubation
    warehouse.ts     stage 10: stock, FEFO picking, trucks
    scenarios.ts     fault injection
  scene/
    world.ts         renderer, lights, floor, cameras
    equipment/       one class per machine: build() + update(snapshot)
    pipes.ts         tubes, flow texture, temperature colour
    tokens.ts        InstancedMesh cartons, trays, pallets
  ui/
    hud.ts  panel.ts  charts.ts  tour.ts
  data/
    plant.json       the default settings from the Simulation model section
```

## Every frame

1. Turn UI input into commands: speed, set points, scenario triggers.
2. Advance the sim: continuous steps, then every event that is due.
3. Build a plain-object snapshot of the plant state.
4. Update the 3D scene from the snapshot: machines, pipe colours, carton tokens.
5. Update the HUD and charts, throttled to 4 times a second.
6. Render.

## Performance budget

- 60 fps on a mid-range laptop.
- One `InstancedMesh` per carton, tray and pallet type; merge static pipes and floors.
- One shadow-casting light; bake ambient occlusion into the hero models in Blender.

---

← [6. Simulation model](06-simulation-model.md) · [8. User interface](08-user-interface.md) →
