// Stage 16's pallet transfers (phase 29, D31), headless: two electric stacker trucks, each with its rider, carry the
// pallets between the line and the rooms, and the rooms' rapid doors open for them. No three.js: dispatchBoxes.ts draws
// what this module says.
//
// stacker-1 works in the transfer bay south of the wrapper, between the warm room and the blast chiller: it takes a
// wrapped pallet off the end of the line's rollers to the chiller's west mouth (stirred) or to the warm room's door
// (set), and a set pallet from the warm room to the chiller. stacker-2 works in the aisle east of the chiller: it takes
// a chilled pallet from the tunnel's east mouth round the end of the line to the cold room's doorway.
//
// A stacker turns on the spot about its load wheels, under the pallet, so its rear swings 1.65 m round: every turn is
// made where that is clear, and every drive is straight along its forks (stackers.test.ts walks each trip against the
// rooms' walls). The trips follow the sim: a pallet that changes place in the snapshot sets one off, and a pallet off
// the line when its ride on the rollers ends (palletLine.ts). One trip at a time for each truck, three more queued;
// beyond that a pallet changes place unseen, as all did before phase 29.
import type { Snapshot, YogurtPallet, YogurtPalletPlace } from '../../../contracts';
import { motionDtS } from '../../motion';
import * as at from './layout';
import { yogurtOf } from './readings';

/* the truck */

/** A stacker from its pivot (the middle of its load wheels, under the pallet): its rear, its half width, its fork tips. */
export const STACKER = { rearM: 1.6, halfWidthM: 0.4, forkM: 0.6 } as const;
/** How it moves (D31): metres a second empty, with a pallet, and into a door or to a pick; turning; its forks. */
export const STACKER_MOVES = {
  emptyMps: 1.6,
  loadedMps: 1.2,
  creepMps: 0.5,
  /** The last metres of a drive into a pick or a drop, and the first out of one, are at the creep. */
  creepM: 1.5,
  accelMps2: 1.2,
  turnRadPerS: Math.PI / 3,
  forksMps: 0.15,
  /** It lifts a pallet this far clear of where it stood to carry it. */
  liftM: 0.2,
  /** The forks' top when parked. */
  downM: 0.05,
} as const;
/** Trips a truck keeps waiting behind the one it is on. */
export const QUEUE_MAX = 3;

/** Headings (rotation.y, the forks pointing along (sin, cos)): north is −z. */
const N = Math.PI;
const E = Math.PI / 2;
const S = 0;
const W = -Math.PI / 2;

/* the doors */

export type DoorId = 'warm' | 'chillerIn' | 'chillerOut' | 'cold';
export const DOOR_IDS: readonly DoorId[] = ['warm', 'chillerIn', 'chillerOut', 'cold'];
/** A rapid door: seconds to roll up or down; it opens for a stacker within NEAR_M, and stays up within HOLD_M. */
export const DOOR = { openS: 1.2, nearM: 3, holdM: 1.4 } as const;

const chillerZM = (at.BLAST_CHILLER.zMinM + at.BLAST_CHILLER.zMaxM) / 2;
/** Each door's middle on the floor, and whether its opening lies along x (the cold room's) or along z. */
export const DOOR_AT: Readonly<Record<DoorId, { xM: number; zM: number; along: 'x' | 'z'; widthM: number; heightM: number }>> = {
  warm: { xM: at.WARM_ROOM.xMaxM, zM: at.WARM_DOOR.zM, along: 'z', widthM: at.WARM_DOOR.widthM, heightM: 2.6 },
  chillerIn: { xM: at.BLAST_CHILLER.xMinM, zM: chillerZM, along: 'z', widthM: at.BLAST_CHILLER.zMaxM - at.BLAST_CHILLER.zMinM - 0.15, heightM: at.BLAST_CHILLER.heightM - 0.45 },
  chillerOut: { xM: at.BLAST_CHILLER.xMaxM, zM: chillerZM, along: 'z', widthM: at.BLAST_CHILLER.zMaxM - at.BLAST_CHILLER.zMinM - 0.15, heightM: at.BLAST_CHILLER.heightM - 0.45 },
  cold: { xM: at.COLD_DOORWAY.xM, zM: at.COLD_ROOM.zMaxM, along: 'x', widthM: at.COLD_DOORWAY.widthM, heightM: 3 },
};

/* where the pallets stand, and the trucks' lanes */

/** Where a stacker picks a pallet up or sets it down: `line` is the end of the wrapper's rollers, as `staging` is. */
export type Spot = 'line' | 'staging' | 'warmRoom' | 'chiller' | 'coldRoom';

/** The chiller's roller track's top, and the first and last places on it (coldChainScene.ts CHILLER_PLACES). */
const TRACK_TOP_M = 0.4;
const chillerPitchM = (at.BLAST_CHILLER.xMaxM - at.BLAST_CHILLER.xMinM - 0.4) / 4;
const CHILLER_FIRST_X_M = at.BLAST_CHILLER.xMinM + 0.2 + chillerPitchM / 2;
const CHILLER_LAST_X_M = at.BLAST_CHILLER.xMaxM - 0.2 - chillerPitchM / 2;

/** stacker-1's lane: north–south under the end of the rollers, where the wrapped pallet waits (palletLine.ts LEAVE_X_M). */
export const BAY = {
  xM: at.PALLET_LINE.outfeed.xMinM + 0.75,
  /** The pallet on the rollers; where the truck stands parked, facing the line; the chiller's lane; the warm door's. */
  pickZM: at.LINE_Z_M,
  parkZM: at.LINE_Z_M + 2.8,
  chillerZM,
  warmZM: at.WARM_DOOR.zM,
  /** A pallet set down inside the warm room's door, and one on the chiller's track. */
  warmXM: at.WARM_ROOM.xMaxM - 0.7,
  chillerXM: CHILLER_FIRST_X_M,
} as const;

/** stacker-2's: the aisle east of the chiller and the corridor north of the line, to the cold room's doorway. */
export const AISLE = {
  xM: at.BLAST_CHILLER.xMaxM + 1.8,
  chillerZM,
  pickXM: CHILLER_LAST_X_M,
  /** The corridor: a stacker's rear swings 1.65 m south of it at the doorway, short of the line's rollers. */
  corridorZM: at.COLD_ROOM.zMaxM + 0.85,
  doorXM: at.COLD_DOORWAY.xM,
  /** A pallet set down in the doorway. */
  dropZM: at.COLD_ROOM.zMaxM - 0.1,
} as const;

/** Where a pallet stands at each spot: its underside's height there, and how long it is along the forks that take it. */
const REST_M: Readonly<Record<Spot, number>> = { line: at.PALLET_LINE.rollerTopM, staging: at.PALLET_LINE.rollerTopM, warmRoom: 0, chiller: TRACK_TOP_M, coldRoom: 0 };

/* a trip's steps */

export type Job = 'parked' | 'toPick' | 'pick' | 'toDrop' | 'drop' | 'home';

type Step =
  | { kind: 'job'; job: Job }
  | { kind: 'drive'; xM: number; zM: number; reverse?: boolean; creepIn?: boolean; creepOut?: boolean }
  | { kind: 'turn'; rad: number }
  | { kind: 'forks'; m: number }
  /** Stands until the pallet is at the pick (a pallet still riding the line's rollers). */
  | { kind: 'await' }
  | { kind: 'grab' }
  | { kind: 'release' };

const job = (name: Job): Step => ({ kind: 'job', job: name });
const drive = (xM: number, zM: number, how: { reverse?: boolean; creepIn?: boolean; creepOut?: boolean } = {}): Step => ({ kind: 'drive', xM, zM, ...how });
const turn = (rad: number): Step => ({ kind: 'turn', rad });
const forks = (m: number): Step => ({ kind: 'forks', m });

/** stacker-1's trips, each from its parking place, facing the line, and back to it. */
function bayPlan(from: Spot, to: Spot): Step[] {
  const { xM, pickZM, parkZM, chillerZM: laneZM, warmZM, warmXM, chillerXM } = BAY;
  const steps: Step[] = [job('toPick')];
  if (from === 'warmRoom') {
    steps.push(drive(xM, warmZM, { reverse: true }), turn(W), forks(STACKER_MOVES.downM), drive(warmXM, warmZM, { creepIn: true }), job('pick'), { kind: 'grab' }, forks(STACKER_MOVES.liftM));
    steps.push(job('toDrop'), drive(xM, warmZM, { reverse: true, creepOut: true }), turn(N), drive(xM, laneZM));
  } else {
    steps.push(forks(REST_M.line), drive(xM, pickZM, { creepIn: true }), { kind: 'await' }, job('pick'), { kind: 'grab' }, forks(REST_M.line + STACKER_MOVES.liftM));
    steps.push(job('toDrop'), drive(xM, to === 'warmRoom' ? warmZM : laneZM, { reverse: true, creepOut: true }));
  }
  if (to === 'warmRoom') {
    steps.push(turn(W), drive(warmXM, warmZM, { creepIn: true }), job('drop'), forks(REST_M.warmRoom), { kind: 'release' });
    steps.push(job('home'), drive(xM, warmZM, { reverse: true, creepOut: true }), forks(STACKER_MOVES.downM), turn(N), drive(xM, parkZM));
  } else {
    steps.push(turn(E), forks(TRACK_TOP_M + 0.05), drive(chillerXM, laneZM, { creepIn: true }), job('drop'), forks(TRACK_TOP_M), { kind: 'release' });
    steps.push(job('home'), drive(xM, laneZM, { reverse: true, creepOut: true }), forks(STACKER_MOVES.downM), turn(N), drive(xM, parkZM));
  }
  steps.push(job('parked'));
  return steps;
}

/** stacker-2's one trip: from the chiller's east mouth round the end of the line to the cold room's doorway. */
function aislePlan(): Step[] {
  const { xM, chillerZM: laneZM, pickXM, corridorZM, doorXM, dropZM } = AISLE;
  return [
    job('toPick'),
    forks(TRACK_TOP_M),
    drive(pickXM, laneZM, { creepIn: true }),
    job('pick'),
    { kind: 'grab' },
    forks(TRACK_TOP_M + STACKER_MOVES.liftM),
    job('toDrop'),
    drive(xM, laneZM, { reverse: true, creepOut: true }),
    turn(N),
    drive(xM, corridorZM),
    turn(W),
    drive(doorXM, corridorZM),
    turn(N),
    drive(doorXM, dropZM, { creepIn: true }),
    job('drop'),
    forks(REST_M.coldRoom),
    { kind: 'release' },
    job('home'),
    drive(doorXM, corridorZM, { reverse: true, creepOut: true }),
    forks(STACKER_MOVES.downM),
    turn(E),
    drive(xM, corridorZM),
    turn(S),
    drive(xM, laneZM),
    turn(W),
    job('parked'),
  ];
}

/** The doors a trip goes through: at its pick and at its drop. */
function doorsOf(from: Spot, to: Spot): { pick: DoorId | null; drop: DoorId | null } {
  const door = (spot: Spot, picking: boolean): DoorId | null => (spot === 'warmRoom' ? 'warm' : spot === 'chiller' ? (picking ? 'chillerOut' : 'chillerIn') : spot === 'coldRoom' ? 'cold' : null);
  return { pick: door(from, true), drop: door(to, false) };
}

/* the trucks */

export interface Trip {
  readonly from: Spot;
  readonly to: Spot;
  readonly palletId: number;
  /** The pallet stands at the pick: false while a pallet off the line still rides its rollers. */
  ready: boolean;
  picked: boolean;
}

export interface Truck {
  readonly id: 1 | 2;
  xM: number;
  zM: number;
  /** rotation.y: its forks point along (sin, cos). */
  rad: number;
  /** The forks' top above the floor. */
  forksM: number;
  speedMps: number;
  job: Job;
  /** The trip it is on, and those waiting. */
  trip: Trip | null;
  readonly queue: Trip[];
  /** True between pick and drop. */
  carrying: boolean;
  /** Trips it has finished. */
  trips: number;
  /** Motion seconds it has been working, for its beacon's flash. */
  workS: number;
}

export interface Stackers {
  readonly trucks: readonly [Truck, Truck];
  /** Each door, 0 down to 1 up. */
  readonly doors: Readonly<Record<DoorId, number>>;
  /** A pallet off the line waits on the rollers' end for stacker-1. */
  readonly waiting: boolean;
  /** Trips that found their truck's queue full, and so were not shown. */
  readonly unseen: number;
  /** Moves the trucks on with the sim's pallets: once a frame. */
  advance(snapshot: Snapshot, realDtS: number): void;
  /**
   * Pallets to add to what each room shows: a pallet the sim already counts in its new room stands where it was until
   * its stacker lifts it, and shows in the new room once it is set down.
   */
  adjust(): Readonly<Record<'staging' | 'warmRoom' | 'chiller' | 'coldRoom', number>>;
  state(): { stacker1Job: Job; stacker2Job: Job; stacker1Carrying: boolean; stacker2Carrying: boolean; stackerTrips: number; stackerQueue: number; stackerUnseen: number; doorsOpen: number };
}

/** The pallet line as the stackers read it: the wrapped pallet riding to the rollers' end, or null. */
export interface LineView {
  readonly rider: { readonly id: number } | null;
}

const PARK: readonly [{ xM: number; zM: number; rad: number }, { xM: number; zM: number; rad: number }] = [
  { xM: BAY.xM, zM: BAY.parkZM, rad: N },
  { xM: AISLE.xM, zM: AISLE.chillerZM, rad: W },
];

/** The shortest turn from `from` to `to`, in (−π, π]. */
function turnBy(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function createStackers(line: LineView = { rider: null }): Stackers {
  const newTruck = (id: 1 | 2): Truck => ({ id, ...PARK[id - 1], forksM: STACKER_MOVES.downM, speedMps: 0, job: 'parked', trip: null, queue: [], carrying: false, trips: 0, workS: 0 });
  const trucks: [Truck, Truck] = [newTruck(1), newTruck(2)];
  const plans: [Step[], Step[]] = [[], []];
  const stepAt: [number, number] = [0, 0];
  /** Metres into the drive the truck is on. */
  const drivenM: [number, number] = [0, 0];
  /** The doors of the trip each truck is on, until it is parked again. */
  const through: [{ pick: DoorId | null; drop: DoorId | null }, { pick: DoorId | null; drop: DoorId | null }] = [{ pick: null, drop: null }, { pick: null, drop: null }];
  const doors: Record<DoorId, number> = { warm: 0, chillerIn: 0, chillerOut: 0, cold: 0 };
  /** Where each pallet stood in the last snapshot; `line` while it still rides the rollers. */
  const seen = new Map<number, YogurtPalletPlace | 'line'>();
  let riderId: number | null = null;
  let started = false;
  let lastTimeS = -Infinity;
  let last: Snapshot | null = null;
  let unseen = 0;
  const adjustment = { staging: 0, warmRoom: 0, chiller: 0, coldRoom: 0 };

  function reset(): void {
    trucks.forEach((truck, i) => {
      Object.assign(truck, PARK[i], { forksM: STACKER_MOVES.downM, speedMps: 0, job: 'parked', trip: null, carrying: false, workS: 0 });
      truck.queue.length = 0;
      plans[i as 0 | 1] = [];
      stepAt[i as 0 | 1] = 0;
    });
    for (const id of DOOR_IDS) doors[id] = 0;
    seen.clear();
    riderId = null;
    started = false;
  }

  function order(truck: Truck, from: Spot, to: Spot, palletId: number, ready: boolean): void {
    // One pallet at a time waits on the rollers' end: a second off the line before the first is lifted goes unseen.
    const lineBusy = from === 'line' && [truck.trip, ...truck.queue].some((trip) => trip !== null && trip.from === 'line' && !trip.picked);
    if (truck.queue.length >= QUEUE_MAX || lineBusy) {
      unseen += 1;
      return;
    }
    truck.queue.push({ from, to, palletId, ready, picked: false });
  }

  /** The sim's pallets: a trip for each that changed place since the last snapshot. */
  function observe(pallets: readonly YogurtPallet[]): void {
    const rider = line.rider;
    if (!started) {
      for (const pallet of pallets) seen.set(pallet.id, pallet.place);
      // A pallet already on the rollers when the view opens rides on, and is carried from their end.
      if (rider) seen.set(rider.id, 'line');
      riderId = rider?.id ?? null;
      started = true;
      return;
    }
    const placeOf = new Map<number, YogurtPalletPlace>();
    for (const pallet of pallets) placeOf.set(pallet.id, pallet.place);
    // A new rider on the line: the sim has it in a room already, but it is carried there only once its ride is over.
    if (rider && rider.id !== riderId) seen.set(rider.id, 'line');
    // The rider's ride is over: the pallet stands on the rollers' end, and stacker-1 takes it to where the sim has it.
    if (riderId !== null && rider?.id !== riderId) {
      const place = placeOf.get(riderId);
      if (place === 'warmRoom' || place === 'chiller') order(trucks[0], 'line', place, riderId, true);
      if (place === undefined) seen.delete(riderId);
      else seen.set(riderId, place);
    }
    riderId = rider?.id ?? null;
    for (const pallet of pallets) {
      const before = seen.get(pallet.id);
      if (before === 'line') continue;
      if (before !== undefined && before !== pallet.place) {
        if (before === 'staging' && (pallet.place === 'warmRoom' || pallet.place === 'chiller')) order(trucks[0], 'staging', pallet.place, pallet.id, true);
        else if (before === 'warmRoom' && pallet.place === 'chiller') order(trucks[0], 'warmRoom', 'chiller', pallet.id, true);
        else if (before === 'chiller' && pallet.place === 'coldRoom') order(trucks[1], 'chiller', 'coldRoom', pallet.id, true);
      }
      seen.set(pallet.id, pallet.place);
    }
    // Pallets that left by reefer are forgotten.
    if (seen.size > placeOf.size + 8) {
      for (const id of seen.keys()) if (!placeOf.has(id) && id !== riderId) seen.delete(id);
    }
  }

  /** Moves a truck on by `dtS` motion seconds along its plan. */
  function run(truck: Truck, dtS: number): void {
    const i = (truck.id - 1) as 0 | 1;
    let leftS = dtS;
    for (let guard = 0; guard < 64; guard++) {
      if (stepAt[i] >= plans[i].length) {
        // Parked: the next trip, if one waits.
        const next = truck.queue.shift();
        if (!next) {
          truck.trip = null;
          truck.speedMps = 0;
          return;
        }
        truck.trip = next;
        through[i] = doorsOf(next.from, next.to);
        plans[i] = truck.id === 1 ? bayPlan(next.from, next.to) : aislePlan();
        stepAt[i] = 0;
        drivenM[i] = 0;
        truck.workS = 0;
      }
      const step = plans[i][stepAt[i]] as Step;
      let done = false;
      switch (step.kind) {
        case 'job':
          truck.job = step.job;
          done = true;
          break;
        case 'grab':
          truck.carrying = true;
          if (truck.trip) truck.trip.picked = true;
          done = true;
          break;
        case 'release':
          truck.carrying = false;
          truck.trips += 1;
          // The trip is over for the rooms' counts: the pallet shows where the sim has it.
          truck.trip = null;
          done = true;
          break;
        case 'await':
          truck.speedMps = 0;
          if (!truck.trip || truck.trip.ready) done = true;
          else leftS = 0;
          break;
        case 'forks': {
          const gapM = step.m - truck.forksM;
          const moveM = STACKER_MOVES.forksMps * leftS;
          if (Math.abs(gapM) <= moveM) {
            leftS -= Math.abs(gapM) / STACKER_MOVES.forksMps;
            truck.forksM = step.m;
            done = true;
          } else {
            truck.forksM += Math.sign(gapM) * moveM;
            leftS = 0;
          }
          break;
        }
        case 'turn': {
          const gapRad = turnBy(truck.rad, step.rad);
          const moveRad = STACKER_MOVES.turnRadPerS * leftS;
          truck.speedMps = 0;
          if (Math.abs(gapRad) <= moveRad) {
            leftS -= Math.abs(gapRad) / STACKER_MOVES.turnRadPerS;
            truck.rad = step.rad;
            done = true;
          } else {
            truck.rad += Math.sign(gapRad) * moveRad;
            leftS = 0;
          }
          break;
        }
        case 'drive': {
          const dxM = step.xM - truck.xM;
          const dzM = step.zM - truck.zM;
          const gapM = Math.hypot(dxM, dzM);
          if (gapM < 1e-6) {
            truck.xM = step.xM;
            truck.zM = step.zM;
            truck.speedMps = 0;
            done = true;
            break;
          }
          const topMps = truck.carrying ? STACKER_MOVES.loadedMps : STACKER_MOVES.emptyMps;
          const creeping = (step.creepIn && gapM <= STACKER_MOVES.creepM) || (step.creepOut && drivenM[i] < STACKER_MOVES.creepM);
          const wantMps = creeping ? STACKER_MOVES.creepMps : topMps;
          // It gathers speed and brakes at accelMps2; it is slow enough to stop at the drive's end, or to creep in.
          const endMps = 0.12;
          const canMps = step.creepIn && gapM > STACKER_MOVES.creepM ? Math.sqrt(STACKER_MOVES.creepMps ** 2 + 2 * STACKER_MOVES.accelMps2 * (gapM - STACKER_MOVES.creepM)) : Infinity;
          const stopMps = Math.sqrt(endMps * endMps + 2 * STACKER_MOVES.accelMps2 * gapM);
          const limitMps = Math.min(wantMps, canMps, stopMps);
          truck.speedMps = Math.min(limitMps, truck.speedMps + STACKER_MOVES.accelMps2 * leftS);
          truck.speedMps = Math.max(truck.speedMps, Math.min(endMps, limitMps));
          const moveM = truck.speedMps * leftS;
          if (moveM >= gapM) {
            leftS -= gapM / Math.max(truck.speedMps, 1e-6);
            truck.xM = step.xM;
            truck.zM = step.zM;
            drivenM[i] += gapM;
            done = true;
          } else {
            truck.xM += (dxM / gapM) * moveM;
            truck.zM += (dzM / gapM) * moveM;
            drivenM[i] += moveM;
            leftS = 0;
          }
          break;
        }
      }
      // Out of time inside the step, or waiting for its pallet. A step that takes no time (a job's name, taking hold,
      // letting go) is done at once, so the truck's state is current when the frame ends.
      if (!done) return;
      stepAt[i] += 1;
      drivenM[i] = 0;
    }
  }

  /** Each door rolls up for a stacker near it on a trip through it, and down behind it. */
  function moveDoors(dtS: number): void {
    for (const id of DOOR_IDS) {
      const door = DOOR_AT[id];
      let wanted = false;
      for (const truck of trucks) {
        const i = (truck.id - 1) as 0 | 1;
        if (stepAt[i] >= plans[i].length) continue;
        const awayM = Math.hypot(truck.xM - door.xM, truck.zM - door.zM);
        const doorsNow = through[i];
        const toIt = (doorsNow.pick === id && (truck.job === 'toPick' || truck.job === 'pick')) || (doorsNow.drop === id && (truck.job === 'toDrop' || truck.job === 'drop'));
        // Its forks, or its pallet, are still in the doorway while it backs out.
        const inIt = awayM <= DOOR.holdM && (doorsNow.pick === id || doorsNow.drop === id);
        if ((toIt && awayM <= DOOR.nearM) || inIt) wanted = true;
      }
      const stepFrac = dtS / DOOR.openS;
      doors[id] = wanted ? Math.min(1, doors[id] + stepFrac) : Math.max(0, doors[id] - stepFrac);
    }
  }

  function countAdjustment(placeOf: ReadonlyMap<number, YogurtPalletPlace>): void {
    adjustment.staging = 0;
    adjustment.warmRoom = 0;
    adjustment.chiller = 0;
    adjustment.coldRoom = 0;
    const room = (spot: Spot | YogurtPalletPlace | undefined): 'staging' | 'warmRoom' | 'chiller' | 'coldRoom' | null => (spot === 'staging' || spot === 'warmRoom' || spot === 'chiller' || spot === 'coldRoom' ? spot : null);
    // The pallet riding the rollers is not in its room yet.
    if (riderId !== null) {
      const to = room(placeOf.get(riderId));
      if (to && to !== 'staging') adjustment[to] -= 1;
    }
    for (const truck of trucks) {
      for (const trip of [truck.trip, ...truck.queue]) {
        if (!trip) continue;
        const from = room(trip.from);
        if (!trip.picked && from) adjustment[from] += 1;
        const to = room(trip.to);
        if (to) adjustment[to] -= 1;
      }
    }
  }

  return {
    trucks,
    doors,
    get waiting() {
      return [trucks[0].trip, ...trucks[0].queue].some((trip) => trip !== null && trip.from === 'line' && trip.ready && !trip.picked);
    },
    get unseen() {
      return unseen;
    },
    advance(snapshot, realDtS) {
      if (snapshot === last) return;
      last = snapshot;
      // The clock went back (a restart): everything stands where it began.
      if (snapshot.timeS < lastTimeS - 1) reset();
      lastTimeS = snapshot.timeS;
      const pallets = yogurtOf(snapshot)?.coldChain.pallets ?? [];
      observe(pallets);
      const dtS = motionDtS(snapshot, realDtS);
      if (dtS > 0) {
        for (const truck of trucks) {
          run(truck, dtS);
          if (truck.job !== 'parked') truck.workS += dtS;
        }
        moveDoors(dtS);
      }
      const placeOf = new Map<number, YogurtPalletPlace>();
      for (const pallet of pallets) placeOf.set(pallet.id, pallet.place);
      countAdjustment(placeOf);
    },
    adjust: () => adjustment,
    state() {
      return {
        stacker1Job: trucks[0].job,
        stacker2Job: trucks[1].job,
        stacker1Carrying: trucks[0].carrying,
        stacker2Carrying: trucks[1].carrying,
        stackerTrips: trucks[0].trips + trucks[1].trips,
        stackerQueue: trucks[0].queue.length + trucks[1].queue.length,
        stackerUnseen: unseen,
        doorsOpen: DOOR_IDS.filter((id) => doors[id] >= 1).length,
      };
    },
  };
}

/** For tests and the drawing: the steps of a trip as points and headings, in order. */
export function tripSteps(truckId: 1 | 2, from: Spot, to: Spot): readonly Readonly<Step>[] {
  return truckId === 1 ? bayPlan(from, to) : aislePlan();
}
export const PARKING: typeof PARK = PARK;
export type { Step as StackerStep };
