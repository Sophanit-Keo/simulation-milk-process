import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Status lamps carry state by colour alone on the rail, so each lamp colour needs 3:1 against every
// background a lamp sits on (WCAG 1.4.11, non-text contrast), in both themes. The colours come from
// src/styles/tokens.css; where the lamps sit comes from src/styles/app.css.

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties of the first rule whose selector matches, by name without the dashes. */
function tokens(selector: RegExp): Record<string, string> {
  const body = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`tokens.css has no rule for ${selector.source}`);
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

/** The light set, and the dark set in both of its copies (the OS asking for dark, and data-theme="dark"). */
const THEMES: Record<string, Record<string, string>> = {
  light: tokens(/:root/),
  'dark (system)': tokens(/:root:not\(\[data-theme="light"\]\)/),
  'dark (forced)': tokens(/:root\[data-theme="dark"\]/),
};

type Rgba = [r: number, g: number, b: number, a: number];

function parseColour(text: string): Rgba {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(text);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`not a #rrggbb or rgba() colour: ${text}`);
}

/** A colour with alpha painted over an opaque one. */
function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

/** WCAG 2 relative luminance. */
function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Each lamp state and the token that draws it: idle is a ring in --muted (app.css .lamp). */
const LAMPS = { ok: 'ok', warn: 'warn', bad: 'bad', idle: 'muted' } as const;

/** Where lamps sit, as an opaque colour in a theme's tokens. */
const BACKGROUNDS: Record<string, (theme: Record<string, string>) => Rgba> = {
  // The rail, the KPI cards (whose border turns amber or red) and the bar are cards.
  raised: (theme) => parseColour(theme.raised),
  // The run chip in the bar, the status chip in the panel, a rail row under the mouse.
  surface: (theme) => parseColour(theme.surface),
  // The selected rail row: the accent tint over the card.
  'selected rail row': (theme) => over(parseColour(theme['accent-soft']), parseColour(theme.raised)),
};

describe('status lamp colours (tokens.css)', () => {
  it.each(Object.keys(THEMES))('keep 3:1 against every background a lamp sits on: %s theme', (name) => {
    const theme = THEMES[name];
    const below: string[] = [];
    for (const [lamp, token] of Object.entries(LAMPS)) {
      for (const [where, background] of Object.entries(BACKGROUNDS)) {
        const ratio = contrast(parseColour(theme[token]), background(theme));
        if (ratio < 3) below.push(`${lamp} (--${token} ${theme[token]}) on ${where}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(below).toEqual([]);
  });

  it('measures contrast the WCAG way', () => {
    expect(contrast(parseColour('#000000'), parseColour('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColour('#c88a00'), parseColour('#ffffff'))).toBeCloseTo(2.96, 2);
  });
});
