import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewBus, msToS, type World } from '../../src/contracts';
import { createWorld } from '../../src/scene/world';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubMatchMedia } from './browserStubs';

// world.ts's update (plan 07, "Every frame"): the camera's flight and the orbit controls step by main.ts's
// frame time, which counts no frame as longer than plant.json's maxFrameS, while the machine labels refresh
// their values and lamps 4 times a second of real time, as the HUD does. Without WebGL or a DOM: the
// renderers and the parts world.ts puts together are stubbed, and its frames are driven by hand.

const mocks = vi.hoisted(() => ({
  flight: { update: vi.fn(), flyTo: vi.fn(), flyHome: vi.fn(), cancel: vi.fn(), applyTheme: vi.fn(), dispose: vi.fn(), focusStage: null },
  controlsUpdate: vi.fn(),
  labels: { refresh: vi.fn(), updateDetail: vi.fn(), select: vi.fn(), dispose: vi.fn() },
}));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    shadowMap = { enabled: false, type: three.PCFShadowMap };
    outputColorSpace = '';
    info = { render: { calls: 0, triangles: 0 } };
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer: FakeRenderer };
});
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return {
    OrbitControls: class {
      target = new Vector3();
      cursor = new Vector3();
      update = mocks.controlsUpdate;
      dispose(): void {}
    },
  };
});
vi.mock('three/addons/renderers/CSS2DRenderer.js', () => ({
  CSS2DRenderer: class {
    domElement = { className: '', remove(): void {} };
    setSize(): void {}
    render(): void {}
  },
}));
vi.mock('../../src/scene/cameraFlight', () => ({ createCameraFlight: () => mocks.flight }));
vi.mock('../../src/scene/equipmentLabels', () => ({ createEquipmentLabels: () => mocks.labels }));
vi.mock('../../src/scene/equipmentHost', () => ({
  createEquipmentHost: () => ({ equipment: [], materials: { steel: {} }, update() {}, applyTheme() {}, dispose() {} }),
}));
vi.mock('../../src/scene/pipes', () => ({ createPipes: () => ({ pickTargets: [], update() {}, applyTheme() {}, dispose() {} }) }));
vi.mock('../../src/scene/zones', () => ({ createZones: () => ({ updateLabels() {}, applyTheme() {}, dispose() {} }) }));
vi.mock('../../src/scene/picking', () => ({ createPicker: () => ({ update() {}, dispose() {}, stageScreenPoint: () => null }) }));
vi.mock('../../src/scene/theme', () => ({ readSceneColor: () => '#ffffff', watchTheme: () => () => {} }));
vi.mock('../../src/scene/debugHook', () => ({ debugRequested: () => false, installDebugHook: vi.fn() }));

const MAX_FRAME_S = plantConfig.clock.maxFrameS;
const snapshot = createSim(plantConfig).snapshot();

let nowMs = 1_000;
let world: World;

beforeEach(() => {
  nowMs = 1_000;
  vi.clearAllMocks();
  stubMatchMedia();
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}), style: {}, remove() {} }) });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  // #viewport: the canvas and the label layer go in it.
  world = createWorld({ append() {}, dataset: {} } as unknown as HTMLElement, createViewBus());
  mocks.controlsUpdate.mockClear(); // the overview's fit at the start
});

afterEach(() => {
  world.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Runs `count` frames, `frameMs` apart, each stepped as main.ts steps it: by at most maxFrameS. */
function runFrames(count: number, frameMs: number): void {
  for (let i = 0; i < count; i++) {
    nowMs += frameMs;
    world.update(snapshot, Math.min(msToS(frameMs), MAX_FRAME_S));
  }
}

describe('the 3D view’s update', () => {
  it('at 60 fps, refreshes the machine labels 4 times a second', () => {
    runFrames(60, 1_000 / 60);
    // The first update refreshes them at once, then every quarter of a second.
    expect(mocks.labels.refresh.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.labels.refresh.mock.calls.length).toBeLessThanOrEqual(5);
    expect(mocks.labels.refresh).toHaveBeenCalledWith(snapshot);
  });

  it('with slow frames, steps the camera by at most maxFrameS but refreshes the labels on real time', () => {
    // About 3 frames a second, as software GL on a busy machine gives: every frame is over a refresh interval.
    runFrames(9, 300);
    expect(mocks.flight.update.mock.calls).toEqual(Array(9).fill([MAX_FRAME_S]));
    expect(mocks.controlsUpdate.mock.calls).toEqual(Array(9).fill([MAX_FRAME_S]));
    expect(mocks.labels.refresh, 'one label refresh per frame, as the HUD updates').toHaveBeenCalledTimes(9);
  });
});
