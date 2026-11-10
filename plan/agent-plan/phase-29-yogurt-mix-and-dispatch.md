[Agent plan](README.md) · Phase 29 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 29 · The yogurt mix room and the dispatch, in motion

The developer's request after phase 28: "improve the animation machine of the yogurt processing line and the distribution". Phases 23–28 gave stages 12–15 their detail and motion. Two parts of the wing were left plain ([D31](../DECISIONS.md#d31-the-yogurt-mix-room-and-dispatch-in-motion)):

- **Stage 11, the mix room:** the silo, the powder station, the high-shear mixer and the stabilizer skid are bare shapes with three small moving parts between them.
- **Stage 16, the distribution:** pallets appear in the warm room, the chiller and the cold room with nothing carrying them, and a reefer is three boxes that slide the last 8 m to its door.

This phase makes both move like the real thing. Nothing in the sim, the contracts or `plant.json` changes: every motion is drawn from the snapshot the scene already reads (contracts v12).

- **Entry:** phase 28 is merged (PR #32).
- **Exit:** the checklist below.
- **Critical path:** `scene`.

## What moves, and how

"Motion seconds" are real seconds times `motionRate(speed)` (`src/scene/motion.ts`), as in phase 12.

### Stage 11 · The mix room

| Machine | New fittings | What moves | When |
|---|---|---|---|
| Yogurt silo | A milk pump and its motor at the outlet, an outlet valve, a side agitator's drive, a manway, the CIP riser to the dome, a temperature display | The pump's rotor turns and the valve's stem lifts (green); the agitator's fan turns; the display reads the milk's 4 °C in the pipes' blue | The pump and valve while mix is made; the agitator while the silo holds milk |
| Powder station | A dust filter on the frame, a hopper sight strip, a bag hoist, an operator panel | The filter's fan turns; the sight strip shows the powder left in the bag, falling as it is dosed and full again with each new 1,000 kg bag; the panel's screen lights | While powder is dosed |
| High-shear mixer | The drive motor with its fan, a recirculation valve | The motor's fan turns; specks of powder circle down the funnel into the rotor | While mix is made |
| Stabilizer skid | An agitator drive on each drum, a level strip on each, a pump head | Each drum's agitator turns; the level strips show the solution left | The agitators while the skid doses |
| Mix tank | An inlet and an outlet valve | The inlet valve's stem lifts while mix is made, the outlet's while the heat treatment draws | Likewise |

### Stage 16 · Pallet transfers

Two electric stacker trucks, each with its rider, carry the pallets between the line and the rooms. Their trips follow the sim's own moves: a pallet that changes place in the snapshot sets a trip off.

| Truck | Trip | Route |
|---|---|---|
| `stacker-1`, south of the line | Staging → chiller (stirred) | From the end of the wrapper's rollers to the tunnel's west door |
| | Staging → warm room (set) | West along the line's south side to the warm room's door |
| | Warm room → chiller | From the warm room's door east to the tunnel's west door |
| `stacker-2`, east and north of the line | Chiller → cold room | From the tunnel's east door round the end of the rollers to the cold room's south doorway |

- **Moving like a stacker:** 1.6 m/s empty and 1.2 m/s with a pallet; 0.5 m/s into a door or to a pick; it turns on the spot at 60° a second (its drive wheel is under its middle); forks 0.15 m/s. It lifts a pallet 0.1 m clear to carry it, and to the roller track's height at the tunnel.
- **A sample, as phase 12's:** one trip at a time for each truck. A move that comes while its truck is busy is queued, up to 3; beyond that the pallet changes place unseen, as all did before. At ×1 and ×10 every move is carried.
- **Doors:** a rapid door on the warm room, on each end of the chiller's tunnel and on the cold room's doorway. Each rolls up as a stacker comes within 3 m with a trip through it, and down behind it.
- **Parked:** each truck stands at its spot, forks down, its beacon dark; the beacon flashes while it works.

### Stage 16 · Reefers at the dock

A reefer is now an articulated truck built of about 50 boxes: the trailer's deck, walls and roof, open at the back; its two rear doors; the refrigeration unit on its front wall with a fan and a status lamp; the tractor with its cab, windscreen, lights and mirrors; ten wheels. It moves through phase 12's dock moves (`packs/truckMoves.ts`), mirrored to the north yard:

| Step | What you see | Time (motion s) |
|---|---|---|
| 1. Arrive | The reefer drives in along the road behind the wing, past its door, and stops | about 13–15 |
| 2. Doors | The rear doors swing open, flat against the trailer's sides | 3 |
| 3. Back in | It reverses along a curve to its door, tractor and trailer articulated (at most 0.6 rad) | 10 |
| 4. Dock | The dock's roller door rises and its lamp turns red | 3 |
| 5. Load | Pallets fill the trailer from the front, two abreast, by the sim's own count (`reefers[].pallets`) | sim |
| 6. Leave | The roller door comes down, the lamp turns green, the doors close, and the reefer pulls out and drives off east | 3 + about 8 |

- **Fits the sim's time:** the sim gives a reefer 30 min to back up and 20 min to load. The arrival is timed to end as the sim docks the reefer; when the sim runs faster than the moves can play, they play up to 10× faster or are skipped (phase 12's rule).
- **The unit runs:** its fan turns and its lamp shows blue while the reefer is on the yard.

## Contracts (`lead`)

No contract changes. The lanes share:

- **Draw calls:** none new. Every new part is an instance in the cold chain's box mesh (`SharedBoxes`), as phases 23–28's. The overview stays at 350.
- **Debug state** (`?debug`, `window.__scene.equipmentState(id)`):

| Id | Keys |
|---|---|
| `yogurt-silo`, `powder-station`, `high-shear-mixer`, `stabilizer-skid`, `yogurt-mix-tank` | Each new part's `…Turns` or `…Lift`, `…Moving` and `…Color`, as the wing's other parts report them |
| `yogurt-pallets` | Kept: `warm`, `chiller`, `cold`, `held`, `staging`, `reefers`, the glows and `alarm`. New: `reeferPhases` (each door's phase, comma-separated), `reeferDoorsOpen`, `reeferLoaded` (each door's pallets on board, `-` for none), `dockDoorsUp`, `dockLamps` (`red` or `green` per door), `stacker1Job` and `stacker2Job` (`parked`, `toPick`, `pick`, `toDrop`, `drop`, `home`), `stacker1Carrying`, `stacker2Carrying`, `stackerTrips` (trips finished), `doorsOpen` (rapid doors open now) |

## Who does what

The developer asked for this as one change; `lead` builds it lane by lane in one session, within the agents' ownership rules.

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | This card, D31 | `plan/` |
| 2 | `scene` | `yogurt/mixDetail.ts`: stage 11's coloured and moving parts; the grey fittings in `yogurtLine.ts`, joined to meshes the machines already have | `src/scene/equipment/yogurt/`, `yogurtLine.ts` |
| 3 | `scene` | `yogurt/reeferTruck.ts`: the reefer's boxes and the mirrored dock moves; the dock's roller doors and lamps; the three-box reefers go | likewise |
| 4 | `scene` | `yogurt/stackers.ts`: the two stackers' routes, trips and doors, headless; drawn in `yogurt/dispatchBoxes.ts` | likewise |
| 5 | `qa` | `tests/scene/mixDetail.test.ts`, `reeferTruck.test.ts`, `stackers.test.ts` on the live sim; `e2e/yogurtMotion.spec.ts` and `yogurtColdChain.spec.ts`; the overview's draw calls | `tests/`, `e2e/` |

## Exit checklist

- [ ] `npm run check` and `npm run build` pass.
- [ ] Stage 11's machines have their fittings, and their parts move with the mix flow and stand while paused.
- [ ] A reefer drives in, opens its doors, backs in articulated, docks under a rising roller door, fills by the sim's count, closes and leaves; at ×1,000 the moves fit the sim's time.
- [ ] The stackers carry every pallet move at ×1 and ×10, each carries a pallet only between pick and drop, and the rapid doors open only for them.
- [ ] The overview stays at 350 draw calls; the new count is in `tests/perf/baseline.md`.
- [ ] The yogurt browser tests pass with the new debug keys.
- [ ] The developer watches stages 11 and 16 at ×1 and ×10.

## Status

Planned on 10 November 2026.
