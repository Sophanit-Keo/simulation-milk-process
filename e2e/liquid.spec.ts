import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { afterHudUpdates, railButton, showTheme, waitForClock } from './helpers';

// The live panels of the liquid line (phase 3, ui lane): the stage 4 read-outs that make R6 visible, the
// set-point sliders of stages 4 and 3, the trend charts of stages 4 and 6, the event log, and the ?debug
// panel. The fixtures fail any test that logs a console error or warning on the way.

/** A panel row's text, spaces collapsed: "Set point 140.0 °C". */
const rowText = (page: Page, attribute: string, key: string): Promise<string> =>
  page
    .locator(`#panel [${attribute}="${key}"]`)
    .innerText()
    .then((text) => text.replace(/\s+/g, ' ').trim());
const valueRow = (page: Page, key: string): Promise<string> => rowText(page, 'data-value-key', key);

const uhtSlider = (page: Page): Locator => page.getByTestId('setpoint-uhtSetpointC');
const homogenizerSlider = (page: Page): Locator => page.getByTestId('setpoint-homogenizerStage1Bar');

/** Opens the app and selects a stage on the rail; the panel shows it at once, whatever the camera does. */
async function openStage(page: Page, path: string, stage: number): Promise<void> {
  await page.goto(path);
  await waitForClock(page);
  await railButton(page, stage).click();
  await expect(page.getByTestId('panel-title')).not.toHaveText('Select a stage');
}

/** The event log's entries, newest first, read in one go. */
async function logEntries(page: Page): Promise<{ kind: string | null; lamp: string | null; label: string | null; time: string; text: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#log [data-testid="event-log"] > li')].map((li) => ({
      kind: li.getAttribute('data-kind'),
      lamp: li.querySelector('.lamp')?.getAttribute('data-status') ?? null,
      label: li.querySelector('.lamp')?.getAttribute('aria-label') ?? null,
      time: (li.querySelector('time')?.textContent ?? '').trim(),
      text: (li.querySelector('.log-text')?.textContent ?? '').trim(),
    })),
  );
}

test.describe('the stage 4 panel (?mock)', () => {
  test('shows flow, hold, temperature, divert limit, the margin over it, B* and F0, the UHT mode and the throttle', async ({ page }) => {
    await openStage(page, '/?mock', 4);
    await expect(async () => {
      expect(await valueRow(page, 'flowLph')).toMatch(/^Flow \d{1,2},\d{3} L\/h$/);
      expect(await valueRow(page, 'holdS')).toMatch(/^Holding time \d+\.\d s$/);
      expect(await valueRow(page, 'tempC')).toMatch(/^Holding-tube outlet 1\d\d\.\d °C$/);
      expect(await valueRow(page, 'divertLimitC')).toMatch(/^Divert limit 1\d\d\.\d °C$/);
      expect(await valueRow(page, 'bStar')).toMatch(/^B\* \d+\.\d\d$/);
      expect(await valueRow(page, 'f0Min')).toMatch(/^F0 \d+\.\d\d min$/);
      expect(await rowText(page, 'data-derived-key', 'marginC')).toMatch(/^Margin over limit [+-]?\d+\.\d\d °C$/);
      expect(await rowText(page, 'data-state-key', 'uhtMode')).toMatch(
        /^UHT plant (Production|(Diverting to reject|Cleaning \(CIP\)|Re-sterilizing|Intermediate clean)( · .+ left)?)$/,
      );
      expect(await rowText(page, 'data-state-key', 'throttle')).toMatch(/^Feed (Full flow|Throttled · tank high)$/);
    }).toPass({ timeout: 10_000 });

    // The margin is the temperature less the limit, as the rows show them (each rounded to 0.1 °C).
    const read = await page.evaluate(() => {
      const cell = (selector: string) => document.querySelector(`#panel ${selector} dd`)?.textContent ?? '';
      return { temp: cell('[data-value-key="tempC"]'), limit: cell('[data-value-key="divertLimitC"]'), margin: cell('[data-derived-key="marginC"]') };
    });
    const number = (text: string) => Number(text.replace(/[^\d.+-]/g, ''));
    expect(Math.abs(number(read.temp) - number(read.limit) - number(read.margin)), JSON.stringify(read)).toBeLessThanOrEqual(0.11);

    // The mode lamp is lit in a plan 08 colour, and its row sits above the values.
    const lamp = page.locator('#panel [data-state-key="uhtMode"] .lamp');
    await expect(lamp).toHaveAttribute('data-status', /^(ok|warn|bad)$/);
  });
});

test.describe('set-point sliders', () => {
  test('the UHT slider is labelled, works from the keyboard and changes the set point the sim runs on', async ({ page }) => {
    await openStage(page, '/', 4);
    const slider = uhtSlider(page);
    await expect(slider).toHaveAccessibleName('UHT set point');
    await expect(slider).toHaveAttribute('min', '130');
    await expect(slider).toHaveAttribute('max', '150');
    await expect(slider).toHaveAttribute('step', '0.1');
    await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('140.0 °C');
    await expect(slider).toHaveAttribute('aria-valuetext', '140.0 °C');

    await slider.focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('150.0 °C');
    await afterHudUpdates(page);
    await expect.poll(() => valueRow(page, 'setpointC')).toBe('Set point 150.0 °C');
    // The keyboard keeps focus on the slider, and the HUD's refresh leaves the value where the keys put it.
    await expect(slider).toBeFocused();
    await expect(slider).toHaveValue('150');

    // Five steps of 2 °C (Page Down) and four of 0.1 °C: 139.6 °C, whose lowest noisy reading (139.3 °C)
    // stays over the 139.22 °C limit, so the live sim never diverts and logs nothing else here.
    for (let press = 0; press < 5; press++) await page.keyboard.press('PageDown');
    for (let press = 0; press < 4; press++) await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText('139.6 °C');
    await afterHudUpdates(page);
    await expect.poll(() => valueRow(page, 'setpointC')).toBe('Set point 139.6 °C');
    const texts = (await logEntries(page)).map(({ text }) => text);
    expect(texts).toContain('UHT set point set to 139.6 °C');
    expect(texts.filter((text) => text.includes('diverting'))).toEqual([]);
  });

  test('the sterility card turns red on B* below 1, not on F0 below 5 min (D4)', async ({ page }) => {
    await openStage(page, '/', 4);
    const card = page.locator('#kpis [data-kpi="sterility"]');
    await uhtSlider(page).focus();
    // 139.6 °C at 4 s: the reading spans 139.3–139.9 °C, so B* stays at 1.02 or more and the plant never
    // diverts, while F0 reads under its 5 min target most of the time (under 139.85 °C, H23).
    await page.keyboard.press('End');
    for (let press = 0; press < 5; press++) await page.keyboard.press('PageDown');
    for (let press = 0; press < 4; press++) await page.keyboard.press('ArrowLeft');
    const sterility = async () => {
      const text = (await card.locator('[data-kpi-value]').innerText()).replace(/\s+/g, ' ');
      const match = /^F0 (\d+\.\d\d) · B\* (\d+\.\d\d)$/.exec(text);
      return match ? { f0Min: Number(match[1]), bStar: Number(match[2]), red: (await card.getAttribute('data-s')) === 'bad' } : null;
    };
    await expect.poll(async () => {
      const now = await sterility();
      return now !== null && now.f0Min < 5 && now.bStar >= 1 && !now.red;
    }, { message: 'F0 under 5 min with B* at 1 or more, and the card not red' }).toBe(true);
    // 139.0 °C: B* about 0.9, under-processed; the plant diverts and the card turns red.
    for (let press = 0; press < 6; press++) await page.keyboard.press('ArrowLeft');
    await expect(card).toHaveAttribute('data-s', 'bad');
    await expect.poll(async () => (await sterility())?.bStar ?? 9).toBeLessThan(1);
  });

  test('a mouse drag is not undone by the HUD while held, and sends one set point when let go', async ({ page }) => {
    await openStage(page, '/', 4);
    const slider = uhtSlider(page);
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (!box) throw new Error('the UHT slider has no layout box');
    const before = (await logEntries(page)).length;
    const y = box.y + box.height / 2;
    // 140 °C sits in the middle of 130–150 °C.
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, y, { steps: 5 });
    const held = await page.getByTestId('setpoint-uhtSetpointC-value').innerText();
    expect(Number.parseFloat(held)).toBeLessThan(138);
    // Two HUD refreshes while held: the slider stays where the pointer is, and nothing has been sent.
    await afterHudUpdates(page);
    await afterHudUpdates(page);
    await expect(page.getByTestId('setpoint-uhtSetpointC-value')).toHaveText(held);
    expect(await valueRow(page, 'setpointC')).toBe('Set point 140.0 °C');
    await page.mouse.up();
    await afterHudUpdates(page);
    await expect.poll(() => valueRow(page, 'setpointC')).toBe(`Set point ${held}`);
    // The live sim diverts below the limit, so the drag may log a divert as well: count the set-point entries.
    const entries = await logEntries(page);
    const added = entries.slice(0, entries.length - before);
    const setpointEntries = added.filter(({ text }) => text.startsWith('UHT set point set to'));
    expect(setpointEntries.map(({ text }) => text), 'one set point sent for the drag').toEqual([`UHT set point set to ${held}`]);
    // After a mouse drag, focus goes back to the page, so Space pauses the clock again.
    await expect(slider).not.toBeFocused();
  });

  test('the homogenizer slider sets the first-stage pressure in 5 bar steps, and keeps it when the panel comes back', async ({ page }) => {
    await openStage(page, '/', 3);
    const slider = homogenizerSlider(page);
    await expect(slider).toHaveAccessibleName('First-stage pressure');
    await expect(page.getByTestId('setpoint-homogenizerStage1Bar-value')).toHaveText('200 bar');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('setpoint-homogenizerStage1Bar-value')).toHaveText('205 bar');
    await page.keyboard.press('End');
    await expect(page.getByTestId('setpoint-homogenizerStage1Bar-value')).toHaveText('250 bar');
    await afterHudUpdates(page);
    // The static plant runs at its set point.
    await expect.poll(() => valueRow(page, 'stage1Bar')).toBe('First stage 250 bar');
    expect((await logEntries(page))[0]?.text).toBe('Homogenizer stage 1 pressure set to 250 bar');

    await railButton(page, 4).click();
    await expect(slider).toHaveCount(0);
    await railButton(page, 3).click();
    await expect(page.getByTestId('setpoint-homogenizerStage1Bar-value')).toHaveText('250 bar');
    await expect(homogenizerSlider(page)).toHaveValue('250');
  });
});

test.describe('the event log', () => {
  test('is a polite live log, newest first, with sim time and a lamp per kind, capped, in a box that does not move', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    const list = page.getByTestId('event-log');
    await expect(list).toHaveAttribute('role', 'log');
    await expect(list).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByRole('log', { name: 'What happened' })).toBeVisible();
    // The plant opens on day 8 after a week of history (D11).
    await expect.poll(async () => (await logEntries(page)).at(-1)?.text).toBe('Plant opens: day 8, 06:00');
    const first = (await logEntries(page)).at(-1);
    expect(first).toMatchObject({ kind: 'info', lamp: 'idle', label: 'Note', time: 'day 8 · 06:00' });

    const card = page.locator('#log');
    const boxBefore = await card.boundingBox();
    // 30 set-point changes: 30 entries, more than the log shows.
    await railButton(page, 3).click();
    await homogenizerSlider(page).focus();
    await page.keyboard.press('Home');
    await expect.poll(async () => (await logEntries(page))[0]?.text).toBe('Homogenizer stage 1 pressure set to 100 bar');
    // A new entry is added on top: the entries already there stay the same nodes, so a screen reader hears
    // only the new one (a log that redrew itself would announce everything again).
    await page.evaluate(() => {
      const newest = document.querySelector('#log [data-testid="event-log"] > li') as HTMLElement & { probe?: boolean };
      newest.probe = true;
    });
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await logEntries(page))[0]?.text).toBe('Homogenizer stage 1 pressure set to 105 bar');
    expect(
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('#log [data-testid="event-log"] > li')] as (HTMLElement & { probe?: boolean })[];
        return items.findIndex((li) => li.probe === true);
      }),
      'the earlier entry is still the same node, one place down',
    ).toBe(1);
    for (let press = 0; press < 28; press++) await page.keyboard.press('ArrowRight');
    await afterHudUpdates(page);
    await expect.poll(async () => (await logEntries(page))[0]?.text).toBe('Homogenizer stage 1 pressure set to 245 bar');
    const entries = await logEntries(page);
    expect(entries).toHaveLength(20);
    expect(entries[1]?.text).toBe('Homogenizer stage 1 pressure set to 240 bar');
    for (const entry of entries) {
      expect(entry.time).toMatch(/^day \d+ · \d\d:\d\d$/);
      expect(entry.lamp).toMatch(/^(idle|ok|warn|bad)$/);
      expect(entry.label).toBeTruthy();
    }
    expect(await card.boundingBox(), 'the log card keeps its place and size').toEqual(boxBefore);
  });
});

test.describe('trend charts', () => {
  test('stage 4 and 6 have a chart that fills its box and follows its width; other stages have none', async ({ page }) => {
    await openStage(page, '/?mock', 4);
    const canvasSize = (stage: number) =>
      page.evaluate((id) => {
        const canvas = document.querySelector<HTMLCanvasElement>(`#panel [data-testid="trend-${id}"] canvas`);
        const plot = canvas?.parentElement?.getBoundingClientRect();
        const box = canvas?.getBoundingClientRect();
        return canvas && plot && box ? { width: Math.round(box.width), height: Math.round(box.height), plot: Math.round(plot.width) } : null;
      }, stage);
    // Chart.js arrives in its own chunk; the box keeps its size meanwhile.
    await expect(page.getByTestId('trend-4')).toHaveAttribute('data-ready', '');
    await expect.poll(() => canvasSize(4)).toMatchObject({ height: 118 });
    const narrow = await canvasSize(4);
    expect(narrow?.width).toBe(narrow?.plot);
    await expect(page.getByTestId('trend-4').locator('canvas')).toHaveAccessibleName(/UHT temperature.*divert limit/);

    // Sampled on sim time: at ×1,000 a sample a sim minute comes every few HUD updates.
    await page.getByTestId('speed-1000').click();
    await expect.poll(async () => Number(await page.getByTestId('trend-4').getAttribute('data-samples'))).toBeGreaterThan(2);

    // Below 1,101 px the panel spans the page, and the chart widens with it.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(async () => (await canvasSize(4))?.width ?? 0).toBeGreaterThan((narrow?.width ?? 0) + 200);
    const wide = await canvasSize(4);
    expect(wide?.width).toBe(wide?.plot);
    expect(wide?.height).toBe(118);

    // Another stage destroys the chart; stage 6 builds its own.
    await railButton(page, 5).click();
    await expect(page.locator('#panel canvas')).toHaveCount(0);
    await railButton(page, 6).click();
    await expect(page.getByTestId('trend-6')).toHaveAttribute('data-ready', '');
    await expect(page.locator('#panel canvas')).toHaveCount(1);
    await expect.poll(() => canvasSize(6)).toMatchObject({ height: 118 });
  });
});

test('the one-screen layout holds with the stage 4 panel and the log, at 1280 × 720 and 1440 × 900, light and dark', async ({ page }) => {
  await openStage(page, '/?mock', 4);
  // Each theme through the top bar's theme button, as a viewer switches it (the page opens dark).
  for (const theme of ['light', 'dark'] as const) {
    await showTheme(page, theme);
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON() as DOMRect;
        const rail = document.querySelector('#rail') as HTMLElement;
        return {
          across: document.documentElement.scrollWidth > window.innerWidth,
          down: document.documentElement.scrollHeight > window.innerHeight,
          // The top bar on one row: its parts (centred, of different heights) all overlap vertically.
          barParts: [...document.querySelectorAll('#bar > *')].map((part) => {
            const { top, bottom } = part.getBoundingClientRect();
            return { top, bottom };
          }),
          railOverflowPx: rail.scrollHeight - rail.clientHeight,
          rail: box('#rail'),
          log: box('#log'),
          view: box('.view'),
          kpis: box('#kpis'),
        };
      });
      const size = `${width} × ${height} (${theme})`;
      expect(layout.across, `scrolls sideways at ${size}`).toBe(false);
      expect(layout.down, `scrolls down at ${size}`).toBe(false);
      const lowestTop = Math.max(...layout.barParts.map((part) => part.top));
      const highestBottom = Math.min(...layout.barParts.map((part) => part.bottom));
      expect(lowestTop, `the top bar takes one row at ${size}`).toBeLessThan(highestBottom);
      expect(layout.railOverflowPx, `the rail shows all ten stages without scrolling at ${size}`).toBeLessThanOrEqual(0);
      expect(layout.log.top, `the log sits under the rail at ${size}`).toBeGreaterThanOrEqual(layout.rail.bottom);
      expect(layout.log.bottom, `the log ends with the 3D view at ${size}`).toBeCloseTo(layout.view.bottom, 0);
      expect(layout.log.height, `the log has room for entries at ${size}`).toBeGreaterThanOrEqual(110);
      expect(layout.kpis.top).toBeGreaterThan(layout.log.bottom);
    }
  }
});

test.describe('the ?debug panel', () => {
  test('is there only with ?debug, closed, with set points, speed and read-outs', async ({ page }) => {
    await page.goto('/');
    await waitForClock(page);
    await afterHudUpdates(page);
    await expect(page.locator('.lil-gui')).toHaveCount(0);

    await page.goto('/?debug');
    await waitForClock(page);
    const gui = page.getByTestId('debug-panel');
    await expect(gui).toBeAttached();
    await expect(gui).toHaveClass(/closed/);
    await gui.locator('.lil-title').first().click();
    for (const name of ['UHT set point (°C)', 'First-stage pressure (bar)', 'Speed', 'Paused', 'Sim time', 'UHT plant']) {
      await expect(gui.getByText(name, { exact: true })).toBeVisible();
    }
    // The read-outs refresh with the HUD.
    await expect(gui.locator('.lil-controller', { hasText: 'Sim time' }).locator('input')).toHaveValue(/^day 8 · \d\d:\d\d$/);
    await expect(gui.locator('.lil-controller', { hasText: 'UHT plant' }).locator('input')).toHaveValue('Production');
  });
});
