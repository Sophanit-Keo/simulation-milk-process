[Agent plan](README.md) · Phase 28 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 28 · The holding cell and Line P8, explained and in more detail

The developer's requests after phase 27:
- "add the holding cell explanation to its panel";
- "add the details of the machine filling", answered as Line P8, in the panel and in 3D.

- **Entry:** phase 27 is merged (PR #31).
- **Exit:** the checklist below.
- **Critical path:** `ui`, `scene`.

## What it adds

**In the panel**, a note under the process flow, open by default (closed, it stays closed for the session):

| Stage | Note | Its sections | Its live readings |
|---|---|---|---|
| 12 | The holding cell | What it is, why yogurt needs it, the critical control point, at this plant (how to watch a divert) | The outlet against 85 °C, the hold against 3 min, the whey protein denatured against 85 %, what the CCP does, the diverts so far |
| 15 | Line P8, the cup filler | What it does, station by station, clean air, what stops it | Its state (and why it stopped), its speed, the last cup's weight, the seal, the HEPA cabin, the magazines, the next seal test |

The text is `src/data/machineNotes.json`, written as `process` writes the process flow's. A test holds every number in it to `plant.json`, so the text cannot drift from the model.

**In 3D, Line P8**, as instances in the shared box mesh (no draw call):

| Part | What it does |
|---|---|
| The de-nester's suction bar | Strokes down once a cycle in the carrier's dwell, ahead of the pistons, on P8's own carrier clock |
| The HEPA hood's three fans | Turn on the filter housing while the cabin holds; in a HEPA loss they run down over 1.5 s and stand |
| The magazines' level bars | The cups' on the de-nester's upright, the foils' on the foil magazine: green, amber under the refill mark |
| The sealing heads' display | Green while the seal is in its window, red outside it (the seal drift) |
| The stack light | Over the out end: green while P8 runs, amber while it waits, cleans or sterilizes, red when stopped |
| The operator's screen | On the cabinet's aisle side, lit with the same state |

## Exit checklist

- [x] Stage 12's panel explains the holding cell, and stage 15's Line P8, with live readings.
- [x] The notes' numbers match `plant.json`.
- [x] Line P8's new parts follow the sim and stand while it is paused.
- [x] `npm run check`, the browser tests and the draw-call budget pass.
- [ ] The developer reads both notes and watches P8 at ×1.

## Status

Built on 7–8 November 2026, on phase 27 as merged (PR #31).

- **`ui`:** `src/ui/machineNotes.ts` reads the notes, works out their live readings (`NOTE_FACTS`) and builds the panel part. `hud.ts` adds it under the process flow, and `app.css` styles it.
- **`scene`:**
  - `yogurt/p8Detail.ts` lists P8's new parts.
  - `wingMotion.ts` draws them after the hall's, and now takes P8's carrier, so the de-nester strokes with the other stations. `p8Machine.ts` exports its `stroke`.
- **`qa`:**
  - `tests/ui/machineNotes.test.ts` checks:
    - the file and its refusals;
    - every number in both texts against `plant.json`;
    - the readings at the opening, in production (92 °C, 5 min, 99.2 %, forward), in a divert and its clean;
    - P8 stopped by a HEPA loss.
  - `tests/scene/wingMotion.test.ts` checks:
    - the de-nester's full stroke once a cycle, standing while paused;
    - the fans running down to a stop in a HEPA loss, with the stack light and screen red;
    - the seal display red under 180 °C in the seal drift;
    - the magazines' bars, amber under the refill mark.
  - `e2e/yogurtNotes.spec.ts` checks both notes, their live readings, a closed note staying closed, and P8's de-nester, fans and stack light in the browser.
- **Checks:**
  - `npm run check`: 1,874 of 1,875 unit tests pass, and the 114 asset tests. The one that fails is `warehouseMotion.test.ts`'s truck run, which times out under the parallel run here (as in phases 24 to 27) and passes alone, 29 of 29.
  - `npm run build` passes.
  - The browser tests `yogurtNotes`, `p8`, `yogurtMotion` and `yogurtFlow` pass.
  - **Draw calls:** the overview reads **350** draw calls and 389,694 triangles (the [baseline](../../tests/perf/baseline.md#phase-28-the-holding-cell-and-line-p8-explained-and-in-more-detail)).
