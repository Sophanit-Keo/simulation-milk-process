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

> **Review note:** the margin between the set point and the divert limit is only 0.8 °C, and the 4 s hold (and with it the 139.2 °C limit) changes whenever the flow does. See [R4](REVIEW.md#r4-divert-rule) and [R6](REVIEW.md#r6-holding-time).

Filler efficiency, as defined by [OEE.com](https://www.oee.com/calculating-oee/):

$$
\text{OEE} = \text{Availability} \times \text{Performance} \times \text{Quality}
$$

## Default settings

Temperatures are in the chart under [The UHT line at a glance](02-uht-line-at-a-glance.md), which also [lists them as text](02-uht-line-at-a-glance.md#chart-values-as-text).

| Setting | Default | Basis |
|---|---|---|
| UHT plant capacity | 16,000 L/h | Direct plants run 2,000–45,000 L/h ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| Fillers | 2 × 7,500 packs/h, 1 L | Below the 8,000/h maximum of the [A3/Flex](https://www.tetrapak.com/solutions/packaging/filling-machines/tetra-pak-a3flex) |
| Homogenizer | 200 bar + 30 bar | 180–250 bar; second stage about 30 bar ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)) |
| Holding time | 4 s | Practical range 4–6 s ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| Aseptic tank | 20,000 L, starts 50% full | Sizes run 7,000–50,000 L ([Tetra Alsafe](https://www.machineryworld.com/wp-content/uploads/2020/11/pd10196_tetra_alsafe.pdf)) |
| Cleaning | Full CIP 80 min; intermediate clean 30 min | CIP takes 70–90 min, AIC 30 min ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)) |
| Batch | One filler shift of 8 h (60,000 packs) | Sim assumption |
| QA samples | 1 pack per filler every 30 min, plus 2 after each stop | Sim assumption |
| Quarantine | 7 days (55 °C option) or 15 days (30 °C) | [Regulation 853/2004](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX) |
| Microbial failure rate | 0.02% of packs | [UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/) |
| Pack, tray, pallet | 1 L; 12 packs; 84 trays | Sim assumptions |
| Shelf life | 6 months | Six to nine months ([GEA](https://www.gea.com/en/stories/shelf-stable-milk-conscientious-convenience/)) |
| Truck | 33 pallets | Standard 13.6 m trailer ([Eurowag](https://eurowag.com/blog/how-many-euro-pallets-can-be-loaded-onto-a-truck)) |

> **Review note:** before these go into `plant.json`, settle what a batch is, add the defaults this table leaves out, and check the truck's weight. See [R1](REVIEW.md#r1-batch-size), [R2](REVIEW.md#r2-missing-defaults) and [R3](REVIEW.md#r3-truck-payload).

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
