[Index](README.md) · Part 6 of 11 · [Review](REVIEW.md)

# Simulation model

Run two coupled models: a fixed-step continuous model for stages 1–6 (litres, °C, bar) and an event-driven discrete model for stages 7–10 (packs, trays, pallets, batches), joined at the aseptic tank.

## How time works

- One sim clock with speed presets from ×1 to ×10,000: ×1 to watch the 4-second holding tube, ×10,000 to pass a 7-day quarantine in about a minute.
- The continuous model steps every simulated second, several steps per frame; above ×1,000 it steps every 10–60 s, since tank levels change slowly.
- The discrete model keeps an event queue sorted by time (filler fault, repair done, pallet full, incubation over, truck arrives) and runs every event due before each new frame.
- The model never touches Three.js. Each frame the 3D view reads a state snapshot and animates a sample of visual cartons, not every pack.

## Core formulas

Cream share to remix for 3.5% milk from 0.05% skim and 40% cream:

$$
x_{\text{cream}} = \frac{f_{\text{target}} - f_{\text{skim}}}{f_{\text{cream}} - f_{\text{skim}}} = \frac{3.5 - 0.05}{40 - 0.05} \approx 0.086
$$

Tank level per step, and holding time from tube volume and flow:

$$
V_{t+\Delta t} = V_t + (Q_{\text{in}} - Q_{\text{out}})\,\Delta t \qquad t_{\text{hold}} = \frac{V_{\text{tube}}}{Q}
$$

Sterilizing effect in the holding tube (t in seconds, T in °C), from the F0 and B\* reference values in the [UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/):

$$
F_0 = \frac{t_{\text{hold}}}{60} \cdot 10^{(T - 121.1)/10} \qquad B^{*} = \frac{t_{\text{hold}}}{10.1} \cdot 10^{(T - 135)/10.5}
$$

At 140 °C for 4 s this gives F0 ≈ 5.2 min and B\* ≈ 1.19, inside the targets. Divert when B\* falls below 1, which for a 4 s hold means below about 139.2 °C.

> **Decided:** keep the 140 °C set point and cap display noise at ±0.3 °C, so noise alone never crosses the 0.78 °C margin. See [D4](DECISIONS.md#d4-divert-rule-and-display-noise).
>
> **Review note:** the 4 s hold (and with it the 139.2 °C limit) changes whenever the flow does. At 50% flow the hold is 8 s and the limit about 136.1 °C. See [R6](REVIEW.md#r6-holding-time).

Filler efficiency, as defined by [OEE.com](https://www.oee.com/calculating-oee/):

$$
\text{OEE} = \text{Availability} \times \text{Performance} \times \text{Quality}
$$

## Default settings

Temperatures are in the chart under [The UHT line at a glance](02-uht-line-at-a-glance.md), which also [lists them as text](02-uht-line-at-a-glance.md#chart-values-as-text). `src/data/plant.json` holds the same values, and the [decision log](DECISIONS.md) names the key for each one.

| Setting | Default | Basis |
|---|---|---|
| Raw-milk fat | 4.0% | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| UHT plant capacity | 16,000 L/h | Direct plants run 2,000–45,000 L/h ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| Fillers | 2 × 7,500 packs/h, 1 L | Below the 8,000/h maximum of the [A3/Flex](https://www.tetrapak.com/solutions/packaging/filling-machines/tetra-pak-a3flex) |
| Filler time between failures | Random (exponential), mean 8 h of running | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Filler repair time | 2 min + random (exponential), mean 12 min | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Homogenizer | 200 bar + 30 bar; outlet about 82 °C | 180–250 bar; second stage about 30 bar; 1 °C per 40 bar ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers), [D5](DECISIONS.md#d5-homogenizer-outlet)) |
| Holding time | 4 s at full flow | Practical range 4–6 s ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| UHT display noise | ±0.3 °C at most | Keeps B\* at 1.11 or more at 140 °C ([D4](DECISIONS.md#d4-divert-rule-and-display-noise)) |
| UHT fault temperature | Falls to 135.5 °C | Sim assumption; diverts at 4 s and at 8 s hold ([D2](DECISIONS.md#d2-missing-defaults)) |
| Divert before cleaning | 3 min | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Reject tank | 6,000 L | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Aseptic tank | 20,000 L, starts 50% full | Sizes run 7,000–50,000 L ([Tetra Alsafe](https://www.machineryworld.com/wp-content/uploads/2020/11/pd10196_tetra_alsafe.pdf)) |
| Tank thresholds | UHT plant to 50% above 90% full, back to full flow below 60%; fillers stop below 150 L | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Cleaning | Full CIP 80 min; intermediate clean 30 min | CIP takes 70–90 min, AIC 30 min ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| Intermediate clean interval | Every 10 h of production | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Full CIP trigger | Only after a divert, then 30 min sterilizing at 125 °C | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Batch | One filler for one 8-hour shift (60,000 packs, about 60 pallets) | Sim assumption ([D1](DECISIONS.md#d1-batch-size)) |
| QA samples | 1 pack per filler every 30 min, plus 2 after each stop | Sim assumption |
| Quarantine | 7 days at 55 °C (default) or 15 days at 30 °C | [Regulation 853/2004](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX), [D9](DECISIONS.md#d9-other-open-values) |
| Microbial failure rate | 0.02% of packs | [UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/) |
| Pack, tray, pallet | 1 L; 12 packs; 84 trays | Sim assumptions |
| Shelf life | 6 months (182 days) | Six to nine months ([GEA](https://www.gea.com/en/stories/shelf-stable-milk-conscientious-convenience/)) |
| Truck | 22 pallets, one every 100 min (about 317 pallets a day) | About 24 t, within the 24–25 t payload of a 40 t truck ([D3](DECISIONS.md#d3-truck-payload)) |
| Demand | Trucks only; a truck waits at the dock until enough stock is released | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Random seed | 81006 (mulberry32), so every run repeats | Sim assumption ([D2](DECISIONS.md#d2-missing-defaults)) |
| Sim clock | Day 1 at 06:00, ×10; 1 s steps, 10 s steps above ×1,000 | Sim assumption ([D8](DECISIONS.md#d8-clock)) |

> **Decided:** a batch is one filler for one 8-hour shift ([D1](DECISIONS.md#d1-batch-size)), the eleven missing defaults are set ([D2](DECISIONS.md#d2-missing-defaults)), and a truck carries 22 pallets every 100 min ([D3](DECISIONS.md#d3-truck-payload)). Each stays Proposed until the developer approves it in the [decision log](DECISIONS.md). [Hand calculations](hand-calculations.md) lists the expected values QA tests against.

## KPIs on screen

- Liquid line: UHT throughput (L/h), F0 and B\*, litres diverted, aseptic tank level (%).
- Filling and packing: packs per hour and OEE per filler, trays and pallets made.
- QA and warehouse: batches on hold, released and blocked; pallets in stock; days of cover; order fill rate; trucks shipped.

## Fault scenarios

| Scenario | Trigger | Plant reaction | What the viewer sees |
|---|---|---|---|
| UHT temperature drop | Steam supply dips, B\* < 1 | Divert to reject; flush, clean, re-sterilize 30 min at 125 °C or more; fillers drain the tank | Valve light turns red, reject tank fills, tank level falls |
| Filler breakdown | Random, from time between failures | Tank level rises; at high level the UHT plant drops to 50% | Filler lamp red, carton flow stops, level climbs |
| Sterile-air filter failure | Manual trigger | Process deviation; tank contents put on hold | Tank lamp amber, batch marked for investigation |
| Failed incubation | Sample fails (chance rises after a filter failure) | Batch blocked, pallets pulled for destruction | Pallet lamps in quarantine turn red |
| Homogenizer pressure loss | Manual trigger | Creaming-risk score rises; QA sensory check fails days later | Gauge needle drops, delayed QA failure |
| Demand spike or late truck | Manual or random | Stock runs down, or the dock backs up | Rack fill colours change, trucks queue |

> **Review note:** at 0.02% per pack, a random failed incubation shows up only about once every 50 simulated days, so demos will rely on the manual trigger. See [R10](REVIEW.md#r10-rare-qa-failures).

---

← [5. Plant layout & 3D assets](05-layout-and-3d-assets.md) · [7. Tech stack & architecture](07-tech-stack-and-architecture.md) →
