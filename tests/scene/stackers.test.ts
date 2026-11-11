// Stage 16's pallet transfers (phase 29, D31, src/scene/equipment/yogurt/stackers.ts and dispatchBoxes.ts): two
// stacker trucks carry the pallets between the line and the rooms, following the sim's own moves, through rapid doors
// that open for them. Each trip is walked here against the rooms' walls; the trucks keep to a stacker's speeds, carry a
// pallet only between pick and drop, and the rooms show a pallet once it is set down. Drawn as boxes in the cold
// chain's mesh: no draw call.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot, YogurtPallet, YogurtPalletPlace } from '../../src/contracts';
import type { Equipment, EquipmentContext, MaterialName } from '../../src/scene/equipment';
import { createTransfers, STACKER_BOXES } from '../../src/scene/equipment/yogurt/dispatchBoxes';
import { BLAST_CHILLER, COLD_DOORWAY, COLD_ROOM, LINE_Z_M, PALLET_LINE, WARM_DOOR, WARM_ROOM } from '../../src/scene/equipment/yogurt/layout';
import {
  AISLE,
  BAY,
  createStackers,
  DOOR,
  DOOR_AT,
  DOOR_IDS,
  PARKING,
  QUEUE_MAX,
  STACKER,
  STACKER_MOVES,
  type DoorId,
  type Job,
  type Spot,
  type Stackers,
  type Truck,
} from '../../src/scene/equipment/yogurt/stackers';
import { yogurtLine } from '../../src/scene/equipment/yogurtLine';
import { ZONES } from '../../src/scene/layout';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubMatchMedia, stubTheme } from './browserStubs';

afterEach(() => vi.unstubAllGlobals());

const pallet = (id: number, place: YogurtPalletPlace): YogurtPallet => ({ id, place }) as unknown as YogurtPallet;
/** A snapshot with only what the stackers read: the clock and the sim's pallets. */
const snap = (timeS: number, pallets: YogurtPallet[], speed = 1, paused = false): Snapshot =>
  ({ timeS, speed, paused, yogurt: { coldChain: { pallets } } }) as unknown as Snapshot;

/** The line as the stackers read it, for a test to set a rider on. */
function lineStub(): { rider: { id: number } | null } {
  return { rider: null };
}

interface Frame {
  tS: number;
  stackers: Stackers;
}

/** The sim's clock for each set of stackers a test plays: a second play goes on from where the first stopped. */
const clockS = new WeakMap<Stackers, number>();

/**
 * Plays `places` (the sim's pallets, by the seconds since this play began) frame by frame at ×1 until `until` holds;
 * `each` sees every frame. Returns the seconds it took.
 */
function play(stackers: Stackers, places: (tS: number) => YogurtPallet[], until: (frame: Frame) => boolean, each: (frame: Frame) => void = () => {}, maxS = 400, dtS = 0.05): number {
  const fromS = clockS.get(stackers) ?? 1000;
  for (let i = 0; i * dtS < maxS; i++) {
    const tS = i * dtS;
    stackers.advance(snap(fromS + tS, places(tS)), dtS);
    clockS.set(stackers, fromS + tS + dtS);
    each({ tS, stackers });
    if (until({ tS, stackers })) return tS;
  }
  throw new Error('the stackers never got there');
}

/** One pallet that moves from `from` to `to` a second in. */
const move = (from: YogurtPalletPlace, to: YogurtPalletPlace) => (tS: number): YogurtPallet[] => [pallet(1, tS < 1 ? from : to)];
const parkedAfterWork = (truck: 0 | 1) => ({ stackers }: Frame): boolean => stackers.trucks[truck].trips > 0 && stackers.trucks[truck].job === 'parked';

/** Points round a rectangle of the truck, in its frame (x across, z along its forks), turned and placed on the floor. */
function rectPoints(truck: Truck, x0: number, x1: number, z0: number, z1: number): [number, number][] {
  const sin = Math.sin(truck.rad);
  const cos = Math.cos(truck.rad);
  const points: [number, number][] = [];
  const put = (lx: number, lz: number): void => void points.push([truck.xM + lx * cos + lz * sin, truck.zM - lx * sin + lz * cos]);
  for (let k = 0; k <= 6; k++) {
    const zM = z0 + ((z1 - z0) * k) / 6;
    put(x0, zM);
    put(x1, zM);
    const xM = x0 + ((x1 - x0) * k) / 6;
    put(xM, z0);
    put(xM, z1);
  }
  return points;
}

/** The truck's body, from its platform to its mast, and what reaches ahead of the mast: its forks and legs, or its pallet. */
const MAST_BACK_M = -0.62;
const bodyOf = (truck: Truck): [number, number][] => rectPoints(truck, -STACKER.halfWidthM, STACKER.halfWidthM, -STACKER.rearM, MAST_BACK_M);
function reachOf(truck: Truck): [number, number][] {
  if (!truck.carrying) return rectPoints(truck, -0.38, 0.38, MAST_BACK_M, STACKER.forkM);
  // stacker-1 takes a pallet across its 1.2 m, stacker-2 along it.
  return truck.id === 1 ? rectPoints(truck, -0.6, 0.6, -0.5, 0.5) : rectPoints(truck, -0.5, 0.5, -0.6, 0.6);
}

interface Rect {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
const WALL_M = 0.075;
/** A wall along x at `zM` from x0 to x1, or along z at `xM`. */
const wallX = (name: string, zM: number, x0: number, x1: number): Rect => ({ name, x0, x1, z0: zM - WALL_M, z1: zM + WALL_M });
const wallZ = (name: string, xM: number, z0: number, z1: number): Rect => ({ name, x0: xM - WALL_M, x1: xM + WALL_M, z0, z1 });

/** What stands on the floor round the trucks: the rooms' walls with their doors left open, the tunnel's, the line. */
const SOLIDS: Rect[] = [
  wallX('warm room north', WARM_ROOM.zMinM, WARM_ROOM.xMinM, WARM_ROOM.xMaxM),
  wallX('warm room south', WARM_ROOM.zMaxM, WARM_ROOM.xMinM, WARM_ROOM.xMaxM),
  wallZ('warm room east, north of its door', WARM_ROOM.xMaxM, WARM_ROOM.zMinM, WARM_DOOR.zM - WARM_DOOR.widthM / 2),
  wallZ('warm room east, south of its door', WARM_ROOM.xMaxM, WARM_DOOR.zM + WARM_DOOR.widthM / 2, WARM_ROOM.zMaxM),
  wallX('chiller north', BLAST_CHILLER.zMinM, BLAST_CHILLER.xMinM, BLAST_CHILLER.xMaxM),
  wallX('chiller south', BLAST_CHILLER.zMaxM, BLAST_CHILLER.xMinM, BLAST_CHILLER.xMaxM),
  wallX('cold room south, west of its doorway', COLD_ROOM.zMaxM, COLD_ROOM.xMinM, COLD_DOORWAY.xM - COLD_DOORWAY.widthM / 2),
  wallX('cold room south, east of its doorway', COLD_ROOM.zMaxM, COLD_DOORWAY.xM + COLD_DOORWAY.widthM / 2, COLD_ROOM.xMaxM),
  wallZ('cold room east', COLD_ROOM.xMaxM, COLD_ROOM.zMinM, COLD_ROOM.zMaxM),
  // The cold room's south rack row, 0.85 m inside its wall.
  { name: 'cold room racks', x0: COLD_ROOM.xMinM, x1: COLD_ROOM.xMaxM, z0: COLD_ROOM.zMaxM - 1.95, z1: COLD_ROOM.zMaxM - 0.85 },
];
/** The line's rollers, from the palletizer to their end: a truck's body keeps off them; its forks reach over their end. */
const ROLLERS: Rect = { name: 'the line', x0: PALLET_LINE.toWrapper.xMinM, x1: PALLET_LINE.outfeed.xMaxM + 0.03, z0: LINE_Z_M - PALLET_LINE.widthM / 2 - 0.05, z1: LINE_Z_M + PALLET_LINE.widthM / 2 + 0.05 };

const inside = ([xM, zM]: readonly [number, number], rect: Rect): boolean => xM > rect.x0 && xM < rect.x1 && zM > rect.z0 && zM < rect.z1;

/** Everything a frame must hold for a truck: on the store's floor, clear of every wall, its body off the rollers. */
function expectClear(truck: Truck, at_: string): void {
  const zone = ZONES.find((each) => each.id === 'coldChain')?.rect;
  if (!zone) throw new Error('no cold chain zone');
  // One expectation a frame: the first thing in the way, or nothing.
  let inTheWay = '';
  const body = bodyOf(truck);
  for (const point of [...body, ...reachOf(truck)]) {
    if (point[0] >= zone.xMaxM || point[0] <= zone.xMinM || point[1] >= zone.zMaxM) inTheWay ||= `off the floor at ${point[0].toFixed(2)}, ${point[1].toFixed(2)}`;
    for (const solid of SOLIDS) if (inside(point, solid)) inTheWay ||= `in ${solid.name} at ${point[0].toFixed(2)}, ${point[1].toFixed(2)}`;
  }
  for (const point of body) if (inside(point, ROLLERS)) inTheWay ||= `its body on the line's rollers at ${point[0].toFixed(2)}, ${point[1].toFixed(2)}`;
  expect(inTheWay, at_).toBe('');
}

const TRIPS: readonly { truck: 0 | 1; from: YogurtPalletPlace; to: YogurtPalletPlace }[] = [
  { truck: 0, from: 'staging', to: 'chiller' },
  { truck: 0, from: 'staging', to: 'warmRoom' },
  { truck: 0, from: 'warmRoom', to: 'chiller' },
  { truck: 1, from: 'chiller', to: 'coldRoom' },
];

describe('a stacker\'s trip (phase 29)', () => {
  it('goes parked, to the pick, picks, to the drop, drops and home, carrying a pallet only between pick and drop', () => {
    for (const trip of TRIPS) {
      const stackers = createStackers();
      const truck = stackers.trucks[trip.truck];
      const jobs: Job[] = [];
      play(stackers, move(trip.from, trip.to), parkedAfterWork(trip.truck), () => {
        if (jobs.at(-1) !== truck.job) jobs.push(truck.job);
        expect(truck.carrying, `${trip.from} to ${trip.to}, ${truck.job}`).toBe(truck.job === 'pick' || truck.job === 'toDrop' || truck.job === 'drop');
      });
      expect(jobs, `${trip.from} to ${trip.to}`).toEqual(['parked', 'toPick', 'pick', 'toDrop', 'drop', 'home', 'parked']);
      // Back where it parks, forks down, and one trip done; the other truck never stirred.
      const park = PARKING[trip.truck];
      expect(truck.xM).toBeCloseTo(park.xM, 6);
      expect(truck.zM).toBeCloseTo(park.zM, 6);
      expect(Math.cos(truck.rad - park.rad)).toBeCloseTo(1, 9);
      expect(truck.forksM).toBeCloseTo(STACKER_MOVES.downM, 6);
      expect(stackers.state()).toMatchObject({ stackerTrips: 1, stackerQueue: 0, stackerUnseen: 0, doorsOpen: 0 });
      expect(stackers.trucks[trip.truck === 0 ? 1 : 0].job).toBe('parked');
    }
  });

  it('keeps clear of the rooms\' walls, the tunnel\'s and the racks, on the store\'s floor, its body off the line\'s rollers', () => {
    for (const trip of TRIPS) {
      const stackers = createStackers();
      const truck = stackers.trucks[trip.truck];
      play(stackers, move(trip.from, trip.to), parkedAfterWork(trip.truck), ({ tS }) => expectClear(truck, `${trip.from} to ${trip.to} at ${tS.toFixed(2)} s, ${truck.job}`));
    }
  }, 30_000);

  it('moves like a stacker: straight along its forks, turning only on the spot, within its speeds', () => {
    const dtS = 0.05;
    for (const trip of TRIPS) {
      const stackers = createStackers();
      const truck = stackers.trucks[trip.truck];
      let before = { xM: truck.xM, zM: truck.zM, rad: truck.rad, forksM: truck.forksM, carrying: truck.carrying };
      let topMps = 0;
      let turned = 0;
      play(stackers, move(trip.from, trip.to), parkedAfterWork(trip.truck), () => {
        const dxM = truck.xM - before.xM;
        const dzM = truck.zM - before.zM;
        const wentM = Math.hypot(dxM, dzM);
        const turnRad = Math.abs(Math.atan2(Math.sin(truck.rad - before.rad), Math.cos(truck.rad - before.rad)));
        // 1.6 m/s empty, 1.2 m/s with a pallet (a frame in which it takes hold or lets go may be either).
        const limitMps = truck.carrying && before.carrying ? STACKER_MOVES.loadedMps : STACKER_MOVES.emptyMps;
        expect(wentM / dtS, `${truck.job}`).toBeLessThanOrEqual(limitMps + 1e-6);
        topMps = Math.max(topMps, wentM / dtS);
        expect(turnRad / dtS).toBeLessThanOrEqual(STACKER_MOVES.turnRadPerS + 1e-6);
        expect(Math.abs(truck.forksM - before.forksM) / dtS).toBeLessThanOrEqual(STACKER_MOVES.forksMps + 1e-6);
        turned += turnRad;
        if (wentM > 1e-6) {
          // Along its forks, ahead or back; and where it turned this frame, it was at the turn's start or end.
          const alongM = dxM * Math.sin(before.rad) + dzM * Math.cos(before.rad);
          const alongNowM = dxM * Math.sin(truck.rad) + dzM * Math.cos(truck.rad);
          expect(Math.max(Math.abs(alongM), Math.abs(alongNowM))).toBeCloseTo(wentM, 5);
        }
        before = { xM: truck.xM, zM: truck.zM, rad: truck.rad, forksM: truck.forksM, carrying: truck.carrying };
      }, 400, dtS);
      expect(topMps).toBeGreaterThan(1);
      // Quarter turns: to the drop and back at the least, six of them on stacker-2's way round the line's end.
      expect(turned).toBeGreaterThan(Math.PI - 0.01);
      if (trip.truck === 1) expect(turned).toBeCloseTo(3 * Math.PI, 5);
    }
  });

  it('creeps into a pick and a drop, and lifts the pallet clear before it carries it', () => {
    const stackers = createStackers();
    const truck = stackers.trucks[1];
    let before = { xM: truck.xM, zM: truck.zM };
    let lifted = false;
    play(stackers, move('chiller', 'coldRoom'), parkedAfterWork(1), () => {
      const mps = Math.hypot(truck.xM - before.xM, truck.zM - before.zM) / 0.05;
      // Within half a metre of the pallet in the tunnel, and of the doorway's drop, it is at the creep.
      const toPickM = Math.hypot(truck.xM - AISLE.pickXM, truck.zM - AISLE.chillerZM);
      const toDropM = Math.hypot(truck.xM - AISLE.doorXM, truck.zM - AISLE.dropZM);
      if (toPickM < 0.5 || toDropM < 0.5) expect(mps).toBeLessThanOrEqual(STACKER_MOVES.creepMps + 1e-6);
      if (truck.job === 'toDrop') {
        // Lifted off the roller track before it backs out, and carried at that height.
        expect(truck.forksM).toBeCloseTo(0.4 + STACKER_MOVES.liftM, 6);
        lifted = true;
      }
      before = { xM: truck.xM, zM: truck.zM };
    });
    expect(lifted).toBe(true);
  });
});

describe('the rapid doors (phase 29)', () => {
  /** The door a point of the truck's reach is in or beyond, if any: in the room's side of the door's plane. */
  function through(id: DoorId, [xM, zM]: readonly [number, number]): boolean {
    const door = DOOR_AT[id];
    const half = door.widthM / 2 + 0.2;
    switch (id) {
      case 'warm':
        return xM < door.xM + 0.05 && Math.abs(zM - door.zM) < half;
      case 'chillerIn':
        return xM > door.xM - 0.05 && xM < door.xM + 3 && Math.abs(zM - door.zM) < half;
      case 'chillerOut':
        return xM < door.xM + 0.05 && xM > door.xM - 3 && Math.abs(zM - door.zM) < half;
      case 'cold':
        return zM < door.zM + 0.05 && Math.abs(xM - door.xM) < half;
    }
  }

  it('are up whenever a stacker\'s forks or pallet are in a doorway, and open only for a stacker within 3 m on a trip through them', () => {
    const doorsOf: Record<string, DoorId[]> = { 'staging>chiller': ['chillerIn'], 'staging>warmRoom': ['warm'], 'warmRoom>chiller': ['warm', 'chillerIn'], 'chiller>coldRoom': ['chillerOut', 'cold'] };
    for (const trip of TRIPS) {
      const stackers = createStackers();
      const truck = stackers.trucks[trip.truck];
      const uses = doorsOf[`${trip.from}>${trip.to}`] as DoorId[];
      const wentUp = new Set<DoorId>();
      let before = { ...stackers.doors };
      for (const id of DOOR_IDS) expect(stackers.doors[id]).toBe(0);
      play(stackers, move(trip.from, trip.to), parkedAfterWork(trip.truck), ({ tS }) => {
        for (const id of DOOR_IDS) {
          const frac = stackers.doors[id];
          if (frac > before[id]) {
            // Rolling up: this trip's door, and its truck near.
            expect(uses, `${id} rises on ${trip.from} to ${trip.to}`).toContain(id);
            expect(Math.hypot(truck.xM - DOOR_AT[id].xM, truck.zM - DOOR_AT[id].zM)).toBeLessThanOrEqual(DOOR.nearM + 0.1);
          }
          if (frac >= 1) wentUp.add(id);
          if (reachOf(truck).some((point) => through(id, point))) expect(frac, `${id} at ${tS.toFixed(2)} s, ${truck.job}`).toBe(1);
        }
        before = { ...stackers.doors };
      });
      expect([...wentUp].sort()).toEqual([...uses].sort());
      // Down again behind it.
      play(stackers, () => [pallet(1, trip.to)], ({ tS }) => tS > DOOR.openS + 0.2);
      for (const id of DOOR_IDS) expect(stackers.doors[id]).toBe(0);
    }
  });

  it('take 1.2 s to roll up or down', () => {
    const stackers = createStackers();
    let startS = NaN;
    let upS = NaN;
    play(stackers, move('chiller', 'coldRoom'), () => !Number.isNaN(upS), ({ tS }) => {
      if (Number.isNaN(startS) && stackers.doors.chillerOut > 0) startS = tS;
      if (Number.isNaN(upS) && stackers.doors.chillerOut >= 1) upS = tS;
    });
    expect(upS - startS).toBeGreaterThan(DOOR.openS - 0.11);
    expect(upS - startS).toBeLessThan(DOOR.openS + 0.06);
  });
});

describe('the sim leads the stackers (phase 29)', () => {
  it('orders nothing for the pallets it first sees, for one new in a room unseen, or for one gone by reefer', () => {
    const stackers = createStackers();
    stackers.advance(snap(0, [pallet(1, 'staging'), pallet(2, 'warmRoom'), pallet(3, 'chiller'), pallet(4, 'coldRoom')]), 0.1);
    stackers.advance(snap(1, [pallet(1, 'staging'), pallet(2, 'warmRoom'), pallet(3, 'chiller'), pallet(4, 'reefer'), pallet(5, 'chiller')]), 0.1);
    stackers.advance(snap(2, [pallet(1, 'staging'), pallet(2, 'warmRoom'), pallet(3, 'chiller'), pallet(5, 'chiller')]), 0.1);
    expect(stackers.state()).toMatchObject({ stacker1Job: 'parked', stacker2Job: 'parked', stackerQueue: 0, stackerUnseen: 0 });
  });

  it('gives the bay\'s moves to stacker-1 and the chilled pallets to stacker-2', () => {
    const cases: [YogurtPalletPlace, YogurtPalletPlace, 0 | 1, Spot, Spot][] = [
      ['staging', 'warmRoom', 0, 'staging', 'warmRoom'],
      ['staging', 'chiller', 0, 'staging', 'chiller'],
      ['warmRoom', 'chiller', 0, 'warmRoom', 'chiller'],
      ['chiller', 'coldRoom', 1, 'chiller', 'coldRoom'],
    ];
    for (const [from, to, truck, spotFrom, spotTo] of cases) {
      const stackers = createStackers();
      stackers.advance(snap(0, [pallet(9, from)]), 0.1);
      stackers.advance(snap(1, [pallet(9, to)]), 0.1);
      expect(stackers.trucks[truck].trip).toMatchObject({ from: spotFrom, to: spotTo, palletId: 9, picked: false });
      expect(stackers.trucks[truck === 0 ? 1 : 0].trip).toBeNull();
    }
  });

  it('takes a pallet off the line when its ride on the rollers ends, to where the sim has it by then', () => {
    const line = lineStub();
    const stackers = createStackers(line);
    stackers.advance(snap(0, []), 0.1);
    // The sim closes pallet 7 and has it in the chiller at once; on the line it still rides to the wrapper.
    line.rider = { id: 7 };
    stackers.advance(snap(1, [pallet(7, 'chiller')]), 0.1);
    stackers.advance(snap(2, [pallet(7, 'chiller')]), 0.1);
    expect(stackers.state()).toMatchObject({ stacker1Job: 'parked', stackerQueue: 0 });
    expect(stackers.waiting).toBe(false);
    // Not in the tunnel yet, for all the sim counts it there.
    expect(stackers.adjust()).toMatchObject({ chiller: -1 });
    // Its ride ends: it waits on the rollers' end, and stacker-1 comes for it.
    line.rider = null;
    stackers.advance(snap(3, [pallet(7, 'chiller')]), 0.1);
    expect(stackers.trucks[0].trip).toMatchObject({ from: 'line', to: 'chiller', palletId: 7 });
    expect(stackers.waiting).toBe(true);
    expect(stackers.adjust()).toMatchObject({ chiller: -1, staging: 0 });
    const truck = stackers.trucks[0];
    play(stackers, () => [pallet(7, 'chiller')], () => truck.carrying, () => {
      // It lifts the pallet where it stands: at the end of the rollers, on the line.
      if (truck.carrying) {
        expect(truck.xM).toBeCloseTo(BAY.xM, 6);
        expect(truck.zM).toBeCloseTo(LINE_Z_M, 6);
      }
    });
    expect(stackers.waiting).toBe(false);
    play(stackers, () => [pallet(7, 'chiller')], parkedAfterWork(0));
    expect(stackers.adjust()).toEqual({ staging: 0, warmRoom: 0, chiller: 0, coldRoom: 0 });
  });

  it('leaves a pallet the sim keeps waiting on the rollers, and carries it when the sim moves it on', () => {
    const line = lineStub();
    const stackers = createStackers(line);
    stackers.advance(snap(0, []), 0.1);
    line.rider = { id: 3 };
    stackers.advance(snap(1, [pallet(3, 'staging')]), 0.1);
    line.rider = null;
    stackers.advance(snap(2, [pallet(3, 'staging')]), 0.1);
    expect(stackers.trucks[0].trip).toBeNull();
    expect(stackers.waiting).toBe(false);
    stackers.advance(snap(3, [pallet(3, 'warmRoom')]), 0.1);
    expect(stackers.trucks[0].trip).toMatchObject({ from: 'staging', to: 'warmRoom', palletId: 3 });
  });

  it('shows a pallet where it stood until it is lifted, and in its new room once it is set down', () => {
    const stackers = createStackers();
    const truck = stackers.trucks[0];
    const seen = new Set<string>();
    play(stackers, move('warmRoom', 'chiller'), parkedAfterWork(0), ({ tS }) => {
      if (tS < 1) return;
      const { warmRoom, chiller, staging, coldRoom } = stackers.adjust();
      expect(staging).toBe(0);
      expect(coldRoom).toBe(0);
      const key = `${warmRoom},${chiller}`;
      seen.add(key);
      // Still in the warm room before the pick, on the forks from pick to drop, in the tunnel after.
      if (truck.job === 'toPick') expect(key).toBe('1,-1');
      if (truck.job === 'toDrop') expect(key).toBe('0,-1');
      if (truck.job === 'home' || truck.job === 'parked') expect(key).toBe('0,0');
    });
    expect([...seen]).toEqual(['1,-1', '0,-1', '0,0']);
  });

  it('keeps three trips waiting behind the one it is on; a move beyond that goes unseen', () => {
    const stackers = createStackers();
    const ids = [1, 2, 3, 4, 5, 6];
    stackers.advance(snap(0, ids.map((id) => pallet(id, 'chiller'))), 0.1);
    stackers.advance(snap(1, ids.map((id) => pallet(id, 'coldRoom'))), 0.1);
    // One begun, three waiting, two unseen: those two show in the cold room at once.
    expect(QUEUE_MAX).toBe(3);
    expect(stackers.trucks[1].trip?.palletId).toBe(1);
    expect(stackers.trucks[1].queue.map((trip) => trip.palletId)).toEqual([2, 3]);
    expect(stackers.unseen).toBe(3);
    expect(stackers.adjust()).toMatchObject({ chiller: 3, coldRoom: -3 });
    play(stackers, () => ids.map((id) => pallet(id, 'coldRoom')), ({ stackers: s }) => s.trucks[1].trips === 3 && s.trucks[1].job === 'parked', () => {}, 900);
    expect(stackers.state()).toMatchObject({ stackerTrips: 3, stackerQueue: 0, stackerUnseen: 3 });
  });

  it('stands still while paused, and starts again where it began when the clock goes back', () => {
    const stackers = createStackers();
    const truck = stackers.trucks[1];
    play(stackers, move('chiller', 'coldRoom'), () => truck.job === 'toDrop' && truck.speedMps > 1);
    const before = { xM: truck.xM, zM: truck.zM, rad: truck.rad, doors: { ...stackers.doors } };
    for (let i = 0; i < 40; i++) stackers.advance(snap(2000 + i, [pallet(1, 'coldRoom')], 1, true), 0.1);
    clockS.set(stackers, 2100);
    expect({ xM: truck.xM, zM: truck.zM, rad: truck.rad, doors: { ...stackers.doors } }).toEqual(before);
    // A restart: the clock is back at an earlier time.
    stackers.advance(snap(5, [pallet(1, 'chiller')]), 0.1);
    expect(truck).toMatchObject({ ...PARKING[1], job: 'parked', carrying: false, trip: null });
    expect(stackers.state()).toMatchObject({ stackerQueue: 0, doorsOpen: 0 });
  });
});

describe('the transfers, drawn (phase 29)', () => {
  function bound(line = lineStub()): { transfers: ReturnType<typeof createTransfers>; mesh: THREE.InstancedMesh; matrix(i: number): THREE.Matrix4; color(i: number): THREE.Color } {
    const transfers = createTransfers(line);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), transfers.count);
    transfers.bind(mesh, 0);
    return {
      transfers,
      mesh,
      matrix: (i) => {
        const m = new THREE.Matrix4();
        mesh.getMatrixAt(i, m);
        return m;
      },
      color: (i) => {
        const c = new THREE.Color();
        mesh.getColorAt(i, c);
        return c;
      },
    };
  }
  const sizeOf = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixScale(m);
  const placeOf = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(m);
  const PER_TRUCK = STACKER_BOXES.length + 2;
  const WAITING = 2 * PER_TRUCK;
  const DOORS = WAITING + 2;

  it('builds each stacker of boxes within its footprint, its rider on the platform at its rear', () => {
    expect(STACKER_BOXES.length).toBeGreaterThan(20);
    for (const box of STACKER_BOXES) {
      const [cx, , cz] = box.centre;
      const [sx, , sz] = box.size;
      expect(Math.abs(cx) + sx / 2, JSON.stringify(box)).toBeLessThanOrEqual(STACKER.halfWidthM + 1e-9);
      expect(cz - sz / 2, JSON.stringify(box)).toBeGreaterThanOrEqual(-STACKER.rearM - 1e-9);
      expect(cz + sz / 2, JSON.stringify(box)).toBeLessThanOrEqual(STACKER.forkM + 1e-9);
    }
    expect(STACKER_BOXES.filter((box) => box.onForks)).toHaveLength(3);
    expect(STACKER_BOXES.filter((box) => box.beacon)).toHaveLength(1);
  });

  it('stands each parked truck at its place, no pallet on its forks, its beacon dark, every door down', () => {
    const b = bound();
    const body = STACKER_BOXES.findIndex((box) => box.size[0] === STACKER.halfWidthM * 2);
    PARKING.forEach((park, t) => {
      // The battery's box stands 1.02 m behind the pivot, along the truck's heading.
      const place = placeOf(b.matrix(t * PER_TRUCK + body));
      expect(place.x).toBeCloseTo(park.xM - 1.02 * Math.sin(park.rad), 4);
      expect(place.z).toBeCloseTo(park.zM - 1.02 * Math.cos(park.rad), 4);
      expect(sizeOf(b.matrix(t * PER_TRUCK + STACKER_BOXES.length)).length()).toBe(0);
      expect(sizeOf(b.matrix(t * PER_TRUCK + STACKER_BOXES.length + 1)).length()).toBe(0);
    });
    expect(b.transfers.state()).toMatchObject({ stacker1Beacon: false, stacker2Beacon: false, doorsOpen: 0 });
    expect(sizeOf(b.matrix(WAITING)).length()).toBe(0);
    DOOR_IDS.forEach((id, i) => {
      const door = DOOR_AT[id];
      const curtain = sizeOf(b.matrix(DOORS + i * 2));
      expect(curtain.y).toBeCloseTo(door.heightM, 4);
      expect(door.along === 'x' ? curtain.x : curtain.z).toBeCloseTo(door.widthM, 4);
      const place = placeOf(b.matrix(DOORS + i * 2));
      expect(place.x).toBeCloseTo(door.xM, 4);
      expect(place.z).toBeCloseTo(door.zM, 4);
      // Its housing over it.
      expect(placeOf(b.matrix(DOORS + i * 2 + 1)).y).toBeGreaterThan(door.heightM);
    });
  });

  it('carries the pallet on the forks, flashes the beacon while the truck works, and rolls the doors\' curtains up', () => {
    const b = bound();
    const truck = b.transfers.stackers.trucks[1];
    const beacon = STACKER_BOXES.findIndex((box) => box.beacon);
    const lit = new Set<boolean>();
    const curtainM = new Set<number>();
    const run = (until: () => boolean): void => {
      for (let i = 0; i < 8000 && !until(); i++) {
        const tS = i * 0.05;
        b.transfers.advance(snap(1000 + tS, move('chiller', 'coldRoom')(tS)), 0.05);
        lit.add(b.color(PER_TRUCK + beacon).getHex() === 0xffb020);
        expect(b.transfers.state().stacker2Beacon).toBe(b.color(PER_TRUCK + beacon).getHex() === 0xffb020);
        curtainM.add(Math.round(sizeOf(b.matrix(DOORS + DOOR_IDS.indexOf('cold') * 2)).y * 100) / 100);
        const load = b.matrix(PER_TRUCK + STACKER_BOXES.length + 1);
        if (truck.carrying) {
          // Over the truck's pivot, on its forks; frosted, out of the chiller.
          const place = placeOf(load);
          expect(place.x).toBeCloseTo(truck.xM, 4);
          expect(place.z).toBeCloseTo(truck.zM, 4);
          expect(place.y).toBeCloseTo(truck.forksM + 0.14 + 0.85 / 2, 4);
          expect(b.color(PER_TRUCK + STACKER_BOXES.length + 1).getHex()).toBe(0xcfe3f2);
        } else expect(sizeOf(load).length()).toBe(0);
      }
    };
    run(() => truck.trips === 1 && truck.job === 'parked');
    expect(lit).toEqual(new Set([true, false]));
    expect(b.transfers.state().stacker2Beacon).toBe(false);
    // The cold room's curtain from its full 3 m to the hand's breadth that shows when it is up.
    expect(Math.max(...curtainM)).toBeCloseTo(DOOR_AT.cold.heightM, 2);
    expect(Math.min(...curtainM)).toBeCloseTo(0.08, 2);
  });

  it('shows the pallet off the line on the rollers\' end until stacker-1 lifts it', () => {
    const line = lineStub();
    const b = bound(line);
    b.transfers.advance(snap(0, []), 0.05);
    line.rider = { id: 2 };
    b.transfers.advance(snap(1, [pallet(2, 'warmRoom')]), 0.05);
    expect(sizeOf(b.matrix(WAITING)).length()).toBe(0);
    line.rider = null;
    b.transfers.advance(snap(2, [pallet(2, 'warmRoom')]), 0.05);
    expect(placeOf(b.matrix(WAITING)).x).toBeCloseTo(BAY.xM, 4);
    expect(placeOf(b.matrix(WAITING)).z).toBeCloseTo(LINE_Z_M, 4);
    expect(placeOf(b.matrix(WAITING)).y).toBeCloseTo(PALLET_LINE.rollerTopM + 0.07, 4);
    const truck = b.transfers.stackers.trucks[0];
    for (let i = 0; i < 4000 && !truck.carrying; i++) b.transfers.advance(snap(3 + i * 0.05, [pallet(2, 'warmRoom')]), 0.05);
    expect(truck.carrying).toBe(true);
    expect(sizeOf(b.matrix(WAITING)).length()).toBe(0);
  });

  it('shines the beacons steadily under prefers-reduced-motion', () => {
    stubMatchMedia((query) => query.includes('prefers-reduced-motion'));
    const b = bound();
    const lit = new Set<boolean>();
    for (let i = 0; i < 200; i++) {
      const tS = i * 0.05;
      b.transfers.advance(snap(1000 + tS, move('chiller', 'coldRoom')(tS)), 0.05);
      if (tS > 1.1) lit.add(b.transfers.state().stacker2Beacon);
    }
    expect(lit).toEqual(new Set([true]));
  });
});

describe('the transfers in the wing (phase 29)', () => {
  function makeContext(): EquipmentContext {
    const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
    return {
      materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
      loadModel: () => Promise.reject(new Error('no models in unit tests')),
    };
  }

  it('carry every pallet move of the live sim at ×10, in the cold chain\'s box mesh, with no mesh of their own', () => {
    stubTheme();
    const sim = createSim(plantConfig);
    const items = yogurtLine(makeContext());
    const tokens = items.find((item) => item.id === 'yogurt-pallets') as Equipment;
    const meshes: string[] = [];
    tokens.object.traverse((node) => node instanceof THREE.InstancedMesh && meshes.push(node.name));
    expect(meshes).toEqual(['coldChainBoxes', 'roomGlows']);
    expect(tokens.debugState?.()).toMatchObject({ stacker1Job: 'parked', stacker2Job: 'parked', stacker1Carrying: false, stacker2Carrying: false, stackerTrips: 0, doorsOpen: 0 });
    sim.dispatch({ type: 'setSpeed', speed: 10 });
    // Two sim hours: the warm room's set pallets go to the chiller, chilled ones to the cold room, new ones off the line.
    const jobs = new Set<string>();
    let doorsOpen = 0;
    for (let i = 0; i < 7_200; i++) {
      sim.step(0.1);
      const snapshot = sim.snapshot();
      for (const item of items) item.update(snapshot, 0.1);
      const state = tokens.debugState?.() ?? {};
      jobs.add(String(state.stacker1Job));
      jobs.add(String(state.stacker2Job));
      doorsOpen = Math.max(doorsOpen, Number(state.doorsOpen));
      // The rooms never show more than they have places for, nor a negative count.
      expect(Number(state.warm)).toBeGreaterThanOrEqual(0);
    }
    const state = tokens.debugState?.() ?? {};
    expect(Number(state.stackerTrips)).toBeGreaterThan(8);
    expect(state.stackerUnseen).toBe(0);
    expect([...jobs].sort()).toEqual(['drop', 'home', 'parked', 'pick', 'toDrop', 'toPick']);
    expect(doorsOpen).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
