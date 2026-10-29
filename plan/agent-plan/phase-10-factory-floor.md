[Agent plan](README.md) · Phase 10 · [Roadmap](../09-development-roadmap.md)

# Phase 10 · The factory floor in 3D, live from Let Report

Put the developer's factory on a floor in 3D, next to the board: its three UHT trains, each with its UHT plant, aseptic tank and fillers, moving as Let Report says its lines run ([D20](../DECISIONS.md#d20-the-factory-floor-in-3d)). The floor draws the board's view (phase 9, [D19](../DECISIONS.md#d19-the-factory-board)), so it reads nothing new from Let Report and writes nothing to it.

- **Entry:** phase 9 is merged: the board signs in, reads the lines, settings and open reports, and follows the realtime feed.
- **Exit:** the checklist below; the developer opens the 3D view signed in and watches a line stop on the floor when it is stopped in Let Report.
- **After it:** what the floor still draws by assumption (the hall's real layout, the machines' sizes, the tanks' volumes and levels) can move into Let Report's layout when the developer has it; each is a sim assumption in D20 until then.

## The floor

| Bay | Plant | Lines, left to right | Fillers drawn at |
|---|---|---|---|
| UHT 1 | 4,000 L/h skid, 8 m | UHT line 1, UHT line 6 | TFA × 0.85, TBA/22 × 1.1 |
| UHT 2 | 8,000 L/h skid, 10 m | UHT line 2, UHT line 3, UHT line 4 | TBA/19 × 1, A3/Speed × 1.15 twice |
| UHT 3 | 4,000 L/h skid, 8 m | UHT line 7 | A3/Speed × 1.15 |

From the back of each bay: the plant, its aseptic tank, a header along the fillers, and each filler on its 7 m outfeed belt. A running line's packs ride its belt and its pipe flows; a stopped one's packs stand still; a line in CIP has an empty belt and a pipe in the cleaning colour. The lamps and labels are the board's. Lines that name no UHT get a bay of their own, last.

## Contracts

- `src/factory/view.ts` (`lead`): the floor's layout, headless: `FactoryLayout` with its `BayLayout`s, each with a `UhtSpot`, a `TankSpot`, its `FillerSpot`s and `PipeRoute`s, and the camera's stops; `LayoutFactory`.
- `src/factory/types.ts` (`lead`): `FactorySelection` (a UHT by name or a line by id), `FactoryViewMode`, and `createFactoryScene(host, options): FactoryScene` (render a view, select, set active, dispose).
- `layoutFactory(view): FactoryLayout` in `src/factory/layout.ts`, pure and headless (`tsconfig.headless.json` checks it), with the pipes' and belts' speeds.
- `createFactoryScene` in `src/factory/scene/scene.ts`, loaded by `import()` only when the 3D view first opens.

## Who does what

The agents' definitions are in `.claude/agents/`.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | Contracts, this card, D20, the `factory-scene` agent; `EquipmentHost.context`, so the floor loads the hero filler through the 3D plant's loader | `src/factory/view.ts`, `src/factory/types.ts`, `tsconfig.headless.json`, `plan/`, `src/scene/equipmentHost.ts` (the context only) |
| 1 | `factory-model` | The layout: bays, plants, tanks, fillers by kind, belts, pipes and their routes, camera stops, the layout key; the pipes' and belts' speeds and the belts' states | `src/factory/layout.ts`, `tests/factory/layout.test.ts` |
| 1 | `factory-scene` | The floor: grey-box plants, tanks and fillers (the hero filler over its grey box), belts with tokens, pipes with flowing stripes, lamps; labels as buttons; picking, the camera's flights, the frame loop, the theme, the `?debug` hook | `src/factory/scene/`, `tests/factory/floor.test.ts` |
| 1 | `factory-ui` | The Board / 3D switch, `#3d`, the viewport beside the cards, the lazy load, "Show in 3D" and the marked card or row | `src/factory/board.ts`, `src/factory/main.ts`, `src/styles/factory.css` |
| 2 | `qa` | The 3D view's browser tests with Let Report faked, the fake moved out of the board's spec to share; the full checks; the board's own specs | `e2e/factoryFloor.spec.ts`, `e2e/letReportFake.ts`, `e2e/factory.spec.ts` |
| 2 | `lead` | Review and merge, the roadmap, the README, this card's status | docs |

## Exit checklist

- [x] `npm run check` and `npm run build` pass; the board's page still loads no three.js until the 3D view opens, which loads it in a chunk of its own.
- [x] `tests/factory/layout.test.ts`: the factory's three bays in Let Report's order with their lines left to right; the sizes by filler kind; the pipes from each UHT to its tank and to each filler; the unassigned bay; a UHT with no lines; the key changes with the layout but not with a status; the speeds.
- [x] `tests/factory/floor.test.ts`: a machine per UHT, tank and line; belts and pipes follow each line's status; a rebuild on a new layout and none on a new status; everything freed on dispose.
- [x] `e2e/factoryFloor.spec.ts`: signed in, the 3D view shows the three bays with their six lines; a live change stops UHT line 3 on the floor and UHT 2's label falls to 3,150 of 8,000 L/h; a click on a filler's label marks its row; `#3d` opens the 3D view after a reload; the board's six tests in `e2e/factory.spec.ts` still pass.
- [ ] The developer opens the 3D view signed in and sees a change made in Let Report on the floor within a second.

## Status

Built on 29 October in one session, lane by lane in the order above (contracts, layout, floor, page, tests), then checked as `qa` would:

- `npm run check`: typecheck (both configs; the layout is checked headless), lint, 1,331 unit tests in 60 files (42 new: 26 for the layout, 16 for the floor), 69 asset tests. `npm run build` gives both pages: the board's loads its own chunk and a small shared one, and the floor (25 kB), the 3D plant's shared code and three.js come by `import()` only when the 3D view opens.
- `e2e/factoryFloor.spec.ts`: 5 of 5, twice, on Chromium 153 with Let Report faked: three.js only on the switch, the three trains with their six lines running and the hero filler on each; a live change that stops UHT line 3 on the floor (red lamp, packs standing, its reel still, UHT 2 at 3,150 L/h) without building the floor again; a line in CIP with an empty belt and its train's pipes in the cleaning colour; picking by label, by "Show in 3D", by a click on the machine and by the keyboard, and Esc; `#3d` after a reload, Board and back to the same floor, and the floor gone on signing out. `e2e/factory.spec.ts`, the board's: 6 of 6, with its fake moved to `e2e/letReportFake.ts`.
- Looked at in Chromium at 1280 × 720, 1920 × 1080 and 390 × 844, light and dark: the labels show their name and status where there is room, their lamp and name or their lamp alone where there is less, so neighbours never run together.
- The full browser suite, the 3D plant's specs with it: running.
- Open: the developer's own signed-in check against the live database; CI still starts no job (phase 9's status), so these local runs are the evidence.
