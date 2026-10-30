[Agent plan](README.md) · Phase 11 · [Roadmap](../09-development-roadmap.md)

# Phase 11 · Direct or indirect UHT, and a phone layout

Build the two items left on the roadmap's stretch list ([D21](../DECISIONS.md#d21-phase-11-plant-type-and-phone-layout)): the teaching plant runs as either a direct or an indirect UHT plant, and the page works on a phone by touch. It is the first phase planned for the faster way of working: three waves instead of weeks, the lane kit, and the two test tiers ([Working together faster](README.md#working-together-faster), [D22](../DECISIONS.md#d22-faster-lanes-waves-the-lane-kit-and-test-tiers)).

- **Entry:** phase 10 is merged, and `npm run check` and the full browser suite pass on `master`. They did on 30 October, with the lane kit in place: 73 of 73 on a production build (`E2E_SERVER=preview`, 27 min), including the pixel-ratio test that fails on the dev server.
- **Exit:** the checklist below.
- **After it:** the plant type stays a run setting; switching inside a running sim, with the plant re-sterilized in between, would be a later phase.

## The two features

**Direct or indirect UHT.** The plant is direct today: steam goes into the milk, and a flash vessel takes the same water out again. An indirect plant heats through a tubular heat exchanger instead, so nothing is added or taken out, and the milk going out heats the milk coming in (regeneration). The model and the 3D view follow the type the run starts with:

| | Direct (today) | Indirect (new) |
|---|---|---|
| Preheat | About 80 °C | About 75 °C, from the outgoing milk ([stage research](../03-stages-1-5-liquid-line.md#2-preheating--deaeration)) |
| Heating to UHT | Steam injector | Tubular heater, hot water on the other side |
| Stage 5 | Flash vessel (water removed = steam added), then the cooler | Regenerative cooling, then the cooler; no water removed, no condenser |
| Homogenizer before UHT | Borrowed from indirect plants (R5) | Where indirect plants have it |
| Hold, F0, B\*, divert | Unchanged | Unchanged: the same holding tube, formulas and rule (D4) |

The run picks its type from `plant.json` (`uht.plantType`, direct by default) or the address, `?plant=indirect`. A switch in the top bar reloads the page with the other type, so a run never changes type halfway. `process` settles every indirect number with a source in D21 before the acceptance rows are written.

**A phone layout.** Below 720 px the page already stacks into one column. The phone layout makes that stack usable by touch:
- The 3D view first.
- The stage rail as a strip to swipe.
- The info panel as a sheet that a tapped stage opens.
- The KPIs two to a row.
- A top bar that fits 360 px.
- Touch targets of at least 44 px.
- Pinch and drag move the camera.

It lives in files of its own (`src/styles/phone.css`, `src/ui/phone.ts`), so it is built beside the plant-type work without touching the same lines.

## Contracts (wave 0, `lead`)

- `CONTRACT_VERSION` 7: `PlantType = 'direct' | 'indirect'` and `Snapshot.plantType`. The line points keep their ids; in an indirect plant `flashVessel` reads the outlet of the regenerative cooling, as its doc comment says. Ids can't be renamed after G2.
- `plant.json` schema 9:
  - `uht.plantType`;
  - an `indirect` block whose keys `process` and `sim` agree on in the wave-0 card. The lead writes it with placeholder values marked "to be settled, D21". Code and tests read the keys, so `process` can change the values in wave 1 without breaking anyone.
- Stage value keys for the indirect plant, agreed in the card as phase 3 did:
  - stage 2 `regenerationPct`;
  - stage 4 `heatingMediumTempC`;
  - stage 5 `regenOutletTempC`;
  - `waterRemovedLph` and `condenserKw` read 0.
- `main.ts` reads `?plant=` and hands the type to `createSim` and the HUD.
- The `?mock` sim answers for both types from wave 0, so `scene` and `ui` build the indirect plant before `sim` has it.
- `scripts/lanes.json` gets a `ui-phone` lane that owns the phone layout's two new files and `e2e/phone.spec.ts`. The lead creates the files as stubs, so the lanes test can check they exist.

## Who does what

The agents' definitions are in `.claude/agents/`. Every lane starts with `npm run lane -- setup <lane>` in its worktree and ends with `npm run lane -- check <lane> --e2e` and `npm run lane -- handoff <lane>`.

| Wave | Agent | Tasks | Owns |
|---|---|---|---|
| 0 | `lead` | Contracts v7, plant.json schema 9 with placeholders, `?plant=`, the mock for both types, the `ui-phone` lane and its stubs, the wave-1 task cards | `src/contracts/`, `src/main.ts`, `src/sim/mock.ts` (this once), `scripts/lanes.json`, `plan/` |
| 1 | `process` | D21's indirect numbers with sources; H rows for the indirect plant (preheat, regeneration, the temperatures along the line, the mass balance with no water added); the About text for both types; stage captions | `src/data/`, `plan/` |
| 1 | `sim` | The indirect plant in the liquid line: preheat, the tubular heater, regenerative and water cooling, no flash vessel. Same hold, F0, B\* and divert. The checks `plant.json` needs | `src/sim/`, `tests/sim/`, `tests/config/` |
| 1 | `scene` | The indirect plant in 3D: a tubular heater for the injector, a regenerative section for the flash vessel, no steam or vapour, the pipes' temperatures; touch orbit for the phone | `src/scene/`, `tests/scene/` |
| 1 | `ui` | The plant-type switch in the top bar and the panels for each type (stage 4 and 5 rows) | `src/ui/` (not the phone files), `index.html`, `src/data/stages.json` rows |
| 1 | `ui-phone` | The phone layout: the swipe rail, the panel sheet, the two-to-a-row KPIs, a 360 px top bar, 44 px targets | `src/styles/phone.css`, `src/ui/phone.ts`, `e2e/phone.spec.ts` |
| 1 | `assets` | Optional: a block-out of the tubular heater and the regenerative section, to the grey boxes' sizes | `assets/`, `public/models/` |
| 2 | `qa` | The indirect fixture (`tests/fixtures/snapshot-indirect.json`); the H rows as tests; mutants for the new model parts; the merge tier on the merged head | `tests/`, `e2e/` |
| 2 | `lead` | Merge train: squash each lane, `npm run lane -- owns <lane>` first; one merge tier for all; this card's status | `plan/` |

Wave 1's six lanes start together, the moment wave 0 is merged. None waits on another: each builds against the contracts, the mock and the recorded fixtures. `process` changes only values the others read by key.

## Exit checklist

- [ ] `npm run check` (with the lane-kit tests) and `npm run build` pass; `scripts/lanes.json` gives every new file a lane.
- [ ] With `?plant=indirect`, the run is an indirect plant:
  - preheat and regeneration as D21 sets them;
  - no water added or taken out, so the product leaving equals the product entering;
  - the hold, F0, B\* and the divert as in a direct plant;
  - every indirect H row passes within its tolerance.
- [ ] Setting the UHT below the divert limit still diverts within one step in either plant type (`e2e/divert.spec.ts` run for both).
- [ ] The top-bar switch reloads with the other type. The 3D view shows the tubular heater and regenerative section, or the injector and flash vessel. About explains both.
- [ ] At 390 × 844 and 360 × 800, with touch:
  - no sideways scroll;
  - a tapped stage opens its sheet;
  - pinch and drag move the camera;
  - every control is at least 44 px;
  - both themes (`e2e/phone.spec.ts`).
- [ ] The merge tier (`E2E_SERVER=preview npm run e2e`) passes on the merged head.
- [ ] The developer approves D21 and D22, and tries the phone layout on a real phone.

## Status

Planned. Nothing is built yet.
