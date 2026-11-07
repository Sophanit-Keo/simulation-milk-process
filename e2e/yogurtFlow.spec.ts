import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { railButton, showOnRail, waitForClock } from './helpers';

// Phase 22 in the browser, on the live sim: each yogurt stage's panel shows its process flow, the steps of
// src/data/yogurtFlow.json in order, each with its live reading and what happens there, on a track whose dots run where
// the product moves and stop while the sim is paused. A HEPA loss turns Line P8's steps red. The states themselves are
// the unit tests' (tests/ui/processFlow.test.ts); here only what shows on screen.

const FLOW = (JSON.parse(readFileSync(new URL('../src/data/yogurtFlow.json', import.meta.url), 'utf8')) as { stages: { stage: number; steps: { id: string; name: string }[] }[] }).stages;
const flow = (page: Page) => page.getByTestId('process-flow');
const step = (page: Page, id: string) => flow(page).locator(`.flow-step[data-step="${id}"]`);
/** The animation on a step's track (its ::before), and whether it runs. */
const trackAnimation = (page: Page, id: string) =>
  step(page, id).evaluate((node) => {
    const style = getComputedStyle(node, '::before');
    return { name: style.animationName, playState: style.animationPlayState };
  });

async function select(page: Page, stage: number): Promise<void> {
  await showOnRail(page, stage);
  await railButton(page, stage).click();
  await expect(railButton(page, stage)).toHaveAttribute('aria-current', 'true');
}

test('each yogurt stage shows its process flow, step by step, with a live reading at each step', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await waitForClock(page);
  for (const { stage, steps } of FLOW) {
    await select(page, stage);
    await expect(flow(page)).toHaveAttribute('data-stage', String(stage));
    await expect(flow(page).getByRole('heading', { name: 'Process flow' })).toBeVisible();
    await expect(flow(page).locator('.flow-name')).toHaveText(steps.map((each) => each.name));
    // Every step reads something live, and says what happens there.
    for (const reading of await flow(page).locator('.flow-reading').allTextContents()) expect(reading.trim(), `stage ${stage}`).not.toBe('—');
    await expect(flow(page).locator('.flow-does')).toHaveCount(steps.length);
  }
  // The opening on stage 13: tank 1 empties into the buffer, set yogurt's route is not this shift's.
  await select(page, 13);
  await expect(step(page, 'tank1')).toHaveAttribute('data-state', 'flow');
  await expect(step(page, 'tank1').locator('.flow-reading')).toContainText('Emptying to the buffer');
  await expect(step(page, 'setRoute')).toHaveAttribute('data-state', 'skip');
});

test('the track\'s dots run where the product moves and stop while the sim is paused; a HEPA loss turns P8\'s steps red', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await waitForClock(page);
  await select(page, 15);
  await expect(step(page, 'filler')).toHaveAttribute('data-state', 'flow', { timeout: 30_000 });
  await expect.poll(() => trackAnimation(page, 'filler')).toEqual({ name: 'flow-dots', playState: 'running' });
  await expect(flow(page)).toHaveAttribute('style', /--flow-s: 1\.60s/);
  await page.keyboard.press('Space');
  await expect(flow(page)).toHaveAttribute('data-paused', 'true');
  await expect.poll(() => trackAnimation(page, 'filler')).toEqual({ name: 'flow-dots', playState: 'paused' });
  await page.keyboard.press('Space');
  await expect(flow(page)).toHaveAttribute('data-paused', 'false');

  await page.getByTestId('scenario-menu').click();
  await page.locator('#scenario-menu-list [data-scenario="yogurtHepaLoss"]').click();
  await expect(step(page, 'decontamination')).toHaveAttribute('data-state', 'bad');
  await expect(step(page, 'decontamination').locator('.flow-reading')).toHaveText('HEPA cabin +5.0 Pa, under +15 Pa');
  await expect(step(page, 'filler').locator('.flow-reading')).toHaveText('Stopped: the HEPA cabin');
  // A stopped track has no dots running.
  await expect.poll(() => trackAnimation(page, 'filler')).toMatchObject({ name: 'none' });
});
