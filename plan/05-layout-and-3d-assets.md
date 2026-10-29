[Index](README.md) · Part 5 of 11 · [Review](REVIEW.md)

# Plant layout & 3D asset list

Lay the plant out as one U-shaped flow through seven zones, block everything out with simple shapes first, and spend real modelling time only on four hero machines: separator, homogenizer, filler and palletizer.

![Floor plan, top view, not to scale. Top row, left to right (milk flow): Silo yard & mixing (stage 1), UHT process hall (stages 2–5), Aseptic tank (stage 6), Filling hall (stage 7). Bottom row, right to left (pallet flow): Packaging hall (stage 8), Quarantine & QA lab (stage 9), Warehouse & dispatch (stage 10). Raw milk tankers arrive at the silo yard; pallets leave by truck from the warehouse.](images/floor-plan.png)

*floor plan sketch · 7 zones, not to scale*

The U shape lets the guided tour follow the product in one loop and keeps quarantine right next to the warehouse.

## Zones as text

*Transcribed from the sketch above. The preview uses the same seven zones.*

| Row (direction of flow) | Zone | Stage | Contents |
|---|---|---|---|
| Top, left to right (milk) | Silo yard & mixing | 1 | silos, separator, mixing tank; raw milk tankers arrive |
| Top | UHT process hall | 2–5 | heaters, deaerator, homogenizer, UHT, flash vessel |
| Top | Aseptic tank | 6 | sterile buffer |
| Top | Filling hall | 7 | two aseptic fillers |
| Bottom, right to left (pallets) | Packaging hall | 8 | trays, shrink film, palletizer, wrapper |
| Bottom | Quarantine & QA lab | 9 | pallets on hold, incubators for samples |
| Bottom | Warehouse & dispatch | 10 | racks, forklifts, loading docks; pallets leave by truck |

## 3D asset list

| Asset | Stage | Build with | Animation | Priority |
|---|---|---|---|---|
| Raw-milk silos (2) | 1 | Code: cylinders | Level rises and falls | Must |
| Separator | 1 | Blender (hero) | Bowl spins | Must |
| Mixing tank with agitator | 1 | Code: cylinder + shaft | Agitator turns, level | Must |
| Standardization skid | 1 | Code: pipes, small boxes | Valve opening % | Should |
| Balance tank, pumps | 2 | Code | Impellers spin | Should |
| Plate heat exchanger | 2 | Code: instanced plates | Glows by temperature | Must |
| Deaerator with condenser | 2 | Code: cylinders | Bubbles rise | Must |
| Homogenizer | 3 | Blender (hero) | Three pistons pump | Must |
| Steam injector, holding tube | 4 | Code: `TubeGeometry` helix | Heat colour, steam puffs | Must |
| Flow-diversion valve, reject tank | 4 | Code | Valve flips, red light | Must |
| Flash vessel, tubular cooler | 5 | Code | Vapour plume | Must |
| Aseptic tank | 6 | Code: cylinder on three legs | Level and pressure | Must |
| Aseptic fillers (2) | 7 | Blender (hero) | Reel turns, jaws seal, packs exit | Must |
| 1 L carton, tray, pallet | 7–10 | Code: boxes + generic texture | `InstancedMesh` movement | Must |
| Conveyors, accumulation table | 7–8 | [Kenney Factory Kit](https://kenney.nl/assets/factory-kit) (CC0), successor of the [Conveyor Kit](https://kenney-assets.itch.io/conveyor-kit); see [D12](DECISIONS.md#d12-conveyor-models) | Belt texture scrolls | Must |
| Tray-shrink tunnel | 8 | Code: box tunnel | Trays pass through | Should |
| Palletizer robot | 8 | Blender (hero) | Pick-and-place loop | Should |
| Stretch wrapper | 8 | Code: turntable + mast | Turntable rotates | Could |
| Quarantine zone, QA lab | 9 | Floor decals, boxes | Status lamps | Must |
| Racks, forklifts, trucks | 10 | Instanced racks, CC0 models | Path following | Should |
| Pipes | All | `TubeGeometry` along curves | Flowing texture, temperature colour | Must |
| Boiler house, CIP station | 4 | Code: boxes | Status light; the CIP station lights the lamp of the fluid it pumps (phase 7); the boiler house's label reads the steam it raises and its chimney's plume follows the gas (phase 8) | Could |

Keep cartons and trays brand-free: a plain white brick with an invented logo. Export Blender models as GLB and load them with [GLTFLoader](https://threejs.org/docs/GLTFLoader.html).

---

← [4. Stage research 6–10](04-stages-6-10-tank-to-truck.md) · [6. Simulation model](06-simulation-model.md) →
