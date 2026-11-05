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

- [ ] `npm run check` and `npm run build` pass; the UHT acceptance, 60-day and scenario tests keep their numbers.
- [ ] Tests against H122–H125: the powder dose, the 500 L holding cell, the denaturation at 92 °C × 300 s, and the pH reaching 4.55 at 4 h (43 °C) and later at 40 °C.
- [ ] A set point below 85 °C diverts within one hold, and the line cleans before it restarts.
- [ ] Over 24 h the three tanks rotate without the buffer running dry while P8 draws (P8's draw is stubbed at its rate until phase 18).
- [ ] The developer watches a stirred batch and a set batch.

## Status

Not started.
