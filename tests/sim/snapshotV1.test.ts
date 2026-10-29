// Contracts v1 (phase 2, gate G1): the liquid line's measuring points in Snapshot.line, which the
// 3D view colours the pipes from. Checked for both sims the app can run: createSim (the static plant)
// and createMockSim (?mock).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  LINE_POINT_IDS,
  dayToS,
  type LinePointId,
  type PlantConfig,
  type Sim,
  type Snapshot,
  type StageId,
} from '../../src/contracts';
import { createSim } from '../../src/sim';
import { createMockSim } from '../../src/sim/mock';
import { expectWithin } from '../helpers/expectWithin';
import { plantConfig } from '../helpers/plantConfig';

const SIMS: [string, (config: PlantConfig) => Sim][] = [
  ['createSim', createSim],
  ['createMockSim', createMockSim],
];

/** At ×10,000, 0.02 s of real time is 200 sim seconds: about four frames in each 15 min mock status window. */
const WEEK_FRAME_S = 0.02;
const WEEK_FRAMES = dayToS(7) / (WEEK_FRAME_S * 10_000);

/** Every point exists, and only those; temperatures are finite and flows finite and never negative. */
function expectWellFormedLine(snap: Snapshot, where: string): void {
  expect(Object.keys(snap.line).sort(), `${where}: line points`).toEqual([...LINE_POINT_IDS].sort());
  for (const id of LINE_POINT_IDS) {
    const { tempC, flowLph } = snap.line[id];
    if (!Number.isFinite(tempC)) expect.fail(`${where}: line.${id}.tempC is ${tempC}`);
    if (!(Number.isFinite(flowLph) && flowLph >= 0)) expect.fail(`${where}: line.${id}.flowLph is ${flowLph}`);
  }
}

/**
 * The stage value each point's temperature is read off, so a pipe's colour and the info panel agree.
 * The divert line carries what leaves the holding tube, so it shows the stage 4 temperature too.
 */
const POINT_SOURCES: Record<LinePointId, [stage: StageId, key: string]> = {
  silo: [1, 'siloTempC'],
  separator: [1, 'separatorTempC'],
  feedTank: [1, 'feedTankTempC'],
  preheater: [2, 'preheatTempC'],
  deaerator: [2, 'deaeratorTempC'],
  homogenizer: [3, 'outletTempC'],
  holdingTube: [4, 'tempC'],
  divert: [4, 'tempC'],
  flashVessel: [5, 'flashTempC'],
  cooler: [5, 'coolerTempC'],
  asepticTank: [6, 'tempC'],
  filler: [7, 'tempC'],
};

function expectLineMatchesStages(snap: Snapshot, where: string): void {
  for (const id of LINE_POINT_IDS) {
    const [stage, key] = POINT_SOURCES[id];
    const valueC = snap.stages[stage].values[key];
    if (snap.line[id].tempC !== valueC) {
      expect.fail(`${where}: line.${id}.tempC is ${snap.line[id].tempC}, stage ${stage} ${key} is ${valueC}`);
    }
  }
}

describe('contracts v1', () => {
  it('CONTRACT_VERSION is 6 (contracts v6, phase 8; v1 is a subset of it)', () => {
    expect(CONTRACT_VERSION).toBe(6);
  });

  it('LINE_POINT_IDS lists the 12 measuring points once each, in flow order', () => {
    expect(LINE_POINT_IDS).toEqual([
      'silo',
      'separator',
      'feedTank',
      'preheater',
      'deaerator',
      'homogenizer',
      'holdingTube',
      'divert',
      'flashVessel',
      'cooler',
      'asepticTank',
      'filler',
    ]);
  });

  it.each(SIMS)('%s snapshots carry the contract version', (_name, create) => {
    expect(create(plantConfig).snapshot().version).toBe(CONTRACT_VERSION);
  });
});

describe.each(SIMS)('%s: Snapshot.line', (name, create) => {
  it('has exactly the 12 points, with finite temperatures and non-negative flows, at creation', () => {
    expectWellFormedLine(create(plantConfig).snapshot(), name);
  });

  it('agrees with the stage values the info panel shows, at creation', () => {
    expectLineMatchesStages(create(plantConfig).snapshot(), name);
  });

  it('stays well formed and in step with the stage values through a simulated week at ×10,000', () => {
    const sim = create(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    for (let frame = 0; frame < WEEK_FRAMES; frame++) {
      sim.step(WEEK_FRAME_S);
      const snap = sim.snapshot();
      const where = `${name} at ${snap.timeS} s`;
      expectWellFormedLine(snap, where);
      expectLineMatchesStages(snap, where);
    }
    // Steps cut short to land on queued events leave a frame's last few seconds for the next: within one step.
    expect(sim.snapshot().timeS).toBeGreaterThanOrEqual(plantConfig.clock.startTimeS + dayToS(7) - plantConfig.clock.fastStepS);
  });
});

// The line points of plan/hand-calculations.md (H64–H75): the chart values of plan 02 ("Chart values as
// text") and the R7 homogenizer outlet, for the plant as it opens at full flow with both fillers running and
// no divert. Only `process` changes an expected value here, with a source (ownership rule 4).
const LINE_POINTS_H: [h: string, id: LinePointId, tempC: number, flowLph: number, why: string][] = [
  ['H64', 'silo', 4, 16_222.22, 'raw milk to the separator: phase 3, 16,000 L/h of 3.5% milk needs 16,222.22 L/h (H3)'],
  ['H65', 'separator', 60, 16_000, 'standardized milk to the mixing tank'],
  ['H66', 'feedTank', 4, 16_000, 'the mixing tank, which feeds the UHT plant'],
  ['H67', 'preheater', 80, 16_000, 'preheater outlet'],
  ['H68', 'deaerator', 76, 16_000, '80 − 4 °C'],
  ['H69', 'homogenizer', 81.75, 16_000, '76 + (200 + 30) ÷ 40 °C (R7, D5)'],
  ['H70', 'holdingTube', 140, 16_000, 'holding-tube outlet at the set point'],
  ['H71', 'divert', 140, 0, 'the holding-tube outlet, with nothing sent to the reject tank'],
  ['H72', 'flashVessel', 80, 16_000, 'flash-vessel outlet (D5: 80 °C, not 81.75 °C)'],
  ['H73', 'cooler', 20, 16_000, 'cooler outlet'],
  ['H74', 'asepticTank', 20, 15_000, '2 × 7,500 packs/h × 1 L to the fillers (H31)'],
  ['H75', 'filler', 20, 15_000, 'both fillers together'],
];

describe('createSim: the line opens on the hand-calculated line points', () => {
  const line = () => createSim(plantConfig).snapshot().line;

  it('has one hand value for each of the 12 points', () => {
    expect(LINE_POINTS_H.map(([, id]) => id)).toEqual([...LINE_POINT_IDS]);
  });

  it.each(LINE_POINTS_H)('%s %s: %s °C at %s L/h (%s)', (_h, id, tempC, flowLph) => {
    const point = line()[id];
    // Every hand value is exact but the homogenizer outlet, which is computed (±0.001 °C in H69).
    if (id === 'homogenizer') expectWithin(point.tempC, tempC, 0.001);
    else expect(point.tempC).toBe(tempC);
    // Every flow is exact but the raw milk, which is computed (±0.01 L/h in H64, phase 3).
    if (id === 'silo') expectWithin(point.flowLph, flowLph, 0.01);
    else expect(point.flowLph).toBe(flowLph);
  });

  it('stage 4 reads 140 °C at the holding tube, as the line does (H70)', () => {
    const snap = createSim(plantConfig).snapshot();
    expect(snap.stages[4].values.tempC).toBe(140);
    expect(snap.line.holdingTube.tempC).toBe(snap.stages[4].values.tempC);
  });

  it("carries the KPI strip's UHT flow through the holding tube and its packs per hour out to the fillers", () => {
    const { line: current, kpis } = createSim(plantConfig).snapshot();
    expect(current.holdingTube.flowLph).toBe(kpis.uhtFlowLph);
    expect(current.filler.flowLph).toBe(kpis.packsPerH * plantConfig.product.packVolumeL);
  });

  it('follows the live set points: UHT temperature, homogenizer pressure and filler rate', () => {
    const sim = createSim(plantConfig);
    sim.dispatch({ type: 'setSetpoint', key: 'uhtSetpointC', value: 141 });
    sim.dispatch({ type: 'setSetpoint', key: 'homogenizerStage1Bar', value: 180 });
    sim.dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value: 7_000 });
    const { line: changed } = sim.snapshot();
    expect(changed.holdingTube.tempC).toBe(141);
    expect(changed.divert.tempC).toBe(141);
    expectWithin(changed.homogenizer.tempC, 81.25, 0.001); // 76 + (180 + 30) ÷ 40
    expect(changed.asepticTank.flowLph).toBe(14_000);
    expect(changed.filler.flowLph).toBe(14_000);
    expect(changed.holdingTube.flowLph).toBe(16_000);
  });
});

describe('createMockSim: a red UHT stage diverts', () => {
  // Every frame of a simulated week, so the check sees each of the week's red stage 4 windows.
  function weekOfFrames(): Snapshot[] {
    const sim = createMockSim(plantConfig);
    sim.dispatch({ type: 'setSpeed', speed: 10_000 });
    const snaps: Snapshot[] = [];
    for (let frame = 0; frame < WEEK_FRAMES; frame++) {
      sim.step(WEEK_FRAME_S);
      snaps.push(sim.snapshot());
    }
    return snaps;
  }
  let snaps: Snapshot[] = [];
  let red: Snapshot[] = [];
  beforeAll(() => {
    snaps = weekOfFrames();
    red = snaps.filter((snap) => snap.stages[4].status === 'bad');
  });

  it('turns stage 4 red at least once in the week, and not all the time (so the checks below test something)', () => {
    expect(snaps.at(-1)?.timeS, 'the run covers a week').toBeGreaterThanOrEqual(plantConfig.clock.startTimeS + dayToS(7) - 1);
    expect(red.length).toBeGreaterThan(0);
    expect(red.length).toBeLessThan(snaps.length);
  });

  // Divert, as plan/hand-calculations.md has it after H75: the divert line carries the whole UHT flow and
  // the flash vessel and the cooler carry nothing.
  it('whenever stage 4 is red, the whole holding-tube flow goes to the divert line and none to the flash vessel', () => {
    for (const snap of red) {
      const { holdingTube, divert, flashVessel, cooler } = snap.line;
      if (divert.flowLph !== holdingTube.flowLph || flashVessel.flowLph !== 0 || cooler.flowLph !== 0 || holdingTube.flowLph <= 0) {
        expect.fail(
          `at ${snap.timeS} s: holding tube ${holdingTube.flowLph} L/h, divert ${divert.flowLph} L/h, flash vessel ${flashVessel.flowLph} L/h, cooler ${cooler.flowLph} L/h`,
        );
      }
    }
  });

  it('whenever stage 4 is not red, nothing is diverted and the flash vessel and cooler take the holding-tube flow', () => {
    for (const snap of snaps) {
      if (snap.stages[4].status === 'bad') continue;
      const { holdingTube, divert, flashVessel, cooler } = snap.line;
      if (divert.flowLph !== 0 || flashVessel.flowLph !== holdingTube.flowLph || cooler.flowLph !== holdingTube.flowLph) {
        expect.fail(
          `at ${snap.timeS} s (stage 4 ${snap.stages[4].status}): holding tube ${holdingTube.flowLph} L/h, divert ${divert.flowLph} L/h, flash vessel ${flashVessel.flowLph} L/h, cooler ${cooler.flowLph} L/h`,
        );
      }
    }
  });

  it("the UHT points carry the KPI strip's UHT flow in every frame, and the silo the raw milk stage 1 shows", () => {
    for (const snap of snaps) {
      const { holdingTube, feedTank, silo } = snap.line;
      if (holdingTube.flowLph !== snap.kpis.uhtFlowLph || feedTank.flowLph !== snap.kpis.uhtFlowLph) {
        expect.fail(`at ${snap.timeS} s: holding tube ${holdingTube.flowLph} L/h, feed tank ${feedTank.flowLph} L/h, KPI ${snap.kpis.uhtFlowLph} L/h`);
      }
      if (silo.flowLph !== snap.stages[1].values.rawMilkLph) {
        expect.fail(`at ${snap.timeS} s: silo ${silo.flowLph} L/h, stage 1 raw milk ${snap.stages[1].values.rawMilkLph} L/h`);
      }
    }
  });
});
