[Agent plan](README.md) · Phase 31 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 31 · Each machine of the cup filling room, explained and in motion

The developer's request after phase 30: "add the details on each machine in filling room and the animation and what does it do". Phase 30 put the room's units on the floor and more of Line P8 in motion. Three things were still missing ([D33](../DECISIONS.md#d33-each-machine-of-the-cup-filling-room-explained)):

- **What each machine does** is written nowhere. Stage 15's panel explains Line P8 as a whole (phase 28); the check gates and the room's units have no text.
- **The room's units have no name** in 3D: the air unit, the CIP/SIP skid, the QA bench and the supplies are boxes without a label.
- **The three check gates barely move:** a belt roller and a lamp each.

Nothing in the sim, the contracts or `plant.json` changes.

- **Entry:** phase 30 (PR #34, the same pull request).
- **Exit:** the checklist below.
- **Critical path:** `process` (the text), `ui`, `scene`.

## What it adds

### In the panel: a note for each machine

Stage 15's panel keeps Line P8's note, open, and gains ten more under it, closed until asked for. Each has the same three parts, **What it does**, **How it works** and **In the 3D view** (what moves and what the colours mean), under its live readings. Line P8's own note gains an "In the 3D view" part.

| Note | Its live readings |
|---|---|
| The de-nester and cup cleaning | Cups set down a minute, the cup magazine, the UV-C tunnel |
| The piston filler | The last cup's weight, the feed from the buffer, doses an hour |
| The lidder, the sealing heads and the coder | The seal's temperature, time and pressure, the foil magazine, what is printed on the lid |
| The checkweigher | The last cup, the limits, cups under- and over-filled |
| The metal detector | What it does now, cups thrown out |
| The vision check and the reject bin | What it does now, cups thrown out, cups in the bin |
| The sterile air unit and the HEPA hood | The cabin's pressure against its limit, the fans |
| The CIP/SIP skid | Clean, SIP or standing by; the last SIP; the ATP swab |
| The QA bench and the seal test | The next test, tests passed and failed, cups held back |
| Cups, foils and the operator | Both magazines, where the operator is |

- The text is `src/data/machineNotes.json`. A note may say `"open": false`; a viewer's own opening or closing is kept for the session.
- A test holds every number in the text to `plant.json`.

### In 3D: name tags

A label floats over each of the room's units, as over the machines, with what it does now:

| Tag | Reads |
|---|---|
| Sterile air unit | The cabin's pressure; "fan stopped" under its limit |
| CIP/SIP skid | "standing by", "CIP running" or "SIP · 123 °C steam" |
| QA bench | The time to the next seal test |
| Cup cartons, Foil lids | The magazine's level; "refilling" while it calls |

A tag is an empty group with a label: no mesh, no draw call, no click.

### In 3D: the check gates in motion

| Machine | Part | What it does |
|---|---|---|
| Checkweigher | Weigh platform | Dips 4 mm under each row of cups, 1.5 rows a second at full rate |
| | Scale on its front | From the under limit to the over limit: a green tick at the target, a red marker at the last cup's weight |
| Metal detector | Tunnel mouths | Dark, on the arch's two ends |
| | Field bar on the arch's face | A marker sweeps it while the coils search: blue, red on a reject, grey while the line stands |
| Vision check | Strobe under the camera | White for the first quarter of each row |
| | Monitor on a post | Blue while it looks, red on a reject, dark while the line stands |
| Reject bin | Chute | A trough from behind the belt at the reject flap down to the bin |

All are instances in the shared box mesh, as phase 30's.

## Contracts (`lead`)

No contract changes. The overview stays at 350 draw calls.

- **Equipment ids, new (stage 15, tokens):** `p8-air-unit`, `p8-cip-skid`, `p8-qa-bench`, `p8-cup-supply`, `p8-foil-supply`.
- **Debug state, new keys:** `p8-checkweigher`: `weighPlatformTurns`/`Moving`, `weighMarkerReading` (% of the way from the under to the over limit); `p8-metal-detector`: `fieldSweepMoving`/`Color`; `p8-vision`: `strobeColor`/`Moving`, `monitorColor`; `p8-reject-bin`: `chuteColor`.

## Who does what

Built by `lead` lane by lane in one session, within the agents' ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | This card, D33 | `plan/` |
| 2 | `process` | The ten notes' text and Line P8's new part | `src/data/machineNotes.json` |
| 3 | `ui` | A note's `open`, the readings of the ten notes | `src/ui/machineNotes.ts` |
| 4 | `scene` | The gates' parts and the chute in `yogurt/cupRoomDetail.ts`; the tags in `yogurt/cupRoomTags.ts`, listed in `yogurtLine.ts` | `src/scene/equipment/` |
| 5 | `qa` | `tests/ui/machineNotes.test.ts`, `tests/scene/cupRoom.test.ts`, `tests/scene/yogurtLine.test.ts` (the tags in the wing's list), `e2e/yogurtNotes.spec.ts` | `tests/`, `e2e/` |

## Exit checklist

- [x] `npm run check` passes.
- [x] Each machine of the room has a note with what it does, how it works and what the 3D view shows, and live readings.
- [x] The notes' numbers match `plant.json`.
- [x] The room's five units carry a tag that follows the sim.
- [x] The gates' new parts move while P8 runs and stand when it stops.
- [x] The overview stays at 350 draw calls.
- [ ] The developer reads the notes and watches the gates at ×1.

## Status

Built on 12 November 2026 in one session, on phase 30's branch.

- **Checked:** the typecheck, the lint and the tests of `tests/ui/`, `tests/scene/cupRoom.test.ts` and `tests/scene/yogurtLine.test.ts` pass. The overview draws 350 calls. The full `npm run check` and its count are in the pull request.
- **Browser tests:** one is new, in `e2e/yogurtNotes.spec.ts` (the eleven notes, the tags, the gates). Its result is in the pull request.
- **Not checked:** the frame rate on a real GPU; how the eleven notes read on a small screen (the panel scrolls).
- **Left out:** a click on a machine still selects its stage, not its note; the operator has no tag.
