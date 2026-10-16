import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATIC_KPIS, formatted, waitForClock } from './helpers';

// The KPI strip (phase-2 shared spec): the eight slots of index.html, each with one [data-kpi-value]
// showing its formatted value from the snapshot; and the status lamps the HUD draws.
const KPI_SLOTS = ['uht', 'sterility', 'tank', 'packs', 'oee', 'hold', 'stock', 'trucks'] as const;
type KpiSlot = (typeof KPI_SLOTS)[number];

/** A whole number with en-US grouping: "7", "15,000". */
const GROUPED = String.raw`\d{1,3}(?:,\d{3})*`;

/** The shape of each slot's text, whatever the numbers: a number, its unit, nothing else. */
const KPI_SHAPES: Record<KpiSlot, RegExp> = {
  uht: new RegExp(`^${GROUPED} L/h$`),
  sterility: /^F0 \d+\.\d{2} · B\* \d+\.\d{2}$/,
  tank: /^\d{1,3} %$/,
  packs: new RegExp(`^${GROUPED} /h$`),
  oee: /^\d{1,3} %$/,
  hold: new RegExp(`^${GROUPED}$`),
  stock: new RegExp(`^${GROUPED}$`),
  trucks: new RegExp(`^${GROUPED}$`),
};

/**
 * What the static plant shows. The first four are the shared spec's examples and the hand values behind
 * them (H11, H12, H31: 16,000 L/h through the UHT plant, F0 5.17 min and B* 1.19, the tank at its 50%
 * start, 2 × 7,500 packs/h). The model gives no OEE, batches, stock or trucks before phases 3 and 4,
 * so those follow the static snapshot.
 */
const STATIC_TEXTS: Record<KpiSlot, string> = {
  uht: '16,000 L/h',
  sterility: 'F0 5.17 · B* 1.19',
  tank: '50 %',
  packs: '15,000 /h',
  oee: `${formatted(STATIC_KPIS.oeePct)} %`,
  hold: formatted(STATIC_KPIS.batchesOnHold),
  stock: formatted(STATIC_KPIS.palletsInStock),
  trucks: formatted(STATIC_KPIS.trucksShipped),
};

/** Each slot's [data-kpi-value] count and text, read in one go. */
async function kpiTexts(page: Page): Promise<Record<string, { count: number; text: string | null }>> {
  return page.evaluate((slots) => {
    const read: Record<string, { count: number; text: string | null }> = {};
    for (const slot of slots) {
      const values = document.querySelectorAll(`#kpis [data-kpi="${slot}"] [data-kpi-value]`);
      read[slot] = { count: values.length, text: values[0] ? (values[0].textContent ?? '').replace(/\s+/g, ' ').trim() : null };
    }
    return read;
  }, KPI_SLOTS);
}

/** data-status of every lamp on screen (the rail's, the run state's in the bar), with where it sits. */
async function visibleLamps(page: Page): Promise<{ where: string; status: string | null }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.lamp')]
      .filter((lamp) => lamp.checkVisibility())
      .map((lamp) => ({
        where: lamp.closest('[data-testid]')?.getAttribute('data-testid') ?? lamp.closest('[id]')?.id ?? lamp.parentElement?.className ?? '?',
        status: lamp.getAttribute('data-status'),
      })),
  );
}

for (const path of ['/', '/?mock']) {
  test(`the KPI strip fills every slot with a formatted value, and every lamp has a status (${path})`, async ({ page }) => {
    await page.goto(path);
    await waitForClock(page);
    await expect(page.locator('#kpis [data-kpi]')).toHaveCount(KPI_SLOTS.length);
    await expect(async () => {
      const read = await kpiTexts(page);
      for (const slot of KPI_SLOTS) {
        expect(read[slot].count, `KPI ${slot} has one [data-kpi-value]`).toBe(1);
        expect(read[slot].text, `KPI ${slot}`).toMatch(KPI_SHAPES[slot]);
        if (path === '/') expect(read[slot].text, `KPI ${slot} on the static plant`).toBe(STATIC_TEXTS[slot]);
      }
    }).toPass({ timeout: 10_000 });

    await expect(async () => {
      const lamps = await visibleLamps(page);
      // Ten on the rail and one for the run state in the bar, at least.
      expect(lamps.length, 'lamps on screen').toBeGreaterThanOrEqual(11);
      for (const lamp of lamps) {
        // The static plant runs every stage and the clock: green everywhere. The mock may show any status.
        const expected = path === '/' ? 'ok' : expect.stringMatching(/^(ok|warn|bad|idle)$/);
        expect(lamp.status, `lamp in ${lamp.where}`).toEqual(expected);
      }
    }).toPass({ timeout: 10_000 });
  });
}
