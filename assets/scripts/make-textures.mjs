#!/usr/bin/env node
// Draws the token textures (plan 05: plain, brand-free carton, tray and pallet prints) as SVG and
// renders them to PNG in Playwright's Chromium, so they can be changed and regenerated here:
//
//   node assets/scripts/make-textures.mjs [--out public/textures]
//
// - carton.png 128×256: the front face of a 1 L brick (95 × 195 mm), white print with an invented
//   logo, "SIM DAIRY", that no real dairy uses.
// - tray.png 256×256: a shrink-wrapped tray seen from the side: four packs over a cardboard base,
//   under clear film with highlights.
// - pallet.png 256×256: the top deck of a wooden pallet: five boards, gaps and nail heads.
//
// The colours are baked in, so a material drawing them should be white (0xffffff); the shared
// 'wood' or 'carton' colours would tint them a second time. The text uses Barlow Condensed from
// node_modules/@fontsource (SIL OFL 1.1, the app's own UI font), embedded in the page, so the result
// doesn't depend on the fonts installed. The page loads nothing from the network.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const FONT_DIR = join(repoRoot, 'node_modules', '@fontsource', 'barlow-condensed', 'files');
const FONT_WEIGHTS = [500, 600, 800];

/** Ink colours for the invented brand: two blues, as the plant's own UI uses. */
const INK = { blue: '#1d5a96', lightBlue: '#2f74b5', grey: '#4a5560', paper: '#f7f7f3' };

/** The 1 L brick's front face. */
function cartonSvg() {
  const w = 128;
  const h = 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${INK.paper}"/>
  <!-- the sealed fin across the top and the fold line under it -->
  <rect width="${w}" height="10" fill="#e8e9e4"/>
  <rect y="10" width="${w}" height="1.5" fill="#d3d6cf"/>
  <!-- invented logo: a milk drop in a round badge, and the made-up name -->
  <circle cx="64" cy="54" r="25" fill="${INK.blue}"/>
  <circle cx="64" cy="54" r="21" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.6"/>
  <path d="M64 36 C58 45 53 52 53 58.5 A11 11 0 0 0 75 58.5 C75 52 70 45 64 36 Z" fill="#ffffff"/>
  <text x="64" y="102" text-anchor="middle" font-family="Tex" font-weight="800" font-size="23" letter-spacing="0.5" fill="${INK.blue}">SIM DAIRY</text>
  <text x="64" y="120" text-anchor="middle" font-family="Tex" font-weight="600" font-size="12" letter-spacing="2" fill="${INK.grey}">UHT MILK</text>
  <text x="64" y="152" text-anchor="middle" font-family="Tex" font-weight="800" font-size="32" fill="${INK.blue}">1 L</text>
  <!-- the wave band at the foot of the pack -->
  <path d="M0 178 C30 166 70 192 128 172 L128 256 L0 256 Z" fill="${INK.lightBlue}"/>
  <path d="M0 194 C40 182 84 204 128 188 L128 256 L0 256 Z" fill="${INK.blue}"/>
  <text x="64" y="222" text-anchor="middle" font-family="Tex" font-weight="600" font-size="11" letter-spacing="1" fill="#ffffff">LONG LIFE · 3.5% FAT</text>
  <text x="64" y="240" text-anchor="middle" font-family="Tex" font-weight="500" font-size="9" letter-spacing="1" fill="#ffffff" opacity="0.8">DEMO PACK · NOT FOR SALE</text>
</svg>`;
}

/** A shrink-wrapped tray of packs, from the side. */
function traySvg() {
  const size = 256;
  const baseTop = 182; // the cardboard tray's rim
  const packs = [0, 1, 2, 3]
    .map((i) => {
      const x = i * 64;
      return `<g transform="translate(${x} 0)">
    <rect x="1.5" y="22" width="61" height="${baseTop - 22}" fill="${INK.paper}"/>
    <rect x="1.5" y="22" width="61" height="7" fill="#e3e5df"/>
    <path d="M1.5 128 C20 120 40 136 62.5 124 L62.5 ${baseTop} L1.5 ${baseTop} Z" fill="${INK.lightBlue}"/>
    <path d="M1.5 140 C24 132 44 146 62.5 136 L62.5 ${baseTop} L1.5 ${baseTop} Z" fill="${INK.blue}"/>
    <circle cx="32" cy="62" r="13" fill="${INK.blue}"/>
    <path d="M32 52 C29 57 26.5 60.5 26.5 64 A5.5 5.5 0 0 0 37.5 64 C37.5 60.5 35 57 32 52 Z" fill="#ffffff"/>
    <rect x="12" y="84" width="40" height="5" rx="2" fill="${INK.blue}" opacity="0.85"/>
    <rect x="18" y="94" width="28" height="3" rx="1.5" fill="${INK.grey}" opacity="0.6"/>
  </g>`;
    })
    .join('\n');
  // Corrugated cardboard: vertical flutes under a darker rim.
  const flutes = Array.from({ length: 32 }, (_, i) => `<rect x="${i * 8 + 3}" y="${baseTop + 6}" width="2" height="${size - baseTop - 6}" fill="#000000" opacity="0.05"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.28" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.34" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="0.40" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="0.62" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.68" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.72" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="#c9ced2"/>
  ${packs}
  <rect y="${baseTop}" width="${size}" height="${size - baseTop}" fill="#c29a5e"/>
  ${flutes}
  <rect y="${baseTop}" width="${size}" height="6" fill="#a87f45"/>
  <!-- the film: a cool tint over everything, two glossy streaks and creases where it shrank -->
  <rect width="${size}" height="${size}" fill="#dcebf7" opacity="0.16"/>
  <rect width="${size}" height="${size}" fill="url(#gloss)"/>
  <path d="M0 16 C40 8 90 20 128 12 S210 6 256 16" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
  <path d="M6 30 C12 70 4 120 10 170" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.35"/>
  <path d="M250 28 C244 80 252 126 246 176" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.35"/>
  <path d="M20 4 L60 20 M196 20 L236 4" stroke="#ffffff" stroke-width="1.5" opacity="0.4"/>
</svg>`;
}

/** The top deck of a pallet: boards along the image's width, with grain, gaps and nails. */
function palletSvg() {
  const size = 256;
  const boardH = 40;
  const gapH = 14;
  const tones = ['#c79d68', '#bf9460', '#cba270', '#c19763', '#c99f6a'];
  const boards = tones
    .map((tone, i) => {
      const y = i * (boardH + gapH);
      // Each board has its own grain: a stretched noise field, seeded per board so they differ.
      const nails = [18, 128, 238].flatMap((x) => [y + 9, y + boardH - 9].map((ny) => `<circle cx="${x}" cy="${ny}" r="2.3" fill="#5b4630"/><circle cx="${x - 0.6}" cy="${ny - 0.6}" r="0.9" fill="#9a8466"/>`)).join('');
      return `<filter id="grain${i}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.22" numOctaves="3" seed="${11 + i * 7}"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0 0.12  1.7 0 0 0 -0.62"/>
    </filter>
    <rect x="0" y="${y}" width="${size}" height="${boardH}" fill="${tone}"/>
    <rect x="0" y="${y}" width="${size}" height="${boardH}" filter="url(#grain${i})"/>
    <rect x="0" y="${y}" width="${size}" height="2" fill="#ffffff" opacity="0.12"/>
    <rect x="0" y="${y + boardH - 2}" width="${size}" height="2" fill="#000000" opacity="0.12"/>
    ${nails}`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#3e3022"/>
  ${boards}
</svg>`;
}

export const TEXTURES = {
  'carton.png': { width: 128, height: 256, svg: cartonSvg },
  'tray.png': { width: 256, height: 256, svg: traySvg },
  'pallet.png': { width: 256, height: 256, svg: palletSvg },
};

function page(svg) {
  const faces = FONT_WEIGHTS.map((weight) => {
    const font = readFileSync(join(FONT_DIR, `barlow-condensed-latin-${weight}-normal.woff2`)).toString('base64');
    return `@font-face { font-family: Tex; font-weight: ${weight}; src: url(data:font/woff2;base64,${font}) format('woff2'); }`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><style>${faces}\nhtml, body { margin: 0; background: transparent; } svg { display: block; }</style>${svg}`;
}

/** Renders every texture to { 'carton.png': bytes, ... }. */
export async function renderTextures() {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const out = {};
  try {
    for (const [file, { width, height, svg }] of Object.entries(TEXTURES)) {
      const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      // Everything is inline: any request at all would be a mistake, so none may leave the page.
      await tab.route('**/*', (route) => route.abort('blockedbyclient'));
      await tab.setContent(page(svg()));
      // Load every weight before the shot: Chromium only fetches a face once text needs it.
      const fontsOk = await tab.evaluate(async (weights) => {
        await Promise.all(weights.map((weight) => document.fonts.load(`${weight} 12px Tex`)));
        await document.fonts.ready;
        return weights.every((weight) => document.fonts.check(`${weight} 12px Tex`));
      }, FONT_WEIGHTS);
      if (!fontsOk) throw new Error(`${file}: the embedded font did not load`);
      out[file] = await tab.screenshot({ clip: { x: 0, y: 0, width, height }, type: 'png' });
      await tab.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { out: { type: 'string' } } });
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const outDir = resolve(args.values.out ?? join(repoRoot, 'public', 'textures'));
  mkdirSync(outDir, { recursive: true });
  for (const [file, bytes] of Object.entries(await renderTextures())) {
    writeFileSync(join(outDir, file), bytes);
    console.log(`wrote ${join(outDir, file)} (${(bytes.length / 1024).toFixed(1)} KB)`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
