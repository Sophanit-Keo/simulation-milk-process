#!/usr/bin/env node
// Performance baseline of the 3D view (plan/agent-plan/phase-2-grey-box.md, qa lane; results in
// tests/perf/baseline.md). Not part of `npm test` or `npm run check`: it needs a build and a browser.
//
//   npm run build
//   node tests/perf/measure.mjs [port | url] [--width 1440] [--height 900] [--hold 2] [--samples 3] [--headed] [--channel chrome]
//
// With a port (5505 if none is given) it serves dist/ with `vite preview --strictPort` on that port and
// stops it afterwards; with a URL it measures an app that is already running there. It opens the app
// with ?debug in Chromium and waits at the overview until the draw calls and triangles hold still for
// `--hold` seconds: the Kenney conveyor pieces and the vehicles load about a second after the first
// frame and change both counts. Then it selects each stage on the rail, waits for the camera to land
// (#viewport[data-focus-stage]) and for the counts to hold still again. At each stop it reads
// window.__scene (src/scene/debugHook.ts): draw calls and triangles of the last frame (renderer.info,
// shadow pass included) and fps averaged over the last second, `--samples` times one second apart.
// It prints one JSON object on stdout.
//
// Draw calls and triangles depend on the scene and the camera only. fps depends on the GPU: without one,
// Chromium draws with SwiftShader on the CPU (`gl.software` in the output says so), and those numbers say
// nothing about a real machine. --headed, and --channel chrome to use the installed Chrome, put the
// measurement on the real GPU of a desktop.
//
// Exit codes: 0 measured, within the overview draw-call budget and without page errors; 1 over the
// budget or the page logged errors; 2 could not measure.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { machine } from './machine.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_PORT = 5505; // the qa lane's port
/** The grey-box plant's budget at the overview (phase 2 task card): about 350 draw calls. */
const OVERVIEW_DRAW_CALL_BUDGET = 350;
/** And the frame rate it must hold on a mid-range laptop (plan 07, gate G1). */
const FPS_TARGET = 60;
const SERVER_START_MS = 30_000;
/** A fly lasts 1.2 s of frame time; software GL stretches that to 12 slow frames, so wait long. */
const LAND_TIMEOUT_MS = 60_000;
/** How long the counts may take to settle at a stop before the script gives up. */
const SETTLE_TIMEOUT_MS = 60_000;
/** Counts are read this often while waiting for them to hold still. */
const POLL_MS = 250;
/** Draw calls and triangles at a stop hold still for this long before it is measured. */
const STOP_HOLD_S = 1;
/**
 * The browser's own note on software GL, not the app's (the same as BROWSER_GL_NOTES in e2e/fixtures.ts):
 * headless Chromium composites in software and reads every WebGL frame back.
 */
const BROWSER_GL_NOTE =
  /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/;

function usage(message) {
  if (message) console.error(`measure.mjs: ${message}`);
  console.error(
    'usage: node tests/perf/measure.mjs [port | url] [--width px] [--height px] [--hold s] [--samples n] [--headed] [--channel chrome]',
  );
  process.exit(2);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        width: { type: 'string', default: '1440' },
        height: { type: 'string', default: '900' },
        hold: { type: 'string', default: '2' },
        samples: { type: 'string', default: '3' },
        headed: { type: 'boolean', default: false },
        channel: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    usage(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) usage();
  if (positionals.length > 1) usage('give one port or one URL');
  const number = (name, min) => {
    const value = Number(values[name]);
    if (!Number.isFinite(value) || value < min) usage(`--${name} must be a number ≥ ${min}`);
    return value;
  };
  const target = positionals[0] ?? String(DEFAULT_PORT);
  let url = null;
  let port = null;
  if (/^\d+$/.test(target)) {
    port = Number(target);
    if (port < 1 || port > 65_535) usage(`no such port: ${target}`);
  } else {
    try {
      url = new URL(target);
    } catch {
      usage(`not a port or a URL: ${target}`);
    }
  }
  return {
    port,
    url,
    width: number('width', 320),
    height: number('height', 240),
    holdS: number('hold', 0.5),
    samples: Math.round(number('samples', 1)),
    headed: values.headed,
    channel: values.channel,
  };
}

/** `vite preview` of dist/ on the port, resolved once it answers; rejects if it exits or stays silent. */
async function startPreview(port) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html is missing: run `npm run build` first');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const url = new URL(`http://127.0.0.1:${port}/`);
  const deadline = Date.now() + SERVER_START_MS;
  for (;;) {
    const code = await Promise.race([exited, sleep(250).then(() => undefined)]);
    if (code !== undefined) throw new Error(`vite preview exited (${code}):\n${output.trim()}`);
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill('SIGTERM') };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`vite preview did not answer on port ${port} within ${SERVER_START_MS / 1000} s:\n${output.trim()}`);
    }
  }
}

/** The WebGL renderer the page gets, from a context of its own (the app's is not exposed). */
function readGl() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { vendor: null, renderer: null, software: null };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { vendor, renderer, software: /swiftshader|llvmpipe|software|softpipe/i.test(`${vendor} ${renderer}`) };
}

const readCounts = (page) => page.evaluate(() => ({ drawCalls: window.__scene.drawCalls(), triangles: window.__scene.triangles() }));

/**
 * Waits until the draw calls and triangles have not changed for holdS, and returns them with the time
 * that took. Counts of a frame that drew nothing yet (0 calls) never count as settled.
 */
async function settledCounts(page, holdS) {
  const startMs = Date.now();
  let last = await readCounts(page);
  let sinceMs = Date.now();
  for (;;) {
    await sleep(POLL_MS);
    const now = await readCounts(page);
    if (now.drawCalls !== last.drawCalls || now.triangles !== last.triangles || now.drawCalls === 0) {
      last = now;
      sinceMs = Date.now();
    } else if (Date.now() - sinceMs >= holdS * 1_000) {
      return { ...now, settledAfterS: Math.round((sinceMs - startMs) / 100) / 10 };
    }
    if (Date.now() - startMs > SETTLE_TIMEOUT_MS) {
      throw new Error(`draw calls and triangles did not hold still for ${holdS} s within ${SETTLE_TIMEOUT_MS / 1000} s`);
    }
  }
}

/** fps averaged over `samples` seconds, one reading of the last second's average per second. */
async function readFps(page, samples) {
  const fps = [];
  for (let i = 0; i < samples; i++) {
    await sleep(1_000);
    fps.push(await page.evaluate(() => window.__scene.fps()));
  }
  const mean = fps.reduce((sum, value) => sum + value, 0) / fps.length;
  return { fps: Math.round(mean * 10) / 10, fpsSamples: fps.map((value) => Math.round(value * 10) / 10) };
}

async function measure(appUrl, options) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    headless: !options.headed,
    channel: options.channel,
    // Without a GPU, recent Chromium only falls back to software WebGL with this flag.
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height } });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      if (message.type() === 'warning' && BROWSER_GL_NOTE.test(message.text())) return;
      errors.push(`console.${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`request failed: ${request.url()} (${request.failure()?.errorText})`));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });

    const url = new URL(appUrl);
    url.searchParams.set('debug', '');
    await page.goto(url.href);
    await page.waitForFunction(() => typeof window.__scene === 'object' && window.__scene.drawCalls() > 0, undefined, {
      timeout: 60_000,
    });
    // The first frames, before the conveyor pieces and the vehicles have loaded.
    const firstFrames = await readCounts(page);
    const gl = await page.evaluate(readGl);
    const equipmentIds = await page.evaluate(() => window.__scene.equipmentIds());
    const stages = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'stages.json'), 'utf8')).map(({ id, shortName }) => ({
      stage: id,
      name: shortName,
    }));

    // Every model and texture fetched, then the counts hold still: the settled overview.
    await page.waitForLoadState('networkidle');
    const overview = { ...(await settledCounts(page, options.holdS)), ...(await readFps(page, options.samples)) };

    const stops = [];
    for (const { stage, name } of stages) {
      await page.click(`#rail [data-testid="rail-stage-${stage}"]`);
      await page.waitForSelector(`#viewport[data-focus-stage="${stage}"]`, { timeout: LAND_TIMEOUT_MS });
      stops.push({ stage, name, ...(await settledCounts(page, STOP_HOLD_S)), ...(await readFps(page, options.samples)) });
    }
    return {
      browser: `${options.channel ?? 'chromium'} ${browser.version()}${options.headed ? '' : ' (headless)'}`,
      gl,
      equipment: equipmentIds.length,
      firstFrames,
      overview,
      stages: stops,
      errors,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = readOptions();
  let server = null;
  try {
    if (options.port !== null) server = await startPreview(options.port);
    const appUrl = server ? server.url : options.url;
    const result = await measure(appUrl, options);
    const withinBudget = result.overview.drawCalls <= OVERVIEW_DRAW_CALL_BUDGET;
    const report = {
      measuredAt: new Date().toISOString(),
      url: appUrl.href,
      viewport: { width: options.width, height: options.height },
      machine: machine(),
      ...result,
      budget: { overviewDrawCalls: OVERVIEW_DRAW_CALL_BUDGET, fps: FPS_TARGET },
      withinDrawCallBudget: withinBudget,
      // fps on software GL is the CPU drawing pixels: no verdict on the 60 fps target from it.
      fpsTargetMet: result.gl.software === false ? result.overview.fps >= FPS_TARGET - 1 : null,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = withinBudget && result.errors.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`measure.mjs: ${error.message}`);
    process.exitCode = 2;
  } finally {
    server?.stop();
  }
}

await main();
