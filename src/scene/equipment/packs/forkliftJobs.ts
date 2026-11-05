// The forklifts' jobs (phase 12, D22), headless: where each forklift drives, when it lifts, and what it carries.
// No three.js and no DOM; packsLine.ts poses the forklift models and their pallets from what this module says.
//
// Each forklift has one job. `forklift-1` puts released stock away: when the stock rises it takes a pallet at
// the quarantine's west edge and carries it to the racks' next free place. `forklift-2` loads trucks: while a
// truck loads at a door it takes the racks' last filled place to the trailer's tail. Forklift-1 works the racks
// from their north faces and comes in from its lane at the racks' east end; forklift-2 works the south faces,
// on its own lane nearer the racks and along the front aisle to the doors. A forklift takes an aisle only
// where the other's route can't cross it (AisleLocks), and otherwise waits.
//
// The aisles are 2.7 m wide and a forklift is 3.5 m long, so at a rack place it turns on the spot about the
// middle of its body, which just fits the aisle, with the pallet lifted to the place's level: the pallet swings
// in over the empty places beside it (the racks fill west to east, so the places east of the next free one are
// empty, and both forklifts come at their place with the forks pointing east). It drives in the last few
// centimetres, sets the pallet down, and turns back out. At the doors it turns the same way in the front aisle,
// the pallet lifted to the trailer's deck. Speeds are the card's: 2.2 m/s empty, 1.8 m/s loaded, 0.6 m/s into a
// rack or trailer and in turns; the forks only while the forklift stands, since phase 14 at the Linde E20's 0.56 m/s
// laden and 0.64 m/s empty up and 0.57 m/s down (D24). Phase 14 also tilts the mast: back 8° for the trip with a
// pallet, the forks low, and level to pick up, lift or set down, at 4° a second; and steers the rear wheels. Each
// step that moves the forklift says the angle each rear wheel stands at for it: straight on a line, square to the
// line from the curve's centre on a curve, and from the middle of the body in a turn on the spot (wheelSteerRad).
// Standing, the driver turns the wheels to a step's angles before it moves off, and while the forks move, toward
// the next move's; while it drives on from one step into the next, the wheels follow at their rate.
import { RACK_Z_M, rackSlots, type FloorPointM, type RackSlotM } from './layout';

export type ForkliftJob = 'parked' | 'toPick' | 'pick' | 'toDrop' | 'drop' | 'home';
export type ForkliftRole = 'putAway' | 'loading';

export const FORKLIFT_MOTION = {
  emptyMps: 2.2,
  loadedMps: 1.8,
  slowMps: 0.6,
  /** The forks up laden and empty, and down (the Linde E20's VDI 2198 sheet, lines 5.2 and 5.3; D24). */
  liftLadenMps: 0.56,
  liftEmptyMps: 0.64,
  lowerMps: 0.57,
  maxLiftM: 3.3,
  /** The mast tilts back this far while carrying along the floor (the sheet's 8°), at this rate (a sim assumption). */
  tiltBackRad: (-8 * Math.PI) / 180,
  tiltRadPerS: (4 * Math.PI) / 180,
} as const;
/** The slowest the forks move, for estimates. */
const SLOWEST_FORKS_MPS = Math.min(FORKLIFT_MOTION.liftLadenMps, FORKLIFT_MOTION.liftEmptyMps, FORKLIFT_MOTION.lowerMps);
const ACCEL_MPS2 = 0.8;
/** Turning on the spot: the body's corners, 1.34 m out, move at about 0.6 m/s. */
const PIVOT_RAD_PER_S = 0.45;
const PIVOT_RAD_PER_S2 = 0.6;
const FORKS_MPS2 = 1.0;
/** Turning while driving: no faster than this, so a tight curve is slow. */
const TURN_RAD_PER_S = 0.5;
/**
 * The rear wheels (phase 14, D24): their centres in the forklift's frame, x across and z toward the forks from its
 * footprint centre (vehicles.ts STEER_M), the most each turns either way, and how fast the power steering turns them.
 */
export const STEER_WHEELS_M = { left: [-0.45, -1.3], right: [0.45, -1.3] } as const;
export const STEER_MAX_RAD = (85 * Math.PI) / 180;
export const STEER_RAD_PER_S = 2;
const MIN_SPEED = 0.03;
/** The beacon flashes at this rate while the forklift works. */
export const BEACON_HZ = 1.5;

/** The point a forklift turns about, the middle of its body, lies this far behind its footprint centre. */
export const PIVOT_BACK_M = 0.535;
/** A pallet on the forks: its centre this far ahead of the turning point. */
export const PALLET_AHEAD_M = 1.885;
/** Forks raised this far to travel with a pallet, and the trailer's deck. */
const TRAVEL_LIFT_M = 0.15;
const DECK_M = 1.3;
/** Clearance over a beam or the deck while the pallet swings in, and the lift that takes a pallet off its place. */
const OVER_M = 0.06;
const LIFT_OFF_M = 0.08;
/** The forks sink this far below a set-down pallet, free inside its base. */
const UNDER_M = 0.01;
/** How far forklift-2 drives up at the trailer, so the pallet stands on its tail. */
const TRAILER_IN_M = 0.13;

/** Turning points along the aisles: north of the first rack row, between the rows, and the front aisle by the doors. */
export const AISLE_Z_M = [2.95, 6.8, 10.6, 14.4, 18.25] as const;
export const FRONT_AISLE = AISLE_Z_M.length - 1;
/** The two lanes east of the racks: forklift-1's and forklift-2's, nearer the racks. */
const LANE_1_X_M = -16.3;
const LANE_2_X_M = -19.8;
/** Forklift-1 waits facing the quarantine's west edge and picks a released pallet there. */
const PICK_Z_M = 8.7;
const PUT_AWAY_PARK: FloorPointM = [-15.3, PICK_Z_M];
const PUT_AWAY_PICK: FloorPointM = [-13.4, PICK_Z_M];
/** Forklift-1 leaves the lane-2 crossing here on its way out of an aisle. */
const PAST_LANE_2_X_M = -18.5;
/** Forklift-2 parks at the front aisle's east end, facing up its lane. */
const LOADING_PARK: FloorPointM = [LANE_2_X_M, AISLE_Z_M[FRONT_AISLE]];
/** Fillet radius for corners in the open floor east of the racks. */
const CORNER_M = 1.5;
/** Put-away trips queued at most: the forklift keeps going while stock keeps coming. */
const MAX_PENDING = 3;

const EAST = Math.PI / 2;
const NORTH = Math.PI;
const SOUTH = 0;

const wrap = (rad: number): number => {
  let r = rad % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
};

/** The racks' places in fill order, and the row each stands in. */
const SLOTS: readonly RackSlotM[] = rackSlots();
const rowOf = (slot: RackSlotM): number => RACK_Z_M.indexOf(slot.zM as (typeof RACK_Z_M)[number]);

/**
 * Aisles taken, by job: forklift-1 comes into its aisle across forklift-2's lane, which runs from forklift-2's
 * aisle down to the front aisle, so forklift-1 may only take an aisle north of forklift-2's.
 */
export interface AisleLocks {
  putAway: number;
  loading: number;
}

export const createAisleLocks = (): AisleLocks => ({ putAway: -1, loading: -1 });

const putAwayMayTake = (locks: AisleLocks, aisle: number): boolean => locks.loading < 0 || aisle < locks.loading;
const loadingMayTake = (locks: AisleLocks, aisle: number): boolean => locks.putAway < 0 || locks.putAway < aisle;

/** What a forklift reads each frame. */
export interface ForkliftInputs {
  /** Rack places the racks show (packsLine.ts rackLoadsShown) and the places there are. */
  placesShown: number;
  places: number;
  /** The door whose truck loads, docked with its roller door up, or -1; motion seconds before it starts closing. */
  loadingDoor: number;
  loadingLeftS: number;
  /** Doors with a truck docked (bit per door), to clear a pallet left on a trailer that has gone. */
  dockedMask: number;
  /** The dock doors' x. */
  doorsXM: readonly number[];
  /** True under prefers-reduced-motion: the beacon shines steadily rather than flashing. */
  steadyBeacon: boolean;
}

/** A pallet the forklift shows: on its forks, or set down. Bottom height, centre on the floor and heading. */
export interface PalletPose {
  shown: boolean;
  xM: number;
  yM: number;
  zM: number;
  headingRad: number;
}

const pallet = (): PalletPose => ({ shown: false, xM: 0, yM: 0, zM: 0, headingRad: 0 });

/* routes: a fixed pool of steps, planned when a job changes and played frame by frame */

type StepKind = 'line' | 'arc' | 'pivot' | 'lift' | 'mark';
type Mark = 'grab' | 'landing' | 'release' | 'stow' | 'unreserve';

interface Step {
  kind: StepKind;
  /** line: from a to b; arc: centre c, radius, start angle and signed sweep. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  radius: number;
  angle0: number;
  sweep: number;
  /** Heading on a line, the heading a pivot starts from, the lift a lift starts from. */
  from: number;
  /** A pivot's or a lift's end, signed by `sign`. */
  to: number;
  sign: number;
  reverse: boolean;
  /** Path length (m), turn (rad) or lift (m) of the whole step, and how much of it is done. */
  length: number;
  done: number;
  vmax: number;
  /** Speed to leave a drive step at: the next drive step's, or 0 before a stop. */
  exitV: number;
  /** A drive or pivot step's rear wheel angles (wheelSteerRad), left and right. */
  steerL: number;
  steerR: number;
  mark: Mark;
  /** A mark's payload: the surface a pallet stands on. */
  value: number;
}

const newStep = (): Step => ({
  kind: 'mark',
  ax: 0,
  az: 0,
  bx: 0,
  bz: 0,
  cx: 0,
  cz: 0,
  radius: 0,
  angle0: 0,
  sweep: 0,
  from: 0,
  to: 0,
  sign: 1,
  reverse: false,
  length: 0,
  done: 0,
  vmax: 0,
  exitV: 0,
  steerL: 0,
  steerR: 0,
  mark: 'grab',
  value: 0,
});

const isDrive = (step: Step): boolean => step.kind === 'line' || step.kind === 'arc';

/** A forklift's pose: its turning point (x, z), heading (rotation.y, forks along it) and fork lift. */
interface Pose {
  x: number;
  z: number;
  heading: number;
  lift: number;
}

class Route {
  private readonly steps: Step[] = Array.from({ length: 40 }, newStep);
  count = 0;
  index = 0;
  /** Speed now: m/s while driving, rad/s while turning on the spot, m/s of the forks while lifting. */
  speed = 0;
  /** Whether the forks carry a pallet: they lift it slower (the driver sets it before each play). */
  laden = false;
  /** The rear wheels' angles now, left and right; they carry over from one plan to the next. */
  steerL = 0;
  steerR = 0;
  /** Where the plan has got to while it is written. */
  private readonly cursor: Pose = { x: 0, z: 0, heading: 0, lift: 0 };

  get done(): boolean {
    return this.index >= this.count;
  }

  current(): Step | null {
    return this.index < this.count ? (this.steps[this.index] as Step) : null;
  }

  begin(pose: Pose): void {
    this.count = 0;
    this.index = 0;
    this.speed = 0;
    Object.assign(this.cursor, pose);
  }

  private add(kind: StepKind): Step {
    const step = this.steps[this.count];
    if (!step) throw new Error('forklift route: too many steps');
    Object.assign(step, newStepValues);
    step.kind = kind;
    this.count += 1;
    return step;
  }

  mark(mark: Mark, value = 0): void {
    const step = this.add('mark');
    step.mark = mark;
    step.value = value;
  }

  pivotTo(heading: number): void {
    const turn = wrap(heading - this.cursor.heading);
    if (Math.abs(turn) < 1e-6) return;
    const step = this.add('pivot');
    step.from = this.cursor.heading;
    step.sign = Math.sign(turn);
    step.length = Math.abs(turn);
    // About the middle of the body: the turning point, PIVOT_BACK_M behind the footprint centre.
    setSteer(step, 0, -PIVOT_BACK_M);
    this.cursor.heading = wrap(heading);
  }

  lift(toM: number): void {
    const target = Math.min(Math.max(toM, 0), FORKLIFT_MOTION.maxLiftM);
    if (Math.abs(target - this.cursor.lift) < 1e-6) return;
    const step = this.add('lift');
    step.from = this.cursor.lift;
    step.sign = Math.sign(target - this.cursor.lift);
    step.length = Math.abs(target - this.cursor.lift);
    this.cursor.lift = target;
  }

  /** Straight to a point, forwards or reversing; turns on the spot first if the forklift doesn't face that way. */
  line(toX: number, toZ: number, reverse: boolean, vmax: number): void {
    const dx = toX - this.cursor.x;
    const dz = toZ - this.cursor.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) return;
    const motion = Math.atan2(dx, dz);
    this.pivotTo(reverse ? motion + Math.PI : motion);
    const step = this.add('line');
    step.ax = this.cursor.x;
    step.az = this.cursor.z;
    step.bx = toX;
    step.bz = toZ;
    step.from = this.cursor.heading;
    step.reverse = reverse;
    step.length = length;
    step.vmax = vmax;
    this.cursor.x = toX;
    this.cursor.z = toZ;
  }

  /**
   * Along a polyline from where the plan is, its corners rounded with arcs of up to `cornerM` (each corner may
   * use half of the stretches either side of it, all of the first and last), heading eased through each turn.
   */
  drive(points: readonly FloorPointM[], reverse: boolean, vmax: number, cornerM = CORNER_M): void {
    const xs = [this.cursor.x, ...points.map((p) => p[0])];
    const zs = [this.cursor.z, ...points.map((p) => p[1])];
    const n = xs.length - 1;
    const lengths: number[] = [];
    const motions: number[] = [];
    for (let k = 0; k < n; k++) {
      const dx = (xs[k + 1] as number) - (xs[k] as number);
      const dz = (zs[k + 1] as number) - (zs[k] as number);
      lengths.push(Math.hypot(dx, dz));
      motions.push(Math.atan2(dx, dz));
    }
    for (let k = 1; k <= n; k++) {
      if (k === n) {
        this.line(xs[n] as number, zs[n] as number, reverse, vmax);
        break;
      }
      const turn = wrap((motions[k] as number) - (motions[k - 1] as number));
      const half = Math.tan(Math.abs(turn) / 2);
      if (Math.abs(turn) < 1e-4 || half > 1e3) {
        this.line(xs[k] as number, zs[k] as number, reverse, vmax);
        continue;
      }
      const inShare = k === 1 ? 1 : 0.5;
      const outShare = k === n - 1 ? 1 : 0.5;
      const tangentM = Math.min(cornerM * half, (lengths[k - 1] as number) * inShare, (lengths[k] as number) * outShare);
      const radius = tangentM / half;
      const inMotion = motions[k - 1] as number;
      this.line((xs[k] as number) - Math.sin(inMotion) * tangentM, (zs[k] as number) - Math.cos(inMotion) * tangentM, reverse, vmax);
      this.arc(radius, turn, reverse, Math.min(vmax, FORKLIFT_MOTION.slowMps, TURN_RAD_PER_S * radius));
    }
  }

  private arc(radius: number, turn: number, reverse: boolean, vmax: number): void {
    if (radius < 1e-4) return;
    const motion = reverse ? this.cursor.heading - Math.PI : this.cursor.heading;
    const sign = Math.sign(turn);
    const angle0 = motion - (sign * Math.PI) / 2;
    const step = this.add('arc');
    step.cx = this.cursor.x - radius * Math.sin(angle0);
    step.cz = this.cursor.z - radius * Math.cos(angle0);
    step.radius = radius;
    step.angle0 = angle0;
    step.sweep = turn;
    step.sign = sign;
    step.reverse = reverse;
    step.length = radius * Math.abs(turn);
    step.vmax = vmax;
    // The curve's centre, beside the turning point: on the side it turns to, the other side when reversing.
    setSteer(step, (reverse ? -sign : sign) * radius, -PIVOT_BACK_M);
    this.cursor.x = step.cx + radius * Math.sin(angle0 + turn);
    this.cursor.z = step.cz + radius * Math.cos(angle0 + turn);
    this.cursor.heading = wrap(this.cursor.heading + turn);
  }

  /** Ends the plan: each drive step learns the speed it may leave at, so the forklift slows in time. */
  finish(): void {
    let following: Step | null = null;
    for (let i = this.count - 1; i >= 0; i--) {
      const step = this.steps[i] as Step;
      if (step.kind === 'mark') continue;
      if (!isDrive(step)) {
        following = null;
        continue;
      }
      step.exitV =
        following && following.reverse === step.reverse
          ? Math.min(following.vmax, Math.sqrt(following.exitV * following.exitV + 2 * ACCEL_MPS2 * following.length))
          : 0;
      following = step;
    }
  }

  /** Estimated motion seconds the plan takes, from its lengths at full speed. */
  estimateS(): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) {
      const step = this.steps[i] as Step;
      if (isDrive(step)) s += step.length / step.vmax + 1;
      else if (step.kind === 'pivot') s += step.length / PIVOT_RAD_PER_S + 1;
      else if (step.kind === 'lift') s += step.length / SLOWEST_FORKS_MPS + 0.5;
    }
    return s;
  }

  /**
   * Plays the plan on by `dtS` motion seconds, writing the pose and handing marks to `onMark` as they are
   * passed; `speed` is left at the speed it ends the frame with. A step that moves the forklift from a stand waits
   * for the wheels to stand at its angles; meanwhile, and while the forks move, the wheels turn at STEER_RAD_PER_S.
   */
  play(dtS: number, pose: Pose, onMark: (mark: Mark, value: number) => void): void {
    let t = dtS;
    while (t > 0 && this.index < this.count) {
      const step = this.steps[this.index] as Step;
      if (step.kind === 'mark') {
        onMark(step.mark, step.value);
        this.index += 1;
        continue;
      }
      const moves = step.kind !== 'lift';
      if (moves && this.speed === 0 && step.done === 0) {
        // Standing, the driver turns the wheels first (power steering), then sets off.
        const off = Math.max(Math.abs(step.steerL - this.steerL), Math.abs(step.steerR - this.steerR));
        if (off > 1e-9) {
          const used = Math.min(t, off / STEER_RAD_PER_S);
          this.steer(step, used);
          t -= used;
          continue;
        }
      }
      const startT = t;
      const remaining = step.length - step.done;
      let vmax: number;
      let accel: number;
      let exit: number;
      if (isDrive(step)) {
        vmax = step.vmax;
        accel = ACCEL_MPS2;
        exit = step.exitV;
      } else if (step.kind === 'pivot') {
        vmax = PIVOT_RAD_PER_S;
        accel = PIVOT_RAD_PER_S2;
        exit = 0;
      } else {
        vmax = step.sign < 0 ? FORKLIFT_MOTION.lowerMps : this.laden ? FORKLIFT_MOTION.liftLadenMps : FORKLIFT_MOTION.liftEmptyMps;
        accel = FORKS_MPS2;
        exit = 0;
      }
      const cap = Math.min(vmax, Math.sqrt(exit * exit + 2 * accel * Math.max(remaining, 0)));
      this.speed = Math.max(Math.min(cap, this.speed + accel * t), Math.min(MIN_SPEED, vmax));
      const move = this.speed * t;
      const towards = moves ? step : this.nextMove();
      if (move >= remaining) {
        t -= remaining / this.speed;
        step.done = step.length;
        apply(step, pose);
        this.index += 1;
        this.speed = isDrive(step) ? Math.min(this.speed, exit) : 0;
      } else {
        step.done += move;
        t = 0;
        apply(step, pose);
      }
      if (towards) this.steer(towards, startT - t);
    }
    if (this.index >= this.count) this.speed = 0;
  }

  /** Turns the wheels toward `step`'s angles for `seconds`. */
  private steer(step: Step, seconds: number): void {
    const most = STEER_RAD_PER_S * seconds;
    this.steerL += Math.max(-most, Math.min(most, step.steerL - this.steerL));
    this.steerR += Math.max(-most, Math.min(most, step.steerR - this.steerR));
  }

  /** The next step after this one that moves the forklift, past marks and lifts, or null. */
  private nextMove(): Step | null {
    for (let i = this.index + 1; i < this.count; i++) {
      const step = this.steps[i] as Step;
      if (step.kind !== 'mark' && step.kind !== 'lift') return step;
    }
    return null;
  }

  /** True while the step being played moves the forklift along the floor. */
  driving(): boolean {
    const step = this.current();
    return step !== null && isDrive(step);
  }
}

const newStepValues = newStep();

/** Sets a step's wheel angles for a turning centre at (x, z) in the forklift's frame (wheelSteerRad). */
function setSteer(step: Step, centreXM: number, centreZM: number): void {
  step.steerL = wheelSteerRad(STEER_WHEELS_M.left[0], STEER_WHEELS_M.left[1], centreXM, centreZM);
  step.steerR = wheelSteerRad(STEER_WHEELS_M.right[0], STEER_WHEELS_M.right[1], centreXM, centreZM);
}

/** Writes what a step sets of the pose at its progress `done`. */
function apply(step: Step, pose: Pose): void {
  switch (step.kind) {
    case 'line': {
      const k = step.length > 0 ? step.done / step.length : 1;
      pose.x = step.ax + (step.bx - step.ax) * k;
      pose.z = step.az + (step.bz - step.az) * k;
      pose.heading = step.from;
      return;
    }
    case 'arc': {
      const angle = step.angle0 + (step.sign * step.done) / step.radius;
      pose.x = step.cx + step.radius * Math.sin(angle);
      pose.z = step.cz + step.radius * Math.cos(angle);
      const motion = angle + (step.sign * Math.PI) / 2;
      pose.heading = wrap(step.reverse ? motion + Math.PI : motion);
      return;
    }
    case 'pivot':
      pose.heading = wrap(step.from + step.sign * step.done);
      return;
    case 'lift':
      pose.lift = step.from + step.sign * step.done;
      return;
    case 'mark':
      return;
  }
}

/* the drivers */

export interface ForkliftDriver {
  readonly role: ForkliftRole;
  readonly job: ForkliftJob;
  /** Footprint centre, heading (rotation.y: forks toward it) and the forks' lift. */
  readonly xM: number;
  readonly zM: number;
  readonly headingRad: number;
  readonly liftM: number;
  /** Speed along the floor now (m/s), 0 while standing, turning on the spot or lifting. */
  readonly speedMps: number;
  /** True while the forks move up or down. */
  readonly lifting: boolean;
  readonly carrying: boolean;
  /** True while the beacon shines (it flashes while the forklift works). */
  readonly beacon: boolean;
  /** The mast's tilt about +x (phase 14): 0 level, down to FORKLIFT_MOTION.tiltBackRad while it carries along the floor. */
  readonly tiltRad: number;
  /** The rear wheels' steer angles about +y (phase 14): left (-x) and right (+x), 0 straight. */
  readonly steerLeftRad: number;
  readonly steerRightRad: number;
  /** Pallet waiting for it, on its forks, and the one it set down last. */
  readonly carried: PalletPose;
  readonly setDown: PalletPose;
  readonly waiting: PalletPose;
  /** The rack place it heads for or takes from, or -1. */
  readonly place: number;
  /** Plays the forklift on by `dtS` motion seconds (0 while paused). */
  update(dtS: number, inputs: ForkliftInputs): void;
}

export function createForkliftDriver(role: ForkliftRole, locks: AisleLocks): ForkliftDriver {
  const route = new Route();
  const park = role === 'putAway' ? PUT_AWAY_PARK : LOADING_PARK;
  const pose: Pose = { x: park[0], z: park[1], heading: role === 'putAway' ? EAST : NORTH, lift: 0 };
  const carried = pallet();
  const setDown = pallet();
  const waiting = pallet();
  let job: ForkliftJob = 'parked';
  let carrying = false;
  /** The pallet rests on its place until the forks lift it off. */
  let restingOn = -1;
  let landingOn = 0;
  let flashS = 0;
  let beacon = false;
  /** The mast's tilt about +x: 0 level, negative back (phase 14). */
  let tiltRad = 0;
  let place = -1;
  let aisle = -1;
  /** Put-away: trips still to make, and the places the racks showed last frame. */
  let pending = 0;
  let lastPlaces: number | null = null;
  /** Where the set-down pallet stands: a rack place (put-away) or a door (loading). */
  let setDownPlace = -1;
  let setDownDoor = -1;
  /** Loading: the door it serves, and whether the pallet in hand goes back to its rack place. */
  let door = -1;
  let puttingBack = false;

  const setLock = (value: number): void => {
    aisle = value;
    if (role === 'putAway') locks.putAway = value;
    else locks.loading = value;
  };

  const onMark = (mark: Mark, value: number): void => {
    switch (mark) {
      case 'grab':
        carrying = true;
        restingOn = value;
        setDown.shown = false;
        if (role === 'putAway') pending = Math.max(0, pending - 1);
        return;
      case 'landing':
        landingOn = value;
        return;
      case 'release':
      case 'stow':
        carrying = false;
        if (mark === 'release') {
          setDown.shown = true;
          setDown.xM = carried.xM;
          setDown.zM = carried.zM;
          setDown.yM = landingOn;
          setDown.headingRad = carried.headingRad;
          setDownPlace = role === 'putAway' ? place : -1;
          setDownDoor = role === 'loading' ? door : -1;
          if (role === 'putAway') {
            const slot = SLOTS[place];
            if (slot) {
              setDown.xM = slot.xM;
              setDown.zM = slot.zM;
            }
          }
        }
        landingOn = 0;
        return;
      case 'unreserve':
        setLock(-1);
        return;
    }
  };

  /** Drive-in distance at a rack place: what the turn on the spot leaves of the way to the place's centre. */
  const driveInM = (slot: RackSlotM, aisleZ: number, facing: number): number => {
    const reach = aisleZ + Math.cos(facing) * PALLET_AHEAD_M;
    return Math.min(0.3, Math.max(0, Math.abs(slot.zM - reach) < 0.3 ? Math.cos(facing) * (slot.zM - reach) : 0));
  };

  /** At a rack place, facing east: turn in with the pallet over its level, set it down, turn back out. */
  const planSetDownInRack = (slot: RackSlotM, aisleZ: number, facing: number, mark: 'release' | 'stow'): void => {
    const inM = driveInM(slot, aisleZ, facing);
    route.lift(slot.yM + OVER_M);
    route.pivotTo(facing);
    route.line(pose.x + Math.sin(facing) * inM, aisleZ + Math.cos(facing) * inM, false, FORKLIFT_MOTION.slowMps);
    route.mark('landing', slot.yM);
    route.lift(slot.yM - UNDER_M);
    route.mark(mark);
    route.line(pose.x, aisleZ, true, FORKLIFT_MOTION.slowMps);
    route.pivotTo(EAST);
    route.lift(0);
  };

  /* forklift-1: put-away */

  const putAwayNext = (inputs: ForkliftInputs): void => {
    const free = inputs.placesShown < inputs.places;
    switch (job) {
      case 'parked':
      case 'toPick':
      case 'home':
        if (pending > 0 && free) {
          // At the quarantine's west edge: forks down, in, lift the pallet, back out.
          route.begin(pose);
          route.lift(0);
          route.line(PUT_AWAY_PICK[0], PUT_AWAY_PICK[1], false, FORKLIFT_MOTION.slowMps);
          route.mark('grab', 0);
          route.lift(TRAVEL_LIFT_M);
          route.line(PUT_AWAY_PARK[0], PUT_AWAY_PARK[1], true, FORKLIFT_MOTION.slowMps);
          route.finish();
          job = 'pick';
        } else job = 'parked';
        return;
      case 'pick':
        job = 'toDrop';
        place = -1;
        startPutAwayDrop(inputs);
        return;
      case 'toDrop':
        if (place < 0) {
          startPutAwayDrop(inputs); // still waiting for an aisle
          return;
        }
        {
          const slot = SLOTS[place] as RackSlotM;
          route.begin(pose);
          planSetDownInRack(slot, pose.z, SOUTH, 'release');
          route.finish();
          job = 'drop';
        }
        return;
      case 'drop': {
        // Out of the aisle forks first, freeing it once past forklift-2's lane, and back to the quarantine.
        route.begin(pose);
        route.line(PAST_LANE_2_X_M, pose.z, false, FORKLIFT_MOTION.emptyMps);
        route.mark('unreserve');
        route.drive([[LANE_1_X_M, pose.z], [LANE_1_X_M, PICK_Z_M], PUT_AWAY_PARK], false, FORKLIFT_MOTION.emptyMps);
        route.finish();
        job = pending > 0 && free ? 'toPick' : 'home';
        place = -1;
        return;
      }
    }
  };

  /** Carries the pallet in hand to the racks' next free place, from its north face, once the aisle may be taken. */
  const startPutAwayDrop = (inputs: ForkliftInputs): void => {
    const target = Math.min(inputs.placesShown, inputs.places - 1);
    const slot = SLOTS[target];
    if (!slot) return;
    const row = rowOf(slot);
    if (!putAwayMayTake(locks, row)) return; // waits, pallet in hand, facing the quarantine
    place = target;
    setLock(row);
    route.begin(pose);
    // Reversing, the load trailing: onto its lane, along it, and down the aisle to the place.
    route.drive([[LANE_1_X_M, PICK_Z_M], [LANE_1_X_M, AISLE_Z_M[row] as number], [slot.xM, AISLE_Z_M[row] as number]], true, FORKLIFT_MOTION.loadedMps);
    route.finish();
  };

  /* forklift-2: loading */

  /** From wherever it stands (parked, at a door, at a rack place), on to the turning point at a place in `toAisle`. */
  const planToPlace = (slot: RackSlotM, toAisle: number): void => {
    const aisleZ = AISLE_Z_M[toAisle] as number;
    const frontZ = AISLE_Z_M[FRONT_AISLE];
    const onFront = Math.abs(pose.z - frontZ) < 1e-3;
    if (toAisle === FRONT_AISLE && onFront) {
      route.pivotTo(EAST);
      route.line(slot.xM, frontZ, slot.xM < pose.x, FORKLIFT_MOTION.emptyMps);
      return;
    }
    if (onFront && Math.abs(pose.x - LANE_2_X_M) > 1e-3) {
      // From a door: east along the front aisle and round the corner up its lane.
      route.pivotTo(EAST);
      route.drive([[LANE_2_X_M, frontZ], [LANE_2_X_M, aisleZ]], false, FORKLIFT_MOTION.emptyMps);
    } else if (Math.abs(pose.x - LANE_2_X_M) > 1e-3) {
      // From a rack place: out of its aisle forks first, then along the lane.
      route.line(LANE_2_X_M, pose.z, false, FORKLIFT_MOTION.emptyMps);
      route.line(LANE_2_X_M, aisleZ, false, FORKLIFT_MOTION.emptyMps);
    } else {
      route.line(LANE_2_X_M, aisleZ, false, FORKLIFT_MOTION.emptyMps);
    }
    // Facing east, it backs down the aisle to the place.
    route.pivotTo(EAST);
    route.line(slot.xM, aisleZ, true, FORKLIFT_MOTION.emptyMps);
  };

  const loadingNext = (inputs: ForkliftInputs): void => {
    switch (job) {
      case 'parked':
      case 'home':
        if (!startLoadingTrip(inputs) && job === 'home') job = 'parked';
        return;
      case 'toPick': {
        const slot = SLOTS[place] as RackSlotM;
        route.begin(pose);
        route.lift(slot.yM - UNDER_M);
        const inM = driveInM(slot, pose.z, NORTH);
        route.pivotTo(NORTH);
        route.line(pose.x, pose.z - inM, false, FORKLIFT_MOTION.slowMps);
        route.mark('grab', slot.yM);
        route.lift(slot.yM + LIFT_OFF_M);
        route.line(pose.x, pose.z, true, FORKLIFT_MOTION.slowMps);
        route.pivotTo(EAST);
        route.lift(TRAVEL_LIFT_M);
        route.finish();
        job = 'pick';
        return;
      }
      case 'pick':
        door = inputs.loadingDoor;
        if (door < 0) {
          // The truck has gone: the pallet goes back where it came from.
          puttingBack = true;
          route.begin(pose);
          planSetDownInRack(SLOTS[place] as RackSlotM, pose.z, NORTH, 'stow');
          route.finish();
          job = 'drop';
          return;
        }
        route.begin(pose);
        planToDoor(door, inputs);
        route.finish();
        job = 'toDrop';
        return;
      case 'toDrop':
        if (puttingBack) {
          // Back at its turning point by the rack place: it sets the pallet down there.
          route.begin(pose);
          planSetDownInRack(SLOTS[place] as RackSlotM, pose.z, NORTH, 'stow');
          route.finish();
          job = 'drop';
          return;
        }
        if (inputs.loadingDoor >= 0 && inputs.loadingDoor !== door) {
          // The truck closed up on the way, and another loads: along the front aisle to that one.
          door = inputs.loadingDoor;
          const doorX = inputs.doorsXM[door] as number;
          route.begin(pose);
          route.line(doorX, pose.z, Math.sin(pose.heading) < 0 ? doorX > pose.x : doorX < pose.x, FORKLIFT_MOTION.loadedMps);
          route.finish();
          return;
        }
        if (inputs.loadingDoor !== door || (inputs.dockedMask & (1 << door)) === 0) {
          // The truck closed up on the way: back to the rack place with the pallet, once the aisle may be taken.
          const slot = SLOTS[place] as RackSlotM;
          const back = rowOf(slot) + 1;
          if (!loadingMayTake(locks, back)) return;
          setLock(back);
          puttingBack = true;
          route.begin(pose);
          planToPlace(slot, back);
          route.finish();
          return;
        }
        route.begin(pose);
        // Lift to the deck, turn to the trailer, drive up so the pallet stands on its tail, set it down, back out.
        route.lift(DECK_M + OVER_M);
        route.pivotTo(SOUTH);
        route.line(pose.x, pose.z + TRAILER_IN_M, false, FORKLIFT_MOTION.slowMps);
        route.mark('landing', DECK_M);
        route.lift(DECK_M - UNDER_M);
        route.mark('release');
        route.line(pose.x, pose.z, true, FORKLIFT_MOTION.slowMps);
        route.lift(0);
        route.pivotTo(EAST);
        route.finish();
        job = 'drop';
        return;
      case 'drop':
        puttingBack = false;
        if (!startLoadingTrip(inputs)) planHome();
        return;
    }
  };

  /** From the turning point at its rack place, the pallet on the forks, to the door's turning point. */
  const planToDoor = (toDoor: number, inputs: ForkliftInputs): void => {
    const doorX = inputs.doorsXM[toDoor] as number;
    const frontZ = AISLE_Z_M[FRONT_AISLE];
    if (aisle === FRONT_AISLE) {
      route.line(doorX, frontZ, doorX < pose.x, FORKLIFT_MOTION.loadedMps);
      route.mark('unreserve');
      return;
    }
    route.line(LANE_2_X_M, pose.z, false, FORKLIFT_MOTION.loadedMps);
    route.pivotTo(SOUTH);
    route.drive([[LANE_2_X_M, frontZ], [LANE_2_X_M - CORNER_M - 0.1, frontZ]], false, FORKLIFT_MOTION.loadedMps);
    route.mark('unreserve');
    route.line(doorX, frontZ, false, FORKLIFT_MOTION.loadedMps);
  };

  const planHome = (): void => {
    route.begin(pose);
    const frontZ = AISLE_Z_M[FRONT_AISLE];
    if (Math.abs(pose.z - frontZ) < 1e-3) {
      route.pivotTo(EAST);
      route.line(LOADING_PARK[0], LOADING_PARK[1], LOADING_PARK[0] < pose.x, FORKLIFT_MOTION.emptyMps);
    } else {
      route.line(LANE_2_X_M, pose.z, false, FORKLIFT_MOTION.emptyMps);
      route.line(LOADING_PARK[0], LOADING_PARK[1], false, FORKLIFT_MOTION.emptyMps);
    }
    route.pivotTo(NORTH);
    route.mark('unreserve');
    route.finish();
    job = 'home';
  };

  /** Sets off for the racks' last filled place if a truck loads, the aisle may be taken and the trip fits. */
  const startLoadingTrip = (inputs: ForkliftInputs): boolean => {
    if (inputs.loadingDoor < 0 || inputs.placesShown <= 0) return false;
    const target = Math.min(inputs.placesShown, inputs.places) - 1;
    const slot = SLOTS[target] as RackSlotM;
    const toAisle = rowOf(slot) + 1;
    if (!loadingMayTake(locks, toAisle)) return false;
    // A trip that would not be done before the truck closes up is not started.
    const doorX = inputs.doorsXM[inputs.loadingDoor] as number;
    const tripM =
      Math.abs(pose.x - slot.xM) + Math.abs(pose.z - (AISLE_Z_M[toAisle] as number)) + Math.abs(slot.xM - doorX) + 2 * Math.abs(AISLE_Z_M[FRONT_AISLE] - (AISLE_Z_M[toAisle] as number));
    if (tripM / FORKLIFT_MOTION.loadedMps + 45 > inputs.loadingLeftS) return false;
    place = target;
    setLock(toAisle);
    route.begin(pose);
    planToPlace(slot, toAisle);
    route.finish();
    job = 'toPick';
    return true;
  };

  const driver = {
    role,
    get job() {
      return job;
    },
    get xM() {
      return pose.x + Math.sin(pose.heading) * PIVOT_BACK_M;
    },
    get zM() {
      return pose.z + Math.cos(pose.heading) * PIVOT_BACK_M;
    },
    get headingRad() {
      return pose.heading;
    },
    get liftM() {
      return pose.lift;
    },
    get speedMps() {
      return route.driving() ? route.speed : 0;
    },
    get lifting() {
      return route.current()?.kind === 'lift';
    },
    get carrying() {
      return carrying;
    },
    get beacon() {
      return beacon;
    },
    get tiltRad() {
      return tiltRad;
    },
    get steerLeftRad() {
      return route.steerL;
    },
    get steerRightRad() {
      return route.steerR;
    },
    carried,
    setDown,
    waiting,
    get place() {
      return place;
    },
    update(dtS: number, inputs: ForkliftInputs) {
      if (role === 'putAway') {
        if (lastPlaces !== null && inputs.placesShown > lastPlaces) pending = Math.min(MAX_PENDING, pending + inputs.placesShown - lastPlaces);
        lastPlaces = inputs.placesShown;
        if (setDown.shown && inputs.placesShown !== setDownPlace) setDown.shown = false;
      } else if (setDown.shown && (setDownDoor < 0 || (inputs.dockedMask & (1 << setDownDoor)) === 0)) setDown.shown = false;

      if (dtS > 0) {
        route.laden = carrying;
        route.play(dtS, pose, onMark);
        flashS = (flashS + dtS) % (1 / BEACON_HZ);
        // Back for the whole trip with a pallet, the forks low, turns on the spot included; level to pick it up, to lift
        // it at its place and to set it down (a driver tilts back once loaded and levels the forks to place).
        const tiltTo = carrying && job === 'toDrop' && pose.lift <= TRAVEL_LIFT_M + 0.02 ? FORKLIFT_MOTION.tiltBackRad : 0;
        const tiltStep = FORKLIFT_MOTION.tiltRadPerS * dtS;
        tiltRad = tiltRad + Math.max(-tiltStep, Math.min(tiltStep, tiltTo - tiltRad));
      }
      if (route.done) {
        if (role === 'putAway') putAwayNext(inputs);
        else loadingNext(inputs);
      }
      if (carrying && restingOn >= 0 && pose.lift >= restingOn) restingOn = -1;

      carried.shown = carrying;
      carried.headingRad = pose.heading;
      carried.xM = pose.x + Math.sin(pose.heading) * PALLET_AHEAD_M;
      carried.zM = pose.z + Math.cos(pose.heading) * PALLET_AHEAD_M;
      carried.yM = Math.max(pose.lift, restingOn, landingOn);
      if (role === 'putAway') {
        waiting.shown = pending > 0 && (job === 'parked' || job === 'toPick' || job === 'home' || job === 'drop' || (job === 'pick' && !carrying));
        waiting.xM = PUT_AWAY_PICK[0] + PALLET_AHEAD_M;
        waiting.zM = PICK_Z_M;
        waiting.yM = 0;
        waiting.headingRad = EAST;
      }
      beacon = job !== 'parked' && (inputs.steadyBeacon || flashS * BEACON_HZ < 0.5);
    },
  };
  return driver;
}

/**
 * The angle a rear wheel at (`wheelXM`, `wheelZM`) stands at to roll round a turning centre at (`centreXM`,
 * `centreZM`), all in the forklift's frame (x across, z toward its forks, from its footprint centre; phase 14, D24):
 * square to the line from the centre to the wheel. A wheel rolls either way, so of that direction and its reverse
 * the one within a quarter turn of straight is taken, held to ±STEER_MAX_RAD. In a turn on the spot about the middle
 * of the body the two wheels stand splayed, each on its own circle, and the same whichever way it turns.
 */
export function wheelSteerRad(wheelXM: number, wheelZM: number, centreXM: number, centreZM: number): number {
  // Turning about +y, a point moves along (z, -x) from the centre (rotation.y = heading).
  let rad = Math.atan2(wheelZM - centreZM, centreXM - wheelXM);
  if (rad > Math.PI / 2) rad -= Math.PI;
  else if (rad <= -Math.PI / 2) rad += Math.PI;
  return Math.max(-STEER_MAX_RAD, Math.min(STEER_MAX_RAD, rad));
}
