// The yogurt wing's pipes (phase 16): the routes between the machines of equipment/yogurt/layout.ts, coloured and
// flowing from the yogurt line points (contracts v8) the way the milk's are. pipes.ts builds them with the milk runs.
import type { PointM } from './layout';
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
 * Mix that falls short of the CCP, to the reprocess tank. No line point carries its flow in contracts v8, so it
 * stands still until phase 17 diverts.
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

/** Cooled to 43 °C, the culture injected, along the header in front of the tanks and down into each. */
const INOCULATION_PATHS: readonly Path[] = [
  {
    radiusM: RADIUS_M,
    vertices: [
      [-35.8, y, phe.frontM, 'yInoculation'],
      [-35.8, y, inletZ, 'yInoculation'],
      [-35.8, inletY, inletZ, 'yInoculation'],
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

/** From the buffer to Line P8's filler manifold, under controlled pressure (SOP P8 step 1). */
const P8_FEED_PATH: Path = {
  radiusM: RADIUS_M,
  vertices: [
    [at.BUFFER.xM + at.BUFFER.radiusM, 0.7, z, 'p8Buffer', 'p8Filler'],
    [at.P8.xMinM, 0.7, z, 'p8Filler'],
  ],
};

/**
 * The yogurt line's milk routes, in flow order, as three runs, one mesh each: silo to the heat exchanger, the holding
 * cell with the divert and forward lines, and the inoculated mix from the heat exchanger through the tanks, the
 * cooler and the buffer to Line P8. Thin as they are, they cast no shadow: a mesh and its shadow are a draw call each.
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
    // heat exchanger, or to the reprocess tank. A click on it selects stage 12, as the UHT holding tube selects 4.
    id: 'y-holding-cell',
    stage: 12,
    castShadow: false,
    paths: [CELL_PATH, DIVERT_PATH, FORWARD_PATH],
  },
  {
    // Cooled to 43 °C and inoculated, into the tanks; out of their cone bottoms to the smoothing valve, the cooler,
    // the buffer and P8's filler manifold.
    id: 'y-ferment',
    castShadow: false,
    paths: [...INOCULATION_PATHS, ...FERMENT_OUT_PATHS, ...BUFFER_PATHS, P8_FEED_PATH],
    joints: [...INOCULATION_JOINTS, ...FERMENT_OUT_JOINTS],
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
