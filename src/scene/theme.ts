import type { ZoneColorVar } from './layout';

/**
 * Scene colours come from the CSS custom properties `ui` ports from the preview, so the 3D view
 * follows the light and dark themes. Until a property exists (or if it is empty) the preview's
 * light value stands in.
 */
const LIGHT_FALLBACKS = {
  '--scene-bg': '#dde5ea',
  '--floor': '#ccd6dc',
  '--zone-proc': '#c1d3e2',
  '--zone-pack': '#d5d2c8',
  '--zone-quar': '#e5d4a8',
  '--zone-ware': '#c8d0d6',
  '--apron': '#b9c3ca',
} as const satisfies Record<ZoneColorVar | '--scene-bg' | '--floor', string>;

export type SceneColorVar = keyof typeof LIGHT_FALLBACKS;

export function readSceneColor(name: SceneColorVar): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || LIGHT_FALLBACKS[name];
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
