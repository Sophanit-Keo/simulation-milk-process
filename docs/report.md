[README](../README.md) · Report · [Demo script](demo-script.md) · [Video script](video-script.md) · [Slides](slides.md)

# UHT milk plant simulation: report

A browser-based 3D simulation of one UHT milk plant, from the raw-milk silo to the truck, built over twelve weeks in six phases ([roadmap](../plan/09-development-roadmap.md)). This report gathers what was built, how it works, how it was checked and what it leaves out. Its technical chapter is `process`'s ([phase 6](../plan/agent-plan/phase-6-polish-and-present.md)); `lead` assembled the rest.

## 1. Goal and scope

The simulation teaches how the stages of a UHT plant depend on each other: what the aseptic buffer tank absorbs, when the plant must divert, and how a fault travels down the line to the warehouse ([goal and scope](../plan/01-goal-and-scope.md)). It runs in a browser with no install, from one link.

It covers ten stages: standardization, preheating and deaeration, homogenization, UHT treatment, flash cooling, aseptic storage, aseptic packaging, secondary packaging and palletization, quarantine and QA, and warehousing with distribution. It is a teaching model: the numbers come from published sources or are marked as assumptions, and it does not predict the output of any real plant.

## 2. Technical chapter

### 2.1 Architecture

The app is TypeScript built with Vite, with three.js r186 for the 3D view ([tech stack](../plan/07-tech-stack-and-architecture.md)). The code has four layers, and only one-way imports between them:

| Layer | Folder | What it does | Rule |
|---|---|---|---|
| Contracts | `src/contracts/` | The types every layer shares: the plant config, commands, the per-frame snapshot, units | No three.js, no DOM; additive changes only once frozen (v1 to v4) |
| Simulation | `src/sim/` | The clock, the event queue, the liquid line (stages 1–6), fillers, packaging, quality, warehouse (7–10), the fault scenarios | No three.js, no DOM; runs headless in Node, so every rule is unit-tested |
| Scene | `src/scene/` | The 3D plant: equipment, pipes coloured by temperature, moving packs, trays and pallets, labels, camera, picking | Reads the snapshot only |
| UI | `src/ui/` | Top bar, stage rail, info panel with live values and charts, KPI strip, event log, scenario menu and log, guided tour, About | Reads the snapshot; writes only commands |

Every frame runs the same six steps ([plan 07](../plan/07-tech-stack-and-architecture.md#every-frame)): commands from the UI go to the sim; the sim advances by the frame's real time × speed in fixed steps (1 s, or 10 s above ×1,000), handling every queued event at its exact time; it builds one plain-object snapshot; the scene and the HUD read it (the HUD 4 times a second); the frame renders. A frame never counts as longer than 0.1 s, so a stalled tab doesn't make the plant jump.

All defaults live in one file, `src/data/plant.json` (schema 6), checked at start-up. Every value has a key and a source or a "sim assumption" note in the [decision log](../plan/DECISIONS.md) (D1–D15). Names carry their unit (`levelL`, `flowLph`, `tempC`), and conversions happen only in `units.ts` ([R8](../plan/REVIEW.md#r8-units-in-typescript)). Randomness comes from seeded streams (mulberry32, seed 81006), so a run repeats exactly.

### 2.2 The process model

**Liquid line (stages 1–6), continuous.** Milk moves as plug flow at the UHT plant's 16,000 L/h. Standardization takes the cream share x = (3.5 − 0.05) ÷ (40 − 0.05) = 0.0864. Preheating takes the milk from 4 °C to 80 °C (deaerated to 76 °C), and the homogenizer runs 200 + 30 bar, warming it about 1 °C per 40 bar to 81.75 °C. Direct steam injection then lifts it to 140 °C for a holding time of V ÷ Q: 17.8 L ÷ 16,000 L/h = 4 s. The sterilizing effect is computed live:

- F0 = (t ÷ 60) × 10^((T − 121.1) ÷ 10), 5.17 min at 140 °C and 4 s;
- B\* = (t ÷ 10.1) × 10^((T − 135) ÷ 10.5), 1.19 at 140 °C and 4 s;
- the divert limit, B\* = 1, is T = 135 + 10.5 log10(10.1 ÷ t): 139.22 °C at 4 s, 136.06 °C at 8 s.

Below the limit the divert valve sends milk to the reject tank for 3 min, then the plant cleans in place for 80 min and re-sterilizes for 30 min at 125 °C or more: 113 min without product ([D2](../plan/DECISIONS.md#d2-missing-defaults)). The display noise is capped at ±0.3 °C, so noise alone never diverts at 140 °C ([D4](../plan/DECISIONS.md#d4-divert-rule-and-display-noise)). The flash vessel returns the milk to 80 °C and a cooler to 20 °C.

**The aseptic tank couples the two halves.** It holds 20,000 L and opens half full. The UHT plant makes 16,000 L/h and the two fillers draw 15,000, so the tank gains 1,000 L/h. Above 90% the UHT plant drops to 50% flow, and back to full flow below 60%. Below 150 L the fillers stop, and they restart above 500 L. Each step cuts at the moment a threshold is crossed, so the litres balance exactly: the tests check that milk in equals milk out plus what the tanks hold, every sim hour for 60 days.

**Packs to trucks (stages 7–10), discrete events.** Each filler is a state machine (running, starved, stopped, under repair, re-sterilizing) at 7,500 packs/h, with random breakdowns (exponential, mean 8 h of running) and repairs (2 min + exponential, mean 12 min). The seal check rejects 0.2%. Packs go 12 to a tray and 84 trays to a pallet, labelled with an 18-digit SSCC with its GS1 check digit. A batch is one filler for one 8-hour shift ([D1](../plan/DECISIONS.md#d1-batch-size)): 60,000 packs, about 60 pallets. QA takes a pack every 30 min and 2 after each restart, and incubates them 7 days at 55 °C. A batch with no spoiled sample is released; one spoiled sample (0.02% per pack) blocks it, and it is destroyed a day later. Trucks come every 100 min for 22 pallets ([D3](../plan/DECISIONS.md#d3-truck-payload)), picked earliest best-before first, at 3 dock doors. OEE per filler is availability × performance × quality.

**The opening state.** A plant that started empty would release nothing for a week, so the model opens on day 8 at 06:00 with a week of history: 42 batches on hold and 634 pallets in stock, 2.0 days of cover ([D11](../plan/DECISIONS.md#d11-opening-state)).

**Fault scenarios.** Six faults start from the Scenarios menu, each through the model's own rules ([D15](../plan/DECISIONS.md#d15-phase-5-fault-scenario-defaults), scripts [H104–H110](../plan/hand-calculations.md#phase-5-scenario-scripts)):

| Scenario | What the model does | What follows |
|---|---|---|
| UHT temperature drop | The outlet falls toward 135.5 °C with a 15 s lag | Divert within 3 s; 800 L to reject; 113 min out; the fillers drain the tank and stop |
| Filler breakdown | Filler A down 60 min + 2 min re-sterilizing | The tank rises 8,500 L/h; at 90% the UHT plant throttles to 50% |
| Sterile-air filter failure | A process deviation for 2 h | Batches filled meanwhile are investigated, with a 5% spoil chance per sample |
| Failed incubation | The oldest batch on hold fails at once | Blocked; its pallets are destroyed a day later |
| Homogenizer pressure loss | Stage 1 at 50 bar for 1 h: globules 1.84 µm, creaming risk 84% | A week later the sensory check finds a cream layer and blocks the batches |
| Demand spike or late trucks | 12 extra trucks, one every 5 min; or no truck for 6 h 40 min | Stock and days of cover fall, or four trucks arrive at once and queue |

Each run claims the log entries it caused and adds why, so the scenario log reads as one story per fault. Reset puts every running fault right while what it caused runs its course.

### 2.3 Verification

Every expected value is worked by hand first, then tested. `process` writes the expected number with its formula and source in the [hand calculations](../plan/hand-calculations.md); `qa` turns it into a test; `sim` builds until it passes. A test never recomputes the expected value with the code's own formula.

| Check | What it covers | Where |
|---|---|---|
| Formulas and counts | Cream share, F0, B\*, divert limit, holding time, tank gains, batch and pallet counts, trucks, days of cover (H1–H75); OEE and the SSCC check digit | `tests/sim/formulas.test.ts` and others |
| Acceptance runs | Phase 3: normal run, divert at 139 °C, throttle to 50%, a clean covered by the buffer, mass balance, step size (H76–H96). Phase 4: pallets a day, one batch, quarantine size, OEE, trucks, SSCC, days of cover (H97–H103) | `tests/sim/acceptance*.test.ts` |
| 60-day run | Conservation every sim hour, bounded queues, 1 s and 10 s steps agree | `tests/sim/packsLongRun.test.ts` |
| Scenario scripts | Each fault's timings and KPIs (H104–H110), resets, the same seed giving the same log | `tests/sim/scenarios.test.ts` |
| Demo script | The live demo's sequence replayed, every number the presenter quotes | `tests/sim/demoScript.test.ts` |
| Assets | Every model's size, nodes, budget, licence, and the committed files byte for byte | `assets/scripts/*.test.mjs` |
| Browser | The app in Chromium: stages and camera, controls, KPIs, the liquid line and divert, silo to truck, scenarios, tour, About, loading and error states, no console errors | `e2e/*.spec.ts` |

At the defaults the 60-day run gives 349.8 pallets a day (hand calculation: about 350), OEE 91.0% (90.91%), 8.5% of production time throttled (about 9%), 2,421–2,626 pallets in quarantine (the review's range), 14.38 trucks a day, every one loaded on arrival, and stock growing by about 30 pallets a day ([phase 4 acceptance](../plan/hand-calculations.md#phase-4-acceptance-runs)).

The final number check (phase 6) compared what the screen shows with the review's "Checked and correct" table ([REVIEW](../plan/REVIEW.md#checked-and-correct)):

| Claim | On screen at the opening | |
|---|---|---|
| Cream share ≈ 0.086 | Stage 1: cream in product 8.6% | ✓ |
| F0 ≈ 5.2 min at 140 °C for 4 s | F0 5.17 min (the reading moves 4.83–5.55 with the ±0.3 °C noise) | ✓ |
| B\* ≈ 1.19 | B\* 1.19 (1.11–1.27) | ✓ |
| Divert below about 139.2 °C | Stage 4: divert limit 139.22 °C; the temperature drop diverts at 139.1 °C | ✓ |
| One batch = 60,000 packs | 7,500 packs/h per filler; a full-rate batch closes at 60,000 packs less rejects and samples (H98) | ✓ |
| Pallet ≈ 1,000 L | 12 × 84 = 1,008 packs | ✓ |
| ×10,000 passes 7 days in about a minute | The demo's week at ×10,000: 7 days 1.5 h of sim time in about 61 s, while frames keep up | ✓ |
| Homogenizer about 82% efficient | 124.7 kW drawn for 102.2 kW hydraulic (16,000 L/h at 230 bar) | ✓ |
| Tank gains 1,000 L/h | Aseptic tank 50% → 52.5% in the first 30 min | ✓ |
| Temperatures along the line | 4 → 80 → 76 → 81.75 → 140 → 80 → 20 °C | ✓ |

### 2.4 Performance

The budget is 60 fps on a mid-range laptop with one shadow-casting light. The plant draws 207 draw calls and 232,346 triangles at the overview with the hero models (budget 350 draw calls, about 300,000 triangles), and 92 to 151 at the stage stops ([perf baseline](../tests/perf/baseline.md)). Packs, trays and pallets are instanced meshes, and the 3D view moves a sample of them, not every pack. Static parts are merged into one mesh per material, and the hero models carry their ambient occlusion in their vertex colours. The gate G3 check drives a fixed camera path for 60 s at ×1 and ×10,000 and records the average and the 1% low (`node tests/perf/measure.mjs --path 60 --headed --channel chrome`). It needs the target laptop's GPU: the build machines only have software rendering, at about 4 fps.

### 2.5 3D assets

The machines are the project's own models, built in code (`assets/scripts/make-heroes.mjs`, `make-vehicles.mjs`) so they rebuild to the same bytes and pass the same checks every time: size against the layout, named moving nodes on their joints, polygon budget, and a render in the app's three.js. The four hero models (separator, homogenizer, aseptic filler, palletizer) have 2,048 to 6,252 triangles, baked ambient occlusion and meshopt-compressed geometry, 43 to 97 KB each. The conveyors are Kenney's Factory Kit (CC0). Every asset has a licence row in [LICENSES.md](../assets/LICENSES.md), and no brand appears on any of them.

## 3. Limitations

The [About panel](../src/data/about.md) lists the accepted simplifications. The main ones: plug flow with no pressure drop or fouling; temperatures that step with a short lag rather than follow heat-transfer equations; one product and pack size; cleaning as a timed state; failures at simple random rates; trucks at a fixed interval rather than random orders; scripted faults with one fixed size each. The model also mixes plant types: a direct UHT plant with the homogenizer before it, and the 50% throttle of indirect plants ([R5](../plan/REVIEW.md#r5-plant-type-mix)).

## 4. How to run and test

See the [README](../README.md#run-it). In short: `npm ci`, `npm run dev`, then `npm run check` for typecheck, lint, unit and asset tests, and `npm run e2e` for the browser tests.
