[Index](README.md) · Part 10 of 11 · [Review](REVIEW.md)

# Risks & simplifications

The biggest risk is scope: ten stages plus detailed 3D is a lot for one person, so every stage gets a working grey-box version before any one stage gets polish.

| Risk | Effect | Mitigation |
|---|---|---|
| Scope too big for one person | Stages unfinished at the deadline | Grey-box all ten stages by week 3; Must/Should/Could priorities; scope freeze at week 9 |
| Too many objects on screen | Frame rate drops with thousands of packs and pallets | `InstancedMesh`, merged static meshes, visual tokens instead of one mesh per pack |
| Time scales from 4 seconds to 6 months | Viewers miss what happens | Speed presets, jump to next event, event log |
| Stage order mixes plant types | A reviewer questions where the homogenizer sits | Keep the course order and explain it in an "About this model" panel |
| 3D modelling eats the schedule | Simulation logic slips | Only four hero models; primitives and CC0 kits for the rest |
| Wrong numbers in formulas | Misleading KPIs | Unit tests against hand calculations, such as F0 ≈ 5.2 min at 140 °C for 4 s |

> **Review note:** the plant-type mix also covers the 50% throttle at high tank level, not only where the homogenizer sits. See [R5](REVIEW.md#r5-plant-type-mix).

## Accepted simplifications

- Milk moves as plug flow, with no pressure drop, viscosity effects or fouling.
- Temperatures change in steps with a short lag, not through heat-transfer equations.
- One product and one pack size.
- Cleaning is a timed machine state, not liquid moving through the pipes.
- Failures follow simple random rates, not real plant data.
- A full CIP runs only after a divert; real plants also clean at the end of each production run ([D2](DECISIONS.md#d2-missing-defaults)).
- Demand is a truck of 22 pallets at a fixed interval, standing in for random daily orders ([D2](DECISIONS.md#d2-missing-defaults), [D3](DECISIONS.md#d3-truck-payload)).

---

← [9. Development roadmap](09-development-roadmap.md) · [11. Sources](11-sources.md) →
