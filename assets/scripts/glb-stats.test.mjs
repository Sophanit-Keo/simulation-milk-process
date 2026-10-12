// Tests for glb-stats.mjs, on GLBs built in memory. Node's own runner, no dependencies:
//   node --test assets/scripts/glb-stats.test.mjs
// Triangle counts come from accessor counts only, so the test files carry no vertex data.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { imageSize, parseGlb, summarize } from './glb-stats.mjs';

const SCRIPT = fileURLToPath(new URL('./glb-stats.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'glb-stats-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function glb(json, bin = new Uint8Array(0)) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 20 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (bin.length > 0) {
    view.setUint32(20 + jsonLength, binLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    out.set(bin, 28 + jsonLength);
  }
  return out;
}

function run(name, bytes, ...args) {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  const r = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Six decimals, and -0 folded into 0 so deepEqual compares values, not float noise.
const round = (values) => values.map((v) => Number(v.toFixed(6)) + 0);
const vec3 = (count, min, max) => ({ componentType: 5126, type: 'VEC3', count, min, max });
const PNG_64x32 = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 32, 8, 6, 0, 0, 0];

// A homogenizer-like hero: a body and three copies of one piston mesh.
const hero = {
  asset: { version: '2.0', generator: 'test' },
  accessors: [
    vec3(24, [-0.5, 0, -0.5], [0.5, 1, 0.5]),
    { componentType: 5123, type: 'SCALAR', count: 36 }, // 12 triangles
    vec3(9, [-0.1, 0, -0.1], [0.1, 0.2, 0.1]), // 3 triangles, not indexed
    vec3(5, [-0.1, 0, -0.1], [0.1, 0.2, 0.1]), // strip: 3 triangles; lines: 0
  ],
  materials: [{ name: 'steel', pbrMetallicRoughness: { metallicFactor: 0.9, roughnessFactor: 0.3 } }],
  meshes: [
    { name: 'body', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
    { name: 'piston', primitives: [{ attributes: { POSITION: 2 } }, { attributes: { POSITION: 3 }, mode: 5 }, { attributes: { POSITION: 3 }, mode: 1 }] },
  ],
  nodes: [
    { name: 'homogenizer', mesh: 0, children: [1, 2, 3] },
    { name: 'piston_1', mesh: 1, translation: [-0.3, 1, 0] },
    { name: 'piston_2', mesh: 1, translation: [0, 1, 0] },
    { name: 'piston_3', mesh: 1, translation: [0.3, 1, 0] },
  ],
  scenes: [{ nodes: [0] }],
  scene: 0,
};

describe('summarize', () => {
  const s = summarize(parseGlb(glb(hero)), 'homogenizer.glb');

  it('counts triangles per primitive mode, per mesh and as placed', () => {
    assert.deepEqual(s.meshes[1].primitives.map((p) => p.triangles), [3, 3, 0]);
    assert.equal(s.meshes[0].triangles, 12);
    assert.equal(s.meshes[1].triangles, 6);
    assert.deepEqual(s.triangles, { unique: 18, placed: 30, budgeted: 30 });
  });

  it('lists the node tree with names and depth', () => {
    assert.deepEqual(s.nodes.map((n) => [n.name, n.depth]), [['homogenizer', 0], ['piston_1', 1], ['piston_2', 1], ['piston_3', 1]]);
  });

  it('computes world bounds through node transforms', () => {
    assert.deepEqual(round(s.bounds.min), [-0.5, 0, -0.5]);
    assert.deepEqual(round(s.bounds.max), [0.5, 1.2, 0.5]);
    assert.deepEqual(s.warnings, []);
  });

  it('applies rotation and scale', () => {
    const half = Math.SQRT1_2; // 90 degrees about +Y maps (x, z) to (z, -x)
    const json = {
      accessors: [vec3(3, [0, 0, 0], [2, 1, 1])],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ name: 'turned', mesh: 0, rotation: [0, half, 0, half], scale: [1, 2, 1] }],
      scenes: [{ nodes: [0] }],
    };
    const b = summarize(parseGlb(glb(json))).bounds;
    assert.deepEqual(round(b.min), [0, 0, -2]);
    assert.deepEqual(round(b.max), [1, 2, 0]);
  });

  it('warns about the asset rules it can check', () => {
    const json = structuredClone(hero);
    json.nodes[0].translation = [1, 0.5, 0];
    json.nodes.push({ mesh: 0 });
    json.images = [{ uri: 'Textures/colormap.png' }];
    const w = summarize(parseGlb(glb(json)), 'Hero_Model.glb').warnings.join('\n');
    assert.match(w, /not kebab-case/);
    assert.match(w, /lowest point is y = 0.500/);
    assert.match(w, /footprint centre/);
    assert.match(w, /not in scene/);
    assert.match(w, /external files/);
  });

  it('predicts the names three.js gives nodes on load', () => {
    const json = structuredClone(hero);
    json.scenes[0].name = 'homogenizer';
    json.nodes[2].name = 'piston_1';
    json.nodes[3].name = 'piston.3';
    const w = summarize(parseGlb(glb(json)), 'homogenizer.glb').warnings.join('\n');
    assert.match(w, /3 node name\(s\) change/);
    assert.match(w, /"homogenizer" -> "homogenizer_1", "piston_1" -> "piston_1_1", "piston.3" -> "piston3"/);
  });

  it('survives a node cycle', () => {
    const json = { nodes: [{ name: 'a', children: [1] }, { name: 'b', children: [0] }], scenes: [{ nodes: [0] }] };
    const s2 = summarize(parseGlb(glb(json)));
    assert.equal(s2.nodes.length, 2);
    assert.match(s2.warnings.join('\n'), /cycle/);
  });
});

describe('images', () => {
  it('reads sizes from PNG, JPEG, WebP and KTX2 headers', () => {
    assert.deepEqual(imageSize(new Uint8Array(PNG_64x32)), { format: 'png', widthPx: 64, heightPx: 32 });
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0x00, 0x02, 0x00, 3];
    assert.deepEqual(imageSize(new Uint8Array(jpeg)), { format: 'jpeg', widthPx: 512, heightPx: 256 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([299 & 0xff, 299 >> 8, 0, 199, 0, 0], 24);
    assert.deepEqual(imageSize(webp), { format: 'webp', widthPx: 300, heightPx: 200 });
    const ktx2 = new Uint8Array(28);
    ktx2.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(ktx2.buffer).setUint32(20, 1024, true);
    new DataView(ktx2.buffer).setUint32(24, 2048, true);
    assert.deepEqual(imageSize(ktx2), { format: 'ktx2', widthPx: 1024, heightPx: 2048 });
    assert.equal(imageSize(new Uint8Array([1, 2, 3])), undefined);
  });

  it('reads embedded and data-URI images, never external ones', () => {
    const bin = new Uint8Array(PNG_64x32);
    const json = {
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteLength: bin.length }, { buffer: 0, byteOffset: 4096, byteLength: 8 }],
      images: [
        { name: 'label', bufferView: 0, mimeType: 'image/png' },
        { bufferView: 1 },
        { uri: `data:image/png;base64,${Buffer.from(bin).toString('base64')}` },
        { uri: '../../secret.png' },
      ],
      textures: [{ source: 0, sampler: 0 }],
    };
    const images = summarize(parseGlb(glb(json, bin))).images;
    assert.equal(images[0].widthPx, 64);
    assert.equal(images[0].heightPx, 32);
    assert.equal(images[1].unreadable, true);
    assert.equal(images[2].source, 'data-uri');
    assert.equal(images[2].widthPx, 64);
    assert.deepEqual(images[3], { index: 3, name: '', mimeType: '', source: 'external', uri: '../../secret.png' });
  });
});

describe('command line', () => {
  it('passes and fails the triangle budget', () => {
    const ok = run('homogenizer.glb', glb(hero), '--max-triangles', '30');
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /piston_3/);
    assert.match(ok.out, /budget: 30 of 30 triangles: ok/);
    const over = run('homogenizer.glb', glb(hero), '--max-triangles=29');
    assert.equal(over.code, 1);
    assert.match(over.out, /OVER BUDGET/);
  });

  it('prints JSON with --json', () => {
    const r = run('homogenizer.glb', glb(hero), '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).triangles.placed, 30);
  });

  it('rejects broken files and bad arguments with exit code 2', () => {
    const good = glb(hero);
    const badMagic = good.slice();
    badMagic[0] = 0;
    const truncated = good.slice(0, good.length - 8);
    const badJson = glb({});
    badJson.fill(0x7b, 20, 24); // "{{{{" is not JSON
    const chunkPastEnd = good.slice();
    new DataView(chunkPastEnd.buffer).setUint32(12, 1 << 20, true);
    for (const [name, bytes] of [['magic.glb', badMagic], ['short.glb', truncated], ['json.glb', badJson], ['chunk.glb', chunkPastEnd], ['tiny.glb', new Uint8Array(4)]]) {
      const r = run(name, bytes);
      assert.equal(r.code, 2, `${name}: ${r.out}`);
      assert.notEqual(r.err, '');
    }
    assert.equal(run('homogenizer.glb', good, '--max-triangles', 'lots').code, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, join(dir, 'missing.glb')]).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT]).status, 2);
  });

  it('escapes control characters from the file', () => {
    const json = structuredClone(hero);
    json.nodes[1].name = 'piston\u001b[31m_red';
    const r = run('homogenizer.glb', glb(json));
    assert.equal(r.code, 0, r.err);
    assert.ok(!r.out.includes('\u001b'));
    assert.match(r.out, /piston\\u001b\[31m_red/);
  });
});
