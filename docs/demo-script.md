[README](../README.md) · Demo script · [Video script](video-script.md) · [Report](report.md) · [Slides](slides.md)

# Demo script

The live demo, about 12 minutes: the plant as it opens, the guided tour, all six fault scenarios in an order where each one shows its effect, a week at ×10,000, and where the numbers come from. Owned by `process` ([phase 6](../plan/agent-plan/phase-6-polish-and-present.md)); every number below is checked by `tests/sim/demoScript.test.ts`, which replays this exact sequence on the shipped config and seed.

## Before you start

- Open the deployed link in a clean Chrome or Edge window, at 1440 × 900 or larger, zoom 100%. Wait until "Loading the plant…" has gone and the clock in the top bar runs.
- The plant always opens the same way: day 8 at 06:00, ×10, seed 81006. Reload to start over.
- Keys: Space pauses, 1–5 pick ×1 to ×10,000, Esc goes back to the whole plant.
- **Timing.** The clock times below are when to click. A minute either way changes a few numbers (the tank level when a fault starts, so when the fillers stop); the scenario's own numbers (divert within 3 s, 113 min out, 50 bar, 84%) never change.
- The plant's own random breakdowns (a filler about every 8 h of running) may add a line or two to "What happened"; they don't change the steps below.

## The run

| # | Clock (day 8) | Speed | Do | What to show and say | Expect |
|---|---|---|---|---|---|
| 1 | 06:00 | ×10 | Nothing yet | The whole plant: milk from the silos on the left to the trucks on the right, ten stages. The KPI strip. The plant opens with a week of history, so trucks find stock from the start. | UHT flow 16,000 L/h; F0 about 5.2 min, B\* about 1.19 (the reading moves ±0.3 °C, so F0 4.8–5.6, B\* 1.11–1.27); aseptic tank 50%; packs 15,000/h; OEE 93.75%, then 93.6% once rejects come in; 42 batches on hold; 634 pallets in stock, 2.0 days of cover; order fill 100% |
| 2 | 06:00–06:30 | ×10 | **Tour** (top of the stage list) | Each stage for 18 s with two lines. Stop it with **Stop tour** or Esc if time is short; it ends on the whole plant. | 10 stops, 3 minutes |
| 3 | 06:30 | ×10, then **×100** | **Scenarios → Filler breakdown** | The view flies to stage 7. Filler A's lamp turns red, its reel and jaws stop. Open stage 6: the tank climbs, 8,500 L/h. At 90% the UHT plant drops to half flow so the tank cannot overflow. | Filler A down 60 min + 2 min re-sterilizing: back at 07:32. Tank past 90% at 07:23 (peaks about 18,075 L): "UHT plant throttled to 50%". Full flow again at 08:24, below 60%. Line A makes 7,750 packs fewer. Truck 1 at 07:40: stock 612 |
| 4 | 08:30 | ×10 for the divert, then **×100** | **Scenarios → UHT temperature drop** | Stage 4: the steam injector sputters, the outlet falls, B\* drops under 1, the valve lamp turns red and milk goes to the reject tank. Then the full CIP: the CIP station lights each fluid's lamp, the UHT circuit's pipes turn pale blue (water), violet (lye) and magenta (acid), and the panel's "Cleaning step" row names each step; then re-sterilizing, when the boiler house's plume stands high: the steam now heats hot water, not milk. Stage 4's "Energy since opening" climbs. The fillers drain the tank and stop. Open **What happened and why** on the banner. | Divert within 3 s (reading about 139.1 °C, B\* 0.98); 800 L to the reject tank; CIP 08:33–09:53; fillers stop at 09:18 (tank at 150 L); re-sterilizing: steam 2,085 kg/h, boiler gas 1,616 kW; back in production 10:23, 113 min after the divert; fillers run again 79 s later. Energy since opening 86.6 kWh/t before the fault, about 107 at 10:23. OEE falls to about 61%. Truck 2 at 09:20: stock 590 |
| 5 | 10:45 | ×10 | **Scenarios → Homogenizer pressure loss** | Stage 3: the stage 1 needle drops to 50 bar, the globules grow, the creaming risk jumps; stage 3 turns red. Nothing fails yet: the cream layer shows only at the end of incubation. | 50 bar; globules 1.84 µm; creaming risk 84%; outlet 78 °C; batches 54 and 55 flagged. Repaired at 11:45 |
| 6 | 10:46 | ×10 | **Scenarios → Sterile-air filter failure** | Stage 6 turns amber: "Filter failed · deviation, batches held". In stage 9, batches 54 and 55 show *Investigation*; their lamps blink in quarantine. | Filter replaced at 12:46. Each sample of 54 and 55 now spoils with 5% chance: a batch of 16 samples fails 56% of the time |
| 7 | 10:47 | ×10 | **Scenarios → Failed incubation** | Stage 9: the oldest batch on hold is blocked at once, its block red. | Batch 12, 59 pallets blocked; on hold 41, blocked 1. Destroyed a day later, day 9 at 10:47 |
| 8 | 10:48 | **×100** | **Scenarios → Demand spike** | Stage 10: extra trucks every 5 min; with 3 doors they queue in the yard. Stock and days of cover fall. | 12 extra trucks; up to 4 waiting in the yard (one is the regular 11:00 truck); the last extra truck leaves at 12:28. Stock 304 pallets, 1.0 day of cover; order fill 33% (5 of 15 trucks found a free door); 15 trucks shipped |
| 9 | 12:30 → day 15, 14:00 | **×10,000** | Nothing; watch stage 9 | A week in about a minute: a batch released every day at 14:00, trucks every 100 min. On day 15 at 14:00 batches 54 and 55 finish incubating, and both are blocked. Pause there. | Batch 54: a sample of 20 spoiled (the filter's 5%); batch 55: the sensory check finds a cream layer (84%). Either way both are blocked: the creaming risk alone fails them. Then 42 on hold, 41 released, 3 blocked; stock 454; OEE about 90.5% |
| 10 | — | Paused | **Scenarios → Scenario log**, then **About** | The log tells each scenario as one story, every step with its why. About: what the model is and isn't, the accepted simplifications, the sources. | Six runs, all over |

## If something goes differently

- **A scenario is greyed out** in the menu: its line says why ("The steam supply is down already", "Every filler is down already", "Trucks are disrupted already", "No batch is on hold"). Wait or press **Reset scenarios**.
- **Reset scenarios** puts every running fault right at once; what it caused runs its course (a divert still cleans and re-sterilizes).
- **The view stopped with "The simulation stopped"**: press **Reload**; the plant opens fresh at 06:00.
- **Short on time**: skip step 2 after stage 4, and in step 9 stop at ×10,000 as soon as the 14:00 verdicts show.

## Why these scenarios in this order

The filler breakdown comes first, while the tank is half full, so it rises to 90% and the throttle shows; after the temperature drop the tank is nearly empty and it would not. The temperature drop follows, with the tank at about 60%, so the fillers keep running for 48 min of the 113 the plant is out, then stop. The homogenizer and filter faults land on the same two batches, 54 and 55, so the week at ×10,000 ends with a verdict for each: one from the spoiled sample, one from the cream layer. The failed incubation is instant and the demand spike is best at ×100, so they go last before the week.
