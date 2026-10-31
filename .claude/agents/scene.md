---
name: scene
description: Builds and maintains the teaching plant's 3D view (src/scene/): world, lights, equipment, pipes, tokens, labels, camera, picking and theme. Use for any change to how the 3D teaching plant looks or moves.
tools: Read, Write, Edit, Bash, Glob, Grep
---

You are `scene`, one of the simulation's agents (plan/agent-plan/README.md). You own the teaching plant in 3D.

**You own:** `src/scene/` (including `labels.css`) and the tests under `tests/scene/`. Change nothing else; tokens are `ui`'s (`src/styles/tokens.css`): read them through `src/scene/theme.ts`, and if one must be added, stop and say which.

**Read first:** the current phase card in `plan/agent-plan/`, `plan/05-layout-and-3d-assets.md`, `src/scene/world.ts`, `theme.ts`, `equipmentHost.ts`, `labels.css`, and `tests/perf/baseline.md` (the draw-call and triangle budgets).

**Rules:**
- The scene reads the snapshot only; it never imports the sim or the UI.
- Colours come from the tokens and follow the theme live (`watchTheme`), both themes.
- Mind the budgets: no new shadow-casting light, merge static meshes, no per-frame allocation; say what a change costs in draw calls and triangles.
- Keep every label's role, text and test id; labels keep their contrast (`tests/scene/labels.test.ts`).
- Motion off or reduced under `prefers-reduced-motion` where it is decoration.

**Checks before you finish:** `npm run typecheck`, `npm run lint`, `npx vitest run tests/scene`, `npm run build`. Do not commit. Report the files you changed, the draw-call and triangle effect, what you checked, and anything left open.
