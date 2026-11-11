// Stage 16's pallet transfers, drawn (phase 29, D31): the two stacker trucks with their riders, the pallet each
// carries, the pallet waiting on the rollers' end, and the rooms' rapid doors. stackers.ts says where everything is;
// here each is boxes in the cold chain's box mesh (coldChainScene.ts SharedBoxes), coloured per box, casting no shadow
// and taking no clicks, so the transfers cost no draw call.
//
// A stacker is drawn in its own frame: origin at its pivot on the floor (the middle of its load wheels, under the
// pallet), its forks pointing along +z, its rider standing on the platform at its rear.
import * as THREE from 'three';
import type { Snapshot } from '../../../contracts';
import type { SharedBoxes } from './coldChainScene';
import * as at from './layout';
import { BAY, createStackers, DOOR_AT, DOOR_IDS, STACKER, type DoorId, type LineView, type Stackers, type Truck } from './stackers';

const HEX = {
  truck: 0xf2b705,
  chassis: 0x2c343b,
  mast: 0x59636b,
  fork: 0x3a4046,
  trousers: 0x27364a,
  jacket: 0xff7a1a,
  skin: 0xd8a47f,
  helmet: 0xf2f2f2,
  beaconLit: 0xffb020,
  beaconDark: 0x4a3a1a,
  palletBase: 0x9a7a52,
  load: 0xf2efe6,
  warm: 0xf4dcb6,
  frost: 0xcfe3f2,
  curtainCold: 0x2f6fb5,
  curtainWarm: 0xe07b2a,
  housing: 0x9aa3ab,
} as const;

/** A box of the truck: fixed to its body, or riding up and down with its forks (`y` is then above the forks' top). */
interface BoxSpec {
  centre: readonly [number, number, number];
  size: readonly [number, number, number];
  hex: number;
  onForks?: boolean;
  beacon?: boolean;
}

/** The mast stands this far behind the pivot, behind the pallet's heel; the body and the platform behind it. */
const MAST_Z_M = -0.7;

function truckBoxes(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const add = (centre: BoxSpec['centre'], size: BoxSpec['size'], hex: number, more: Partial<BoxSpec> = {}): void => void boxes.push({ centre, size, hex, ...more });
  for (const side of [-1, 1]) {
    // The straddle legs with the load wheels, and the forks over the floor between them.
    add([side * 0.33, 0.04, -0.05], [0.1, 0.08, 1.3], HEX.chassis);
    add([side * 0.17, -0.0225, 0], [0.14, 0.045, STACKER.forkM * 2], HEX.fork, { onForks: true });
    // The mast's uprights and the rider's side guards.
    add([side * 0.3, 1.0, MAST_Z_M], [0.08, 2.0, 0.1], HEX.mast);
    add([side * 0.37, 0.75, -1.44], [0.04, 0.5, 0.3], HEX.truck);
    add([side * 0.2, 1.3, -1.36], [0.08, 0.1, 0.3], HEX.jacket);
  }
  add([0, 0.25, MAST_Z_M + 0.07], [0.7, 0.5, 0.06], HEX.fork, { onForks: true });
  add([0, 1.98, MAST_Z_M], [0.68, 0.08, 0.1], HEX.mast);
  // The battery and the drive under its hood, the drive wheel, the platform, the tiller.
  add([0, 0.55, -1.02], [STACKER.halfWidthM * 2, 0.9, 0.5], HEX.truck);
  add([0, 1.03, -1.02], [0.76, 0.06, 0.46], HEX.chassis);
  add([0, 0.12, -1.05], [0.12, 0.24, 0.24], HEX.chassis);
  add([0, 0.12, -(STACKER.rearM - 0.16)], [0.7, 0.06, 0.32], HEX.chassis);
  add([0, 1.2, -1.3], [0.06, 0.35, 0.06], HEX.chassis);
  add([0, 1.38, -1.33], [0.4, 0.05, 0.08], HEX.chassis);
  // The rider, standing on the platform.
  add([0, 0.55, -1.46], [0.3, 0.8, 0.2], HEX.trousers);
  add([0, 1.25, -1.46], [0.42, 0.6, 0.24], HEX.jacket);
  add([0, 1.68, -1.46], [0.2, 0.22, 0.2], HEX.skin);
  add([0, 1.81, -1.46], [0.24, 0.08, 0.24], HEX.helmet);
  // The beacon on the mast's top.
  add([0.3, 2.08, MAST_Z_M], [0.1, 0.12, 0.1], HEX.beaconDark, { beacon: true });
  return boxes;
}

/** The boxes of one stacker, in the order they are drawn. */
export const STACKER_BOXES: readonly BoxSpec[] = truckBoxes();
/** A pallet as the cold chain draws it (coldChainScene.ts YOGURT_PALLET_M). */
const PALLET = { widthM: 1.2, depthM: 1.0, baseM: 0.14, loadM: 0.85 } as const;
/** Instances a truck takes: its boxes and the pallet on its forks (base and load). */
const PER_TRUCK = STACKER_BOXES.length + 2;
/** A door's: its curtain and the housing it rolls into; the cold room's doorway has a panel over it besides. */
const PER_DOOR = 2;
const COUNT = 2 * PER_TRUCK + 2 + DOOR_IDS.length * PER_DOOR + 1;
/** The beacon flashes twice a second while its truck works. */
const BEACON_HZ = 2;

export interface Transfers extends SharedBoxes {
  readonly stackers: Stackers;
  advance(snapshot: Snapshot, realDtS: number): void;
  adjust: Stackers['adjust'];
  state(): ReturnType<Stackers['state']> & { stacker1Beacon: boolean; stacker2Beacon: boolean };
}

export function createTransfers(line: LineView): Transfers {
  const stackers = createStackers(line);
  let mesh: THREE.InstancedMesh | null = null;
  let offset = 0;
  /** prefers-reduced-motion, where there is a page to ask: the beacons then shine steadily. */
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  const body = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);

  const beaconLit = (truck: Truck): boolean => truck.job !== 'parked' && ((reducedMotion?.matches ?? false) || Math.floor(truck.workS * BEACON_HZ * 2) % 2 === 0);

  function box(index: number, xM: number, yM: number, zM: number, sx: number, sy: number, sz: number, hex?: number): void {
    if (!mesh) return;
    mesh.setMatrixAt(index, world.compose(position.set(xM, yM, zM), quaternion.identity(), scale.set(sx, sy, sz)));
    if (hex !== undefined) mesh.setColorAt(index, color.setHex(hex));
  }

  function drawTruck(truck: Truck, first: number): void {
    if (!mesh) return;
    body.makeRotationY(truck.rad).setPosition(truck.xM, 0, truck.zM);
    STACKER_BOXES.forEach((spec, i) => {
      const [cx, cy, cz] = spec.centre;
      position.set(cx, cy + (spec.onForks ? truck.forksM : 0), cz);
      world.copy(body).multiply(local.compose(position, quaternion.identity(), scale.set(spec.size[0], spec.size[1], spec.size[2])));
      mesh?.setMatrixAt(first + i, world);
      if (spec.beacon) mesh?.setColorAt(first + i, color.setHex(beaconLit(truck) ? HEX.beaconLit : HEX.beaconDark));
    });
    // The pallet on the forks: stacker-1 takes it across its 1.2 m, stacker-2 along it (out of the tunnel's end).
    const pallet = first + STACKER_BOXES.length;
    if (!truck.carrying) {
      mesh.setMatrixAt(pallet, hide);
      mesh.setMatrixAt(pallet + 1, hide);
      return;
    }
    const acrossM = truck.id === 1 ? PALLET.widthM : PALLET.depthM;
    const alongM = truck.id === 1 ? PALLET.depthM : PALLET.widthM;
    position.set(0, truck.forksM + PALLET.baseM / 2, 0);
    mesh.setMatrixAt(pallet, world.copy(body).multiply(local.compose(position, quaternion.identity(), scale.set(acrossM, PALLET.baseM, alongM))));
    position.set(0, truck.forksM + PALLET.baseM + PALLET.loadM / 2, 0);
    mesh.setMatrixAt(pallet + 1, world.copy(body).multiply(local.compose(position, quaternion.identity(), scale.set(acrossM - 0.08, PALLET.loadM, alongM - 0.06))));
    const from = truck.trip?.from;
    mesh.setColorAt(pallet + 1, color.setHex(from === 'warmRoom' ? HEX.warm : from === 'chiller' ? HEX.frost : HEX.load));
  }

  function drawDoor(id: DoorId, first: number): void {
    const door = DOOR_AT[id];
    const openFrac = stackers.doors[id];
    // The curtain hangs from its housing and rolls up into it; a hand's breadth of it shows when it is up.
    const hangM = Math.max(0.08, door.heightM * (1 - openFrac));
    const yM = door.heightM - hangM / 2;
    if (door.along === 'x') box(first, door.xM, yM, door.zM, door.widthM, hangM, 0.05);
    else box(first, door.xM, yM, door.zM, 0.05, hangM, door.widthM);
  }

  function draw(): void {
    if (!mesh) return;
    stackers.trucks.forEach((truck, i) => drawTruck(truck, offset + i * PER_TRUCK));
    // The pallet off the line, on the rollers' end until stacker-1 lifts it.
    const waiting = offset + 2 * PER_TRUCK;
    if (stackers.waiting) {
      box(waiting, BAY.xM, at.PALLET_LINE.rollerTopM + PALLET.baseM / 2, BAY.pickZM, PALLET.widthM, PALLET.baseM, PALLET.depthM);
      box(waiting + 1, BAY.xM, at.PALLET_LINE.rollerTopM + PALLET.baseM + PALLET.loadM / 2, BAY.pickZM, PALLET.widthM - 0.08, PALLET.loadM, PALLET.depthM - 0.06);
    } else {
      mesh.setMatrixAt(waiting, hide);
      mesh.setMatrixAt(waiting + 1, hide);
    }
    DOOR_IDS.forEach((id, i) => drawDoor(id, waiting + 2 + i * PER_DOOR));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    count: COUNT,
    stackers,
    bind(target, first) {
      mesh = target;
      offset = first;
      // The colours stand: only the beacons' and the carried loads' change (draw()).
      for (let t = 0; t < 2; t++) {
        const start = first + t * PER_TRUCK;
        STACKER_BOXES.forEach((spec, i) => target.setColorAt(start + i, color.setHex(spec.hex)));
        target.setColorAt(start + STACKER_BOXES.length, color.setHex(HEX.palletBase));
        target.setColorAt(start + STACKER_BOXES.length + 1, color.setHex(HEX.load));
      }
      const waiting = first + 2 * PER_TRUCK;
      target.setColorAt(waiting, color.setHex(HEX.palletBase));
      target.setColorAt(waiting + 1, color.setHex(HEX.load));
      // The doors' housings stand; their curtains are draw()'s.
      DOOR_IDS.forEach((id, i) => {
        const door = DOOR_AT[id];
        const at_ = waiting + 2 + i * PER_DOOR;
        target.setColorAt(at_, color.setHex(id === 'warm' ? HEX.curtainWarm : HEX.curtainCold));
        const yM = door.heightM + 0.13;
        if (door.along === 'x') box(at_ + 1, door.xM, yM, door.zM, door.widthM + 0.1, 0.26, 0.28, HEX.housing);
        else box(at_ + 1, door.xM, yM, door.zM, 0.28, 0.26, door.widthM + 0.1, HEX.housing);
      });
      // Over the cold room's doorway, whose gap runs to the wall's top: a panel from the housing up.
      const cold = DOOR_AT.cold;
      const fromM = cold.heightM + 0.26;
      box(first + COUNT - 1, cold.xM, (fromM + at.COLD_ROOM.wallM) / 2, cold.zM, cold.widthM, at.COLD_ROOM.wallM - fromM, 0.1, HEX.housing);
      draw();
    },
    advance(snapshot, realDtS) {
      stackers.advance(snapshot, realDtS);
      draw();
    },
    adjust: () => stackers.adjust(),
    state: () => ({ ...stackers.state(), stacker1Beacon: beaconLit(stackers.trucks[0]), stacker2Beacon: beaconLit(stackers.trucks[1]) }),
  };
}
