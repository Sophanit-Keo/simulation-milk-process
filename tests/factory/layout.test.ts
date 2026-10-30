// The factory floor's layout (src/factory/layout.ts, phase 10, D20): a bay per UHT in Let Report's order, each
// with its skid, tank, header and a filler per line on its belt; the lines no UHT claims in a bay of their
// own; the key that rebuilds the floor; and what moves, the pipes' flows and the belts. The main fixture is
// the real factory (tests/helpers/factory.ts).
import { describe, expect, it } from 'vitest';
import {
  BAY_GAP_M,
  BAY_MARGIN_M,
  BELT_LENGTH_M,
  CIP_STRIPE_MPS,
  FILLER_BACK_Z_M,
  FILLER_BASE_M,
  FILLER_GAP_M,
  FILLER_SCALE,
  HEADER_Y_M,
  HEADER_Z_M,
  MIN_STRIPE_MPS,
  TANK_HEIGHT_M,
  beltSpeedMps,
  beltState,
  cameraPositionM,
  fillerKind,
  floorBays,
  layoutFactory,
  pipeFlow,
  pipeStripeMps,
  uhtLengthM,
} from '../../src/factory/layout';
import { FILLER_KINDS, LINE_STATUSES, type BayLayout, type FactoryLayout, type FloorPointM, type PipeRoute } from '../../src/factory/types';
import { factoryView, LINES, SETTINGS, uhtLine, withLine } from '../helpers/factory';

const EPS = 1e-9;
const layout = (data: Parameters<typeof factoryView>[0] = {}): FactoryLayout => layoutFactory(factoryView(data));

function bayOf(floor: FactoryLayout, uhtName: string): BayLayout {
  const bay = floor.bays.find((candidate) => candidate.uhtName === uhtName);
  if (!bay) throw new Error(`no bay ${uhtName}`);
  return bay;
}

const pipe = (bay: BayLayout, kind: PipeRoute['kind'], filler: number | null = null): PipeRoute => {
  const found = bay.pipes.find((route) => route.kind === kind && route.filler === filler);
  if (!found) throw new Error(`no ${kind} pipe ${filler}`);
  return found;
};

const close = (actual: FloorPointM, expected: FloorPointM): void => {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
};

describe('the factory floor: three bays in Let Report order', () => {
  const floor = layout();

  it('has a bay per UHT, in the order of uht_units, titled with its capacity', () => {
    expect(floor.bays.map((bay) => [bay.uhtName, bay.title])).toEqual([
      ['UHT 1', 'UHT 1 · 4,000 L/h'],
      ['UHT 2', 'UHT 2 · 8,000 L/h'],
      ['UHT 3', 'UHT 3 · 4,000 L/h'],
    ]);
  });

  it("stands each UHT's lines left to right in Let Report's order, each filler at its model's scale", () => {
    const row = (name: string) => bayOf(floor, name).fillers.map((filler) => [filler.name, filler.kind, filler.scale]);
    expect(row('UHT 1')).toEqual([
      ['UHT-line 1', 'TFA', 0.85],
      ['UHT-line 6', 'TBA/22', 1.1],
    ]);
    expect(row('UHT 2')).toEqual([
      ['UHT- line 2', 'TBA/19', 1],
      ['UHT-line 3', 'A3/Speed', 1.15],
      ['UHT line 4', 'A3/Speed', 1.15],
    ]);
    expect(row('UHT 3')).toEqual([['UHT-line 7', 'A3/Speed', 1.15]]);
    for (const bay of floor.bays) {
      const xs = bay.fillers.map((filler) => filler.centreM[0]);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
    }
  });

  it('sizes the bays to their machines: 13, 19.075 and 13 m wide, 5 m apart, centred on x = 0', () => {
    // UHT 1: the 8 m skid outruns its 2.34 + 2.5 + 3.03 m row; UHT 2: its 2.75 + 2.5 + 3.16 + 2.5 + 3.16 m row.
    expect(floor.bays.map((bay) => bay.rect.xMaxM - bay.rect.xMinM)).toEqual([13, 19.075, 13].map((width) => expect.closeTo(width, 9)));
    for (let i = 1; i < floor.bays.length; i++) {
      expect(floor.bays[i].rect.xMinM - floor.bays[i - 1].rect.xMaxM).toBeCloseTo(BAY_GAP_M, 9);
    }
    expect(floor.bounds.xMinM).toBeCloseTo(-floor.bounds.xMaxM, 9);
    expect(floor.bounds.xMaxM - floor.bounds.xMinM).toBeCloseTo(55.075, 9);
    // UHT 2's bay is the middle one, so its skid and tank stand on x = 0.
    expect(bayOf(floor, 'UHT 2').uht?.centreM[0]).toBeCloseTo(0, 9);
  });

  it('keeps every filler inside its bay, FILLER_GAP_M apart, its back on one line and its belt in front', () => {
    for (const bay of floor.bays) {
      bay.fillers.forEach((filler, index) => {
        const [x, , z] = filler.centreM;
        expect(x - filler.widthM / 2).toBeGreaterThanOrEqual(bay.rect.xMinM + BAY_MARGIN_M - EPS);
        expect(x + filler.widthM / 2).toBeLessThanOrEqual(bay.rect.xMaxM - BAY_MARGIN_M + EPS);
        expect(z - filler.depthM / 2).toBeCloseTo(FILLER_BACK_Z_M, 9);
        expect(filler.belt.fromM[2]).toBeCloseTo(FILLER_BACK_Z_M + filler.depthM, 9);
        expect(filler.belt.toM[2] - filler.belt.fromM[2]).toBeCloseTo(BELT_LENGTH_M, 9);
        expect(filler.belt.toM[2]).toBeLessThanOrEqual(bay.rect.zMaxM - BAY_MARGIN_M + EPS);
        const next = bay.fillers[index + 1];
        if (next) expect(next.centreM[0] - next.widthM / 2 - (x + filler.widthM / 2)).toBeCloseTo(FILLER_GAP_M, 9);
      });
    }
  });

  it('puts each skid at the back of its bay and its tank between it and the header, both centred', () => {
    for (const bay of floor.bays) {
      const centreX = (bay.rect.xMinM + bay.rect.xMaxM) / 2;
      expect(bay.uht?.centreM[0]).toBeCloseTo(centreX, 9);
      expect(bay.tank?.centreM[0]).toBeCloseTo(centreX, 9);
      const uhtFront = (bay.uht?.centreM[2] ?? NaN) + (bay.uht?.depthM ?? NaN) / 2;
      const tankBack = (bay.tank?.centreM[2] ?? NaN) - (bay.tank?.radiusM ?? NaN);
      const tankFront = (bay.tank?.centreM[2] ?? NaN) + (bay.tank?.radiusM ?? NaN);
      expect(uhtFront).toBeLessThan(tankBack);
      expect(tankFront).toBeLessThan(HEADER_Z_M);
      expect(bay.uht?.centreM[2] ?? NaN).toBeGreaterThan(bay.rect.zMinM + BAY_MARGIN_M);
    }
    expect(floor.bays.map((bay) => bay.uht?.lengthM)).toEqual([8, 10, 8]);
  });

  it('frames the whole floor from the front; the tanks are the tallest things on it', () => {
    expect(floor.heightM).toBe(TANK_HEIGHT_M);
    close(floor.overview.targetM, [0, 0, (floor.bounds.zMinM + floor.bounds.zMaxM) / 2]);
    // A quarter wider than the floor, for its front edge, nearer the camera, plus 2 m.
    expect(floor.overview.halfWidthM).toBeCloseTo((55.075 / 2) * 1.25 + 2, 9);
    expect(floor.overview.direction[1]).toBeGreaterThan(0);
    expect(floor.overview.direction[2]).toBeGreaterThan(0);
  });

  it('gives every bay, UHT and filler a camera stop in front of it and above', () => {
    const stops = floor.bays.flatMap((bay) => [bay.camera, ...(bay.uht ? [bay.uht.camera] : []), ...bay.fillers.map((filler) => filler.camera)]);
    for (const stop of stops) {
      const [, y, z] = cameraPositionM(stop);
      expect(y).toBeGreaterThan(stop.targetM[1]);
      expect(z).toBeGreaterThan(stop.targetM[2]);
    }
    for (const bay of floor.bays) expect(Math.hypot(...bay.camera.offsetM)).toBeGreaterThanOrEqual(30 - EPS);
    const filler = bayOf(floor, 'UHT 2').fillers[1];
    expect(filler.camera.targetM[0]).toBeCloseTo(filler.centreM[0], 9);
  });

  it('labels each filler above it, and each UHT above its tank', () => {
    for (const bay of floor.bays) {
      for (const filler of bay.fillers) {
        expect(filler.labelM[0]).toBeCloseTo(filler.centreM[0], 9);
        expect(filler.labelM[1]).toBeGreaterThan(filler.heightM);
      }
      expect(bay.uht?.labelM[1]).toBeGreaterThan(TANK_HEIGHT_M);
    }
  });
});

describe('the pipes', () => {
  const floor = layout();

  /** Every piece of a path runs along one axis: pipes run straight and turn square. */
  const square = (path: readonly FloorPointM[]): boolean =>
    path.slice(1).every((point, i) => point.filter((value, axis) => Math.abs(value - path[i][axis]) > EPS).length === 1);

  it("run from each UHT to its tank, along the header from the tank, and down to each filler's inlet", () => {
    for (const bay of floor.bays) {
      if (!bay.uht || !bay.tank) throw new Error('a UHT bay without its plant');
      const uht = pipe(bay, 'uht');
      expect(uht.paths).toEqual([[bay.uht.outletM, bay.tank.inletM]]);

      const header = pipe(bay, 'header');
      expect(header.paths[0][0]).toEqual(bay.tank.outletM);
      const tee = header.paths[0].at(-1) as FloorPointM;
      close(tee, [bay.tank.centreM[0], HEADER_Y_M, HEADER_Z_M]);
      const arms = header.paths.slice(1);
      for (const arm of arms) expect(arm[0]).toEqual(tee);
      const reach = [tee[0], ...arms.map((arm) => (arm.at(-1) as FloorPointM)[0])];

      bay.fillers.forEach((filler, index) => {
        const drop = pipe(bay, 'line', index);
        expect(drop.paths).toHaveLength(1);
        const [start] = drop.paths[0];
        close(start, [filler.centreM[0], HEADER_Y_M, HEADER_Z_M]);
        expect(start[0]).toBeGreaterThanOrEqual(Math.min(...reach) - EPS);
        expect(start[0]).toBeLessThanOrEqual(Math.max(...reach) + EPS);
        expect(drop.paths[0].at(-1)).toEqual(filler.inletM);
      });
      for (const route of bay.pipes) for (const path of route.paths) expect(square(path)).toBe(true);
    }
  });

  it('gives the header an arm each way only where fillers stand on that side', () => {
    expect(pipe(bayOf(floor, 'UHT 2'), 'header').paths).toHaveLength(3);
    // UHT 3's one filler stands in the middle of its bay, right under the tee.
    expect(pipe(bayOf(floor, 'UHT 3'), 'header').paths).toHaveLength(1);
  });

  it('are named by place, uniquely on the floor', () => {
    const ids = floor.bays.flatMap((bay) => bay.pipes.map((route) => route.id));
    expect(ids).toEqual([
      'uht:0', 'header:0', 'line:0:0', 'line:0:1',
      'uht:1', 'header:1', 'line:1:0', 'line:1:1', 'line:1:2',
      'uht:2', 'header:2', 'line:2:0',
    ]);
  });

  it('carry what the view says flows: a line its draw, its UHT the sum, nothing once stopped', () => {
    const flows = (floorLayout: FactoryLayout, view: ReturnType<typeof factoryView>) => {
      const bays = floorBays(view);
      return Object.fromEntries(floorLayout.bays.flatMap((bay, b) => bay.pipes.map((route) => [route.id, pipeFlow(route, bays[b])])));
    };
    const running = flows(floor, factoryView());
    expect(running['uht:1']).toEqual({ flowLph: 5_550, cleaning: false });
    expect(running['header:1']).toEqual({ flowLph: 5_550, cleaning: false });
    expect(running['line:1:1']).toEqual({ flowLph: 2_400, cleaning: false });
    expect(running['line:0:0']).toEqual({ flowLph: 360, cleaning: false });

    const stoppedView = factoryView({ lines: withLine('UHT-line 3', { status: 'stopped' }) });
    const stopped = flows(layoutFactory(stoppedView), stoppedView);
    expect(stopped['line:1:1']).toEqual({ flowLph: 0, cleaning: false });
    expect(stopped['uht:1']).toEqual({ flowLph: 3_150, cleaning: false });
  });

  it("show a line's CIP in its drop, and the UHT's in its pipe and header once all its lines clean", () => {
    const cip = { status: 'cleaning' as const, cip_until: '2026-10-29T09:10:00Z' };
    const oneView = factoryView({ lines: withLine('UHT-line 7', cip) });
    const bays = floorBays(oneView);
    const bay = layoutFactory(oneView).bays[2];
    // UHT 3 has only line 7: with it cleaning, the whole train is in CIP.
    expect(pipeFlow(pipe(bay, 'line', 0), bays[2])).toEqual({ flowLph: 0, cleaning: true });
    expect(pipeFlow(pipe(bay, 'uht'), bays[2])).toEqual({ flowLph: 0, cleaning: true });

    const someView = factoryView({ lines: withLine('UHT-line 1', cip) });
    const uht1 = floorBays(someView)[0];
    const bay1 = layoutFactory(someView).bays[0];
    expect(pipeFlow(pipe(bay1, 'line', 0), uht1).cleaning).toBe(true);
    // Line 6 still runs, so UHT 1 produces and its own pipe carries milk.
    expect(pipeFlow(pipe(bay1, 'uht'), uht1)).toEqual({ flowLph: 2_000, cleaning: false });
  });
});

describe('the bays the floor leaves out or adds', () => {
  it('stands the UHT lines that name no listed UHT in a last bay of their own, with no plant, tank or pipes', () => {
    const floor = layout({ lines: [...LINES, uhtLine('UHT line 8', 10, 'UHT 9', 'TBA/19', 7_500)] });
    expect(floor.bays).toHaveLength(4);
    const last = floor.bays[3];
    expect(last).toMatchObject({ uhtName: '', title: 'Not assigned to a UHT', uht: null, tank: null, pipes: [] });
    expect(last.fillers.map((filler) => filler.name)).toEqual(['UHT line 8']);
    expect(last.rect.xMinM).toBeGreaterThan(floor.bays[2].rect.xMaxM);
  });

  it('keeps a bay for a UHT with no lines: its plant and tank, the pipe between them, no header', () => {
    const floor = layout({ settings: { ...SETTINGS, uht_units: [...(SETTINGS.uht_units ?? []), { name: 'UHT 4', capacityLph: 6_000 }] } });
    const bay = bayOf(floor, 'UHT 4');
    expect(bay.fillers).toEqual([]);
    expect(bay.pipes.map((route) => route.kind)).toEqual(['uht']);
    expect(bay.rect.xMaxM - bay.rect.xMinM).toBeCloseTo(uhtLengthM(6_000) + 2 * BAY_MARGIN_M, 9);
  });

  it('gives two UHTs Let Report names alike a bay each, the lines on the first, every pipe still unique', () => {
    const floor = layout({ settings: { uht_units: [{ name: 'UHT 2', capacityLph: 8_000 }, { name: 'UHT 2', capacityLph: 8_000 }] } });
    expect(floor.bays.map((bay) => [bay.uhtName, bay.fillers.length])).toEqual([
      ['UHT 2', 3],
      ['UHT 2', 0],
      ['', 3],
    ]);
    const ids = floor.bays.flatMap((bay) => bay.pipes.map((route) => route.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lays out an empty floor with no UHT and no line', () => {
    const floor = layout({ lines: [], settings: null });
    expect(floor.bays).toEqual([]);
    expect(floor.key).toBe('[]');
    expect(floor.bounds.xMaxM).toBeGreaterThan(floor.bounds.xMinM);
    expect(floor.overview.halfWidthM).toBeGreaterThan(0);
  });

  it('titles a UHT with no capacity by its name alone, on the shortest skid', () => {
    const floor = layout({ settings: { uht_units: [{ name: 'UHT 1', capacityLph: 0 }] } });
    expect(floor.bays[0].title).toBe('UHT 1');
    expect(floor.bays[0].uht?.lengthM).toBe(6);
  });
});

describe('the layout key', () => {
  const key = layout().key;

  it('stays the same when only a status, an output, a lot or a trouble changes', () => {
    expect(layout({ lines: withLine('UHT-line 3', { status: 'stopped' }) }).key).toBe(key);
    expect(layout({ lines: withLine('UHT-line 7', { status: 'cleaning', cip_until: '2026-10-29T09:00:00Z' }) }).key).toBe(key);
    expect(layout({ lines: withLine('UHT line 4', { qty: 99, product: 'Choco 180 ml', lot: 'L1' }) }).key).toBe(key);
    expect(layout({ reports: [{ id: 'r1', loc: 'UHT-line 3', sev: 3, status: 'open' }] }).key).toBe(key);
    // The speed and the pack size change what a line draws, not where it stands.
    expect(layout({ lines: withLine('UHT-line 3', { filler_packs_per_h: 20_000, pack_ml: 200 }) }).key).toBe(key);
  });

  it('changes with what the floor is built from', () => {
    const changed = [
      layout({ lines: withLine('UHT-line 3', { filler: 'TBA/22' }) }),
      layout({ lines: withLine('UHT-line 3', { uht: 'UHT 3' }) }),
      layout({ lines: withLine('UHT-line 3', { name: 'UHT line 3' }) }),
      layout({ lines: withLine('UHT-line 3', { sort: 99 }) }),
      layout({ lines: [...LINES, uhtLine('UHT line 8', 10, 'UHT 3', 'TFA', 3_600)] }),
      layout({ settings: { uht_units: [{ name: 'UHT 1', capacityLph: 5_000 }, ...(SETTINGS.uht_units ?? []).slice(1)] } }),
      layout({ settings: { uht_units: [...(SETTINGS.uht_units ?? [])].reverse() } }),
    ];
    for (const floor of changed) expect(floor.key).not.toBe(key);
  });
});

describe('sizes and what moves', () => {
  it("knows the factory's filler models as Let Report may write them, and calls any other 'other'", () => {
    expect(['TFA', 'tfa', 'Tetra Fino Aseptic', 'TBA/19', 'TBA 19', 'tba-19', 'TBA/22', 'A3/Speed', 'A3 Speed', 'a3/SPEED'].map(fillerKind)).toEqual([
      'TFA', 'TFA', 'TFA', 'TBA/19', 'TBA/19', 'TBA/19', 'TBA/22', 'A3/Speed', 'A3/Speed', 'A3/Speed',
    ]);
    expect(['', 'TBA/8', 'A3/Flex', 'Shibuya'].map(fillerKind)).toEqual(['other', 'other', 'other', 'other']);
    for (const kind of FILLER_KINDS) expect(FILLER_SCALE[kind]).toBeGreaterThan(0);
  });

  it('draws an unknown or missing filler at the base size', () => {
    const floor = layout({ lines: withLine('UHT-line 7', { filler: '' }) });
    const filler = bayOf(floor, 'UHT 3').fillers[0];
    expect([filler.kind, filler.widthM, filler.depthM, filler.heightM]).toEqual(['other', FILLER_BASE_M.widthM, FILLER_BASE_M.depthM, FILLER_BASE_M.heightM]);
  });

  it('makes the skid 6 m plus 1 m per 2,000 L/h, from 6 to 16 m', () => {
    expect([0, -5, NaN, 2_000, 4_000, 8_000, 40_000].map(uhtLengthM)).toEqual([6, 6, 6, 7, 8, 10, 16]);
  });

  it('runs a belt a token per 10 packs, 0.5 m apart: 0.33 m/s at 24,000 packs/h, 0.05 m/s at 3,600', () => {
    expect(beltSpeedMps(24_000)).toBeCloseTo(1 / 3, 9);
    expect(beltSpeedMps(7_500)).toBeCloseTo(0.104_166_667, 6);
    expect(beltSpeedMps(3_600)).toBeCloseTo(0.05, 9);
    expect([null, 0, -1, NaN].map(beltSpeedMps)).toEqual([0, 0, 0, 0]);
  });

  it('moves the packs while running, leaves them standing while stopped, and clears the belt otherwise', () => {
    expect(Object.fromEntries(LINE_STATUSES.map((status) => [status, beltState(status)]))).toEqual({
      running: 'moving',
      stopped: 'still',
      cleaning: 'empty',
      changeover: 'empty',
      maintenance: 'still',
      idle: 'empty',
    });
  });

  it("flows a pipe's stripes at 1 m/s per 10,000 L/h, at least 0.08 m/s, and at the CIP's speed while cleaning", () => {
    expect(pipeStripeMps({ flowLph: 5_550, cleaning: false })).toBeCloseTo(0.555, 9);
    expect(pipeStripeMps({ flowLph: 360, cleaning: false })).toBe(MIN_STRIPE_MPS);
    expect(pipeStripeMps({ flowLph: 0, cleaning: false })).toBe(0);
    expect(pipeStripeMps({ flowLph: 0, cleaning: true })).toBe(CIP_STRIPE_MPS);
  });
});
