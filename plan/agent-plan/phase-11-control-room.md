[Agent plan](README.md) · Phase 11 · [Roadmap](../09-development-roadmap.md)

# Phase 11 · The control-room look

Give the simulation and Let Report one modern look: a dark control room, like a plant's operations screen, with the light theme kept ([D21](../DECISIONS.md#d21-the-control-room-look)). Three screens: the 3D simulation, the factory board (with its 3D floor), and Let Report ([its card](https://github.com/Sophanit-Keo/let-report/blob/main/plan/phase-11-control-room.md)). Nothing the screens show or do changes; only how they look.

- **Entry:** phases 9 and 10 are merged.
- **Exit:** the checklist below; the developer opens the three screens and keeps the dark look as the default.

## The look

- **Dark by default, light kept.** Each page sets `<html data-theme>` before its CSS loads, from the viewer's choice kept in this browser, else `dark` (`src/ui/theme.ts`, `THEME_KEY`). A Light/Dark button switches it (`createThemeToggle`). The 3D views follow the attribute.
- **Surfaces:** a near-black graphite page (`--bg`) with a faint 24 px grid (`--grid`), panels (`--surface`) with a 1 px border (`--line`) and a 1 px top highlight (`--edge`), 12 px corners, no heavy shadows.
- **Type:** labels in Barlow Condensed, uppercase, letter-spaced, muted; live numbers large in IBM Plex Mono with tabular figures; body in Barlow.
- **Status:** lamps glow in the dark theme (`--glow-ok`, `--glow-warn`, `--glow-bad`); a running lamp may breathe slowly; status chips are tinted, never solid blocks.
- **Action:** one cyan accent (`--accent`) for selection, focus and links, with `--glow-accent` on focus; ghost buttons; dialogs on a dark scrim.
- **Motion:** 150–250 ms on hover, selection and live updates; none under `prefers-reduced-motion`.
- **Fixed:** every `data-testid`, role, label and keyboard path; the one-screen layout at 1280 × 720; lamps 3:1 and text 4.5:1 against their backgrounds in both themes.

## Contracts (`lead`, before the agents start)

- `src/styles/tokens.css`: the dark set is the control room. New tokens in both sets: `--glow-ok`, `--glow-warn`, `--glow-bad`, `--glow-accent`, `--edge`, `--grid`. Names are fixed; `ui` may tune values within the contrast tests.
- `src/ui/theme.ts`: `ThemePref`, `THEME_KEY`, `DEFAULT_THEME`, `readTheme`, `currentTheme`, `applyTheme`, `createThemeToggle(signal)`.
- `index.html`, `factory.html`: the inline script that sets the theme before the CSS.

## Who does what

The agents' definitions are in `.claude/agents/`.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | The palette and tokens, the theme module and boot scripts, this card, Let Report's card, D21, the `ui` and `scene` definitions | `src/styles/tokens.css` (first pass), `src/ui/theme.ts`, the two boot scripts, `plan/` |
| 1 | `ui` | The 3D app's screen in the control-room look: top bar (with the theme button by About and Factory), stage rail, info panel, KPI strip (big numbers), event log, scenario banner, dialogs, tour caption, overlays | `src/styles/app.css`, `src/styles/tokens.css` (values), `index.html` (markup), `src/ui/` (not `theme.ts`) |
| 1 | `scene` | The teaching plant in the dark theme: lamps that glow (emissive), a fine grid on the floor, cooler light; labels as control-room tags | `src/scene/`, `tests/scene/` |
| 1 | `factory-ui` | The factory board in the control-room look: header with the theme button, UHT cards, draw bars, line rows, sign-in, the Board / 3D switch and the floor's overlays | `factory.html` (markup), `src/factory/board.ts`, `main.ts`, `src/styles/factory.css` |
| 1 | `factory-scene` | The factory floor in the dark theme, as `scene` does for the plant | `src/factory/scene/`, `tests/factory/floor.test.ts` |
| 2 | `qa` | The full checks; screenshots of the three screens in both themes at desktop and phone width; every browser test | `e2e/` (a theme test) |
| 2 | `lead` | Review the screenshots and diffs, D21, the status, the PRs | `plan/` |

## Exit checklist

- [ ] `npm run check` and `npm run build` pass; the contrast tests pass in both themes.
- [ ] The browser suite passes as before (the pixel-ratio test fails on master too), with a test that the page opens dark, switches to light, and keeps the choice after a reload.
- [ ] Screenshots of the 3D app, the board and its floor, in both themes, at 1440 × 900 and 390 × 844, reviewed.
- [ ] The draw calls of both 3D views stay within the baseline.
