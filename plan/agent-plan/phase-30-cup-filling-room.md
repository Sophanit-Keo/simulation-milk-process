[Agent plan](README.md) · Phase 30 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 30 · The cup filling room and Bench P8, in more detail

The developer's request after phase 29: "add details on the cup filling room of the machine Bench P8 animation and the details of the machine". Phase 18 made Line P8 fill its cups, phase 20 gave it its model and phase 28 its de-nester bar, hood fans, level bars and stack light. Two things were still plain ([D32](../DECISIONS.md#d32-the-cup-filling-room-and-line-p8-in-more-detail)):

- **The room:** Line P8, three check gates and a reject bin stand on an empty floor. Nothing shows where the cups and foils come from, who runs the machine, where its sterile air and its CIP and SIP come from, or where the seal tests are made.
- **The machine:** several things the SOP's Part 2 names happen unseen: the product feed, the ionized air jet, the dose being drawn, the foil being carried to the cup, the sealing heads' heat, the carrier's drive, the clean and the SIP.

This phase shows them. Nothing in the sim, the contracts, `plant.json` or the UI changes: every part is drawn from the snapshot the scene already reads (contracts v12).

- **Entry:** phase 29 is merged (PR #33).
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## What it adds

Every part is an instance in the cold chain's shared box mesh, as phases 23–29's: no draw call. "Motion seconds" are real seconds times `motionRate(speed)` (`src/scene/motion.ts`).

### Line P8, the machine

| Part | What it does | When |
|---|---|---|
| Feed valve, on the line from the buffer | Its stem lifts: green for product, amber for the clean, orange for the SIP | While P8 runs on a buffer with yogurt; in its clean; in its SIP |
| Cabin pressure gauge, on the hood's west post | Its needle reads the cabin's overpressure, 0–50 Pa | Always; it falls in a HEPA loss |
| Ionizer's jet, under its shroud | Lit ice-blue while it blows into the cups | Early in each cycle's dwell |
| Shroud's extraction fan | Turns | While P8 runs |
| Dosing crossheads, on the piston manifold | Stand up with a drawn dose and come down 0.08 m as the nozzles dispense it | Each cycle, with the pistons |
| Foil strip, under the foil pick | A row of lids rides down with the pick and is gone once the cups carry their lids | Each cycle, until the lids are set |
| Sealing platen, over the sealing heads | Rides their stroke: orange at its heat, red over 220 °C, dull under 180 °C | Always; the seal drift dulls it |
| Carrier's index drive, on the cabinet's aisle side | Steps a sixth of a turn | Each cycle, as the carrier indexes |
| Wash lances, under the hood's ceiling | Blink amber; stand orange | In the clean; in the SIP |

### The check gates and the reject bin

| Part | What it does |
|---|---|
| Each gate's belt roller | Turns while P8 runs |
| Each gate's lamp | Green while P8 runs; red for about 1.5 s when that gate throws a cup out (the checkweigher for an under- or over-fill, the metal detector, the vision check) |
| The checkweigher's display | Green for a last cup inside 120.5–135 g, red outside, dark before the first cup |
| The reject bin's heap | Grows 2 mm with each cup thrown out or held, up to 0.3 m |

### The room

| Thing | Where | What it does |
|---|---|---|
| Pallet of cup cartons | Aisle side, by the de-nester | 18 cartons in three layers. Each refill of the cup magazine takes a layer; a full pallet stands there once the last is gone |
| Cart of foil boxes | Aisle side, by the lidder | 9 boxes in three stacks. Each refill of the foil magazine takes a stack |
| Operator, in a white coat and a blue hairnet | At the machine's aisle side | Stands at the screen. Walks at 1.2 m/s to the de-nester while the cup magazine is under its refill mark or empty, or to the lidder for the foils (the cups first), and back once it is refilled |
| Sterile air unit | Behind the machine | Its two fans turn while the cabin holds its overpressure and run down in a HEPA loss; a duct rises from it and crosses to the HEPA housing |
| CIP/SIP skid | Behind the out end | Its CIP valve opens (amber) in the clean and its steam valve (orange) in the SIP; its display shows the SIP's 123 °C in the pipes' red; a line runs from it to the machine |
| QA bench | Aisle side, by the check gates | The seal tester's lamp is green after a test that passed and red after one that failed; the five cups the test took stand beside it for 10 sim minutes; a bar fills over the 2 h to the next test. A bench scale |
| Hygiene line | Round the machine, the gates, the supplies and the utilities | A yellow line on the floor, open at one gap on the aisle side: a sticky mat in the gap, a step-over bench beside it, a hand-wash basin and a gown locker outside it |

- **The scene's own counts:** the snapshot gives the magazines' levels and the counts of rejects and seal tests; the scene watches them change (`createCupRoomWatch`). A level that rises by more than 10 points between two frames is a refill. The counts start over when the sim's clock goes back.
- **Paused, everything stands**, the operator in mid-step.

## Contracts (`lead`)

No contract changes.

- **Draw calls:** none new. The overview stays at 350.
- **Debug state** (`?debug`, `window.__scene.equipmentState(id)`): each part's `…Turns` or `…Lift`, `…Moving` and `…Color`, as the wing's other parts report them, and these readings:

| Id | Keys |
|---|---|
| `p8-filler` | `cabinGaugeReading` (Pa), `ionJetReading` and `foilStripReading` (0 or 1), `doseHeadFrontReading` (0–1 down), `sealPlatenReading` (°C), `indexDriveReading` (cycles), `operatorReading` (its x, m), `cupCarton1Reading` (cartons left), `foilBox1Reading` (boxes left), `sipDisplayReading` (°C, 0 outside the SIP), `sealTestLampReading` (1 passed, −1 failed, 0 none), `sealTestDueReading` (%), `sampleCup1Reading` (cups on the bench) |
| `p8-checkweigher` | `weighDisplayReading` (g), `rejectLampReading`, `beltRollerTurns` |
| `p8-metal-detector`, `p8-vision` | `rejectLampReading`, `beltRollerTurns` |
| `p8-reject-bin` | `heapReading` (cups) |

## Who does what

The developer asked for this as one change; `lead` builds it lane by lane in one session, within the agents' ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | This card, D32 | `plan/` |
| 2 | `scene` | `yogurt/cupRoomDetail.ts`: the machine's, the gates' and the room's parts and the room's watch; listed in `yogurt/wingMotion.ts` after phase 29's | `src/scene/equipment/yogurt/` |
| 3 | `qa` | `tests/scene/cupRoom.test.ts` on the live sim; `e2e/yogurtMotion.spec.ts`; the overview's draw calls | `tests/`, `e2e/` |

## Exit checklist

- [x] `npm run check` passes.
- [x] The machine's new parts move once a cycle on P8's own carrier clock, and stand while it is paused.
- [x] The operator walks to the magazine that calls and back; a refill takes a layer of cartons or a stack of boxes.
- [x] The clean, the SIP, a HEPA loss and the seal drift each show on the room's parts.
- [x] The overview stays at 350 draw calls.
- [ ] The developer watches stage 15 at ×1 and ×10, zoomed in.

## Status

Built on 12 November 2026 in one session.

- **Checked:** `npm run check` passes (84 test files, 1,932 tests; 13 are new, in `tests/scene/cupRoom.test.ts`). The overview draws 350 calls, its budget.
- **Browser tests:** the new one passes on software GL (`e2e/yogurtMotion.spec.ts`: the room's parts move while P8 runs, stand while paused, and the air unit stops in a HEPA loss), and so does the overview's click test, which holds the draw calls. The full run's result is in the pull request.
- **Not checked:** the frame rate on a real GPU, and how the room reads to a person. That is the developer's to watch. From the stage's stop the air unit and the CIP/SIP skid stand behind the machine and show mostly their tops and the duct; orbit to see their valves.
- **Left out:** the room has no walls or ceiling, as no room of the plant has: they would hide the machine from the stage's camera. The hygiene line on the floor stands for the high-care zone's edge. The operator carries nothing, and no truck brings the new pallet of cups.
