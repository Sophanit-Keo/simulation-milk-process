import type { Page } from '@playwright/test';
import { SPEEDS, formatSscc, ssccFor } from '../src/contracts';
import { expect, test } from './fixtures';
import { STAGES, STATIC_PACKS, expectLanded, railButton, railState, sceneCall, waitForClock, waitForClockToMove, waitForScene } from './helpers';

// Phase 4 in the browser (gate G2), on the live sim: silo to truck at every speed preset with no errors,
// then at ×10,000 until a truck leaves and the oldest batch is released (qa card: "a browser run from silo
// to truck at ×10,000 that sees a truck leave"); and stage 9's batch list: a click on a batch, in the list
// or on its block in the 3D view, shows its pallets with their SSCCs, and the QA override blocks or passes
// it. The fixtures fail any test that logs a console error or warning on the way.

/**
 * Starts noting every log entry the page shows, on every frame. At ×10,000 the capped log drops entries
 * within a few frames, so a check that reads the log only now and then could miss one.
 */
async function recordLog(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { logSeen: Set<string> }).logSeen = seen;
    const tick = (): void => {
      for (const text of document.querySelectorAll('#log [data-testid="event-log"] > li .log-text')) seen.add((text.textContent ?? '').trim());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => [...(window as unknown as { logSeen: Set<string> }).logSeen]);
}

/** A number on the KPI strip: a slot's value or a secondary value, as a number ("1,234 released" reads 1234). */
async function kpiNumber(page: Page, selector: string): Promise<number> {
  const text = await page.locator(`#kpis ${selector}`).textContent({ timeout: 1_000 });
  return Number((text ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/)?.[0] ?? Number.NaN);
}

const batchRow = (page: Page, batchId: number) => page.locator(`[data-testid="batch-list"] .batch-row[data-batch-id="${batchId}"]`);
const batchDetail = (page: Page) => page.getByTestId('batch-detail');
const quarantineState = (page: Page) => sceneCall(page, 'equipmentState', 'quarantine');

/** The batches on hold as the plant opens, newest first: on the screen's side of the quarantine most often. */
const ON_HOLD = STATIC_PACKS.batches.filter((batch) => batch.status === 'hold').reverse();

/** Opens stage 9 on the live sim, paused, so the list and the blocks hold still while a test reads them. */
async function openQuarantine(page: Page): Promise<void> {
  await page.goto('/?debug');
  await waitForScene(page);
  await waitForClock(page);
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
  await railButton(page, 9).click();
  await expectLanded(page, 9);
}

/** Checks the batch's row is the pressed one, and the detail below the list shows it with its pallets and their SSCCs. */
async function expectBatchShown(page: Page, batchId: number): Promise<void> {
  const batch = STATIC_PACKS.batches.find((each) => each.id === batchId);
  if (!batch) throw new Error(`no batch ${batchId} at the opening`);
  await expect(batchRow(page, batchId)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="batch-list"] .batch-row[aria-pressed="true"]')).toHaveCount(1);
  await expect(batchDetail(page)).toContainText(`Batch ${batchId} · filler ${batch.filler}`);
  const pallets = page.getByRole('list', { name: `Pallets of batch ${batchId}` }).locator('li');
  await expect(pallets).toHaveCount(batch.pallets);
  await expect(pallets.first()).toContainText(formatSscc(ssccFor(batchId, 1)));
  await expect(pallets.last()).toContainText(formatSscc(ssccFor(batchId, batch.pallets)));
  // The 3D view marks its block.
  await expect.poll(async () => (await quarantineState(page))?.selected).toBe(batchId);
}

test('silo to truck runs at every speed preset with no errors; at ×10,000 a truck leaves and the oldest batch is released', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  let timeS = await waitForClock(page);
  const seen = await recordLog(page);
  // Each preset runs the whole plant for a while: the clock moves on, and the fixtures fail any console error.
  for (const speed of SPEEDS) {
    await page.getByTestId(`speed-${speed}`).click();
    await expect(page.getByTestId(`speed-${speed}`)).toHaveAttribute('aria-pressed', 'true');
    timeS = await waitForClockToMove(page, timeS);
  }
  // The first truck comes 100 min after the opening (D3) and loads 22 pallets of the opening stock in 20 min.
  await expect
    .poll(async () => (await seen()).filter((text) => /^Truck 1 left with 22 pallets$/.test(text)), { message: 'truck 1 left with its load', timeout: 60_000 })
    .toHaveLength(1);
  await expect.poll(() => kpiNumber(page, '[data-kpi="trucks"] [data-kpi-value]')).toBeGreaterThanOrEqual(1);
  // At 14:00 the oldest batch on hold, 12, passes its incubation and goes to the warehouse (H50).
  const oldest = ON_HOLD.at(-1);
  expect(oldest?.id, 'the oldest batch on hold').toBe(12);
  await expect
    .poll(async () => (await seen()).some((text) => /^Batch 12 passed incubation: \d+ pallets released to the warehouse$/.test(text)), {
      message: 'batch 12 released',
      timeout: 60_000,
    })
    .toBe(true);
  await expect.poll(() => kpiNumber(page, '[data-kpi-sub="released"]')).toBeGreaterThanOrEqual(1);
  // Packs, trays and pallets were made on the way, and every lamp still has a status.
  expect(await kpiNumber(page, '[data-kpi-sub="pallets"]'), 'pallets made').toBeGreaterThan(0);
  for (const button of await railState(page)) expect(button.lamps[0], `${button.testId} lamp`).toMatch(/^(ok|warn|bad|idle)$/);
});

test.describe('the batch list (stage 9)', () => {
  test('lists every batch in quarantine; a click on one, in the list or on its block in the 3D view, shows its pallets and SSCCs', async ({ page }) => {
    test.setTimeout(180_000);
    await openQuarantine(page);
    // 42 batches on hold (D11) and the two the fillers make now, oldest first.
    const rows = page.locator('[data-testid="batch-list"] .batch-row');
    await expect(rows).toHaveCount(STATIC_PACKS.batches.length);
    expect(STATIC_PACKS.batches.length).toBe(44);
    await expect(rows.first()).toHaveAttribute('data-batch-id', String(STATIC_PACKS.batches[0]?.id));
    await expect(batchDetail(page)).toContainText('Pick a batch');

    // From the list.
    const fromList = ON_HOLD[0];
    if (!fromList) throw new Error('no batch on hold');
    await batchRow(page, fromList.id).click();
    await expectBatchShown(page, fromList.id);
    await expect(batchRow(page, fromList.id).locator('.lamp')).toHaveAttribute('data-status', 'warn');

    // From its block: the first batch on hold whose block shows from the stage 9 camera, other than the one picked.
    let picked: { batchId: number; point: { x: number; y: number } } | null = null;
    for (const batch of ON_HOLD.slice(1)) {
      const point = await sceneCall(page, 'batchScreenPoint', batch.id);
      if (point) {
        picked = { batchId: batch.id, point };
        break;
      }
    }
    expect(picked, 'a batch block a click can reach from the stage 9 camera').not.toBeNull();
    if (!picked) return;
    await page.mouse.click(picked.point.x, picked.point.y);
    await expectBatchShown(page, picked.batchId);
    await expect(page.getByTestId('panel-title')).toHaveText(STAGES[8].name);
  });

  test('a failed QA sample blocks the batch at once, red in the list, on the rail and in the KPIs; a pass releases one at the end of its incubation', async ({ page }) => {
    test.setTimeout(180_000);
    await openQuarantine(page);
    const [failed, passed] = ON_HOLD;
    if (!failed || !passed) throw new Error('two batches on hold needed');
    const seen = await recordLog(page);

    await batchRow(page, failed.id).click();
    await expectBatchShown(page, failed.id);
    await page.getByRole('group', { name: `QA override for batch ${failed.id}` }).getByRole('button', { name: 'Sample failed' }).click();
    await expect(batchRow(page, failed.id).locator('.lamp')).toHaveAttribute('data-status', 'bad');
    await expect(batchDetail(page)).toContainText('Blocked');
    await expect(batchDetail(page)).toContainText('Failed');
    // A blocked batch takes no more override.
    await expect(page.getByRole('group', { name: `QA override for batch ${failed.id}` })).toHaveCount(0);
    await expect(railButton(page, 9).locator('[data-status]')).toHaveAttribute('data-status', 'bad');
    await expect.poll(() => kpiNumber(page, '[data-kpi-sub="blocked"]')).toBe(1);
    await expect.poll(async () => (await quarantineState(page))?.blocked).toBe(1);
    await expect
      .poll(async () => (await seen()).some((text) => text === `Batch ${failed.id} failed a QA sample: ${failed.pallets} pallets blocked`))
      .toBe(true);

    await batchRow(page, passed.id).click();
    await expectBatchShown(page, passed.id);
    await page.getByRole('group', { name: `QA override for batch ${passed.id}` }).getByRole('button', { name: 'Sample passed' }).click();
    await expect(batchDetail(page)).toContainText('Passed (override)');
    // Still on hold until its incubation ends.
    await expect(batchRow(page, passed.id).locator('.lamp')).toHaveAttribute('data-status', 'warn');
    await expect.poll(async () => (await seen()).some((text) => text.startsWith(`QA passed batch ${passed.id}: released when its incubation ends`))).toBe(true);
  });
});
