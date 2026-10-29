// The recorded snapshot fixtures (tests/fixtures/record.ts): each one still matches what createSim
// records now, keeps every contracts v3 shape rule, and shows the state it is named for. With
// RECORD_FIXTURES=1 the files are written first, so the comparison then passes and git shows the diff.
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  LINE_POINT_IDS,
  STAGE_IDS,
  STEAM_USES,
  UHT_MODES,
  isSpeed,
  parseStages,
  type Kpis,
  type Snapshot,
} from '../../src/contracts';
import stagesJson from '../../src/data/stages.json';
import { expectWithin } from '../helpers/expectWithin';
import { expectPacksMatchKpis, expectWellFormedPacks } from '../helpers/packsShape';
import { expectWellFormedScenarios } from '../helpers/scenariosShape';
import { plantConfig } from '../helpers/plantConfig';
import { FIXTURES, loadFixture, recordFixture, writeFixture, type FixtureName } from './record';

const NAMES = Object.keys(FIXTURES) as FixtureName[];
const RECORDING = Boolean(process.env.RECORD_FIXTURES);

const KPI_KEYS: readonly (keyof Kpis)[] = [
  'uhtFlowLph', 'f0Min', 'bStar', 'divertedL', 'tankLevelPct', 'packsPerH', 'oeePct', 'traysMade',
  'palletsMade', 'batchesOnHold', 'batchesReleased', 'batchesBlocked', 'palletsInStock', 'daysOfCover',
  'orderFillPct', 'trucksShipped',
];
const STATUSES = ['ok', 'warn', 'bad', 'idle'];
const LOG_KINDS = ['info', 'ok', 'warn', 'bad'];

/** The per-stage keys agreed for phase 3, on top of the phase 2 keys (phase 3 lane notes). */
const PHASE_3_KEYS: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, readonly string[]>> = {
  1: ['rawMilkLph', 'surplusCreamLph', 'siloLevelPct', 'mixTankLevelPct'],
  2: ['airPct', 'heatRecoveredKw'],
  3: ['globuleUm', 'creamingRiskPct', 'powerKw'],
  4: ['setpointC', 'tempC', 'flowLph', 'holdS', 'f0Min', 'bStar', 'divertLimitC', 'rejectLevelL'],
  5: ['waterRemovedLph', 'condenserKw'],
  6: ['levelL', 'levelPct', 'capacityL', 'tempC', 'inflowLph', 'outflowLph', 'headspaceBar', 'nextCleanS'],
};

/** Paths where two plain-JSON values differ; numbers count as equal within 1e-9 relative (libm rounding only). */
function differences(recorded: unknown, stored: unknown, path = '$', found: string[] = []): string[] {
  if (found.length >= 20) return found;
  if (typeof recorded === 'number' && typeof stored === 'number') {
    if (Math.abs(recorded - stored) > 1e-9 * Math.max(1, Math.abs(stored))) found.push(`${path}: ${stored} in the file, ${recorded} now`);
  } else if (Array.isArray(recorded) && Array.isArray(stored)) {
    if (recorded.length !== stored.length) found.push(`${path}: ${stored.length} items in the file, ${recorded.length} now`);
    else recorded.forEach((item, i) => differences(item, stored[i], `${path}[${i}]`, found));
  } else if (recorded && stored && typeof recorded === 'object' && typeof stored === 'object') {
    const keys = new Set([...Object.keys(recorded), ...Object.keys(stored)]);
    for (const key of keys) {
      if (!(key in recorded)) found.push(`${path}.${key}: in the file, gone now`);
      else if (!(key in stored)) found.push(`${path}.${key}: new, not in the file`);
      else differences((recorded as Record<string, unknown>)[key], (stored as Record<string, unknown>)[key], `${path}.${key}`, found);
    }
  } else if (recorded !== stored) {
    found.push(`${path}: ${JSON.stringify(stored)} in the file, ${JSON.stringify(recorded)} now`);
  }
  return found;
}

/** The per-stage keys agreed for phase 4 (contracts v3), on top of the phase 2 keys. */
const PHASE_4_KEYS: Readonly<Record<7 | 8 | 9 | 10, readonly string[]>> = {
  7: ['runningCount', 'packsPerH', 'oeePct', 'packsMade', 'packsRejected'],
  8: ['queuePacks', 'traysMade', 'palletsMade'],
  9: ['batchesOnHold', 'palletsInQuarantine', 'nextReleaseS', 'batchesReleased', 'batchesBlocked', 'samplesTaken'],
  10: ['palletsInStock', 'daysOfCover', 'trucksAtDock', 'nextTruckS', 'trucksShipped', 'orderFillPct'],
};

/** Every shape rule of contracts v4 (src/contracts/snapshot.ts, packs.ts, scenarios.ts) that a consumer may rely on. */
function expectContracts(snap: Snapshot, where: string): void {
  expect(snap.version, `${where}: version`).toBe(CONTRACT_VERSION);
  expect(CONTRACT_VERSION).toBe(6);
  expect(Number.isFinite(snap.timeS), `${where}: timeS`).toBe(true);
  expect(isSpeed(snap.speed), `${where}: speed ${snap.speed}`).toBe(true);
  expect(typeof snap.paused, `${where}: paused`).toBe('boolean');
  expect(snap.nextEventS === null || Number.isFinite(snap.nextEventS), `${where}: nextEventS`).toBe(true);

  expect(Object.keys(snap.stages).map(Number), `${where}: stage ids`).toEqual([...STAGE_IDS]);
  for (const id of STAGE_IDS) {
    const stage = snap.stages[id];
    expect(stage.id, `${where}: stages[${id}].id`).toBe(id);
    expect(STATUSES, `${where}: stage ${id} status`).toContain(stage.status);
    for (const [key, value] of Object.entries(stage.values)) {
      if (!Number.isFinite(value)) expect.fail(`${where}: stage ${id} ${key} is ${value}`);
    }
  }
  for (const [id, keys] of [...Object.entries(PHASE_3_KEYS), ...Object.entries(PHASE_4_KEYS)]) {
    for (const key of keys) expect(snap.stages[Number(id) as 1].values, `${where}: stage ${id}`).toHaveProperty([key]);
  }
  expectWellFormedPacks(snap, plantConfig, where);
  expectWellFormedScenarios(snap, where);
  // Every row the info panel shows (stages.json) has its value in the snapshot.
  for (const stage of parseStages(stagesJson)) {
    for (const { key } of stage.values) expect(snap.stages[stage.id].values, `${where}: stage ${stage.id} row`).toHaveProperty([key]);
  }

  expect(Object.keys(snap.line).sort(), `${where}: line points`).toEqual([...LINE_POINT_IDS].sort());
  for (const id of LINE_POINT_IDS) {
    const { tempC, flowLph } = snap.line[id];
    if (!(Number.isFinite(tempC) && Number.isFinite(flowLph) && flowLph >= 0)) expect.fail(`${where}: line.${id} is ${tempC} °C, ${flowLph} L/h`);
  }

  const { liquid } = snap;
  expect(UHT_MODES, `${where}: uhtMode`).toContain(liquid.uhtMode);
  expect(typeof liquid.throttled, `${where}: throttled`).toBe('boolean');
  expect(typeof liquid.fillersStarved, `${where}: fillersStarved`).toBe('boolean');
  for (const key of ['modeRemainingS', 'fillersRunning', 'headspaceBar', 'productionSinceCleanS', 'divertCount'] as const) {
    if (!(Number.isFinite(liquid[key]) && liquid[key] >= 0)) expect.fail(`${where}: liquid.${key} is ${liquid[key]}`);
  }
  expect(Number.isInteger(liquid.fillersRunning) && Number.isInteger(liquid.divertCount), `${where}: whole counts`).toBe(true);
  expect(liquid.uhtMode === 'production' ? liquid.modeRemainingS === 0 : liquid.modeRemainingS > 0, `${where}: modeRemainingS`).toBe(true);
  // Contracts v5: the cleaning step, present exactly while the plant runs a CIP or an AIC.
  const cleaning = liquid.cleaning ?? null;
  expect(cleaning !== null, `${where}: cleaning while ${liquid.uhtMode}`).toBe(liquid.uhtMode === 'cip' || liquid.uhtMode === 'aic');
  if (cleaning) {
    expect(cleaning.program, `${where}: cleaning.program`).toBe(liquid.uhtMode);
    expect(cleaning.stepIndex >= 0 && cleaning.stepIndex < cleaning.stepCount, `${where}: cleaning.stepIndex`).toBe(true);
    expect(cleaning.stepRemainingS >= 0 && cleaning.stepRemainingS <= liquid.modeRemainingS + 1e-6, `${where}: cleaning.stepRemainingS`).toBe(true);
  }
  // Contracts v6: the steam and energy, every rate and total a number of 0 or more, and what the steam heats.
  const energy = liquid.energy;
  if (!energy) expect.fail(`${where}: no liquid.energy`);
  for (const key of ['steamKgPerH', 'gasKw', 'electricKw', 'steamKg', 'gasKwh', 'electricKwh'] as const) {
    if (!(Number.isFinite(energy[key]) && energy[key] >= 0)) expect.fail(`${where}: energy.${key} is ${energy[key]}`);
  }
  expect(energy.steamUse === null ? energy.steamKgPerH === 0 : STEAM_USES.includes(energy.steamUse), `${where}: energy.steamUse`).toBe(true);
  expect(energy.regenerationPct === null || (energy.regenerationPct >= 0 && energy.regenerationPct <= 100), `${where}: energy.regenerationPct`).toBe(true);
  expect(energy.kwhPerT === null || (Number.isFinite(energy.kwhPerT) && energy.kwhPerT >= 0), `${where}: energy.kwhPerT`).toBe(true);
  expect(Object.keys(liquid.tanks).sort(), `${where}: tanks`).toEqual(['asepticTank', 'mixTank', 'rejectTank', 'silo']);
  for (const [name, { levelL, capacityL }] of Object.entries(liquid.tanks)) {
    if (!(capacityL > 0 && levelL >= 0 && levelL <= capacityL)) expect.fail(`${where}: ${name} holds ${levelL} of ${capacityL} L`);
  }

  expect(Object.keys(snap.kpis).sort(), `${where}: KPIs`).toEqual([...KPI_KEYS].sort());
  for (const [key, value] of Object.entries(snap.kpis)) {
    if (!Number.isFinite(value)) expect.fail(`${where}: KPI ${key} is ${value}`);
  }

  expect(snap.log.length, `${where}: log`).toBeGreaterThan(0);
  expect(snap.log.length, `${where}: log`).toBeLessThanOrEqual(50);
  snap.log.forEach((entry, i) => {
    expect(LOG_KINDS, `${where}: log[${i}].kind`).toContain(entry.kind);
    expect(entry.message.length, `${where}: log[${i}].message`).toBeGreaterThan(0);
    if (!(entry.timeS <= snap.timeS && (i === 0 || entry.timeS <= snap.log[i - 1].timeS))) {
      expect.fail(`${where}: log[${i}] at ${entry.timeS} s is out of order (newest first, none after ${snap.timeS} s)`);
    }
  });
}

/** What the panels and the 3D view read twice must agree: the tanks, the stage 6 values and the KPIs. */
function expectConsistent(snap: Snapshot, where: string): void {
  const { tanks } = snap.liquid;
  const six = snap.stages[6].values;
  expect(tanks.asepticTank.levelL, where).toBe(six.levelL);
  expect(tanks.asepticTank.capacityL, where).toBe(six.capacityL);
  expect(tanks.rejectTank.levelL, where).toBe(snap.stages[4].values.rejectLevelL);
  expect(snap.liquid.headspaceBar, where).toBe(six.headspaceBar);
  expect(snap.kpis.tankLevelPct, where).toBe(six.levelPct);
  expect(snap.kpis.uhtFlowLph, where).toBe(snap.stages[4].values.flowLph);
  expect(snap.kpis.bStar, where).toBe(snap.stages[4].values.bStar);
  expect(snap.kpis.f0Min, where).toBe(snap.stages[4].values.f0Min);
  expect(snap.kpis.divertedL, where).toBeGreaterThanOrEqual(tanks.rejectTank.levelL);
  expectWithin(snap.stages[1].values.siloLevelPct, (100 * tanks.silo.levelL) / tanks.silo.capacityL, 1e-9);
  expectWithin(snap.stages[1].values.mixTankLevelPct, (100 * tanks.mixTank.levelL) / tanks.mixTank.capacityL, 1e-9);
  expect(snap.line.holdingTube.flowLph, where).toBe(snap.stages[4].values.flowLph);
  expect(snap.line.divert.flowLph + snap.line.flashVessel.flowLph, where).toBe(snap.line.holdingTube.flowLph);
  expectPacksMatchKpis(snap, where);
  expect(snap.liquid.fillersRunning, where).toBe(snap.stages[7].values.runningCount);
}

describe.each(NAMES)('fixture snapshot-%s.json', (name) => {
  const recorded = recordFixture(name);
  if (RECORDING) writeFixture(name, recorded);
  const stored = loadFixture(name);

  it('matches what tests/fixtures/record.ts records from createSim now (RECORD_FIXTURES=1 npx vitest run tests/fixtures re-records)', () => {
    expect(differences(recorded, stored)).toEqual([]);
  });

  it('keeps every contracts v3 shape rule, and its tanks, stage values and KPIs agree', () => {
    expectContracts(stored, name);
    expectConsistent(stored, name);
    // A step cut short to land on a breakdown shifts the steps after it off whole seconds, so the recording
    // may stop up to one step past its time (recordFixture).
    const atS = plantConfig.clock.startTimeS + FIXTURES[name].atS;
    expect(stored.timeS).toBeGreaterThanOrEqual(atS);
    expect(stored.timeS).toBeLessThan(atS + plantConfig.clock.baseStepS);
    expect(stored.speed).toBe(10);
    expect(stored.paused).toBe(false);
  });
});

describe('each fixture shows the state it is named for', () => {
  it('production: full flow forward at 140 °C, stage 4 green, nothing diverted, the tank filling', () => {
    const snap = loadFixture('production');
    expect(snap.liquid).toMatchObject({ uhtMode: 'production', throttled: false, fillersStarved: false, fillersRunning: 2, divertCount: 0 });
    expect(snap.stages[4].status).toBe('ok');
    expect(snap.stages[4].values.setpointC).toBe(140);
    expect(snap.stages[4].values.flowLph).toBe(16_000);
    expectWithin(snap.stages[4].values.holdS, 4, 1e-9);
    expect(snap.line.divert.flowLph).toBe(0);
    expect(snap.liquid.tanks.rejectTank.levelL).toBe(0);
    expect(snap.kpis.divertedL).toBe(0);
    // 10,000 L at opening + 10 min × 1,000 L/h (H31).
    expectWithin(snap.liquid.tanks.asepticTank.levelL, 10_000 + 1_000 / 6, 1e-6);
    expect(snap.stages[6].values.inflowLph).toBe(16_000);
    expect(snap.stages[6].values.outflowLph).toBe(15_000);
    for (const id of [1, 2, 3, 4, 5, 6] as const) expect(snap.stages[id].status, `stage ${id}`).toBe('ok');
  });

  it('divert: the whole flow to the reject tank, stage 4 red, 90 s of 180 s gone, 400 L rejected, the divert logged', () => {
    const snap = loadFixture('divert');
    expect(snap.liquid).toMatchObject({ uhtMode: 'divert', modeRemainingS: 90, divertCount: 1, throttled: false });
    expect(snap.stages[4].status).toBe('bad');
    expect(snap.stages[4].values.setpointC).toBe(138.9);
    expect(snap.stages[4].values.bStar).toBeLessThan(1);
    expect(snap.stages[4].values.tempC).toBeLessThan(snap.stages[4].values.divertLimitC);
    expect(snap.stages[5].status).toBe('idle');
    expect(snap.line.divert.flowLph).toBe(16_000);
    expect(snap.line.flashVessel.flowLph).toBe(0);
    expect(snap.stages[6].values.inflowLph).toBe(0);
    expectWithin(snap.liquid.tanks.rejectTank.levelL, 400, 1e-6);
    expectWithin(snap.kpis.divertedL, 400, 1e-6);
    const divert = snap.log.find((entry) => /diverting to the reject tank/.test(entry.message));
    expect(divert).toMatchObject({ kind: 'bad', timeS: plantConfig.clock.startTimeS + 600 });
    expect(snap.log.find((entry) => entry.message === 'UHT set point set to 138.9 °C')).toBeDefined();
  });

  it('throttled: 8,000 L/h with an 8 s hold, B* 2.37, F0 10.35 min and a 136.06 °C limit (R6), stage 6 amber, logged', () => {
    const snap = loadFixture('throttled');
    expect(snap.liquid).toMatchObject({ uhtMode: 'production', throttled: true, fillersStarved: false, divertCount: 0 });
    const four = snap.stages[4].values;
    expect(four.flowLph).toBe(8_000);
    expectWithin(four.holdS, 8, 1e-9);
    // With the display noise of the recorded step (±0.3 °C): H15 2.3712 and H16 10.350 min at 140.0 °C.
    expectWithin(four.bStar, 2.3712, 0.16);
    expectWithin(four.f0Min, 10.35, 0.75);
    expectWithin(four.divertLimitC, 136.063, 0.001);
    expect(snap.stages[4].status).toBe('ok');
    expect(snap.stages[6].status).toBe('warn');
    expect(snap.line.silo.flowLph).toBeCloseTo(8_111.11, 2);
    expect(snap.liquid.tanks.asepticTank.levelL).toBeGreaterThan(12_000);
    expect(snap.liquid.tanks.asepticTank.levelL).toBeLessThan(18_000);
    const throttle = snap.log.find((entry) => /UHT plant throttled/.test(entry.message));
    expect(throttle?.kind).toBe('warn');
    // Within the 51 min a throttle lasts at least (H34): it is still on.
    expect(snap.timeS - (throttle?.timeS ?? Number.NaN)).toBeLessThan(51.43 * 60);
  });

  it('fillerDown: filler B in repair with time left, filler A running, stage 7 red, half the draw, line B empty of new packs', () => {
    const snap = loadFixture('fillerDown');
    const [a, b] = snap.packs.fillers;
    expect(a).toMatchObject({ name: 'A', state: 'running', packsPerH: 7_500, breakdowns: 0 });
    expect(b).toMatchObject({ name: 'B', state: 'repair', packsPerH: 0, breakdowns: 1 });
    expect(b?.stateRemainingS).toBeGreaterThan(0);
    expect(snap.stages[7].status).toBe('bad');
    expect(snap.stages[7].values.runningCount).toBe(1);
    expect(snap.liquid.fillersRunning).toBe(1);
    expect(snap.line.filler.flowLph).toBe(7_500);
    expect(snap.kpis.packsPerH).toBe(7_500);
    expect(snap.packs.packaging.lanes[1]?.packerState).toBe('idle');
    expect(snap.log.find((entry) => /Filler B broke down/.test(entry.message))?.kind).toBe('bad');
  });

  it('quarantineFull: 42 batches on hold and two filling, about 2,570 pallets, none released or blocked yet', () => {
    const snap = loadFixture('quarantineFull');
    const { batches } = snap.packs;
    expect(batches.filter((batch) => batch.status === 'hold')).toHaveLength(42);
    expect(batches.filter((batch) => batch.status === 'filling')).toHaveLength(2);
    const pallets = batches.reduce((sum, batch) => sum + batch.pallets, 0);
    // H49: 2,520 pallets on hold just after a release at full rate, up to 2,640 before the next; fewer after breakdowns.
    expect(pallets).toBeGreaterThan(2_450);
    expect(pallets).toBeLessThanOrEqual(2_640);
    expect(snap.stages[9].values.palletsInQuarantine).toBe(pallets);
    expect(snap.stages[9].status).toBe('warn');
    expect(snap.kpis).toMatchObject({ batchesOnHold: 42, batchesReleased: 0, batchesBlocked: 0 });
    // The first release is due at the shift change a minute later (H50, D11: day 8, 14:00).
    expect(snap.stages[9].values.nextReleaseS).toBe(60);
  });
});
