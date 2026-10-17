// Just enough of the browser for scene modules that read the theme or media queries, in Node.
// Undo with vi.unstubAllGlobals().
import { vi } from 'vitest';

/**
 * The page's CSS custom properties, as theme.ts reads them (getComputedStyle on <html>). Empty unless a
 * test sets one, so readSceneColor falls back to the light theme's values. Change the returned record to
 * switch a value, as a theme change would.
 */
export function stubTheme(properties: Record<string, string> = {}): Record<string, string> {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => properties[name] ?? '' }));
  return properties;
}

/** matchMedia that answers every query with `matches(query)`, and never changes. */
export function stubMatchMedia(matches: (query: string) => boolean = () => false): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: matches(query),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
