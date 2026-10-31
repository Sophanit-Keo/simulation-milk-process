// The control-room look's theme (phase 11, D21; src/ui/theme.ts): each page sets <html data-theme> before its CSS
// loads, from the viewer's choice kept in this browser (localStorage, THEME_KEY), else dark. The theme button on the
// 3D app's title row (after About and Factory) and on the factory board switches it and keeps the choice; the 3D
// view recolours itself. With storage blocked the page still opens, dark, and the button works for the visit.
import type { Page } from '@playwright/test';
import { THEME_KEY } from '../src/ui/theme';
import { expect, test } from './fixtures';
import { afterHudUpdates, showTheme, waitForClock } from './helpers';

/**
 * What the page shows of its theme, read in one go: <html data-theme>, the relative luminance (0 black … 1 white) of
 * the page background (body's background-color is var(--bg), tokens.css), the theme button's label and
 * aria-pressed, and the choice kept in storage (undefined when storage can't be read).
 */
async function themeState(page: Page): Promise<{
  theme: string | undefined;
  bgLuminance: number;
  button: { text: string; pressed: string | null } | null;
  saved: string | null | undefined;
}> {
  return page.evaluate((key) => {
    // "rgb(7, 11, 14)": the sRGB channels, made linear for the WCAG luminance.
    const channels = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? [];
    const [r, g, b] = channels
      .slice(0, 3)
      .map((channel) => {
        const c = Number(channel) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    const button = document.querySelector<HTMLElement>('[data-testid="theme-toggle"]');
    let saved: string | null | undefined;
    try {
      saved = localStorage.getItem(key);
    } catch {
      saved = undefined;
    }
    return {
      theme: document.documentElement.dataset.theme,
      bgLuminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
      button: button && { text: button.textContent?.trim() ?? '', pressed: button.getAttribute('aria-pressed') },
      saved,
    };
  }, THEME_KEY);
}

/** The dark page (#070b0e) is near black; the light one (#e8edf0) near white. Room for `ui` to tune the values. */
const DARK_BG_BELOW = 0.05;
const LIGHT_BG_ABOVE = 0.6;

/**
 * Mean relative luminance of what the 3D view shows (a screenshot of its canvas, scaled down in the page). The
 * scene's background (--scene-bg) fills most of it, so it is low in the dark theme and high in the light one.
 * __scene does not expose the renderer's clear colour, and the app never reads WebGL pixels back, so the test
 * reads the screen instead.
 */
async function viewLuminance(page: Page): Promise<number> {
  const png = await page.locator('#viewport canvas').screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D context');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const linear = (value: number): number => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2]);
    return sum / (data.length / 4);
  }, png.toString('base64'));
}

const DARK_VIEW_BELOW = 0.1;
const LIGHT_VIEW_ABOVE = 0.35;

test('the 3D app opens dark, the theme button switches it to light, the choice outlives a reload, and the 3D view follows', async ({
  page,
}) => {
  await page.goto('/');
  await waitForClock(page);

  // A new visitor: no choice kept, the dark control room.
  const opened = await themeState(page);
  expect(opened.theme, 'data-theme for a new visitor').toBe('dark');
  expect(opened.saved, 'no choice kept yet').toBeNull();
  expect(opened.bgLuminance, 'the page background (--bg) is the dark one').toBeLessThan(DARK_BG_BELOW);
  expect(opened.button, 'the button offers the light theme').toEqual({ text: 'Light', pressed: 'false' });
  await expect.poll(() => viewLuminance(page), { message: 'the 3D view is dark' }).toBeLessThan(DARK_VIEW_BELOW);

  // The button sits on the title row, after About and Factory.
  const titleRow = await page.getByTestId('theme-toggle').evaluate((button) =>
    [...(button.parentElement?.children ?? [])].map((part) => (part as HTMLElement).dataset.testid ?? part.tagName.toLowerCase()),
  );
  expect(titleRow.indexOf('theme-toggle'), `the title row: ${titleRow.join(', ')}`).toBeGreaterThan(titleRow.indexOf('factory-link'));
  expect(titleRow.indexOf('factory-link'), `the title row: ${titleRow.join(', ')}`).toBeGreaterThan(titleRow.indexOf('about'));
  expect(titleRow.indexOf('about'), `the title row: ${titleRow.join(', ')}`).toBeGreaterThanOrEqual(0);

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await themeState(page);
  expect(light.bgLuminance, 'the page background (--bg) is the light one').toBeGreaterThan(LIGHT_BG_ABOVE);
  expect(light.button, 'the button offers the dark theme').toEqual({ text: 'Dark', pressed: 'true' });
  expect(light.saved, 'the choice is kept').toBe('light');
  await expect.poll(() => viewLuminance(page), { message: 'the 3D view turns light' }).toBeGreaterThan(LIGHT_VIEW_ABOVE);

  // A reload opens in the choice, the theme set before the CSS (no switch after the page shows).
  await page.reload();
  await waitForClock(page);
  const reloaded = await themeState(page);
  expect(reloaded.theme, 'data-theme after a reload').toBe('light');
  expect(reloaded.bgLuminance, 'the page background after a reload').toBeGreaterThan(LIGHT_BG_ABOVE);
  expect(reloaded.button, 'the button after a reload').toEqual({ text: 'Dark', pressed: 'true' });
  await expect.poll(() => viewLuminance(page), { message: 'the 3D view opens light' }).toBeGreaterThan(LIGHT_VIEW_ABOVE);

  // And back.
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const back = await themeState(page);
  expect(back.bgLuminance, 'the page background back in dark').toBeLessThan(DARK_BG_BELOW);
  expect(back.button, 'the button back in dark').toEqual({ text: 'Light', pressed: 'false' });
  expect(back.saved, 'the dark choice is kept').toBe('dark');
  await expect.poll(() => viewLuminance(page), { message: 'the 3D view turns dark again' }).toBeLessThan(DARK_VIEW_BELOW);
  await page.reload();
  await waitForClock(page);
  expect((await themeState(page)).theme, 'dark after another reload').toBe('dark');
});

test('the factory board opens in the theme chosen in the 3D app, and its own button switches both', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  await showTheme(page, 'light');

  // Signed out, the board is its sign-in form; it asks Let Report nothing (the fixtures block any other origin).
  await page.goto('/factory.html');
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  const board = await themeState(page);
  expect(board.theme, 'the board reads the choice').toBe('light');
  expect(board.bgLuminance, "the board's background is the light one").toBeGreaterThan(LIGHT_BG_ABOVE);
  expect(board.button, "the board's theme button").toEqual({ text: 'Dark', pressed: 'true' });

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await themeState(page)).bgLuminance, "the board's background in dark").toBeLessThan(DARK_BG_BELOW);

  await page.goto('/');
  await waitForClock(page);
  expect((await themeState(page)).theme, 'the 3D app reads the choice made on the board').toBe('dark');
});

test('with storage blocked, both pages open dark without an error, and the button switches for the visit', async ({ page }) => {
  // As with site data blocked: even looking at localStorage throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The user has blocked site data.', 'SecurityError');
      },
    });
  });

  await page.goto('/');
  await waitForClock(page);
  const opened = await themeState(page);
  expect(opened.saved, 'storage is blocked').toBeUndefined();
  expect(opened.theme, 'data-theme with storage blocked').toBe('dark');
  expect(opened.bgLuminance, 'the page background with storage blocked').toBeLessThan(DARK_BG_BELOW);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await themeState(page)).button, 'the button after switching').toEqual({ text: 'Dark', pressed: 'true' });
  // Let the frame loop and the HUD run with the new theme; the fixtures fail the test on any error.
  await afterHudUpdates(page);

  // Nothing could be kept, so the next page opens dark again.
  await page.goto('/factory.html');
  await expect(page.getByTestId('factory-signin')).toBeVisible();
  expect((await themeState(page)).theme, 'the board with storage blocked').toBe('dark');
});
