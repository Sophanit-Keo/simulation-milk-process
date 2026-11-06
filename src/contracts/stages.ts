/** The 10 stages of the UHT line (plan 02). */
export type UhtStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** The 6 stages of the yogurt line, Line P8 (plan 12, D25; contracts v8): mix to cold chain. */
export type YogurtStageId = 11 | 12 | 13 | 14 | 15 | 16;

/** Every stage of the plant: the UHT line's 1–10 and the yogurt line's 11–16 (contracts v8). */
export type StageId = UhtStageId | YogurtStageId;

/** The plant's two lines (contracts v8): UHT milk, stages 1–10, and yogurt on Line P8, stages 11–16. */
export type LineId = 'uht' | 'yogurt';

export const LINE_IDS: readonly LineId[] = ['uht', 'yogurt'];

/** The lines' names, as the stage rail groups them (plan 12, D25). */
export const LINE_NAMES: Readonly<Record<LineId, string>> = { uht: 'UHT milk', yogurt: 'Yogurt P8' };

export const UHT_STAGE_IDS: readonly UhtStageId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const YOGURT_STAGE_IDS: readonly YogurtStageId[] = [11, 12, 13, 14, 15, 16];

/** Each line's stages, in flow order (contracts v8). */
export const STAGE_IDS_BY_LINE: Readonly<{ uht: readonly UhtStageId[]; yogurt: readonly YogurtStageId[] }> = {
  uht: UHT_STAGE_IDS,
  yogurt: YOGURT_STAGE_IDS,
};

/** Every stage, the UHT line's then the yogurt line's: the keys of Snapshot.stages, in order. */
export const STAGE_IDS: readonly StageId[] = [...UHT_STAGE_IDS, ...YOGURT_STAGE_IDS];

export const isUhtStage = (id: StageId): id is UhtStageId => id <= 10;

/** The line a stage belongs to (contracts v8). */
export const lineOfStage = (id: StageId): LineId => (isUhtStage(id) ? 'uht' : 'yogurt');

/** Lamp colours used everywhere (plan 08): green running, amber hold or warning, red stopped or blocked. */
export type Status = 'ok' | 'warn' | 'bad' | 'idle';

/** Speed presets of the top bar (plan 06): ×1 to ×10,000. */
export type Speed = 1 | 10 | 100 | 1_000 | 10_000;

export const SPEEDS: readonly Speed[] = [1, 10, 100, 1_000, 10_000];

export const isSpeed = (value: number): value is Speed => (SPEEDS as readonly number[]).includes(value);

/**
 * The zones of the floor plan (plan 05), in flow order: the U-shaped milk row's seven, then the yogurt wing's four,
 * a row north of it (plan 12, D25; contracts v8).
 */
export type ZoneId =
  | 'silo'
  | 'process'
  | 'aseptic'
  | 'filling'
  | 'packaging'
  | 'quarantine'
  | 'warehouse'
  | 'yogurtMix'
  | 'yogurtProcess'
  | 'p8'
  | 'coldChain';

export const UHT_ZONE_IDS: readonly ZoneId[] = ['silo', 'process', 'aseptic', 'filling', 'packaging', 'quarantine', 'warehouse'];

export const YOGURT_ZONE_IDS: readonly ZoneId[] = ['yogurtMix', 'yogurtProcess', 'p8', 'coldChain'];

export const ZONE_IDS: readonly ZoneId[] = [...UHT_ZONE_IDS, ...YOGURT_ZONE_IDS];

/** Zone names as the floor plans have them (plan 05, plan 12). The 3D zone labels and the info panel both show these. */
export const ZONE_NAMES: Readonly<Record<ZoneId, string>> = {
  silo: 'Silo yard & mixing',
  process: 'UHT process hall',
  aseptic: 'Aseptic tank',
  filling: 'Filling hall',
  packaging: 'Packaging hall',
  quarantine: 'Quarantine & QA lab',
  warehouse: 'Warehouse & dispatch',
  yogurtMix: 'Yogurt mix room',
  yogurtProcess: 'Yogurt process hall',
  p8: 'Cup filling room (Line P8)',
  coldChain: 'Incubation & cold store',
};

/**
 * Measuring points along the liquid line (plan 02, "Chart values as text"), in flow order: the UHT line's twelve,
 * then the yogurt line's nine (plan 12; contracts v8), from its own silo to the P8 filler's manifold.
 * The 3D view colours each pipe from the point it leaves; phase 3 makes the UHT values live, phase 17 the yogurt's.
 */
export type UhtLinePointId =
  | 'silo'
  | 'separator'
  | 'feedTank'
  | 'preheater'
  | 'deaerator'
  | 'homogenizer'
  | 'holdingTube'
  | 'divert'
  | 'flashVessel'
  | 'cooler'
  | 'asepticTank'
  | 'filler';

export type YogurtLinePointId =
  | 'ySilo'
  | 'yMixTank'
  | 'yHeater'
  | 'yHoldingCell'
  | 'yInoculation'
  | 'yFermentTank'
  | 'yCooler'
  | 'p8Buffer'
  | 'p8Filler';

export type LinePointId = UhtLinePointId | YogurtLinePointId;

export const UHT_LINE_POINT_IDS: readonly UhtLinePointId[] = [
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
];

export const YOGURT_LINE_POINT_IDS: readonly YogurtLinePointId[] = [
  'ySilo',
  'yMixTank',
  'yHeater',
  'yHoldingCell',
  'yInoculation',
  'yFermentTank',
  'yCooler',
  'p8Buffer',
  'p8Filler',
];

/** Each line's measuring points, in flow order (contracts v8). */
export const LINE_POINT_IDS_BY_LINE: Readonly<{ uht: readonly UhtLinePointId[]; yogurt: readonly YogurtLinePointId[] }> = {
  uht: UHT_LINE_POINT_IDS,
  yogurt: YOGURT_LINE_POINT_IDS,
};

/** Every measuring point: the keys of Snapshot.line. */
export const LINE_POINT_IDS: readonly LinePointId[] = [...UHT_LINE_POINT_IDS, ...YOGURT_LINE_POINT_IDS];

/** How the info panel shows one live value of a stage (src/data/stages.json). */
export interface StageValueInfo {
  /** Key in StageSnapshot.values, e.g. 'outletTempC'. */
  key: string;
  label: string;
  /** Display unit such as '°C', 'L/h' or '%'; '' for plain counts. */
  unit: string;
  decimals: number;
  /** Multiplier before display, e.g. 100 to show a fraction as %. Defaults to 1. */
  scale?: number;
}

/** One entry of src/data/stages.json, written by `process` from the stage research (plan 03, 04). */
export interface StageInfo {
  id: StageId;
  /** Full name, e.g. 'Standardization & Formulation'. */
  name: string;
  /** Rail label, e.g. 'Standardization'. */
  shortName: string;
  zone: ZoneId;
  /** One plain sentence for the info panel. */
  description: string;
  values: StageValueInfo[];
  /** Two lines for the guided tour (phase 5). */
  tourCaption: [string, string];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Checks stages.json and returns it typed, one entry per stage in stage order; throws listing every problem. */
export function parseStages(raw: unknown): StageInfo[] {
  const problems: string[] = [];
  if (!Array.isArray(raw)) throw new Error('stages.json must be an array');
  const byId = new Map<number, StageInfo>();
  raw.forEach((entry: unknown, index) => {
    const at = `stages.json[${index}]`;
    if (!isRecord(entry)) return void problems.push(`${at} is not an object`);
    const { id, name, shortName, zone, description, values, tourCaption } = entry;
    if (!STAGE_IDS.includes(id as StageId)) problems.push(`${at}.id must be a stage 1–16`);
    else if (byId.has(id as number)) problems.push(`${at}.id ${String(id)} appears twice`);
    for (const [field, value] of Object.entries({ name, shortName, description })) {
      if (!isText(value)) problems.push(`${at}.${field} must be non-empty text`);
    }
    if (!ZONE_IDS.includes(zone as ZoneId)) problems.push(`${at}.zone must be one of ${ZONE_IDS.join(', ')}`);
    if (!Array.isArray(tourCaption) || tourCaption.length !== 2 || !tourCaption.every(isText)) {
      problems.push(`${at}.tourCaption must be two lines of text`);
    }
    if (!Array.isArray(values)) problems.push(`${at}.values must be an array`);
    else {
      values.forEach((value: unknown, i) => {
        const vat = `${at}.values[${i}]`;
        if (!isRecord(value) || !isText(value.key) || !isText(value.label) || typeof value.unit !== 'string') {
          problems.push(`${vat} needs key, label and unit`);
        } else if (!Number.isInteger(value.decimals) || (value.decimals as number) < 0) {
          problems.push(`${vat}.decimals must be a whole number ≥ 0`);
        } else if (value.scale !== undefined && !(typeof value.scale === 'number' && Number.isFinite(value.scale))) {
          problems.push(`${vat}.scale must be a finite number`);
        }
      });
    }
    if (STAGE_IDS.includes(id as StageId) && !byId.has(id as number)) byId.set(id as number, entry as unknown as StageInfo);
  });
  for (const id of STAGE_IDS) if (!byId.has(id)) problems.push(`stages.json has no entry for stage ${id}`);
  if (problems.length > 0) throw new Error(`src/data/stages.json is not usable:\n${problems.join('\n')}`);
  return STAGE_IDS.map((id) => byId.get(id) as StageInfo);
}
