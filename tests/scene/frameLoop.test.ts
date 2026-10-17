import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plantConfig } from '../helpers/plantConfig';

// src/main.ts's frame loop (plan 07, "Every frame"): the sim and the 3D view step by the frame time, which
// counts no frame as longer than plant.json's maxFrameS, and the HUD updates 4 times a second of real time.
// main.ts runs at import, so it is imported with the 3D view and the HUD stubbed out, and its frames are
// driven by hand.

const mocks = vi.hoisted(() => ({
  world: { update: vi.fn(), render: vi.fn(), dispose: vi.fn() },
  hud: { update: vi.fn() },
}));
vi.mock('../../src/scene/world', () => ({ createWorld: () => mocks.world }));
vi.mock('../../src/ui/hud', () => ({ createHud: () => mocks.hud }));

const MAX_FRAME_S = plantConfig.clock.maxFrameS;
const START_MS = 1_000;

let nowMs = START_MS;
let nextFrame: FrameRequestCallback | null = null;

beforeEach(async () => {
  nowMs = START_MS;
  nextFrame = null;
  mocks.world.update.mockClear();
  mocks.hud.update.mockClear();
  vi.stubGlobal('document', { querySelector: () => ({}) });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.resetModules();
  await import('../../src/main');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Runs `count` frames, `frameMs` apart. */
function runFrames(count: number, frameMs: number): void {
  for (let i = 0; i < count; i++) {
    const frame = nextFrame;
    if (!frame) throw new Error('main.ts asked for no next frame');
    nextFrame = null;
    nowMs += frameMs;
    frame(nowMs);
  }
}

const worldStepsS = (): number[] => mocks.world.update.mock.calls.map(([, realDtS]) => realDtS as number);

describe('the frame loop', () => {
  it('at 60 fps, steps the view by each frame’s time and updates the HUD 4 times a second', () => {
    runFrames(60, 1_000 / 60);
    for (const stepS of worldStepsS()) expect(stepS).toBeCloseTo(1 / 60, 9);
    // The first frame draws the HUD at once, then every quarter of a second.
    expect(mocks.hud.update.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.hud.update.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('with slow frames, steps the view by at most maxFrameS but still updates the HUD on real time', () => {
    // About 3 frames a second, as software GL on a busy machine gives: every frame is over a HUD interval.
    runFrames(9, 300);
    expect(worldStepsS()).toEqual(Array(9).fill(MAX_FRAME_S));
    expect(mocks.hud.update, 'one HUD update per frame').toHaveBeenCalledTimes(9);
  });
});
