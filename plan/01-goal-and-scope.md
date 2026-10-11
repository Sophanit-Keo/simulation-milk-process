[Index](README.md) · Part 1 of 11 · [Review](REVIEW.md)

# Goal & scope

Build a browser-based 3D simulation in Three.js of a UHT milk plant that runs all 10 stages, from standardization to ambient distribution, with animated equipment and live process data, over a 12-week term.

## What the viewer sees and does

- Follows milk from the raw-milk silo to a delivery truck through one connected 3D plant.
- Reads live values at each stage: temperature, pressure, flow rate, tank level, packs and pallets counted.
- Changes a setting (UHT temperature, filler speed, QA result) and watches the plant react.

## In scope

- One product: whole UHT milk (3.5% fat) in generic 1-litre aseptic brick cartons.
- Simplified physics: mass balance, temperature profile and timing that are believable, not engineering-grade.
- A time-speed control, so a 7-day quarantine and weeks of warehousing pass in minutes.
- Six fault scenarios with visible consequences, listed under [Simulation model](06-simulation-model.md#fault-scenarios).

## Out of scope (stretch goals at most)

- Fluid dynamics (CFD), detailed heat-transfer equations, fouling chemistry.
- Farm collection and raw-milk intake testing; the model starts at the raw-milk silo.
- Cleaning-in-place (CIP) cycles beyond a status light.
- Real brands, VR and mobile layouts.

Assumptions: one developer, desktop browser (Chrome or Edge).

---

← [Index](README.md) · [2. The UHT line at a glance](02-uht-line-at-a-glance.md) →
