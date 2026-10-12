# Asset licences

One row for every third-party or own asset in `public/models/` and `public/textures/`, plus kits we checked but haven't committed yet. The rules:

- Prefer CC0. CC-BY is fine if the "About this model" panel credits the author. Never use NC, ND or unclear licences, or anything with a real brand on it.
- Keep each kit's `License.txt` with its zip (outside the repo), and record the source URL and the zip's SHA-256, so the download can be checked again.
- Our own models (Blender sources in `assets/source/`) get a row too, with "own work" as the source.

| Asset | Source URL | Licence | Author | Date added | Where used |
|---|---|---|---|---|---|
| Conveyor Kit 2.0 (`kenney_conveyor-kit.zip`, SHA-256 `5ae214fb473cc5d4aa75828da2a61310c0f88abefbfb1fb6c7da592b18d0ee50`) | <https://kenney-assets.itch.io/conveyor-kit> | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (per `License.txt`) | Kenney ([kenney.nl](https://www.kenney.nl)) | 2026-10-12 (checked, not committed) | Phase 1 load check. Phase 2 may take the `cover-*` tunnel for the tray-shrink tunnel (stage 8) |
| Factory Kit 3.0 (`kenney_factory-kit_3.0.zip`, SHA-256 `7e31fb2308e90304672bd15cd18fa9d9f02c03731a8cbc57a8e3e1c181dfb0a7`) | <https://kenney.nl/assets/factory-kit> | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (per `License.txt`) | Kenney ([kenney.nl](https://www.kenney.nl)) | 2026-10-12 (checked, not committed) | Phase 1 load check. Recommended for phase 2: conveyors, corners, junctions, rollers, scanners, lamps (stages 7–8) |

When phase 2 copies kit pieces into `public/models/kenney/`, change "Date added" to the commit date and list the files under "Where used".
