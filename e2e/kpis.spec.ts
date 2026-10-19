import type { Page } from '@playwright/test';
import type { Kpis } from '../src/contracts';
import { formatKpi, kpiSubText, type KpiText } from '../src/ui/format';
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
 * What the plant shows as it opens. The first four are the shared spec's examples and the hand values behind
 * them (H11, H12, H31: 16,000 L/h through the UHT plant, F0 5.17 min and B* 1.19, the tank at its 50%
 * start, 2 × 7,500 packs/h); since phase 3, F0, B* and the tank move with sim time (LIVE_SLOTS). The model
 * gives no OEE, batches, stock or trucks before phase 4, so those follow the static snapshot.
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

/**
 * KPIs that move with sim time on the live plant (phase 3), each checked against its band rather than one
 * text: the UHT reading carries up to ±0.3 °C of noise (D4), so F0 shows 4.83–5.55 min and B* 1.11–1.27
 * (H21, H22) around the opening "F0 5.17 · B* 1.19"; the aseptic tank gains 1,000 L/h (H31), about 1% in
 * 12 sim minutes, from its opening 50 %.
 */
const LIVE_SLOTS: Partial<Record<KpiSlot, (text: string) => void>> = {
  sterility(text) {
    const match = /^F0 (\d+\.\d{2}) · B\* (\d+\.\d{2})$/.exec(text);
    expect(match, `sterility text ${text}`).not.toBeNull();
    const [f0Min, bStar] = [Number(match?.[1]), Number(match?.[2])];
    expect(f0Min, `F0 in ${text}`).toBeGreaterThanOrEqual(4.83);
    expect(f0Min, `F0 in ${text}`).toBeLessThanOrEqual(5.55);
    expect(bStar, `B* in ${text}`).toBeGreaterThanOrEqual(1.11);
    expect(bStar, `B* in ${text}`).toBeLessThanOrEqual(1.27);
  },
  tank(text) {
    const levelPct = Number(/^(\d{1,3}) %$/.exec(text)?.[1]);
    expect(levelPct, `tank level ${text}`).toBeGreaterThanOrEqual(50);
    expect(levelPct, `tank level ${text}`).toBeLessThanOrEqual(52);
  },
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
 * The longest values a run reaches by phase 4, which the strip must show whole: F0 with two digits (the
 * UHT throttled to half rate gives "F0 10.64"), and the totals of a long run. The static plant's values
 * are much shorter ("0 trays made"), so the width test writes these into the strip as well.
 */
const LONG_KPIS: Kpis = {
  uhtFlowLph: 16_000,
  f0Min: 99.99,
  bStar: 9.99,
  divertedL: 999_999,
  tankLevelPct: 100,
  packsPerH: 15_000,
  oeePct: 100,
  traysMade: 9_999_999,
  palletsMade: 99_999,
  batchesOnHold: 999,
  batchesReleased: 999,
  batchesBlocked: 999,
  palletsInStock: 9_999,
  daysOfCover: 99.9,
  orderFillPct: 100,
  trucksShipped: 9_999,
};

/** LONG_KPIS as the strip writes them: each slot's text runs (formatKpi), each secondary value's text. */
interface StripTexts {
  values: Record<string, KpiText>;
  subs: Record<string, string>;
}
const LONG_TEXTS: StripTexts = {
  values: Object.fromEntries(KPI_SLOTS.map((slot) => [slot, formatKpi(slot, LONG_KPIS)])),
  subs: Object.fromEntries(Object.keys(KPI_SUBS).map((sub) => [sub, kpiSubText(sub as KpiSub, LONG_KPIS)])),
};

/**
 * Widths where the strip once cut a value short (the sterility card at 1101–1119 px with two-digit F0, the
 * packs card up to 1145 px with a million trays), and the edges of its layouts (app.css), with a height.
 * From 1101 px up the page is one screen, so it must not scroll there either.
 */
const STRIP_SIZES = [
  [721, 900],
  [768, 1024],
  [1100, 900],
  [1101, 720],
  [1110, 720],
  [1119, 720],
  [1145, 720],
  [1259, 720],
  [1260, 720],
  [1280, 720],
  [1366, 768],
  [1440, 900],
] as const;

/** From this width (app.css) the strip has room for a card's two secondary values on one line. */
const SUBS_ON_ONE_LINE_FROM_PX = 1260;

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

/** The faces the strip's text uses (app.css): names and their units, values, secondary values. */
const STRIP_FONTS = ['600 12.5px "Barlow Condensed"', '500 12.5px "Barlow Condensed"', '500 19px "IBM Plex Mono"', '400 12.5px Barlow'];

/** What the strip shows at one size: the texts its box cuts short, and how many secondary lines each card has. */
interface StripFit {
  cut: string[];
  subLines: Record<string, number>;
}

/**
 * Reads the strip, with its fonts loaded, as it is and with `texts` written into it. The texts go in, are
 * measured and come out again in one synchronous run, so no HUD update can overwrite them in between.
 */
async function stripFit(page: Page, texts: StripTexts): Promise<{ fontsIn: boolean; shown: StripFit; long: StripFit }> {
  return page.evaluate(async ({ values, subs, fonts }) => {
    // Loaded even where no text on screen uses a face yet, so no width is measured in a fallback font.
    await Promise.all(fonts.map((font) => document.fonts.load(font)));
    const fontsIn = fonts.every((font) => document.fonts.check(font));
    const textWidthPx = (node: Element): number => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().width;
    };
    const measure = (): StripFit => {
      // scrollWidth and clientWidth are whole pixels and miss a cut of under a pixel, which still draws the
      // ellipsis; the text's own width against its box's does not. (Less than 1/64 px is layout rounding.)
      const cut = [...document.querySelectorAll('#kpis .k-l, #kpis .k-v, #kpis .k-s, #kpis .k-s > *')]
        .map((node) => ({ node, textPx: textWidthPx(node), boxPx: node.getBoundingClientRect().width }))
        .filter(({ node, textPx, boxPx }) => node.scrollWidth > node.clientWidth || textPx - boxPx > 0.01)
        .map(({ node, textPx, boxPx }) => `${node.closest('[data-kpi]')?.getAttribute('data-kpi')}: "${node.textContent}" ${textPx.toFixed(2)} > ${boxPx.toFixed(2)} px`);
      const subLines: Record<string, number> = {};
      for (const card of document.querySelectorAll('#kpis [data-kpi]')) {
        subLines[card.getAttribute('data-kpi') ?? '?'] = [...card.querySelectorAll('.k-s')].reduce(
          (lines, line) => lines + Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)),
          0,
        );
      }
      return { cut, subLines };
    };
    const shown = measure();
    const kept: [Element, Node[]][] = [];
    for (const [slot, runs] of Object.entries(values)) {
      const node = document.querySelector(`#kpis [data-kpi="${slot}"] [data-kpi-value]`);
      if (!node) continue;
      kept.push([node, [...node.childNodes]]);
      // As kpiStrip.ts writes them: units and names in <small>.
      node.replaceChildren(...runs.map((run) => (run.small ? Object.assign(document.createElement('small'), { textContent: run.text }) : run.text)));
    }
    for (const [sub, text] of Object.entries(subs)) {
      const node = document.querySelector(`#kpis [data-kpi-sub="${sub}"]`);
      if (!node) continue;
      kept.push([node, [...node.childNodes]]);
      node.textContent = text;
    }
    const long = measure();
    for (const [node, children] of kept) node.replaceChildren(...children);
    return { fontsIn, shown, long };
  }, { ...texts, fonts: STRIP_FONTS });
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
        const live = LIVE_SLOTS[slot];
        if (path === '/' && live) live(read[slot].text ?? '');
        else if (path === '/') expect(read[slot].text, `KPI ${slot} on the static plant`).toBe(STATIC_TEXTS[slot]);
      }
      for (const [sub, slot] of Object.entries(KPI_SUBS) as [KpiSub, KpiSlot][]) {
        const { count, text } = read[`sub:${sub}`];
        expect(count, `secondary value ${sub} sits once in the ${slot} card`).toBe(1);
        expect(text, `secondary value ${sub}`).toMatch(SUB_SHAPES[sub]);
        if (path === '/') expect(text, `secondary value ${sub} on the static plant`).toBe(STATIC_SUB_TEXTS[sub]);
      }
    }).toPass({ timeout: 10_000 });
    // Contracts v1 has one OEE, the whole plant's, and the card says so on screen, not in a tooltip.
    await expect(page.locator('#kpis [data-kpi="oee"] .k-s')).toHaveText('whole plant');
    await expect(page.locator('#kpis [data-kpi="oee"] .k-s')).toBeVisible();

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

test('the KPI strip cuts no value short from tablet to desktop widths, even the longest, and one screen still fits', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  // The live plant's values in place, so the first widths measured are theirs.
  await expect(page.locator('#kpis [data-kpi="sterility"] [data-kpi-value]')).toHaveText(KPI_SHAPES.sterility);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [width, height] of STRIP_SIZES) {
      const size = `${width} × ${height} (${colorScheme})`;
      await page.setViewportSize({ width, height });
      const { fontsIn, shown, long } = await stripFit(page, LONG_TEXTS);
      expect(fontsIn, `the strip's fonts are loaded at ${size}`).toBe(true);
      expect(shown.cut, `KPI texts cut short at ${size}`).toEqual([]);
      expect(long.cut, `the longest KPI texts cut short at ${size}`).toEqual([]);
      if (width >= SUBS_ON_ONE_LINE_FROM_PX) {
        // So the strip is one secondary line tall, and the 3D view keeps the rest.
        for (const [slot, lines] of Object.entries(long.subLines)) {
          expect(lines, `secondary lines in the ${slot} card at ${size}`).toBeLessThanOrEqual(1);
        }
        // On one line the pair's two values need the separator app.css draws between them.
        const separators = await page.$$eval('#kpis .k-pair > * + *', (spans) =>
          spans.map((span) => getComputedStyle(span, '::before').content),
        );
        expect(separators, `separators between paired values at ${size}`).toEqual(['" · "', '" · "']);
      } else if (width > 1100) {
        // Below the breakpoint the pairs must stack: the long pairs need about 1,220 px on one line, so a
        // breakpoint moved lower than SUBS_ON_ONE_LINE_FROM_PX would cut them (and B*) short again.
        expect(long.subLines.packs, `secondary lines in the packs card at ${size}`).toBe(2);
        expect(long.subLines.hold, `secondary lines in the hold card at ${size}`).toBe(2);
      }
      const scrolls = await page.evaluate(() => ({
        across: document.documentElement.scrollWidth > window.innerWidth,
        down: document.documentElement.scrollHeight > window.innerHeight,
      }));
      expect(scrolls.across, `the page scrolls sideways at ${size}`).toBe(false);
      if (width > 1100) expect(scrolls.down, `the one-screen layout scrolls at ${size}`).toBe(false);
    }
  }
});
