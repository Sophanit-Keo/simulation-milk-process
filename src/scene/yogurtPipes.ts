// The yogurt wing's pipes (phase 16): the routes between the machines of equipment/yogurt/layout.ts, coloured and
// flowing from the yogurt line points (contracts v8) the way the milk's are. pipes.ts builds them with the milk runs.
// Phase 32 (D34): the wing's CIP station's supply and return lines, and the product pipes each of its circuits cleans.
import type { PointM } from './layout';
import type { CipCircuitId } from './equipment/yogurt/cipCircuits';
import * as at from './equipment/yogurt/layout';
import type { PipeRun, RouteVertex } from './pipes';

const RADIUS_M = 0.08;
const JOINT_RADIUS_M = RADIUS_M * 1.05;
const y = at.PIPE_Y_M;
const z = at.LINE_Z_M;

/** The holding cell's serpentine, from its inlet in the north-west, west to east and back (H123's 500 L). */
function serpentine(): RouteVertex[] {
  const { xMinM, xMaxM } = at.HOLDING_CELL;
  const westM = xMinM + 0.4;
  const eastM = xMaxM - 0.4;
  return at.HOLDING_CELL_PASSES_Z_M.flatMap((passZM, i): RouteVertex[] => {
    const [fromM, toM] = i % 2 === 0 ? [westM, eastM] : [eastM, westM];
    return [
      [fromM, y, passZM, 'yHoldingCell', 'yHeater'],
      [toM, y, passZM, 'yHoldingCell', 'yHeater'],
    ];
  });
}

const tankXs = at.FERMENT_TANK.xsM;
const tankFrontZM = at.FERMENT_TANK.zM + at.FERMENT_TANK.radiusM;
const inletY = at.FERMENT_INLET_Y_M;
const inletZ = at.FERMENT_INLET_Z_M;
const outletZ = at.FERMENT_OUTLET_Z_M;
const phe = { westM: at.PHE.xM - at.PHE.lengthM / 2 - 0.05, frontM: at.PHE.zM + at.PHE.depthM / 2 + 0.05, backM: at.PHE.zM - at.PHE.depthM / 2 - 0.05 };
const serpentineVertices = serpentine();
const serpentineEnd = serpentineVertices[serpentineVertices.length - 1];
const serpentineStart = serpentineVertices[0];

type Path = PipeRun['paths'][number];

/** The silo's milk through the high-shear mixer, where the powder is drawn in, into the mix tank. */
const MIX_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [at.SILO.xM + at.SILO.radiusM, 0.45, at.SILO.zM, 'ySilo'],
    [at.MIX_TANK.xM - at.MIX_TANK.radiusM - 0.45, 0.45, at.MIX_TANK.zM, 'ySilo'],
    [at.MIX_TANK.xM - at.MIX_TANK.radiusM - 0.45, 0.8, at.MIX_TANK.zM, 'ySilo'],
    [at.MIX_TANK.xM - at.MIX_TANK.radiusM, 0.8, at.MIX_TANK.zM, 'ySilo'],
  ],
};

/** The mix tank across into the process hall, the deaerator, the homogenizer and the heat exchanger's heating. */
const HEAT_PATHS: readonly Path[] = [
  {
    radiusM: RADIUS_M,
    vertices: [
      [at.MIX_TANK.xM + at.MIX_TANK.radiusM, y, at.MIX_TANK.zM, 'yMixTank'],
      [-44.5, y, at.MIX_TANK.zM, 'yMixTank'],
      [-44.5, y, z, 'yMixTank'],
      [at.DEAERATOR.xM - 0.5, y, z, 'yMixTank'],
    ],
  },
  { radiusM: RADIUS_M, vertices: [[at.DEAERATOR.xM + 0.5, y, z, 'yMixTank'], [at.HOMOGENIZER.xM - 0.7, y, z, 'yMixTank']] },
  {
    radiusM: RADIUS_M,
    vertices: [
      [at.HOMOGENIZER.xM + 0.7, y, z, { from: 'yMixTank', to: 'yHeater', frac: 0.15 }],
      [phe.westM, y, z, { from: 'yMixTank', to: 'yHeater', frac: 0.15 }],
    ],
  },
];

/** From the heating section to the holding cell, round its serpentine and back to the divert valve. */
const CELL_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [-34, y, phe.backM, 'yHeater'],
    [-34, y, -49.6, 'yHeater'],
    [serpentineStart[0], y, -49.6, 'yHeater'],
    ...serpentineVertices,
    [-32.3, y, serpentineEnd[2], 'yHoldingCell', 'yHeater'],
    [-32.3, y, z, 'yHoldingCell', 'yHeater'],
    [at.DIVERT_VALVE.xM - 0.2, y, z, 'yHoldingCell', 'yHeater'],
  ],
};

/**
 * Mix that falls short of the CCP, to the reprocess tank. No line point carries its flow, so its stripes stand still;
 * since phase 17 it is a run of its own, which glows red while the heat treatment diverts, as the milk's divert does.
 */
const DIVERT_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [at.DIVERT_VALVE.xM, y, z - 0.2, 'yHoldingCell', 'still'],
    [at.DIVERT_VALVE.xM, y, at.REPROCESS_TANK.zM + at.REPROCESS_TANK.radiusM, 'yHoldingCell', 'still'],
  ],
};

/** Forward from the valve, back into the heat exchanger's regeneration and cooling sections. */
const FORWARD_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [at.DIVERT_VALVE.xM + 0.2, y, z, 'yHoldingCell'],
    [-30.4, y, z, 'yHoldingCell'],
    [-30.4, y, -45.8, 'yHoldingCell'],
    [-33.9, y, -45.8, 'yHoldingCell'],
    [-33.9, y, phe.frontM, 'yHoldingCell'],
  ],
};

/** Where the inoculated mix leaves the heat exchanger's cooling section, toward the tanks' header. */
const INOCULATION_X_M = -35.8;

/** Cooled to 43 °C, the culture injected, along the header in front of the tanks and down into each. */
const INOCULATION_PATHS: readonly Path[] = [
  {
    radiusM: RADIUS_M,
    vertices: [
      [INOCULATION_X_M, y, phe.frontM, 'yInoculation'],
      [INOCULATION_X_M, y, inletZ, 'yInoculation'],
      [INOCULATION_X_M, inletY, inletZ, 'yInoculation'],
      [tankXs[2], inletY, inletZ, 'yInoculation'],
      [tankXs[2], inletY, tankFrontZM, 'yInoculation'],
    ],
  },
  ...tankXs.slice(0, 2).map((xM): Path => ({
    radiusM: RADIUS_M,
    vertices: [
      [xM, inletY, inletZ, 'yInoculation'],
      [xM, inletY, tankFrontZM, 'yInoculation'],
    ],
  })),
];
const INOCULATION_JOINTS = tankXs.slice(0, 2).map((xM) => ({ at: [xM, inletY, inletZ, 'yInoculation'] as RouteVertex, radiusM: JOINT_RADIUS_M }));

/** From the tanks' cone bottoms along the manifold behind them to the smoothing valve. */
const FERMENT_OUT_PATHS: readonly Path[] = [
  {
    radiusM: RADIUS_M,
    vertices: [
      [tankXs[0], 0.6, at.FERMENT_TANK.zM, 'yFermentTank'],
      [tankXs[0], 0.6, outletZ, 'yFermentTank'],
      [-12.4, 0.6, outletZ, 'yFermentTank'],
      [-12.4, 0.6, z, 'yFermentTank'],
      [-12.4, y, z, 'yFermentTank'],
      [at.SMOOTHING_VALVE.xM - 0.45, y, z, 'yFermentTank'],
    ],
  },
  ...tankXs.slice(1).map((xM): Path => ({
    radiusM: RADIUS_M,
    vertices: [
      [xM, 0.6, at.FERMENT_TANK.zM, 'yFermentTank'],
      [xM, 0.6, outletZ, 'yFermentTank'],
    ],
  })),
];
const FERMENT_OUT_JOINTS = tankXs.slice(1).map((xM) => ({ at: [xM, 0.6, outletZ, 'yFermentTank'] as RouteVertex, radiusM: JOINT_RADIUS_M }));

/** Smoothed, through the plate cooler, into the P8 buffer. */
const BUFFER_PATHS: readonly Path[] = [
  { radiusM: RADIUS_M, vertices: [[at.SMOOTHING_VALVE.xM + 0.45, y, z, 'yFermentTank', 'yCooler'], [at.COOLER.xM - at.COOLER.lengthM / 2 - 0.05, y, z, 'yFermentTank', 'yCooler']] },
  { radiusM: RADIUS_M, vertices: [[at.COOLER.xM + at.COOLER.lengthM / 2 + 0.05, y, z, 'yCooler'], [at.BUFFER.xM - at.BUFFER.radiusM, y, z, 'yCooler']] },
];

/** The feed's height from the buffer into P8. */
const P8_FEED_Y_M = 0.7;

/** From the buffer to Line P8's filler manifold, under controlled pressure (SOP P8 step 1). */
const P8_FEED_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [at.BUFFER.xM + at.BUFFER.radiusM, P8_FEED_Y_M, z, 'p8Buffer', 'p8Filler'],
    [at.P8.xMinM, P8_FEED_Y_M, z, 'p8Filler'],
  ],
};

/* Phase 32 (D34): the wing's CIP station's lines */

const station = at.CIP_STATION;
const supplyX = (lane: number): number => (station.laneXsM[lane] ?? 0) + station.supplyDxM;
const returnX = (lane: number): number => (station.laneXsM[lane] ?? 0) + station.returnDxM;
const valveTopM = station.valveYM + 0.07;
const rack = station.rack;
/** Where the heat treatment's circuit starts and ends on the product line: at the deaerator's inlet, and after the cooling. */
export const HEAT_CIP = { supplyXM: -42.3, returnZM: -45.6 } as const;
/** The tanks' circuit's return main, behind the tanks, and each tank's branch from its outlet valve. */
const TANK_RETURN = { zM: -51.25, yM: 0.3, dxM: -0.2 } as const;
/** P8's CIP/SIP skid (cupRoomDetail.ts CIP_SKID), where the circuit's return leaves P8. */
const P8_RETURN_FROM: PointM = [10.2, 0.54, -50.4];

/** One of the CIP station's lines: a supply or a return of one circuit, in flow order. */
export interface YogurtCipLine {
  readonly id: string;
  readonly circuit: CipCircuitId;
  readonly pointsM: readonly PointM[];
}
export const YOGURT_CIP_LINE_RADIUS_M = 0.05;

/**
 * The station's lines (D34), each in flow order. The heat treatment's supply runs up to the rack along the back wall,
 * west and down into the line at the deaerator's inlet; its return rises from the line after the heat exchanger's
 * cooling and comes back along the rack. The tanks' supply climbs to the CIP header over the tanks (hallDetail.ts); their
 * return runs from each tank's outlet valve along a main behind them. P8's supply runs east along the rack and down into
 * the buffer's spray line on its dome; its return leaves P8's CIP/SIP skid and comes back along the rack.
 */
export const YOGURT_CIP_LINES: readonly YogurtCipLine[] = [
  {
    id: 'y-cip-heat-supply',
    circuit: 'heat',
    pointsM: [
      [supplyX(0), station.heaterTopM, station.heaterZM],
      [supplyX(0), rack.supplyYM, station.heaterZM],
      [supplyX(0), rack.supplyYM, rack.supplyZM],
      [HEAT_CIP.supplyXM, rack.supplyYM, rack.supplyZM],
      [HEAT_CIP.supplyXM, rack.supplyYM, z],
      [HEAT_CIP.supplyXM, y + RADIUS_M, z],
    ],
  },
  {
    id: 'y-cip-heat-return',
    circuit: 'heat',
    pointsM: [
      [INOCULATION_X_M, y + RADIUS_M, HEAT_CIP.returnZM],
      [INOCULATION_X_M, rack.returnYM, HEAT_CIP.returnZM],
      [INOCULATION_X_M, rack.returnYM, rack.returnZM],
      [returnX(0), rack.returnYM, rack.returnZM],
      [returnX(0), rack.returnYM, station.valveZM],
      [returnX(0), valveTopM, station.valveZM],
    ],
  },
  {
    id: 'y-cip-tanks-supply',
    circuit: 'tanks',
    pointsM: [
      [supplyX(1), station.heaterTopM, station.heaterZM],
      [supplyX(1), at.FERMENT_CIP_HEADER.yM, station.heaterZM],
      [at.FERMENT_CIP_HEADER.xMinM, at.FERMENT_CIP_HEADER.yM, station.heaterZM],
      [at.FERMENT_CIP_HEADER.xMinM, at.FERMENT_CIP_HEADER.yM, at.FERMENT_CIP_HEADER.zM - 0.035],
    ],
  },
  ...tankXs.map((xM, i): YogurtCipLine => ({
    id: `y-cip-tank-${i + 1}-return`,
    circuit: 'tanks',
    pointsM: [
      [xM - 0.08, 0.6, at.FERMENT_OUTLET_VALVE_Z_M],
      [xM + TANK_RETURN.dxM, 0.6, at.FERMENT_OUTLET_VALVE_Z_M],
      [xM + TANK_RETURN.dxM, TANK_RETURN.yM, at.FERMENT_OUTLET_VALVE_Z_M],
      [xM + TANK_RETURN.dxM, TANK_RETURN.yM, TANK_RETURN.zM],
    ],
  })),
  {
    id: 'y-cip-tanks-return',
    circuit: 'tanks',
    pointsM: [
      [(tankXs[2] ?? 0) + TANK_RETURN.dxM, TANK_RETURN.yM, TANK_RETURN.zM],
      [returnX(1), TANK_RETURN.yM, TANK_RETURN.zM],
      [returnX(1), TANK_RETURN.yM, station.valveZM],
      [returnX(1), station.valveYM - 0.07, station.valveZM],
    ],
  },
  {
    id: 'y-cip-p8-supply',
    circuit: 'p8',
    pointsM: [
      [supplyX(2), station.heaterTopM, station.heaterZM],
      [supplyX(2), rack.supplyYM, station.heaterZM],
      [supplyX(2), rack.supplyYM, rack.supplyZM],
      [at.BUFFER.xM - 0.75, rack.supplyYM, rack.supplyZM],
      [at.BUFFER.xM - 0.75, rack.supplyYM, at.BUFFER.zM + 0.25],
      [at.BUFFER.xM - 0.75, at.BUFFER.legsM + at.BUFFER.bodyM + 0.88, at.BUFFER.zM + 0.25],
    ],
  },
  {
    id: 'y-cip-p8-return',
    circuit: 'p8',
    pointsM: [
      P8_RETURN_FROM,
      [P8_RETURN_FROM[0], rack.returnYM, P8_RETURN_FROM[2]],
      [P8_RETURN_FROM[0], rack.returnYM, rack.returnZM],
      [returnX(2), rack.returnYM, rack.returnZM],
      [returnX(2), rack.returnYM, station.valveZM],
      [returnX(2), valveTopM, station.valveZM],
    ],
  },
];

/**
 * The product pipes a circuit of the station cleans (D34), by run and place on it: the heat treatment's from the
 * deaerator's inlet round the holding cell, the divert and the forward line to its return after the cooling; the
 * buffer and P8's, the feed from the buffer into P8. The tanks are cleaned through their spray heads, not their pipes.
 */
export function yogurtCipCircuitAt(runId: string, xM: number, yM: number, zM: number): CipCircuitId | null {
  if (runId === 'y-holding-cell' || runId === YOGURT_DIVERT_RUN_ID) return 'heat';
  if (runId === 'y-mix') return xM >= HEAT_CIP.supplyXM - 1e-6 ? 'heat' : null;
  if (runId === 'y-ferment') {
    if (Math.abs(xM - INOCULATION_X_M) < 1e-6 && yM < y + 1e-6 && zM <= HEAT_CIP.returnZM + 1e-6) return 'heat';
    if (Math.abs(yM - P8_FEED_Y_M) < 1e-6 && xM >= at.BUFFER.xM) return 'p8';
  }
  return null;
}

/** The run from the yogurt divert valve to the reprocess tank, which lights up while the heat treatment diverts. */
export const YOGURT_DIVERT_RUN_ID = 'y-divert';

/**
 * The yogurt line's milk routes, in flow order, as four runs, one mesh each: silo to the heat exchanger, the holding
 * cell with the forward line, the divert to the reprocess tank (lit while it diverts), and the inoculated mix from
 * the heat exchanger through the tanks, the cooler and the buffer to Line P8. Thin as they are, they cast no shadow:
 * a mesh and its shadow are a draw call each.
 */
export const YOGURT_RUNS: readonly PipeRun[] = [
  {
    // The silo's milk through the high-shear mixer, where the powder is drawn in, into the mix tank; then across into
    // the process hall, the deaerator, the homogenizer and the heat exchanger's heating section.
    id: 'y-mix',
    castShadow: false,
    paths: [MIX_PATH, ...HEAT_PATHS],
  },
  {
    // From the heating section round the holding cell's serpentine to the divert valve, then forward back into the
    // heat exchanger. A click on it selects stage 12, as the UHT holding tube selects 4.
    id: 'y-holding-cell',
    stage: 12,
    castShadow: false,
    paths: [CELL_PATH, FORWARD_PATH],
  },
  {
    // From the divert valve to the reprocess tank; it carries mix only while the heat treatment diverts.
    id: YOGURT_DIVERT_RUN_ID,
    stage: 12,
    castShadow: false,
    paths: [DIVERT_PATH],
  },
  {
    // Cooled to 43 °C and inoculated, into the tanks; out of their cone bottoms to the smoothing valve, the cooler,
    // the buffer and P8's filler manifold. Phase 32: the CIP station's lines join this run's mesh, so they cost no
    // draw call; they carry nothing but their circuit's cleaning fluid.
    id: 'y-ferment',
    castShadow: false,
    paths: [...INOCULATION_PATHS, ...FERMENT_OUT_PATHS, ...BUFFER_PATHS, P8_FEED_PATH],
    joints: [...INOCULATION_JOINTS, ...FERMENT_OUT_JOINTS],
    cipLines: YOGURT_CIP_LINES,
  },
];

/** The wing's plain steel lines: the culture into the header, and the fruit preparation into the line after the cooler. */
export const YOGURT_UTILITY_PATHS: readonly { pointsM: readonly PointM[]; radiusM: number }[] = [
  { radiusM: 0.04, pointsM: [[at.CULTURE_PUMP.xM, 0.35, at.CULTURE_PUMP.zM - 0.4], [at.CULTURE_PUMP.xM, 0.35, -44.9], [at.CULTURE_PUMP.xM, inletY, -44.9]] },
  {
    radiusM: 0.04,
    pointsM: [
      [at.FRUIT_TANK.xM, 0.6, at.FRUIT_TANK.zM + at.FRUIT_TANK.radiusM],
      [-7.8, 0.6, at.FRUIT_TANK.zM + at.FRUIT_TANK.radiusM],
      [-7.8, 0.6, z],
      [-7.8, y - RADIUS_M, z],
    ],
  },
];
