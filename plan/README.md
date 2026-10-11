# 3D Milk Industry Simulation — Research & Plan

Oct 10, 2026 · Jojo

Build a browser-based 3D simulation in Three.js of a UHT milk plant that runs all 10 stages, from standardization to ambient distribution, with animated equipment and live process data, over a 12-week term.

## Contents

| # | Section | In one line |
|---|---|---|
| 1 | [Goal & scope](01-goal-and-scope.md) | What the viewer sees and does; what is in and out of scope |
| 2 | [The UHT line at a glance](02-uht-line-at-a-glance.md) | The 10 stages as one line with a single hand-off at the aseptic tank; default temperatures |
| 3 | [Stage research 1–5: the liquid line](03-stages-1-5-liquid-line.md) | Standardization, preheating and deaeration, homogenization, UHT, flash cooling |
| 4 | [Stage research 6–10: from sterile tank to truck](04-stages-6-10-tank-to-truck.md) | Aseptic tank, filling, trays and pallets, quarantine and QA, warehouse and trucks |
| 5 | [Plant layout & 3D asset list](05-layout-and-3d-assets.md) | A U-shaped plant in seven zones; four hero models; asset priorities |
| 6 | [Simulation model](06-simulation-model.md) | Continuous and discrete models, formulas, default settings, KPIs, fault scenarios |
| 7 | [Tech stack & architecture](07-tech-stack-and-architecture.md) | three.js, Vite and TypeScript; folder structure, frame loop, performance budget |
| 8 | [User interface & interactions](08-user-interface.md) | One-screen layout, controls, modes, colour rules |
| 9 | [Development roadmap](09-development-roadmap.md) | Six phases over 12 weeks, three review gates, deliverables |
| 10 | [Risks & simplifications](10-risks-and-simplifications.md) | Main risks and how to handle them; accepted simplifications |
| 11 | [Sources](11-sources.md) | Process, regulation, equipment and tool references |

## Review

[REVIEW.md](REVIEW.md) checks the plan against hand calculations and the preview. Every worked number is right. Before week 1, settle what a batch is, add the defaults the plan doesn't set yet (breakdown rates, cleaning interval, tank limits, demand), and fix the truck load: 33 pallets of milk weigh about 36 t. Sections the review touches carry a short "Review note" with a link.

## Related files

- 3D preview: [UHT Milk Plant Preview](https://claude.ai/artifact/8iJvem1sGHtitmtJDxUpY6), with a local copy at [uht-plant-preview.html](../uht-plant-preview.html)
- Source: `3D Milk Industry Simulation — Research & Plan.docx` in the folder above, converted to Markdown on Oct 11, 2026. The images in [images/](images/) are taken from it.
