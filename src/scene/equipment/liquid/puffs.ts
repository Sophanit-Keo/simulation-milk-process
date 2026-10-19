// Small things that rise and repeat, drawn as one InstancedMesh each: steam puffs at the injector, the
// flash vessel's vapour plume and the bubbles in the deaerator's sight glass. Every copy runs the same
// cycle, spread evenly over it, so the stream looks continuous with a handful of copies.
import * as THREE from 'three';
import type { PointM } from '../../layout';
import { advancePhase } from '../../motion';
import type { MachineBuilder, SizeM } from './builder';
import type { LiquidMaterial } from './kit';

export interface PuffSpec {
  /** Where each copy starts, in world metres. */
  fromM: PointM;
  /** How far a copy travels over one cycle, in metres (mostly up). */
  travelM: SizeM;
  /** A copy's radius at its biggest, in metres. */
  radiusM: number;
  count: number;
  /** One cycle at full strength, in animation seconds. */
  cycleS: number;
  /**
   * 'swell': a puff, which grows from nothing and shrinks again over its cycle, and is smaller in a weaker
   * stream. 'steady': a bubble, the same size all the way, popping back to the start.
   */
  envelope: 'swell' | 'steady';
}

export interface Puffs {
  readonly mesh: THREE.InstancedMesh;
  /**
   * `strengthFrac` (0–1) paces the cycle (never slower than a third of full pace) and sizes the puffs; at 0
   * the stream hides and stands still. `dtS` is animation time (motion.ts), 0 while paused.
   */
  update(strengthFrac: number, dtS: number): void;
  /** The strength last shown, 0–1. */
  strength(): number;
  /** The cycle's phase, 0–1: for tests, to see that the stream moves or stands still. */
  phase(): number;
}

/** A frame advances the cycle by at most this much, so a slow frame doesn't make the copies jump. */
const MAX_PHASE_STEP = 0.2;
/** The slowest pace, as a share of full pace, for a stream that runs at all. */
const MIN_PACE_FRAC = 1 / 3;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _rotation = new THREE.Quaternion();

export function createPuffs(builder: MachineBuilder, name: string, material: LiquidMaterial, spec: PuffSpec): Puffs {
  const fromLocal = builder.local(spec.fromM);
  const travel = new THREE.Vector3(...spec.travelM);
  const copies = Array.from({ length: spec.count }, () => ({ atM: spec.fromM, sizeM: [0, 0, 0] as SizeM }));
  const mesh = builder.instanced(name, 'sphere', material, copies);
  // The copies move, so bounds computed from their first places would cull them wrongly.
  mesh.frustumCulled = false;
  mesh.visible = false;
  let phase = 0;
  let shown = 0;

  return {
    mesh,
    update(strengthFrac, dtS) {
      shown = Number.isFinite(strengthFrac) ? Math.min(Math.max(strengthFrac, 0), 1) : 0;
      mesh.visible = shown > 0;
      if (!mesh.visible) return;
      const pace = MIN_PACE_FRAC + (1 - MIN_PACE_FRAC) * shown;
      phase = advancePhase(phase, (pace * dtS) / spec.cycleS, MAX_PHASE_STEP, 1);
      for (let i = 0; i < spec.count; i++) {
        const t = (phase + i / spec.count) % 1;
        const radiusM = spec.envelope === 'swell' ? spec.radiusM * shown * Math.sin(Math.PI * t) : spec.radiusM;
        _position.copy(fromLocal).addScaledVector(travel, t);
        _scale.set(radiusM, radiusM, radiusM);
        mesh.setMatrixAt(i, _matrix.compose(_position, _rotation, _scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    strength: () => shown,
    phase: () => phase,
  };
}
