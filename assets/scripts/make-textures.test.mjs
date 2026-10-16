// Tests for the token textures make-textures.mjs wrote to public/textures/:
//   node --test assets/scripts/make-textures.test.mjs
// Rendering needs Chromium, so this only checks the committed files against the script's table
// and the budget (assets/README.md: one print per token, at most 256² here, kept small).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { imageSize } from './glb-stats.mjs';
import { TEXTURES } from './make-textures.mjs';

const TEXTURES_DIR = fileURLToPath(new URL('../../public/textures/', import.meta.url));
const MAX_SIDE_PX = 256;
const MAX_BYTES = 64 * 1024;

describe('token textures', () => {
  for (const [file, { width, height }] of Object.entries(TEXTURES)) {
    it(`${file} is the ${width}×${height} PNG the script draws, and small`, () => {
      const bytes = readFileSync(join(TEXTURES_DIR, file));
      assert.deepEqual(imageSize(bytes), { format: 'png', widthPx: width, heightPx: height });
      assert.ok(width <= MAX_SIDE_PX && height <= MAX_SIDE_PX, `${width}×${height}`);
      assert.ok(bytes.length <= MAX_BYTES, `${bytes.length} bytes`);
    });
  }

  it('draws no real brand: the only name on the pack is the invented one', () => {
    const words = Object.values(TEXTURES)
      .map(({ svg }) => svg())
      .flatMap((svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]));
    assert.deepEqual(words, ['SIM DAIRY', 'UHT MILK', '1 L', 'LONG LIFE · 3.5% FAT', 'DEMO PACK · NOT FOR SALE']);
  });
});
