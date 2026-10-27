// Moving tokens on the belts (phase 4): a sample of the packs, not every pack (plan 06: at ×10,000 the plant
// makes about 40 packs a real millisecond, so the counts are shown as numbers). Each line carries tokens a
// pitch apart; the belt moves them on at a steady speed, the machine at the end takes the token that reaches
// it, and a new one comes on at the start only while the machine feeding the line runs. So a line whose
// filler stops empties from its start, and fills again from its start when the filler runs again.
import * as THREE from 'three';
import type { PointM } from '../../layout';
import type { SizeM } from './builder';
import { lineLengthM, pointAlong } from './tokens';

/** How fast the tokens ride, before the scene's motion rate (motion.ts): about a carton a second at the 0.58 m pitch. */
export const PACK_BELT_SPEED_MPS = 0.6;
/** Trays ride slower, as on the preview's tray line. */
export const TRAY_BELT_SPEED_MPS = 0.35;

export interface TokenStream {
  /** Places on the line, filled or not. */
  readonly slots: number;
  /** Tokens on the line now. */
  filled(): number;
  /**
   * Moves the tokens `distanceM` along the line. A token that reaches the end leaves the line; a place that
   * comes on at the start carries a token only if `feeding`.
   */
  advance(distanceM: number, feeding: boolean): void;
  /**
   * Writes the tokens into the mesh from instance `first` on, each turned along the line; empty places at zero
   * scale. The mesh sits in a fixture whose origin is `originM`, so the world positions are taken relative to it.
   */
  write(mesh: THREE.InstancedMesh, first: number, sizeM: SizeM, originM: PointM): void;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _scale = new THREE.Vector3();

/**
 * Tokens a pitch apart along `line`, the first `startM` in, standing on a belt whose surface is the line's
 * height; full from the start, as the plant opens running.
 */
export function createTokenStream(line: readonly PointM[], startM: number, pitchM: number, heightM: number): TokenStream {
  const lengthM = lineLengthM(line);
  // With the offset below a pitch, the last place stays short of the line's end.
  const slots = Math.max(0, Math.floor((lengthM - startM) / pitchM));
  const full: boolean[] = Array.from({ length: slots }, () => true);
  const beltYM = line[0]?.[1] ?? 0;
  let offsetM = 0;

  return {
    slots,
    filled: () => full.filter(Boolean).length,
    advance(distanceM, feeding) {
      if (!(distanceM > 0) || slots === 0) return;
      // A frame never moves a token more than a whole line's worth, however long it was.
      offsetM += Math.min(distanceM, slots * pitchM);
      while (offsetM >= pitchM) {
        offsetM -= pitchM;
        full.pop();
        full.unshift(feeding);
      }
    },
    write(mesh, first, sizeM, originM) {
      _scale.set(...sizeM);
      for (let k = 0; k < slots; k++) {
        if (!full[k]) {
          mesh.setMatrixAt(first + k, HIDDEN);
          continue;
        }
        const { xM, zM, headingRad } = pointAlong(line, startM + k * pitchM + offsetM);
        _position.set(xM - originM[0], beltYM + heightM / 2 - originM[1], zM - originM[2]);
        _quaternion.setFromAxisAngle(_up, headingRad);
        mesh.setMatrixAt(first + k, _matrix.compose(_position, _quaternion, _scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
