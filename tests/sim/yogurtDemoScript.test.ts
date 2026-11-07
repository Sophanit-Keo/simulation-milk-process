// The yogurt demo (docs/demo-script.md, "The yogurt demo", phase 21) replayed headlessly: the yogurt line's five faults
// at the script's clock times and speeds, on the shipped config and seed, so every number the script tells the presenter
// to expect is checked. The faults follow one another, so each starts from what the one before left: the seal test comes
// 50 min late because the HEPA loss stopped P8, and the cold room's destroyed pallets were the reefers' stock.
import { describe, expect, it } from 'vitest';
import { hToS, type Command, type ScenarioId, type Snapshot } from '../../src/contracts';
import { createSim } from '../../src/sim';
import { formatDayTime } from '../../src/sim/log';
import { copyConfig } from '../helpers/plantConfig';

/** When each fault starts, in sim seconds after the opening (day 8, 06:00), once the 2 min yogurt tour at ×10 is over. */
const AT_S = { phage: 1_200, hepa: 1_260, seal: 1_320, coldRoom: 1_380 } as const;

const config = copyConfig();
const sim = createSim(config);
const openS = sim.snapshot().timeS;
const t = (): number => sim.snapshot().timeS - openS;
let speed = config.clock.defaultSpeed as number;
const send = (command: Command): void => {
  if (command.type === 'setSpeed') speed = command.speed;
  sim.dispatch(command);
};
function runTo(tS: number, each?: (snap: Snapshot) => void): Snapshot {
  while (t() < tS - 1e-6) {
    sim.step(Math.min(config.clock.maxFrameS, Math.max(tS - t(), 1e-6) / speed));
    each?.(sim.snapshot());
  }
  return sim.snapshot();
}
const trigger = (id: ScenarioId): void => send({ type: 'triggerScenario', id });

const opening = sim.snapshot();
const atPhage = runTo(AT_S.phage);
trigger('yogurtSlowFermentation');
runTo(AT_S.hepa);
trigger('yogurtHepaLoss');
runTo(AT_S.seal);
trigger('yogurtSealDrift');
runTo(AT_S.coldRoom);
trigger('yogurtColdRoomExcursion');
send({ type: 'setSpeed', speed: 100 });
// The heat dip as soon as its menu entry turns on: the heat treatment back in production at the mix line's 6,000 L/h.
let heatAtS: number | null = null;
const noon = runTo(hToS(8), (snap) => {
  if (heatAtS !== null || snap.scenarios.unavailable.yogurtHeatUnderTemp || snap.yogurt.heat.flowLph < config.yogurt.mix.capacityLph - 1) return;
  heatAtS = snap.timeS;
  send({ type: 'setSpeed', speed: 10 });
  trigger('yogurtHeatUnderTemp');
});
send({ type: 'setSpeed', speed: 10_000 });
const nextMorning = runTo(hToS(24));

const runOf = (id: ScenarioId) => {
  const run = noon.scenarios.runs.find((each) => each.id === id);
  if (!run) throw new Error(`no ${id} run`);
  return run;
};
/** "day 8, 10:00": when the run's entry that matches was logged. */
function at(id: ScenarioId, pattern: RegExp): string {
  const entry = runOf(id).log.find((each) => pattern.test(each.message));
  if (!entry) throw new Error(`${id}: no entry ${String(pattern)}`);
  return formatDayTime(entry.timeS);
}
const message = (id: ScenarioId, pattern: RegExp): string => runOf(id).log.find((each) => pattern.test(each.message))?.message ?? '';

describe('the yogurt demo (docs/demo-script.md)', () => {
  it('step 1: the wing as it opens', () => {
    const { ferment, coldChain, heat } = opening.yogurt;
    expect(ferment.tanks.map((tank) => tank.state)).toEqual(['ready', 'ready', 'fermenting']);
    expect(ferment.tanks[2]?.ph).toBeCloseTo(5.575, 3);
    expect(formatDayTime(ferment.tanks[2]?.readyAtS ?? 0)).toBe('day 8, 08:00');
    expect(heat.mode).toBe('idle');
    expect([coldChain.warmRoom.pallets, coldChain.chiller.pallets, coldChain.coldRoom.positionsUsed]).toEqual([30, 18, 180]);
    expect(coldChain.coldRoom.tempC).toBe(3);
  });

  it('step 3: the phage stalls tank 3 at pH 5.2; it is flagged at 10:00 and discarded at 12:00', () => {
    expect(atPhage.yogurt.ferment.tanks[2]?.ph).toBeCloseTo(5.36, 2);
    expect(at('yogurtSlowFermentation', /flagged/)).toBe('day 8, 10:00');
    expect(at('yogurtSlowFermentation', /discarded/)).toBe('day 8, 12:00');
    expect(message('yogurtSlowFermentation', /discarded/)).toMatch(/10,000 L/);
  });

  it('step 4: the HEPA loss stops P8 at 06:21; repaired at 06:51, it is cleared at 07:11 after the SIP and swab', () => {
    expect(at('yogurtHepaLoss', /^Line P8 stopped/)).toBe('day 8, 06:21');
    expect(at('yogurtHepaLoss', /fan repaired/)).toBe('day 8, 06:51');
    expect(at('yogurtHepaLoss', /cleared to start/)).toBe('day 8, 07:11');
  });

  it('step 5: the seal test, late by P8\'s 50 min stop, fails at 08:50 and holds 43,192 cups, emptying 14 pallets', () => {
    expect(at('yogurtSealDrift', /seal test failed/)).toBe('day 8, 08:50');
    expect(message('yogurtSealDrift', /seal test failed/)).toMatch(/5 of 5 cups leaked; 43,1\d\d cups held/);
    expect(message('yogurtSealDrift', /pulled/)).toMatch(/1[34] pallets emptied/);
  });

  it('step 6: the cold room is over 6 °C at 06:39, holds its pallets at 08:39, and QA destroys them at 11:48', () => {
    expect(at('yogurtColdRoomExcursion', /air over 6 °C/)).toBe('day 8, 06:39');
    expect(at('yogurtColdRoomExcursion', /on QA hold/)).toBe('day 8, 08:39');
    expect(at('yogurtColdRoomExcursion', /cooling repaired/)).toBe('day 8, 09:23');
    expect(at('yogurtColdRoomExcursion', /back under 6 °C/)).toBe('day 8, 09:48');
    expect(at('yogurtColdRoomExcursion', /^QA destroys/)).toBe('day 8, 11:48');
    expect(message('yogurtColdRoomExcursion', /^QA destroys/)).toMatch(/^QA destroys the 1[78]\d held pallets, [\d,]+ cups: their cores reached 9\.1 °C/);
  });

  it('step 7: the heat dip turns on at about 09:55; the mix diverts 5 min later, and the line is clean at 11:23', () => {
    expect(formatDayTime(heatAtS ?? 0)).toBe('day 8, 09:55');
    expect(at('yogurtHeatUnderTemp', /diverted/)).toBe('day 8, 10:00');
    expect(at('yogurtHeatUnderTemp', /cleaning after the divert/)).toBe('day 8, 10:03');
    expect(at('yogurtHeatUnderTemp', /clean, ready to run again/)).toBe('day 8, 11:23');
  });

  it('step 8: by day 9, 06:00 every run is over, and one reefer has left: the cold room lost its released stock', () => {
    for (const run of nextMorning.scenarios.runs) expect(run.following, run.id).toBe(false);
    expect(nextMorning.yogurt.coldChain.reefersShipped).toBe(1);
    expect(nextMorning.yogurt.coldChain.cupsHeld).toBeGreaterThan(43_000);
    expect(nextMorning.yogurt.p8.cupsMade).toBeGreaterThan(355_000);
    expect(nextMorning.yogurt.p8.cupsMade).toBeLessThan(365_000);
  });
});
