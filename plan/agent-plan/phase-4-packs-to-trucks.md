[Agent plan](README.md) · Phase 4 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 4 · Packs to trucks, stages 7–10 (weeks 7–9)

Turn milk from the aseptic tank into packs, trays, pallets, batches and truckloads with the discrete event model, run the whole plant from silo to truck, and freeze the scope.

- **Entry:** week-6 deliverable done, contracts v2 merged, the filler stub in place.
- **Exit:** **gate G2**: stages 7–10 live (packs, pallets, quarantine, warehouse, trucks), and the scope frozen.
- **Critical path:** `sim`. Week 7's swap of the filler stub for real fillers is the riskiest merge of the term.

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `sim` | **`filler.ts`:** one state machine per filler (running, starved, stopped, repair, cleaning) with the [R2](../REVIEW.md#r2-missing-defaults) failure and repair times; 7,500 packs/h; rejects; batch and date code on every pack. It replaces the stub, and fillers pause below 150 L. **`packaging.ts`:** 12 packs per tray, 84 trays per pallet, the last pallet of each batch closed part-full ([D1](../DECISIONS.md#d1-batch-size)), conveyor queues, up to 30% catch-up after a stop, and an 18-digit SSCC with its GS1 check digit. **`quality.ts`:** a batch is one filler × 8 h ([R1](../REVIEW.md#r1-batch-size)); 1 sample per filler every 30 min plus 2 after each stop; incubation of 7 days (55 °C) or 15 days (30 °C); 0.02% failures per pack; HOLD → RELEASED or BLOCKED; a QA override command. **`warehouse.ts`:** stock by batch and best-before date (6 months), first-expired-first-out picking, demand from the R2 decision, trucks of the [R3](../REVIEW.md#r3-truck-payload) size that wait when stock is short, days of cover, fill rate, trucks shipped. OEE = Availability × Performance × Quality per filler. The preview leaves out Quality. Every timed change (fault, repair done, pallet full, incubation over, truck arrives) runs through the event queue. | Contracts v3 discrete fields |
| `qa` | Unit tests: SSCC check digit, picking order, samples per batch (16, plus 2 per stop), OEE from known inputs, incubation timing (7 days at ×10,000 takes about 60 s). Conservation: packs made = packs on conveyors + in trays + on pallets + rejected; pallets made = in quarantine + in stock + shipped + destroyed. Coupling: the tank level falls while the fillers run, rises when one stops, and throttles at 90%. A headless 60-day run with bounded queues and a quarantine size within the [R9](../REVIEW.md#r9-quarantine-scale) range (about 2,500 pallets at 7 days). A browser run from silo to truck at ×10,000 that sees a truck leave. Fixtures for filler down and quarantine full. | Passing tests, state fixtures |
| `scene` | `tokens.ts`: one `InstancedMesh` each for cartons, trays and pallets, animating a sample of packs, not every pack. Belt textures scroll, filler reels turn and jaws seal, the palletizer picks and places, and the stretch wrapper turns (Could). Quarantine: one block per batch with one lamp, and pallet instances tinted with `setColorAt` (R9). Warehouse racks fill with stock, forklifts follow floor paths, and trucks dock and leave. A click on a pallet or block sends `selectBatch`. | Packs-to-trucks 3D |
| `ui` | Panels for stages 7–10: filler state, packs/h and OEE; trays and pallets; the batch list with status and release countdown; stock, next pick and trucks. A click on a batch block lists its pallets with SSCC, best-before date and status. Controls for filler speed and the QA override. KPI strip: packs/h, OEE per filler (phase 2 shows the plant's OEE only), trays and pallets, batches on hold, released and blocked, stock, days of cover, fill rate, trucks shipped. Log entries for discrete events. | Live panels and KPIs |
| `process` | Logistics acceptance: at most 360 pallets a day (6 batches × 60; 357.14 pallet-loads of 1,008 packs, [H38](../hand-calculations.md#counts-and-rates)), about 60 pallets and 16 samples per batch, about 2,500 pallets in quarantine at 7 days (2,520 to 2,640 at full rate, [H49](../hand-calculations.md#counts-and-rates)), and a truck interval that matches R3 (22 pallets gives about one every 1.7 h). Check the OEE definition and the pallet label fields against [GS1](https://gs1uk.org/support-training/help-to-use-and-implement-gs1-standards/logistics-labels-and-ssccs). Write the panel text and tour captions for stages 7–10. | Acceptance sign-off, captions 7–10 |
| `assets` | First-pass GLBs of the four hero models with the named nodes from the specs. `scene` loads them behind a flag, so the grey boxes remain the default. | First-pass hero models |
| `lead` | Contracts v3 (discrete fields), frozen at G2: from then on, fields can only be added. Run G2 with the developer. If the silo-to-truck run doesn't work, cut Could items first (stretch wrapper, boiler house and CIP station), then Should items, and record the cut list in the decision log. | Contracts v3, cut list |

## How they work together

- **Week 7.** `sim` builds the fillers and swaps out the stub, the merge that couples the two models at the aseptic tank. `qa`'s coupling tests go in with it, not after. `scene` builds tokens and filler animation on `qa`'s filler-down fixture, and `ui` builds the stage 7 panel.
- **Week 8.** `sim` adds packaging and quality. `scene` builds the palletizer and the quarantine blocks, and `ui` the batch list. `process` runs the logistics checks.
- **Week 9.** `sim` adds the warehouse and trucks, and `scene` the racks, forklifts and trucks. `qa` runs the silo-to-truck browser test every day. On Friday the developer walks through the G2 checklist.

## Hand-offs

- `sim` → `scene`, `ui`: contracts v3 fields, stage by stage.
- `qa` → `scene`, `ui`: filler-down and quarantine-full fixtures.
- `process` → `ui`: captions and panel text for stages 7–10.
- `assets` → `scene`: first-pass hero GLBs.
- `lead` → all: the frozen contracts and the cut list.

## Gate G2 checklist

- [x] Silo to truck runs end to end at every speed preset with no errors.
- [x] Stages 7–10 are live: packs, pallets, quarantine, warehouse, trucks.
- [x] The conservation and coupling tests pass, and so does the 60-day run.
- [ ] 60 fps with tokens on screen.
- [x] Contracts v3 frozen and the cut list recorded.
- [ ] The developer signs G2.

**Status (2026-10-27, all lanes, ready for the G2 review):**

- **`lead`.** Contracts v3 (`src/contracts/packs.ts`, `Snapshot.packs`, `CONTRACT_VERSION` 3, frozen: `tests/sim/snapshotV3.test.ts` checks the version and the shape of every field) and `plant.json` schema 5 with D11's three keys and five more ([D14](../DECISIONS.md#d14-phase-4-packs-to-trucks-defaults)). The plant opens on day 8 at 06:00 with a week of history ([D11](../DECISIONS.md#d11-opening-state)). Cut list: nothing cut ([D14](../DECISIONS.md#d14-phase-4-packs-to-trucks-defaults)).
- **`sim`.** `src/sim/packs/` (`filler.ts`, `packaging.ts`, `quality.ts`, `warehouse.ts`) and `src/sim/packsLine.ts` replace the filler stub; the liquid line hands the fillers each cut of each step, so litres drawn = packs made. Every timed change runs through the core's event queue, and the packs model draws from its own seeded stream.
- **`qa`.** `tests/sim/packs.test.ts` (stages 7–10 and the coupling at the aseptic tank), `packsLongRun.test.ts` (60 days at ×10,000: conservation every sim hour, bounded queues, the R9 range, H52, H58, H59, H41–H43; 1 s and 10 s steps agree), `snapshotV3.test.ts`, `acceptancePacks.test.ts` (H97–H103), `tests/contracts/sscc.test.ts`, and the filler-down and quarantine-full fixtures. In the browser, `e2e/packs.spec.ts` runs silo to truck at every preset, then at ×10,000 until truck 1 leaves and batch 12 is released, and checks the batch list, a click on a block and the QA override; the phase 2 and 3 specs follow the day-8 opening. The whole suite passes but for `shell.spec.ts`'s pixel-ratio test, which fails the same way at the phase 3 merge on this machine's Chromium 153 and is not a phase 4 change.
- **`scene`.** Cartons, trays and pallets ride the belts as samples; the palletizer's load grows, the stretch wrapper turns, pallets ride to their batch's block. The quarantine shows one block per batch with a lamp, and a click on one selects its batch. Racks fill with stock (5 pallets a place), forklifts shuttle and trucks dock and leave. The hero block-outs load behind `?heroes`. Draw calls at the overview: 194 ([perf baseline](../../tests/perf/baseline.md#phase-4-packs-to-trucks)).
- **`ui`.** Panels 7–10 with state rows (each filler, packer lane and pallet, the newest pallet and its SSCC, the next pick, the dock), the stage 9 batch list with each batch's pallets, SSCCs and the QA override, the stage 10 stock and trucks, the filler-rate slider, and the per-filler OEE in the KPI strip.
- **`process`.** Logistics acceptance signed off: [H97–H103](../hand-calculations.md#phase-4-acceptance-runs), with the 60-day results at the defaults, the OEE definition and the pallet label fields checked against GS1. Panel text, captions and the About text cover stages 7–10.
- **Open.** 60 fps needs a real GPU ([To do on a real GPU](../../tests/perf/baseline.md#to-do-on-a-real-gpu)); the developer signs G2.

## Watch for

- **Stretching the schedule.** G2 is the safety net in the roadmap: if the full run doesn't work by week 9, cut items instead of moving the date.
- **One mesh per pack.** At ×10,000 the plant makes about 40 packs per real millisecond. Animate a sample and show the counts as numbers.

---

← [Phase 3. Liquid line](phase-3-liquid-line.md) · [Phase 5. Detail & scenarios](phase-5-detail-and-scenarios.md) →
