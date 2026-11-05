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

- [ ] `npm run check`, `npm run build` and the full browser suite pass.
- [ ] The 60 fps check passes with both lines in Chrome; the baseline is updated.
- [ ] The README, report, demo script and slides cover the yogurt line.
- [ ] The developer runs the yogurt demo and signs Y3.

## Afterwards (Could)

- **Line P8 on the factory board:** show Let Report's yogurt lines on the factory board and its 3D floor. This changes [D19](../DECISIONS.md#d19-the-factory-board)'s rule that leaves them out. Agents: `factory-model`, `factory-ui`, `factory-scene`.
- More products on P8 (drinking yogurt, Greek-style strained), each as a recipe in `products`.

## Status

Not started.
