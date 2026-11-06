// Stage 11's next-product picker (phase 17): the product the next shift makes, one button a product. A press sends
// setYogurtProduct; between presses it follows the snapshot's product.next, so it always shows what the sim will run.
import type { Command, Snapshot, YogurtProductId } from '../contracts';
import plantJson from '../data/plant.json';
import { el, onPress, setAttr, setText } from './dom';
import { formatSimTime } from './format';
import type { PanelPart } from './stagePanel';
import { PRODUCT_CHOICES } from './yogurtRows';

const FIRST_SHIFT_S = plantJson.quality.firstShiftStartS;
const SHIFT_S = plantJson.quality.batchS;

/** The sim time of the next shift change after `timeS` (06:00, 14:00, 22:00). */
export function nextShiftS(timeS: number): number {
  return FIRST_SHIFT_S + (Math.floor((timeS - FIRST_SHIFT_S) / SHIFT_S) + 1) * SHIFT_S;
}

/** A product's name on its button: plant.json's, without the " yogurt" every one ends with. */
const shortName = (name: string): string => name.replace(/ yogurt$/i, '');

export function createProductPicker(host: HTMLElement, dispatch: (command: Command) => void): PanelPart {
  const listeners = new AbortController();
  const { signal } = listeners;
  const box = el('section', 'next-product');
  box.dataset.testid = 'next-product';
  const title = el('h3', 'eyebrow', 'Next shift makes');
  title.id = 'next-product-title';
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', title.id);
  const buttons = new Map<YogurtProductId, HTMLButtonElement>();
  let shown: YogurtProductId | null = null;
  const show = (product: YogurtProductId | null): void => {
    if (product === shown) return;
    shown = product;
    for (const [id, button] of buttons) setAttr(button, 'aria-pressed', String(id === product));
  };
  for (const { id, name } of PRODUCT_CHOICES) {
    const button = el('button', 'btn', shortName(name));
    button.type = 'button';
    button.dataset.testid = `next-product-${id}`;
    button.title = `The next shift makes ${name.toLowerCase()}`;
    button.setAttribute('aria-pressed', 'false');
    onPress(
      button,
      () => {
        dispatch({ type: 'setYogurtProduct', product: id });
        show(id);
      },
      signal,
    );
    buttons.set(id, button);
    group.append(button);
  }
  const hint = el('p', 'hint');
  hint.dataset.testid = 'next-product-hint';
  box.append(title, group, hint);
  host.append(box);

  return {
    update(snapshot: Snapshot) {
      const yogurt = (snapshot as Partial<Snapshot>).yogurt;
      show(yogurt?.product.next ?? null);
      setText(hint, `From the shift change at ${formatSimTime(nextShiftS(snapshot.timeS))}; a rinse runs between two stirred products, a CIP and P8's SIP before set yogurt.`);
    },
    dispose() {
      listeners.abort();
      box.remove();
    },
  };
}
