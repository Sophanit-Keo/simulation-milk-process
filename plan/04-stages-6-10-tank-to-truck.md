[Index](README.md) · Part 4 of 11 · [Review](REVIEW.md)

# Stage research 6–10: from sterile tank to truck

After the aseptic tank, milk becomes countable units (packs, trays, pallets), so the simulation switches from flow rates to discrete events.

## 6. Aseptic Storage (Buffer)

A sterile tank sits between the UHT plant and the fillers, so either side can stop or slow down without stopping the other.

- **Real process:** the tank balances supply to one or more fillers. The UHT plant is sized slightly larger, so the level builds up and the fillers keep running through its 30-minute intermediate clean; indirect plants can also run at 50–100% of capacity ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)). A [Tetra Alsafe](https://www.machineryworld.com/wp-content/uploads/2020/11/pd10196_tetra_alsafe.pdf) tank holds 7,000–50,000 L, is steam-sterilized at 125 °C or more, and keeps sterile air above the milk at up to 3.0 bar; a load cell in one leg weighs the contents.
- **Rule:** sterile-air overpressure must be kept during operation, and a failed air filter counts as a process deviation ([FDA aseptic guide](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry)).
- **3D:** vertical tank on three legs, valve cluster, sterile-air filter housing, floating level label.
- **Simulate:** level changes by (inflow − outflow) each tick; high level throttles the UHT plant to 50%, low level pauses the fillers; headspace pressure.

> **Review note:** the 50% throttle comes from indirect plants, and "high" and "low" level still need numbers, with a gap between them so the plant doesn't keep switching. See [R5](REVIEW.md#r5-plant-type-mix) and [R2](REVIEW.md#r2-missing-defaults).

## 7. Aseptic Packaging

The filler sterilizes the carton material, forms it into a tube, fills it with sterile milk and seals each pack below the liquid level, so no air or germs get in.

- **Real process:** material comes off a reel and a plastic strip is sealed to one edge. The web runs through 30–35% hydrogen peroxide, then hot air at 60–125 °C removes the residue. It is formed into a tube, sealed lengthwise, and sealed across below the product level ([ICPE aseptic packaging notes](https://www.icpe.in/icpefoodnpackaging/pdfs/23_aseptic.pdf)); the tube is then cut and folded into bricks.
- **Example machine:** the [Tetra Pak A3/Flex](https://www.tetrapak.com/solutions/packaging/filling-machines/tetra-pak-a3flex) fills up to 8,000 packages per hour in 500–2,000 ml formats, with a peroxide bath and a sterile-air zone under closed-loop control. US rules cap peroxide at 35% and residues at 0.5 ppm ([UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/)).
- **3D:** filler cabinet with a glass aseptic zone, paper reel, vertical tube, moving sealing jaws, outfeed conveyor of cartons.
- **Simulate:** packs per hour, random stops (time between failures, repair time), rejected packs, batch and date code on every pack.

> **Review note:** time between failures and repair time have no default values yet. See [R2](REVIEW.md#r2-missing-defaults).

## 8. Secondary Packaging & Palletization

Conveyors group packs into shrink-wrapped trays, and a palletizer stacks the trays into labelled pallets, the unit tracked from here on.

- **Real process:** downstream machines add straws to small portion packs, at up to 40,000 packs per hour ([Straw applicators](https://www.tetrapak.com/en-kr/solutions/integrated-solutions-equipment/downstream-equipment/straw-applicators)), and shrink-wrap trays. The [Tetra Pak Tray Shrink 30](https://www.tetrapak.com/en-cz/solutions/packaging/downstream-equipment/film-wrappers/tetra-pak-tray-shrink-30) takes 40 tray sizes and 40 µm film, and speeds up by as much as 30% to clear a queue after a stop.
- **Pallet label:** each pallet gets an 18-digit SSCC; the GS1 label also shows product GTIN, quantity, batch number and best-before date ([GS1 UK](https://gs1uk.org/support-training/help-to-use-and-implement-gs1-standards/logistics-labels-and-ssccs)).
- **3D:** conveyors with an accumulation table, tray-shrink tunnel, robot-arm palletizer, stretch wrapper with a rotating arm, label printer.
- **Simulate:** 12 packs per tray and 84 trays per pallet (sim assumptions, about 1,000 L), conveyor queues, catch-up speed after stops, one SSCC per pallet.

## 9. Quarantine & Quality Assurance Testing

Every batch stays on hold until its sample packs pass incubation, so a pallet can be finished but not yet sellable.

- **Rule:** EU law requires UHT products to stay microbiologically stable after 15 days at 30 °C or 7 days at 55 °C in closed containers ([Regulation 853/2004, Annex III §IX](https://www.legislation.gov.uk/eur/2004/853/annex/III/section/IX)). US rules do not make incubation mandatory, but inspectors check sampling, incubation conditions and lot acceptance criteria when it is used ([FDA aseptic guide](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/aseptic-processing-and-packaging-food-industry)).
- **Checks after incubation:** colony count, pH and acidity change, smell and taste, ethanol stability; in one study a resazurin test caught every spoiled sample after 3 days at 30 °C ([Journal of Dairy Research, 1990](https://www.cambridge.org/core/journals/journal-of-dairy-research/article/abs/comparison-of-rapid-tests-for-assessing-uht-milk-sterility/4614AE5B275AC91DE2AA432FE6E1E919)). The typical microbial failure rate is about 0.02% ([UHT milk module](https://ebooks.inflibnet.ac.in/ftp04/chapter/uht-milk-and-milk-products/)).
- **3D:** quarantine zone with yellow floor lines and a status lamp on each pallet, QA lab with incubators and sample packs.
- **Simulate:** samples per batch, incubation timer (time-compressed), pass or fail drawn from a failure rate, status HOLD → RELEASED or BLOCKED.

> **Review note:** a week on hold is over 2,000 pallets, too many to read one lamp per pallet, and random sample failures will rarely show in a demo. See [R9](REVIEW.md#r9-quarantine-scale) and [R10](REVIEW.md#r10-rare-qa-failures).

## 10. Warehousing & Ambient Distribution

Released pallets are stored and shipped at room temperature with no cold chain, and are picked by best-before date.

- **Real process:** UHT milk keeps six to nine months at 20–30 °C without refrigeration ([GEA](https://www.gea.com/en/stories/shelf-stable-milk-conscientious-convenience/)). Its shelf life ends through physical and enzyme changes such as creaming and gelling, not microbes; the handbook's examples are 3 months for local sale and 9 months for export ([Long-life milk](https://dairyprocessinghandbook.tetrapak.com/chapter/long-life-milk)).
- **3D:** pallet racks, forklifts or AGVs on floor paths, loading dock, truck that leaves when full.
- **Simulate:** stock by batch and best-before date, first-expired-first-out picking, random daily orders, truck dispatch, order fill rate.

> **Review note:** "random daily orders" need a rate and an order size, and a full truck of 33 pallets would be far over the weight limit. See [R2](REVIEW.md#r2-missing-defaults) and [R3](REVIEW.md#r3-truck-payload).

---

← [3. Stage research 1–5](03-stages-1-5-liquid-line.md) · [5. Plant layout & 3D assets](05-layout-and-3d-assets.md) →
