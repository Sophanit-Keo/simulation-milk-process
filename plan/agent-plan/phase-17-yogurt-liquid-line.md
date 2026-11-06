[Agent plan](README.md) · Phase 17 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 17 · Mix to buffer (stages 11–14)

Make the yogurt line's liquid side live, from the yogurt silo to the P8 buffer ([plan 12, stages 11–14](../12-yogurt-line.md#11-mix-preparation)):
- the mix is standardized and fortified;
- it is homogenized and held at 92 °C for 5 min, and diverted if it falls short;
- it is cooled to 43 °C and inoculated;
- it ferments in three tanks to pH 4.55 (stirred), or goes warm to the buffer (set);
- it is cooled to 18 °C and fills the buffer.

- **Entry:** gate Y1 is signed.
- **Exit:** the checklist below; the developer watches a stirred batch ferment and a set batch go to the buffer.
- **Weeks:** 4–5. **Critical path:** `sim`.

## The model

- **Mix (stage 11), by mass balance:** milk standardized to the mix fat, then powder to the SNF target (H122), then stabilizer. The yogurt silo is filled by its own tanker deliveries on the shared bay's timetable.
- **Heat treatment (stage 12):**
  - the outlet follows its set point with a first-order lag, as the UHT does;
  - the holding cell is a plug-flow delay of 500 L;
  - the denaturation is integrated along the hold (H124).
  - **Divert:** below 85 °C or a hold under 180 s, the mix goes to the reprocess tank and the line is cleaned before it restarts, in the same pattern as D15.
- **Fermentation (stage 13):**
  - Each tank runs fill → ferment → ready → empty → CIP.
  - pH(t) = pH_end + (pH_start − pH_end) ÷ (1 + e^(k(T)·(t − t_lag(T)))), fitted so that pH 4.55 falls at 4 h at 43 °C (H125).
  - k and t_lag scale with the temperature through a cardinal-temperature factor, with its optimum at 43 °C.
  - The titratable acidity follows the pH.
  - A tank that reaches the end pH is cooled at once (stirred) or held.
- **Routing (stage 14):**
  - **Stirred:** the tank is emptied through the smoothing valve and the cooler (18 °C) into the buffer; fruit is dosed at 15% when the recipe has it.
  - **Set:** the inoculated mix goes straight to the buffer at 43 °C. If it waits there past 45 min, it is sent back to rework.
- **Product day:** shifts at 06:00, 14:00 and 22:00 change the product. A rinse runs between the two stirred products, and a CIP before the set yogurt. The wing's CIP reuses `cleaningChemistry.ts` with D26's strengths.
- **Energy:** the heat treatment's steam is counted apart, and is added to the plant's total.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | H122–H125 checked against the first runs; the acceptance run: 24 h from day 8, 06:00, and its expected litres, batches, diverts (0) and steam | `plan/hand-calculations.md`, `src/data/` |
| 1 | `sim` | `src/sim/yogurt/mix.ts`, `heat.ts`, `ferment.ts`, `routing.ts` and `yogurtLine.ts`, which joins them to the core's step and events; pure and headless; the setpoints and `setYogurtProduct` | `src/sim/yogurt/`, `src/sim/index.ts` |
| 2 | `ui` | Panels 11–14 live: fat and SNF, powder dose, heat-treatment outlet, hold, denaturation and mode, each tank's pH and time to ready, buffer level, fruit dose; the yogurt KPIs; the next-product picker | `src/ui/` |
| 2 | `scene` | The mix and tank levels; the agitators turning; pipes coloured by temperature; the divert valve flipping; a pH ring on each tank's label | `src/scene/equipment/yogurt/` |
| 3 | `qa` | `tests/sim/yogurt/*.test.ts` against H122–H125; a mass-balance test (silo out = buffer in + reprocess + losses); the UHT tests unchanged; `e2e/yogurtLiquid.spec.ts` | `tests/`, `e2e/` |

## Exit checklist

- [x] `npm run check` and `npm run build` pass; the UHT acceptance, 60-day and scenario tests keep their numbers.
- [x] Tests against H122–H125: the powder dose, the 500 L holding cell, the denaturation at 92 °C × 300 s, and the pH reaching 4.55 at 4 h (43 °C) and later at 40 °C.
- [x] A set point below 85 °C diverts within one hold, and the line cleans before it restarts.
- [x] Over 24 h the three tanks rotate without the buffer running dry while P8 draws (P8's draw is stubbed at its rate until phase 18).
- [ ] The developer watches a stirred batch and a set batch.

## Status

Built on 6 November 2026 in one session, on phase 16 as merged (PR #21). The entry asks for Y1 signed; it is not yet, and D25 and D26 are still Proposed. The developer asked to go on. The phase adds **D27** (the live line's rules), also **Proposed**. Lane by lane:

- **`process`:**
  - `plant.json` schema 11 adds the live line's keys: the yogurt silo's tanker (20,000 L when under 30%), the mix tank's opening level, the heater's 30 s lag, the 3 min divert, the 45 min tank clean, the cooler's 6,000 L/h, the buffer's levels, the 15 min rinse, and the wing CIP's conductivities, flow and circuit. `checkPlantConfig` refuses each out of range.
  - [D27](../DECISIONS.md#d27-the-yogurt-line-live-stages-1114) sets the rules the sim follows. The heat treatment works ahead: set mix to the buffer first, the rest into an empty tank. The CCP judges the parcel at the holding cell's outlet. A divert runs the wing's CIP (D16's steps, D23's chemistry), then the line restarts behind water at the set point. Then the product day, the changeovers, the run-down before a shift change, and P8's draw stubbed at its rate.
  - [H125a–f](../hand-calculations.md#phase-17-the-yogurt-line-live) work the live numbers by hand: the tanker, the wing's CIP, the set mix in the buffer, the steam, a day of the line, and the CCP.
- **`lead`:** contracts v9 adds `heat.modeRemainingS` and `cleaning`, `buffer.product` and `changeover`, `YogurtSnapshot.energy`, and `LogEntry.line`. The yogurt log entries carry `line: 'yogurt'`. The fixtures were re-recorded, and their UHT part's fingerprint is unchanged (D25).
- **`sim`:** `src/sim/yogurt/` gains `mix.ts`, `heat.ts`, `ferment.ts`, `routing.ts` and `yogurtLine.ts`, which replace the idle line. The model is pure and headless. It runs last in the core's step and draws no random numbers, so the UHT line draws what it drew before.
  - The mix is made by mass balance (H122).
  - The holding cell is a 500 L plug flow.
  - The three tanks run fill → ferment on the H125 curve → ready → empty → clean.
  - The buffer is first in, first out: set mix that waits past 45 min goes to rework.
  - The yogurt silo takes its own tankers when the UHT bay is free.
  - The steam counts from the homogenizer's 68 °C up.
  - The mock fills the v9 fields.
- **`ui`:** state rows for stages 11–14 (`src/ui/yogurtRows.ts`):
  - stage 11: the product and the next shift's;
  - stage 12: the heat treatment's mode with its time left, the wing CIP's step, and the steam;
  - stage 13: each tank in words, with its pH and its time to ready;
  - stage 14: the buffer's product, the changeover and the set mix's wait.

  The panels also gain sliders for the heat set point (80–95 °C, reaching under the CCP's limit), the fermentation temperature (37–45 °C) and P8's rate, and stage 11's next-product picker (`src/ui/productPicker.ts`).
- **`scene`:**
  - the agitators of the mix tank, the fermentation tanks and the fruit tank turn while they stir: a fermentation tank stirs while it fills and once it is ready, and stands still while its yogurt sets;
  - the yogurt divert valve's flag points to the reprocess tank in a divert, and its lamp is green, red, amber or off;
  - the route to the reprocess tank is a run of its own, and glows red in a divert;
  - each fermentation tank's label carries a pH ring (`Equipment.labelRing`), filled from the start pH to the end pH.
- **`qa`:**
  - **`tests/sim/yogurt/yogurtLine.test.ts`:**
    - the H122–H125 and H125a–f numbers over a 24 h run from day 8, 06:00: 60,579.0 L and 477,000 cups to P8, no wait outside the changeovers, five tanks fermented, no divert, and the mass balance within 1 mL;
    - the CCP at 84 °C (divert after 362.4 s, 300 L, the 80 min clean, the reprocess tank emptied);
    - the restart after the clean with the set point put back;
    - 40 °C taking 4 h 16 min.
  - **`e2e/yogurtLiquid.spec.ts`:**
    - the panels in words as the line opens, and the picker;
    - a set point of 80 °C diverting within one hold: the flag, the lit route, the reprocess tank, the clean, and forward again;
    - the product day past midnight, where tank 1 empties, is cleaned, fills, ferments with its ring growing and its agitator still, waits ready and empties again, and plain set yogurt goes warm to the buffer after the CIP and SIP, P8 never waiting.
  - The rail, KPI and wing specs expect the running line's lamps: green but for the heat treatment, which waits for a tank, and the cold chain.
  - **A bug the browser test found:** the restart after the clean kept the cold mix of before the divert in the holding cell, so the line diverted again at once, for ever. The clean now refills the cell with water at the set point (D27), and a unit test holds it.

**For the developer:** please watch a stirred batch ferment and a set batch go to the buffer. At ×1,000 from the opening (H125e), tank 3 is ready at 08:00; tank 1 empties by 08:20, is cleaned by 09:05, fills to 10:45 and ferments to pH 4.55 at 14:45; plain set yogurt goes warm to the buffer from 23:40, after the wing's CIP and P8's SIP. Then sign Y1, approve or amend D25, D26 and D27, and tick the last box.
