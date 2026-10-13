// Camera moves to a stage's stop (layout.ts STAGE_VIEWS, the preview's FOCUS and CAMOFF) and the
// pulsing ring that marks the selected stage on the floor (preview RING_R).
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StageId } from '../contracts';
import { STAGE_VIEWS } from './layout';
import { readSceneColor } from './theme';

/** Length of a fly-to (the preview's 1.25 s, rounded). */
const FLY_S = 1.2;
/** The ring is drawn just above the zone slabs and their outlines. */
const RING_Y_M = 0.08;
/** Ring band: inner edge at this fraction of the radius, outer edge at the radius. */
const RING_INNER_FRAC = 0.9;
const RING_SEGMENTS = 72;
/** Opacity pulse: mean, swing and angular speed (preview: 0.35 + 0.25 sin(3t)). */
const RING_OPACITY = 0.35;
const RING_PULSE = 0.25;
const RING_PULSE_RAD_PER_S = 3;

export interface CameraFlight {
  /** Flies to the stage's stop (jumps with reduced motion) and rings it; a repeat flies again. */
  flyTo(stage: StageId): void;
  /** Flies back to the whole-plant view and hides the ring; it lands on no stage. */
  flyHome(toPosition: THREE.Vector3, toTarget: THREE.Vector3): void;
  /** Stops a fly where it is, because the viewer took the camera. */
  cancel(): void;
  /** Every frame, before the orbit controls update. */
  update(realDtS: number): void;
  /** The stage the last finished fly landed on; null before the first and while flying. */
  readonly focusStage: StageId | null;
  readonly flying: boolean;
  applyTheme(): void;
  dispose(): void;
}

interface Fly {
  /** null for a fly home to the overview. */
  stage: StageId | null;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsedS: number;
}

/**
 * `host` is #viewport: it carries data-flying="true" while the camera flies and data-focus-stage once a
 * fly has landed (the shared DOM spec), so tests and the HUD can wait for the camera.
 */
export function createCameraFlight(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  host: HTMLElement,
): CameraFlight {
  const ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: RING_OPACITY, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_INNER_FRAC, 1, RING_SEGMENTS), ringMaterial);
  ring.name = 'stage-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let fly: Fly | null = null;
  let focusStage: StageId | null = null;
  let clockS = 0;

  const land = (stage: StageId | null): void => {
    fly = null;
    focusStage = stage;
    delete host.dataset.flying;
    if (stage !== null) host.dataset.focusStage = String(stage);
  };

  const start = (stage: StageId | null, toPosition: THREE.Vector3, toTarget: THREE.Vector3): void => {
    focusStage = null;
    delete host.dataset.focusStage;
    if (reducedMotion.matches) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      controls.update();
      land(stage);
      return;
    }
    fly = {
      stage,
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition,
      toTarget,
      elapsedS: 0,
    };
    host.dataset.flying = 'true';
  };

  const applyTheme = (): void => {
    ringMaterial.color.set(readSceneColor('--accent'));
  };
  applyTheme();

  return {
    flyTo(stage) {
      const view = STAGE_VIEWS[stage];
      const toTarget = new THREE.Vector3(...view.focusM);
      const toPosition = toTarget.clone().add(new THREE.Vector3(...view.cameraOffsetM));
      ring.position.set(view.focusM[0], RING_Y_M, view.focusM[2]);
      ring.scale.set(view.ringRadiusM, view.ringRadiusM, 1);
      ring.visible = true;
      start(stage, toPosition, toTarget);
    },
    flyHome(toPosition, toTarget) {
      ring.visible = false;
      start(null, toPosition.clone(), toTarget.clone());
    },
    cancel() {
      if (!fly) return;
      fly = null;
      delete host.dataset.flying;
    },
    update(realDtS) {
      clockS += realDtS;
      // With reduced motion the ring holds still at its mean opacity, as the camera jumps instead of flying.
      if (ring.visible) {
        ringMaterial.opacity = reducedMotion.matches
          ? RING_OPACITY
          : RING_OPACITY + RING_PULSE * Math.sin(clockS * RING_PULSE_RAD_PER_S + 1);
      }
      if (!fly) return;
      fly.elapsedS += realDtS;
      const k = Math.min(1, fly.elapsedS / FLY_S);
      const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; // ease in and out (cubic)
      // Position and target move together; the orbit controls' update that follows keeps them usable.
      camera.position.lerpVectors(fly.fromPosition, fly.toPosition, eased);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, eased);
      if (k >= 1) land(fly.stage);
    },
    get focusStage() {
      return focusStage;
    },
    get flying() {
      return fly !== null;
    },
    applyTheme,
    dispose() {
      ring.removeFromParent();
      ring.geometry.dispose();
      ringMaterial.dispose();
      delete host.dataset.flying;
      delete host.dataset.focusStage;
    },
  };
}
