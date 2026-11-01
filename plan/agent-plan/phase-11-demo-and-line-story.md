[Agent plan](README.md) · Phase 11 · [Roadmap](../09-development-roadmap.md)

# Phase 11 · The factory demo, and each line's story

Two things the board and its floor lack ([D21](../DECISIONS.md#d21-the-factory-demo-and-each-lines-story)). Anyone can open them now without a Let Report account: a demo shows a made-up day at the developer's factory, with the real layout, its lines stopping, cleaning and changing over on their own. And each line tells its story: how long it has been in its status, who changed it last and why, how far its CIP has come, and, on the floor, a marker over a line with open troubles.

- **Entry:** phase 10 is merged: the board and its 3D floor, live from Let Report.
- **Exit:** the checklist below; the developer opens `factory.html?demo#3d` with no account and watches a line stop, clean and change over.
- **After it:** the developer's own checks of phases 9 to 11 against Let Report's live data.

## The demo's script

`factory.html?demo` (or "Try the demo" on the sign-in form) opens the board signed in as the demo. Nothing is sent anywhere. The script runs 20 minutes and starts again; at each minute mark below the rows change as Let Report's would, and the board and the floor follow within a second.

| From | Line | What happens |
|---|---|---|
| 0:00 | All six UHT lines, SCM, Yogurt | Running, each on a lot started earlier in the shift |
| 2:00 | UHT-line 3 | Stops: note "Jaws not sealing"; a high trouble opens at it |
| 4:00 | UHT-line 7 | CIP for 12 minutes, reason "standard": UHT 3 is in CIP |
| 6:00 | UHT-line 3 | Runs again; its trouble waits for verification, still open |
| 8:00 | UHT- line 2 | Changeover to another product |
| 10:00 | UHT-line 3 | Its trouble closes |
| 12:00 | UHT- line 2 | Runs the new product, on a new lot |
| 13:00 | UHT line 4 | Maintenance |
| 16:00 | UHT-line 7, UHT line 4 | Both run again, line 7 on a new lot |
| 17:00 | UHT-line 1 | A low trouble opens, until the script starts again |

Each change names who made it: "Shift lead", "Operator" or "QA", never a real person. Output counts up by one a minute on each running line, against a target of 100.

## Contracts

`lead`, in `src/factory/view.ts` and `types.ts`:

- `LineRow` reads four more of Let Report's columns, which the board already gets with `select=*`: `cip_started_at`, `cip_reason`, `note`, `updated_by_name`.
- `LineView` adds `statusForS`, `changedBy`, `note`, `cipReason` and `cipDoneFrac` (the comments say exactly how).
- `DemoFactory = (startMs, nowMs) => FactoryData` and `DEMO_CYCLE_MS` (headless), for `demoFactory` in `src/factory/demoData.ts`.
- `CreateDemoClient`, `DemoClientOptions`, `DEMO_TICK_MS` and `DEMO_USER`, for `createDemoClient` in `src/factory/demoClient.ts`: a `FactoryClient` with nothing behind it.

## Who does what

The agents' definitions are in `.claude/agents/`.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | Contracts, this card, D21, the agents' new files | `src/factory/view.ts`, `src/factory/types.ts`, `tsconfig.headless.json`, `plan/`, `.claude/agents/` |
| 1 | `factory-model` | The line's story in `buildFactory`; the demo's rows, the script above, pure and repeatable | `src/factory/model.ts`, `src/factory/demoData.ts`, `tests/factory/model.test.ts`, `tests/factory/demoData.test.ts` |
| 1 | `factory-client` | `createDemoClient`: signed in as the demo, load, subscribe (live at once, then a change each time the rows change), sign out; no network, no storage | `src/factory/demoClient.ts`, `tests/factory/demoClient.test.ts` |
| 1 | `factory-scene` | On the floor: a trouble marker over a filler with open troubles, in its worst severity's colour; a ring on the floor round a cleaning filler that fills as its CIP goes; how long a line has been stopped, changing over or in maintenance in its label | `src/factory/scene/`, `tests/factory/floor.test.ts` |
| 1 | `factory-ui` | Each row's story (how long, by whom, the note, the CIP's reason and progress); `?demo`: the demo client, a banner that says the data is made up, "Leave the demo"; "Try the demo" on the sign-in form | `src/factory/board.ts`, `src/factory/main.ts`, `src/styles/factory.css` |
| 2 | `qa` | `e2e/factoryDemo.spec.ts`: the demo with no account and no request to Let Report, its script on the board and the floor (with the page's clock moved on); the line's story against faked Let Report in the board's spec; the full checks | `e2e/factoryDemo.spec.ts`, `e2e/factory.spec.ts`, `e2e/factoryFloor.spec.ts`, `e2e/letReportFake.ts` |
| 2 | `lead` | Review and merge, the README, the roadmap, this card's status | docs |

Wave 1 runs at once: no two agents write the same file, and none commits. Until `factory-model` has filled in the new `LineView` fields, the typecheck fails in `model.ts`; that is its error to fix, not the others'.

## Exit checklist

- [x] `npm run check` and `npm run build` pass; the board's page still loads no three.js until the 3D view opens.
- [x] `tests/factory/model.test.ts`: each new field, with its missing and malformed cases.
- [x] `tests/factory/demoData.test.ts`: the script's states at each minute mark, the same rows for the same times, the loop, rows the model reads as it reads Let Report's.
- [x] `tests/factory/demoClient.test.ts`: signed in at once, load, a change event per change of the rows and none otherwise, stop, sign out; nothing sent.
- [x] `tests/factory/floor.test.ts`: the trouble markers and their colours, the CIP ring's share, freed on dispose.
- [x] `e2e/factoryDemo.spec.ts`: the demo opens from the sign-in form and from `?demo#3d` with no request to Let Report; UHT-line 3 stops at 2:00 on the board and the floor, with its trouble marker; UHT-line 7's CIP fills its ring; leaving the demo returns to the sign-in form.
- [x] The board's and the floor's specs still pass, with the line's story checked against faked Let Report.
- [ ] The developer opens `factory.html?demo#3d` with no account and watches the script run.

## Status

Built on 30 October and 1 November by the agents, as the table above has them. `lead` wrote the contracts, the card and D21. The four wave 1 agents worked at once in one checkout: `factory-client` and `factory-ui` finished in one run. `factory-model` and `factory-scene` stopped partway when the account hit its usage limit, and finished once it reset. `qa` then wrote the browser tests and ran the checks. `lead` reviewed each lane and committed it on its own.

- `npm run check`, run twice: typecheck (both configs; `demoData.ts` checked headless), lint, 1,474 unit tests in 62 files, 69 asset tests. Of the unit tests, 185 are new: 52 for the line's story in the model, 60 for the demo's script, 17 for its client and 14 for the floor's markers, rings and label words. `npm run build`: the board's page still preloads only its shared chunk, and three.js and the floor come with the 3D view.
- The factory's browser tests: 19 of 19, twice, on Chromium 153.
  - `e2e/factoryDemo.spec.ts`, 5 tests:
    - The demo from "Try the demo" and from `?demo#3d`.
    - The script on the board and on the floor with the page's clock set, step by step: UHT-line 3's stop, note and trouble marker, and "Stopped · 1 min 00 s"; the marker staying through verification and going at 10:00.
    - UHT-line 7's CIP: its bar and ring at 0, 25 and 50 %, UHT 3 in CIP and its pipes cleaning.
    - Leaving the demo in the same view.
    - Every test checks that nothing reached Let Report and nothing was stored.
  - `e2e/factory.spec.ts` (7) and `e2e/factoryFloor.spec.ts` (7): the line's story against faked Let Report, the markers by worst severity as reports close over the socket, and a ring to overdue and gone.
- The whole browser suite: 79 of 80 in 24.2 min. The one failure is the pixel-ratio test (`shell.spec.ts:58`, "buffer across at 2x"), which fails the same way on master, as phases 8 to 10 recorded. That run came before the plain `?demo#3d` test was added, which passed in both factory runs since.
- Known:
  - A demo change reaches the board up to 1.3 s after its mark: the client's 1 s look, then the page's 300 ms reload.
  - From the whole-floor view a trouble marker is only about 4 px tall: clear from a bay or a filler.
  - Under SwiftShader, Playwright's installed clock lets the page's timers fall behind the 3D floor's frames. So the demo's floor tests move the clock with the board alone in view, then read the floor. Phase 10's tests, with no clock, cover the floor updating while it shows.
- Open: the developer's own look at `factory.html?demo#3d`. CI still starts no job (phase 9's status), so these local runs are the evidence.
