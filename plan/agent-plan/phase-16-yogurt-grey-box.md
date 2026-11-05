[Agent plan](README.md) · Phase 16 · [Roadmap](../09-development-roadmap.md#the-yogurt-line-phases-1521)

# Phase 16 · Grey-box yogurt wing

Lay out the yogurt wing in grey boxes, as phase 2 did for the milk ([plan 12, floor plan](../12-yogurt-line.md#floor-plan)):
- four zones north of the milk row, with every machine as a box or cylinder;
- the pipes between them;
- camera stops for stages 11–16;
- the stage rail grouped by line.

It is driven by phase 15's mock snapshot.

- **Entry:** phase 15 is merged; D25 is approved.
- **Exit:** gate **Y1**, the checklist below.
- **Weeks:** 2–3. **Critical path:** `scene`, `ui`.

## The wing

| Zone | Stages | Grey boxes |
|---|---|---|
| Yogurt mix room | 11 | Yogurt silo (30,000 L), powder station, high-shear mixer, stabilizer skid, mix tank |
| Yogurt process hall | 12–14 | PHE (three sections), deaerator, homogenizer, holding cell, divert valve and reprocess tank, culture pump, three fermentation tanks, smoothing valve, plate cooler, fruit tank and pump, P8 buffer |
| Cup filling room (Line P8) | 15 | P8 filler block under a clear HEPA hood, check gates, reject bin |
| Incubation & cold store | 16 | Tray packer, palletizer, wrapper, warm room, blast chiller, cold room with racks, reefer dock |

The row runs at z −52 to −28 m (a first proposal, settled here). The tanker lane from the silo yard is extended to the yogurt silo. The cold store's dock faces north, where the reefer trucks have a yard of their own.

## Who does what

| Lane | Agent | Tasks | Owns |
|---|---|---|---|
| 1 | `lead` | The layout review against D25; the floor's and the overview camera's new extents | `plan/`, `src/main.ts` |
| 1 | `scene` | `ZONES` and `STAGE_VIEWS` for 11–16 in `src/scene/layout.ts`; `src/scene/equipment/yogurt/` (builder, kit) in grey boxes; the pipes between them in `pipes.ts`, coloured by the yogurt line points; picking and fly-to; the reefer yard | `src/scene/` |
| 1 | `ui` | The stage rail grouped under "UHT milk" and "Yogurt P8" (each group folds); panels 11–16 from `stages.json`; a yogurt group in the KPI strip; the zone tints for the new zones in both themes | `src/ui/`, `src/styles/` |
| 2 | `assets` | Specs for the hero models of phase 20: the P8 filler (named nodes `carrier`, `pistons`, `seal_heads`, `foil_pick`, `hood`), the fermentation tank (`agitator`), the 125 g cup with foil lid, the 24-cup tray, and the reefer unit on the truck. Specs only | `assets/` |
| 3 | `qa` | `e2e/yogurtWing.spec.ts`: every stage 11–16 selectable from the rail and the 3D view, with the camera at its stop; the perf baseline re-measured with the wing (grey) | `e2e/`, `tests/perf/` |

## Exit checklist (gate Y1)

- [ ] The overview shows both rows; the wing's zones are labelled; no machine overlaps another or a pipe.
- [ ] Each stage 11–16 has a camera stop, a badge and a ring, and the panel shows its values from the mock.
- [ ] The grouped rail keeps the one-screen layout at 1280 × 720 and 1440 × 900 in both themes.
- [ ] The perf baseline with the grey wing is in `tests/perf/baseline.md`; the draw calls stay within budget.
- [ ] The developer signs Y1.

## Status

Not started.
