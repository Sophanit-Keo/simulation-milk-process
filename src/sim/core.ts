// What createSim and createMockSim share: the clock, the event queue, the log,
// the live set points and every command. They differ only in the stage values.
import {
  CONTRACT_VERSION,
  hToS,
  isSpeed,
  type Command,
  type Kpis,
  type LogKind,
  type PlantConfig,
  type SetpointKey,
  type Snapshot,
  type StageId,
  type StageSnapshot,
} from '../contracts';
import { Clock, type StepHandler } from './clock';
import { EventQueue, type QueuedEvent } from './eventQueue';
import { createLog, formatDayTime } from './log';

/** Shifts, and with them batches, change at 06:00, 14:00 and 22:00 (sim assumption, as in the preview). */
export const FIRST_SHIFT_START_S = hToS(6);

export type Setpoints = Record<SetpointKey, number>;

const SETPOINT_TEXT: Record<SetpointKey, { name: string; unit: string }> = {
  uhtSetpointC: { name: 'UHT set point', unit: '°C' },
  homogenizerStage1Bar: { name: 'Homogenizer stage 1 pressure', unit: 'bar' },
  fillerRatePacksPerH: { name: 'Filler rate', unit: 'packs/h' },
};

export interface CoreOptions {
  /** Continuous-model work for one fixed step. Runs before that step's due events (plan 07, "Every frame"). */
  onStep?: StepHandler;
}

export interface SimCore {
  readonly timeS: number;
  /** Live set points: plant.json values until a setSetpoint command changes one. */
  readonly setpoints: Readonly<Setpoints>;
  log(timeS: number, kind: LogKind, message: string): void;
  step(realDtS: number): void;
  dispatch(command: Command): void;
  /** Wraps the caller's stages and KPIs with the clock, queue and log state. */
  snapshot(stages: Record<StageId, StageSnapshot>, kpis: Kpis): Snapshot;
}

export function createCore(config: PlantConfig, options: CoreOptions = {}): SimCore {
  const { defaultSpeed, ...clockSteps } = config.clock;
  if (!isSpeed(defaultSpeed)) throw new RangeError(`clock.defaultSpeed must be one of the speed presets, got ${defaultSpeed}`);
  const { batchS } = config.quality;
  // A zero batch length would schedule shift changes at the same instant forever.
  if (!(batchS > 0 && Number.isFinite(batchS))) throw new RangeError(`quality.batchS must be positive, got ${batchS}`);

  const clock = new Clock({ ...clockSteps, speed: defaultSpeed });
  const queue = new EventQueue();
  const log = createLog();
  const setpoints: Setpoints = {
    uhtSetpointC: config.uht.setpointC,
    homogenizerStage1Bar: config.homogenizer.stage1Bar,
    fillerRatePacksPerH: config.fillers.ratePacksPerH,
  };

  function runEvent(event: QueuedEvent): void {
    switch (event.type) {
      case 'shiftChange':
        log.add(event.timeS, 'info', 'Shift change: each filler starts a new batch');
        queue.schedule(event.timeS + batchS, 'shiftChange');
        return;
      default:
        log.add(event.timeS, 'warn', `Unknown event "${event.type}" skipped`);
    }
  }

  const onStep: StepHandler = (dtS, timeS) => {
    options.onStep?.(dtS, timeS);
    // Peek rather than popDue, so an event scheduled for this same instant by a handler still runs now.
    for (let next = queue.peek(); next && next.timeS <= timeS; next = queue.peek()) {
      queue.pop();
      runEvent(next);
    }
  };

  function setSetpoint(key: SetpointKey, value: number): void {
    const text = SETPOINT_TEXT[key] as (typeof SETPOINT_TEXT)[SetpointKey] | undefined;
    if (!text) {
      log.add(clock.timeS, 'warn', `Unknown set point "${key}" ignored`);
    } else if (!Number.isFinite(value)) {
      log.add(clock.timeS, 'warn', `${text.name} not changed: ${value} is not a number`);
    } else {
      setpoints[key] = value;
      log.add(clock.timeS, 'info', `${text.name} set to ${value} ${text.unit}`);
    }
  }

  // A command the contract doesn't know yet (a newer UI against an older sim) is logged, not thrown.
  function unknownCommand(command: never): void {
    log.add(clock.timeS, 'warn', `Unknown command "${(command as { type?: unknown }).type}" ignored`);
  }

  function dispatch(command: Command): void {
    switch (command.type) {
      case 'setSpeed':
        clock.setSpeed(command.speed);
        return;
      case 'pause':
        clock.setPaused(command.paused);
        return;
      case 'nextEvent': {
        const next = queue.peek();
        if (next) clock.jumpTo(next.timeS, onStep);
        else log.add(clock.timeS, 'info', 'No events queued');
        return;
      }
      case 'setSetpoint':
        setSetpoint(command.key, command.value);
        return;
      case 'triggerScenario':
        log.add(clock.timeS, 'warn', `Scenario "${command.id}" not started: fault scenarios arrive in phase 5`);
        return;
      case 'setQaResult':
        log.add(clock.timeS, 'info', `QA result "${command.result}" for batch ${command.batchId} not applied: QA results arrive in phase 4`);
        return;
      default:
        unknownCommand(command);
    }
  }

  // The first shift change strictly after the start, on the 06:00 / 14:00 / 22:00 grid.
  const shiftsSinceFirst = Math.floor((clock.timeS - FIRST_SHIFT_START_S) / batchS) + 1;
  queue.schedule(FIRST_SHIFT_START_S + shiftsSinceFirst * batchS, 'shiftChange');
  log.add(clock.timeS, 'info', `Plant opens: ${formatDayTime(clock.timeS)}`);

  return {
    get timeS() {
      return clock.timeS;
    },
    setpoints,
    log: (timeS, kind, message) => log.add(timeS, kind, message),
    step: (realDtS) => {
      clock.advance(realDtS, onStep);
    },
    dispatch,
    snapshot: (stages, kpis) => ({
      version: CONTRACT_VERSION,
      timeS: clock.timeS,
      speed: clock.speed,
      paused: clock.paused,
      nextEventS: queue.peek()?.timeS ?? null,
      stages,
      kpis,
      log: log.entries(),
    }),
  };
}
