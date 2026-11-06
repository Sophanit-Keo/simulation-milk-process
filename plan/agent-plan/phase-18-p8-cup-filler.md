[Agent plan](README.md) · Phase 18 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 18 · Line P8: cup filling & in-line checks (stage 15)

Fill the cups. P8 takes yogurt from the buffer and passes each cup through the SOP's stations ([plan 12, stage 15](../12-yogurt-line.md#15-line-p8-cup-filling--in-line-checks)):
1. de-nesting;
2. ionized air and the vacuum shroud;
3. the UV-C tunnel;
4. piston filling;
5. foil lidding and sealing;
6. coding;
7. the checkweigher, metal detector and vision.

The SOP's hygiene limits act as interlocks.

- **Entry:** phase 17 is merged.
- **Exit:** the checklist below; the developer watches cups fill, seal and reject at ×1.
- **Weeks:** 6–7. **Critical path:** `sim`, `scene`.

## The model

- **Rate:** 21,600 cups/h, in 12-cup cycles every 2 s. Each cycle draws 12 × the drawn fill weight from the buffer.
- **Discrete events, not one per cup:** each cycle is one event. Fill weights, seal outcomes and rejects are drawn per cycle from the seeded RNG, so a run is repeatable.
- **Fill weight:**
  - normal around 127 g with σ 1.0 g;
  - the checkweigher rejects below 120.5 g and above 135 g (H127).
- **Seal:**
  - Temperature, time and pressure are inside the window by default.
  - Outside the window, the chance that a cup leaks rises (sim assumption, H128).
  - Every 2 operating hours, 5 cups go to the seal tests. A failed test holds every cup made since the last test that passed.
- **Metal detector and vision:** rare rejects at sim rates (H129).
- **Interlocks:**
  - P8 starts only after a logged CIP, an SIP at ≥ 121 °C for 20 min and an ATP swab below 10 RLU.
  - It stops if the HEPA cabin falls below +15 Pa or the buffer runs empty.
  - It stops at the end of the cup or foil magazine until the magazine is refilled.
- **Coding:** each cycle carries the batch code, the date of manufacture, the expiry date (+28 days) and "P8"; the token labels show them.
- **Batches:** a batch is one product run in one shift, the same unit as D1.

## Contracts (`lead`)

Contracts v8 (phase 15) already give `YogurtSnapshot.p8` its `state` (`idle`, `cleaning`, `sterilizing`, `running`, `starved`, `stopped`), `cupsPerH`, `cupsMade` and `cupsRejected`. It gains these fields (only added):
- `cyclesPerMin`;
- the rejects by cause (`underFill`, `overFill`, `metal`, `vision`, `sealHold`);
- `lastFillG`;
- `seal: { tempC, timeS, bar }`;
- `hepaPa`;
- `sip: { lastS, ok }`;
- `atpRlu`;
- `nextSealTestS`;
- `magazines: { cupsPct, foilsPct }`;
- `currentBatch`.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | H126 (a tank feeds P8 for about 3.7 h), H127 (the share of rejects at σ 1.0 g), H128 (seal leak chances), H129 (the reject rates per shift) | `plan/`, `src/data/` |
| 1 | `sim` | `src/sim/yogurt/p8.ts`: cycles, draws, rejects, seal tests and holds, the interlocks and the magazines; built on the filler pattern in `src/sim/packs/filler.ts` | `src/sim/yogurt/` |
| 2 | `scene` | Cup tokens as an `InstancedMesh` riding the carrier; pistons, seal heads and foil picks moving per cycle; the UV tunnel glow; reject flaps kicking cups into the bin; the HEPA hood's lamp | `src/scene/equipment/yogurt/` |
| 2 | `ui` | The stage 15 panel: state, rate, the last fill weight and its histogram, the rejects by cause, the seal parameters, HEPA Pa, the SIP and ATP, the next seal test, the magazines | `src/ui/` |
| 3 | `qa` | `tests/sim/yogurt/p8.test.ts` against H126–H129; the interlock tests (HEPA, SIP, ATP); cup conservation (buffer kg = cups × fill + rejects); `e2e/p8.spec.ts`; perf with thousands of cup instances | `tests/`, `e2e/` |

## Exit checklist

- [ ] Tests against H126–H129 pass; a 24 h run's cups and rejects match H129 within its tolerance.
- [ ] Each interlock stops P8 and logs why, and P8 restarts only once the condition clears.
- [ ] A seal test that fails holds the right cups, and the log names the batch.
- [ ] At ×1 the cups visibly de-nest, fill, seal and pass the gates; frame times stay within budget.
- [ ] The developer watches P8 at ×1.

## Status

Not started.
