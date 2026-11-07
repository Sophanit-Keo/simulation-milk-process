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
/** The plate pack, 2.6 m long: regeneration, heating and cooling sections from west to east. */
export const PHE = { xM: -35, zM: LINE_Z_M, lengthM: 2.6, depthM: 0.6, heightM: 1.6 } as const;
/** The holding cell's frame, round a serpentine of 500 L (H123) drawn by pipes.ts. */
export const HOLDING_CELL = { xMinM: -37, xMaxM: -33, zMinM: -53.4, zMaxM: -50, heightM: 1.5 } as const;
/** The serpentine's passes, west to east and back, from its inlet at the north-west to its outlet. */
export const HOLDING_CELL_PASSES_Z_M = [-50.5, -51.1, -51.7, -52.3, -52.9] as const;
export const DIVERT_VALVE: Footprint = { xM: -31, zM: LINE_Z_M };
export const REPROCESS_TANK = { xM: -31, zM: -51.8, radiusM: 0.75, legsM: 0.4, bodyM: 1.3 } as const;

/** Stage 13: the culture dosing pump and the three insulated fermentation tanks. */
export const CULTURE_PUMP: Footprint = { xM: -27.5, zM: -43 };
export const FERMENT_TANK = { xsM: [-24, -20, -16], zM: -48.5, radiusM: 1.4, legsM: 0.7, coneM: 0.5, bodyM: 2.6, domeM: 0.4 } as const;
/** The inlet header in front of the tanks, from the culture injection, and the outlet manifold behind them. */
export const FERMENT_INLET_Z_M = -45.2;
export const FERMENT_INLET_Y_M = 1.4;
export const FERMENT_OUTLET_Z_M = -50.6;

/** Stage 14: the smoothing valve, the plate cooler, the fruit tank and its pump, and the P8 buffer. */
export const SMOOTHING_VALVE: Footprint = { xM: -11.5, zM: LINE_Z_M };
export const COOLER = { xM: -9, zM: LINE_Z_M, lengthM: 1.2, depthM: 0.5, heightM: 1.3 } as const;
export const FRUIT_TANK = { xM: -9, zM: -52, radiusM: 0.7, legsM: 0.4, bodyM: 1.4 } as const;
export const BUFFER = { xM: -5.5, zM: LINE_Z_M, radiusM: 0.95, legsM: 0.5, bodyM: 1.6 } as const;

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
export const BLAST_CHILLER = { xMinM: 30, xMaxM: 36.4, zMinM: -44.6, zMaxM: -41.8, heightM: 2.8 } as const;
export const COLD_ROOM = { xMinM: 19.6, xMaxM: 36.4, zMinM: -55.6, zMaxM: -50.2, wallM: 4 } as const;
/** The cold room's dock doors, in its north wall, facing the reefer yard (layout.ts REEFER_YARD). */
export const DOCK_DOORS_X_M = [23.5, 28, 32.5] as const;

/** A point on the process line at the pipe height. */
export const onLine = (xM: number): PointM => [xM, PIPE_Y_M, LINE_Z_M];
