import type { Status } from '../contracts';

/** A new element with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Writes text only when it differs, so a 4 Hz update leaves unchanged nodes (and selections in them) alone. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * Runs `action` on a click. After a mouse click the button hands focus back to the page, so
 * Space then pauses (hud.ts) instead of pressing the same button again; a keyboard press
 * (detail 0) keeps focus where the user put it.
 */
export function onPress(node: HTMLButtonElement, action: () => void, signal: AbortSignal): void {
  node.addEventListener(
    'click',
    (event) => {
      action();
      if (event.detail > 0) node.blur();
    },
    { signal },
  );
}

/** Sets an attribute, or removes it for null; only touches the DOM on a change. */
export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value);
  }
}

/** Lamp words for screen readers and tooltips, matching the colour rules of plan 08. */
export const STATUS_TEXT: Readonly<Record<Status, string>> = {
  ok: 'Running',
  warn: 'Warning',
  bad: 'Stopped',
  idle: 'Idle',
};

/**
 * A status lamp: a coloured dot whose colour comes from data-status (app.css), with its
 * meaning as an image label so the colour is never the only cue.
 */
export function createLamp(status: Status = 'idle'): HTMLSpanElement {
  const lamp = el('span', 'lamp');
  lamp.setAttribute('role', 'img');
  setLamp(lamp, status);
  return lamp;
}

export function setLamp(lamp: HTMLElement, status: Status): void {
  if (lamp.dataset.status === status) return;
  lamp.dataset.status = status;
  lamp.setAttribute('aria-label', STATUS_TEXT[status]);
}
