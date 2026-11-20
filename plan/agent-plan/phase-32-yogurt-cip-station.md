[Agent plan](README.md) · Phase 32 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 32 · The yogurt wing's CIP station, its cleans in motion

The developer's request after phase 31: "add the CIP processing in the yogurt line and improve the animation". The wing cleans often, but the 3D view and the panel hardly showed it ([D34](../DECISIONS.md#d34-the-yogurt-wings-cip-station-and-its-cleans-in-motion)):

- **No station.** The UHT plant has a CIP station whose lines carry each fluid's colour (phases 7, 13). The wing's CIP (D27) ran from nowhere: no tanks, no pumps, no lines.
- **A tank's clean had no steps.** A fermentation tank sat "cleaning" for 45 min after it emptied, the commonest clean of the wing, with nothing in the snapshot but its state.
- **P8's CIP before set yogurt** gave only its time left; the heat treatment's after a divert gave its step, but its pipes kept the mix's colours.
- **Nothing said what the wing's cleans use**, where the UHT station's panel does.

This phase adds the station, gives every clean its step and use, and shows them moving. The cleans keep their timing: nothing waits for the station.

- **Entry:** phase 31 is merged (PR #35).
- **Exit:** the checklist below.
- **Critical path:** `process`, `sim`, `scene`.

## The model (`process`, `lead`, `sim`)

- **`plant.json` schema 15:** `yogurt.cip.tankSteps`, a tank's CIP. It fills `ferment.tankCleanS` (45 min) exactly, and `checkPlantConfig` refuses an unknown step or fluid, a lye or acid off the wing's temperatures, or steps that miss the 45 min.

| Step | Fluid | Time | °C |
|---|---|---|---|
| Pre-rinse | Water | 5 min | 45 |
| Lye | 1.8% NaOH | 20 min | 78 |
| Rinse | Water | 5 min | 45 |
| Acid | 0.8% HNO₃ | 10 min | 68 |
| Post-rinse | Water | 5 min | 20 |

- **Contracts v13** (fields only added):
  - `FermentTank.cleaning`: a cleaning tank's CIP step, null otherwise;
  - `buffer.changeover.cleaning`: the step of the CIP of the buffer and P8, null in a rinse or an SIP;
  - `YogurtSnapshot.cleaningUse`: what the wing's cleans have used since the opening (sodium hydroxide, nitric acid, rinse water to drain).
- **One model for every clean** (`src/sim/yogurt/heat.ts`): any programme through the wing's circuit (300 L at 12,000 L/h, D27) on D23's chemistry, giving each step's return and what it uses. Each step counts as it ends; a rinse's water at its end.
- **Hand calculations:** H139 (a tank's CIP: its returns and use) and H140 (the wing's CIP, a rinse, the day of H125e).

| Clean | NaOH | HNO₃ | Water to drain |
|---|---|---|---|
| The wing's CIP, 80 min | 3.7235 kg | 1.5679 kg | 3,000 L |
| A tank's CIP, 45 min | 3.7186 kg | 1.5679 kg | 2,000 L |
| A rinse, 15 min | — | — | 3,000 L |
| The day of H125e: 4 tank CIPs, a CIP, a rinse | 18.598 kg | 7.839 kg | 14,000 L |

## In 3D (`scene`)

### The station

At the back of the process hall, between the reprocess tank and tank 1 (`yogurt/layout.ts` `CIP_STATION`, `yogurt/cipStation.ts`):

| Part | What it does |
|---|---|
| Three tanks: water, lye, acid | A plate in the fluid's colour; a lamp on the dome lit while a circuit draws the fluid or sends its return back to it |
| A lane per circuit: heat treatment, fermentation tanks, buffer and P8 | Its supply pump turns while the circuit runs, spinning up and down over a second |
| Each lane's heater | A strip in the step's temperature, on the pipes' ramp |
| A bar beside it | The return's conductivity, 0–90 mS/cm, in the step's fluid |
| The change-over valve on each return | A stem toward the tanks and one toward the drain: the open one lifts, in the colour of what it carries |
| The drain | Splashes under a return that runs to it |
| The cabinet | Its screen lit while any circuit runs, a lamp per circuit amber while it does |

### The circuits

| Circuit | Cleans | Its lines | Product pipes in its colour |
|---|---|---|---|
| Heat treatment | The wing's CIP after a divert | Supply up to a rack along the back wall, west and down into the line at the deaerator's inlet; return up from after the heat exchanger's cooling, back along the rack | From the deaerator through the homogenizer, the heat exchanger, the holding cell, the divert and the forward line |
| Fermentation tanks | A tank's CIP after it empties | Supply up to the CIP header over the tanks; return from each tank's outlet valve along a main behind the tanks | None: the header and the cleaning tank's drop carry the fluid, and its sight glass streams with it |
| Buffer and P8 | The wing's CIP before set yogurt; the rinse before a stirred product | Supply east along the rack and down into the buffer's spray line; return from P8's CIP/SIP skid along the rack | The feed from the buffer into P8 |

- Each line is steel while its circuit stands, and takes the step's fluid's colour while it runs: pale blue water, violet lye, magenta acid, the UHT station's colours. Its stripes flow at the circulation, 1.2 m/s for 12,000 L/h, on animation time.
- Should two tanks clean at once, the tanks' circuit shows the one further into its clean; each drop shows its own.
- **The station's label** says what it does: "standing by", "tank 2 · NaOH 1.8% · 78 °C", or "heat treatment + P8".
- **Stage 12's stop** moves 1.7 m east and 1 m back and stands about 18% further off, so the station shows beside the heat treatment.

## In the panel (`ui`, `process`)

- **Stage 12:** a note, "The wing's CIP station", closed until asked for: what it does, its three circuits, the steps, the return, what it uses, and what the 3D view shows. Its readings: each circuit's step ("Tank 1: Lye (NaOH), 78 °C · 2 of 5 · 18 min left"), where the returns go, and what the cleans have used. A test holds every number in it to `plant.json` and H140.
- **Stage 13:** a cleaning tank's row names its step: "Cleaning in place · acid (HNO₃), 68 °C · 4 of 5".
- **Stage 14:** the changeover row names the CIP's step: "CIP of the buffer and P8 · lye (NaOH), 78 °C · 2 of 6 · 1 h 00 min left".
- **The pipe legend** shows the three cleaning fluids while the wing cleans too, as it does for the UHT plant's CIP; it marks the UHT circuit's fluid first, else the wing's.
- **About this model:** a paragraph on the wing's station.

## Contracts (`lead`)

- Contracts v13 and schema 15, as above. The fixtures are re-recorded at v13: they gain only the new fields.
- **Draw calls:** none new. The station's steel joins the reprocess tank's meshes (a click on it selects stage 12, the station's own), its 34 moving and coloured parts and the tanks' 6 spray streaks are instances in the wing's shared box mesh, and its lines join the `y-ferment` pipe run's mesh.
- **Debug state** (`?debug`):
  - `equipmentState('yogurt-cip')`: per tank `…TankPlate` and `…Lamp`; per circuit (`heat`, `tanks`, `p8`) `…Pump`, `…Heater`, `…Conductivity`, `…ToTank`, `…ToDrain`, `…Splash`, `…Lamp`; `screen`;
  - `equipmentState('ferment-tank-N')`: `cipDropColor`, `cipSpray1`/`cipSpray2`; `ferment-tank-2`: `cipHeaderColor`;
  - `pipeState()`: `yogurtCleaning` (each circuit's fluid or null) and `yogurtCleanPhaseM`.

## Who does what

The developer asked for this as one change; `lead` builds it lane by lane in one session, within the agents' ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | This card, D34, contracts v13, the config checks | `plan/`, `src/contracts/` |
| 1 | `process` | Schema 15's tank programme, H139–H140, plan 06's row, the note's text, About | `src/data/`, `plan/` |
| 2 | `sim` | One programme model for every clean; the steps and the use in the snapshot | `src/sim/yogurt/` |
| 3 | `scene` | The station, its circuits, its lines and the pipes in their colours, the header, drops and sight glasses, stage 12's stop | `src/scene/` |
| 3 | `ui` | The note's readings, the tank and changeover rows, the legend | `src/ui/` |
| 4 | `qa` | `tests/sim/yogurt/cip.test.ts`, `tests/scene/yogurtCip.test.ts`, the pipes', world's, notes' and rows' tests, `e2e/yogurtCip.spec.ts`, the fixtures | `tests/`, `e2e/` |

## Exit checklist

- [x] `npm run check` passes.
- [x] Every clean of the wing gives its step; a tank's CIP walks its five steps in its 45 min; the cleans' timing is unchanged.
- [x] What the cleans use matches H139–H140.
- [x] Each circuit's lines and pipes take its step's fluid, and the station's parts follow it and stand while paused.
- [x] The overview stays at 350 draw calls.
- [ ] The developer watches a tank's clean at ×1 in stages 12 and 13, and the heat treatment's after the "heat treatment under temperature" scenario.

## Status

Built on 20 November 2026 in one session.

- **Checked:** `npm run check` passes: typecheck, lint, 1,970 unit tests in 86 files (9 new in `tests/sim/yogurt/cip.test.ts`, 9 in `tests/scene/yogurtCip.test.ts`, and new cases in the pipes', world's, legend's, notes', rows' and config tests), and the asset tests. The overview draws 350 calls, its budget.
- **Browser tests:** the new `e2e/yogurtCip.spec.ts` passes on software GL. The yogurt, stage, camera, tour, cleaning, smoke, about and theme suites were being rerun on the final code when this was written; their result is in the pull request.
- **Not checked:** the frame rate on a real GPU; how the station reads to a person.
- **Left out:** the tanks' levels at the station do not move (the chemistry keeps their strength, D23); the rinse water's and steam's energy is not counted, as the wing's CIP's was not (D27); no hot-water sanitizing step, which the programmes do not have.
