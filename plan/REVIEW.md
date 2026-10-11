[Index](README.md) · Review

# Plan review

**Reviewed:** *3D Milk Industry Simulation — Research & Plan* (Word export of the Oct 10, 2026 doc, revision 23) and the prototype `uht-plant-preview.html`.

**Scope:** I recomputed every worked number in the plan, checked the sections against each other, and compared the plan with the preview's code. I did not re-check the figures in the cited sources or test the links.

**Verdict:** the plan holds up. Every formula and worked number is right, the research is cited, and building a grey-box version first with a scope freeze at week 9 is a sensible way for one person to finish in 12 weeks. Three things should be settled before `plant.json` is written in week 1: what a batch is ([R1](#r1-batch-size)), the defaults the plan doesn't set yet ([R2](#r2-missing-defaults)), and the truck load ([R3](#r3-truck-payload)). The rest are consistency fixes and implementation tips.

## Checked and correct

| Claim in the plan | Recomputed | Result |
|---|---|---|
| Cream share ≈ 0.086 | (3.5 − 0.05) ÷ (40 − 0.05) = 3.45 ÷ 39.95 = 0.0864 | ✓ |
| F0 ≈ 5.2 min at 140 °C for 4 s | (4 ÷ 60) × 10^1.89 = 0.0667 × 77.6 = 5.17 min | ✓ |
| B\* ≈ 1.19 at 140 °C for 4 s | (4 ÷ 10.1) × 10^0.476 = 0.396 × 2.99 = 1.19 | ✓ |
| Divert below about 139.2 °C | B\* = 1 when T = 135 + 10.5 × log10(10.1 ÷ 4) = 139.22 °C | ✓ |
| One batch = 60,000 packs | 7,500 packs/h × 8 h | ✓ |
| Pallet ≈ 1,000 L | 12 packs × 84 trays = 1,008 packs of 1 L | ✓ |
| ×10,000 passes 7 days in about a minute | 604,800 s ÷ 10,000 = 60 s | ✓ |
| Homogenizer draws 68 kW for 10,000 L/h at 200 bar | Hydraulic power = 2.78 L/s × 200 bar = 55.6 kW, so 68 kW means about 82% efficiency | ✓ plausible |
| UHT plant sized slightly above the fillers | 16,000 L/h in, 2 × 7,500 = 15,000 L/h out: the tank gains 1,000 L/h. From 50% (10,000 L) it covers a 30-min intermediate clean, which draws 7,500 L | ✓ |
| Temperatures along the line | 80 °C preheat → 76 °C after the deaerator → 140 °C → back to about 80 °C after the flash vessel → 20 °C, as in the chart and the preview | ✓ (see [R7](#r7-homogenizer-outlet)) |

## Decide before week 1

These change `plant.json`, which the roadmap fills in week 1.

### R1. Batch size

**The plan and the preview define a batch differently.**

- **Plan** ([Default settings](06-simulation-model.md#default-settings)): "one filler shift of 8 h (60,000 packs)". That is about 60 pallets and 16 samples (one every 30 min), plus 2 per stop.
- **Preview:** one batch per 8-hour shift for *both fillers together*, about 100–119 pallets and 32 samples.
- **Why it matters:** batch size sets the pallets per block in quarantine, the samples per batch, and how much product one failed sample blocks.
- **Fix:** keep the plan's per-filler batch, write it into `plant.json`, and change the preview if you reuse its code. It matches the per-filler sampling rule, and a fault on one filler then blocks only that filler's shift. Either definition works as long as the plan and the code agree.

### R2. Missing defaults

**The model needs values the plan never sets, so the preview had to invent them.**

Add these rows to [Default settings](06-simulation-model.md#default-settings) and to `plant.json`. The preview's values are a reasonable starting point:

| Setting | Needed by | Preview uses |
|---|---|---|
| Raw-milk fat | Stage 1 mass balance, surplus cream | 4.0% |
| Filler time between failures (MTBF) | Stage 7 random stops, filler breakdown scenario | Random, mean 8 h |
| Filler repair time (MTTR) | Same | 2 min + random, mean 12 min |
| Intermediate clean (AIC) interval | Stage 6 buffer behaviour | Every 10 h of production |
| Full CIP trigger | Cleaning state | Only after a divert. The plan gives the 80 min duration but no schedule |
| Divert duration before cleaning | UHT temperature drop scenario | 3 min |
| Tank high and low thresholds | Stage 6 throttle and filler pause | Throttle above 90%, back to full flow below 60%; fillers stop below 150 L |
| Fault temperature | UHT temperature drop scenario | Falls to 137.6 °C |
| Demand: orders and trucks | Stage 10, days of cover, order fill rate | No orders; a truck every 2.5 h (about 317 pallets a day) that waits if stock is short |
| Reject tank size | UHT divert | 6,000 L |
| Random seed | Repeatable demos and tests | Fixed seed (mulberry32) |

The 90%/60% pair matters: with a single threshold, the UHT plant would flip between 50% and 100% every few steps.

### R3. Truck payload

**33 pallets fit the trailer floor, but not its weight limit.**

- A pallet of 1,008 × 1 L packs weighs about 1.1 t (about 1,040 kg of milk, plus cartons, trays and the pallet), so 33 pallets weigh about 36 t.
- A 40 t articulated truck (the usual EU limit) carries roughly 24–25 t of payload. Liquids reach the weight limit long before the floor is full.
- **Fix:** use about 22 pallets per truck. Shipping the preview's 317 pallets a day then takes a truck about every 1.7 h. Or keep 33 and add it to [Accepted simplifications](10-risks-and-simplifications.md#accepted-simplifications).

## Model consistency

### R4. Divert rule

**One wording slip and a thin margin.**

- [Stage 4](03-stages-1-5-liquid-line.md#4-uht-treatment) opens with "any drop below the set point diverts the flow to reject". The model diverts when B\* < 1, which is about 139.2 °C, 0.8 °C *under* the 140 °C set point. Reword it to "any drop below the divert limit (B\* < 1)".
- With only 0.8 °C of margin, any temperature noise added to make the display look alive will trigger random diverts. Keep noise under about ±0.3 °C, or raise the set point to 140.5 °C. That gives B\* ≈ 1.32 and F0 ≈ 5.8 min, still inside the 5–6 min target, with a margin of about 1.3 °C.

### R5. Plant-type mix

**The model borrows from indirect plants in two places, not one.**

- The plan already flags the homogenizer. The course order puts it before UHT, as indirect plants do, while direct plants with flash cooling homogenize aseptically after the flash vessel ([Stage 3](03-stages-1-5-liquid-line.md#3-homogenization), [Stage 5](03-stages-1-5-liquid-line.md#5-flash-cooling)).
- The 50% throttle at high tank level rests on a source line about indirect plants ("indirect plants can also run at 50–100% of capacity", [Stage 6](04-stages-6-10-tank-to-truck.md#6-aseptic-storage-buffer)). The modelled plant is direct, with steam injection and a flash vessel.
- **Fix:** list both in the "About this model" panel planned under [Risks](10-risks-and-simplifications.md), or find a source for running a direct plant at reduced capacity. While there, change "your stage order" in Stage 3 to "the course's stage order", since other people will read the doc.

### R6. Holding time

**The holding time, and with it the divert limit, should follow the flow.**

- The plan's formula is t_hold = V_tube ÷ Q. At the default 4 s and 16,000 L/h, the tube holds about 17.8 L.
- When the UHT plant throttles to 50%, the hold doubles to 8 s. Then B\* ≈ 2.4, F0 ≈ 10.3 min, and the divert limit drops to about 136.1 °C.
- The preview keeps the hold fixed at 4 s. Compute t_hold, F0, B\* and the divert limit from the live flow. Showing this in the stage 4 panel is also a good way to teach how flow affects sterilization.

### R7. Homogenizer outlet

**The chart and the wireframe show 76 °C at the homogenizer outlet, but Stage 3 says to simulate a temperature rise.**

- Stage 3 says every 40 bar of pressure drop adds 1 °C, so 200 + 30 bar adds about 5–6 °C: 76 °C in, about 81–82 °C out.
- That rise also explains why the flash vessel returns the milk to "about 80 °C" rather than 76 °C.
- **Fix:** show 76 °C in and about 82 °C out, and update the [chart values](02-uht-line-at-a-glance.md#chart-values-as-text) and the wireframe's "Outlet" value to match. Or drop "temperature rise" from Stage 3's Simulate list.

## Implementation notes

### R8. Units in TypeScript

**TypeScript alone won't catch L/h versus L/s.**

The [tech stack](07-tech-stack-and-architecture.md) table says types catch unit mix-ups, but both units are plain `number`, so TypeScript accepts one where the other is meant. Either use branded types:

```ts
type LitresPerHour = number & { readonly __unit: 'L/h' };
type LitresPerSecond = number & { readonly __unit: 'L/s' };
const lph = (v: number) => v as LitresPerHour;
```

or keep plain numbers with the unit in every name (`flowLph`, `holdS`, `levelL`) and rely on the Vitest checks. Either way, convert units in one place only.

### R9. Quarantine scale

**A week on hold is over 2,000 pallets, so one lamp per pallet won't be readable.**

- Both fillers make up to 357 pallets a day (2 × 7,500 packs/h × 24 h ÷ 1,008). A 7-day hold therefore keeps up to about 2,500 pallets in quarantine (the preview shows 2,178), and the 15-day option up to about 5,350.
- `InstancedMesh` draws that many easily; the problem is reading them. Show one block with one lamp per batch, tint pallet instances by status with `InstancedMesh.setColorAt`, and let a click on a block list its pallets and SSCCs. The preview already groups pallets by batch.

### R10. Rare QA failures

**Random incubation failures will almost never show in a demo.**

With a failure rate of 0.02% per pack and 16 samples per batch, a batch fails 1 − 0.9998^16 ≈ 0.32% of the time. With per-filler batches (6 a day, see [R1](#r1-batch-size)), that is one blocked batch about every 50 simulated days; the preview's larger batches give the same daily rate.

Demos will rely on the manual trigger and on the higher chance after a sterile-air filter failure, which the [fault table](06-simulation-model.md#fault-scenarios) already plans. Real non-sterile packs tend to come in clusters, not one at a time, so that link is also the more realistic model.

### R11. Versions and hosting

- The plan names three.js r186, but the preview loads r170 from a CDN. Install with npm in week 1, keep the exact version in `package.json`, and test any code copied from the preview against it.
- GitHub Pages serves a project site from `/<repo-name>/`, so set `base: '/<repo-name>/'` in `vite.config.ts` or the built files won't load. Vercel needs no change.

## Plan vs. preview

| Item | Plan | Preview (`uht-plant-preview.html`) |
|---|---|---|
| Batch | One filler × 8 h = 60,000 packs | Both fillers × 8 h, about 100–119 pallets and 32 samples |
| Holding time | V_tube ÷ Q, changes with flow | Fixed 4 s, even at 50% flow |
| Sim step | 1 s; 10–60 s above ×1,000 | 0.5, 2, 10 or 30 s depending on speed |
| Guided tour | About 3 min, two-line caption per stage | 5 s per stage, about 50 s |
| Fault scenarios | 6 | 3, as the plan says |
| OEE | Availability × Performance × Quality | Availability × Performance only |
| three.js | r186 via npm | r170 via CDN |
| Defaults the plan lacks | — | See [R2](#r2-missing-defaults) |

---

← [11. Sources](11-sources.md) · [Index](README.md)
