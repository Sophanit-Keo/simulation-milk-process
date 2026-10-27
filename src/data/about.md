# About this model

This is a teaching simulation of one UHT milk plant, from the raw-milk silo to the truck. The liquid line (stages 1–6) steps in litres, degrees and bar; packs, pallets and trucks (stages 7–10) run as discrete events. It shows how the stages depend on each other: what the buffer tank absorbs, when the plant must divert, how a fault travels down the line. It is not a design tool and does not predict the output of any real plant.

## A mix of plant types

The model is a direct UHT plant: steam heats the milk to about 140 °C, a holding tube keeps it there for about 4 s, and a flash vessel boils off the water the steam added. It borrows from indirect plants twice:

- The homogenizer sits before UHT, as in the course's stage order. Direct plants with flash cooling usually homogenize aseptically after the flash vessel ([Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers)).
- The UHT plant drops to 50% flow when the aseptic tank is nearly full. The source for running at 50–100% of capacity describes indirect plants ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)).

Milk is separated at 60 °C in the upstream milk treatment and stored cold before UHT. The flash vessel returns it to the usual 80 °C, not the 81.75 °C it left the homogenizer at.

## When the plant diverts

The model computes the sterilizing effect B* from the temperature at the holding-tube outlet and the live holding time. When B* falls below 1, the plant sends 3 min of product to the reject tank (800 L at full flow), then cleans for 80 min (CIP) and sterilizes for 30 min at 125 °C or more. The UHT plant is out for 113 min, while the fillers drain the aseptic tank.

At 140 °C and a 4 s hold, B* is 1.19 and the divert limit is 139.22 °C. The temperature on screen moves a little, but that noise is capped at ±0.3 °C. The divert check reads both the noisy reading and the set point, so a set point under the limit diverts at once. The lowest reading at 140 °C, 139.7 °C, still gives B* 1.11, so noise alone never diverts. F0 can dip just under 5 min within that band, so the status lamps follow B*, not F0 ([D4](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md#d4-divert-rule-and-display-noise)).

## Holding time follows the flow

The holding tube holds 17.8 L, so the holding time is that volume divided by the flow: 4 s at full flow (16,000 L/h), 8 s at 50%. At 8 s, B* rises to 2.37, F0 to 10.35 min, and the divert limit falls to 136.06 °C. The stage 4 panel shows this.

The temperature-drop fault therefore falls to 135.5 °C, which diverts at either flow. It is above the EU minimum of 135 °C ([Regulation 853/2004](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX)), so temperature alone is not enough without the holding time.

## From packs to trucks

Each filler makes 7,500 one-litre packs an hour, below its 8,000 maximum, and the seal check rejects 0.2%. Packs go 12 to a tray and 84 trays to a pallet, 1,008 packs. A batch is one filler for one 8-hour shift: about 60 pallets, the last closed part-full so that no pallet mixes two batches. Each filler sends a pack to the QA lab every 30 min and 2 more after each restart, so a batch has at least 16 samples.

A batch waits in quarantine while its samples incubate for 7 days at 55 °C. If none spoils, it is released to the warehouse; if one does, the batch is blocked, kept for a day, then destroyed. With 0.02% of packs failing, about one batch in 300 is blocked, one every 52 days or so. The batch list in the stage 9 panel can pass or fail a batch by hand.

So the quarantine holds a week of output, about 2,500 pallets. A truck comes every 100 min for 22 pallets, about 317 a day, picked earliest best-before first; it waits at the dock if the stock is short. After breakdowns the plant makes about 350 pallets a day, so the stock grows by about 30 a day. Each filler's OEE is availability × performance × quality, about 91% over a long run.

## Why it opens on day 8

A plant that started empty would release nothing for a week: the first batch would leave quarantine on day 8, and every truck until then would find no stock. So the model opens on day 8 at 06:00 with a week of history: 42 batches on hold and 634 pallets in stock, two days of cover ([D11](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md#d11-opening-state)).

## Accepted simplifications

- Milk moves as plug flow, with no pressure drop, viscosity effects or fouling.
- Temperatures change in steps with a short lag, not through heat-transfer equations.
- One product and one pack size.
- Cleaning is a timed machine state, not liquid moving through the pipes.
- Failures follow simple random rates, not real plant data.
- A full CIP runs only after a divert; real plants also clean at the end of each production run.
- Demand is a truck of 22 pallets at a fixed interval, standing in for random daily orders.
- Packs, trays and pallets are counts. The 3D view moves a sample of them, not every pack.
- A truck loads only a full load of released stock, and every pallet holds packs of one batch.

## Where the numbers come from

- [plant.json](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/src/data/plant.json) holds every default.
- The [decision log](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md) gives each one a source or marks it as a sim assumption.
- The [hand calculations](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/hand-calculations.md) list the values the tests expect.
- The stage research cites the [Dairy Processing Handbook](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk), the [UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/) for F0 and B*, and the [FDA aseptic guide](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry).
