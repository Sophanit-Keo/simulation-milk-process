// Reads the snapshot for the liquid line's labels and motion. A value the sim doesn't send (an older
// or partial snapshot) reads as undefined, and its label shows nothing rather than "NaN".
import type { LinePointId, Snapshot, StageId } from '../../../contracts';

export function stageValue(snapshot: Snapshot, stage: StageId, key: string): number | undefined {
  const value = snapshot.stages[stage]?.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Flow through a measuring point of the line; 0 if the snapshot has none. */
export function lineFlowLph(snapshot: Snapshot, point: LinePointId): number {
  const flowLph = snapshot.line?.[point]?.flowLph;
  return typeof flowLph === 'number' && Number.isFinite(flowLph) ? flowLph : 0;
}

/** Milk temperature at a measuring point of the line; undefined if the snapshot has none. */
export function lineTempC(snapshot: Snapshot, point: LinePointId): number | undefined {
  const tempC = snapshot.line?.[point]?.tempC;
  return typeof tempC === 'number' && Number.isFinite(tempC) ? tempC : undefined;
}

const formats = new Map<number, Intl.NumberFormat>();

/**
 * A label value such as "60 °C", "16,000 L/h" or "50 %", in a fixed locale like the top bar, so the
 * labels read the same on every machine. '' when the value is missing.
 */
export function labelValue(value: number | undefined, decimals: number, unit: string): string {
  if (value === undefined) return '';
  let format = formats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formats.set(decimals, format);
  }
  // A small negative value rounds to "-0" (or "-0.0"); show it unsigned.
  const text = format.format(value).replace(/^-(?=0(\.0+)?$)/, '');
  return unit ? `${text} ${unit}` : text;
}
