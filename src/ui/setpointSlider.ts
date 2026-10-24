import { SETPOINT_RANGES, type Command, type SetpointKey, type Snapshot, type StageId } from '../contracts';
import { el, setAttr, setText } from './dom';
import { formatNumber, withUnit } from './format';
import type { PanelPart } from './stagePanel';

export interface SetpointSpec {
  key: SetpointKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /**
   * The stage value that reports the set point the sim runs on, which the slider follows between drags.
   * Without one the slider shows the last value sent (the homogenizer reports its pressure, not its set point).
   */
  follow?: string;
}

/** The set points plan 08 puts in the panel: the UHT temperature (stage 4) and the homogenizer pressure (stage 3). */
export const SETPOINT_SLIDERS: Readonly<Partial<Record<StageId, SetpointSpec>>> = {
  3: { key: 'homogenizerStage1Bar', label: 'First-stage pressure', unit: 'bar', ...SETPOINT_RANGES.homogenizerStage1Bar, step: 5, decimals: 0 },
  4: { key: 'uhtSetpointC', label: 'UHT set point', unit: '°C', ...SETPOINT_RANGES.uhtSetpointC, step: 0.1, decimals: 1, follow: 'setpointC' },
};

/** The nearest value on the slider's steps, inside its range, without float dust (130 + 99 × 0.1 is 139.9, not 139.90000000000001). */
export function snapToStep(value: number, spec: Pick<SetpointSpec, 'min' | 'max' | 'step' | 'decimals'>): number {
  if (!Number.isFinite(value)) return spec.min;
  const steps = Math.round((Math.min(spec.max, Math.max(spec.min, value)) - spec.min) / spec.step);
  return Number((spec.min + steps * spec.step).toFixed(spec.decimals));
}

/** A set point as the slider shows it: "140.0 °C", "200 bar". */
export const setpointText = (value: number, spec: Pick<SetpointSpec, 'unit' | 'decimals'>): string =>
  withUnit(formatNumber(value, spec.decimals), spec.unit);

/**
 * A set-point slider in the info panel: a labelled range input with its value on show, which sends
 * setSetpoint when the viewer lets go of it (a release, or each arrow or Page key), not on every pixel of a
 * drag, so a drag through the divert limit doesn't divert on the way.
 *
 * Between drags it follows the sim (the stage value named by `follow`), so it always shows the set point
 * the plant runs on. While the pointer holds it, or a value is chosen but not yet sent, the HUD's 4 Hz
 * refresh leaves it alone. After a mouse drag it hands focus back to the page, so Space pauses again,
 * as the top bar's buttons do; a keyboard user keeps focus on it.
 *
 * `sent` gives the last value sent for this key (the HUD remembers it while panels come and go).
 */
export function createSetpointSlider(
  host: HTMLElement,
  stage: StageId,
  spec: SetpointSpec,
  dispatch: (command: Command) => void,
  sent: () => number | undefined,
): PanelPart {
  const id = `setpoint-${spec.key}`;
  const box = el('div', 'setpoint');
  const head = el('div', 'sp-head');
  const label = el('label', '', spec.label);
  label.htmlFor = id;
  const output = el('output', 'sp-value');
  output.htmlFor.add(id);
  output.dataset.testid = `${id}-value`;
  // An <output> is a live region; the slider already speaks its value (aria-valuetext), so say it once.
  output.setAttribute('aria-hidden', 'true');
  head.append(label, output);

  const input = el('input', 'sp-range');
  input.type = 'range';
  input.id = id;
  input.dataset.testid = id;
  input.dataset.stage = String(stage);
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);

  const ends = el('div', 'sp-ends');
  ends.setAttribute('aria-hidden', 'true'); // the input itself has min and max
  ends.append(el('span', '', setpointText(spec.min, spec)), el('span', '', setpointText(spec.max, spec)));
  box.append(head, input, ends);
  host.append(box);

  const listeners = new AbortController();
  const { signal } = listeners;
  let held = false;
  let byPointer = false;
  /** A value the viewer has moved to but not let go of yet. */
  let pending: number | null = null;

  function show(value: number): void {
    const text = setpointText(value, spec);
    if (input.value !== String(value)) input.value = String(value);
    setAttr(input, 'aria-valuetext', text);
    setText(output, text);
  }
  // Something on show before the first snapshot: the last value sent, or the middle of the range.
  show(snapToStep(sent() ?? (spec.min + spec.max) / 2, spec));

  input.addEventListener(
    'pointerdown',
    () => {
      held = true;
      byPointer = true;
    },
    { signal },
  );
  // On the document: the pointer may be let go of anywhere once the drag has left the slider. A drag that
  // ends where it began fires no change event, so the move it left pending is dropped here too (a change
  // that does follow comes in the same task and still sends its value).
  for (const type of ['pointerup', 'pointercancel'] as const) {
    input.ownerDocument.addEventListener(
      type,
      () => {
        held = false;
        pending = null;
      },
      { signal },
    );
  }
  input.addEventListener(
    'keydown',
    () => {
      byPointer = false;
    },
    { signal },
  );
  input.addEventListener(
    'input',
    () => {
      pending = snapToStep(Number(input.value), spec);
      show(pending);
    },
    { signal },
  );
  input.addEventListener(
    'change',
    () => {
      const value = snapToStep(Number(input.value), spec);
      pending = null;
      held = false;
      show(value);
      dispatch({ type: 'setSetpoint', key: spec.key, value });
      if (byPointer) input.blur();
    },
    { signal },
  );

  return {
    update(snapshot: Snapshot) {
      if (held || pending !== null) return;
      const followed = spec.follow === undefined ? undefined : snapshot.stages[stage]?.values[spec.follow];
      const value = followed ?? sent();
      if (value !== undefined && Number.isFinite(value)) show(snapToStep(value, spec));
    },
    dispose() {
      listeners.abort();
      box.remove();
    },
  };
}
