[README](../README.md) · [Demo script](demo-script.md) · Video script · [Report](report.md) · [Slides](slides.md)

# Demo video script

About 9 minutes, recorded by the developer from the deployed build ([phase 6](../plan/agent-plan/phase-6-polish-and-present.md)). It follows the [demo script](demo-script.md), whose numbers `tests/sim/demoScript.test.ts` checks, with the narration to read and what the screen shows. Record at 1440 × 900 or 1920 × 1080 in Chrome, at 100% zoom, with the system cursor visible.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:30 | The page loads ("Loading the plant…"), then the whole plant at ×10 | "This is a simulation of one UHT milk plant, from the raw-milk silo to the truck: ten stages, running live in the browser. Every number comes from a cited source or is marked as an assumption." |
| 0:30–1:00 | Point along the plant, then the KPI strip | "Milk comes in on the left and leaves on trucks on the right. Along the bottom: 16,000 litres an hour through the UHT plant, F0 and B\* for sterility, the aseptic tank, packs, OEE, batches on hold, stock and trucks. The plant opens on day 8 with a week of history, so the warehouse already has stock." |
| 1:00–2:30 | **Tour**: stages 1 to 5 (cut the rest in editing, or let it run) | "The guided tour visits each stage with two lines on what happens there. Standardization sets the fat; the milk is preheated and deaerated; the homogenizer breaks up the fat globules; steam heats it to 140 °C for 4 seconds; the flash vessel cools it back to 80." |
| 2:30–3:45 | Scenarios → **Filler breakdown**, then ×100; stage 7, then stage 6 | "A jammed sealing jaw stops filler A for an hour. The aseptic tank keeps taking milk it no longer draws. At 90% the UHT plant drops to half flow so the tank can't overflow, and when the filler is back, it returns to full flow. Line A loses 7,750 packs." |
| 3:45–5:15 | Scenarios → **UHT temperature drop** at ×10, then ×100; stage 4; open "What happened and why" | "Now the steam supply dips. Within three seconds the outlet is under the divert limit, B\* falls below 1, and the valve sends the milk to the reject tank. Milk that might not be sterile never reaches the tank. The line then cleans in place for 80 minutes, water, lye, water, acid and water, each in its own colour, and re-sterilizes for 30: 113 minutes without product, while the fillers drain the tank and stop. The scenario log tells each step and why." |
| 5:15–6:15 | **Homogenizer pressure loss**, then **Sterile-air filter failure**, then **Failed incubation**; stages 3, 6 and 9 | "Three quality faults. The homogenizer loses pressure: at 50 bar the fat globules stay too big, a creaming risk of 84%, and nothing shows yet. The sterile-air filter fails: the batches filling now are held for investigation. And the oldest batch on hold fails its incubation check: all 59 pallets are blocked." |
| 6:15–7:15 | **Demand spike** at ×100; stage 10 | "A large order brings 12 extra trucks, one every five minutes. With three dock doors, trucks queue in the yard, and the stock falls to about one day of cover." |
| 7:15–8:15 | ×10,000 to day 15, 14:00; stage 9 | "A week at ×10,000 takes about a minute. Every day at 14:00 a batch leaves quarantine. On day 15 the two suspect batches finish incubating: one has a spoiled sample, the other a cream layer. Both are blocked, days after the faults that caused them." |
| 8:15–9:00 | Scenario log; About; back to the whole plant | "The scenario log keeps the story of each fault. About explains what the model is and isn't, and lists its sources. The code, the tests and the decision log behind every number are on GitHub." |

## Recording notes

- Rehearse once with the [demo script](demo-script.md); the clock times there are when to click.
- At ×100 and above, wait for the camera to land before narrating a stage.
- If a take goes wrong, reload: the plant opens the same way every time.
