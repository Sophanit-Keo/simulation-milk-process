// The trucks at the dock doors (phase 12, D22), headless: the docking manoeuvre's path, the tractor's turn at
// the kingpin and the timing, fitted to the sim's. No three.js and no DOM; packsLine.ts puts the trucks where
// this module says.
//
// A truck drives in along the yard's lane from the road at the west (-x), past its door, and stops; its rear
// doors swing open; it backs along a curve into the dock (the trailer's path is the curve, the tractor follows
// its kingpin); the dock's roller door rises and it loads; then the roller door comes down, the truck creeps
// out a little to close its doors, pulls out along the same curve and drives away east. The curve is the
// trailer bogie's: straight out of the dock, then a quarter turn east whose curvature eases in and out, so the
// tractor's angle (atan of the trailer's wheelbase times the curvature) grows and shrinks smoothly and stays
// under 0.6 rad. Checked against the trucks docked at the other doors and those parked in the yard.
import { DOCKED_TAIL_Z_M } from './layout';

export type BayPhase = 'away' | 'arriving' | 'opening' | 'reversing' | 'docked' | 'closing' | 'leaving';

/** Motion seconds per move (D22): rear doors, reversing, the roller door, closing up before leaving. */
export const TRUCK_MOVES_S = { doors: 3, reverse: 10, roller: 3, close: 3 } as const;
/** While closing, the truck first creeps this far out of the dock, so its doors swing clear of the dock wall. */
export const CREEP_M = 1.5;
const CREEP_S = 1.2;
/** The doors close over the end of the closing move. */
const DOORS_CLOSE_FROM_S = 1.0;

/** The truck's frame (facing +z, origin at its footprint centre): the trailer's bogie, its tail and the kingpin. */
export const BOGIE_Z_M = -5.75;
const TAIL_Z_M = -8.25;
export const KINGPIN_Z_M = 3.7;
/** The trailer's wheelbase, bogie to kingpin. */
export const TRAILER_BASE_M = KINGPIN_Z_M - BOGIE_Z_M;
/** The most the tractor turns off the trailer (phase-12 card), and the most this path asks of it. */
export const MAX_ARTICULATION_RAD = 0.6;
const PATH_ARTICULATION_RAD = 0.59;

/** The shape of a yard's way out of its docks: how far a truck pulls straight out, and how hard it then turns. */
export interface PathSpec {
  /** Straight out of the dock before the turn begins, metres. */
  straightOutM: number;
  /** The tractor's angle off the trailer on the turn's arc, radians. */
  articulationRad: number;
}

/** The UHT yard's (phase 12): its doors stand 8 m apart, so a truck may begin its turn 3 m out of the dock. */
const UHT_PATH_SPEC: Readonly<PathSpec> = { straightOutM: 3, articulationRad: PATH_ARTICULATION_RAD };
/** A path is straight, then a quarter turn east, eased in and out over EASE_M at each end. */
const EASE_M = 3;
/** A path's table is sampled every TABLE_STEP_M up to the turn's end. */
const TABLE_STEP_M = 0.1;

/** The bogie when docked: the tail at the bumpers. */
const DOCKED_BOGIE_Z_M = DOCKED_TAIL_Z_M + (BOGIE_Z_M - TAIL_Z_M);

/** The road: trucks come in from beyond the floor's west edge and leave beyond its east edge (bogie x). */
const ROAD_IN_X_M = -89;
const ROAD_OUT_X_M = 53;
/** Where a yard's trucks come onto the floor and where they leave it (bogie x, in the dock's frame). */
export interface Road {
  inXM: number;
  outXM: number;
}
export const UHT_ROAD: Readonly<Road> = { inXM: ROAD_IN_X_M, outXM: ROAD_OUT_X_M };
/** Driving in: along the lane at road speed, braking to a stop at the stop point. */
const ARRIVE_MPS = 9;
const BRAKE_MPS2 = 2.2;
/** Driving away: from a standstill, gathering speed up to the road speed. */
const LEAVE_MPS = 12;
const LEAVE_MPS2 = 1.5;

/** A truck closing up while it still has this many motion seconds of loading left opens up again (the sim slowed down). */
const REOPEN_S = 2 * TRUCK_MOVES_S.close;
/** How much faster than the plan a move may play before it is skipped instead (fitting the sim's time). */
const MAX_PLAY_RATE = 10;
/** The rate a truck that the sim has already sent away, or whose door another truck waits for, plays at. */
const HURRY_RATE = 4;

/** Where a truck stands and how its tractor is turned: footprint centre, heading (rotation.y), tractor angle. */
export interface TruckPose {
  xM: number;
  zM: number;
  headingRad: number;
  tractorRad: number;
}

function setPose(out: TruckPose, bogieX: number, bogieZ: number, headingRad: number, tractorRad: number): TruckPose {
  // The footprint centre lies ahead of the bogie by -BOGIE_Z_M along the heading.
  out.xM = bogieX - BOGIE_Z_M * Math.sin(headingRad);
  out.zM = bogieZ - BOGIE_Z_M * Math.cos(headingRad);
  out.headingRad = headingRad;
  out.tractorRad = tractorRad;
  return out;
}

const lerp = (a: Float64Array, i: number, k: number): number => (a[i] as number) + ((a[i + 1] as number) - (a[i] as number)) * k;

/**
 * A yard's path out of a dock, in the UHT dock's frame (the dock faces +z, the lane runs east): straight out, a
 * quarter turn east, then the lane. Lengths are the bogie's along the path, 0 when docked. The UHT yard's is
 * UHT_PATH; the yogurt wing's reefer yard, whose doors stand closer, has its own (phase 29, yogurt/reeferTruck.ts).
 */
export interface DockPath {
  readonly spec: Readonly<PathSpec>;
  /** Path length at which the turn ends and the lane begins. */
  readonly turnEndM: number;
  /** Where an arriving truck stops, its trailer straight on the lane a little past the turn. */
  readonly stopM: number;
  /** The lane trucks drive along: the bogie's z there. */
  readonly laneZM: number;
  /** Curvature of the bogie's path at path length `s` (1/m, positive turning east). */
  kappa(s: number): number;
  /** The tractor's angle off the trailer at path length `s`: along its kingpin's direction of travel. */
  articulationRad(s: number): number;
  /** The truck at path length `s` out of the dock at `doorXM` (0 is docked; past the turn it runs east on the lane). */
  pullOutPose(doorXM: number, s: number, out: TruckPose): TruckPose;
  /** Motion seconds to drive in from the road at `roadInXM` and stop at a door's stop point. */
  arriveS(doorXM: number, roadInXM: number): number;
  /** The truck driving in, `tS` motion seconds after it left the road. */
  arrivalPose(doorXM: number, tS: number, out: TruckPose, roadInXM: number): TruckPose;
  /** Motion seconds a truck for `doorXM` takes to drive away until its bogie is at `roadOutXM`, off the floor. */
  leaveDurationS(doorXM: number, roadOutXM: number): number;
}

export function createDockPath(spec: Readonly<PathSpec>): DockPath {
  const turnKappa = Math.tan(spec.articulationRad) / TRAILER_BASE_M;
  const arcM = Math.PI / 2 / turnKappa - EASE_M;
  const turnEndM = spec.straightOutM + 2 * EASE_M + arcM;
  const stopM = turnEndM + 2;

  const kappa = (s: number): number => {
    let t = s - spec.straightOutM;
    if (t <= 0) return 0;
    if (t < EASE_M) return turnKappa * (t / EASE_M);
    t -= EASE_M;
    if (t < arcM) return turnKappa;
    t -= arcM;
    if (t < EASE_M) return turnKappa * (1 - t / EASE_M);
    return 0;
  };
  const articulation = (s: number): number => Math.atan(TRAILER_BASE_M * kappa(s));

  // The bogie's path, relative to the door's x, up to the turn's end.
  const count = Math.ceil(turnEndM / TABLE_STEP_M) + 1;
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const heading = new Float64Array(count);
  let px = 0;
  let pz = DOCKED_BOGIE_Z_M;
  let ph = 0;
  const sub = 10;
  const ds = TABLE_STEP_M / sub;
  for (let i = 0; i < count; i++) {
    x[i] = px;
    z[i] = pz;
    heading[i] = ph;
    for (let k = 0; k < sub; k++) {
      const s = i * TABLE_STEP_M + k * ds;
      // Midpoint rule for the position, Simpson's for the heading (exact for piecewise-linear curvature).
      const mid = ph + (kappa(s) * ds) / 4 + (kappa(s + ds / 2) * ds) / 4;
      px += Math.sin(mid) * ds;
      pz += Math.cos(mid) * ds;
      ph += ((kappa(s) + 4 * kappa(s + ds / 2) + kappa(s + ds)) / 6) * ds;
    }
  }
  const laneZM = z[count - 1] as number;
  const turnEndDxM = x[count - 1] as number;
  const tableEndS = (count - 1) * TABLE_STEP_M;

  const pullOutPose = (doorXM: number, s: number, out: TruckPose): TruckPose => {
    if (s >= tableEndS) return setPose(out, doorXM + turnEndDxM + (s - tableEndS), laneZM, Math.PI / 2, 0);
    const at = Math.max(0, s) / TABLE_STEP_M;
    const i = Math.min(Math.floor(at), count - 2);
    const k = at - i;
    return setPose(out, doorXM + lerp(x, i, k), lerp(z, i, k), lerp(heading, i, k), articulation(s));
  };

  /** The bogie's x on the lane where a truck for `doorXM` stops. */
  const stopXM = (doorXM: number): number => doorXM + turnEndDxM + (stopM - tableEndS);

  const arriveS = (doorXM: number, roadInXM: number): number => {
    const distanceM = stopXM(doorXM) - roadInXM;
    const brakeM = (ARRIVE_MPS * ARRIVE_MPS) / (2 * BRAKE_MPS2);
    return (distanceM - brakeM) / ARRIVE_MPS + ARRIVE_MPS / BRAKE_MPS2;
  };

  const arrivalPose = (doorXM: number, tS: number, out: TruckPose, roadInXM: number): TruckPose => {
    const totalS = arriveS(doorXM, roadInXM);
    const brakeS = ARRIVE_MPS / BRAKE_MPS2;
    const leftS = Math.max(0, totalS - Math.max(0, tS));
    // Distance still to go: braking all the way for the last brakeS seconds.
    const toGoM = leftS <= brakeS ? 0.5 * BRAKE_MPS2 * leftS * leftS : (ARRIVE_MPS * ARRIVE_MPS) / (2 * BRAKE_MPS2) + ARRIVE_MPS * (leftS - brakeS);
    return setPose(out, stopXM(doorXM) - toGoM, laneZM, Math.PI / 2, 0);
  };

  const leaveDurationS = (doorXM: number, roadOutXM: number): number => {
    const distanceM = tableEndS + (roadOutXM - doorXM - turnEndDxM) - CREEP_M;
    const accelS = LEAVE_MPS / LEAVE_MPS2;
    const accelM = 0.5 * LEAVE_MPS2 * accelS * accelS;
    if (distanceM <= accelM) return Math.sqrt((2 * distanceM) / LEAVE_MPS2);
    return accelS + (distanceM - accelM) / LEAVE_MPS;
  };

  return { spec, turnEndM, stopM, laneZM, kappa, articulationRad: articulation, pullOutPose, arriveS, arrivalPose, leaveDurationS };
}

/** The UHT yard's path (phase 12), and its figures and moves under the names the UHT dock uses. */
export const UHT_PATH: DockPath = createDockPath(UHT_PATH_SPEC);
/** Path length at which the turn ends and the lane begins. */
export const TURN_END_M = UHT_PATH.turnEndM;
/** Where an arriving truck stops, its trailer straight on the lane a little past the turn. */
export const STOP_M = UHT_PATH.stopM;
/** The lane trucks drive along: the bogie's z there. */
export const LANE_Z_M = UHT_PATH.laneZM;

/** Curvature of the bogie's path out of the dock at path length `s` (1/m, positive turning east). */
export function pathKappa(s: number): number {
  return UHT_PATH.kappa(s);
}

/** The tractor's angle off the trailer at path length `s`: along its kingpin's direction of travel. */
export function articulationRad(s: number): number {
  return UHT_PATH.articulationRad(s);
}

/** The truck at path length `s` out of the dock at `doorXM` (0 is docked; past the turn it runs east on the lane). */
export function pullOutPose(doorXM: number, s: number, out: TruckPose): TruckPose {
  return UHT_PATH.pullOutPose(doorXM, s, out);
}

/** Motion seconds to drive in from the road and stop at a door's stop point. */
export function arriveS(doorXM: number): number {
  return UHT_PATH.arriveS(doorXM, ROAD_IN_X_M);
}

/** The truck driving in, `tS` motion seconds after it left the road. */
export function arrivalPose(doorXM: number, tS: number, out: TruckPose): TruckPose {
  return UHT_PATH.arrivalPose(doorXM, tS, out, ROAD_IN_X_M);
}

/** Path length out of the dock `tS` motion seconds into driving away (it starts from the creep's end). */
export function leaveS(tS: number): number {
  const t = Math.max(0, tS);
  const accelS = LEAVE_MPS / LEAVE_MPS2;
  if (t <= accelS) return CREEP_M + 0.5 * LEAVE_MPS2 * t * t;
  return CREEP_M + 0.5 * LEAVE_MPS2 * accelS * accelS + LEAVE_MPS * (t - accelS);
}

/** Motion seconds a truck for `doorXM` takes to drive away until it is off the floor. */
export function leaveDurationS(doorXM: number): number {
  return UHT_PATH.leaveDurationS(doorXM, ROAD_OUT_X_M);
}

/** A yard: its path out of a dock, and where its trucks come onto the floor and leave it. */
export interface Yard {
  path: DockPath;
  road: Readonly<Road>;
}
export const UHT_YARD: Readonly<Yard> = { path: UHT_PATH, road: UHT_ROAD };

/** Eases a move's fraction in and out: a quarter of it gathering speed, a quarter slowing down. */
function trapezoid(u: number): number {
  const a = 0.25;
  const x = Math.min(1, Math.max(0, u));
  const peak = 1 / (1 - a);
  if (x < a) return (peak * x * x) / (2 * a);
  if (x > 1 - a) return 1 - (peak * (1 - x) * (1 - x)) / (2 * a);
  return peak * (x - a / 2);
}

const smooth = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** The truck the sim has at a door, as the bays read it. */
export interface DoorTruck {
  id: number;
  loading: boolean;
  /** Sim seconds left loading (0 while waiting). */
  remainingS: number;
  /** Pallets on board by the sim's count while loading (from remainingS), 0 while waiting. */
  loadedPallets: number;
}

/** One dock door's truck as the 3D view shows it. */
export interface Bay {
  readonly door: number;
  readonly doorXM: number;
  /** The yard the door is on: its path and its road. */
  readonly yard: Readonly<Yard>;
  phase: BayPhase;
  /** Motion seconds into the phase. */
  tS: number;
  /** The sim's truck the bay shows, or null while away. */
  shownId: number | null;
  /** Rear doors: 0 shut, 1 open (flat against the trailer's sides). */
  doorsFrac: number;
  /** The dock's roller door: 0 down, 1 up. */
  rollerFrac: number;
  /** Pallets in the trailer (the sim's count once docked; the full load while closing and leaving). */
  loaded: number;
  /** True while the trailer's load can be seen: docked, or closing with its doors not yet shut. */
  loadShown: boolean;
  /** The sim's truck there is loading, and motion seconds before this bay starts closing (Infinity while it waits). */
  simLoading: boolean;
  closeInS: number;
  /** A truck that has closed up and waits for the lane to be clear before it pulls out. */
  waitingForLane: boolean;
  /** How much faster than planned the bay plays this frame (1 = as planned), for tests. */
  playRate: number;
  readonly pose: TruckPose;
}

export function createBays(doorsXM: readonly number[], yard: Readonly<Yard> = UHT_YARD): Bay[] {
  return doorsXM.map((doorXM, door) => {
    const bay: Bay = {
      door,
      doorXM,
      yard,
      phase: 'away',
      tS: 0,
      shownId: null,
      doorsFrac: 0,
      rollerFrac: 0,
      loaded: 0,
      loadShown: false,
      simLoading: false,
      closeInS: Infinity,
      waitingForLane: false,
      playRate: 1,
      pose: { xM: 0, zM: 0, headingRad: 0, tractorRad: 0 },
    };
    yard.path.pullOutPose(doorXM, 0, bay.pose);
    return bay;
  });
}

/** Phases a truck spends on the yard's lane: one truck at a time, so they never drive through each other. */
const onLane = (phase: BayPhase): boolean => phase === 'arriving' || phase === 'opening' || phase === 'reversing' || phase === 'leaving';

function laneBusy(bays: readonly Bay[], self: Bay): boolean {
  for (const bay of bays) if (bay !== self && onLane(bay.phase)) return true;
  return false;
}

function laneWanted(bays: readonly Bay[], self: Bay): boolean {
  for (const bay of bays) if (bay !== self && bay.waitingForLane) return true;
  return false;
}

/** Motion seconds a bay's truck takes to drive in from its yard's road and stop past its door. */
export const bayArriveS = (bay: Pick<Bay, 'doorXM' | 'yard'>): number => bay.yard.path.arriveS(bay.doorXM, bay.yard.road.inXM);

/** Motion seconds of moves still to play before the truck may stand closed when the sim sends it away. */
function movesLeftS(bay: Bay): number {
  const { doors, reverse, roller, close } = TRUCK_MOVES_S;
  switch (bay.phase) {
    case 'arriving':
      return bayArriveS(bay) - bay.tS + doors + reverse + roller + close;
    case 'opening':
      return doors - bay.tS + reverse + roller + close;
    case 'reversing':
      return reverse - bay.tS + roller + close;
    case 'docked':
      return Math.max(0, roller - bay.tS) + close;
    case 'closing':
      return Math.max(0, close - bay.tS);
    default:
      return 0;
  }
}

/**
 * The sim's clock as the bays fit to it: the sim speed (sim seconds per real second) and the motion rate
 * (motion seconds per real second, motion.ts), so remainingS ÷ speed × rate is motion seconds left.
 */
export interface SimClock {
  speed: number;
  rate: number;
  /** Pallets in a full load and the sim seconds a load takes. */
  palletsPerTruck: number;
}

/**
 * Moves every bay on by `motionS` (0 while paused), following the sim's trucks at the doors (`atDoor[door]`,
 * null for none). A truck that has `remainingS ÷ speed` real seconds left loading plays its arrival faster,
 * or skips it, when that is less than the moves still to play, so it has closed up when the sim sends it away.
 */
export function stepBays(bays: readonly Bay[], atDoor: readonly (DoorTruck | null)[], motionS: number, clock: SimClock): void {
  for (const bay of bays) stepBay(bays, bay, atDoor[bay.door] ?? null, motionS, clock);
}

function stepBay(bays: readonly Bay[], bay: Bay, sim: DoorTruck | null, motionS: number, clock: SimClock): void {
  const same = sim !== null && sim.id === bay.shownId;
  // Motion seconds left before the sim sends the truck away: Infinity while it waits for stock.
  const leftS = same && sim.loading ? (sim.remainingS / Math.max(clock.speed, 1e-9)) * clock.rate : Infinity;
  let rate = 1;
  bay.waitingForLane = false;
  switch (bay.phase) {
    case 'away':
      if (sim && !laneBusy(bays, bay) && !laneWanted(bays, bay)) {
        bay.phase = 'arriving';
        bay.tS = 0;
        bay.shownId = sim.id;
        // A truck that already loads as it turns up may be short of time from the start.
        return stepBay(bays, bay, sim, motionS, clock);
      }
      break;
    case 'arriving':
    case 'opening':
    case 'reversing':
    case 'docked':
      if (!same) {
        // Sent away (or replaced) before it closed up: it stands at the dock at once and closes in a hurry.
        bay.phase = 'closing';
        bay.tS = 0;
        bay.doorsFrac = 1;
        rate = HURRY_RATE;
        break;
      }
      if (Number.isFinite(leftS)) {
        const needS = movesLeftS(bay);
        if (needS > leftS) rate = leftS > 0 ? needS / leftS : Infinity;
        if (rate > MAX_PLAY_RATE && bay.phase !== 'docked') {
          // Too far behind to play: it is at the dock, roller door up, and loading.
          bay.phase = 'docked';
          bay.tS = TRUCK_MOVES_S.roller;
          bay.doorsFrac = 1;
          bay.rollerFrac = 1;
          rate = 1;
        }
        if (bay.phase === 'docked' && leftS <= TRUCK_MOVES_S.close) {
          bay.phase = 'closing';
          bay.tS = 0;
          rate = leftS > 0 ? Math.max(1, TRUCK_MOVES_S.close / leftS) : HURRY_RATE;
        }
      }
      if (onLane(bay.phase) && laneWanted(bays, bay)) rate = Math.max(rate, HURRY_RATE);
      break;
    case 'closing':
      if (same && leftS > REOPEN_S) {
        // The sim has slowed down and the truck loads on: it opens up again, playing its closing backwards.
        bay.tS -= motionS;
        if (bay.tS <= 0) {
          bay.phase = 'docked';
          bay.tS = TRUCK_MOVES_S.roller;
        }
        bay.playRate = 1;
        finishStep(bay, sim, same, motionS, leftS, clock);
        return;
      }
      if (!same) rate = HURRY_RATE;
      else if (Number.isFinite(leftS) && movesLeftS(bay) > leftS) rate = leftS > 0 ? movesLeftS(bay) / leftS : HURRY_RATE;
      if (bay.tS >= TRUCK_MOVES_S.close && !same) {
        if (laneBusy(bays, bay)) bay.waitingForLane = true;
        else {
          bay.phase = 'leaving';
          bay.tS = 0;
          rate = 1;
        }
      }
      break;
    case 'leaving':
      // A new truck for this door waits until this one has gone.
      if (sim && !same) rate = HURRY_RATE;
      if (laneWanted(bays, bay)) rate = Math.max(rate, HURRY_RATE);
      break;
  }
  bay.playRate = Number.isFinite(rate) ? rate : MAX_PLAY_RATE;
  bay.tS += motionS * bay.playRate;
  advancePhases(bay);
  finishStep(bay, sim, same, motionS, leftS, clock);
}

/** The roller door, what the forklifts read, and the pose, once the bay's phase and time are set for the frame. */
function finishStep(bay: Bay, sim: DoorTruck | null, same: boolean, motionS: number, leftS: number, clock: SimClock): void {
  // The roller door follows the truck at the dock: up while docked, down otherwise.
  const rollerStep = (motionS * bay.playRate) / TRUCK_MOVES_S.roller;
  bay.rollerFrac = bay.phase === 'docked' ? Math.min(1, bay.rollerFrac + rollerStep) : Math.max(0, bay.rollerFrac - rollerStep);
  bay.simLoading = same && (sim?.loading ?? false);
  bay.closeInS = bay.phase === 'docked' ? Math.max(0, leftS - TRUCK_MOVES_S.close) : 0;
  pose(bay, sim, same, clock);
}

/** Moves on to the next phase once a timed one has played out (one step a frame is enough). */
function advancePhases(bay: Bay): void {
  const { doors, reverse } = TRUCK_MOVES_S;
  if (bay.phase === 'arriving' && bay.tS >= bayArriveS(bay)) {
    bay.tS -= bayArriveS(bay);
    bay.phase = 'opening';
  }
  if (bay.phase === 'opening' && bay.tS >= doors) {
    bay.tS -= doors;
    bay.phase = 'reversing';
  }
  if (bay.phase === 'reversing' && bay.tS >= reverse) {
    bay.tS -= reverse;
    bay.phase = 'docked';
  }
  if (bay.phase === 'leaving' && bay.tS >= bay.yard.path.leaveDurationS(bay.doorXM, bay.yard.road.outXM)) {
    bay.phase = 'away';
    bay.tS = 0;
    bay.shownId = null;
  }
}

function pose(bay: Bay, sim: DoorTruck | null, same: boolean, clock: SimClock): void {
  const { doors, reverse, close } = TRUCK_MOVES_S;
  const t = bay.tS;
  const path = bay.yard.path;
  switch (bay.phase) {
    case 'away':
      bay.doorsFrac = 0;
      bay.loaded = 0;
      bay.loadShown = false;
      path.pullOutPose(bay.doorXM, 0, bay.pose);
      return;
    case 'arriving':
      bay.doorsFrac = 0;
      bay.loaded = 0;
      bay.loadShown = false;
      path.arrivalPose(bay.doorXM, t, bay.pose, bay.yard.road.inXM);
      return;
    case 'opening':
      bay.doorsFrac = Math.min(1, t / doors);
      bay.loaded = 0;
      bay.loadShown = false;
      path.pullOutPose(bay.doorXM, path.stopM, bay.pose);
      return;
    case 'reversing':
      bay.doorsFrac = 1;
      bay.loaded = 0;
      bay.loadShown = false;
      path.pullOutPose(bay.doorXM, path.stopM * (1 - trapezoid(t / reverse)), bay.pose);
      return;
    case 'docked':
      bay.doorsFrac = 1;
      bay.loaded = same && sim?.loading ? Math.min(clock.palletsPerTruck, Math.max(0, sim.loadedPallets)) : 0;
      bay.loadShown = true;
      path.pullOutPose(bay.doorXM, 0, bay.pose);
      return;
    case 'closing':
      bay.doorsFrac = 1 - Math.min(1, Math.max(0, (t - DOORS_CLOSE_FROM_S) / (close - DOORS_CLOSE_FROM_S)));
      bay.loaded = clock.palletsPerTruck;
      // Once the doors are shut the load is out of sight: it is not drawn.
      bay.loadShown = bay.doorsFrac > 0;
      path.pullOutPose(bay.doorXM, CREEP_M * smooth(t / CREEP_S), bay.pose);
      return;
    case 'leaving':
      bay.doorsFrac = 0;
      bay.loaded = clock.palletsPerTruck;
      bay.loadShown = false;
      path.pullOutPose(bay.doorXM, leaveS(t), bay.pose);
      return;
  }
}
