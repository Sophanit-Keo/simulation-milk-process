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

- [ ] `npm run check` and `npm run build` pass; the board's page still loads no three.js until the 3D view opens.
- [ ] `tests/factory/model.test.ts`: each new field, with its missing and malformed cases.
- [ ] `tests/factory/demoData.test.ts`: the script's states at each minute mark, the same rows for the same times, the loop, rows the model reads as it reads Let Report's.
- [ ] `tests/factory/demoClient.test.ts`: signed in at once, load, a change event per change of the rows and none otherwise, stop, sign out; nothing sent.
- [ ] `tests/factory/floor.test.ts`: the trouble markers and their colours, the CIP ring's share, freed on dispose.
- [ ] `e2e/factoryDemo.spec.ts`: the demo opens from the sign-in form and from `?demo#3d` with no request to Let Report; UHT-line 3 stops at 2:00 on the board and the floor, with its trouble marker; UHT-line 7's CIP fills its ring; leaving the demo returns to the sign-in form.
- [ ] The board's and the floor's specs still pass, with the line's story checked against faked Let Report.
- [ ] The developer opens `factory.html?demo#3d` with no account and watches the script run.

## Status

Not started.
