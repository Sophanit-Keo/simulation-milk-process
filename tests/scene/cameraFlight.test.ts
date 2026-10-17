import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAGE_IDS, type StageId } from '../../src/contracts';
import { createCameraFlight, type CameraFlight } from '../../src/scene/cameraFlight';
import { OVERVIEW, STAGE_VIEWS, type PointM } from '../../src/scene/layout';
import { stubMatchMedia, stubTheme } from './browserStubs';

// Where the camera flies (cameraFlight.ts): each stage's stop in layout.ts's STAGE_VIEWS, and home to the
// overview. Without WebGL or a DOM: the flight moves a camera and orbit controls, which work in Node.

/** cameraFlight.ts's FLY_S: a fly lands after this much frame time. */
const FLY_S = 1.2;
/** world.ts steps the flight with the frame time; 30 frames a second here. */
const FRAME_S = 1 / 30;
/** Where the camera starts: the overview, seen from the docks. */
const START_POSITION_M: PointM = [-13, 120, 110];

afterEach(() => {
  vi.unstubAllGlobals();
});

function setUp({ reducedMotion = false } = {}) {
  stubTheme();
  stubMatchMedia((query) => reducedMotion && query === '(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 700);
  camera.position.set(...START_POSITION_M);
  // No element: the controls then only do what world.ts asks of them each frame, update().
  const controls = new OrbitControls(camera);
  controls.target.set(...OVERVIEW.targetM);
  controls.update();
  // #viewport, for the data-flying and data-focus-stage attributes.
  const host = { dataset: {} as DOMStringMap };
  const flight = createCameraFlight(scene, camera, controls, host as HTMLElement);
  const ring = scene.getObjectByName('stage-ring');
  if (!ring) throw new Error('the flight adds no stage-ring');
  return { camera, controls, host, flight, ring };
}

/** Steps frames as world.ts does (the flight, then the controls) until the fly lands; returns the frame time it took. */
function flyUntilLanded(flight: CameraFlight, controls: OrbitControls): number {
  let elapsedS = 0;
  while (flight.flying) {
    flight.update(FRAME_S);
    controls.update(FRAME_S);
    elapsedS += FRAME_S;
    if (elapsedS > 10 * FLY_S) throw new Error('the fly never landed');
  }
  return elapsedS;
}

function expectAt(actual: THREE.Vector3, expected: PointM, what: string): void {
  expect(actual.distanceTo(new THREE.Vector3(...expected)), `${what} is at (${expected.join(', ')}), not (${actual.toArray().join(', ')})`).toBeLessThan(1e-6);
}

const plus = (a: PointM, b: PointM): PointM => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

describe('createCameraFlight', () => {
  it('flies to each stage’s stop: it looks at focusM from focusM + cameraOffsetM, and rings the stage', () => {
    const { camera, controls, host, flight, ring } = setUp();
    // Stage after stage, as the rail's arrow keys go, and each one from the stop before.
    for (const stage of STAGE_IDS) {
      const view = STAGE_VIEWS[stage];
      flight.flyTo(stage);
      expect(flight.flying, `stage ${stage}: flying`).toBe(true);
      expect(host.dataset.flying).toBe('true');
      expect(flight.focusStage, 'no focus stage while flying').toBeNull();
      expect(host.dataset.focusStage).toBeUndefined();

      const tookS = flyUntilLanded(flight, controls);
      expect(tookS, `stage ${stage}: the fly takes ${FLY_S} s`).toBeGreaterThanOrEqual(FLY_S - 1e-9);
      expect(tookS).toBeLessThan(FLY_S + FRAME_S + 1e-9);
      expectAt(controls.target, view.focusM, `stage ${stage}: the target`);
      expectAt(camera.position, plus(view.focusM, view.cameraOffsetM), `stage ${stage}: the camera`);
      expect(flight.focusStage).toBe(stage);
      expect(host.dataset.focusStage).toBe(String(stage));
      expect(host.dataset.flying).toBeUndefined();
      expect(ring.visible).toBe(true);
      expect([ring.position.x, ring.position.z]).toEqual([view.focusM[0], view.focusM[2]]);
      expect(ring.scale.x).toBe(view.ringRadiusM);
    }
  });

  it('flies home to the view it is given, lands on no stage and hides the ring', () => {
    const { camera, controls, host, flight, ring } = setUp();
    flight.flyTo(4);
    flyUntilLanded(flight, controls);
    flight.flyHome(new THREE.Vector3(...START_POSITION_M), new THREE.Vector3(...OVERVIEW.targetM));
    expect(flight.flying).toBe(true);
    expect(host.dataset.focusStage, 'the stage is left at once').toBeUndefined();
    flyUntilLanded(flight, controls);
    expectAt(controls.target, OVERVIEW.targetM, 'the target');
    expectAt(camera.position, START_POSITION_M, 'the camera');
    expect(flight.focusStage).toBeNull();
    expect(host.dataset.focusStage).toBeUndefined();
    expect(host.dataset.flying).toBeUndefined();
    expect(ring.visible).toBe(false);
  });

  it('with reduced motion, jumps to the stop at once', () => {
    const { camera, controls, host, flight } = setUp({ reducedMotion: true });
    const stage: StageId = 9;
    const view = STAGE_VIEWS[stage];
    flight.flyTo(stage);
    expect(flight.flying).toBe(false);
    expect(host.dataset.flying).toBeUndefined();
    expectAt(controls.target, view.focusM, 'the target');
    expectAt(camera.position, plus(view.focusM, view.cameraOffsetM), 'the camera');
    expect(flight.focusStage).toBe(stage);
    expect(host.dataset.focusStage).toBe(String(stage));
  });

  it('stops where it is when the viewer takes the camera, landing on no stage', () => {
    const { camera, controls, host, flight } = setUp();
    flight.flyTo(2);
    flight.update(FLY_S / 2);
    controls.update(FLY_S / 2);
    flight.cancel();
    const held = camera.position.clone();
    flight.update(FLY_S);
    expect(camera.position.distanceTo(held)).toBe(0);
    expect(flight.flying).toBe(false);
    expect(flight.focusStage).toBeNull();
    expect(host.dataset.flying).toBeUndefined();
    expect(host.dataset.focusStage).toBeUndefined();
  });
});
