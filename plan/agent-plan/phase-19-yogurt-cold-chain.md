[Agent plan](README.md) · Phase 19 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 19 · Cold chain & dispatch (stage 16)

Carry the cups to the reefer truck ([plan 12, stage 16](../12-yogurt-line.md#16-trays-pallets--the-cold-chain)):
- they are packed into trays, palletized and wrapped;
- set yogurt goes through the warm room;
- both routes go through the blast chiller;
- they hold in the cold room for 24–48 h, are released and leave by reefer truck.

At the end of this phase both routes run from silo to truck, and the scope freezes.

- **Entry:** phase 18 is merged.
- **Exit:** gate **Y2**, the checklist below.
- **Weeks:** 8–9. **Critical path:** `sim`, `scene`.

## The model

- **Trays and pallets:** 24 cups a tray and 120 trays a pallet (2,880 cups, about 366 kg of yogurt). A pallet carries one batch only, as D1 rules for the milk.
- **Warm room (set yogurt):**
  - pallets enter at 43 °C;
  - each pallet's pH follows the phase 17 curve from the time its cups were filled;
  - a pallet moves on at pH ≤ 4.60.
- **Blast chiller:**
  - one pallet's core falls from the fill temperature (18 °C stirred, 43 °C set) to ≤ 4 °C;
  - it cools first-order, with the time constant settled in H131;
  - the tunnel holds a set number of pallets.
- **Cold room:**
  - It is one well-mixed temperature at 3 °C, inside the 2–4 °C band.
  - Each pallet keeps its own hold clock. It is released at 24 h if its batch has passed its seal tests, and it must leave before 48 h.
  - The cold room has a set number of positions (H132).
- **Dispatch:**
  - Reefer trucks of 26 pallets load the released pallets oldest first, using the phase 12 and 14 forklift and truck moves.
  - The number of trucks a day follows H133.
- **Conservation:** cups filled = cups rejected + cups on hold + cups in trays, the warm room, the chiller and the cold room + cups shipped.

## Contracts (`lead`)

Contracts v8 (phase 15) already give `YogurtSnapshot.coldChain` its `warmRoom: { tempC, pallets }`, `chiller: { pallets }`, `coldRoom: { tempC, positionsUsed }` and the shipped totals, `palletsShipped` and `reefersShipped`. It gains (only added):
- `trays`;
- `pallets[]`, each with its batch, place, `tempC`, `ph` and `holdUntilS`;
- `chiller.capacity` and `coldRoom.capacity` (H131, H132);
- `reefers[]`.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `process` | H130 (cups, trays and pallets a day: about 432,000 cups, 18,000 trays, 150 pallets at 20 h of filling), H131 (the chill time), H132 (the cold-room positions for a 48 h worst case, about 300 plus a margin), H133 (about 6 reefers a day) | `plan/`, `src/data/` |
| 1 | `sim` | `src/sim/yogurt/coldChain.ts`: trays, pallets, warm room, chiller, cold room, release, reefer loads; built on the patterns of `src/sim/packs/packaging.ts`, `quality.ts` and `warehouse.ts` | `src/sim/yogurt/` |
| 2 | `scene` | The tray packer; the wing's palletizer robot, wrapper and forklifts (instances of phases 12 and 14); pallets in the warm room's glow and the chiller's frost; the cold-room racks; reefers backing up to the north dock | `src/scene/equipment/yogurt/` |
| 2 | `ui` | The stage 16 panel: trays and pallets; the warm room's pH queue; the chiller; the cold room's temperature, positions and next release; reefers; a yogurt batch list beside the milk's | `src/ui/` |
| 3 | `qa` | `tests/sim/yogurt/coldChain.test.ts` against H130–H133; cup conservation over a 7-day run at ×10,000; `e2e/yogurtColdChain.spec.ts`; the silo-to-truck run for both routes | `tests/`, `e2e/` |

## Exit checklist (gate Y2)

- [x] Tests against H130–H133 pass; a 7-day run conserves every cup and ships within the 48 h maximum.
- [x] Set-yogurt pallets wait in the warm room until pH ≤ 4.60; stirred go straight to the chiller.
- [x] The run from silo to reefer truck works for both routes, at ×1 to ×10,000.
- [x] The UHT line's tests still keep their numbers, and the perf check stays within budget.
- [ ] **Scope freeze:** the developer signs Y2, and any Could item not built is cut ([roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)).

## Status

Built on 6 November 2026 in one session, on phase 18 as merged (PR #23). Y1 is not yet signed, and D25–D28 are still Proposed; the phase adds **D29** (the cold chain), also **Proposed**. The developer asked to go on. Lane by lane:

- **`process`:**
  - `plant.json` schema 13 adds the warm room's 36 and the chiller's 32 positions, the chiller's −2 °C air and 1.2 h time constant, the cold room's 360 positions, and the reefer dock: 3 doors, a call for a load of 26 or at 42 h, 30 min to back up, 20 to load.
  - The chiller's air is the one number in `plant.json` that may be below zero, so `checkPlantConfig` names it as the exception.
  - [D29](../DECISIONS.md#d29-the-yogurt-cold-chain-live-stage-16) sets the rules; [H130–H133](../hand-calculations.md#phase-19-the-yogurt-cold-chain) work them by hand.
  - **The chiller, resized:** a first run of the model showed 20 chiller positions short. Each morning the night's set pallets leave the warm room as the first stirred ones come, and the chiller peaks at about 30, so it has 32.
- **`lead`:** contracts v11 adds `ColdChainSnapshot`'s `trays`, `pallets[]` (batch, place, core temperature, pH, hold), the rooms' `capacity`, `chiller.airC`, `coldRoom.nextReleaseS`, `reefers[]`, `cupsShipped` and `cupsHeld`. The fixtures were re-recorded; their UHT part's fingerprint is unchanged (D25).
- **`sim`:**
  - `src/sim/yogurt/coldChain.ts` packs P8's cups into one-batch trays and pallets.
    - Set yogurt sets in the warm room to pH 4.60.
    - Every pallet chills first-order to 4 °C and holds 24 h in the cold room.
    - A pallet is released once its seal tests have passed, and reefers of 26 take the oldest first.
    - A failed seal test pulls exactly the cups P8 holds.
  - P8 now hands on what it makes and tests, in order.
  - The chain opens as the last two days left it, so reefers are on the dock in the first hours.
  - **Kept fast:** the first build cost every step a rescan of some 200 pallets, and timed out the long sim tests. Each room is now a queue whose due times come from the formulas, and a sim time's view is built once. A day's run is as fast as before.
  - The mock fills the v11 fields.
  - **The runs:**
    - **The day of H125e** packs **19,872** trays on 60 + 59 + 48 pallets (H130).
    - **Seven days from the opening** ship 45 reefers (H133), both routes, with nothing waiting for a room:
      - the cold room peaks at about 200 of its 360 positions, the chiller at about 30 of 32, the warm room at 30 of 36;
      - every cup is accounted for, and every pallet leaves well inside 48 h.
- **`ui`:**
  - **Stage 16's state rows** (`src/ui/coldChainRows.ts`): the trays and the pallet building, the warm room's pH queue, the chiller and its warmest core, the cold room, the next release, and the reefers.
  - **A yogurt batch list beside the milk's** (`src/ui/yogurtBatchList.ts`): each batch in the chain, where its pallets stand and when the first is out.
- **`scene`** (`src/scene/equipment/yogurt/coldChainScene.ts`):
  - **Two draw calls:** every pallet and reefer is boxes in one InstancedMesh, coloured per box, and the rooms' lamps a second.
  - **The rooms:** the warm room shows each of its pallets two high under its orange lamp. The chiller (frosted) and the cold room's racks show how full they are. The pallet at the palletizer grows with its trays.
  - **The reefers** back the last metres to their north-dock door.
  - **Motion:** the tray packer's pick head and the palletizer's arm work while P8 fills, and the wrapper turns each pallet that closes.
- **`qa`:**
  - **`tests/sim/yogurt/coldChain.test.ts`:** H130–H133, the routes, a full room's queue, the hold and release, the pull, the reefers and their 42 h part load, a live seal-test failure, and the seven-day run.
  - **`e2e/yogurtColdChain.spec.ts`:** the panel, the batches and the 3D rooms as the line opens; then nearly three days at ×10,000. Reefers back up and load, the opening shift's stirred batch and the night's set batch both leave by reefer, and no pallet holds past 48 h.
  - **The perf baseline** (`tests/perf/baseline.md`): the overview reads **349** draw calls and 324,210 triangles, inside the budget of about 350.
- **Checks:**
  - `npm run check` passes (1,789 unit tests, 88 asset tests), and so does `npm run build`.
  - **The full browser run:** 94 of 95 passed in 43.5 min. The one failure is the pixel-ratio test, which fails in this sandbox's browser on the commit before phase 15 too (phase 15 status).
  - **The seven days' figures:** 45 reefers carry 341 set and 829 stirred pallets. The longest hold is 34.7 h. The peaks are 30 pallets in the warm room, 31 in the chiller and 203 in the cold room.

**For the scope freeze (Y2), not built and for the developer to cut or keep:**
- The roadmap's last Could item, **the factory board's yogurt lines**. The other three, fruit dosing, the set route's warm room and the vision station, are built.
- From this phase's scene lane, the wing's **forklifts** and the **articulated reefer moves** of phases 12 and 14. Their code is built round the milk warehouse's dock; the wing's reefers back straight in and the cold room loads them without a forklift drawn.

Then sign Y1 and Y2, and approve or amend D25–D29.
