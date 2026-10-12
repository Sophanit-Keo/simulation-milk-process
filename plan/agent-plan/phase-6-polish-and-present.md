[Agent plan](README.md) · Phase 6 of 6 · [Roadmap](../09-development-roadmap.md)

# Phase 6 · Polish & present (week 12)

Make the simulation fast, stable and deployed, then produce the demo video, report and presentation.

- **Entry:** the week-11 deliverable is done. From now on, no new features, only fixes.
- **Exit:** **gate G3**: 60 fps check, demo video, report and presentation.
- **Critical path:** `qa` (performance and regression) and `lead` (release and documents).

## Who does what

| Agent | Tasks | Hands off |
|---|---|---|
| `qa` | The 60 fps check on a mid-range laptop: a fixed camera path for 60 s at ×1 and ×10,000, recording the average and the 1% low. A full regression run of unit, scenario and browser tests. A Chrome and Edge check. A bug list ranked by what the demo will show. | Perf report, ranked bug list |
| `scene` | Performance fixes the perf report asks for: merge static meshes, check instancing, keep one shadow-casting light, shrink oversized textures. Visual polish only where the demo camera goes. | Fast scene |
| `ui` | Loading screen, error and empty states, keyboard focus on the rail and top bar, a final copy edit. | Finished screen |
| `sim` | Fixes from the bug list only. Check step time at ×10,000. | Stable model |
| `assets` | Final compression and licence check. No new models. | Final assets |
| `process` | A final check of on-screen numbers against the review's "Checked and correct" table. An in-app list of sources. The technical chapter of the report. The demo script: which scenarios to show, in what order, and the numbers to expect. | Demo script, report chapter |
| `lead` | Tag `v1.0`, deploy to GitHub Pages, and check the link from a clean browser. A README with how to run and test. Put the report and slides together. A demo video script from `process`'s demo script. | Release, report, slides |

**The developer** records the demo video and gives the presentation.

## How they work together

1. **Monday.** Bug bash: every agent runs the demo script, and `qa` ranks the list.
2. **Tuesday–Wednesday.** Fixes in rank order. `lead` merges each one only after `qa` reruns the affected tests.
3. **Thursday.** Code freeze. `lead` tags a release candidate and deploys, `qa` repeats the 60 fps check on that build, and the developer records the video.
4. **Friday.** The developer walks through the G3 checklist, then presents.

## Hand-offs

- `qa` → all: the ranked bug list and the perf report.
- `process` → `lead`: the demo script and the report chapter.
- `lead` → developer: the release link, video script, report and slides.

## Gate G3 checklist

- [ ] The 60 fps check passes on the target laptop.
- [ ] The deployed link works in a clean Chrome and Edge.
- [ ] The full regression run passes.
- [ ] The demo video, report and presentation are done.
- [ ] Every Must item is done, and the status of each Should and Could item is recorded.
- [ ] The developer signs G3.

## Afterwards

If the term runs longer, take the roadmap's stretch list one item per week: animated CIP cleaning, a steam and energy model, a switch between direct and indirect UHT, and a mobile layout. Each one follows the same task loop, so it starts with `process` writing the expected numbers.

---

← [Phase 5. Detail & scenarios](phase-5-detail-and-scenarios.md) · [Agent plan](README.md) →
