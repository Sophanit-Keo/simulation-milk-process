[Index](README.md) · Part 8 of 11 · [Review](REVIEW.md)

# User interface & interactions

Use one screen: the 3D plant fills the window, a top bar controls time, a left rail jumps between the 10 stages, a right panel explains the selected machine, and a bottom strip shows the KPIs.

![Wireframe of the main screen. Top bar: day and time, Pause, ×1, ×10, ×100, ×1,000, ×10,000, Next event, Scenarios. Left rail: stages 1–10 with status lamps, all green except 9 Quarantine & QA in amber, with 3 Homogenization selected. Centre: the 3D plant view with pipes coloured cold (blue), warm (yellow) and UHT (red) and a floating label "Homogenizer · 200 bar". Right panel: Homogenizer, stage 3 · piston pump, a two-line description, live values (stage 1 200 bar, stage 2 30 bar, outlet 76 °C), a trend chart and a set-point slider at 200 bar. Bottom strip of KPIs: UHT L/h, F0 and B\*, tank level, packs/h, OEE, on hold, stock, trucks.](images/ui-wireframe.png)

*screen wireframe · homogenizer selected, stage 9 on hold*

The stage rail and the info panel stay in sync: clicking a machine in 3D selects its stage, and clicking a stage flies the camera to it.

## Controls

- Top bar: day and time, pause, speed (×1, ×10, ×100, ×1,000, ×10,000), jump to next event, scenario menu.
- Left rail: stages 1–10, each with a status lamp; a click flies the camera there.
- Right panel: what the machine does (from the stage research), live values, a small trend chart, and sliders for set points that make sense (UHT temperature, filler speed).
- Bottom strip: the KPIs listed under [Simulation model](06-simulation-model.md#kpis-on-screen). The eight cards of the wireframe hold the headline values; the rest sit as a smaller line inside the matching card (for example trays and pallets made under packs per hour).
- In the scene: a floating label with one key value per machine; pipes coloured by temperature with a legend; click a pallet to see its SSCC, batch and status.

## Modes

- Free explore: orbit, pan and zoom; double-click a machine to focus on it.
- Guided tour: the camera visits stages 1–10 in order with a two-line caption each, about 3 minutes in total.
- Scenario: pick a fault, watch the plant react, then read a short log of what happened and why.

## Colour rules

- Pipes: blue for cold milk, through yellow, to red at UHT temperature.
- Lamps: green for running, amber for on hold or warning, red for stopped or blocked.
- The same three lamp colours apply everywhere, including pallets in quarantine.

---

← [7. Tech stack & architecture](07-tech-stack-and-architecture.md) · [9. Development roadmap](09-development-roadmap.md) →
