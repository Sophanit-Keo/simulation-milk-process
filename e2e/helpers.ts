// Shared by the browser tests: the DOM hooks and the ?debug scene hook of the phase-2 shared spec,
// read the same way everywhere, plus the stage text and static values the app should show.
//
// Without a GPU (CI, the agents' machines) Chromium draws WebGL with SwiftShader on the CPU, at a few
// frames a second, and every Playwright action or locator check then costs a frame or more. So the
// helpers read what they check in one page.evaluate and retry that whole read, rather than polling
// one locator per detail. Console errors, page errors and failed requests are checked for every test
// by the fixtures (fixtures.ts), so no test needs to collect them itself.
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { parseStages, type PlantConfig, type StageInfo, type StageValueInfo } from '../src/contracts';
import { createSim } from '../src/sim';
import type { ThemePref } from '../src/ui/theme';
import { expect } from './fixtures';

/** The app's own data files, read as the app reads them (parseStages checks stages.json the same way). */
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const plantConfig = readJson('../src/data/plant.json') as PlantConfig;
export const STAGES: readonly StageInfo[] = parseStages(readJson('../src/data/stages.json'));

/**
 * Stage values and KPIs of the plant as it opens (the app without ?mock). They follow from plant.json alone,
 * and in steady production most don't change with sim time, so the panel and the KPI strip must show exactly
 * these whenever a test looks; the few that move are listed in LIVE_TOLERANCES.
 */
const staticSnapshot = createSim(plantConfig).snapshot();
export const STATIC_VALUES = staticSnapshot.stages;
export const STATIC_KPIS = staticSnapshot.kpis;
export const STATIC_PACKS = staticSnapshot.packs;

/**
 * Stage values that move with sim time even in steady production (phase 3's live line), and how far each
 * may stray from its opening value within a test, in its own unit: the UHT reading carries up to ±0.3 °C of
 * noise (D4), which moves F0 within 4.83–5.55 min and B* within 1.11–1.27 (H21, H22); the aseptic tank gains
 * 1,000 L/h (H31), so about 170 L in the 10 sim minutes of a minute at ×10; the silo drains between tankers.
 *
 * Stages 7–10 (phase 4) count up from the opening, so their bands are an hour of production (6 min of a
 * test at ×10): 15,000 packs and 30 rejects, 1,250 trays and about 15 pallets (H26, H38); the OEE falls from
 * 93.75% to 93.56% with the 0.2% rejects (H100); the next release and the next truck count down. Nothing
 * else changes in that hour: the first truck comes 100 min after the opening and the first release at
 * 14:00 (H50), and no filler breaks down before the truck.
 */
export const LIVE_TOLERANCES: Readonly<Partial<Record<number, Readonly<Record<string, number>>>>> = {
  1: { siloLevelPct: 10, mixTankLevelPct: 1 },
  4: { tempC: 0.3, f0Min: 0.4, bStar: 0.09 },
  6: { levelL: 1_000, levelPct: 5, headspaceBar: 0.05, nextCleanS: 3_600 },
  7: { oeeAPct: 0.25, oeeBPct: 0.25, packsMade: 15_000, packsRejected: 30 },
  8: { traysMade: 1_250, palletsMade: 15, queuePacks: 300 },
  9: { palletsInQuarantine: 15, nextReleaseS: 3_600 },
  10: { nextTruckS: 3_600 },
};

/** What the panel shows with no stage selected (src/ui/stagePanel.ts, the shared spec's "Select a stage"). */
export const NO_STAGE_TITLE = 'Select a stage';

/** Length of a fly in frame time (src/scene/cameraFlight.ts). */
const FLY_S = 1.2;
/**
 * Frames a fly takes at the least: main.ts counts no frame as longer than plant.json's maxFrameS, so
 * however slow the frames come, a fly lands after this many of them (12).
 */
const FLY_FRAMES = Math.ceil(FLY_S / plantConfig.clock.maxFrameS);
/** Slack on that frame count: frames run slower during a fly (close-ups, a first shader compile, a busy runner). */
const FLY_FRAME_SLACK = 4;
/** A fly may always take this long, however fast the frames: more than ten times its 1.2 s. */
const FLY_FLOOR_MS = 15_000;
/** The HUD updates 4 times a second of real time (plan 07; HUD_INTERVAL_S in src/main.ts). */
const HUD_INTERVAL_S = 0.25;
/** Retry budget for reading a selection back once the camera has landed (the HUD redraws 4 times a second). */
const SETTLE_MS = 10_000;

export const simClock = (page: Page): Locator => page.getByTestId('sim-clock');

/** The top-bar clock's sim time, or NaN while it is missing or not a number. */
export async function clockTimeS(page: Page): Promise<number> {
  const value = await simClock(page).getAttribute('data-time-s', { timeout: 1_000 }).catch(() => null);
  return value === null || value.trim() === '' ? Number.NaN : Number(value);
}

/** Waits until the clock shows a number, i.e. the HUD has drawn at least once. */
export async function waitForClock(page: Page): Promise<number> {
  await expect.poll(() => clockTimeS(page), { message: 'data-time-s is a number' }).toBeGreaterThanOrEqual(0);
  return clockTimeS(page);
}

/** Waits until the clock shows a time other than `fromS`: a HUD update has happened since `fromS` was read. */
export async function waitForClockToMove(page: Page, fromS: number): Promise<number> {
  await expect.poll(() => clockTimeS(page), { message: `data-time-s moves on from ${fromS}`, timeout: 15_000 }).not.toBe(fromS);
  return clockTimeS(page);
}

/**
 * Resolves once the frame loop has run long enough for the HUD to update at least once after any command
 * sent before the call, so what the HUD shows then comes from the sim's answer. main.ts runs the commands
 * at the start of the next frame and updates the HUD every 0.25 s of real time (the 3D view's machine
 * labels likewise). This counts the time between frames, each frame counting at most plant.json's
 * maxFrameS as the sim's steps do: that never runs ahead of real time, so the wait is a conservative bound
 * (longer than needed on frames slower than maxFrameS). Counting frames rather than waiting a fixed time
 * makes sure those frames have run: slow software-GL frames could outlast a fixed wait.
 */
export async function afterHudUpdates(page: Page): Promise<void> {
  await page.evaluate(
    ({ maxFrameS, needS }) =>
      new Promise<void>((resolve) => {
        let lastMs: number | null = null;
        let frameS = 0;
        const tick = (nowMs: number): void => {
          if (lastMs !== null) frameS += Math.min((nowMs - lastMs) / 1_000, maxFrameS);
          lastMs = nowMs;
          if (frameS >= needS) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    // The frame that runs the command, one HUD interval after it, and a frame's slack.
    { maxFrameS: plantConfig.clock.maxFrameS, needS: HUD_INTERVAL_S + 2 * plantConfig.clock.maxFrameS },
  );
}

/** Sim time and page time read together in the page, so a rate needs no round-trip guesswork. */
export async function clockAndNow(page: Page): Promise<{ timeS: number; nowMs: number }> {
  return page.evaluate(() => ({
    timeS: Number(document.querySelector('[data-testid="sim-clock"]')?.getAttribute('data-time-s') ?? Number.NaN),
    nowMs: performance.now(),
  }));
}

/**
 * Shows `theme` on an open page the way a viewer switches it: the theme button (data-testid theme-toggle), pressed
 * only when the page shows the other theme. The colour scheme the browser emulates no longer chooses the theme: a
 * page without a choice opens dark (src/ui/theme.ts).
 */
export async function showTheme(page: Page, theme: ThemePref): Promise<void> {
  const html = page.locator('html');
  if ((await html.getAttribute('data-theme')) !== theme) await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', theme);
}

export const railButton = (page: Page, stage: number): Locator => page.locator(`#rail [data-testid="rail-stage-${stage}"]`);
export const wholePlantButton = (page: Page): Locator => page.locator('#rail [data-testid="overview"]');
export const viewport = (page: Page): Locator => page.locator('#viewport');

/** Mean real time between the page's frames, over a few frames. */
export async function frameMs(page: Page, frames = 5): Promise<number> {
  return page.evaluate(
    (count) =>
      new Promise<number>((resolve) => {
        const timesMs: number[] = [];
        const tick = (timeMs: number): void => {
          timesMs.push(timeMs);
          if (timesMs.length > count) resolve((timesMs[count] - timesMs[0]) / count);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/**
 * How long a fly may take on this page: 15 s, or, where frames are so slow (software GL on a busy
 * machine) that 12 frames with fourfold slack take longer than that, the time those frames take.
 */
export async function flyBudgetMs(page: Page): Promise<number> {
  return Math.max(FLY_FLOOR_MS, FLY_FRAME_SLACK * FLY_FRAMES * (await frameMs(page)));
}

/** Waits for the camera to land on a stage (data-focus-stage), within the fly budget counted from the call. */
export async function expectLanded(page: Page, stage: number): Promise<void> {
  const startMs = Date.now();
  const budgetMs = await flyBudgetMs(page);
  await expect(viewport(page), `the camera lands on stage ${stage} within ${Math.round(budgetMs)} ms`).toHaveAttribute(
    'data-focus-stage',
    String(stage),
    { timeout: Math.max(1, budgetMs - (Date.now() - startMs)) },
  );
}

/** Records every value #viewport's data-flying takes from now on, however briefly (a MutationObserver). */
export async function recordFlying(page: Page): Promise<() => Promise<(string | null)[]>> {
  await page.evaluate(() => {
    const host = document.querySelector('#viewport');
    if (!host) throw new Error('no #viewport');
    const seen: (string | null)[] = [];
    (window as unknown as { flyingSeen: (string | null)[] }).flyingSeen = seen;
    new MutationObserver(() => seen.push(host.getAttribute('data-flying'))).observe(host, {
      attributes: true,
      attributeFilter: ['data-flying'],
    });
  });
  return () => page.evaluate(() => (window as unknown as { flyingSeen: (string | null)[] }).flyingSeen);
}

/** Waits for window.__scene (set by the scene on ?debug pages); read it with sceneCall. */
export async function waitForScene(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof (window as unknown as { __scene?: unknown }).__scene === 'object', undefined, {
    timeout: 15_000,
  });
}

/** The ?debug hook the scene sets on window (phase-2 shared spec). */
export interface SceneDebug {
  stageScreenPoint(stage: number): { x: number; y: number } | null;
  /** Client pixels where a click picks a quarantine batch's block (phase 4), or null. */
  batchScreenPoint(batchId: number): { x: number; y: number } | null;
  focusStage(): number | null;
  drawCalls(): number;
  triangles(): number;
  fps(): number;
  equipmentIds(): string[];
  /** What a machine shows now, e.g. { fillFrac } for a tank or { diverting, lamp, flagRad } for the divert valve (phase 3). */
  equipmentState(id: string): Record<string, number | string | boolean> | null;
  /** Whether the divert route is lit, and each line point's stripe offset in metres (phase 3). */
  pipeState(): { divertLit: boolean; phaseM: Record<string, number>; cleaning: string | null; cleanPhaseM: number };
}

/** Calls one method of window.__scene in the page. */
export async function sceneCall<K extends keyof SceneDebug>(
  page: Page,
  method: K,
  ...args: Parameters<SceneDebug[K]>
): Promise<ReturnType<SceneDebug[K]>> {
  return page.evaluate(
    ([name, callArgs]) => {
      const scene = (window as unknown as { __scene?: Record<string, (...a: unknown[]) => unknown> }).__scene;
      if (!scene) throw new Error('window.__scene is not set: open the page with ?debug');
      return scene[name](...callArgs);
    },
    [method, args] as [string, unknown[]],
  ) as Promise<ReturnType<SceneDebug[K]>>;
}

/**
 * A stage's screen point once the view holds still: two reads 200 ms apart that agree. At load the
 * overview refits as the layout settles (fonts, the canvas size), and a point read mid-refit would be stale.
 * `why` says what a missing point would mean, for the failure message.
 */
export async function steadyStagePoint(page: Page, stage: number, why = ''): Promise<{ x: number; y: number }> {
  const seen: { last: { x: number; y: number } | null } = { last: null };
  await expect
    .poll(
      async () => {
        const point = await sceneCall(page, 'stageScreenPoint', stage);
        const { last } = seen;
        seen.last = point;
        return point !== null && last !== null && Math.abs(point.x - last.x) < 0.5 && Math.abs(point.y - last.y) < 0.5;
      },
      { message: `stageScreenPoint(${stage}) is a point and holds still${why ? ` (${why})` : ''}`, intervals: [200], timeout: 15_000 },
    )
    .toBe(true);
  if (!seen.last) throw new Error('unreachable: the poll above saw a point');
  return seen.last;
}

/** A number as the HUD writes it (en-US grouping, fixed decimals), e.g. "16,000" or "140.0". */
export function formatted(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/**
 * A value row's text on the static plant, as the shared spec gives it: label, number scaled and rounded
 * to its decimals, unit, e.g. "Holding-tube outlet 140.0 °C" or "Fillers 2".
 */
export function staticRowText(stage: StageInfo, value: StageValueInfo): string {
  const number = formatted(STATIC_VALUES[stage.id].values[value.key] * (value.scale ?? 1), value.decimals);
  return value.unit ? `${value.label} ${number} ${value.unit}` : `${value.label} ${number}`;
}

/** One rail button as the spec describes it. */
export interface RailButtonState {
  tag: string;
  testId: string | null;
  stage: string | null;
  text: string;
  /** data-status of every element inside the button that has one: its lamp. */
  lamps: (string | null)[];
  current: string | null;
}

/** Every rail button, in DOM order, read in one go. */
export async function railState(page: Page): Promise<RailButtonState[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#rail [data-testid^="rail-stage-"]')].map((button) => ({
      tag: button.tagName,
      testId: button.getAttribute('data-testid'),
      stage: button.getAttribute('data-stage'),
      text: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
      lamps: [...button.querySelectorAll('[data-status]')].map((lamp) => lamp.getAttribute('data-status')),
      current: button.getAttribute('aria-current'),
    })),
  );
}

/** What a selection shows across the page, read in one go: the camera hooks, the rail mark and the panel. */
export interface SelectionState {
  focusStage: string | null;
  flying: string | null;
  /** data-stage and aria-current of each rail button that has aria-current. */
  current: { stage: string | null; value: string | null }[];
  title: string;
  description: string;
  rows: { key: string; text: string }[];
  /** The how-to list of the empty panel is on screen. */
  howToShown: boolean;
}

export async function selectionState(page: Page): Promise<SelectionState> {
  return page.evaluate(() => {
    const text = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const host = document.querySelector('#viewport');
    const panel = document.querySelector('#panel');
    const howTo = panel?.querySelector('[aria-label="How to use"]');
    return {
      focusStage: host?.getAttribute('data-focus-stage') ?? null,
      flying: host?.getAttribute('data-flying') ?? null,
      current: [...document.querySelectorAll('#rail [data-testid^="rail-stage-"][aria-current]')].map((button) => ({
        stage: button.getAttribute('data-stage'),
        value: button.getAttribute('aria-current'),
      })),
      title: text(panel?.querySelector('[data-testid="panel-title"]')),
      description: text(panel?.querySelector('[data-testid="panel-description"]')),
      rows: [...(panel?.querySelectorAll('[data-value-key]') ?? [])]
        .filter((row) => row.checkVisibility())
        .map((row) => ({ key: row.getAttribute('data-value-key') ?? '', text: text(row) })),
      howToShown: howTo?.checkVisibility() ?? false,
    };
  });
}

export interface SelectedOptions {
  /**
   * Also check each row shows the plant's opening value (only for the app without ?mock): exactly, or within
   * its band for the values in LIVE_TOLERANCES.
   */
  staticValues?: boolean;
}

/**
 * Everything a selected stage shows (phase-2 shared spec): the camera lands on it within the fly budget
 * (checked first, so the time counts from the click), its rail button alone has aria-current="true", and
 * the panel has its name, description and one row per value, each with its label, a number and its unit
 * (on the static plant, the exact text: "Holding-tube outlet 140.0 °C").
 */
export async function expectSelected(page: Page, stage: StageInfo, options: SelectedOptions = {}): Promise<void> {
  await expectLanded(page, stage.id);
  await expect(async () => {
    const shown = await selectionState(page);
    expect(shown.focusStage, 'data-focus-stage').toBe(String(stage.id));
    expect(shown.flying, 'the camera is no longer flying').toBeNull();
    expect(shown.current, `rail-stage-${stage.id} alone is current`).toEqual([{ stage: String(stage.id), value: 'true' }]);
    expect(shown.title, 'panel-title').toBe(stage.name);
    expect(shown.description, 'panel-description').toBe(stage.description);
    expect(shown.howToShown, 'the how-to is hidden while a stage is shown').toBe(false);
    // One row per value, in stages.json order, and no rows left over from the stage shown before.
    expect(
      shown.rows.map((row) => row.key),
      'data-value-key rows',
    ).toEqual(stage.values.map((value) => value.key));
    for (const [index, value] of stage.values.entries()) {
      const row = shown.rows[index];
      const liveTolerance = LIVE_TOLERANCES[stage.id]?.[value.key];
      if (options.staticValues && liveTolerance === undefined) {
        expect(row.text, `row ${value.key}`).toBe(staticRowText(stage, value));
      } else if (options.staticValues && liveTolerance !== undefined) {
        // A live value: its label and unit, and a number within its band of the opening value (plus rounding).
        const unit = value.unit ? ` ${value.unit}` : '';
        expect(row.text.startsWith(`${value.label} `) && row.text.endsWith(unit), `row ${value.key}: ${row.text}`).toBe(true);
        const shown = Number(row.text.slice(value.label.length, row.text.length - unit.length).replace(/,/g, ''));
        const scale = value.scale ?? 1;
        const opening = STATIC_VALUES[stage.id].values[value.key] * scale;
        expect(Math.abs(shown - opening), `row ${value.key}: ${row.text}, opening ${opening}`).toBeLessThanOrEqual(
          liveTolerance * scale + 10 ** -value.decimals,
        );
      } else {
        expect(row.text, `row ${value.key} shows its label`).toContain(value.label);
        expect(row.text, `row ${value.key} shows a number`).toMatch(/\d/);
        if (value.unit) expect(row.text, `row ${value.key} shows its unit`).toContain(value.unit);
      }
    }
  }, `stage ${stage.id} (${stage.shortName}) is selected on the rail and in the panel`).toPass({ timeout: SETTLE_MS });
}

/**
 * The whole-plant view (the overview event): the camera has flown home and landed, so #viewport has
 * neither data-flying nor data-focus-stage; no rail button is current; the panel is back to "Select a
 * stage" with its hint and how-to, and no value rows. The fly home gets the fly budget.
 */
export async function expectOverview(page: Page): Promise<void> {
  const budgetMs = await flyBudgetMs(page);
  await expect(async () => {
    const shown = await selectionState(page);
    expect(shown.flying, 'data-flying once the camera is home').toBeNull();
    expect(shown.focusStage, 'data-focus-stage at the overview').toBeNull();
    expect(shown.current, 'no rail button is current').toEqual([]);
    expect(shown.title, 'panel-title').toBe(NO_STAGE_TITLE);
    expect(shown.description, 'the panel hint').toMatch(/click a machine/i);
    expect(shown.howToShown, 'the how-to is back').toBe(true);
    expect(shown.rows, 'no value rows').toEqual([]);
  }, 'the whole plant is shown: no stage selected, the camera home').toPass({ timeout: budgetMs });
}
