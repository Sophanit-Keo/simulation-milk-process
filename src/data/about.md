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

## Cleaning

A full CIP walks the Dairy Processing Handbook's programme for circuits with heated surfaces: a 10 min pre-rinse with warm water at 45 °C, 30 min of lye at 75 °C, a 5 min rinse, 20 min of acid at 70 °C, a 7 min post-rinse with cold water and 8 min of gradual cooling, 80 min in all ([Cleaning of dairy equipment](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment)). After every 10 h of production the plant also runs a 30 min intermediate clean (AIC) at the set point, so it stays sterile: water pushes the milk out for 5 min, lye circulates for 20 min and water rinses for 5 min, while the fillers draw on the aseptic tank.

The CIP station behind the flash vessel pumps each fluid at 24,000 L/h, about 2 m/s in the pipes, and lights the lamp of the one it pumps. The pipes from the balance tank to the cooler outlet take that fluid's colour: pale blue water, violet lye, magenta acid. The aseptic tank and the divert line are not in the circuit. The stage 4 panel names the step and the time left in it.

## Steam and energy

The boiler house raises the steam the injector uses. Steam heats whatever passes it: the milk, from the homogenizer outlet at 81.75 °C to 140 °C, 1,652 kg/h at full flow; and, while the plant cleans or re-sterilizes, the circulating water, lye or acid, from the deaerator outlet to the step's temperature. An intermediate clean at the set point takes more steam than production, 2,723 kg/h, because the circulation is faster; a CIP step only makes up the deaerator's 4 °C once the preheater has its temperature. Raising a kilogram of steam at 150 psig from 93 °C feedwater takes 2,391 kJ, and a gas boiler with an economizer burns it at 85.7% efficiency, so production burns 1,280 kW of gas ([US DOE Steam Tip Sheet #15](https://www1.eere.energy.gov/manufacturing/tech_assistance/pdfs/steam15_benchmark.pdf)). The homogenizer draws 125 kW of electricity.

Regeneration gives the milk 56.6% of its heating: the preheater warms it from 4 °C to 80 °C with heat from the hot product and the flash vapour, and the steam does the rest. Indirect plants recover up to 90% ([GEA](https://www.gea.com/en/products/liquid-processing/uht-systems/)); a direct plant gives some of that up for its flash cooling.

The stage 4 panel adds up the energy since the plant opened, gas and electricity, per tonne of raw milk drawn, as the EU's best available techniques for dairies count it ([Decision (EU) 2019/2031](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019D2031), BAT 21). A day at the defaults comes to about 92 kWh/t, under the 100–600 kWh/t given for market milk, which counts a whole dairy. A divert costs 113 min of steam with no product: one soon after the plant opens more than triples the figure ([D17](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md#d17-phase-8-steam-and-energy)).

## Holding time follows the flow

The holding tube holds 17.8 L, so the holding time is that volume divided by the flow: 4 s at full flow (16,000 L/h), 8 s at 50%. At 8 s, B* rises to 2.37, F0 to 10.35 min, and the divert limit falls to 136.06 °C. The stage 4 panel shows this.

The temperature-drop fault therefore falls to 135.5 °C, which diverts at either flow. It is above the EU minimum of 135 °C ([Regulation 853/2004](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX)), so temperature alone is not enough without the holding time.

## From packs to trucks

Each filler makes 7,500 one-litre packs an hour, below its 8,000 maximum, and the seal check rejects 0.2%. Packs go 12 to a tray and 84 trays to a pallet, 1,008 packs. A batch is one filler for one 8-hour shift: about 60 pallets, the last closed part-full so that no pallet mixes two batches. Each filler sends a pack to the QA lab every 30 min and 2 more after each restart, so a batch has at least 16 samples.

A batch waits in quarantine while its samples incubate for 7 days at 55 °C. If none spoils, it is released to the warehouse; if one does, the batch is blocked, kept for a day, then destroyed. With 0.02% of packs failing, about one batch in 300 is blocked, one every 52 days or so. The batch list in the stage 9 panel can pass or fail a batch by hand.

So the quarantine holds a week of output, about 2,500 pallets. A truck comes every 100 min for 22 pallets, about 317 a day, picked earliest best-before first; it waits at the dock if the stock is short. After breakdowns the plant makes about 350 pallets a day, so the stock grows by about 30 a day. Each filler's OEE is availability × performance × quality, about 91% over a long run.

## Why it opens on day 8

A plant that started empty would release nothing for a week: the first batch would leave quarantine on day 8, and every truck until then would find no stock. So the model opens on day 8 at 06:00 with a week of history: 42 batches on hold and 634 pallets in stock, two days of cover ([D11](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md#d11-opening-state)).

## Fault scenarios

The Scenarios menu in the top bar starts six faults, alone or together, and Reset puts them right. Each one plays out through the plant's own rules, so what it causes downstream is the model's answer, not a recording:

- UHT temperature drop: the steam supply dips and the outlet falls toward 135.5 °C. Within 3 s B* is below 1 and the plant diverts, then cleans and re-sterilizes for 113 min while the fillers drain the aseptic tank.
- Filler breakdown: a jammed sealing jaw stops a filler for an hour. The aseptic tank takes the milk it no longer draws until it is 90% full, and then the UHT plant drops to half flow.
- Sterile-air filter failure: a process deviation at the aseptic tank. The batches filled until the filter is replaced, 2 h later, stay under investigation and are judged with a 5% chance per sample of a spoiled one.
- Failed incubation: the oldest batch on hold fails at once. It is blocked, and destroyed a day later.
- Homogenizer pressure loss: an hour at 50 bar leaves the fat globules too large. The batches filled meanwhile fail the sensory check a week later, when their incubation ends.
- Demand spike or late trucks: twelve extra trucks in an hour run the stock down and queue in the yard; or no truck comes for nearly 7 hours, then four arrive at once.

A banner over the 3D view follows the newest scenario, and its log lists every step with why it happened. The sizes of the faults are fixed sim assumptions ([D15](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md#d15-phase-5-fault-scenario-defaults)).

## The guided tour

Tour, at the top of the stage list, flies the camera through the ten stages in order, 18 s at each, about 3 minutes in all, with two lines on what happens there. A click on a stage or the plant, Escape, or Stop ends it.

## Accepted simplifications

- Milk moves as plug flow, with no pressure drop, viscosity effects or fouling.
- Temperatures change in steps with a short lag, not through heat-transfer equations.
- One product and one pack size.
- Cleaning runs its steps on a timer: the fluids colour the pipes and set the temperatures, but they are not part of the liquid balance, and nothing models soil or detergent strength.
- The energy counts the boiler's gas for the injector's steam and the homogenizer's electricity; the other drives, cooling, compressed air and buildings are left out, and the cleaning fluids heat as milk does.
- Failures follow simple random rates, not real plant data.
- The fault scenarios are scripted, each with one fixed size and duration.
- The machines are simplified models made in code, shaded with baked ambient occlusion, not drawings of real equipment.
- A full CIP runs only after a divert; real plants also clean at the end of each production run.
- Demand is a truck of 22 pallets at a fixed interval, standing in for random daily orders.
- Packs, trays and pallets are counts. The 3D view moves a sample of them, not every pack.
- A truck loads only a full load of released stock, and every pallet holds packs of one batch.

## Where the numbers come from

- [plant.json](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/src/data/plant.json) holds every default.
- The [decision log](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/DECISIONS.md) gives each one a source or marks it as a sim assumption.
- The [hand calculations](https://github.com/Sophanit-Keo/simulation-milk-process/blob/master/plan/hand-calculations.md) list the values the tests expect.
- The stage research cites the [Dairy Processing Handbook](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk), the [UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/) for F0 and B*, and the [FDA aseptic guide](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry).

## Sources

Process and regulation:

- Tetra Pak Dairy Processing Handbook: [Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk), [Centrifugal separators and milk standardization](https://dairyprocessinghandbook.tetrapak.com/chapter/centrifugal-separators-and-milk-standardization), [Deaerators](https://dairyprocessinghandbook.tetrapak.com/chapter/deaerators), [Homogenizers](https://dairyprocessinghandbook.tetrapak.com/chapter/homogenizers), [Tanks](https://dairyprocessinghandbook.tetrapak.com/chapter/tanks), [Mixers](https://dairyprocessinghandbook.tetrapak.com/chapter/mixers) and [Cleaning of dairy equipment](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment)
- [UHT milk and milk products](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/), INFLIBNET e-PG Pathshala: F0, B* and the microbial failure rate
- [Regulation (EC) No 853/2004, Annex III, Section IX](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX): the UHT minimum and the incubation checks
- [FDA: Aseptic Processing and Packaging for the Food Industry](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry)
- [Reinheimer and Demkow (1990), Comparison of rapid tests for assessing UHT milk sterility](https://www.cambridge.org/core/journals/journal-of-dairy-research/article/abs/comparison-of-rapid-tests-for-assessing-uht-milk-sterility/4614AE5B275AC91DE2AA432FE6E1E919), Journal of Dairy Research
- [GEA: Shelf-stable milk](https://www.gea.com/en/stories/shelf-stable-milk-conscientious-convenience/): shelf life

Steam and energy:

- [US DOE Steam Tip Sheet #15: Benchmark the Fuel Cost of Steam Generation](https://www1.eere.energy.gov/manufacturing/tech_assistance/pdfs/steam15_benchmark.pdf): the heat to raise steam, and a gas boiler's efficiency
- [Commission Implementing Decision (EU) 2019/2031](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019D2031), BAT 21: the dairy energy benchmark
- [Engineering ToolBox: Saturated steam](https://www.engineeringtoolbox.com/saturated-steam-properties-d_457.html): steam tables
- [GEA: UHT systems](https://www.gea.com/en/products/liquid-processing/uht-systems/): heat recovery in indirect plants

Equipment and logistics:

- [Tetra Pak A3/Flex](https://www.tetrapak.com/solutions/packaging/filling-machines/tetra-pak-a3flex): filler capacity
- [Tetra Alsafe aseptic tank](https://www.machineryworld.com/wp-content/uploads/2020/11/pd10196_tetra_alsafe.pdf): tank sizes
- [ICPE: Aseptic packaging system](https://www.icpe.in/icpefoodnpackaging/pdfs/23_aseptic.pdf)
- [Tetra Pak Tray Shrink 30](https://www.tetrapak.com/en-cz/solutions/packaging/downstream-equipment/film-wrappers/tetra-pak-tray-shrink-30)
- [GS1 UK: Logistics labels and SSCCs](https://gs1uk.org/support-training/help-to-use-and-implement-gs1-standards/logistics-labels-and-ssccs): the pallet label
- [Eurowag: How many euro pallets fit on a truck](https://eurowag.com/blog/how-many-euro-pallets-can-be-loaded-onto-a-truck): the truck load
- [OEE.com: Calculating OEE](https://www.oee.com/calculating-oee/)

Made with [three.js](https://threejs.org/) (MIT), [Chart.js](https://www.chartjs.org/) (MIT) and the Barlow, Barlow Condensed and IBM Plex Mono fonts ([SIL OFL 1.1](https://openfontlicense.org)). The conveyors are from [Kenney's Factory Kit](https://kenney.nl/assets/factory-kit) (CC0); the machines, vehicles and pack prints are the project's own work, and no brand appears on them.
