// The control-room look (phase 11, D21): dark is the default, light is kept. The choice is the viewer's, kept in
// this browser, and both pages read it: the 3D plant (index.html) and the factory board (factory.html). Each page
// sets <html data-theme> in an inline script before its CSS loads, so it never flashes the wrong theme; this module
// changes it afterwards. tokens.css holds both colour sets; src/scene/theme.ts and watchTheme() in dom.ts follow
// the attribute, so the 3D views recolour themselves.
import { el, onPress, setAttr, setText } from './dom';

export type ThemePref = 'dark' | 'light';

/** Where the choice is kept; the pages' inline scripts read the same key. */
export const THEME_KEY = 'simulation-milk-process:theme';

/** The theme a page opens in when the viewer has not chosen one. */
export const DEFAULT_THEME: ThemePref = 'dark';

/** The viewer's choice, or the default; storage that throws counts as no choice. */
export function readTheme(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The theme the page shows now. */
export function currentTheme(): ThemePref {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Shows `pref` and keeps it for next time (when storage can be used). */
export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = pref;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * A button that switches between the dark and the light theme. It names the theme it switches to, so its
 * label is the action ("Light" in the dark theme); aria-pressed says whether the light theme is on.
 */
export function createThemeToggle(signal: AbortSignal): HTMLButtonElement {
  const button = el('button', 'link theme-toggle');
  button.type = 'button';
  button.dataset.testid = 'theme-toggle';
  const show = (): void => {
    const light = currentTheme() === 'light';
    setText(button, light ? 'Dark' : 'Light');
    setAttr(button, 'aria-pressed', String(light));
    button.title = light ? 'Switch to the dark control-room theme' : 'Switch to the light theme';
  };
  onPress(button, () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    show();
  }, signal);
  show();
  return button;
}
