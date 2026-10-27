// Where stages 7–10 stand, ported from uht-plant-preview.html ("stage 7" to "stage 10" blocks): one table
// of positions and paths, so phase 4's moving packs, trays, pallets and trucks can follow the same lines.
// World metres (1 unit = 1 m); x along the milk flow, y up, z from the milk row (-z) to the docks (+z).
import type { PointM } from '../../layout';

/** A point on the floor plan: [x, z] in metres. */
export type FloorPointM = readonly [xM: number, zM: number];

/* stage 7: two aseptic fillers */

/** The fillers' centre line along z: filler A on the back row, B nearer the camera (preview filler3D). */
export const FILLER_Z_M = { a: -17.5, b: -10.5 } as const;
export const FILLER_X_M = 20;
/** The cabinet's +x face, where the packs leave the outfeed onto the belt. */
export const FILLER_FACE_X_M = 21.6;
/** Where the product pipe from the aseptic tank enters the filler (preview OUT_A and OUT_B, last point). */
export const FILLER_INLET_M = { xM: 19.7, yM: 2.5 } as const;

/* conveyors (stages 7–8) */

/** Height of the belt surface the packs ride on (preview BELT). */
export const BELT_M = 0.86;

/** The pack lines from each filler to the tray packer, along the belt centre (preview LINE_A, LINE_B). */
export const LINE_A: readonly PointM[] = [
  [21.75, BELT_M, -17.5],
  [34, BELT_M, -17.5],
  [34, BELT_M, 4.9],
];
export const LINE_B: readonly PointM[] = [
  [21.75, BELT_M, -10.5],
  [32, BELT_M, -10.5],
  [32, BELT_M, 4.9],
];
/** Trays from the shrink tunnel to the palletizer's pick point (preview TRAY_LINE). */
export const TRAY_LINE: readonly PointM[] = [
  [33, BELT_M, 8.4],
  [33, BELT_M, 11.2],
  [29.85, BELT_M, 11.2],
];

/**
 * The accumulation table, which the plan's asset list asks for and the preview lacks: both pack lines
 * cross it on their way down to the tray packer, where it buffers packs while the packer catches up.
 * It stands on the last stretch of the filling hall, clear of line B's corner.
 */
export const ACCUMULATION_TABLE = { xMinM: 31.3, xMaxM: 34.7, zMinM: -8.5, zMaxM: -5.5 } as const;

/** Tray-shrink tunnel, which the pack lines enter on its -z face and the tray line leaves on +z. */
export const TUNNEL = { centreM: [33, 0.95, 6.65] as PointM, sizeM: [3.6, 1.7, 3.3] as const };
const TUNNEL_IN_Z_M = TUNNEL.centreM[2] - TUNNEL.sizeM[2] / 2;
const TUNNEL_OUT_Z_M = TUNNEL.centreM[2] + TUNNEL.sizeM[2] / 2;

/** Belt widths, side rail to side rail. The kit's pieces are 1.0 m wide; they scale to these. */
export const PACK_BELT_WIDTH_M = 0.85;
export const TRAY_ROLLER_WIDTH_M = 0.8;
export const PALLET_ROLLER_WIDTH_M = 1.3;

/**
 * The belt runs the conveyors are built from: each path is a centre line from where the belt starts to
 * where it ends, turning at its inner points. The pack lines start at the filler cabinets and stop at the
 * accumulation table and the tunnel; the packs' own paths (LINE_A, LINE_B) run straight across both.
 */
export const PACK_BELT_PATHS: readonly (readonly FloorPointM[])[] = [
  [[FILLER_FACE_X_M, -17.5], [34, -17.5], [34, ACCUMULATION_TABLE.zMinM]],
  [[34, ACCUMULATION_TABLE.zMaxM], [34, TUNNEL_IN_Z_M]],
  [[FILLER_FACE_X_M, -10.5], [32, -10.5], [32, ACCUMULATION_TABLE.zMinM]],
  [[32, ACCUMULATION_TABLE.zMaxM], [32, TUNNEL_IN_Z_M]],
];
/** Tray rollers from the tunnel's exit, past the pick point so a tray stops under the gripper. */
export const TRAY_ROLLER_PATHS: readonly (readonly FloorPointM[])[] = [[[33, TUNNEL_OUT_Z_M], [33, 11.2], [29.3, 11.2]]];

/* palletizer, stretch wrapper, pallet rollers (stage 8) */

export const PALLETIZER_M: PointM = [28.3, 0, 13.2];
/** Height of the arm's hinge on top of the column (preview arm group). */
export const ARM_HINGE_Y_M = 2.35;
/** Where the arm picks trays (the tray line's end) and puts them down (the pallet being built). */
export const PICK_M: FloorPointM = [29.85, 11.2];
export const PLACE_M: FloorPointM = [26.2, 14.4];
/** The stretch wrapper's turntable (preview), on the pallet line. */
export const WRAPPER_M: FloorPointM = [21.6, 14.4];
export const TURNTABLE_RADIUS_M = 1.05;

/** Pallets ride on low rollers this high, from under the palletizer through the wrapper to the hall's edge. */
export const PALLET_ROLLER_TOP_M = 0.25;
export const PALLET_ROLLER_PATHS: readonly (readonly FloorPointM[])[] = [
  [[27.2, 14.4], [WRAPPER_M[0] + TURNTABLE_RADIUS_M, 14.4]],
  [[WRAPPER_M[0] - TURNTABLE_RADIUS_M, 14.4], [14.4, 14.4]],
];

/* stage 9: quarantine and QA lab */

/** The quarantine floor area inside its border (preview hatch line). */
export const QUARANTINE = { xMinM: -10.9, xMaxM: 7.2, zMinM: 3.0, zMaxM: 17.6 } as const;
/** Pallet blocks wait in rows (preview slot()): row k centred at zM = 4.6 + 3.8 k, 3.0 m deep. */
export const QUARANTINE_ROW_Z_M = [4.6, 8.4, 12.2, 16.0] as const;
export const QA_LAB = { centreM: [9.4, 1.3, 5.6] as PointM, sizeM: [2.8, 2.6, 4.4] as const };
/** The sample incubators in front of the lab. */
export const INCUBATOR_X_M = [8.6, 9.4, 10.2] as const;
export const INCUBATOR_Z_M = 8.45;

/* stage 10: racks, docks, vehicles */

/** Rack rows (preview RACK_Z), bays per row (NBAY) and beam levels (LEVELS). */
export const RACK_Z_M = [4.9, 8.7, 12.5, 16.3] as const;
export const RACK_BAYS = 16;
export const RACK_BAY_M = 2.5;
export const RACK_X0_M = -61;
/** Beam centres; the ground level stands on the floor. */
export const RACK_BEAM_Y_M = [1.55, 3.15] as const;
export const RACK_HEIGHT_M = 4.5;
/** Uprights stand this far either side of a row's centre line. */
export const RACK_HALF_DEPTH_M = 0.55;

/** A pallet place in the racks: the pallet's centre seen from above (x, z) and the floor or beam top it stands on (y). */
export interface RackSlotM {
  xM: number;
  yM: number;
  zM: number;
}

/** Two pallets per bay (1.0 m faces, 1.2 m deep), three levels: floor and two beams. */
export const RACK_PALLET = { widthM: 1.0, heightM: 0.144, depthM: 1.2, loadHeightM: 1.1 } as const;

/** Every pallet place in the racks, level by level, row by row, bay by bay: phase 4 fills them in order. */
export function rackSlots(): RackSlotM[] {
  const beamHalfM = 0.06;
  const levelsM = [0, ...RACK_BEAM_Y_M.map((yM) => yM + beamHalfM)];
  const slots: RackSlotM[] = [];
  for (const yM of levelsM) {
    for (const zM of RACK_Z_M) {
      for (let bay = 0; bay < RACK_BAYS; bay++) {
        const bayMidM = RACK_X0_M + (bay + 0.5) * RACK_BAY_M;
        for (const offM of [-0.6, 0.6]) slots.push({ xM: bayMidM + offM, yM, zM });
      }
    }
  }
  return slots;
}

/** Dock doors along the warehouse's +z edge (preview DOORS). */
export const DOOR_X_M = [-54, -46, -38] as const;
export const DOOR_Z_M = 19.15;
/** A docked truck's tail stands this far out, in front of the door (preview truck at z 19.5). */
export const DOCKED_TAIL_Z_M = 19.6;
/**
 * Where trucks wait in the yard when every door is taken (phase 5: the demand spike and late trucks), side
 * by side on the apron east of the doors, level with the docked ones. More than these show as a number.
 */
export const YARD_X_M = [-30, -26.5, -23, -19.5] as const;

/** Outer sizes the vehicle models are fitted to: length × height × width. */
export const TRUCK_SIZE_M = { lengthM: 16.5, heightM: 4.0, widthM: 2.55 } as const;
export const FORKLIFT_SIZE_M = { lengthM: 3.5, heightM: 2.2, widthM: 1.2 } as const;
