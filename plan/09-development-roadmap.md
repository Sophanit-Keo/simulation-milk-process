[Index](README.md) · Part 9 of 11 · [Review](REVIEW.md)

# Development roadmap

Build in six phases over 12 weeks: grey-box the whole plant first, make the liquid line work, then the packaging and logistics, and only then spend time on detailed models and polish.

![Gantt chart of the 12-week plan for one developer. Setup in week 1; grey-box plant in weeks 2–3; liquid line (stages 1–6) in weeks 4–6; packs to trucks (stages 7–10) in weeks 7–9; detail and scenarios in weeks 10–11; polish and present in week 12. Review gates: G1 grey-box plant after week 3, G2 scope freeze after week 9, G3 final demo after week 12. The full plant runs end to end by week 9.](images/roadmap-12-weeks.png)

*12-week plan · 6 phases, 3 review gates*

Gate 2 is the safety net: if the run from silo to truck does not work by week 9, cut Could items instead of stretching the schedule.

## Phases and gates as text

*Transcribed from the chart above.*

| Phase | Weeks | Ends with gate |
|---|---|---|
| Setup | 1 | — |
| Grey-box plant | 2–3 | G1 · grey-box plant |
| Liquid line (1–6) | 4–6 | — |
| Packs to trucks (7–10) | 7–9 | G2 · scope freeze |
| Detail & scenarios | 10–11 | — |
| Polish & present | 12 | G3 · final demo |

## Deliverables to tick off

- [ ] Week 1: Vite + three.js project runs; `plant.json` holds the default settings
- [ ] Week 3 (gate 1): grey-box plant with all seven zones, pipes and camera fly-to
- [ ] Week 6: stages 1–6 live (levels, temperatures, F0 and B\*, divert); formula tests pass
- [ ] Week 9 (gate 2): stages 7–10 live (packs, pallets, quarantine, warehouse, trucks); scope frozen
- [ ] Week 11: hero models, six fault scenarios, guided tour
- [ ] Week 12 (gate 3): 60 fps check, demo video, report and presentation

If the term runs past 12 weeks, the stretch list is: animated CIP cleaning, a steam and energy model, a switch between direct and indirect UHT, and a mobile layout.

The [agent plan](agent-plan/README.md) breaks each phase down into tasks for seven agents working in parallel, with hand-offs and an exit checklist per phase.

> **Review note:** settle the batch definition, the missing defaults and the truck load before writing `plant.json` in week 1. See [Decide before week 1](REVIEW.md#decide-before-week-1).

---

← [8. User interface](08-user-interface.md) · [10. Risks & simplifications](10-risks-and-simplifications.md) →
