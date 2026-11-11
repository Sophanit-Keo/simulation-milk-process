// The reefers at the yogurt dock (phase 29, D31, src/scene/equipment/yogurt/reeferTruck.ts): each an articulated truck
// of boxes in the cold chain's box mesh, moved by the UHT dock's bays (phase 12) turned round to the north yard with a
// path of the yard's own. A reefer drives in from the east, opens up, backs in clear of its neighbours, docks as the
// sim docks it, fills by the sim's count, closes up and drives off west, off the floor at each end.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot, YogurtReefer } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import { KINGPIN_Z_M, leaveS, TRUCK_MOVES_S, type Bay, type DoorTruck, type TruckPose } from '../../src/scene/equipment/packs/truckMoves';
import { COLD_ROOM, DOCK_DOORS_X_M } from '../../src/scene/equipment/yogurt/layout';
import {
  approachS,
  CAB_BACK_Z_M,
  createReeferBays,
  createReeferYard,
  doorTrucks,
  LOAD,
  PALLETS_PER_REEFER,
  REEFER_ARTICULATION_RAD,
  REEFER_MOVES,
  REEFER_TAIL_Z_M,
  reeferPose,
  ROLLER_DOOR,
  TRAILER,
  TRUCK_BOXES,
  UNIT_DEPTH_M,
  UNIT_HALF_M,
  type ReeferYard,
} from '../../src/scene/equipment/yogurt/reeferTruck';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { FLOOR, REEFER_YARD } from '../../src/scene/layout';
import { motionRate } from '../../src/scene/motion';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

const ARRIVE_S = 1800;
const LOAD_S = 1200;
const TRUCK_LENGTH_M = 16.5;
const HALF_WIDTH_M = TRAILER.widthM / 2;

/** A snapshot with only what the yard reads: the clock and the sim's reefers. */
const snap = (timeS: number, speed: number, reefers: YogurtReefer[], paused = false): Snapshot =>
  ({ timeS, speed, paused, yogurt: { coldChain: { reefers } } }) as unknown as Snapshot;

/** The sim's reefer for a visit that docks at `dockS`, as the cold chain steps it (sim/yogurt/coldChain.ts). */
function simReefer(id: number, door: number, dockS: number, timeS: number, load = PALLETS_PER_REEFER): YogurtReefer | null {
  if (timeS < dockS) return { id, door, state: 'arriving', pallets: 0, load, untilS: dockS };
  if (timeS >= dockS + LOAD_S) return null;
  // Pallet i goes on board at dockS + (i + 1) × LOAD_S ÷ load.
  const pallets = Math.min(load, Math.floor(((timeS - dockS) * load) / LOAD_S + 1e-9));
  return { id, door, state: 'loading', pallets, load, untilS: dockS + LOAD_S };
}

interface Bound {
  yard: ReeferYard;
  mesh: THREE.InstancedMesh;
  /** Instances of door `door`: its truck's boxes, its load, its roller door and its lamp. */
  truck(door: number, i: number): THREE.Matrix4;
  load(door: number, i: number): THREE.Matrix4;
  roller(door: number): THREE.Matrix4;
  lamp(door: number): THREE.Color;
}

function bound(): Bound {
  const yard = createReeferYard();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), yard.count);
  yard.bind(mesh, 0);
  const perDoor = yard.count / yard.bays.length;
  const matrix = (index: number): THREE.Matrix4 => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(index, m);
    return m;
  };
  return {
    yard,
    mesh,
    truck: (door, i) => matrix(door * perDoor + i),
    load: (door, i) => matrix(door * perDoor + TRUCK_BOXES.length + i),
    roller: (door) => matrix(door * perDoor + TRUCK_BOXES.length + PALLETS_PER_REEFER),
    lamp: (door) => {
      const color = new THREE.Color();
      mesh.getColorAt(door * perDoor + TRUCK_BOXES.length + PALLETS_PER_REEFER + 1, color);
      return color;
    },
  };
}

const sizeOf = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixScale(m);
const placeOf = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(m);
const phaseOf = (yard: ReeferYard, door: number): string => String(yard.state().reeferPhases).split(',')[door] as string;

/** Points round the truck's outline on the floor, the tractor turned about its kingpin: [x, z] in the yard. */
function outline(pose: TruckPose): [number, number][] {
  const points: [number, number][] = [];
  const sin = Math.sin(pose.headingRad);
  const cos = Math.cos(pose.headingRad);
  // rotation.y turns a local (x, z) to (x cos + z sin, −x sin + z cos).
  const put = (lx: number, lz: number): void => void points.push([pose.xM + lx * cos + lz * sin, pose.zM - lx * sin + lz * cos]);
  const trailerFrontZM = TRAILER.frontZM + UNIT_DEPTH_M;
  for (let k = 0; k <= 28; k++) {
    const zM = TRAILER.tailZM + ((trailerFrontZM - TRAILER.tailZM) * k) / 28;
    put(-HALF_WIDTH_M, zM);
    put(HALF_WIDTH_M, zM);
  }
  const turnSin = Math.sin(pose.tractorRad);
  const turnCos = Math.cos(pose.tractorRad);
  for (let k = 0; k <= 12; k++) {
    const zM = 1.85 + ((TRUCK_LENGTH_M / 2 - 1.85) * k) / 12 - KINGPIN_Z_M;
    for (const xM of [-HALF_WIDTH_M, HALF_WIDTH_M]) put(xM * turnCos + zM * turnSin, KINGPIN_Z_M - xM * turnSin + zM * turnCos);
  }
  return points;
}

/** The yard's pose at path length `s` out of door `door`. */
function poseAt(bays: readonly Bay[], door: number, s: number): TruckPose {
  const bay = bays[door] as Bay;
  const raw = REEFER_MOVES.path.pullOutPose(bay.doorXM, s, { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 });
  return reeferPose({ pose: raw }, { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 });
}

describe('the reefer (phase 29)', () => {
  it('is built of boxes: ten wheels of two boxes each, two rear doors, the unit with its fan and lamp, all inside its footprint', () => {
    const kinds = TRUCK_BOXES.map((box) => box.moves?.kind ?? 'fixed');
    expect(kinds.filter((kind) => kind === 'wheel')).toHaveLength(20);
    expect(kinds.filter((kind) => kind === 'door')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'fan')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'lamp')).toHaveLength(1);
    expect(TRUCK_BOXES.length).toBeGreaterThan(45);
    for (const box of TRUCK_BOXES) {
      if (box.moves?.kind === 'door') continue;
      const [cx, cy, cz] = box.centre;
      const [sx, sy, sz] = box.size;
      // The mirrors stand 0.2 m out of the cab's sides; nothing else is wider than the trailer.
      expect(Math.abs(cx) + sx / 2, JSON.stringify(box)).toBeLessThanOrEqual(HALF_WIDTH_M + 0.2);
      expect(cz - sz / 2).toBeGreaterThanOrEqual(-TRUCK_LENGTH_M / 2 - 1e-9);
      expect(cz + sz / 2).toBeLessThanOrEqual(TRUCK_LENGTH_M / 2 + 1e-9);
      // A wheel's box is turned on its axle: its corner comes 0.52 m under its centre, on the floor.
      if (box.moves?.kind !== 'wheel') expect(cy - sy / 2).toBeGreaterThanOrEqual(0);
      expect(cy + sy / 2).toBeLessThanOrEqual(TRAILER.roofM + 1e-9);
    }
  });

  it('keeps the cab\'s back clear of the refrigeration unit however the tractor is turned', () => {
    // The unit's far corner swings round the kingpin on a circle; the cab's back is a plane further out than it.
    const cornerM = Math.hypot(UNIT_HALF_M, TRAILER.frontZM + UNIT_DEPTH_M - KINGPIN_Z_M);
    expect(CAB_BACK_Z_M - KINGPIN_Z_M - cornerM).toBeGreaterThan(0.2);
    const cab = TRUCK_BOXES.filter((box) => box.body === 'tractor' && box.centre[1] + box.size[1] / 2 > 2.3 && box.size[0] > 1);
    expect(cab.length).toBeGreaterThanOrEqual(2);
    for (const box of cab) expect(box.centre[2] - box.size[2] / 2).toBeGreaterThanOrEqual(CAB_BACK_Z_M - 1e-9);
  });
});

describe('the reefer yard\'s path (phase 29)', () => {
  it('turns the UHT dock\'s frame round: docked at its door, tail to the cold room, cab to the north; on the lane it heads west', () => {
    const bays = createReeferBays();
    expect(bays).toHaveLength(DOCK_DOORS_X_M.length);
    DOCK_DOORS_X_M.forEach((doorXM, door) => {
      const docked = reeferPose(bays[door] as Bay, { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 });
      expect(docked.xM).toBeCloseTo(doorXM, 9);
      expect(docked.zM).toBeCloseTo(REEFER_TAIL_Z_M - TRUCK_LENGTH_M / 2, 9);
      // Heading π: the truck's own +z (its cab) points north, to −z.
      expect(Math.cos(docked.headingRad)).toBeCloseTo(-1, 9);
      expect(docked.tractorRad).toBe(0);
      const stopped = poseAt(bays, door, REEFER_MOVES.path.stopM);
      expect(Math.sin(stopped.headingRad)).toBeCloseTo(-1, 9);
      expect(stopped.xM).toBeLessThan(doorXM - 10);
      expect(stopped.zM).toBeLessThan(REEFER_TAIL_Z_M - TRUCK_LENGTH_M);
    });
    expect(REEFER_TAIL_Z_M).toBeLessThan(COLD_ROOM.zMinM);
  });

  it('backs in on the yard, never past the dock, its tractor within 0.9 rad of the trailer', () => {
    const bays = createReeferBays();
    const yard = REEFER_YARD.rect;
    let maxTurn = 0;
    for (let door = 0; door < bays.length; door++) {
      for (let s = 0; s <= REEFER_MOVES.path.stopM; s += 0.1) {
        const pose = poseAt(bays, door, s);
        maxTurn = Math.max(maxTurn, Math.abs(pose.tractorRad));
        for (const [xM, zM] of outline(pose)) {
          expect(xM, `door ${door} at ${s.toFixed(1)} m`).toBeGreaterThan(yard.xMinM);
          expect(xM, `door ${door} at ${s.toFixed(1)} m`).toBeLessThan(yard.xMaxM);
          expect(zM, `door ${door} at ${s.toFixed(1)} m`).toBeGreaterThan(yard.zMinM);
          expect(zM, `door ${door} at ${s.toFixed(1)} m`).toBeLessThanOrEqual(REEFER_TAIL_Z_M + 1e-6);
        }
      }
    }
    expect(maxTurn).toBeGreaterThan(0.6);
    expect(maxTurn).toBeLessThanOrEqual(REEFER_ARTICULATION_RAD + 1e-9);
  });

  it('swings in clear of a reefer docked at any other door: the doors stand only 4.5 m apart', () => {
    const bays = createReeferBays();
    let least = Infinity;
    for (let door = 0; door < bays.length; door++) {
      for (let other = 0; other < bays.length; other++) {
        if (other === door) continue;
        const otherXM = DOCK_DOORS_X_M[other] as number;
        // The docked reefer's footprint: 2.5 m wide, 16.5 m out from the dock.
        for (let s = 0; s <= REEFER_MOVES.path.stopM; s += 0.1) {
          for (const [xM, zM] of outline(poseAt(bays, door, s))) {
            const dxM = Math.max(0, Math.abs(xM - otherXM) - HALF_WIDTH_M);
            const dzM = Math.max(0, REEFER_TAIL_Z_M - TRUCK_LENGTH_M - zM, zM - REEFER_TAIL_Z_M);
            least = Math.min(least, Math.hypot(dxM, dzM));
          }
        }
      }
    }
    expect(least).toBeGreaterThan(0.5);
  });

  it('comes onto the floor from beyond its east edge and leaves beyond its west one, along a lane on the yard', () => {
    const bays = createReeferBays();
    const { path, road } = REEFER_MOVES;
    const raw: TruckPose = { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 };
    const turned: TruckPose = { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 };
    for (const bay of bays) {
      const totalS = path.arriveS(bay.doorXM, road.inXM);
      expect(totalS).toBeGreaterThan(5);
      expect(totalS).toBeLessThan(12);
      const start = outline(reeferPose({ pose: path.arrivalPose(bay.doorXM, 0, raw, road.inXM) }, turned));
      for (const [xM] of start) expect(xM).toBeGreaterThanOrEqual(FLOOR.xMaxM);
      // The arrival ends where the backing in begins.
      const end = reeferPose({ pose: path.arrivalPose(bay.doorXM, totalS, raw, road.inXM) }, { ...turned });
      const stop = poseAt(bays, bay.door, path.stopM);
      expect(end.xM).toBeCloseTo(stop.xM, 6);
      expect(end.zM).toBeCloseTo(stop.zM, 6);
      // On the lane the whole truck is on the yard's depth; gone, it is beyond the floor.
      for (const [, zM] of start) {
        expect(zM).toBeGreaterThan(REEFER_YARD.rect.zMinM);
        expect(zM).toBeLessThan(REEFER_TAIL_Z_M - TRUCK_LENGTH_M);
      }
      const leaveForS = path.leaveDurationS(bay.doorXM, road.outXM);
      expect(leaveForS).toBeGreaterThan(8);
      expect(leaveForS).toBeLessThan(16);
      const gone = outline(reeferPose({ pose: path.pullOutPose(bay.doorXM, leaveS(leaveForS), raw) }, turned));
      for (const [xM] of gone) expect(xM).toBeLessThanOrEqual(FLOOR.xMinM);
    }
  });
});

describe('the sim\'s reefers, as the bays read them (phase 29)', () => {
  it('hands an arriving reefer to its bay once its backing-up time left is what the approach takes, at any speed', () => {
    const bays = createReeferBays();
    const out: (DoorTruck | null)[] = [];
    const arriving: YogurtReefer = { id: 4, door: 1, state: 'arriving', pallets: 0, load: 26, untilS: 10_000 };
    const needS = approachS(bays[1] as Bay);
    expect(needS).toBeGreaterThan(TRUCK_MOVES_S.doors + TRUCK_MOVES_S.reverse + 5);
    for (const speed of [1, 10, 100]) {
      const clock = { speed, rate: motionRate(speed) };
      // Sim seconds the approach takes at this speed.
      const simS = (needS * speed) / clock.rate;
      expect(doorTrucks([arriving], bays, 10_000 - simS - 1, clock, out)).toEqual([null, null, null]);
      expect(doorTrucks([arriving], bays, 10_000 - simS + 1, clock, out)).toEqual([null, { id: 4, loading: false, remainingS: 0, loadedPallets: 0 }, null]);
    }
    // A bay that already shows it keeps it, whatever the clock says now.
    (bays[1] as Bay).shownId = 4;
    expect(doorTrucks([arriving], bays, 0, { speed: 1, rate: 1 }, out)[1]).not.toBeNull();
  });

  it('gives a loading reefer with the sim seconds it has left and its pallets on board, and skips a door the dock has not', () => {
    const bays = createReeferBays();
    const out: (DoorTruck | null)[] = [];
    const loading: YogurtReefer = { id: 9, door: 2, state: 'loading', pallets: 11, load: 26, untilS: 5_000 };
    const nowhere: YogurtReefer = { id: 10, door: 7, state: 'loading', pallets: 3, load: 26, untilS: 5_000 };
    expect(doorTrucks([loading, nowhere], bays, 4_400, { speed: 10, rate: 1.5 }, out)).toEqual([null, null, { id: 9, loading: true, remainingS: 600, loadedPallets: 11 }]);
  });
});

describe('a reefer\'s visit (phase 29)', () => {
  /**
   * Plays a visit to `door` that docks at ARRIVE_S, frame by frame at `speed`, until the yard is empty again or `each`
   * says it has seen enough.
   */
  function visit(b: Bound, door: number, speed: number, each: (timeS: number, reefer: YogurtReefer | null) => boolean | void, load = PALLETS_PER_REEFER, realDtS = 0.05): void {
    const dockS = ARRIVE_S;
    // Start close enough to the docking that the test is short, well before the approach begins.
    let timeS = dockS - (approachS(b.yard.bays[door] as Bay) * speed) / motionRate(speed) - 5 * speed;
    let seen = false;
    for (let i = 0; i < 400_000; i++) {
      const reefer = simReefer(3, door, dockS, timeS, load);
      b.yard.advance(snap(timeS, speed, reefer ? [reefer] : []), realDtS);
      if (each(timeS, reefer) === true) return;
      const phase = phaseOf(b.yard, door);
      if (phase !== 'away') seen = true;
      else if (seen) return;
      timeS += realDtS * speed;
    }
    throw new Error('the reefer never left');
  }

  it('drives in, opens up, backs in, docks as the sim docks it, fills from the front by the sim\'s count, closes up and leaves', () => {
    for (const speed of [1, 10]) {
      const b = bound();
      const door = 1;
      const doorXM = DOCK_DOORS_X_M[door] as number;
      const phases: string[] = [];
      let dockedAtS = NaN;
      let maxWheel = 0;
      const doorLeft = TRUCK_BOXES.findIndex((box) => box.moves?.kind === 'door' && box.moves.side === 'left');
      const wheel = TRUCK_BOXES.findIndex((box) => box.moves?.kind === 'wheel');
      const wheelTurn = new THREE.Quaternion();
      visit(b, door, speed, (timeS, reefer) => {
        const phase = phaseOf(b.yard, door);
        if (phases.at(-1) !== phase) {
          phases.push(phase);
          if (phase === 'docked') dockedAtS = timeS;
        }
        const bay = b.yard.bays[door] as Bay;
        // Every move is played in full at ×1 and ×10.
        if (phase === 'arriving' || phase === 'opening' || phase === 'reversing') expect(bay.playRate).toBe(1);
        if (phase === 'arriving') {
          b.truck(door, wheel).decompose(new THREE.Vector3(), wheelTurn, new THREE.Vector3());
          maxWheel = Math.max(maxWheel, Math.abs(wheelTurn.x));
        }
        if (phase === 'reversing' || phase === 'docked') expect(b.yard.state().reeferDoorsOpen).toBe(1);
        if (phase === 'docked') {
          // At its door, and its rear doors folded flat along the trailer's sides.
          const hinge = placeOf(b.truck(door, doorLeft));
          expect(Math.abs(hinge.x - doorXM)).toBeCloseTo(HALF_WIDTH_M + 0.005, 3);
          expect(hinge.z).toBeLessThan(REEFER_TAIL_Z_M);
          // The trailer shows the sim's own count, from the front wall back, two abreast.
          const onBoard = reefer?.state === 'loading' ? reefer.pallets : 0;
          expect(b.yard.state().reeferLoaded).toBe(['-', String(onBoard), '-'].join(','));
          let shown = 0;
          for (let i = 0; i < PALLETS_PER_REEFER; i++) {
            const size = sizeOf(b.load(door, i));
            if (size.x === 0) continue;
            shown += 1;
            expect(i).toBeLessThan(onBoard);
            const place = placeOf(b.load(door, i));
            expect(Math.abs(place.x - doorXM)).toBeCloseTo(LOAD.xM, 3);
            // Row by row toward the dock: the first row stands furthest north, at the front wall.
            expect(place.z).toBeCloseTo(REEFER_TAIL_Z_M - TRUCK_LENGTH_M / 2 - LOAD.firstZM + Math.floor(i / 2) * LOAD.pitchZM, 3);
          }
          expect(shown).toBe(onBoard);
        }
        // At ×1 the 20 minutes of loading are 20 real minutes: the first pallets on board are enough.
        return speed === 1 && reefer?.state === 'loading' && reefer.pallets >= 2;
      });
      expect(phases, `×${speed}`).toEqual(['away', 'arriving', 'opening', 'reversing', 'docked', 'closing', 'leaving', 'away'].slice(0, speed === 1 ? 5 : 8));
      // Docked within a motion second of the sim's own docking.
      expect(Math.abs(dockedAtS - ARRIVE_S)).toBeLessThan((1 * speed) / motionRate(speed) + 0.1 * speed);
      expect(maxWheel).toBeGreaterThan(0.1);
      expect(Number(b.yard.state().reeferFanTurns)).toBeGreaterThan(1);
      if (speed === 1) continue;
      // Gone: every box of it hidden, the load too.
      for (let i = 0; i < TRUCK_BOXES.length; i++) expect(sizeOf(b.truck(door, i)).length()).toBe(0);
      for (let i = 0; i < PALLETS_PER_REEFER; i++) expect(sizeOf(b.load(door, i)).length()).toBe(0);
    }
  }, 60_000);

  it('raises the dock\'s roller door and lights its lamp red while a reefer stands docked, down and green otherwise', () => {
    const b = bound();
    const door = 0;
    const red = new THREE.Color(0xff3b30);
    const green = new THREE.Color(0x34c759);
    const seen = { up: false, redWhileDocked: 0, greenOtherwise: 0 };
    // Before any reefer: every door down across its opening, every lamp green.
    for (let d = 0; d < b.yard.bays.length; d++) {
      expect(sizeOf(b.roller(d)).y).toBeCloseTo(ROLLER_DOOR.openingM, 4);
      expect(placeOf(b.roller(d)).x).toBeCloseTo(DOCK_DOORS_X_M[d] as number, 4);
      expect(placeOf(b.roller(d)).z).toBeCloseTo(COLD_ROOM.zMinM, 4);
      expect(b.lamp(d).getHex()).toBe(green.getHex());
    }
    expect(b.yard.state().dockLamps).toBe('green,green,green');
    visit(b, door, 10, () => {
      const phase = phaseOf(b.yard, door);
      const bay = b.yard.bays[door] as Bay;
      const heightM = sizeOf(b.roller(door)).y;
      // The door hangs from the door head: its top stays there as it rolls up.
      expect(placeOf(b.roller(door)).y + heightM / 2).toBeCloseTo(ROLLER_DOOR.openingM, 4);
      if (phase === 'docked') {
        expect(b.lamp(door).getHex()).toBe(red.getHex());
        seen.redWhileDocked += 1;
        if (bay.rollerFrac >= 1) {
          seen.up = true;
          expect(heightM).toBeCloseTo(0.12, 4);
          expect(b.yard.state().dockDoorsUp).toBe(1);
        }
      } else {
        expect(b.lamp(door).getHex()).toBe(green.getHex());
        seen.greenOtherwise += 1;
        if (phase === 'arriving' || phase === 'opening' || phase === 'leaving') expect(heightM).toBeCloseTo(ROLLER_DOOR.openingM, 4);
      }
      // The other doors never move.
      expect(sizeOf(b.roller(2)).y).toBeCloseTo(ROLLER_DOOR.openingM, 4);
    });
    expect(seen.up).toBe(true);
    expect(seen.redWhileDocked).toBeGreaterThan(10);
    expect(seen.greenOtherwise).toBeGreaterThan(10);
    expect(b.yard.state().dockLamps).toBe('green,green,green');
    expect(b.yard.state().dockDoorsUp).toBe(0);
  }, 60_000);

  it('fits its moves into the sim\'s time at ×1,000: closed up by the time the sim sends it away, never more on board than its load', () => {
    const b = bound();
    const door = 0;
    let phaseAsSimLeft = '';
    let simGone = false;
    let most = 0;
    visit(b, door, 1_000, (_timeS, reefer) => {
      const phase = phaseOf(b.yard, door);
      if (reefer === null && !simGone && phase !== 'away') {
        simGone = true;
        phaseAsSimLeft = phase;
      }
      const loaded = String(b.yard.state().reeferLoaded).split(',')[door] as string;
      if (loaded !== '-') most = Math.max(most, Number(loaded));
    }, PALLETS_PER_REEFER, 1 / 30);
    expect(['closing', 'leaving']).toContain(phaseAsSimLeft);
    expect(most).toBe(PALLETS_PER_REEFER);
  }, 60_000);

  it('leaves with its own load: a reefer called for the oldest pallets may carry fewer than 26', () => {
    const b = bound();
    const door = 2;
    const loads = new Set<number>();
    visit(b, door, 100, () => {
      const phase = phaseOf(b.yard, door);
      if (phase !== 'closing' && phase !== 'leaving') return;
      loads.add(Number(String(b.yard.state().reeferLoaded).split(',')[door]));
      let shown = 0;
      for (let i = 0; i < PALLETS_PER_REEFER; i++) if (sizeOf(b.load(door, i)).x > 0) shown += 1;
      expect(shown).toBeLessThanOrEqual(9);
    }, 9);
    expect([...loads]).toEqual([9]);
  }, 60_000);

  it('stands still while paused, and draws nothing new when the same snapshot comes again', () => {
    const b = bound();
    const door = 1;
    const dockS = 1_000;
    let timeS = dockS - 12;
    for (let i = 0; i < 60; i++) {
      b.yard.advance(snap(timeS, 1, [simReefer(5, door, dockS, timeS) as YogurtReefer]), 0.1);
      timeS += 0.1;
    }
    expect(phaseOf(b.yard, door)).toBe('arriving');
    const before = { ...b.yard.state() };
    const first = b.truck(door, 0).clone();
    for (let i = 0; i < 30; i++) b.yard.advance(snap(timeS, 1, [simReefer(5, door, dockS, timeS) as YogurtReefer], true), 0.1);
    expect(b.yard.state()).toEqual(before);
    expect(b.truck(door, 0).equals(first)).toBe(true);
    // Running again, it moves on.
    b.yard.advance(snap(timeS, 1, [simReefer(5, door, dockS, timeS) as YogurtReefer]), 0.1);
    expect(b.truck(door, 0).equals(first)).toBe(false);
  });
});

describe('the reefer yard in the wing (phase 29)', () => {
  function makeContext(): EquipmentContext {
    const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
    return {
      materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
      loadModel: () => Promise.reject(new Error('no models in unit tests')),
    };
  }

  it('draws the live sim\'s reefers in the cold chain\'s box mesh, with no mesh of its own, and reports them', () => {
    stubTheme();
    const sim = createSim(plantConfig);
    const tokens = yogurtLine(makeContext()).find((item) => item.id === 'yogurt-pallets') as Equipment;
    const meshes: string[] = [];
    tokens.object.traverse((node) => node instanceof THREE.InstancedMesh && meshes.push(node.name));
    expect(meshes).toEqual(['coldChainBoxes', 'roomGlows']);
    // Nothing at the dock when the plant opens.
    tokens.update(sim.snapshot(), 0.1);
    expect(tokens.debugState?.()).toMatchObject({ reefers: 0, reeferPhases: 'away,away,away', reeferDoorsOpen: 0, reeferLoaded: '-,-,-', dockDoorsUp: 0, dockLamps: 'green,green,green' });
    // At ×100 the first reefer of the day comes, docks, loads and goes.
    sim.dispatch({ type: 'setSpeed', speed: 100 });
    const phases = new Set<string>();
    let mostLoaded = 0;
    let shipped = 0;
    for (let i = 0; i < 6_000 && !(shipped > 0 && phases.has('leaving') && tokens.debugState?.().reefers === 0); i++) {
      sim.step(0.1);
      const snapshot = sim.snapshot();
      tokens.update(snapshot, 0.1);
      const state = tokens.debugState?.() ?? {};
      for (const phase of String(state.reeferPhases).split(',')) phases.add(phase);
      const loaded = String(state.reeferLoaded).split(',')[0] as string;
      if (loaded !== '-') mostLoaded = Math.max(mostLoaded, Number(loaded));
      expect(Number(state.reefers)).toBeLessThanOrEqual(1);
      shipped = snapshot.yogurt?.coldChain.reefersShipped ?? 0;
    }
    expect(shipped).toBe(1);
    expect([...phases].sort()).toEqual(['arriving', 'away', 'closing', 'docked', 'leaving', 'opening', 'reversing'].sort());
    expect(mostLoaded).toBe(PALLETS_PER_REEFER);
  }, 60_000);
});
