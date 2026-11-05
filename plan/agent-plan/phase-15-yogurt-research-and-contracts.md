[Agent plan](README.md) · Phase 15 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 15 · Yogurt research, decisions & contracts

Settle what the yogurt line is before anything is drawn or computed ([plan 12](../12-yogurt-line.md), [SOP](../yogurt-sop-p8.md)).

By the end of this phase:
- every number has a key, a source or the words "sim assumption", and an expected value;
- the contracts carry stages 11–16;
- the UI can show them from a mock snapshot.

Nothing in the UHT line's behaviour changes.

- **Entry:** phase 14 is merged.
- **Exit:** the checklist below. The developer approves D25 and D26.
- **Weeks:** 1. **Critical path:** `process`, `lead`.

## Contracts (`lead`)

- **`StageId`** widens to `1 … 16`.
- **New types:**
  - `LineId = 'uht' | 'yogurt'`;
  - `STAGE_IDS_BY_LINE`;
  - `ZoneId` adds `yogurtMix`, `yogurtProcess`, `p8` and `coldChain`.
- **`LinePointId` adds** `ySilo`, `yMixTank`, `yHeater`, `yHoldingCell`, `yInoculation`, `yFermentTank`, `yCooler`, `p8Buffer` and `p8Filler`.
- **Contracts v8** (fields only added): `Snapshot.yogurt: YogurtSnapshot`, as a sketch:

```ts
export interface YogurtSnapshot {
  product: { id: YogurtProductId; route: 'stirred' | 'set'; fruit: boolean; next: YogurtProductId };
  mix: { fatPct: number; snfPct: number; powderKgPerT: number; tanks: TankLevel[] };
  heat: { mode: 'production' | 'divert' | 'cleaning' | 'idle'; outletC: number; holdS: number; denatPct: number };
  ferment: { tanks: FermentTank[] };   // state, levelPct, ph, ta, startedS, readyAtS
  buffer: { levelPct: number; waitS: number | null };
  p8: P8Snapshot;                      // phase 18
  coldChain: ColdChainSnapshot;        // phase 19
  kpis: YogurtKpis;
}
```

- **New commands:** `setYogurtProduct` (the next shift's product). The new setpoint keys are `yogurtHeatC`, `fermentTempC` and `p8RateCupsPerH`, each with its range in `SETPOINT_RANGES`.
- **`plant.json` schema 10:** the `yogurt` block of [D26](../DECISIONS.md#d26-the-yogurt-lines-defaults). `checkPlantConfig` refuses a missing or out-of-range key.
- **Fixtures:** the existing ones are re-recorded at v8. The values in `snapshot.yogurt` may change, but nothing outside it may.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | Check every default in D26 against the SOP and the handbook. Write H122 (powder dose), H123 (holding-cell volume at 6,000 L/h × 300 s = 500 L), H124 (β-lactoglobulin denaturation at 92 °C × 300 s) and H125 (the pH curve's time to 4.55 at 43 °C and at 40 °C). Add a "Yogurt line" part to the [default settings](../06-simulation-model.md#default-settings). Write `stages.json` entries 11–16: names, values, tour captions | `src/data/plant.json`, `src/data/stages.json`, `plan/` |
| 1 | `lead` | Contracts v8; `StageId` widened, with the type checker's list of every place that changes; the config checks; the fixtures re-recorded | `src/contracts/`, `tests/fixtures/` |
| 2 | `sim` | `src/sim/mockYogurt.ts`: a mock `YogurtSnapshot` (three tanks at different pH, P8 running, the cold room part full). Stages 11–16 report `idle` in the live sim until phase 17 | `src/sim/` |
| 2 | `ui` | Records keyed on `StageId` take 11–16 without showing them yet (behind `?yogurt` until phase 16) | `src/ui/` |
| 3 | `qa` | Config tests for schema 10; a test that the UHT fixtures' values, outside `yogurt`, are unchanged at v8; the architecture test still keeps three.js out of `src/sim/yogurt/` | `tests/` |

## Exit checklist

- [ ] `npm run check` and `npm run build` pass; every existing unit and browser test passes with unchanged numbers.
- [ ] D25 and D26 are in the decision log; H122–H125 are in the hand calculations, each with its arithmetic.
- [ ] `plant.json` is at schema 10, and the config refuses a missing or out-of-range `yogurt` key.
- [ ] `?mock&yogurt` shows panels 11–16 filled from the mock snapshot.
- [ ] The developer approves D25 and D26.

## Status

Not started.
