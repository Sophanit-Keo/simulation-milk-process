import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATIC_KPIS, formatted, waitForClock } from './helpers';

// The KPI strip (phase-2 shared spec): the eight slots of index.html, each with one [data-kpi-value]
// showing its formatted value from the snapshot, and the other KPIs of plan 06 as [data-kpi-sub]
// secondary values in the card they belong with; and the status lamps the HUD draws.
const KPI_SLOTS = ['uht', 'sterility', 'tank', 'packs', 'oee', 'hold', 'stock', 'trucks'] as const;
type KpiSlot = (typeof KPI_SLOTS)[number];

/** Each secondary value and the card it sits in. */
const KPI_SUBS = {
  diverted: 'uht',
  trays: 'packs',
  pallets: 'packs',
  released: 'hold',
  blocked: 'hold',
  cover: 'stock',
  fill: 'trucks',
} as const satisfies Record<string, KpiSlot>;
type KpiSub = keyof typeof KPI_SUBS;

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

/** The shape of each secondary value's text: a number, its unit if it has one, and what it counts. */
const SUB_SHAPES: Record<KpiSub, RegExp> = {
  diverted: new RegExp(`^${GROUPED} L diverted$`),
  trays: new RegExp(`^${GROUPED} trays? made$`),
  pallets: new RegExp(`^${GROUPED} pallets? made$`),
  released: new RegExp(`^${GROUPED} released$`),
  blocked: new RegExp(`^${GROUPED} blocked$`),
  cover: new RegExp(`^${GROUPED}\\.\\d days of cover$`),
  fill: /^order fill \d{1,3} %$/,
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

/** The secondary values on the static plant, which has none of them before phases 3 and 4: zeros, in words. */
const STATIC_SUB_TEXTS: Record<KpiSub, string> = {
  diverted: `${formatted(STATIC_KPIS.divertedL)} L diverted`,
  trays: `${formatted(STATIC_KPIS.traysMade)} trays made`,
  pallets: `${formatted(STATIC_KPIS.palletsMade)} pallets made`,
  released: `${formatted(STATIC_KPIS.batchesReleased)} released`,
  blocked: `${formatted(STATIC_KPIS.batchesBlocked)} blocked`,
  cover: `${formatted(STATIC_KPIS.daysOfCover, 1)} days of cover`,
  fill: `order fill ${formatted(STATIC_KPIS.orderFillPct)} %`,
};

/**
 * Widths where the strip once cut a value short, and the edges of its three layouts (app.css), with a
 * height. From 1101 px up the page is one screen, so it must not scroll there either.
 */
const STRIP_SIZES = [
  [721, 900],
  [768, 1024],
  [1100, 900],
  [1101, 720],
  [1120, 720],
  [1280, 720],
  [1440, 900],
] as const;

/** Each slot's [data-kpi-value] and each secondary value in its card: how many there are, and the text. */
async function kpiTexts(page: Page): Promise<Record<string, { count: number; text: string | null }>> {
  return page.evaluate(
    ({ slots, subs }) => {
      const read: Record<string, { count: number; text: string | null }> = {};
      const take = (key: string, selector: string): void => {
        const nodes = document.querySelectorAll(selector);
        read[key] = { count: nodes.length, text: nodes[0] ? (nodes[0].textContent ?? '').replace(/\s+/g, ' ').trim() : null };
      };
      for (const slot of slots) take(slot, `#kpis [data-kpi="${slot}"] [data-kpi-value]`);
      for (const [sub, slot] of Object.entries(subs)) take(`sub:${sub}`, `#kpis [data-kpi="${slot}"] [data-kpi-sub="${sub}"]`);
      return read;
    },
    { slots: KPI_SLOTS, subs: KPI_SUBS },
  );
}

/** Every name, value and secondary value in the strip that its box cuts short, with the fonts in. */
async function cutKpiTexts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.querySelectorAll('#kpis .k-l, #kpis [data-kpi-value], #kpis [data-kpi-sub]')]
      .filter((node) => node.scrollWidth > node.clientWidth)
      .map((node) => `${node.closest('[data-kpi]')?.getAttribute('data-kpi')}: "${node.textContent}" ${node.scrollWidth} > ${node.clientWidth} px`);
  });
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
      for (const [sub, slot] of Object.entries(KPI_SUBS) as [KpiSub, KpiSlot][]) {
        const { count, text } = read[`sub:${sub}`];
        expect(count, `secondary value ${sub} sits once in the ${slot} card`).toBe(1);
        expect(text, `secondary value ${sub}`).toMatch(SUB_SHAPES[sub]);
        if (path === '/') expect(text, `secondary value ${sub} on the static plant`).toBe(STATIC_SUB_TEXTS[sub]);
      }
    }).toPass({ timeout: 10_000 });
    // Contracts v1 has one OEE for the plant; the card says where OEE per filler went.
    await expect(page.locator('#kpis [data-kpi="oee"]')).toHaveAttribute('title', /OEE per filler arrives with the fillers in phase 4/);

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

test('the KPI strip cuts no value short from tablet to desktop widths, and one screen still fits', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  // The static plant's values in place, so the widths measured are theirs.
  await expect(page.locator('#kpis [data-kpi="sterility"] [data-kpi-value]')).toHaveText(STATIC_TEXTS.sterility);
  for (const [width, height] of STRIP_SIZES) {
    await page.setViewportSize({ width, height });
    expect(await cutKpiTexts(page), `KPI texts cut short at ${width} px`).toEqual([]);
    const scrolls = await page.evaluate(() => ({
      across: document.documentElement.scrollWidth > window.innerWidth,
      down: document.documentElement.scrollHeight > window.innerHeight,
    }));
    expect(scrolls.across, `the page scrolls sideways at ${width} × ${height}`).toBe(false);
    if (width > 1100) expect(scrolls.down, `the one-screen layout scrolls at ${width} × ${height}`).toBe(false);
  }
});
