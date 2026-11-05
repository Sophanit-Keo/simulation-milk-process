[Agent plan](README.md) · Phase 13 · [Roadmap](../09-development-roadmap.md)

# Phase 13 · The CIP station in detail

Show what the CIP station really does ([D23](../DECISIONS.md#d23-the-cip-stations-chemicals-and-returns)). Today it names the step, its fluid and its temperature. It should also show which chemical circulates and at what strength, what each chemical removes, what the conductivity transmitter on the return reads, where the return goes (back to its tank or to drain), and how much caustic, acid and rinse water the cleans use.

The programmes' steps, times and temperatures (D16) do not change, nor does any time the scenarios and tests rely on. The new numbers come from the Dairy Processing Handbook and the CRC Handbook, or are marked as sim assumptions.

- **Entry:** phase 12 is merged.
- **Exit:** the checklist below; the developer watches a CIP after a temperature drop and reads the station's chemicals and returns in the stage 4 panel.

## What the station shows

| Step | Fluid, strength | Removes | Return goes to |
|---|---|---|---|
| Pre-rinse, 10 min, 45 °C | Softened water (3 °dH) | Loose milk residue and sugar | Drain |
| Lye, 30 min, 75 °C | Sodium hydroxide (NaOH) 1.5% | Fat and protein, the organic deposit on the heated surfaces | Drain until the return reaches half the lye's conductivity (about 1 min), then the lye tank |
| Rinse, 5 min, 45 °C | Softened water | The lye | The lye tank while the return is above half the lye's conductivity (about 1 min), then drain |
| Acid, 20 min, 70 °C | Nitric acid (HNO₃) 0.8% | Mineral deposit (milkstone: calcium and magnesium phosphates) | Drain for about 1 min, then the acid tank |
| Post-rinse, 7 min, 20 °C | Softened water | The acid | The acid tank for about 1 min, then the water tank (recovered for the next pre-rinse) |
| Gradual cooling, 8 min, 20 °C | Softened water | — | The water tank |

The intermediate clean (AIC) runs water, lye and water at the UHT set point, with the same strength and the same change-overs.

**Live in the stage 4 panel while it cleans:**
- the step, as now;
- the chemical and its strength;
- the return's conductivity and where it goes;
- the circulation and its velocity.

**Always shown:** the caustic, acid and rinse water used since the plant opened. **The CIP station's label** names the chemical and strength, e.g. "NaOH 1.5% · 75 °C".

## Contracts (`lead`)

- **`plant.json` (schema 9), new keys under `cleaning`:** `chemicals.lye`, `chemicals.acid` and `chemicals.water`, each with its `conductivityMsPerCm` (lye and acid also with `concentrationPct`, water with `hardnessDh`); `milkConductivityMsPerCm`, `circuitL`, `pipeBoreMm`, `changeOverFrac` and `recoverSteps`. `checkPlantConfig` checks them.
- **Contracts v7** (fields only added):
  - `CleaningSnapshot` gains `concentrationPct` (null for water), `returnConductivityMsPerCm` and `returnTo` (`'drain' | 'waterTank' | 'lyeTank' | 'acidTank'`).
  - `LiquidSnapshot` gains `cleaningUse`, the totals since the plant opened: `lyeKg`, `acidKg` (pure NaOH and HNO₃) and `drainWaterL`.

## Who does what

The user asked for this as one change, so `lead` builds it lane by lane in one session, in the agents' order and within their ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | D23, the new `plant.json` keys, their rows in [plan 06](../06-simulation-model.md#default-settings), hand calculations H120–H121 | `src/data/plant.json`, `plan/` |
| 1 | `lead` | Contracts v7, the config checks | `src/contracts/` |
| 2 | `sim` | Each step's strength; the return's conductivity, displaced first-order by the circuit's volume (τ = 90 s); its change-over; the chemicals and water used | `src/sim/liquidLine.ts`, `tests/sim/cleaning.test.ts` |
| 3 | `ui` | Stage 4 rows: Chemical, Return, CIP flow, Chemicals used; "About this model" | `src/ui/liquidRows.ts`, `src/data/about.md` |
| 3 | `scene` | The CIP station's label: chemical, strength and temperature | `src/scene/equipment/utilities.ts`, `tests/scene/cipStation.test.ts` |
| 4 | `qa` | `e2e/cleaning.spec.ts`: the new rows through a whole CIP; the full checks | `e2e/`, `tests/` |

## Exit checklist

- [x] `npm run check` and `npm run build` pass; the config refuses a missing or out-of-range chemical key.
- [x] `tests/sim/cleaning.test.ts`, against H120–H121:
  - each step's strength;
  - the return's conductivity at a step's start, after 60 s and at its end;
  - the change-overs at half the solution's conductivity;
  - one CIP uses 6.20 kg of NaOH, 3.16 kg of HNO₃ and 6,000 L of rinse water;
  - one AIC uses 6.19 kg of NaOH and 4,000 L.
- [x] `tests/ui/liquidRows.test.ts`: the new rows' text in each step, and "None" in production.
- [x] `tests/scene/cipStation.test.ts`: the label names the chemical and strength.
- [x] `e2e/cleaning.spec.ts`: through a whole CIP, the panel shows each step's chemical and the return going to its tank and to drain.
- [ ] The developer reads the station's details during a CIP.

## Status

Built on 4 November 2026 in one session, lane by lane in the order above:

- **`process`:**
  - D23 and the new keys in `plant.json` (schema 9): lye 1.5% NaOH (70.9 mS/cm), acid 0.8% HNO₃ (45.0 mS/cm), rinse water softened to 3 °dH (0.3 mS/cm), milk 4.8 mS/cm, the 600 L circuit, the 65 mm bore, the change-over at half the solution's conductivity, and the post-rinse and cooling recovered.
  - Their rows in plan 06, and H120–H121.
- **`lead`:** contracts v7 (`CleaningSnapshot.concentrationPct`, `returnConductivityMsPerCm`, `returnTo`; `LiquidSnapshot.cleaningUse`), the config checks, and the fixtures re-recorded at v7.
- **`sim`:** `src/sim/liquid/cleaningChemistry.ts`, pure and headless. The live model reads it for the snapshot and counts each step's use as it ends.
- **`ui`:** four stage 4 rows (Chemical, Return, CIP flow, Used since opening) and "About this model"'s Cleaning section. The section covers the chemicals, what each removes, the conductivity control and returns, and what the cleans use.
- **`scene`:** the CIP station's label, e.g. "NaOH 1.5% · 75 °C".
- **Checks:**
  - `npm run check`: typecheck, lint, 1,400 unit tests in 63 files (26 new), 85 asset tests. `npm run build` passes.
  - `e2e/cleaning.spec.ts` passes through a whole CIP: the chemicals in order, the return to drain and back to the lye, acid and water tanks, and "6.2 kg NaOH · 3.2 kg HNO₃ · 6,000 L water" at its end.
  - Browser, on the merged lanes: `cleaning`, `divert`, `energy`, `kpis` and `liquid`, 15 of 15 in 9.4 min. The stage 4 panel's new rows keep the one-screen layout at 1280 × 720 and 1440 × 900 in both themes.
  - Looked at in the app during the lye and the acid at 1440 × 900.
- **Seen and left as they are:**
  - In the stage 4 view the CIP station's label stands at the right edge, so its longer text is cut there; the whole label shows from the overview, or once the view is turned a little.
  - At ×100 the change-overs come about 0.6 s of real time into a step, so the panel may show one only briefly.
- **Open:** the developer's own look at a CIP.
