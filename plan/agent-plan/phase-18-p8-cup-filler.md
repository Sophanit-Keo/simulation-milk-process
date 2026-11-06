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

- [x] Tests against H126–H129 pass; a 24 h run's cups and rejects match H129 within its tolerance.
- [x] Each interlock stops P8 and logs why, and P8 restarts only once the condition clears.
- [x] A seal test that fails holds the right cups, and the log names the batch.
- [x] At ×1 the cups visibly de-nest, fill, seal and pass the gates; frame times stay within budget.
- [ ] The developer watches P8 at ×1.

## Status

Built on 6 November 2026 in one session, on phase 17 as merged (PR #22). Y1 is not yet signed, and D25, D26 and D27 are still Proposed; the phase adds **D28** (P8's model), also **Proposed**. The developer asked to go on. Lane by lane:

- **`process`:**
  - `plant.json` schema 12 adds what the model needs and the table did not give: the seal's leak chances, the HEPA cabin's swing, the SIP's run temperature, a clean swab's reading, the metal and vision reject rates, and the magazines. `checkPlantConfig` refuses each out of range.
  - [D28](../DECISIONS.md#d28-line-p8-live-stage-15) sets the rules:
    - 12-cup cycles counted in the yogurt line's step, not queued, so the next-event jump keeps its meaning;
    - P8's own seeded stream (D25);
    - the checks in order;
    - seal tests that hold every cup since the last pass;
    - the interlocks;
    - batches per product and shift (D1), coded `P8-ddd-s`;
    - what a product leaves in the buffer, under a cycle, flushed to rework at the changeover.
  - [H126–H129](../hand-calculations.md#phase-18-line-p8): the cycle (2 s, 1.524 kg) and a tank's feed (3.65 h plain, 4.29 h strawberry); the magazines and their refills; the checkweigher at σ 1.0 g (4.0 × 10⁻¹¹ under-filled: none in a day); the seal's leak chances and a test's failure (5.0 × 10⁻⁴ in the window, 96.9% at 170 °C); the reject rates per shift and the day's Poisson bands.
- **`lead`:** contracts v10 adds `P8Snapshot`'s `stopReason`, `cyclesPerMin`, `rejects` by cause, `lastFillG`, `fillHistogram`, `seal`, `hepaPa`, `sip`, `atpRlu`, `nextSealTestS`, `sealTests`, `magazines` and `currentBatch`. The fixtures were re-recorded; their UHT part's fingerprint is unchanged (D25).
- **`sim`:**
  - `src/sim/yogurt/p8.ts` replaces phase 17's stub. It works as D28 sets out. The SIP and the swab are its start interlocks: an SIP that falls short runs again, and a dirty swab sends P8 back to the wing's CIP.
  - Its readings (the cabin, the SIP, the swab, the seal) can be replaced, for the tests now and phase 20's faults later.
  - The mock fills the v10 fields.
  - At the defaults the day of H125e still holds: **477,000** cups filled in 39,750 cycles, and 60,578.4 kg drawn (H129's ±3 kg). Of the cups, 476,920 are made and 55 taken by the 11 seal tests, all of which pass. The checks reject 4 metal and 21 vision cups, inside H129's bands. P8 calls 70 cup and 45 foil refills and never waits or stops.
- **`ui`:**
  - **Stage 15's state rows** (`src/ui/p8Rows.ts`): what P8 does and why it stopped, the batch and its best-before day, the last fill against the checkweigher's limits, the rejects by cause, the seal against its window, the HEPA cabin, the SIP and swab, the next seal test, and the magazines.
  - **A histogram of the batch's fill weights** (`src/ui/fillHistogram.ts`), with the limits and the target marked and its numbers in words.
- **`scene`** (`src/scene/equipment/yogurt/p8Machine.ts`):
  - **P8's grey box now moves:** the de-nester's magazines, the ionizer, a UV-C tunnel that glows while P8 runs, and the pistons, foil pick and sealing heads stroking once a cycle. A HEPA lamp is green over +15 Pa and red under.
  - **The cups** are about 1,450 instances in two draw calls:
    - they ride the carrier in rows of 12, fill under the pistons and take their foil;
    - they run down a ramp and four abreast through the gates to the tray packer;
    - a reject is kicked by the flap into the bin;
    - their label shows the batch code and its best-before day;
    - they take no clicks: a click on one picks the machine it rides on.
  - **One carrier clock** at P8's rate on animation time drives both, so at ×1 the carrier indexes every 2 s. A clean empties the line, and it fills again row by row.
- **`qa`:**
  - **`tests/sim/yogurt/p8.test.ts`:**
    - H126–H129: the cycle, the starved wait, the repeatable draws, the checkweigher at 127 and at 121 g, the leak chances, and a failed test holding its two hours' cups, about 43,200, and naming the batch;
    - the interlocks: HEPA, SIP, swab, the magazines, and the changeover standing;
    - the batches and their codes;
    - every cup filled is made, taken or rejected.
  - **`tests/sim/yogurt/yogurtLine.test.ts`:** the 24 h run checks the numbers above, and a whole-sim run puts a short SIP and a dirty swab into the 22:00 changeover.
  - **`tests/scene`:** the carrier clock, the strokes, the lamps, the cup counts and the reject kick.
  - **`e2e/p8.spec.ts`:** the panel in words with its histogram and rate slider, the line moving at ×1 with its frame pace, and a reject kicked into the bin.
- **Checks:**
  - `npm run check` passes (1,749 unit tests, 88 asset tests), and so does `npm run build`.
  - **The perf baseline** ([`tests/perf/baseline.md`](../../tests/perf/baseline.md#phase-18-line-p8s-moving-parts-and-its-cups)): the overview reads **345** draw calls (budget about 350) and **322,734** triangles, 32,384 more than phase 16. `measure.mjs` now opens a folded rail group before it clicks a stage, so it measures at 1280 × 720 again.
  - **Two full browser runs** each found a problem with the cups, both fixed:
    - **First run, 90 of 93:** the first cups cost 113,600 triangles and halved the overview's frame rate on software GL, so the energy and theme tests ran out of time. The cups are now lighter and culled with the line.
    - **Second run, 91 of 93:** the wing's 3D-click test aimed at stage 16, and a cup riding the tray packer's belt took the click as stage 15. The cups now take no clicks; a click picks the machine they ride on.
    - **After both fixes:** the energy, theme, wing and P8 specs pass (12 of 12, then 8 of 8), and the click test twice more.
    - **The other failure in both runs** is the pixel-ratio test, which fails in this sandbox's browser on the commit before phase 15 too (phase 15 status).

**For the developer:** please watch P8 at ×1 from stage 15's camera stop. The carrier indexes every 2 s, the pistons and the sealing heads stroke, and the cups take their foil and leave for the gates. At ×1,000 a vision reject is kicked into the bin about every 3 s. Then sign Y1, approve or amend D25–D28, and tick the last box.
