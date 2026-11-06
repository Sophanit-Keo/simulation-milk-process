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

- [x] The overview shows both rows; the wing's zones are labelled; no machine overlaps another or a pipe.
- [x] Each stage 11–16 has a camera stop, a badge and a ring, and the panel shows its values from the mock.
- [x] The grouped rail keeps the one-screen layout at 1280 × 720 and 1440 × 900 in both themes.
- [x] The perf baseline with the grey wing is in `tests/perf/baseline.md`; the draw calls stay within budget.
- [ ] The developer signs Y1.

## Status

Built on 6 November 2026 in one session, on phase 15 as merged (PR #20). D25 was still Proposed: the entry asks for it approved, and the developer asked to go on. Lane by lane:

- **`lead` and `scene`, the layout** (`src/scene/layout.ts`; the rectangles are in [plan 12's floor plan](../12-yogurt-line.md#floor-plan)):
  - the four zones north of the milk row, behind a 9 m aisle, and a reefer yard north of the cold store;
  - the zones' near edges alternate between z −32 and −38.5, so the four names stand on two lines: at that distance a character covers about 1.4 m of floor, and together they are longer than the wing is wide;
  - the wing starts 2 m east of the milk row, so its first name shows past the 11 m silos;
  - the overview's target moved from z 3 to z −4, and the floor and the shadow follow the plant's new bounds;
  - camera stops 11–16;
  - the zone tests check every name at both review sizes: in view, apart, clear of every lamp, nothing in front of it.

  No tanker lane is drawn on the milk row, so none was extended.
- **`scene`, the machines and pipes:**
  - `src/scene/equipment/yogurtLine.ts` stands the phase's 30 grey boxes at the positions of `equipment/yogurt/layout.ts`, with the milk line's builder, kit and level gauges (exported from `liquidLine.ts`, not copied);
  - the gauges of the yogurt silo, the mix and reprocess tanks, the three fermentation tanks and the buffer follow `snapshot.yogurt`, and each label shows a key value (the tanks their pH);
  - `src/scene/yogurtPipes.ts` holds the wing's routes as three runs, coloured and flowing by the yogurt line points; the holding cell's serpentine selects stage 12;
  - the divert line to the reprocess tank has no line point for its flow in contracts v8, so it stands still (a new `'still'` flow in `pipes.ts`);
  - picking and fly-to need nothing new: every machine is tagged with its stage.

  A first build drew about 130 more calls at the overview. Merging each machine's parts per material, casting shadows only from the vessels and rooms, and three shadowless pipe runs brought it to 331.
- **`ui`:**
  - **The rail** groups the stages under "UHT milk" and "Yogurt P8". Each header folds its group and carries its worst stage's lamp. The `?yogurt` flag of phase 15 is gone.
    - At 1440 × 900 both groups show. At 1280 × 720 the rail has room for one line's stages only (it needed 667 px for both and has 407), so the groups work as an accordion and the rail never scrolls: the selected stage's group stays open (the milk's before any selection) and opening the other folds it. A pick in the 3D view opens its group.
    - Grouped, the rows are 4 px shorter.
  - **The KPI strip:** the milk's eight cards already fill one row to the pixel from 1101 px up. A yogurt group beside them would cut their longest values short, and a second row would shrink the 3D view the overview was just fitted to. So the strip shows the line in view: the yogurt group's four cards (mix, P8 cups, cold room, reefers, from `snapshot.yogurt.kpis`) replace the milk's while a yogurt stage is selected, and the milk's come back with a UHT stage or "Whole plant". The two groups share one grid cell, so the strip's height never changes.
  - The zone tints `--zone-yog`, `--zone-clean` and `--zone-cold` in both themes.
- **`assets`:** the specs for phase 20 in [`assets/hero-specs.md`](../../assets/hero-specs.md#phase-16-the-yogurt-lines-heroes-specs-for-phase-20): the P8 filler (`carrier`, `pistons`, `seal_heads`, `foil_pick`, `hood`), the fermentation tank (`agitator`), the 125 g cup, the 24-cup tray and the reefer unit (`fan`). Specs only.
- **`qa`:**
  - **`tests/scene/yogurtLine.test.ts`:** every machine of the table, in its stage's zone, none overlapping another; every pipe clear of every machine but at its ports (a ray along each pipe against the machines' triangles); the gauges and labels from the mock.
  - **`e2e/yogurtWing.spec.ts`:**
    - each stage 11–16 from the rail and by a 3D click, the camera at its stop;
    - the panels from the mock, and standing on the live sim;
    - the KPI group switching;
    - the accordion at 1280 × 720, and both groups at 1440 × 900.
  - The rail, layout, KPI and camera tests follow the grouped rail.
  - The perf baseline was measured at both sizes: the overview reads **331** draw calls (budget about 350) and **290,350** triangles; the wing's stops 124–136.
- **Checks:**
  - `npm run check` passes (1,611 unit tests, 88 asset tests), and so does `npm run build`.
  - **The full browser run, before the rail's accordion:** 83 of 86 passed. Of the three failures:
    - one was the rail's own layout test, which the accordion answers;
    - one was the scene hook's "unknown stage" example, which was 11 and is now 17;
    - one was the pixel-ratio test, which fails in this sandbox's browser on the commit before phase 15 too (phase 15 status).
  - **After the accordion:** every browser test the change touches passed, 18 of 18: `yogurtWing.spec.ts`, `camera.spec.ts`, the rail's tests in `stages.spec.ts`, the one-screen layout in `liquid.spec.ts`, `kpis.spec.ts` and the scene hook.
