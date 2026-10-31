import { Color } from 'three';
import type { ZoneColorVar } from './layout';

/**
 * Scene colours come from the CSS custom properties `ui` ports from the preview (src/styles/tokens.css),
 * so the 3D view follows the light and dark themes. Until a property exists (or if it is empty) the
 * preview's light value stands in.
 */
const LIGHT_FALLBACKS = {
  '--scene-bg': '#dde5ea',
  '--floor': '#ccd6dc',
  '--zone-proc': '#c1d3e2',
  '--zone-pack': '#d5d2c8',
  '--zone-quar': '#e5d4a8',
  '--zone-ware': '#c8d0d6',
  '--apron': '#b9c3ca',
  // Shared equipment materials (equipmentHost.ts) and the zone outlines.
  '--steel': '#b4c0c8',
  '--steel-dark': '#76858f',
  // The selection ring.
  '--accent': '#1767b0',
  // Pipe colour by milk temperature (plan 08), the stops of pipes.ts's ramp; the same in both themes.
  '--t4': '#2b7bd0',
  '--t20': '#2aa0c0',
  '--t60': '#e3a21c',
  '--t80': '#ea8027',
  '--t140': '#d63b26',
  // The cleaning fluids in the pipes while the CIP station cleans (phase 7); the same in both themes.
  '--clean-water': '#8fb4c8',
  '--clean-lye': '#7d5cc6',
  '--clean-acid': '#c2479a',
  // The lamp colours (plan 08): green running, amber on hold or warning, red stopped. The 3D lamps glow in them in the
  // dark theme (lamps.ts).
  '--ok': '#1f8f57',
  '--warn': '#a87400',
  '--bad': '#c63a2b',
  // The page's backdrop grid (phase 11, D21), which the floor's grid takes its colour and strength from (floorGrid.ts).
  '--grid': 'rgba(19, 33, 43, 0.035)',
} as const satisfies Record<`--${string}`, string> & Record<ZoneColorVar | '--scene-bg' | '--floor', string>;

export type SceneColorVar = keyof typeof LIGHT_FALLBACKS;

/** A lamp's state, as the rail's lamps have them (plan 08): green running, amber hold or warning, red stopped. */
export type LampStatus = 'ok' | 'warn' | 'bad';

/**
 * Lit lamps in the 3D view (the divert valve's lamp, the lit divert route) in the light theme. A lit lamp gives off
 * light, so it keeps brighter values than the light theme's tokens; the dark theme's lamps read --ok, --warn and
 * --bad (lamps.ts).
 */
export const LAMP_GLOW_HEX: Readonly<Record<LampStatus, number>> = { ok: 0x3cc47f, warn: 0xe8ad2c, bad: 0xf0604d };

/** The token of each lamp colour (tokens.css): what the 3D lamps glow in, in the dark theme (lamps.ts). */
export const LAMP_COLOR_VAR: Readonly<Record<LampStatus, SceneColorVar>> = { ok: '--ok', warn: '--warn', bad: '--bad' };

export function readSceneColor(name: SceneColorVar): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || LIGHT_FALLBACKS[name];
}

/** Below this relative luminance the scene's background counts as dark. Light's #dde5ea is about 0.77, dark's #090e12 0.004. */
const DARK_BACKGROUND_LUMINANCE = 0.2;
const probe = new Color();

/**
 * Whether the page shows the dark theme (phase 11, D21): read from the scene's background token, so the OS setting
 * and <html data-theme> count alike, as tokens.css applies them. Call it when the theme changes, not every frame.
 */
export function sceneIsDark(): boolean {
  // THREE.Color holds linear values, so this is the WCAG relative luminance of the sRGB token.
  probe.set(readSceneColor('--scene-bg'));
  return 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b < DARK_BACKGROUND_LUMINANCE;
}

/**
 * A colour token that may carry an alpha, such as --grid's rgba(56, 189, 248, 0.05): the colour into `target` and the
 * alpha returned (1 for an opaque colour). Only #rgb, #rrggbb and rgb()/rgba() with plain numbers are read as such;
 * anything else goes to THREE.Color as it is.
 */
export function readSceneRgba(name: SceneColorVar, target: Color): number {
  const value = readSceneColor(name);
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value);
  if (!rgba) {
    target.set(value);
    return 1;
  }
  const [, r, g, b, alpha, percent] = rgba;
  target.setRGB(Number(r) / 255, Number(g) / 255, Number(b) / 255, 'srgb');
  if (alpha === undefined) return 1;
  return Math.min(1, Math.max(0, Number(alpha) / (percent ? 100 : 1)));
}

/**
 * Calls `onChange` when the OS colour scheme flips or the page switches theme on <html>
 * (the preview uses a data-theme attribute). Returns a function that stops watching.
 */
export function watchTheme(onChange: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  return () => {
    media.removeEventListener('change', onChange);
    observer.disconnect();
  };
}
