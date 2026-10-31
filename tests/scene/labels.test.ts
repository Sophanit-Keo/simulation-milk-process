import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The zone names are text drawn straight on the floor and the apron, with no backing (zones.ts puts them just
// in front of each zone), so WCAG 1.4.3 AA applies: 4.5:1 for text of their size (12.5 px and 12 px).
// Checked on the colour tokens of every theme block in tokens.css, as labels.css uses them.

/** WCAG AA for normal-size text. */
const AA = 4.5;
/**
 * The scene's lights shade the floor, so a name stands on a colour near its token, not on the token itself.
 * Measured at the overview (1440 × 900), in relative luminance: in the light theme the floor and the apron
 * render about 12 % darker than their tokens (#ccd6dc as #c1cad0, #b9c3ca as #afb9bf), in the dark theme
 * 28 % and 54 % lighter (#1a252d as #222a31, #141d23 as #1f2529). The check takes the background anywhere
 * from a quarter darker to three quarters lighter than its token.
 */
const LIT_RANGE = [0.75, 1.75] as const;

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = read('../../src/styles/tokens.css');
const LABELS = read('../../src/scene/labels.css');

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = start + selector.length + 2;
  return css.slice(open, css.indexOf('}', open));
}

function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** Every theme: the light tokens, and the light ones overridden by each of the two dark blocks. */
const light = declarations(rule(TOKENS, ':root'));
const THEMES = [
  { name: 'light', tokens: light },
  { name: 'dark (OS setting)', tokens: new Map([...light, ...declarations(rule(TOKENS, ':root:not([data-theme="light"])'))]) },
  { name: 'dark (data-theme)', tokens: new Map([...light, ...declarations(rule(TOKENS, ':root[data-theme="dark"]'))]) },
];

/** A colour value as a #rrggbb hex, following var() through the theme's tokens. */
function resolve(value: string, tokens: Map<string, string>): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (!reference) return value;
  const token = tokens.get(reference[1]);
  if (token === undefined) throw new Error(`no token ${reference[1]}`);
  return resolve(token, tokens);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((channel) => {
    const c = parseInt(channel, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('zone names', () => {
  const name = declarations(rule(LABELS, '.zone-label'));
  const stages = declarations(rule(LABELS, '.zone-label em'));

  it.each(THEMES)('pass WCAG AA on the lit floor and apron: $name theme', ({ tokens }) => {
    // The stage numbers after a name inherit its colour unless they set their own.
    const nameColor = name.get('color');
    if (!nameColor) throw new Error('.zone-label sets no color');
    const texts = { name: nameColor, 'stage numbers': stages.get('color') ?? nameColor };
    for (const [what, color] of Object.entries(texts)) {
      const text = luminance(resolve(color, tokens));
      for (const ground of ['--floor', '--apron']) {
        const unlit = luminance(resolve(`var(${ground})`, tokens));
        for (const lit of LIT_RANGE.map((factor) => Math.min(1, unlit * factor))) {
          expect(contrast(text, lit), `${what} (${color}) on ${ground}`).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });
});

// The machine labels are tags over the 3D view (phase 11, D21): a chip, a little see-through, so what shows through
// it may be anything from a black tyre to a white carton. Its text keeps WCAG AA (4.5:1) and its lamps the 3:1 of
// WCAG 1.4.11 against the chip over either, in every theme.

/** WCAG 1.4.11: a lamp is a graphical object that carries the status. */
const NON_TEXT = 3;

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

const toHex = (channels: readonly number[]): string => `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/**
 * The chip's colour over `under`: its background is `color-mix(in srgb, <colour> <p>%, transparent)` (or an opaque
 * colour), which shows as the colour at p % opacity.
 */
function chipOver(background: string, under: string, tokens: Map<string, string>): string {
  const mix = /^color-mix\(in srgb, (\S+) (\d+(?:\.\d+)?)%, transparent\)$/.exec(background);
  const [color, share] = mix ? [mix[1], Number(mix[2]) / 100] : [background, 1];
  const top = rgb(resolve(color, tokens));
  const bottom = rgb(under);
  return toHex(top.map((c, i) => c * share + bottom[i] * (1 - share)));
}

describe('machine labels', () => {
  const chip = declarations(rule(LABELS, '.equipment-label'));
  const name = declarations(rule(LABELS, '.equipment-name'));
  const value = declarations(rule(LABELS, '.equipment-value'));
  const selectedName = declarations(rule(LABELS, '.equipment-label.is-selected .equipment-name'));
  const lamp = (status: string | null): string => {
    const selector = status ? `.equipment-label[data-status='${status}'] .equipment-lamp` : '.equipment-lamp';
    const background = declarations(rule(LABELS, selector)).get('background');
    if (!background) throw new Error(`${selector} sets no background`);
    return background;
  };

  it('stand on a chip that is at least a little opaque', () => {
    const background = chip.get('background');
    expect(background, '.equipment-label background').toBeDefined();
    expect(background).toMatch(/^color-mix\(in srgb, var\(--[\w-]+\) \d+%, transparent\)$|^var\(--[\w-]+\)$/);
  });

  it.each(THEMES)('keep their text at WCAG AA and their lamps at 3:1 over black or white: $name theme', ({ tokens }) => {
    const background = chip.get('background') as string;
    const texts = {
      name: name.get('color'),
      'selected name': selectedName.get('color'),
      value: value.get('color'),
    };
    for (const under of ['#000000', '#ffffff']) {
      const ground = luminance(chipOver(background, under, tokens));
      for (const [what, color] of Object.entries(texts)) {
        if (!color) throw new Error(`the ${what} sets no color`);
        expect(contrast(luminance(resolve(color, tokens)), ground), `${what} (${color}) over ${under}`).toBeGreaterThanOrEqual(AA);
      }
      for (const status of [null, 'ok', 'warn', 'bad']) {
        const color = lamp(status);
        expect(contrast(luminance(resolve(color, tokens)), ground), `${status ?? 'idle'} lamp (${color}) over ${under}`).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
  });
});
