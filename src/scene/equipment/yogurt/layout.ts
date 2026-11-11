// Where the yogurt wing's machines stand (phase 16, plan 12's floor plan): one table for the machines
// (yogurtLine.ts), the pipes between them (pipes.ts) and the tests that keep them apart. World metres, as
// layout.ts: x along the flow, y up, z from the wing's back wall (−56) to its near edge (−32 or −38.5).
import type { PointM } from '../../layout';

/** A footprint on the floor: centre and size. */
export interface Footprint {
  readonly xM: number;
  readonly zM: number;
}

/** The process line's centre: most machines of stages 12, 14 and 15 stand on it, as the milk's stand on z −14. */
export const LINE_Z_M = -47;
/** The height the product pipes run at, as the milk row's feed line does. */
export const PIPE_Y_M = 0.9;

/** Stage 11: the yogurt silo, the powder station and high-shear mixer, the stabilizer skid and the mix tank. */
export const SILO = { xM: -57, zM: -46, radiusM: 1.5, plinthM: 0.5, bodyM: 4.6, domeM: 0.7 } as const;
export const POWDER_STATION: Footprint = { xM: -52, zM: -50.5 };
export const MIXER: Footprint = { xM: -52, zM: -46 };
export const STABILIZER_SKID: Footprint = { xM: -52, zM: -41.5 };
export const MIX_TANK = { xM: -48.5, zM: -46, radiusM: 1.05, legsM: 0.6, bodyM: 1.8 } as const;

/** Stage 12: deaerator, homogenizer, plate heat exchanger, the holding cell, the divert valve and the reprocess tank. */
export const DEAERATOR: Footprint = { xM: -41, zM: LINE_Z_M };
export const HOMOGENIZER: Footprint = { xM: -38.5, zM: LINE_Z_M };
/** Phase 25: the vacuum gauge's dial on the deaerator's pump, on its face to the aisle. */
export const DEAERATOR_GAUGE = { xM: DEAERATOR.xM + 0.75, yM: 0.38, zM: DEAERATOR.zM + 0.2 } as const;
/**
 * The homogenizer, as the UHT line's model lays one out (assets' homogenizer), in offsets from its middle: the crankcase
 * with its gauges on the top cover; the pistons in the open gap in front of it, between tie rods over a drip tray; the
 * liquid end beyond them, low enough that the stage's camera sees the pistons over it; the main motor behind on its
 * feet, and the belt guard on its east side. The milk comes in at its west side and leaves at its east, at pipe height.
 */
export const HOMOGENIZER_FRAME = {
  crankHalfXM: 0.7,
  crankBackM: -0.45,
  crankFrontM: 0.45,
  crankTopM: 1.05,
  pistonXsM: [-0.4, 0, 0.4],
  pistonYM: 0.62,
  pistonSideM: 0.11,
  pistonLengthM: 0.5,
  /** The pistons' middle at rest, and their stroke either side of it: their ends stay in the crankcase and the liquid end. */
  pistonZM: 0.625,
  strokeM: 0.06,
  endBackM: 0.8,
  endFrontM: 1.05,
  endTopM: 0.72,
  motor: { yM: 0.42, zM: -0.85, radiusM: 0.3, lengthM: 0.8 },
  guard: { xM: 0.78, widthM: 0.12, yMinM: 0.2, yMaxM: 1.0, zMinM: -1.05, zMaxM: -0.2 },
  gaugeYM: 1.11,
} as const;
/** The gauges on the top cover, facing up: the first stage's and the second's, from the homogenizer's middle. */
export const HOMOGENIZER_GAUGES = [
  { name: 'stage1Gauge', dxM: -0.3, dzM: 0.15 },
  { name: 'stage2Gauge', dxM: 0.15, dzM: 0.15 },
] as const;
/** Phase 26: the homogenizer's control cabinet, standing east of it with its face (+z) to the aisle. */
export const HOMOGENIZER_PANEL = { xM: HOMOGENIZER.xM + 1.0, zM: HOMOGENIZER.zM + 0.4, widthM: 0.36, heightM: 1.4, depthM: 0.25 } as const;
/** Phase 26: its lube-oil unit, behind its west end, clear of the belt guard (phase 27). */
export const HOMOGENIZER_LUBE = { xM: HOMOGENIZER.xM - 0.9, zM: HOMOGENIZER.zM - 0.6 } as const;
/** The plate pack, 2.6 m long: regeneration, heating and cooling sections from west to east. */
export const PHE = { xM: -35, zM: LINE_Z_M, lengthM: 2.6, depthM: 0.6, heightM: 1.6 } as const;
/**
 * Phase 25: the heat exchanger's hot-water set, on the floor east of it before the holding cell's outlet: the tank of
 * the closed hot-water circuit, its steam valve on top, its pump in front, whose rotor turns on its face to the aisle.
 * Phase 26: its controller on the tank's front, at `displayYM`.
 */
export const HOT_WATER_SET = { xM: PHE.xM + PHE.lengthM / 2 + 0.8, tankZM: LINE_Z_M - 0.15, pumpZM: LINE_Z_M + 0.55, valveYM: 1.2, displayYM: 0.85 } as const;
/** The holding cell's frame, round a serpentine of 500 L (H123) drawn by pipes.ts. */
export const HOLDING_CELL = { xMinM: -37, xMaxM: -33, zMinM: -53.4, zMaxM: -50, heightM: 1.5 } as const;
/** The serpentine's passes, west to east and back, from its inlet at the north-west to its outlet. */
export const HOLDING_CELL_PASSES_Z_M = [-50.5, -51.1, -51.7, -52.3, -52.9] as const;
/** Phase 25: the CCP's temperature recorder, on a post at the holding cell's outlet corner, its chart facing the aisle. */
export const CCP_RECORDER = { xM: -33.6, yM: 1.25, zM: -49.75, widthM: 0.3, heightM: 0.35 } as const;
export const DIVERT_VALVE: Footprint = { xM: -31, zM: LINE_Z_M };
export const REPROCESS_TANK = { xM: -31, zM: -51.8, radiusM: 0.75, legsM: 0.4, bodyM: 1.3 } as const;
/** Phase 25: the reprocess tank's pump at its foot, east of it; its rotor turns on its east face. */
export const REPROCESS_PUMP = { xM: REPROCESS_TANK.xM + REPROCESS_TANK.radiusM + 0.55 } as const;

/** Stage 13: the culture dosing pump and the three insulated fermentation tanks. */
export const CULTURE_PUMP: Footprint = { xM: -27.5, zM: -43 };
/** Phase 26: the culture skid's controller on its post at the skid's east corner, its face to the aisle. */
export const CULTURE_PANEL = { xM: CULTURE_PUMP.xM + 0.55, yM: 1.15, zM: CULTURE_PUMP.zM + 0.32 } as const;
/** Phase 26: the culture freezer, west of the skid. */
export const CULTURE_FREEZER = { xM: CULTURE_PUMP.xM - 1.15, zM: CULTURE_PUMP.zM, widthM: 0.8, heightM: 0.8, depthM: 0.55 } as const;
export const FERMENT_TANK = { xsM: [-24, -20, -16], zM: -48.5, radiusM: 1.4, legsM: 0.7, coneM: 0.5, bodyM: 2.6, domeM: 0.4 } as const;
/** The inlet header in front of the tanks, from the culture injection, and the outlet manifold behind them. */
export const FERMENT_INLET_Z_M = -45.2;
export const FERMENT_INLET_Y_M = 1.4;
export const FERMENT_OUTLET_Z_M = -50.6;
/** Phase 25: the valve matrix: each tank's inlet valve on its branch from the header, its outlet valve under its cone. */
export const FERMENT_INLET_VALVE_Z_M = -46.15;
export const FERMENT_OUTLET_VALVE_Z_M = -48.95;
/**
 * Phase 26: the fermentation tanks' services. Each tank's jacket risers stand at 60° from +z toward −x, outside the
 * shell; the CIP header runs over the tanks' tops behind their drives, on two posts.
 */
export const FERMENT_JACKET = { angleRad: Math.PI / 3, radiusM: FERMENT_TANK.radiusM + 0.32, spreadM: 0.09, supplyYM: 1.5, returnYM: 3.45 } as const;
export const FERMENT_CIP_HEADER = { yM: 4.9, zM: FERMENT_TANK.zM - 0.7, xMinM: FERMENT_TANK.xsM[0] - 1.7, xMaxM: FERMENT_TANK.xsM[2] + 1.7 } as const;

/** Stage 14: the smoothing valve, the plate cooler, the fruit tank and its pump, and the P8 buffer. */
export const SMOOTHING_VALVE: Footprint = { xM: -11.5, zM: LINE_Z_M };
/** Phase 26: the pressure gauge on the line after the smoothing valve's flow meter: its dial's middle. */
export const SMOOTHING_GAUGE = { xM: SMOOTHING_VALVE.xM + 0.9, yM: PIPE_Y_M + 0.23 } as const;
export const COOLER = { xM: -9, zM: LINE_Z_M, lengthM: 1.2, depthM: 0.5, heightM: 1.3 } as const;
/** Phase 25: the cooler's ice-water pump, at its east end in front of the line; its rotor turns on its face to the aisle. */
export const ICE_WATER_PUMP = { xM: COOLER.xM + COOLER.lengthM / 2 + 0.55, zM: LINE_Z_M + 0.15 } as const;
/** Phase 26: the ice-water control valve, on the pump's line into the cooler's east end. */
export const ICE_WATER_VALVE = { xM: (COOLER.xM + COOLER.lengthM / 2 + 0.05 + ICE_WATER_PUMP.xM - 0.15) / 2, yM: 0.22, zM: ICE_WATER_PUMP.zM } as const;
export const FRUIT_TANK = { xM: -9, zM: -52, radiusM: 0.7, legsM: 0.4, bodyM: 1.4 } as const;
/** Phase 25: the fruit preparation's IBC, west of its tank. */
export const FRUIT_IBC = { xM: FRUIT_TANK.xM - FRUIT_TANK.radiusM - 0.75, zM: FRUIT_TANK.zM } as const;
export const BUFFER = { xM: -5.5, zM: LINE_Z_M, radiusM: 0.95, legsM: 0.5, bodyM: 1.6 } as const;
/** Phase 25: the buffer's outlet valve on the feed to P8, just past the buffer; its stem lifts while P8 runs. */
export const BUFFER_OUTLET_VALVE = { xM: BUFFER.xM + BUFFER.radiusM + 0.3, yM: 0.7, zM: LINE_Z_M } as const;

/** Stage 15: Line P8 under its HEPA hood, its three check gates and the reject bin. */
export const P8 = { xMinM: 1.5, xMaxM: 11.5, zM: LINE_Z_M, widthM: 1.6, bodyM: 0.95, hoodM: 1.35 } as const;
export const CHECK_GATES = { checkweigher: 12.8, metalDetector: 13.9, vision: 15 } as const;
export const REJECT_BIN: Footprint = { xM: 13.9, zM: -49.2 };

/**
 * P8's stations along its carrier (phase 18), in the SOP's order: the de-nester under the cup magazines, the ionized
 * air and vacuum shroud, the UV-C tunnel, the piston filler, the foil pick, the sealing heads and the coder.
 */
export const P8_STATIONS = {
  denesterXM: 2.3,
  ionizerXM: 3.3,
  uvFromXM: 4,
  uvToXM: 6.2,
  fillerXM: 7,
  foilXM: 8.3,
  sealerXM: 9.3,
  coderXM: 10.4,
} as const;
/**
 * The carrier's pockets: 12 lanes across, a row every 0.1 m, the cups' bases on its top. Past P8 a ramp takes the cups
 * down to the check gates' belts, where they run four abreast to the tray packer (OUTFEED).
 */
export const P8_CARRIER = { pitchM: 0.1, lanePitchM: 0.095, topM: P8.bodyM + 0.08 } as const;
export const P8_GATE_BELT = { topM: 0.76, lanes: 4, lanePitchM: 0.09, pitchM: 0.1, rampToXM: 12.3 } as const;
/** The cup token, a 125 g cup at its real size: 72 mm across the rim, 60 at the base, 70 mm tall. */
export const CUP_M = { rimRadiusM: 0.036, baseRadiusM: 0.03, heightM: 0.07 } as const;
/** Where a cup the checks reject is kicked off the belt, between the metal detector and the vision check. */
export const REJECT_KICK_XM = 14.45;

/** Stage 16: the tray packer, palletizer and wrapper on the line; the warm room, the blast chiller and the cold room. */
export const TRAY_PACKER: Footprint = { xM: 21, zM: LINE_Z_M };
/** The belt from P8's last gate to the tray packer. */
export const OUTFEED = { xMinM: 15.7, xMaxM: 20 } as const;
/** The gantry palletizer (phase 24): the centre of its pallet place, under the gantry, on the line. */
export const PALLETIZER: Footprint = { xM: 24.8, zM: LINE_Z_M };
/**
 * Stage 16's pallet line (phase 24): the tray infeed belt from the packer to the gantry's pick point, the pallet
 * place's rollers, the empty-pallet dispenser behind it, and the rollers through the stretch wrapper to the end of the
 * staging row. Pallets stand on the rollers' top, as the UHT line's do (packs/layout.ts PALLET_ROLLER_TOP_M).
 */
export const PALLET_LINE = {
  rollerTopM: 0.25,
  widthM: 1.1,
  infeed: { xMinM: 22.0, xMaxM: 23.3, topM: 0.76, widthM: 0.5 },
  /** Where the gantry picks a tray: the infeed's end, a tray's length short of its last roller. */
  pickXM: 23.1,
  /** The dispenser's stack of empty pallets, behind the place, from which a fresh pallet slides on. */
  dispenserZM: LINE_Z_M - 1.8,
  /** The rollers from the gantry to the wrapper's turntable, and from the turntable to the staging row's end. */
  toWrapper: { xMinM: 25.65, xMaxM: 26.95 },
  outfeed: { xMinM: 29.05, xMaxM: 36.9 },
} as const;
export const WRAPPER: Footprint = { xM: 28, zM: LINE_Z_M };
/** Behind the second line of zone names (z −38.5), so its walls hide none of them from the overview. */
export const WARM_ROOM = { xMinM: 19.6, xMaxM: 26.4, zMinM: -45, zMaxM: -39, wallM: 3 } as const;
/**
 * The warm room's door (phase 29): in its east wall, onto the transfer bay between it and the blast chiller, where a
 * stacker can reach it. Before, it stood in the north wall, a metre from the palletizer's legs.
 */
export const WARM_DOOR = { zM: -41, widthM: 2 } as const;
/**
 * The blast chiller: a tunnel along x, in at its west mouth from the transfer bay and out at its east one. Since phase
 * 29 its west end stands 1 m further east, so a stacker with a pallet off the line passes its corner.
 */
export const BLAST_CHILLER = { xMinM: 31, xMaxM: 36.4, zMinM: -44.6, zMaxM: -41.8, heightM: 2.8 } as const;
export const COLD_ROOM = { xMinM: 19.6, xMaxM: 36.4, zMinM: -55.6, zMaxM: -50.2, wallM: 4 } as const;
/** The cold room's doorway from the chiller, in its south wall. */
export const COLD_DOORWAY = { xM: 33.2, widthM: 2.4 } as const;
/** The cold room's dock doors, in its north wall, facing the reefer yard (layout.ts REEFER_YARD). */
export const DOCK_DOORS_X_M = [23.5, 28, 32.5] as const;

/** A point on the process line at the pipe height. */
export const onLine = (xM: number): PointM => [xM, PIPE_Y_M, LINE_Z_M];
