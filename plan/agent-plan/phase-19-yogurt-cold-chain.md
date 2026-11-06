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

- [ ] Tests against H130–H133 pass; a 7-day run conserves every cup and ships within the 48 h maximum.
- [ ] Set-yogurt pallets wait in the warm room until pH ≤ 4.60; stirred go straight to the chiller.
- [ ] The run from silo to reefer truck works for both routes, at ×1 to ×10,000.
- [ ] The UHT line's tests still keep their numbers, and the perf check stays within budget.
- [ ] **Scope freeze:** the developer signs Y2, and any Could item not built is cut ([roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)).

## Status

Not started.
