[Index](README.md) · Part 3 of 11 · [Review](REVIEW.md)

# Stage research 1–5: the liquid line

Stages 1–5 are one continuous flow of liquid, so the simulation tracks them in litres per hour, temperature and pressure.

## 1. Standardization & Formulation

A separator splits warm milk into skim and cream, and in-line control remixes just enough cream to hit the target fat (3.5% here).

- **Real process:** Raw milk waits in insulated silo tanks of 30,000–250,000 L with side agitators ([Tanks](https://dairyprocessinghandbook.tetrapak.com/chapter/tanks)). At 55–65 °C a disc-stack separator gives skim milk (about 0.05% fat) and cream (35–40%). Flow and density transmitters drive a valve that remixes cream, holding fat within 0.015% ([Separators and standardization](https://dairyprocessinghandbook.tetrapak.com/chapter/centrifugal-separators-and-milk-standardization)).
- **Formulation:** stabilizers, vitamins or flavours go in through batch tanks of 250–10,000 kg or in-line mixers; high-shear mixers handle hard powders ([Mixers](https://dairyprocessinghandbook.tetrapak.com/chapter/mixers)).
- **3D:** silo with level gauge, separator with a spinning bowl, standardization skid (flow meters, valves), mixing tank with a turning agitator.
- **Simulate:** fat % by mass balance, surplus cream (L/h), silo and mix-tank levels, recipe per batch.

> **Decided:** raw milk has 4.0% fat, the preview's value. See [D2](DECISIONS.md#d2-missing-defaults).

## 2. Preheating & Deaeration

Heat exchangers warm the cold feed to about 75–80 °C, then a vacuum vessel strips out the air.

- **Real process:** Milk leaves the feed tank at about 4 °C, passes a balance tank and feed pump, and is preheated to about 75 °C in indirect plants, using heat recovered from outgoing milk, or about 80 °C in direct plants ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)). In the deaerator, vacuum makes the milk boil 4–5 °C below its preheat temperature; a vacuum pump removes the air and a built-in condenser returns the vapour ([Deaerators](https://dairyprocessinghandbook.tetrapak.com/chapter/deaerators)).
- **Why it matters:** air fouls heating surfaces and skews flow measurement ([Deaerators](https://dairyprocessinghandbook.tetrapak.com/chapter/deaerators)).
- **3D:** balance tank, feed pump, plate or tubular heat exchanger, vacuum vessel with condenser on top and a vacuum pump beside it.
- **Simulate:** outlet temperature from the set point, the 4–5 °C drop in the vessel, air content falling (a sim value), heat recovered in kW.

## 3. Homogenization

A high-pressure piston pump forces milk through a gap of about 0.1 mm, so fat globules shrink below 1 µm and no cream layer forms during months on the shelf.

- **Real process:** UHT lines homogenize at 180–250 bar ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)). The pump has 3–5 pistons; the first stage breaks the globules (about 3.5 µm down to under 1 µm), and the second adds about 30 bar back-pressure to break clusters. It runs at 55–80 °C, and every 40 bar of pressure drop adds 1 °C ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)).
- **Position note:** your stage order puts homogenization before UHT, as indirect plants do. Direct plants with flash cooling use an aseptic homogenizer after the flash vessel instead ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)).
- **3D:** box-shaped machine with three pistons driven by a crank, two pressure gauges, motor with belt drive.
- **Simulate:** stage 1 and stage 2 pressures, temperature rise, globule size, a creaming-risk score, power draw (handbook example: 68 kW for 10,000 L/h at 200 bar).

> **Review note:** the model mixes plant types in two places, not one. See [R5](REVIEW.md#r5-plant-type-mix). **Decided:** the outlet is about 82 °C, with the temperature rise listed above. See [D5](DECISIONS.md#d5-homogenizer-outlet).

## 4. UHT Treatment

Steam heats the milk to about 140 °C, a holding tube keeps it there for about 4 s, and any drop below the divert limit (B\* < 1) diverts the flow to reject.

- **Real process:** milk needs 135–150 °C for a few seconds, in practice 137–142 °C for 4–6 s ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)); EU law requires at least 135 °C ([Regulation 853/2004, Annex III §IX](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX)). Direct plants inject steam through a ring nozzle to 140–150 °C, under pressure so it cannot boil. The target is a 9-log kill of heat-resistant spores (B\* above 1) and an F0 of 5–6 min ([UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/)).
- **Safety logic:** temperature is recorded at the holding-tube outlet ([FDA aseptic guide](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry)). If it drops, product goes to a reject tank, and the plant is flushed, cleaned and re-sterilized before restart. Before each run, hot water at 125 °C or more circulates for at least 30 min ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)).
- **3D:** steam injector head, coiled holding tube, flow-diversion valve with a green/red light, steam pipe from the boiler house.
- **Simulate:** holding time = tube volume ÷ flow, live F0 and B\*, divert events, plant capacity (direct systems run 2,000–45,000 L/h).

> **Decided:** the model diverts when B\* < 1, about 139.2 °C at a 4 s hold, 0.8 °C under the 140 °C set point, so display noise stays within ±0.3 °C. See [D4](DECISIONS.md#d4-divert-rule-and-display-noise).

## 5. Flash Cooling

A vacuum vessel drops the milk from about 140 °C to about 80 °C almost instantly and boils off the same amount of water the steam added.

- **Real process:** the vacuum is set so the vapour flashed off equals the steam injected, and the milk falls back to its preheat temperature, about 80 °C. A pump then feeds the aseptic homogenizer, and a tubular cooler brings the milk to about 20 °C for the aseptic tank or filler ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)).
- **3D:** tall vessel with a conical bottom, vapour pipe to a condenser, extraction pump, tubular cooler.
- **Simulate:** water removed = steam added (solids stay constant), temperature steps to 80 °C and then 20 °C, condenser load.

---

← [2. The UHT line at a glance](02-uht-line-at-a-glance.md) · [4. Stage research 6–10](04-stages-6-10-tank-to-truck.md) →
