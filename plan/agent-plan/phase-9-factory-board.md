[Agent plan](README.md) · Phase 9 · [Roadmap](../09-development-roadmap.md)

# Phase 9 · The factory board, live from Let Report

Show the developer's real factory next to the teaching plant: its three UHT plants and six filling lines, live from [Let Report](https://let-report.vercel.app), the factory's QC/QA app. The board mirrors Let Report: a line shows what Let Report says as soon as it changes, and the board adds nothing of its own ([D19](../DECISIONS.md#d19-the-factory-board)).

- **Entry:** phase 8 is merged; Let Report's phase 9 ([its card](https://github.com/Sophanit-Keo/let-report/blob/main/plan/phase-9-factory-layout.md)) gives each line its UHT, filler, speed and pack size.
- **Exit:** the checklist below; the developer signs in on the board and watches it follow a change made in Let Report.
- **After it:** phase 10+, the three UHT trains in 3D, planned separately.

## The factory

| UHT | Capacity | Lines | Filler | Rated speed | At 100 ml |
|---|---|---|---|---|---|
| UHT 1 | 4,000 L/h | UHT line 1 | TFA | 3,600 packs/h | 360 L/h |
| | | UHT line 6 | TBA/22 | 20,000 packs/h | 2,000 L/h |
| UHT 2 | 8,000 L/h | UHT line 2 | TBA/19 | 7,500 packs/h | 750 L/h |
| | | UHT line 3, 4 | A3/Speed | 24,000 packs/h | 2,400 L/h each |
| UHT 3 | 4,000 L/h | UHT line 7 | A3/Speed | 24,000 packs/h | 2,400 L/h |

There is no line 5. With every line running, UHT 1's lines draw 2,360 of its 4,000 L/h, UHT 2's 5,550 of 8,000 and UHT 3's 2,400 of 4,000. The speeds are published ratings and the pack size a start (D19); both are edited in Let Report, and the board follows.

## Contracts

`src/factory/types.ts` (`lead`): the Let Report rows the board reads (`LineRow`, `SettingsRow`, `ReportRow`), the view it draws (`FactoryView`, `UhtView`, `LineView`), and the two seams the agents build against:

- `buildFactory(data, nowMs): FactoryView` in `src/factory/model.ts`, pure and headless (`tsconfig.headless.json` checks it);
- `createFactoryClient(options): FactoryClient` in `src/factory/supabase.ts`: sign in, sign out, load, subscribe.

Let Report's side: `production_lines.uht`, `filler`, `filler_packs_per_h`, `pack_ml`, and `factory_settings.uht_units` = `[{ name, capacityLph }]` (its migration 0013).

## Who does what

The agents' definitions are in `.claude/agents/`.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | Contracts, this card, Let Report's card, the agent definitions | `src/factory/types.ts`, `tsconfig.headless.json`, `plan/` |
| 1 | `factory-client` | The Let Report client: password sign-in, refresh, sign-out, the session in localStorage; reads of the lines, the settings and the open reports; the realtime socket on the three tables, reconnecting by itself. Fetch and WebSocket passed in, so tests stand in for them | `src/factory/supabase.ts`, `src/data/letReport.json`, `src/ui/letReport.ts` (its URL), `tests/factory/supabase.test.ts` |
| 1 | `factory-model` | The view: each UHT with its lines, draws, load, state and lamp; each line's lamp, status text, CIP and lot clocks, open troubles; the lines no UHT claims | `src/factory/model.ts`, `tests/factory/model.test.ts` |
| 1 | `factory-ui` | The page: sign-in form, three UHT cards with a draw bar and line rows, the live state and last change, sign-out; a reload on each change and every 15 s; clocks each second. A Factory link in the 3D app's top bar, and back | `factory.html`, `src/factory/main.ts`, `src/factory/board.ts`, `src/styles/factory.css`, `vite.config.ts`, the link in `src/ui/` |
| 2 | `qa` | `e2e/factory.spec.ts` with Let Report faked (`page.route`, `page.routeWebSocket`); the full checks; Let Report's forms against a fake backend | `e2e/factory.spec.ts` |
| 2 | `lead` | Review and merge, D19, the roadmap, the README, this card's status; Let Report's migration on the database; the PRs | docs |

Wave 1 runs at once: no two agents write the same file, and none commits.

## Exit checklist

- [x] `npm run check` and `npm run build` pass; the build has both `index.html` and `factory.html`.
- [x] `tests/factory/model.test.ts`: every status's lamp and text; UHT 2 draws 5,550 of 8,000 L/h; over capacity warns; the CIP and lot clocks; lines with no UHT; a missing speed.
- [x] `tests/factory/supabase.test.ts`: sign-in, refresh, sign-out on a 401, the change events, reconnecting.
- [x] `e2e/factory.spec.ts`: signed in, the three UHT cards show their lines and fillers (UHT line 2 on its TBA/19); a live change stops UHT line 3 and UHT 2 falls from 5,550 to 3,150 L/h; a CIP shows its time left.
- [x] The 3D app's browser tests still pass with the Factory link in the top bar.
- [ ] The developer signs in on the board and sees a change made in Let Report within a second.

## Status

Built by the five wave 1 agents in parallel, then checked by `qa`, on 29 October:

- `npm run check`: typecheck (both configs), lint, 1,289 unit tests in 58 files (128 of them the factory's: 90 for the model, 38 for the client), 69 asset tests. `npm run build` gives both pages; the board's loads no three.js.
- `e2e/factory.spec.ts`: 6 of 6, twice, on Chromium 153 with Let Report faked (`page.route`, `page.routeWebSocket`): sign-in and a wrong password, the three cards, a live change (UHT 2 to 3,150 L/h without a reload), a CIP counting down, sign-out, the Factory link and back.
- The 3D app's shell, smoke, About and KPI specs: 12 of 13. The pixel-ratio test (`shell.spec.ts:58`) fails the same way on master before phase 9, as phase 8 recorded.
- Let Report (its card): the forms against a fake backend, 7 checks; migration 0013 applied to its database, where the six UHT lines now carry their layout.
- Open: the developer's own signed-in check against the live database. CI does not run at present (GitHub Actions starts no job, on master too), so these local runs are the evidence.
