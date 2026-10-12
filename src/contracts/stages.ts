/** The 10 stages of the UHT line (plan 02). */
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const STAGE_IDS: readonly StageId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Lamp colours used everywhere (plan 08): green running, amber hold or warning, red stopped or blocked. */
export type Status = 'ok' | 'warn' | 'bad' | 'idle';

/** Speed presets of the top bar (plan 06): ×1 to ×10,000. */
export type Speed = 1 | 10 | 100 | 1_000 | 10_000;

export const SPEEDS: readonly Speed[] = [1, 10, 100, 1_000, 10_000];

export const isSpeed = (value: number): value is Speed => (SPEEDS as readonly number[]).includes(value);

/** The seven zones of the U-shaped floor plan (plan 05), in milk-flow order. */
export type ZoneId = 'silo' | 'process' | 'aseptic' | 'filling' | 'packaging' | 'quarantine' | 'warehouse';

export const ZONE_IDS: readonly ZoneId[] = ['silo', 'process', 'aseptic', 'filling', 'packaging', 'quarantine', 'warehouse'];

/**
 * Measuring points along the liquid line (plan 02, "Chart values as text"), in flow order.
 * The 3D view colours each pipe from the point it leaves; phase 3 makes the values live.
 */
export type LinePointId =
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

export const LINE_POINT_IDS: readonly LinePointId[] = [
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
    if (!STAGE_IDS.includes(id as StageId)) problems.push(`${at}.id must be a stage 1–10`);
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
