// Conveyors from the Kenney Factory Kit (plan 05, D12): a grey-box conveyor stands at once, and the kit
// pieces replace it when they load; if a piece fails to load the grey box stays. Repeated pieces are
// instanced and share one material, so the kit's palette texture reaches the GPU once (assets/README.md,
// "Texture copies").
import * as THREE from 'three';
import type { EquipmentContext } from '../types';
import type { BuiltFixture, FixtureBuilder, InstanceM } from './builder';
import type { FloorPointM } from './layout';

export type KitPiece =
  | 'conveyor-long-sides-part-end'
  | 'conveyor-long-sides-part-middle'
  | 'conveyor-corner'
  | 'conveyor-sides'
  | 'conveyor-bars'
  | 'conveyor-bars-high';

/**
 * Each piece's length along its flow axis (x) and the height of the surface packs ride on, measured
 * from the files: the belts' top at x = z = 0, the rollers' crest. The kit is toy scale (1.0 m wide,
 * 0.4 m high), so each piece is scaled to the layout: length to fit the run, width to the line, and
 * height so every surface meets the line's belt height.
 */
const PIECES: Record<KitPiece, { lengthM: number; topM: number }> = {
  'conveyor-long-sides-part-end': { lengthM: 0.5, topM: 0.4 },
  'conveyor-long-sides-part-middle': { lengthM: 0.5, topM: 0.4 },
  'conveyor-corner': { lengthM: 1, topM: 0.34 },
  'conveyor-sides': { lengthM: 1, topM: 0.4 },
  'conveyor-bars': { lengthM: 1, topM: 0.25 },
  'conveyor-bars-high': { lengthM: 1, topM: 0.35 },
};

/** The kit's corner is a quarter disc pivoting on its (-x, +z) corner: the belt enters and leaves through those two faces. */
const CORNER_OPENINGS: readonly Dir[] = [
  [-1, 0],
  [0, 1],
];

/** A unit direction on the floor, axis-aligned: [dx, dz]. */
type Dir = readonly [dx: number, dz: number];

/** A straight stretch of belt between its two ends (corner tiles excluded). */
export interface Run {
  fromM: FloorPointM;
  toM: FloorPointM;
  dir: Dir;
  /** True where the path itself starts or ends, so the belt shows an end there. */
  startsPath: boolean;
  endsPath: boolean;
}

/** A square tile where the path turns by 90°. */
export interface Turn {
  atM: FloorPointM;
  inDir: Dir;
  outDir: Dir;
}

/** A kit piece and where it goes, in world metres. */
export interface Placement {
  piece: KitPiece;
  matrix: THREE.Matrix4;
}

/**
 * Splits centre-line paths into straight runs and corner tiles of the belt's width. Paths turn by 90°
 * only, as on the preview's floor plan.
 */
export function layoutPaths(paths: readonly (readonly FloorPointM[])[], widthM: number): { runs: Run[]; turns: Turn[] } {
  const runs: Run[] = [];
  const turns: Turn[] = [];
  for (const path of paths) {
    const dirs = path.slice(1).map((point, i) => direction(path[i] as FloorPointM, point));
    dirs.forEach((dir, i) => {
      const a = path[i] as FloorPointM;
      const b = path[i + 1] as FloorPointM;
      const startsPath = i === 0;
      const endsPath = i === dirs.length - 1;
      // Inner points are corner tiles: the runs stop half a belt width short of them.
      const trimStartM = startsPath ? 0 : widthM / 2;
      const trimEndM = endsPath ? 0 : widthM / 2;
      runs.push({
        fromM: [a[0] + dir[0] * trimStartM, a[1] + dir[1] * trimStartM],
        toM: [b[0] - dir[0] * trimEndM, b[1] - dir[1] * trimEndM],
        dir,
        startsPath,
        endsPath,
      });
      if (!endsPath) {
        const outDir = dirs[i + 1] as Dir;
        if (dir[0] * outDir[0] + dir[1] * outDir[1] !== 0) throw new Error(`conveyor path turns by other than 90° at ${b.join(', ')}`);
        turns.push({ atM: b, inDir: dir, outDir });
      }
    });
  }
  return { runs, turns };
}

function direction(a: FloorPointM, b: FloorPointM): Dir {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  if ((dx !== 0) === (dz !== 0)) throw new Error(`conveyor path must run along x or z: ${a.join(', ')} → ${b.join(', ')}`);
  return [Math.sign(dx), Math.sign(dz)];
}

const lengthOf = (run: Run): number => Math.abs(run.toM[0] - run.fromM[0]) + Math.abs(run.toM[1] - run.fromM[1]);

/** Rotation about y that turns +x toward `dir` (three.js turns +x toward -z for a positive angle). */
const headingRad = (dir: Dir): number => Math.atan2(-dir[1], dir[0]);

/** Turns a floor direction about y by `rad`, rounding to the axis it lands on. */
function turned(dir: Dir, rad: number): Dir {
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return [dir[0] * cos + dir[1] * sin, -dir[0] * sin + dir[1] * cos];
}

/** The quarter turn that points the corner piece's two openings back along `inDir` and on along `outDir`. */
function cornerRad(turn: Turn): number {
  const wanted = [`${-turn.inDir[0]},${-turn.inDir[1]}`, `${turn.outDir[0]},${turn.outDir[1]}`].sort().join('|');
  for (const rad of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const openings = CORNER_OPENINGS.map((dir) => turned(dir, rad).map((v) => v + 0).join(',')).sort().join('|');
    if (openings === wanted) return rad;
  }
  throw new Error('no quarter turn fits the corner'); // unreachable for 90° turns
}

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function placement(piece: KitPiece, atM: FloorPointM, rad: number, lengthM: number, topM: number, widthM: number): Placement {
  const spec = PIECES[piece];
  _position.set(atM[0], 0, atM[1]);
  _quaternion.setFromAxisAngle(_up, rad);
  _scale.set(lengthM / spec.lengthM, topM / spec.topM, widthM);
  return { piece, matrix: new THREE.Matrix4().compose(_position, _quaternion, _scale) };
}

/** Cuts a run into `piece`-length steps (stretched to fit) and calls `each` with each step's centre. */
function steps(run: Run, pieceLengthM: number, each: (centreM: FloorPointM, stepM: number, index: number, count: number) => void): void {
  const runM = lengthOf(run);
  const count = Math.max(1, Math.round(runM / pieceLengthM));
  const stepM = runM / count;
  for (let k = 0; k < count; k++) {
    const alongM = (k + 0.5) * stepM;
    each([run.fromM[0] + run.dir[0] * alongM, run.fromM[1] + run.dir[1] * alongM], stepM, k, count);
  }
}

export interface BeltPieces {
  end: KitPiece;
  middle: KitPiece;
  corner: KitPiece;
}

/** Kit pieces for belt conveyors: an end piece where a path starts or stops, middles between, corners at turns. */
export function beltPlacements(paths: readonly (readonly FloorPointM[])[], widthM: number, topM: number, pieces: BeltPieces): Placement[] {
  const { runs, turns } = layoutPaths(paths, widthM);
  const out: Placement[] = [];
  for (const run of runs) {
    const rad = headingRad(run.dir);
    steps(run, PIECES[pieces.middle].lengthM, (centreM, stepM, k, count) => {
      const isStart = k === 0 && run.startsPath;
      const isEnd = k === count - 1 && run.endsPath;
      // The end piece's rounded end points along +x; at the start of a path it is turned to face back.
      const flip = isStart && !isEnd;
      out.push(placement(isStart || isEnd ? pieces.end : pieces.middle, centreM, rad + (flip ? Math.PI : 0), stepM, topM, widthM));
    });
  }
  for (const turn of turns) out.push(placement(pieces.corner, turn.atM, cornerRad(turn), widthM, topM, widthM));
  return out;
}

/**
 * One kit piece per `stepM` along each run (the piece's own length unless given), stretched to fit:
 * roller conveyors, and the accumulation table's wide belt. At a turn the belt's quarter-disc corner
 * piece takes over, since a square of rollers would leave a side rail across the way in or out.
 */
export function repeatPlacements(
  paths: readonly (readonly FloorPointM[])[],
  widthM: number,
  topM: number,
  piece: KitPiece,
  options: { stepM?: number; corner?: KitPiece } = {},
): Placement[] {
  const { runs, turns } = layoutPaths(paths, widthM);
  const out: Placement[] = [];
  for (const run of runs) {
    steps(run, options.stepM ?? PIECES[piece].lengthM, (centreM, stepM) => out.push(placement(piece, centreM, headingRad(run.dir), stepM, topM, widthM)));
  }
  const corner = options.corner ?? 'conveyor-corner';
  for (const turn of turns) out.push(placement(corner, turn.atM, cornerRad(turn), widthM, topM, widthM));
  return out;
}

/* grey boxes, shown until the kit loads (or for good if it can't) */

const LEG_SPACING_M = 2.4;
const LEG_SIZE_M = 0.06;
const RAIL_WIDTH_M = 0.05;

/** Leg pairs along a run, every few metres and near both ends. */
function legs(b: FixtureBuilder, layer: THREE.Object3D, run: Run, widthM: number, heightM: number): void {
  const runM = lengthOf(run);
  const pairs = Math.max(2, Math.ceil(runM / LEG_SPACING_M) + 1);
  const insetM = Math.min(0.2, runM / 4);
  const across: Dir = [-run.dir[1], run.dir[0]];
  for (let k = 0; k < pairs; k++) {
    const alongM = insetM + ((runM - 2 * insetM) * k) / (pairs - 1);
    for (const side of [-1, 1]) {
      const offM = side * (widthM / 2 - 0.1);
      const atX = run.fromM[0] + run.dir[0] * alongM + across[0] * offM;
      const atZ = run.fromM[1] + run.dir[1] * alongM + across[1] * offM;
      b.part('box', 'steelDark', [atX, heightM / 2, atZ], [LEG_SIZE_M, heightM, LEG_SIZE_M], { parent: layer });
    }
  }
}

/** The preview's conveyor: a dark belt between two low rails, on legs. */
export function greyBelt(b: FixtureBuilder, layer: THREE.Object3D, paths: readonly (readonly FloorPointM[])[], widthM: number, topM: number): void {
  const { runs, turns } = layoutPaths(paths, widthM);
  const beltM = 0.1;
  for (const run of runs) {
    const runM = lengthOf(run);
    const rotationRad = [0, headingRad(run.dir), 0] as const;
    const midX = (run.fromM[0] + run.toM[0]) / 2;
    const midZ = (run.fromM[1] + run.toM[1]) / 2;
    b.part('box', 'rubber', [midX, topM - beltM / 2, midZ], [runM, beltM, widthM - 2 * RAIL_WIDTH_M], { parent: layer, rotationRad, castShadow: true });
    for (const side of [-1, 1]) {
      const offM = side * (widthM / 2 - RAIL_WIDTH_M / 2);
      b.part('box', 'steelDark', [midX - run.dir[1] * offM, topM, midZ + run.dir[0] * offM], [runM, 0.14, RAIL_WIDTH_M], { parent: layer, rotationRad });
    }
    legs(b, layer, run, widthM, topM - beltM);
  }
  for (const turn of turns) {
    b.part('box', 'rubber', [turn.atM[0], topM - beltM / 2, turn.atM[1]], [widthM, beltM, widthM], { parent: layer, castShadow: true });
    // Rails on the two closed sides: straight on, and opposite the way out.
    for (const side of [turn.inDir, [-turn.outDir[0], -turn.outDir[1]] as Dir]) {
      const offM = widthM / 2 - RAIL_WIDTH_M / 2;
      b.part('box', 'steelDark', [turn.atM[0] + side[0] * offM, topM, turn.atM[1] + side[1] * offM], [widthM, 0.14, RAIL_WIDTH_M], {
        parent: layer,
        rotationRad: [0, headingRad([-side[1], side[0]]), 0],
      });
    }
  }
}

/**
 * Rollers between two side rails, on legs when they stand high, and a flat plate at each turn. The rollers
 * are one instanced draw.
 */
export function greyRollers(
  b: FixtureBuilder,
  layer: THREE.Object3D,
  paths: readonly (readonly FloorPointM[])[],
  widthM: number,
  topM: number,
  rollerRadiusM: number,
): THREE.InstancedMesh {
  const { runs, turns } = layoutPaths(paths, widthM);
  const pitchM = rollerRadiusM * 4;
  const rollers: InstanceM[] = [];
  const rollerAt = (atM: FloorPointM, dir: Dir): void => {
    // A unit cylinder stands along y; lay it across the way the load travels.
    const rotationRad = dir[0] !== 0 ? ([Math.PI / 2, 0, 0] as const) : ([0, 0, Math.PI / 2] as const);
    rollers.push({ atM: [atM[0], topM - rollerRadiusM, atM[1]], sizeM: [rollerRadiusM, widthM - 2 * RAIL_WIDTH_M, rollerRadiusM], rotationRad });
  };
  for (const run of runs) {
    const runM = lengthOf(run);
    // Evenly spread, half a pitch in from each end, so the rollers of one run meet the next without a gap.
    const count = Math.max(1, Math.round(runM / pitchM));
    for (let k = 0; k < count; k++) {
      const alongM = ((k + 0.5) * runM) / count;
      rollerAt([run.fromM[0] + run.dir[0] * alongM, run.fromM[1] + run.dir[1] * alongM], run.dir);
    }
    const midX = (run.fromM[0] + run.toM[0]) / 2;
    const midZ = (run.fromM[1] + run.toM[1]) / 2;
    for (const side of [-1, 1]) {
      const offM = side * (widthM / 2 - RAIL_WIDTH_M / 2);
      b.part('box', 'steelDark', [midX - run.dir[1] * offM, topM - 0.02, midZ + run.dir[0] * offM], [runM, 0.14, RAIL_WIDTH_M], {
        parent: layer,
        rotationRad: [0, headingRad(run.dir), 0],
        castShadow: true,
      });
    }
    if (topM > 0.4) legs(b, layer, run, widthM, topM - 0.09);
  }
  // A turn is a flat belt plate, as the kit's curved belt corner stands in for a roller turn.
  for (const turn of turns) {
    b.part('box', 'rubber', [turn.atM[0], topM - 0.05, turn.atM[1]], [widthM, 0.1, widthM], { parent: layer, castShadow: true });
    if (topM > 0.4) b.part('box', 'steelDark', [turn.atM[0], (topM - 0.1) / 2, turn.atM[1]], [LEG_SIZE_M, topM - 0.1, LEG_SIZE_M], { parent: layer });
  }
  return b.instanced('rollers', 'cylLo', 'steel', rollers, { parent: layer });
}

/* loading the kit */

interface LoadedPiece {
  geometry: THREE.BufferGeometry;
  /** The piece's mesh node within its file. */
  nodeMatrix: THREE.Matrix4;
}

export interface KitLoader {
  load(piece: KitPiece): Promise<LoadedPiece>;
  /** The one material every kit piece draws with; null until a piece has loaded. */
  material(): THREE.Material | null;
}

/**
 * Loads kit pieces through the host's cached loader. Every piece's file carries its own copy of the
 * palette material and texture; the pieces all draw with the first one, so the others never reach the GPU.
 * The geometry and material belong to the host's model cache: this module never disposes them.
 */
export function createKitLoader(ctx: EquipmentContext): KitLoader {
  const loads = new Map<KitPiece, Promise<LoadedPiece>>();
  let shared: THREE.Material | null = null;
  return {
    load(piece) {
      let load = loads.get(piece);
      if (!load) {
        load = ctx.loadModel(`kenney/${piece}.glb`).then((model) => {
          let mesh: THREE.Mesh | undefined;
          model.traverse((child) => {
            if (!mesh && child instanceof THREE.Mesh) mesh = child;
          });
          if (!mesh) throw new Error(`kenney/${piece}.glb has no mesh`);
          const material = mesh.material;
          if (Array.isArray(material)) throw new Error(`kenney/${piece}.glb has more than one material`);
          shared ??= material;
          model.updateMatrixWorld(true);
          const rootInverse = model.matrixWorld.clone().invert();
          return { geometry: mesh.geometry, nodeMatrix: rootInverse.multiply(mesh.matrixWorld) };
        });
        loads.set(piece, load);
      }
      return load;
    },
    material: () => shared,
  };
}

const _local = new THREE.Matrix4();

/**
 * Replaces a fixture's grey-box layer with instanced kit pieces once every piece it needs has loaded;
 * resolves true if it did. If any piece fails, or the fixture is gone by then, nothing changes.
 * The returned function frees the instance buffers (call it from the fixture's dispose()).
 */
export function swapInKit(
  fixture: BuiltFixture,
  greyLayer: THREE.Object3D,
  placements: readonly Placement[],
  loader: KitLoader,
  isAlive: () => boolean,
  options: { castShadow: boolean },
): { done: Promise<boolean>; dispose: () => void } {
  const made: THREE.InstancedMesh[] = [];
  const pieces = [...new Set(placements.map((p) => p.piece))];
  const done = Promise.all(pieces.map((piece) => loader.load(piece))).then(
    (loaded) => {
      const material = loader.material();
      if (!isAlive() || !material) return false;
      const root = fixture.object;
      root.updateMatrix();
      const toRoot = root.matrix.clone().invert();
      const kit = new THREE.Group();
      kit.name = 'kit';
      pieces.forEach((piece, i) => {
        const { geometry, nodeMatrix } = loaded[i] as LoadedPiece;
        const own = placements.filter((p) => p.piece === piece);
        const mesh = new THREE.InstancedMesh(geometry, material, own.length);
        mesh.name = piece;
        own.forEach((p, k) => mesh.setMatrixAt(k, _local.multiplyMatrices(toRoot, p.matrix).multiply(nodeMatrix)));
        mesh.castShadow = options.castShadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        kit.add(mesh);
        made.push(mesh);
      });
      fixture.release(greyLayer);
      root.add(kit);
      return true;
    },
    () => false,
  );
  return {
    done,
    dispose: () => {
      for (const mesh of made) mesh.dispose();
      made.length = 0;
    },
  };
}
