import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDebugHook, type DebugSources } from '../../src/scene/debugHook';

// window.__scene's phase 3 additions, which the browser tests read: a machine's live state and the pipes'.

afterEach(() => {
  vi.unstubAllGlobals();
});

function install(overrides: Partial<DebugSources> = {}) {
  vi.stubGlobal('window', {});
  const sources: DebugSources = {
    stageScreenPoint: () => null,
    batchScreenPoint: (batchId) => (batchId === 53 ? { x: 400, y: 300 } : null),
    focusStage: () => null,
    cameraTargetM: () => [0, 0, 0],
    cameraPositionM: () => [0, 0, 0],
    info: () => ({ calls: 0, triangles: 0 }),
    equipmentIds: () => ['divert-valve'],
    equipmentState: (id) => (id === 'divert-valve' ? { diverting: true, lamp: 'bad', flagRad: -1.5 } : null),
    pipeState: () => ({ divertLit: true, phaseM: { silo: 0.25 }, cleaning: null, cleanPhaseM: 0 }),
    ...overrides,
  };
  const hook = installDebugHook(sources);
  const scene = window.__scene;
  if (!scene) throw new Error('no window.__scene');
  return { hook, scene };
}

describe('the ?debug hook', () => {
  it('reports a machine’s state by id, and null for an unknown one', () => {
    const { scene } = install();
    expect(scene.equipmentState('divert-valve')).toEqual({ diverting: true, lamp: 'bad', flagRad: -1.5 });
    expect(scene.equipmentState('no-such-machine')).toBeNull();
  });

  it('reports where a quarantine batch can be clicked, and null for a batch with no block on screen', () => {
    const { scene } = install();
    expect(scene.batchScreenPoint(53)).toEqual({ x: 400, y: 300 });
    expect(scene.batchScreenPoint(12)).toBeNull();
    expect(scene.batchScreenPoint(Number.NaN)).toBeNull();
  });

  it('reports the pipes’ state', () => {
    const { scene } = install();
    expect(scene.pipeState()).toEqual({ divertLit: true, phaseM: { silo: 0.25 }, cleaning: null, cleanPhaseM: 0 });
  });

  it('hands out copies, so a caller can’t change what the scene holds', () => {
    const held = { fillFrac: 0.5 };
    const phaseM = { silo: 0.1 };
    const { scene } = install({ equipmentState: () => held, pipeState: () => ({ divertLit: false, phaseM, cleaning: 'lye', cleanPhaseM: 0.3 }) });
    (scene.equipmentState('x') as Record<string, unknown>).fillFrac = 1;
    scene.pipeState().phaseM.silo = 9;
    expect(held.fillFrac).toBe(0.5);
    expect(phaseM.silo).toBe(0.1);
  });

  it('removes itself on dispose', () => {
    const { hook } = install();
    hook.dispose();
    expect(window.__scene).toBeUndefined();
  });
});
