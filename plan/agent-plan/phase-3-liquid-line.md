[Agent plan](README.md) · Phase 3 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 3 · Liquid line, stages 1–6 (weeks 4–6)

Run the continuous model for stages 1–6 with live levels, temperatures, F0, B\* and divert, show it in the 3D view and the panels, and make the formula tests pass.

- **Entry:** G1 signed, contracts v1 merged, formula tests waiting (skipped) since phase 1.
- **Exit:** the week-6 deliverable: stages 1–6 live (levels, temperatures, F0 and B\*, divert), and the formula tests pass.
- **Critical path:** `sim`. `scene` and `ui` follow each new snapshot field, and `qa` and `process` check the numbers.

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `sim` | `liquidLine.ts` as a fixed-step model, with every unit conversion in `units.ts`. **Stage 1:** separator mass balance, cream share from the raw-milk fat default, surplus cream, silo and mix-tank levels. **Stage 2:** preheat to 80 °C with a short lag, a 4–5 °C drop in the deaerator, air content, heat recovered. **Stage 3:** 200 + 30 bar, about 1 °C rise per 40 bar ([R7](../REVIEW.md#r7-homogenizer-outlet)), globule size, creaming-risk score, power draw. **Stage 4:** t_hold = V_tube ÷ Q from the live flow ([R6](../REVIEW.md#r6-holding-time)), then F0, B\* and the divert limit; divert to the reject tank when B\* < 1; a flush, clean and re-sterilize state (30 min at 125 °C or more); noise under ±0.3 °C ([R4](../REVIEW.md#r4-divert-rule)). **Stage 5:** flash to about 80 °C (water removed = steam added), then cool to 20 °C. **Stage 6:** tank level from inflow minus outflow, the 90%/60% throttle, fillers paused below 150 L, headspace pressure, intermediate clean every 10 h, full CIP after a divert. Until phase 4, a stub draws a constant 2 × 7,500 L/h for the fillers. Commands to set the UHT temperature and the homogenizer pressure. | Contracts v2 liquid fields |
| `qa` | Turn on the formula tests: cream share 0.0864, F0 5.17 min, B\* 1.19, divert limit 139.22 °C, and the R6 values at 50% flow (8 s, B\* ≈ 2.4, F0 ≈ 10.3 min, limit ≈ 136.1 °C). Mass balance: over 24 sim hours, litres drawn from the silo = litres to fillers + reject + surplus cream + change in mix-tank and aseptic-tank contents, within 0.1%. Hysteresis: one throttle switch per crossing, no flip-flopping. Step size: 24 h at 1 s steps and at 60 s steps end within 1%. Determinism: the same seed gives the same snapshot. A headless 30-day run with no NaN and every level within capacity. Recorded fixtures for the divert and throttled states. | Passing tests, state fixtures |
| `scene` | `update(snapshot)` for stages 1–6: silo, mix-tank and aseptic-tank levels; separator bowl spin; agitator; heat-exchanger glow; deaerator bubbles; homogenizer pistons and gauge needles; steam puffs; divert valve flip with a red lamp; reject tank filling; flash-vessel vapour. Pipe colours from live temperatures, flow-texture speed from flow, and the divert route lit while diverting. | Live liquid line in 3D |
| `ui` | Panels for stages 1–6 with live values. The stage 4 panel shows hold time, F0, B\* and the divert limit, so the viewer sees flow change sterilization (R6). Set-point sliders for UHT temperature and homogenizer pressure, plus lil-gui for debugging. Chart.js trends for UHT temperature and tank level. KPI strip: UHT L/h, F0 and B\*, litres diverted, tank level. Log entries for divert, throttle and cleaning. | Live panels and KPIs |
| `process` | Acceptance runs with expected numbers: a normal run; set 139 °C, which must divert; throttle to 50%, which must give the R6 values; and an intermediate clean covered by the buffer (from 50%, the tank covers the 7,500 L drawn in 30 min). Weekly check of on-screen numbers against the stage research, with bugs filed to `sim`. Write the "About this model" text: the plant-type mix ([R5](../REVIEW.md#r5-plant-type-mix)) and the [accepted simplifications](../10-risks-and-simplifications.md#accepted-simplifications). Fix the stage 4 divert wording and the "your stage order" wording in the plan. | Acceptance sign-off, About text |
| `assets` | Block out the four hero models to the phase-2 specs. Start with the separator and homogenizer, whose stages go live now. Review a screenshot in the scene with `scene`. | Hero block-outs |
| `lead` | Contracts v2 (liquid snapshot fields and commands). Weekly demo builds. Check scope against the Must list. | Contracts v2 |

## How they work together

- **Week 4.** `sim` builds stages 1–3 and the tank. `qa` turns on the formula tests, so the first `sim` merge is checked against the hand calculations. `scene` animates the silos, separator and homogenizer from the new fields, and `ui` builds panels 1–3.
- **Week 5.** `sim` builds stages 4 and 5: hold time, F0, B\*, divert and cleaning. `scene` and `ui` start the divert visuals on `qa`'s divert fixture before `sim`'s divert lands. `process` runs the acceptance runs and files issues to `sim`.
- **Week 6.** `sim` adds the stage 6 buffer, throttle and cleaning schedule. `qa` adds the step-size and soak tests. The rest of the week is for fixes, and `lead` ticks the week-6 deliverable.

Each new snapshot field follows the same path: `sim` lists it in its hand-off note, then `scene` and `ui` pick it up in their next task card.

## Hand-offs

- `sim` → `scene`, `ui`: contracts v2 fields as each stage lands.
- `qa` → `scene`, `ui`: divert and throttled fixtures.
- `process` → `ui`: "About this model" text. `process` → `sim`: bugs from the acceptance runs.
- `assets` → `scene`: hero block-outs for a fit check.

## Exit checklist

- [ ] Stages 1–6 are live: levels, temperatures, F0 and B\*, divert.
- [ ] The formula, mass balance, hysteresis, step-size and determinism tests pass, and so does the 30-day soak.
- [ ] Setting the UHT temperature below the divert limit diverts within one step: the valve lamp turns red and the reject tank fills.
- [ ] `process` signs off the acceptance runs.
- [ ] 60 fps still holds.

## Watch for

- **Random diverts.** Display noise above ±0.3 °C crosses the 139.2 °C limit ([R4](../REVIEW.md#r4-divert-rule)).
- **Slow steps at ×10,000.** Check the step-size rule early, before adding detail.
- **The filler stub.** Keep it behind the same interface the phase-4 fillers will use, so swapping it touches one file.

---

← [Phase 2. Grey-box plant](phase-2-grey-box.md) · [Phase 4. Packs to trucks](phase-4-packs-to-trucks.md) →
