import './styles/app.css';
import { checkPlantConfig, createViewBus, parseStages, type Command, type PlantConfig } from './contracts';
import plantJson from './data/plant.json';
import stagesJson from './data/stages.json';
import { createWorld } from './scene/world';
import { createSim } from './sim';
import { createMockSim } from './sim/mock';
import { createHud } from './ui/hud';

/** The HUD and charts update 4 times a second (plan 07). */
const HUD_INTERVAL_S = 0.25;

const config: PlantConfig = plantJson;
const problems = checkPlantConfig(config);
if (problems.length > 0) throw new Error(`src/data/plant.json is not usable:\n${problems.join('\n')}`);
const stages = parseStages(stagesJson);

const appRoot = document.querySelector<HTMLElement>('#app');
const viewport = document.querySelector<HTMLElement>('#viewport');
if (!appRoot || !viewport) throw new Error('index.html must contain #app and #viewport');

// ?mock runs the UI and 3D view on the mock snapshot instead of the model.
const sim = new URLSearchParams(location.search).has('mock') ? createMockSim(config) : createSim(config);

const pending: Command[] = [];
const dispatch = (command: Command): void => {
  pending.push(command);
};
// Rail clicks and 3D clicks both select a stage through this bus, so the panel and the camera agree.
const bus = createViewBus();
const world = createWorld(viewport, bus);
const hud = createHud(appRoot, dispatch, bus, stages);

let lastMs = performance.now();
let sinceHudS = HUD_INTERVAL_S;

// The frame loop from plan 07, "Every frame".
function frame(nowMs: number): void {
  const realDtS = Math.min(Math.max(0, (nowMs - lastMs) / 1000), config.clock.maxFrameS);
  lastMs = nowMs;

  for (const command of pending.splice(0)) sim.dispatch(command); // 1. UI input → commands
  sim.step(realDtS); // 2. continuous steps, then due events
  const snapshot = sim.snapshot(); // 3. one plain-object snapshot
  world.update(snapshot, realDtS); // 4. 3D scene from the snapshot

  sinceHudS += realDtS; // 5. HUD and charts, throttled
  if (sinceHudS >= HUD_INTERVAL_S) {
    hud.update(snapshot);
    sinceHudS = 0;
  }

  world.render(); // 6. render
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
