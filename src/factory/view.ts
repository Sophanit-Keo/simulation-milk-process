// Phase 9 contracts, the headless half: what the Factory board reads from Let Report, and what it draws (D19).
// The factory's layout lives in Let Report: each production line names the UHT that feeds it, its filler, the
// filler's speed and the pack size, and the plan lists the UHTs with their capacity. The board mirrors it live:
// a line shows what Let Report says, as soon as it changes, and adds nothing of its own.
//
// Phase 10 adds the factory floor in 3D (D20): where each UHT, tank, filler and pipe stands, laid out from the
// same view (layout.ts), at the end of this file.
//
// `lead` owns this file. It runs headless (tsconfig.headless.json), with the model that builds the view
// (model.ts) and the floor's layout (layout.ts); the client's and the 3D view's contracts, which need the
// browser, are in types.ts, which re-exports this file.
import type { Status } from '../contracts';

// ───── What Let Report holds (its REST rows, only the columns the board reads) ─────

/** A production line's status in Let Report (migration 0002). */
export type LineStatus = 'running' | 'stopped' | 'cleaning' | 'changeover' | 'maintenance' | 'idle';

export const LINE_STATUSES: readonly LineStatus[] = ['running', 'stopped', 'cleaning', 'changeover', 'maintenance', 'idle'];

/** A `production_lines` row. The columns after `status_since` came with later migrations, so any may be missing. */
export interface LineRow {
  id: string;
  name: string;
  /** 'UHT', 'SCM', 'Yogurt' or 'Other'. */
  type: string;
  product: string;
  /** Today's output, as people type it in Let Report. */
  qty: number;
  target: number;
  status: LineStatus;
  sort: number;
  /** ISO time of the last status change. */
  status_since?: string | null;
  /** The lot running now; '' for none (migration 0008). */
  lot?: string;
  lot_started_at?: string | null;
  /** The planned end of the CIP while the status is 'cleaning' (migration 0008). */
  cip_until?: string | null;
  /** The UHT that feeds the line, a name from `uht_units`; '' for none (migration 0013). */
  uht?: string;
  /** The filler model: 'TFA', 'TBA/19', 'TBA/22', 'A3/Speed' or another; '' for none (migration 0013). */
  filler?: string;
  /** The filler's speed (migration 0013). */
  filler_packs_per_h?: number | null;
  /** The pack size (migration 0013). */
  pack_ml?: number | null;
}

/** One UHT plant of the factory, as `factory_settings.uht_units` lists it (migration 0013). */
export interface UhtUnitRow {
  name: string;
  capacityLph: number;
}

/** The `factory_settings` row (there is one). */
export interface SettingsRow {
  site_name?: string;
  uht_units?: UhtUnitRow[] | null;
}

/** An open report (a trouble): where it is and how serious. `loc` is a line's name or a place. */
export interface ReportRow {
  id: string;
  loc: string;
  /** 0 low to 3 critical. */
  sev: number;
  /** 'open', 'action' or 'verify': the board reads only reports that are not closed. */
  status: string;
}

/** Everything the board reads from Let Report, as last read. */
export interface FactoryData {
  lines: LineRow[];
  settings: SettingsRow | null;
  reports: ReportRow[];
}

// ───── What the board draws (model.ts builds it; board.ts draws it) ─────

export interface LineView {
  id: string;
  name: string;
  /** '' when Let Report gives none. */
  filler: string;
  packsPerH: number | null;
  packMl: number | null;
  /** packs/h × ml ÷ 1,000; null when the speed or the pack size is missing. */
  ratedLph: number | null;
  /** What it draws from its UHT now: ratedLph while running, otherwise 0. */
  drawLph: number;
  status: LineStatus;
  lamp: Status;
  /** "Running", "Stopped", "Maintenance", "Changeover", "Idle", or "CIP · 1 h 10 min left" ("CIP · overdue"). */
  statusText: string;
  product: string;
  lot: string;
  /** Seconds since the lot started; null with no lot or no start time. */
  lotRunS: number | null;
  /** Seconds of CIP left while cleaning with a planned end, 0 once overdue; otherwise null. */
  cipLeftS: number | null;
  qty: number;
  target: number;
  /** Reports at this line (loc = its name) that are not closed. */
  openTroubles: number;
  /** The most serious of them, 0–3; null with none. */
  worstSev: number | null;
}

export type UhtState = 'producing' | 'cip' | 'stopped';

export interface UhtView {
  name: string;
  capacityLph: number;
  /** The sum of its lines' drawLph. */
  drawLph: number;
  /** drawLph ÷ capacityLph × 100; 0 when the capacity is not above 0. */
  loadPct: number;
  /** Its lines draw more than it makes. */
  overCapacity: boolean;
  /** Producing while any of its lines runs; CIP when it has lines and all are cleaning; otherwise stopped. */
  state: UhtState;
  /** ok producing (warn when over capacity), idle in CIP, bad stopped with lines, idle with no lines. */
  lamp: Status;
  /** "Producing · 5,550 of 8,000 L/h", "CIP", "Stopped", "No lines". */
  stateText: string;
  /** In Let Report's order: by `sort`, then by name. */
  lines: LineView[];
}

export interface FactoryView {
  /** Let Report's site name; '' when it has none. */
  siteName: string;
  /** In the order of `uht_units`. */
  uhts: UhtView[];
  /** UHT lines (type 'UHT') whose `uht` names none of the UHTs, in Let Report's order. */
  unassigned: LineView[];
  /** Lines running in all, and their total draw. */
  runningLines: number;
  totalDrawLph: number;
}

/** model.ts: the board's view of what Let Report holds, at the time `nowMs` (for the CIP and lot clocks). */
export type BuildFactory = (data: FactoryData, nowMs: number) => FactoryView;

// ───── Phase 10: the factory floor in 3D (layout.ts lays it out from the view; scene/ draws it) ─────
//
// The floor follows Let Report as the board does: a bay per UHT, in the order of `uht_units`, with the UHT
// plant at the back, its aseptic tank in front of it and one filler per line in a row, each on its outfeed
// belt; the lines no UHT claims stand in a bay of their own, last. Its sizes are the sim assumptions of D20.

/**
 * A point on the floor in metres (1 three.js unit = 1 m): x along the hall, the bays left to right; y up;
 * z from the UHT plants at the back (−z) to the ends of the belts at the front (+z).
 */
export type FloorPointM = readonly [xM: number, yM: number, zM: number];

/** A rectangle on the floor. */
export interface FloorRectM {
  xMinM: number;
  xMaxM: number;
  zMinM: number;
  zMaxM: number;
}

/** Where the camera goes for a bay or a machine: the point it looks at, and its place relative to that point. */
export interface CameraStopM {
  targetM: FloorPointM;
  offsetM: FloorPointM;
}

/** The filler models the floor knows by size (D20); any other name, or none, is 'other'. */
export type FillerKind = 'TFA' | 'TBA/19' | 'TBA/22' | 'A3/Speed' | 'other';

export const FILLER_KINDS: readonly FillerKind[] = ['TFA', 'TBA/19', 'TBA/22', 'A3/Speed', 'other'];

/** One line's filler and its outfeed belt. */
export interface FillerSpot {
  /** The line it draws (LineView.id and name). */
  lineId: string;
  name: string;
  kind: FillerKind;
  /** The one roll-fed filler model, drawn at this scale: 1 for a TBA/19. */
  scale: number;
  /** The middle of the filler's footprint, on the floor; its outfeed faces +z. */
  centreM: FloorPointM;
  widthM: number;
  depthM: number;
  heightM: number;
  /** Where its product pipe comes in: its back (−z) face. */
  inletM: FloorPointM;
  /** The outfeed belt, from the filler's front face along +z, its top at the height of `fromM`. */
  belt: { fromM: FloorPointM; toM: FloorPointM; widthM: number };
  /** Its label's anchor, just above it. */
  labelM: FloorPointM;
  camera: CameraStopM;
}

/** A UHT plant, drawn as one skid. */
export interface UhtSpot {
  name: string;
  capacityLph: number;
  /** The middle of the skid's footprint, on the floor; its product outlet faces +z. */
  centreM: FloorPointM;
  /** Along x, along z, and up. */
  lengthM: number;
  depthM: number;
  heightM: number;
  /** Where the sterile product leaves it, on its front face. */
  outletM: FloorPointM;
  labelM: FloorPointM;
  camera: CameraStopM;
}

/** The UHT's aseptic tank, between it and its fillers. Let Report holds no level, so it is drawn closed. */
export interface TankSpot {
  /** The middle of its footprint, on the floor. */
  centreM: FloorPointM;
  radiusM: number;
  /** To the top of its dome. */
  heightM: number;
  inletM: FloorPointM;
  outletM: FloorPointM;
}

/**
 * 'uht' runs from the UHT to its tank; 'header' from the tank along the row of fillers; 'line' is one line's
 * drop from the header into its filler.
 */
export type PipeKind = 'uht' | 'header' | 'line';

export interface PipeRoute {
  /**
   * Unique on the floor, by place rather than by name, so two UHTs Let Report names alike still get two:
   * 'uht:<bay>', 'header:<bay>' and 'line:<bay>:<filler>', the indexes in `bays` and in the bay's `fillers`.
   */
  id: string;
  kind: PipeKind;
  /** For a 'line' pipe, the index in its bay's `fillers` of the filler it feeds; null otherwise. */
  filler: number | null;
  /** One or more runs of straight pieces, each in flow order (the header's two arms leave its tee). */
  paths: readonly (readonly FloorPointM[])[];
  radiusM: number;
}

export interface BayLayout {
  /** The UHT's name; '' for the bay of the lines no UHT claims. */
  uhtName: string;
  /** Written on the floor in front of the bay: "UHT 2 · 8,000 L/h", or "Not assigned to a UHT". */
  title: string;
  titleM: FloorPointM;
  rect: FloorRectM;
  /** Both null in the bay of the lines no UHT claims. */
  uht: UhtSpot | null;
  tank: TankSpot | null;
  /** In the view's order, left to right. */
  fillers: FillerSpot[];
  /** None in the bay of the lines no UHT claims, and no header in a bay without lines. */
  pipes: PipeRoute[];
  camera: CameraStopM;
}

export interface FactoryLayout {
  /**
   * Changes only when the floor must be built again: a UHT added, removed, renamed or resized, a line added,
   * removed or moved, or a filler of another kind. A change of status leaves it alone.
   */
  key: string;
  /** In the order of `uht_units`, then the bay of the lines no UHT claims, if any. */
  bays: BayLayout[];
  /** Everything on the floor, bays and belts; centred on x = 0. */
  bounds: FloorRectM;
  /** The tallest thing on the floor. */
  heightM: number;
  /** The whole factory from the front: the camera looks at `targetM` from `direction` and fits `halfWidthM` across the view. */
  overview: { targetM: FloorPointM; direction: FloorPointM; halfWidthM: number };
}

/** layout.ts: where everything on the factory floor stands, from the board's view. Pure, like buildFactory. */
export type LayoutFactory = (view: FactoryView) => FactoryLayout;

/**
 * What one bay draws, in the order of `FactoryLayout.bays` (layout.ts, floorBays): its UHT, null in the bay of
 * the lines no UHT claims, and its lines, in the order of the bay's `fillers`. The floor matches its machines
 * to the view by these places, never by name.
 */
export interface FloorBay {
  uht: UhtView | null;
  lines: readonly LineView[];
}

/** What flows in a pipe now: milk at the draw it carries, or the cleaning fluid. */
export interface PipeFlow {
  /** The L/h it carries: a line's draw, or its UHT's; 0 while nothing runs. */
  flowLph: number;
  /** In CIP: a line's drop while the line cleans, the UHT's pipe and header while the UHT does. */
  cleaning: boolean;
}

/** A belt's packs: riding it while the line runs, standing on it while stopped, none while it cleans, changes over or idles. */
export type BeltState = 'moving' | 'still' | 'empty';
