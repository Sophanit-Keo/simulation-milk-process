import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Each loaded @font-face as "family weight", e.g. "IBM Plex Mono 500". */
async function loadedFonts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => `${face.family.replace(/^["']|["']$/g, '')} ${face.weight}`);
  });
}

/** Drawing-buffer pixels per CSS pixel of the 3D canvas, across and down. */
async function canvasRatio(page: Page): Promise<{ x: number; y: number }> {
  return page.locator('#viewport canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return { x: canvas.width / box.width, y: canvas.height / box.height };
  });
}

test('the bundled fonts load under the family names the CSS asks for', async ({ page }) => {
  await page.goto('/');
  // The clock and the run state (IBM Plex Mono 500, Barlow 600) appear with the first HUD update.
  await expect(page.locator('[data-testid="sim-clock"]')).toBeAttached();
  // A face only loads once rendered text uses it, so this also checks tokens.css names the families
  // as @fontsource declares them. Third-party requests are blocked (fixtures.ts), so these came from the app.
  await expect
    .poll(() => loadedFonts(page))
    .toEqual(
      expect.arrayContaining(['Barlow 400', 'Barlow 600', 'Barlow Condensed 600', 'Barlow Condensed 700', 'IBM Plex Mono 500']),
    );
});

test('the KPI strip is a labelled region, not the page footer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Plant KPIs' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
});

test('the canvas follows the size of the view', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 640 });
  const view = await page.locator('#viewport').boundingBox();
  if (!view) throw new Error('#viewport has no layout box');
  const roundedSize = async (): Promise<number[] | null> => {
    const box = await canvas.boundingBox();
    return box && [Math.round(box.width), Math.round(box.height)];
  };
  await expect.poll(roundedSize).toEqual([Math.round(view.width), Math.round(view.height)]);
  await expect.poll(async () => (await canvasRatio(page)).x).toBeCloseTo(1, 1);
  await expect.poll(async () => (await canvasRatio(page)).y).toBeCloseTo(1, 1);
});

test('the canvas follows the screen pixel ratio when only that changes', async ({ page }) => {
  // Counts the change listeners on resolution media queries, to show the world re-arms one rather than piling them up.
  await page.addInitScript(() => {
    const live = new Map<EventTarget, Set<unknown>>();
    const watched = (target: EventTarget, type: string): Set<unknown> | null => {
      if (!(target instanceof MediaQueryList) || type !== 'change' || !target.media.includes('resolution')) return null;
      if (!live.has(target)) live.set(target, new Set());
      return live.get(target) ?? null;
    };
    const { addEventListener, removeEventListener } = EventTarget.prototype;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      watched(this, type)?.add(listener);
      addEventListener.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      watched(this, type)?.delete(listener);
      removeEventListener.call(this, type, listener, options);
    };
    (window as unknown as { ratioListeners: () => number }).ratioListeners = () =>
      [...live.values()].reduce((count, listeners) => count + listeners.size, 0);
  });
  const ratioListeners = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { ratioListeners: () => number }).ratioListeners());

  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect.poll(async () => (await canvasRatio(page)).x).toBeCloseTo(1, 1);

  // As when the window moves between a 1x and a 2x screen: same CSS size, new devicePixelRatio.
  const cdp = await page.context().newCDPSession(page);
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
  for (const ratio of [2, 1, 2]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: ratio, mobile: false });
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(ratio);
    await expect.poll(async () => (await canvasRatio(page)).x, { message: `buffer across at ${ratio}x` }).toBeCloseTo(ratio, 1);
    await expect.poll(async () => (await canvasRatio(page)).y, { message: `buffer down at ${ratio}x` }).toBeCloseTo(ratio, 1);
    expect(await ratioListeners(), 'resolution listeners').toBe(1);
  }
});
