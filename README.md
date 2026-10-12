# UHT Milk Plant Simulation

A browser-based 3D simulation of a UHT milk plant in three.js, from standardization to ambient distribution. The research, design and schedule are in [plan/](plan/README.md); the build is split into phases and agents in [plan/agent-plan/](plan/agent-plan/README.md).

## Run it

Needs Node 22.13 or later (22.x LTS or 24.x; see `.nvmrc`).

```sh
npm ci
npm run dev        # http://localhost:5173 (add ?mock to run on the mock snapshot)
npm run check      # typecheck, lint and unit tests
npm run e2e        # browser smoke test (Playwright, Chromium)
npm run build      # production build for GitHub Pages, in dist/
```

## Layout

| Path | What | Owner agent |
|---|---|---|
| `src/contracts/` | Types every part shares: `PlantConfig`, `Snapshot`, `Command`, `ViewEvent`, units | `lead` |
| `src/data/plant.json` | Default settings; decisions in [plan/DECISIONS.md](plan/DECISIONS.md) | `process` |
| `src/sim/` | Simulation core: clock, event queue, models. No three.js, no DOM | `sim` |
| `src/scene/` | 3D view | `scene` |
| `src/ui/`, `src/styles/`, `index.html` | Screen layout and controls | `ui` |
| `public/models/`, `assets/` | 3D assets and their licences | `assets` |
| `tests/`, `e2e/` | Unit and browser tests | `qa` |
