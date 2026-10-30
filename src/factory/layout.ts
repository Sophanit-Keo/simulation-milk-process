// Phase 10: where everything on the factory floor stands (D20), laid out afresh from each view the board draws.
// A bay per UHT, left to right in the order of Let Report's `uht_units`; in each, from the back, the UHT plant
// as one skid, its aseptic tank, a header along the fillers, and one filler per line, left to right in Let
// Report's order, each on its outfeed belt. The UHT lines no UHT claims stand in a bay of their own, last.
// The sizes are D20's sim assumptions. Pure and headless, like model.ts: tsconfig.headless.json checks it.
//
// Units: metres on the floor (1 three.js unit = 1 m), x along the hall, y up, z from the plants at the back (−z)
// to the ends of the belts at the front (+z). The rules for what moves (the pipes' flows and speeds, the belts'
// states and speeds) are here too, so the 3D view only draws them.
import { formatNumber } from '../ui/format';
import type {
  BayLayout,
  BeltState,
  CameraStopM,
  FactoryLayout,
  FactoryView,
  FillerKind,
  FillerSpot,
  FloorBay,
  FloorPointM,
  FloorRectM,
  LayoutFactory,
  LineStatus,
  PipeFlow,
  PipeRoute,
  TankSpot,
  UhtSpot,
} from './view';

// ───── Sizes (D20, all sim assumptions) ─────

/** The 3D plant's hero filler (assets/hero-specs.md), turned to face its belt: across x, along z and up, at scale 1. */
export const FILLER_BASE_M = { widthM: 2.75, depthM: 3.55, heightM: 3.6 } as const;

/** Each filler model is the one hero filler, drawn at this scale: the larger, faster machines larger, the TFA smaller. */
export const FILLER_SCALE: Readonly<Record<FillerKind, number>> = { TFA: 0.85, 'TBA/19': 1, 'TBA/22': 1.1, 'A3/Speed': 1.15, other: 1 };

/** Room to walk between two fillers, and to bring a reel. */
export const FILLER_GAP_M = 2.5;
/** Floor round a bay's machines, inside its slab. */
export const BAY_MARGIN_M = 2.5;
/** The aisle between two bays' slabs. */
export const BAY_GAP_M = 5;

/** The UHT skid: its middle along z, its depth and height, and its length from its capacity. */
export const UHT_Z_M = -10;
export const UHT_DEPTH_M = 3.5;
export const UHT_HEIGHT_M = 3;
const UHT_BASE_LENGTH_M = 6;
const UHT_M_PER_LPH = 1 / 2_000;
const UHT_MIN_LENGTH_M = 6;
const UHT_MAX_LENGTH_M = 16;

/** The aseptic tank: its middle along z, its radius and its height to the top of the dome. */
export const TANK_Z_M = -3.5;
export const TANK_RADIUS_M = 1.4;
export const TANK_HEIGHT_M = 6;
/** The tank stands on legs; its outlet is in the middle of its bottom. */
export const TANK_BOTTOM_M = 1;

/** The header runs along the row of fillers at this z and height, under the walkway's level. */
export const HEADER_Z_M = 1.5;
export const HEADER_Y_M = 0.6;
/** Every filler's back face stands on this line, so the row reads straight whatever the fillers' sizes. */
export const FILLER_BACK_Z_M = 4;
/** A drop rises to its filler's inlet this far behind the filler's back face. */
const DROP_SETBACK_M = 0.4;
/** A filler's inlet, as a share of its height. */
const INLET_HEIGHT_FRAC = 0.5;

/** Each outfeed belt: its length, and its top and width at scale 1 (the hero filler's outfeed). */
export const BELT_LENGTH_M = 7;
const BELT_TOP_M = 0.86;
const BELT_WIDTH_M = 0.85;

/** The UHT's pipe to its tank runs at this height, into the side of the tank above its cone. */
const UHT_PIPE_Y_M = 1.9;
const MAIN_PIPE_RADIUS_M = 0.12;
const LINE_PIPE_RADIUS_M = 0.09;

/** Labels stand this far above what they name. */
const LABEL_LIFT_M = 0.6;
/** A bay's title is written on the floor, just in front of its slab. */
const TITLE_Y_M = 0.06;
const TITLE_INSET_M = 0.6;
const TITLE_GAP_M = 0.6;
/** The floor with no bay at all, so the camera still has something to frame. */
const EMPTY_HALF_WIDTH_M = 10;

// ───── What moves (D20) ─────

/** The pipes' stripes as the 3D plant's (src/scene/pipes.ts): 10,000 L/h moves them 1 m/s. */
export const STRIPE_MPS_PER_LPH = 1e-4;
/** The slowest a pipe with milk in motion flows, so a small line's still reads as flowing. */
export const MIN_STRIPE_MPS = 0.08;
/** The cleaning fluid's circulation, which Let Report does not hold. */
export const CIP_STRIPE_MPS = 0.5;
/** Each token on a belt stands for this many packs, this far apart. */
export const PACKS_PER_TOKEN = 10;
export const TOKEN_PITCH_M = 0.5;
const S_PER_H = 3_600;

// ───── The camera ─────

/** The whole factory is seen from the front, about 48° above the floor (the 3D plant's overview). */
const OVERVIEW_DIRECTION: FloorPointM = [0, 0.74, 0.67];
/**
 * The overview fits the floor's width where the camera looks, at the floor's middle; its front edge is about a
 * quarter nearer the camera, so it shows that much wider. Fit for the front edge, with a little room beside it.
 */
const OVERVIEW_PERSPECTIVE = 1.25;
const OVERVIEW_ROOM_M = 2;
/** A bay is seen from the front and above, from at least this far, further for a wide one. */
const BAY_VIEW_MIN_M = 30;
const BAY_VIEW_PER_WIDTH = 1.25;
/**
 * A UHT's stop looks at its skid and tank together, from the front and to the right so the tank, in front of
 * the skid, hides little of it; a filler's at the filler and the start of its belt.
 */
const UHT_OFFSET_M: FloorPointM = [12, 10, 11];
const FILLER_OFFSET_M: FloorPointM = [3, 6.5, 10];

const UNASSIGNED_TITLE = 'Not assigned to a UHT';

/** A filler's model as Let Report names it ("A3/Speed", "TBA 19", "tba/22"), or 'other'. */
const KIND_BY_KEY: Readonly<Record<string, FillerKind>> = {
  TFA: 'TFA',
  TETRAFINOASEPTIC: 'TFA',
  TBA19: 'TBA/19',
  TBA22: 'TBA/22',
  A3SPEED: 'A3/Speed',
};

export function fillerKind(filler: string): FillerKind {
  const key = (typeof filler === 'string' ? filler : '').toUpperCase().replace(/[\s/_.-]+/g, '');
  return KIND_BY_KEY[key] ?? 'other';
}

/** The skid's length: 6 m plus 1 m per 2,000 L/h, 6 to 16 m; 6 m with no capacity. */
export function uhtLengthM(capacityLph: number): number {
  const length = UHT_BASE_LENGTH_M + (Number.isFinite(capacityLph) && capacityLph > 0 ? capacityLph * UHT_M_PER_LPH : 0);
  return Math.min(UHT_MAX_LENGTH_M, Math.max(UHT_MIN_LENGTH_M, length));
}

/** The bays the view gives, in the floor's order: each UHT with its lines, then the lines no UHT claims, if any. */
export function floorBays(view: FactoryView): FloorBay[] {
  const bays: FloorBay[] = view.uhts.map((uht) => ({ uht, lines: uht.lines }));
  if (view.unassigned.length > 0) bays.push({ uht: null, lines: view.unassigned });
  return bays;
}

/** What flows in a pipe of `bay` (the same place in floorBays as the pipe's bay in the layout). */
export function pipeFlow(route: Pick<PipeRoute, 'kind' | 'filler'>, bay: FloorBay): PipeFlow {
  if (route.kind === 'line') {
    const line = route.filler === null ? undefined : bay.lines[route.filler];
    return { flowLph: line?.drawLph ?? 0, cleaning: line?.status === 'cleaning' };
  }
  return { flowLph: bay.uht?.drawLph ?? 0, cleaning: bay.uht?.state === 'cip' };
}

/** How fast a pipe's stripes move: with its flow (at least MIN_STRIPE_MPS while it flows), at CIP_STRIPE_MPS while it cleans. */
export function pipeStripeMps(flow: PipeFlow): number {
  if (flow.cleaning) return CIP_STRIPE_MPS;
  if (!(flow.flowLph > 0)) return 0;
  return Math.max(MIN_STRIPE_MPS, flow.flowLph * STRIPE_MPS_PER_LPH);
}

const BELT_STATES: Readonly<Record<LineStatus, BeltState>> = {
  running: 'moving',
  stopped: 'still',
  maintenance: 'still',
  cleaning: 'empty',
  changeover: 'empty',
  idle: 'empty',
};

export function beltState(status: LineStatus): BeltState {
  return BELT_STATES[status] ?? 'empty';
}

/** A running belt's speed: a token per PACKS_PER_TOKEN packs, TOKEN_PITCH_M apart (24,000 packs/h → 0.33 m/s); 0 without a speed. */
export function beltSpeedMps(packsPerH: number | null): number {
  if (packsPerH === null || !Number.isFinite(packsPerH) || packsPerH <= 0) return 0;
  return (packsPerH / S_PER_H / PACKS_PER_TOKEN) * TOKEN_PITCH_M;
}

// ───── The layout ─────

const add = (a: FloorPointM, b: FloorPointM): FloorPointM => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (point: FloorPointM, by: number): FloorPointM => [point[0] * by, point[1] * by, point[2] * by];

/** One filler's size and model, before it has a place. */
interface Sized {
  lineId: string;
  name: string;
  kind: FillerKind;
  scale: number;
  widthM: number;
  depthM: number;
  heightM: number;
}

function sizeFiller(line: { id: string; name: string; filler: string }): Sized {
  const kind = fillerKind(line.filler);
  const scale = FILLER_SCALE[kind];
  return {
    lineId: line.id,
    name: line.name,
    kind,
    scale,
    widthM: FILLER_BASE_M.widthM * scale,
    depthM: FILLER_BASE_M.depthM * scale,
    heightM: FILLER_BASE_M.heightM * scale,
  };
}

/** A filler's belt ends this far in front of the filler row's back line. */
const beltEndZ = (filler: Pick<Sized, 'depthM'>): number => FILLER_BACK_Z_M + filler.depthM + BELT_LENGTH_M;

function placeFiller(sized: Sized, xM: number): FillerSpot {
  const centreZ = FILLER_BACK_Z_M + sized.depthM / 2;
  const centreM: FloorPointM = [xM, 0, centreZ];
  const beltTop = BELT_TOP_M * sized.scale;
  const front = FILLER_BACK_Z_M + sized.depthM;
  return {
    ...sized,
    centreM,
    inletM: [xM, sized.heightM * INLET_HEIGHT_FRAC, FILLER_BACK_Z_M],
    belt: { fromM: [xM, beltTop, front], toM: [xM, beltTop, front + BELT_LENGTH_M], widthM: BELT_WIDTH_M * sized.scale },
    labelM: [xM, sized.heightM + LABEL_LIFT_M, centreZ],
    camera: { targetM: [xM, 1.6 * sized.scale, centreZ + 1.5], offsetM: scaled(FILLER_OFFSET_M, sized.scale) },
  };
}

function placeUht(name: string, capacityLph: number, xM: number): UhtSpot {
  const lengthM = uhtLengthM(capacityLph);
  const middleZ = (UHT_Z_M + TANK_Z_M) / 2;
  return {
    name,
    capacityLph,
    centreM: [xM, 0, UHT_Z_M],
    lengthM,
    depthM: UHT_DEPTH_M,
    heightM: UHT_HEIGHT_M,
    outletM: [xM, UHT_PIPE_Y_M, UHT_Z_M + UHT_DEPTH_M / 2],
    // Above the tank, which stands taller in front of the skid: the label names the whole train.
    labelM: [xM, Math.max(UHT_HEIGHT_M, TANK_HEIGHT_M) + LABEL_LIFT_M, middleZ],
    camera: { targetM: [xM, 2, middleZ], offsetM: UHT_OFFSET_M },
  };
}

function placeTank(xM: number): TankSpot {
  return {
    centreM: [xM, 0, TANK_Z_M],
    radiusM: TANK_RADIUS_M,
    heightM: TANK_HEIGHT_M,
    inletM: [xM, UHT_PIPE_Y_M, TANK_Z_M - TANK_RADIUS_M],
    outletM: [xM, TANK_BOTTOM_M, TANK_Z_M],
  };
}

/** The UHT's pipe to its tank, the header from the tank along the fillers, and each filler's drop. */
function bayPipes(bayIndex: number, uht: UhtSpot, tank: TankSpot, fillers: readonly FillerSpot[]): PipeRoute[] {
  const pipes: PipeRoute[] = [{ id: `uht:${bayIndex}`, kind: 'uht', filler: null, paths: [[uht.outletM, tank.inletM]], radiusM: MAIN_PIPE_RADIUS_M }];
  if (fillers.length === 0) return pipes;

  const [tankX] = tank.outletM;
  const tee: FloorPointM = [tankX, HEADER_Y_M, HEADER_Z_M];
  const xs = fillers.map((filler) => filler.centreM[0]);
  const paths: FloorPointM[][] = [[tank.outletM, [tankX, HEADER_Y_M, TANK_Z_M], tee]];
  // An arm each way from the tee, out to the outermost filler on that side.
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  if (left < tankX) paths.push([tee, [left, HEADER_Y_M, HEADER_Z_M]]);
  if (right > tankX) paths.push([tee, [right, HEADER_Y_M, HEADER_Z_M]]);
  pipes.push({ id: `header:${bayIndex}`, kind: 'header', filler: null, paths, radiusM: MAIN_PIPE_RADIUS_M });

  fillers.forEach((filler, index) => {
    const [xM, inletY, inletZ] = filler.inletM;
    const riseZ = inletZ - DROP_SETBACK_M;
    pipes.push({
      id: `line:${bayIndex}:${index}`,
      kind: 'line',
      filler: index,
      paths: [[[xM, HEADER_Y_M, HEADER_Z_M], [xM, HEADER_Y_M, riseZ], [xM, inletY, riseZ], filler.inletM]],
      radiusM: LINE_PIPE_RADIUS_M,
    });
  });
  return pipes;
}

function title(bay: FloorBay): string {
  if (!bay.uht) return UNASSIGNED_TITLE;
  return bay.uht.capacityLph > 0 ? `${bay.uht.name} · ${formatNumber(bay.uht.capacityLph)} L/h` : bay.uht.name;
}

/** What the floor is built from: the bays' UHTs and capacities, and their lines' ids, names and filler kinds. */
function layoutKey(bays: readonly FloorBay[], sized: readonly (readonly Sized[])[]): string {
  return JSON.stringify(
    bays.map((bay, index) => [
      bay.uht ? [bay.uht.name, bay.uht.capacityLph] : null,
      sized[index].map((filler) => [filler.lineId, filler.name, filler.kind]),
    ]),
  );
}

function boundsOf(rects: readonly FloorRectM[]): FloorRectM {
  return {
    xMinM: Math.min(...rects.map((rect) => rect.xMinM)),
    xMaxM: Math.max(...rects.map((rect) => rect.xMaxM)),
    zMinM: Math.min(...rects.map((rect) => rect.zMinM)),
    zMaxM: Math.max(...rects.map((rect) => rect.zMaxM)),
  };
}

export const layoutFactory: LayoutFactory = (view: FactoryView): FactoryLayout => {
  const bays = floorBays(view);
  const sized = bays.map((bay) => bay.lines.map(sizeFiller));

  // Every slab runs the same depth, from behind the skids to past the longest belt, so the bays line up;
  // with no filler at all, as far as a TBA/19's belt would reach.
  const zMinM = UHT_Z_M - UHT_DEPTH_M / 2 - BAY_MARGIN_M;
  const zMaxM = Math.max(beltEndZ(FILLER_BASE_M), ...sized.flat().map(beltEndZ)) + BAY_MARGIN_M;

  const rowWidthM = (fillers: readonly Sized[]): number =>
    fillers.reduce((sum, filler) => sum + filler.widthM, 0) + FILLER_GAP_M * Math.max(0, fillers.length - 1);
  const innerWidthsM = bays.map((bay, index) =>
    Math.max(rowWidthM(sized[index]), bay.uht ? Math.max(uhtLengthM(bay.uht.capacityLph), 2 * TANK_RADIUS_M) : 0),
  );
  const bayWidthsM = innerWidthsM.map((width) => width + 2 * BAY_MARGIN_M);
  const floorWidthM = bayWidthsM.reduce((sum, width) => sum + width, 0) + BAY_GAP_M * Math.max(0, bays.length - 1);

  let leftM = -floorWidthM / 2;
  const laid: BayLayout[] = bays.map((bay, bayIndex) => {
    const widthM = bayWidthsM[bayIndex];
    const rect: FloorRectM = { xMinM: leftM, xMaxM: leftM + widthM, zMinM, zMaxM };
    leftM += widthM + BAY_GAP_M;
    const centreX = (rect.xMinM + rect.xMaxM) / 2;

    // The fillers left to right, the row centred in the bay.
    let fillerLeftM = centreX - rowWidthM(sized[bayIndex]) / 2;
    const fillers = sized[bayIndex].map((filler) => {
      const spot = placeFiller(filler, fillerLeftM + filler.widthM / 2);
      fillerLeftM += filler.widthM + FILLER_GAP_M;
      return spot;
    });

    const uht = bay.uht ? placeUht(bay.uht.name, bay.uht.capacityLph, centreX) : null;
    const tank = bay.uht ? placeTank(centreX) : null;
    const viewM = Math.max(BAY_VIEW_MIN_M, widthM * BAY_VIEW_PER_WIDTH);
    const camera: CameraStopM = {
      targetM: [centreX, 1.5, (zMinM + zMaxM) / 2],
      offsetM: scaled(OVERVIEW_DIRECTION, viewM / Math.hypot(...OVERVIEW_DIRECTION)),
    };
    return {
      uhtName: bay.uht?.name ?? '',
      title: title(bay),
      titleM: [rect.xMinM + TITLE_INSET_M, TITLE_Y_M, rect.zMaxM + TITLE_GAP_M],
      rect,
      uht,
      tank,
      fillers,
      pipes: uht && tank ? bayPipes(bayIndex, uht, tank, fillers) : [],
      camera,
    };
  });

  const bounds = laid.length > 0 ? boundsOf(laid.map((bay) => bay.rect)) : { xMinM: -EMPTY_HALF_WIDTH_M, xMaxM: EMPTY_HALF_WIDTH_M, zMinM, zMaxM };
  const heightM = Math.max(
    UHT_HEIGHT_M,
    ...laid.flatMap((bay) => [bay.tank?.heightM ?? 0, ...bay.fillers.map((filler) => filler.heightM)]),
  );
  return {
    key: layoutKey(bays, sized),
    bays: laid,
    bounds,
    heightM,
    overview: {
      targetM: [(bounds.xMinM + bounds.xMaxM) / 2, 0, (bounds.zMinM + bounds.zMaxM) / 2],
      direction: OVERVIEW_DIRECTION,
      halfWidthM: ((bounds.xMaxM - bounds.xMinM) / 2) * OVERVIEW_PERSPECTIVE + OVERVIEW_ROOM_M,
    },
  };
};

/** Where the camera stands for a stop. */
export function cameraPositionM(stop: CameraStopM): FloorPointM {
  return add(stop.targetM, stop.offsetM);
}
