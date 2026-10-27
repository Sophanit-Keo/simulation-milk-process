import './styles/app.css';
import { checkPlantConfig, createViewBus, msToS, parseStages, type Command, type PlantConfig } from './contracts';
import plantJson from './data/plant.json';
import stagesJson from './data/stages.json';
import { createWorld } from './scene/world';
import { createSim } from './sim';
import { createMockSim } from './sim/mock';
import { hideLoading, showStopped } from './ui/appStatus';
import type { DebugPanel } from './ui/debugPanel';
import { createHud } from './ui/hud';

/** The HUD and charts update 4 times a second (plan 07). */
const HUD_INTERVAL_S = 0.25;

function start(): void {
  const config: PlantConfig = plantJson;
  const problems = checkPlantConfig(config);
  if (problems.length > 0) throw new Error(`src/data/plant.json is not usable:\n${problems.join('\n')}`);
  const stages = parseStages(stagesJson);

  const appRoot = document.querySelector<HTMLElement>('#app');
  const viewport = document.querySelector<HTMLElement>('#viewport');
  if (!appRoot || !viewport) throw new Error('index.html must contain #app and #viewport');

  // ?mock runs the UI and 3D view on the mock snapshot instead of the model.
  const params = new URLSearchParams(location.search);
  const sim = params.has('mock') ? createMockSim(config) : createSim(config);

  const pending: Command[] = [];
  const dispatch = (command: Command): void => {
    pending.push(command);
  };
  // Rail clicks and 3D clicks both select a stage through this bus, so the panel and the camera agree.
  const bus = createViewBus();
  // The separator, homogenizer, fillers and palletizer load their hero models over their grey boxes; ?greybox keeps the boxes.
  const world = createWorld(viewport, bus, { heroModels: !params.has('greybox') });
  const hud = createHud(appRoot, dispatch, bus, stages, {
    setpoints: {
      uhtSetpointC: config.uht.setpointC,
      homogenizerStage1Bar: config.homogenizer.stage1Bar,
      fillerRatePacksPerH: config.fillers.ratePacksPerH,
    },
    setpointMax: { fillerRatePacksPerH: config.fillers.maxRatePacksPerH },
  });

  // ?debug adds the lil-gui panel, loaded on demand so neither it nor lil-gui is in the main bundle.
  let debugPanel: DebugPanel | null = null;
  if (params.has('debug')) {
    void import('./ui/debugPanel').then(({ createDebugPanel }) => {
      debugPanel = createDebugPanel(hud.dispatch, hud.sentSetpoints);
    });
  }

  let lastMs = performance.now();
  let sinceHudS = HUD_INTERVAL_S;
  let drawn = false;

  // The frame loop from plan 07, "Every frame".
  function frame(nowMs: number): void {
    try {
      const elapsedS = Math.max(0, msToS(nowMs - lastMs));
      // The sim and the camera count no frame as longer than maxFrameS, so a stall doesn't make the plant jump.
      const realDtS = Math.min(elapsedS, config.clock.maxFrameS);
      lastMs = nowMs;

      for (const command of pending.splice(0)) sim.dispatch(command); // 1. UI input → commands
      sim.step(realDtS); // 2. continuous steps, then due events
      const snapshot = sim.snapshot(); // 3. one plain-object snapshot
      world.update(snapshot, realDtS); // 4. 3D scene from the snapshot

      // 5. HUD and charts, throttled on real time, not the clamped frame time: slow frames don't slow them down.
      sinceHudS += elapsedS;
      if (sinceHudS >= HUD_INTERVAL_S) {
        hud.update(snapshot);
        debugPanel?.update(snapshot);
        sinceHudS = 0;
      }

      world.render(); // 6. render
    } catch (error) {
      // The loop stops where it failed; the view says so, rather than freezing without a word.
      showStopped(error);
      throw error;
    }
    if (!drawn) {
      drawn = true;
      hideLoading();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  start();
} catch (error) {
  showStopped(error);
  throw error; // and the console keeps its stack
}
