[Agent plan](README.md) · Phase 21 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 21 · Polish, performance & docs

Finish the yogurt line:
- the 60 fps check with both lines running;
- the regression suite;
- the documents brought up to date.

- **Entry:** phase 20 is merged.
- **Exit:** gate **Y3**, the yogurt demo.
- **Weeks:** 12. **Critical path:** `qa`, `lead`.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `qa` | `tests/perf/measure.mjs` with the wing: draw calls, triangles and fps at every stage 1–16; the 60 s camera path at ×1 and ×10,000 over both rows; the full browser suite | `tests/perf/`, `e2e/` |
| 1 | `scene` | Performance fixes (instancing, merged static meshes, label culling in the wing); polish | `src/scene/` |
| 1 | `ui` | Polish; the grouped rail and the panels at 1280 × 720 and 1440 × 900 in both themes | `src/ui/` |
| 2 | `process` | A final check of every yogurt number against D26 and H122–H138; the yogurt demo steps with the numbers to expect | `src/data/`, `docs/demo-script.md` |
| 2 | `lead` | The README's "Use it" (the yogurt line and tour); `docs/report.md`, `docs/slides.md`, `docs/video-script.md`; the status of phases 15–21 | `README.md`, `docs/`, `plan/` |

## Exit checklist (gate Y3)

- [x] `npm run check`, `npm run build` and the full browser suite pass. *But for the sandbox's known failures: unit-test timeouts under the parallel run and the pixel-ratio browser test, which `master` fails here too (status).*
- [ ] The 60 fps check passes with both lines in Chrome; the baseline is updated. *The baseline is updated (350 draw calls, every stage 1–16, the 60 s path at both speeds); the 60 fps verdict needs the target laptop's GPU.*
- [x] The README, report, demo script and slides cover the yogurt line.
- [ ] The developer runs the yogurt demo and signs Y3.

## Afterwards (Could)

- **Line P8 on the factory board:** show Let Report's yogurt lines on the factory board and its 3D floor. This changes [D19](../DECISIONS.md#d19-the-factory-board)'s rule that leaves them out. Agents: `factory-model`, `factory-ui`, `factory-scene`.
- More products on P8 (drinking yogurt, Greek-style strained), each as a recipe in `products`.

## Status

Built on 6 November 2026 in one session, on phase 20 as merged (PR #25). Y1 and Y2 are not yet signed, and D25–D30 are still Proposed. Lane by lane:

- **`qa`:**
  - **The full browser suite**, run against the sandbox's installed Chromium (the pinned Playwright's own browser is missing here): 93 of 101 passed at first. Seven failures were phase 20's, missed because its run covered only the specs it touched:
    - two tests still counted the UHT line's 7 menu entries (now 12) and 5 hero models (now 7);
    - and the yogurt tour's button made the rail head wrap to two rows, 6 px too tall, so the rail scrolled at 1280 × 720 and folded its groups at 1440 × 900 (four tests).
  - After the fixes those ten tests pass, and `stages`, `yogurtLiquid`, `p8` and `theme` (23 tests) pass again. The one left is the pixel-ratio test, which fails in this sandbox's browser on the commit before phase 15 too (phase 15 status).
  - **`npm run check`:** 1,825 of 1,826 unit tests pass and all 105 asset tests. The one that fails is a warehouse-motion run timing out under the parallel run. Up to three such tests time out from run to run here (that one, a second warehouse-motion run and the 30-day event queue); each passes alone, and `master` fails the same ones here. `npm run build` passes.
  - **Performance** ([baseline](../../tests/perf/baseline.md#phase-21-both-lines-every-stage-and-the-camera-path)): the overview reads 350 draw calls and 366,638 triangles, every stage 1–16 between 128 and 171 draw calls; the 60 s camera path runs at ×1 and ×10,000 without a stall. The 60 fps verdict is open until the developer runs it on the target laptop.
- **`scene`:** no change was needed: phase 20 left the overview at 350 draw calls. The cup, tray and reefer-unit models phase 20 left are **cut** here, for the reasons in [hero-specs.md](../../assets/hero-specs.md#phase-20-the-yogurt-wings-models-as-built): the cups' triangles, and the reefers' boxes.
- **`ui`:** the yogurt tour's button now sits on the yogurt group's header ("Tour", named "Yogurt tour"; `StageRail.groupHead`), as small as the header's text, so the rail head keeps one row. The rail and the panels hold at 1280 × 720 and 1440 × 900 in both themes (`liquid`, `yogurtWing` and `theme` tests).
- **`process`:**
  - **The number check:** `tests/config/yogurtSources.test.ts` checks that every number of the yogurt block, 126 of them, is named in D25–D30 with its source; their values are checked against H122–H138 by the yogurt tests.
  - **The yogurt demo** in [docs/demo-script.md](../../docs/demo-script.md#the-yogurt-demo): about 8 minutes, the wing as it opens, the yogurt tour and the five faults one after another, then the morning after. `tests/sim/yogurtDemoScript.test.ts` replays it and checks every number it quotes.
- **`lead`:** the README's "Use it" covers the yogurt line, its faults and its tour; the report gains a chapter on the yogurt line ([2.6](../../docs/report.md#26-the-yogurt-line-line-p8)) and its tests and performance; the slides a yogurt slide; the video script two minutes on the wing; the roadmap the status of weeks 11 and 12.

**Not built (Could, for after Y3):** Line P8 on the factory board, and more products on P8.

**For the developer:** run the 60 fps check on the target laptop, run the yogurt demo, sign Y1, Y2 and Y3, and approve or amend D25–D30.
