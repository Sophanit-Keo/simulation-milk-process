// What createSim and createMockSim share: the clock, the event queue, the log,
// the live set points and every command. They differ only in the stage values.
import {
  CONTRACT_VERSION,
  isSpeed,
  SETPOINT_RANGES,
  type Command,
  type Kpis,
  type LinePoint,
  type LinePointId,
  type LiquidSnapshot,
  type LogEntry,
  type LogKind,
  type PacksSnapshot,
  type PlantConfig,
  type ScenarioId,
  type ScenariosSnapshot,
  type ScenarioVariant,
  type SetpointKey,
  type Snapshot,
  type StageId,
  type StageSnapshot,
} from '../contracts';
import { Clock, type StepHandler } from './clock';
import { EventQueue, type QueuedEvent } from './eventQueue';
import { createLog, formatDayTime, type LogTag, type LogWriter } from './log';

export type Setpoints = Record<SetpointKey, number>;

const SETPOINT_TEXT: Record<SetpointKey, { name: string; unit: string }> = {
  uhtSetpointC: { name: 'UHT set point', unit: '°C' },
  homogenizerStage1Bar: { name: 'Homogenizer stage 1 pressure', unit: 'bar' },
  fillerRatePacksPerH: { name: 'Filler rate', unit: 'packs/h' },
};

export interface CoreOptions {
  /** Continuous-model work for one fixed step. Runs before that step's due events (plan 07, "Every frame"). */
  onStep?: StepHandler;
  /**
   * Every queued event as it falls due, the core's own shift changes included (after the core has handled
   * them). Returns true if it handled the event; the core logs one that nobody handled.
   */
  onEvent?: (event: QueuedEvent) => boolean;
  /** A setQaResult command, for the model that keeps the batches; without one the core logs that it can't apply it. */
  onQaResult?: (batchId: number, result: 'pass' | 'fail') => void;
  /** A triggerScenario command (phase 5); without one the core logs that this sim has no scenarios. */
  onScenario?: (id: ScenarioId, variant: ScenarioVariant | undefined) => void;
  /** A resetScenarios command (phase 5). */
  onResetScenarios?: () => void;
  /**
   * Every log entry before it is kept, with what it is about: returns the scenario that caused it and why, if
   * one did (phase 5). The scenarios gather their logs here.
   */
  annotateLog?: (entry: LogEntry, tag: LogTag | undefined) => Pick<LogEntry, 'scenario' | 'why'> | undefined;
}

export interface SimCore {
  readonly timeS: number;
  /** Live set points: plant.json values until a setSetpoint command changes one. */
  readonly setpoints: Readonly<Setpoints>;
  log: LogWriter;
  /** Queues an event for the discrete model; it runs through onEvent when it falls due. */
  schedule<P>(timeS: number, type: string, payload: P): QueuedEvent<P>;
  /** Removes a queued event; false if it already ran or was cancelled. */
  cancel(seq: number): boolean;
  step(realDtS: number): void;
  dispatch(command: Command): void;
  /** Wraps the caller's stages, KPIs, liquid line, packs and scenarios with the clock, queue and log state. */
  snapshot(
    stages: Record<StageId, StageSnapshot>,
    kpis: Kpis,
    line: Record<LinePointId, LinePoint>,
    liquid: LiquidSnapshot,
    packs: PacksSnapshot,
    scenarios: ScenariosSnapshot,
  ): Snapshot;
}

export function createCore(config: PlantConfig, options: CoreOptions = {}): SimCore {
  const { defaultSpeed, ...clockSteps } = config.clock;
  if (!isSpeed(defaultSpeed)) throw new RangeError(`clock.defaultSpeed must be one of the speed presets, got ${defaultSpeed}`);
  const { batchS, firstShiftStartS } = config.quality;
  // A batch shorter than a step would run several shift changes in one step, and a tiny one would keep
  // scheduling them at the same instant forever.
  if (!(batchS >= clockSteps.fastStepS && Number.isFinite(batchS))) {
    throw new RangeError(`quality.batchS must be at least clock.fastStepS (${clockSteps.fastStepS} s), got ${batchS}`);
  }

  const clock = new Clock({ ...clockSteps, speed: defaultSpeed });
  const queue = new EventQueue();
  const simLog = createLog();
  const log = {
    add(timeS: number, kind: LogKind, message: string, tag?: LogTag): void {
      simLog.add(timeS, kind, message, options.annotateLog?.({ timeS, kind, message }, tag));
    },
    entries: () => simLog.entries(),
  };
  const setpoints: Setpoints = {
    uhtSetpointC: config.uht.setpointC,
    homogenizerStage1Bar: config.homogenizer.stage1Bar,
    fillerRatePacksPerH: config.fillers.ratePacksPerH,
  };

  function runEvent(event: QueuedEvent): void {
    switch (event.type) {
      case 'shiftChange': {
        log.add(event.timeS, 'info', 'Shift change: each filler starts a new batch');
        const nextS = event.timeS + batchS;
        // Far out in time a batch can round away to nothing; the change would then be due again at once, forever.
        if (!(nextS > event.timeS)) throw new RangeError(`A ${batchS} s batch does not move past ${event.timeS} s`);
        queue.schedule(nextS, 'shiftChange');
        options.onEvent?.(event);
        return;
      }
      default:
        if (!options.onEvent?.(event)) log.add(event.timeS, 'warn', `Unknown event "${event.type}" skipped`);
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

  const rangeOf = (key: SetpointKey): { min: number; max: number } =>
    key === 'fillerRatePacksPerH' ? { min: 0, max: config.fillers.maxRatePacksPerH } : SETPOINT_RANGES[key];

  function setSetpoint(key: SetpointKey, value: number): void {
    const text = SETPOINT_TEXT[key] as (typeof SETPOINT_TEXT)[SetpointKey] | undefined;
    if (!text) {
      log.add(clock.timeS, 'warn', `Unknown set point "${key}" ignored`);
    } else if (!Number.isFinite(value)) {
      log.add(clock.timeS, 'warn', `${text.name} not changed: ${value} is not a number`);
    } else if (!(value >= rangeOf(key).min && value <= rangeOf(key).max)) {
      const { min, max } = rangeOf(key);
      log.add(clock.timeS, 'warn', `${text.name} not changed: ${value} ${text.unit} is outside ${min}–${max} ${text.unit}`);
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
        if (options.onScenario) options.onScenario(command.id, command.variant);
        else log.add(clock.timeS, 'warn', `Scenario "${command.id}" not started: this sim has no fault scenarios`);
        return;
      case 'resetScenarios':
        if (options.onResetScenarios) options.onResetScenarios();
        else log.add(clock.timeS, 'info', 'No scenarios to reset: this sim has none');
        return;
      case 'setQaResult':
        if (options.onQaResult) options.onQaResult(command.batchId, command.result);
        else log.add(clock.timeS, 'info', `QA result "${command.result}" for batch ${command.batchId} not applied: this sim keeps no batches`);
        return;
      default:
        unknownCommand(command);
    }
  }

  // The first shift change strictly after the start, on the grid firstShiftStartS + n × batchS
  // (D1: 06:00, 14:00 and 22:00).
  const shiftsSinceFirst = Math.floor((clock.timeS - firstShiftStartS) / batchS) + 1;
  queue.schedule(firstShiftStartS + shiftsSinceFirst * batchS, 'shiftChange');
  log.add(clock.timeS, 'info', `Plant opens: ${formatDayTime(clock.timeS)}`);

  return {
    get timeS() {
      return clock.timeS;
    },
    setpoints,
    log: (timeS, kind, message, tag) => log.add(timeS, kind, message, tag),
    schedule: (timeS, type, payload) => queue.schedule(timeS, type, payload),
    cancel: (seq) => queue.cancel(seq),
    step: (realDtS) => {
      // No step crosses a queued event, so each event runs at exactly its own time and the log stays in
      // time order, even after a speed change has moved the steps off the shift grid.
      clock.advance(realDtS, onStep, () => queue.peek()?.timeS);
    },
    dispatch,
    snapshot: (stages, kpis, line, liquid, packs, scenarios) => ({
      version: CONTRACT_VERSION,
      timeS: clock.timeS,
      speed: clock.speed,
      paused: clock.paused,
      nextEventS: queue.peek()?.timeS ?? null,
      stages,
      line,
      liquid,
      packs,
      scenarios,
      kpis,
      log: log.entries(),
    }),
  };
}
