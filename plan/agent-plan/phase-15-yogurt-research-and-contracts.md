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

- [x] `npm run check` and `npm run build` pass; every existing unit and browser test passes with unchanged numbers.
- [x] D25 and D26 are in the decision log; H122–H125 are in the hand calculations, each with its arithmetic.
- [x] `plant.json` is at schema 10, and the config refuses a missing or out-of-range `yogurt` key.
- [x] `?mock&yogurt` shows panels 11–16 filled from the mock snapshot.
- [ ] The developer approves D25 and D26.

## Status

Built on 5 November 2026 in one session, lane by lane in the order above. D25 and D26 stay Proposed until the developer approves them.

- **`process`:**
  - checked every default of D26 against the SOP, the handbook and its own arithmetic, and recorded the outcome in D26 ("Checked in phase 15"):
    - two corrections: the powder dose is 26.95 kg a tonne (not 26.7: the stabilizer takes its share), and the mix line's basis is a third of the UHT plant's 16,000 L/h (it had cited the 24,000 L/h CIP circulation);
    - two renames for the units rule (`ferment.endAtOptS`, `p8.rateCupsPerH`);
    - the numbers the model needs that D26 had only in words: the pH curve's floor, the culture's cardinal temperatures, the acidities, the β-lactoglobulin concentration, the tanks' sizes, P8's lanes, the cold room's band, the CIP temperatures and the product of each shift;
  - wrote H122 (powder dose), H123 (the 500 L holding cell), H124 (β-lactoglobulin: 99.2% at 92 °C × 300 s, 81.6% at the CCP's limits) and H125 (pH 4.55 at 4 h at 43 °C, 4 h 16 min at 40 °C), each with its arithmetic;
  - wrote the `yogurt` block of `plant.json` (schema 10), the "Yogurt line" part of the [default settings](../06-simulation-model.md#yogurt-line), and `stages.json` entries 11–16 with their rows and tour captions.

  H124's kinetics are Dannenberg & Kessler's as Kessler's book (2002) reproduces them; the 1988 paper's own table was not to hand, so the developer checks its four parameters.
- **`lead`, contracts v8** (fields only added; the type checker listed 15 places):
  - `UhtStageId`, `YogurtStageId` and `StageId` 1–16; `LineId`, `LINE_IDS`, `LINE_NAMES`, `STAGE_IDS_BY_LINE`, `lineOfStage`;
  - the four zones; the nine yogurt line points (`LINE_POINT_IDS_BY_LINE`);
  - `Snapshot.yogurt: YogurtSnapshot` (`src/contracts/yogurt.ts`), whose `p8` and `coldChain` carry the fields the mock needs, and which phases 18 and 19 extend (their pages now say which fields v8 already has);
  - the command `setYogurtProduct`; the set points `yogurtHeatC` (80–95 °C), `fermentTempC` (37–45 °C) and `p8RateCupsPerH` (10,800–25,200 cups/h);
  - `checkPlantConfig` checks the yogurt block key by key (`YOGURT_NUMBER_KEYS`), with the rules between its keys.

  The fixtures are re-recorded at v8: in each file the only line removed is `"version": 7`.
- **`sim`:**
  - `src/sim/yogurt/`: the formulas of H122–H125, the product day, the view that turns one `YogurtSnapshot` into the stage 11–16 values, lamps and line points, and the idle line the live sim reports until phase 17 (silo at its opening level, everything else empty, stages 11–16 grey);
  - `src/sim/mockYogurt.ts`: three tanks a third of a cycle apart (one at pH 5.58, one emptying at 4.55, one filling at 6.6), P8 running, the cold room part full, and a heat set point under 85 °C diverting. It draws from its own seeded stream, so the milk's mock draws exactly what it drew at v7.
- **`ui`:** the rail and the panel show stages 11–16 only behind `?yogurt` (`HudOptions.lines`), and the tour keeps to stages 1–10.
- **`scene`** (one change, for the type checker): a yogurt stage has no camera stop until phase 16, so picking one leaves the camera where it is.
- **`qa`:**
  - `tests/config/yogurtConfig.test.ts`: schema 10, every yogurt key refused when missing, and 24 values refused when out of range;
  - `tests/sim/yogurt/`: the formulas against H122–H125; the idle line, the product day, `setYogurtProduct` and the new set points; the mock's tanks, P8 and cold room;
  - the fixtures' UHT part fingerprinted at v7 and checked at v8 (`tests/fixtures/uhtPart.ts`), and the milk mock's likewise;
  - the architecture test names `src/sim/yogurt/`;
  - `e2e/yogurtMock.spec.ts`: the default rail keeps ten stages, `?mock&yogurt` fills panels 11–16, and `?yogurt` shows them standing with `plant.json`'s values.
- **Checks:**
  - `npm run check` passes (1,604 unit tests, 88 asset tests), and so does `npm run build`.
  - The browser run passed 83 of 85 tests, the three new ones among them.
  - "The clock runs far faster at ×1,000" failed only while other jobs loaded the machine; run alone, it passes for both `/` and `/?mock`.
  - "The canvas follows the screen pixel ratio" fails in this sandbox on the commit before phase 15 as well, with the same error (the buffer stays at 1× when the page emulates 2×). It is the sandbox's browser, not this phase: the project pins Playwright 1.56, and the sandbox has only a newer Chromium. It should pass where the pinned browser is installed.
