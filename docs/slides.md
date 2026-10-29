[README](../README.md) · [Demo script](demo-script.md) · [Video script](video-script.md) · [Report](report.md) · Slides

# Presentation slides

Twelve slides, about 15 minutes with the live demo (slide 8). One slide per heading; the lines under it are what goes on the slide, and *Say* is the speaker note. Figures come from the [report](report.md).

## 1. UHT milk plant simulation

- A browser-based 3D simulation, from the raw-milk silo to the truck
- [Live link] · github.com/Sophanit-Keo/simulation-milk-process

*Say:* What it is, in one sentence; the link works in any modern browser with no install.

## 2. Why simulate a UHT plant

- Ten stages that depend on each other
- What the buffer tank absorbs, when the plant must divert, how a fault travels to the warehouse
- A teaching model, not a design tool

## 3. The plant in ten stages

- 1–6 liquid line: standardization, preheating and deaeration, homogenization, UHT at 140 °C for 4 s, flash cooling, aseptic tank
- 7–10 packs to trucks: aseptic filling, trays and pallets, 7-day quarantine, warehouse and trucks

*Say:* Show the whole-plant screenshot; the pipe colour is the milk temperature.

## 4. Architecture

- TypeScript + Vite + three.js r186
- Simulation core with no 3D code: tested headless
- One snapshot per frame feeds the 3D view and the UI
- All defaults in one file, each with a source or "sim assumption"

*Say:* The architecture diagram from plan 07.

## 5. The model: sterility and the divert

- F0 5.2 min and B\* 1.19 at 140 °C for 4 s
- Divert limit 139.2 °C (B\* = 1)
- Below it: 3 min to reject, 80 min clean, 30 min re-sterilize: 113 min out
- Steam 1,652 kg/h from a gas boiler; regeneration gives 56.6% of the heating
- About 92 kWh per tonne of raw milk over a day (EU dairy benchmark: 100–600 for a whole dairy)

## 6. The model: packs to trucks

- 2 fillers × 7,500 packs/h; 12 packs a tray, 84 trays a pallet
- A batch = one filler × 8 h = 60,000 packs, held 7 days
- A truck every 100 min for 22 pallets
- OEE about 91% over 60 days; about 350 pallets a day

## 7. Six fault scenarios

- UHT temperature drop · filler breakdown · sterile-air filter failure
- Failed incubation · homogenizer pressure loss · demand spike or late trucks
- Each one plays out through the model's own rules, and logs what happened and why

## 8. Live demo

- The [demo script](demo-script.md): about 10 minutes

## 9. How it was checked

- Every expected number worked by hand first, with its source (H1–H119)
- About 1,150 unit tests: formulas, acceptance runs, a 60-day run, every scenario, the cleaning and energy, the demo itself
- Browser tests in Chromium; asset checks on every model
- The same seed gives the same run, every time

## 10. Performance

- 207 draw calls and about 232,000 triangles at the overview (budget 350 and 300,000)
- Instanced packs and pallets; one shadow-casting light; baked ambient occlusion
- 60 fps check on the target laptop: a fixed 60 s camera path at ×1 and ×10,000

*Say:* Give the measured average and 1% low from the G3 check.

## 11. Limits

- Plug flow, stepped temperatures, one product, cleaning steps on a timer
- Energy counts the steam and the homogenizer only
- Random failures at simple rates; trucks at a fixed interval
- Scripted faults of one fixed size

## 12. Thank you

- Questions
- Sources: the About panel and the decision log
