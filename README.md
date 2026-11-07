# UHT Milk Plant Simulation

A browser-based 3D simulation of a UHT milk plant in three.js, from standardization to ambient distribution: ten stages running live, six fault scenarios, and a guided tour. Beside it, a yogurt wing (Line P8, stages 11–16) runs from its own silo to reefer trucks, with five faults of its own and a yogurt tour. The research, design and schedule are in [plan/](plan/README.md); the build is split into phases and agents in [plan/agent-plan/](plan/agent-plan/README.md).

**Live:** <https://sophanit-keo.github.io/simulation-milk-process/>, deployed to GitHub Pages from `master` each time CI passes there. It needs a browser with WebGL 2; it is checked in Chrome and Edge.

## Use it

- **Pick a stage** in the list on the left, or click a machine in the 3D view: the panel on the right explains it and shows its live values. Drag to orbit, scroll to zoom, Esc for the whole plant.
- **The end of the line** (stages 8 and 10, best at ×1 or ×10): the palletizer robot picks each tray off the belt and stacks it layer by layer, the stretch wrapper winds film round each pallet, one forklift puts released pallets away into the racks and the other loads the docked truck (an electric counterbalance truck with its operator: the mast tilts back with the load, the rear wheels steer, each round its own circle and set before it moves off, a blue spot leads it, and its label says what it does; [D24](plan/DECISIONS.md#d24-the-forklifts-in-detail)), and trucks back up to the dock articulated, open their doors, fill and drive off ([D22](plan/DECISIONS.md#d22-lifelike-motion-at-the-end-of-the-line), [phase 12](plan/agent-plan/phase-12-lifelike-motion.md)).
- **The yogurt line** (stages 11–16, the second group in the stage list): mix, heat treatment at 92 °C, three fermentation tanks, the P8 buffer, Line P8 filling 21,600 cups an hour under its HEPA hood, then trays, pallets, the warm room for set yogurt, the blast chiller, the cold room and the reefer dock. The day runs plain stirred, strawberry stirred and plain set yogurt, a shift each; the stage 11 panel picks the next shift's product ([D25](plan/DECISIONS.md#d25-the-yogurt-line-line-p8)–[D30](plan/DECISIONS.md#d30-the-yogurt-lines-fault-scenarios), [plan 12](plan/12-yogurt-line.md)).
- **Process flow** (in each yogurt stage's panel): the stage's equipment step by step, what happens at each and its live reading, on a track whose dots run with the product: red where it diverts or stops, faded where this shift's product skips it ([phase 22](plan/agent-plan/phase-22-yogurt-process-flow.md)).
- **The yogurt machines in motion** (stages 11–16, best at ×1): the mixer's rotor spins, the homogenizer's pistons stroke, the heat exchanger's packs show their temperatures, each fermentation tank's sight glass shows the mix turning to yogurt, the pumps stroke, P8's coder and gates flash, and the cold room's fans stop when its cooling fails ([phase 23](plan/agent-plan/phase-23-yogurt-machines-in-motion.md)).
- **The yogurt pallet line** (stage 16, best at ×1 or ×10): a gantry palletizer lifts each tray of 24 cups off the infeed and stacks 120 on a pallet, 8 a layer; the full pallet rides to the stretch wrapper, turns 8 times while the film climbs it, and rides on to the staging row, as a fresh pallet slides on from the dispenser ([phase 24](plan/agent-plan/phase-24-yogurt-palletizer-wrapper.md)).
- **The yogurt process hall in detail** (stages 12–14, best at ×1, zoomed in): the deaerator's and the homogenizer's gauges read their vacuum and pressures, the homogenizer's flywheel turns with its pistons, the hot-water set's steam valve opens with the steam, the CCP recorder's pen writes the holding cell's outlet and turns red under 85 °C, and the valve matrix opens each tank's inlet as it fills and its outlet as it empties ([phase 25](plan/agent-plan/phase-25-yogurt-process-hall-detail.md)). Each machine carries its fittings: manways, flanges, probes and nameplates, the homogenizer's control cabinet, whose screen lights while it runs, and each fermentation tank's jacket valve, open to warm water while it ferments and to chilled water once it is ready ([phase 26](plan/agent-plan/phase-26-yogurt-hall-machines-detail.md)).
- **Time:** pause and the speeds ×1 to ×10,000 in the top bar (Space and the keys 1–5); "Next event" jumps to the next thing that happens.
- **Scenarios** (top bar): start any of the UHT line's six faults or the yogurt line's five (a stalled fermentation, the heat treatment under temperature, a seal drift, a HEPA loss, a cold-room excursion), reset them, or read the scenario log, which tells what happened and why.
- **Report in Let Report** (on a fault's banner and in the scenario log): opens [Let Report](https://let-report.vercel.app), the QC/QA trouble-report app, in a new tab, with its new-report form filled in for that fault: category, severity, product and what happened ([D18](plan/DECISIONS.md#d18-reporting-a-fault-in-let-report)). You sign in, sign and send it there; the simulation writes nothing to Let Report itself.
- **Tour** (top of the stage list): the ten stages in about 3 minutes. **Tour** on the yogurt group's header: stages 11–16 in about 2 minutes.
- **About** (next to the title): what the model is and isn't, and its sources.
- **Factory** (next to About): the factory board, `factory.html`. Sign in with a Let Report account to see the real factory live: UHT 1, 2 and 3, the lines each one feeds, and each line's status, product, lot, CIP and open troubles, as Let Report holds them. A change in Let Report shows within a second ([D19](plan/DECISIONS.md#d19-the-factory-board), [phase 9](plan/agent-plan/phase-9-factory-board.md)). Which UHT feeds a line, its filler, speed and pack size are edited in Let Report.
  - **3D** (on the board, next to Board): the same factory on a floor in 3D: each UHT plant with its aseptic tank and its lines' fillers, packs riding the running lines' belts and milk flowing in their pipes, with the board's lamps and words. Click a machine or its label to fly to it and mark its card, or "Show in 3D" on a card; Esc for the whole floor. `factory.html#3d` opens it ([D20](plan/DECISIONS.md#d20-the-factory-floor-in-3d), [phase 10](plan/agent-plan/phase-10-factory-floor.md)).

The plant opens the same way every time: day 8 at 06:00, ×10, seed 81006. URL options: `?mock` runs the UI on the mock snapshot, `?debug` adds lil-gui and `window.__scene`, `?greybox` shows the grey boxes instead of the hero models.

## Run it

Needs Node 22.13 or later (22.x LTS or 24.x; see `.nvmrc`).

```sh
npm ci
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (CI sets BASE_PATH=/simulation-milk-process/ for GitHub Pages)
npm run preview    # serves dist/
```

## Test it

```sh
npm run check      # typecheck, lint, unit tests (Vitest) and asset tests: what CI runs first
npm test           # unit tests only: formulas, acceptance runs, the 60-day run, scenarios, both demo scripts
npm run test:assets  # the 3D models and textures against their specs and budgets
npm run e2e        # browser tests (Playwright, Chromium); `npx playwright install chromium` once
```

Performance (needs a build, see [tests/perf/baseline.md](tests/perf/baseline.md)):

```sh
npm run build
node tests/perf/measure.mjs                                    # draw calls, triangles and fps at every stage
node tests/perf/measure.mjs --path 60 --headed --channel chrome  # the 60 fps check: a 60 s camera path at ×1 and ×10,000
```

## Documents

| Document | What |
|---|---|
| [docs/report.md](docs/report.md) | The report, with the technical chapter |
| [docs/demo-script.md](docs/demo-script.md) | The live demo, step by step, with the numbers to expect |
| [docs/video-script.md](docs/video-script.md) | The demo video's shots and narration |
| [docs/slides.md](docs/slides.md) | The presentation, slide by slide |
| [plan/12-yogurt-line.md](plan/12-yogurt-line.md) | The yogurt line (Line P8), planned as stages 11–16 in phases 15–21, from the [P8 SOP](plan/yogurt-sop-p8.md); schedule in the [roadmap](plan/09-development-roadmap.md#the-yogurt-line-phases-1521) |
| [plan/DECISIONS.md](plan/DECISIONS.md), [plan/hand-calculations.md](plan/hand-calculations.md) | Every default with its source, and every expected value the tests check |

## Layout

| Path | What | Owner agent |
|---|---|---|
| `src/contracts/` | Types every part shares: `PlantConfig`, `Snapshot`, `Command`, `ViewEvent`, units | `lead` |
| `src/data/plant.json` | Default settings; decisions in [plan/DECISIONS.md](plan/DECISIONS.md) | `process` |
| `src/sim/` | Simulation core: clock, event queue, models, fault scenarios. No three.js, no DOM | `sim` |
| `src/scene/` | 3D view | `scene` |
| `src/ui/`, `src/styles/`, `index.html` | Screen layout and controls | `ui` |
| `public/models/`, `assets/` | 3D assets and their licences | `assets` |
| `factory.html`, `src/factory/` | The factory board: contracts (`types.ts`, `view.ts`), the Let Report client, the model, the floor's layout, the page; no three.js until its 3D view (`src/factory/scene/`) opens | `lead`, `factory-client`, `factory-model`, `factory-scene`, `factory-ui` |
| `tests/`, `e2e/` | Unit and browser tests, and the perf check | `qa` |
| `docs/` | Report, demo and video scripts, slides | `lead`, `process` |

The agents' definitions (phases 9 to 12) are in `.claude/agents/`.
