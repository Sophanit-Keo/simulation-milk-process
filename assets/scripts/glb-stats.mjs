#!/usr/bin/env node
// Print what a .glb holds and check it against the triangle budget in assets/README.md.
//
//   node assets/scripts/glb-stats.mjs <model.glb> [--max-triangles N] [--json]
//
// Exit codes: 0 ok, 1 over the --max-triangles budget, 2 bad arguments or unreadable file.
//
// The file is untrusted data. It is only parsed: nothing in it is executed, and nothing it
// names (external image URIs, extensions) is opened or fetched. Strings from the file are
// escaped before they reach the terminal. No dependencies, so it runs before `npm ci`.

import { Buffer } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_NODE_DEPTH = 64; // a deeper tree is either broken or cyclic
const MODE_NAMES = ['POINTS', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN'];
const TEXTURE_SLOTS = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'];
const KEBAB_GLB = /^[a-z0-9]+(-[a-z0-9]+)*\.glb$/;
const FLOOR_TOLERANCE_M = 0.01;

export class GlbError extends Error {}

// Defensive readers: the JSON can hold anything, so every field is checked before use.
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : '');
const isIndex = (v, arr) => Number.isInteger(v) && v >= 0 && v < arr.length;
const isCount = (v) => Number.isInteger(v) && v >= 0;
const nums = (v, n) => (Array.isArray(v) && v.length === n && v.every(Number.isFinite) ? v : undefined);
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Split a GLB into its JSON object and BIN chunk. Throws GlbError if the container is broken. */
export function parseGlb(bytes) {
  if (bytes.byteLength < 20) throw new GlbError('too short for a GLB header and a chunk');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new GlbError('not a GLB (bad magic)');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new GlbError(`unsupported GLB version ${version}`);
  const length = view.getUint32(8, true);
  if (length > bytes.byteLength) throw new GlbError(`header says ${length} bytes, file has ${bytes.byteLength}`);

  let json;
  let bin;
  for (let offset = 12; offset + 8 <= length; ) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > length) throw new GlbError(`chunk at byte ${offset} runs past the end of the file`);
    if (chunkType === CHUNK_JSON && json === undefined) json = decodeJson(bytes.subarray(start, end));
    else if (chunkType === CHUNK_BIN && bin === undefined) bin = bytes.subarray(start, end);
    offset = end;
  }
  if (json === undefined) throw new GlbError('no JSON chunk');
  return { version, byteLength: length, json, bin };
}

function decodeJson(chunk) {
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunk));
  } catch (err) {
    throw new GlbError(`JSON chunk is not valid UTF-8 JSON: ${err.message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new GlbError('JSON chunk is not an object');
  return value;
}

function primitiveStats(primitive, accessors, materials) {
  const p = obj(primitive);
  const attributes = obj(p.attributes);
  const position = isIndex(attributes.POSITION, accessors) ? obj(accessors[attributes.POSITION]) : undefined;
  const indices = isIndex(p.indices, accessors) ? obj(accessors[p.indices]) : undefined;
  const mode = p.mode === undefined ? 4 : p.mode;
  const vertices = position && isCount(position.count) ? position.count : 0;
  const drawn = indices ? (isCount(indices.count) ? indices.count : 0) : vertices;
  let triangles = 0;
  if (mode === 4) triangles = Math.floor(drawn / 3);
  else if (mode === 5 || mode === 6) triangles = Math.max(0, drawn - 2);
  const box = position && nums(position.min, 3) && nums(position.max, 3) ? { min: position.min, max: position.max } : undefined;
  return {
    // JSON.stringify, not a template: String() throws on an object with a non-function toString.
    mode: isIndex(mode, MODE_NAMES) ? MODE_NAMES[mode] : `mode ${JSON.stringify(mode)}`,
    indexed: indices !== undefined,
    vertices,
    triangles,
    material: isIndex(p.material, materials) ? p.material : undefined,
    attributes: Object.keys(attributes).sort(),
    box,
  };
}

// glTF matrices are column-major, like three.js.
function localMatrix(node) {
  const m = nums(node.matrix, 16);
  if (m) return m.slice();
  const [tx, ty, tz] = nums(node.translation, 3) ?? [0, 0, 0];
  const [x, y, z, w] = nums(node.rotation, 4) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = nums(node.scale, 3) ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
    2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
    2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function growBounds(bounds, m, box) {
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const p = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        for (let i = 0; i < 3; i++) {
          bounds.min[i] = Math.min(bounds.min[i], p[i]);
          bounds.max[i] = Math.max(bounds.max[i], p[i]);
        }
      }
    }
  }
}

// Walk the default scene: node tree, triangles as placed (a mesh used by n nodes counts n times)
// and the world-space bounding box from the POSITION accessors' min/max.
function walkScene(json, meshes) {
  const nodes = list(json.nodes);
  const scenes = list(json.scenes);
  const sceneIndex = isIndex(json.scene, scenes) ? json.scene : 0;
  const roots = list(obj(scenes[sceneIndex]).nodes).filter((i) => isIndex(i, nodes));
  const tree = [];
  const seen = new Set();
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let placedTriangles = 0;
  let boundsComplete = true;
  let problems = 0;

  const visit = (index, depth, parentMatrix) => {
    if (seen.has(index) || depth > MAX_NODE_DEPTH) {
      problems++;
      return;
    }
    seen.add(index);
    const node = obj(nodes[index]);
    const matrix = multiply(parentMatrix, localMatrix(node));
    const mesh = isIndex(node.mesh, meshes) ? node.mesh : undefined;
    tree.push({ index, name: str(node.name), depth, mesh });
    if (mesh !== undefined) {
      placedTriangles += meshes[mesh].triangles;
      for (const p of meshes[mesh].primitives) {
        if (p.box) growBounds(bounds, matrix, p.box);
        else boundsComplete = false;
      }
    }
    for (const child of list(node.children)) if (isIndex(child, nodes)) visit(child, depth + 1, matrix);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of roots) visit(root, 0, identity);

  const hasBounds = Number.isFinite(bounds.min[0]);
  return {
    scene: scenes.length > 0 ? sceneIndex : undefined,
    sceneName: str(obj(scenes[sceneIndex]).name),
    tree,
    unusedNodes: nodes.length - seen.size,
    hierarchyProblems: problems,
    placedTriangles,
    bounds: hasBounds ? { ...bounds, complete: boundsComplete } : undefined,
  };
}

function u16be(b, i) { return (b[i] << 8) | b[i + 1]; }
function u16le(b, i) { return b[i] | (b[i + 1] << 8); }
function u24le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }
function u32be(b, i) { return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]); }
function u32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0); }
const startsWith = (b, sig) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** Width and height from the header of a PNG, JPEG, WebP or KTX2 image; undefined if unknown. */
export function imageSize(b) {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && b.length >= 24) {
    return { format: 'png', widthPx: u32be(b, 16), heightPx: u32be(b, 20) };
  }
  if (startsWith(b, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]) && b.length >= 28) {
    return { format: 'ktx2', widthPx: u32le(b, 20), heightPx: u32le(b, 24) };
  }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b.length >= 30 && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...b.subarray(12, 16));
    if (kind === 'VP8 ') return { format: 'webp', widthPx: u16le(b, 26) & 0x3fff, heightPx: u16le(b, 28) & 0x3fff };
    if (kind === 'VP8L') {
      return {
        format: 'webp',
        widthPx: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        heightPx: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    }
    if (kind === 'VP8X') return { format: 'webp', widthPx: 1 + u24le(b, 24), heightPx: 1 + u24le(b, 27) };
  }
  if (startsWith(b, [0xff, 0xd8])) {
    // Walk the JPEG segments to the first start-of-frame marker.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', widthPx: u16be(b, i + 7), heightPx: u16be(b, i + 5) };
      }
      i += 2 + u16be(b, i + 2);
    }
  }
  return undefined;
}

function imageStats(image, index, json, bin) {
  const im = obj(image);
  const base = { index, name: str(im.name), mimeType: str(im.mimeType) };
  if (typeof im.uri === 'string') {
    const match = /^data:[^,]*;base64,/.exec(im.uri);
    if (!match) return { ...base, source: 'external', uri: im.uri };
    const bytes = new Uint8Array(Buffer.from(im.uri.slice(match[0].length), 'base64'));
    return { ...base, source: 'data-uri', byteLength: bytes.byteLength, ...imageSize(bytes) };
  }
  const views = list(json.bufferViews);
  if (!isIndex(im.bufferView, views)) return { ...base, source: 'missing' };
  const view = obj(views[im.bufferView]);
  const buffers = list(json.buffers);
  const offset = view.byteOffset === undefined ? 0 : view.byteOffset;
  const inGlbBin = isIndex(view.buffer, buffers) && obj(buffers[view.buffer]).uri === undefined;
  if (!bin || !inGlbBin || !isCount(offset) || !isCount(view.byteLength) || offset + view.byteLength > bin.byteLength) {
    return { ...base, source: 'bufferView', unreadable: true };
  }
  const bytes = bin.subarray(offset, offset + view.byteLength);
  return { ...base, source: 'bufferView', byteLength: bytes.byteLength, ...imageSize(bytes) };
}

function materialStats(material, index) {
  const m = obj(material);
  const pbr = obj(m.pbrMetallicRoughness);
  const slots = [...TEXTURE_SLOTS.filter((s) => s in pbr), ...TEXTURE_SLOTS.filter((s) => s in m)];
  return {
    index,
    name: str(m.name),
    baseColorFactor: nums(pbr.baseColorFactor, 4),
    metallicFactor: Number.isFinite(pbr.metallicFactor) ? pbr.metallicFactor : 1,
    roughnessFactor: Number.isFinite(pbr.roughnessFactor) ? pbr.roughnessFactor : 1,
    textures: slots.map((s) => s.replace(/Texture$/, '')),
    alphaMode: str(m.alphaMode) || 'OPAQUE',
    doubleSided: m.doubleSided === true,
  };
}

function textureStats(texture, index, images) {
  const t = obj(texture);
  const ext = obj(t.extensions);
  // Compressed or WebP sources live in extensions, with `source` as the fallback.
  const candidates = [obj(ext.KHR_texture_basisu).source, obj(ext.EXT_texture_webp).source, t.source];
  const image = candidates.find((s) => isIndex(s, images));
  return { index, name: str(t.name), image, sampler: Number.isInteger(t.sampler) ? t.sampler : undefined };
}

/** Everything the report prints, as plain data. `fileName` is only used for the naming check. */
export function summarize(glb, fileName = '') {
  const { json, bin } = glb;
  const accessors = list(json.accessors);
  const materialList = list(json.materials);
  const meshes = list(json.meshes).map((mesh, index) => {
    const primitives = list(obj(mesh).primitives).map((p) => primitiveStats(p, accessors, materialList));
    return {
      index,
      name: str(obj(mesh).name),
      primitives,
      triangles: sum(primitives.map((p) => p.triangles)),
      vertices: sum(primitives.map((p) => p.vertices)),
    };
  });
  const scene = walkScene(json, meshes);
  const imageList = list(json.images);
  const images = imageList.map((im, i) => imageStats(im, i, json, bin));
  const uniqueTriangles = sum(meshes.map((m) => m.triangles));
  const asset = obj(json.asset);

  const summary = {
    file: fileName,
    byteLength: glb.byteLength,
    gltfVersion: str(asset.version),
    generator: str(asset.generator),
    extensionsUsed: list(json.extensionsUsed).map(str),
    extensionsRequired: list(json.extensionsRequired).map(str),
    scene: scene.scene,
    sceneName: scene.sceneName,
    nodes: scene.tree,
    nodeCount: list(json.nodes).length,
    meshes,
    triangles: {
      unique: uniqueTriangles,
      placed: scene.placedTriangles,
      // The budget counts whichever is larger: what the GPU draws, or what the file carries.
      budgeted: Math.max(uniqueTriangles, scene.placedTriangles),
    },
    bounds: scene.bounds,
    materials: materialList.map(materialStats),
    textures: list(json.textures).map((t, i) => textureStats(t, i, imageList)),
    images,
    animations: list(json.animations).map((a, i) => ({ index: i, name: str(obj(a).name), channels: list(obj(a).channels).length })),
    warnings: [],
  };
  summary.warnings = checkRules(summary, scene);
  return summary;
}

// three.js' GLTFLoader (r186) cleans each name (spaces to _, drops [ ] . : /) and appends _1, _2
// when the scene or an earlier node already took it. It names the scene first, then the nodes
// depth-first, so this replays that order. A renamed part is missed by getObjectByName('bowl').
function threeRenames(sceneName, nodes) {
  const used = new Map();
  const unique = (name) => {
    const cleaned = name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
    const n = used.get(cleaned);
    used.set(cleaned, n === undefined ? 0 : n + 1);
    return n === undefined ? cleaned : `${cleaned}_${n + 1}`;
  };
  if (sceneName) unique(sceneName);
  const renamed = [];
  for (const node of nodes) {
    if (!node.name) continue;
    const loaded = unique(node.name);
    if (loaded !== node.name) renamed.push([node.name, loaded]);
  }
  return renamed;
}

// The asset rules from assets/README.md that can be checked from the file alone.
function checkRules(s, scene) {
  const w = [];
  if (s.file && !KEBAB_GLB.test(s.file)) w.push(`file name "${s.file}" is not kebab-case .glb`);
  const unnamed = s.nodes.filter((n) => n.name === '').length;
  if (unnamed > 0) w.push(`${unnamed} node(s) have no name; moving parts need the names from the hero spec`);
  const renamed = threeRenames(s.sceneName, s.nodes);
  if (renamed.length > 0) {
    const shown = renamed.slice(0, 5).map(([from, to]) => `"${from}" -> "${to}"`).join(', ');
    w.push(`${renamed.length} node name(s) change when three.js loads them: ${shown}${renamed.length > 5 ? ', ...' : ''}`);
  }
  if (scene.unusedNodes > 0) w.push(`${scene.unusedNodes} node(s) are not in scene ${s.scene ?? 0}`);
  if (scene.hierarchyProblems > 0) w.push(`node hierarchy has a cycle, a shared child or is deeper than ${MAX_NODE_DEPTH}`);
  if (s.bounds) {
    const [minX, minY, minZ] = s.bounds.min;
    const [maxX, , maxZ] = s.bounds.max;
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;
    const tolX = Math.max(FLOOR_TOLERANCE_M, 0.02 * (maxX - minX));
    const tolZ = Math.max(FLOOR_TOLERANCE_M, 0.02 * (maxZ - minZ));
    if (Math.abs(minY) > FLOOR_TOLERANCE_M) w.push(`lowest point is y = ${fmt(minY, 3)} m; the origin should sit on the floor`);
    if (Math.abs(centreX) > tolX || Math.abs(centreZ) > tolZ) {
      w.push(`footprint centre is at x ${fmt(centreX, 3)}, z ${fmt(centreZ, 3)} m; the origin should be at the footprint centre`);
    }
    if (!s.bounds.complete) w.push('some POSITION accessors lack min/max, so the bounds are partial');
  } else if (s.meshes.length > 0) {
    w.push('no bounds: meshes are not placed in the scene or lack POSITION min/max');
  }
  const external = s.images.filter((im) => im.source === 'external');
  if (external.length > 0) w.push(`${external.length} image(s) are external files; our GLBs embed their textures`);
  if (s.extensionsRequired.length > 0) w.push(`required extensions need loader support: ${s.extensionsRequired.join(', ')}`);
  return w;
}

// Strings come from the file: escape control and bidi characters so they can't drive the terminal.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
function clean(value, maxLength = 80) {
  const s = String(value).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s;
}
const label = (name, fallback = '(unnamed)') => (name ? clean(name) : fallback);
const named = (index, name) => (name ? `${index} ${clean(name)}` : `${index}`);
function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

export function formatReport(s, maxTriangles) {
  const out = [];
  const kb = (s.byteLength / 1024).toFixed(1);
  out.push(`${clean(s.file || '(file)')}  ${kb} KB  glTF ${clean(s.gltfVersion || '?')}  generator: ${clean(s.generator || '?')}`);
  out.push(`extensions used: ${s.extensionsUsed.map((e) => clean(e)).join(', ') || 'none'}`);
  if (s.bounds) {
    const size = s.bounds.max.map((v, i) => v - s.bounds.min[i]);
    out.push(
      `bounds (m): ${fmt(size[0])} x ${fmt(size[1])} x ${fmt(size[2])} (x y z); min y ${fmt(s.bounds.min[1], 3)};` +
        ` centre x ${fmt((s.bounds.min[0] + s.bounds.max[0]) / 2, 3)} z ${fmt((s.bounds.min[2] + s.bounds.max[2]) / 2, 3)}`,
    );
  }
  out.push(`nodes (${s.nodeCount}, scene ${s.scene ?? '-'}):`);
  for (const n of s.nodes) {
    const mesh = n.mesh === undefined ? '' : `  [mesh ${n.mesh}${s.meshes[n.mesh].name ? `: ${clean(s.meshes[n.mesh].name)}` : ''}]`;
    out.push(`  ${'  '.repeat(Math.min(n.depth, 20))}${label(n.name)}${mesh}`);
  }
  out.push(`meshes (${s.meshes.length}):`);
  for (const m of s.meshes) {
    out.push(`  ${m.index} ${label(m.name)}: ${m.primitives.length} primitive(s), ${m.triangles} tri, ${m.vertices} vert`);
    for (const [i, p] of m.primitives.entries()) {
      const material = p.material === undefined ? 'no material' : `material ${named(p.material, s.materials[p.material].name)}`;
      const attributes = p.attributes.map((a) => clean(a, 24)).join(' ');
      out.push(`     prim ${i}: ${p.mode}${p.indexed ? ' indexed' : ''}, ${p.triangles} tri, ${p.vertices} vert, ${material}; ${attributes}`);
    }
  }
  out.push(`triangles: ${s.triangles.unique} in meshes, ${s.triangles.placed} as placed in the scene`);
  out.push(`materials (${s.materials.length}):`);
  for (const m of s.materials) {
    const colour = m.baseColorFactor ? ` colour ${m.baseColorFactor.map((v) => fmt(v)).join(' ')}` : '';
    const maps = m.textures.length > 0 ? ` maps: ${m.textures.join(', ')};` : '';
    out.push(`  ${m.index} ${label(m.name)}:${maps}${colour} metal ${fmt(m.metallicFactor)} rough ${fmt(m.roughnessFactor)} ${m.alphaMode}${m.doubleSided ? ' double-sided' : ''}`);
  }
  out.push(`textures (${s.textures.length}):`);
  for (const t of s.textures) {
    out.push(`  ${named(t.index, t.name)} -> image ${t.image ?? '?'}${t.sampler === undefined ? '' : `, sampler ${t.sampler}`}`);
  }
  out.push(`images (${s.images.length}):`);
  for (const im of s.images) {
    let where;
    if (im.source === 'external') where = `external "${clean(im.uri)}" (not read)`;
    else if (im.unreadable) where = 'embedded, but its bufferView is out of range';
    else if (im.source === 'missing') where = 'no uri or bufferView';
    else where = `${im.source === 'data-uri' ? 'data URI' : 'embedded'}, ${(im.byteLength / 1024).toFixed(1)} KB`;
    const size = im.widthPx ? `, ${im.format} ${im.widthPx}x${im.heightPx}` : '';
    const mime = im.mimeType ? ` ${clean(im.mimeType)}` : '';
    out.push(`  ${named(im.index, im.name)}${mime}: ${where}${size}`);
  }
  if (s.animations.length > 0) {
    out.push(`animations (${s.animations.length}): ${s.animations.map((a) => `${label(a.name)} (${a.channels} channels)`).join(', ')}`);
  }
  if (s.warnings.length > 0) {
    out.push('warnings:');
    for (const w of s.warnings) out.push(`  - ${clean(w, 200)}`);
  }
  if (maxTriangles !== undefined) {
    const ok = s.triangles.budgeted <= maxTriangles;
    out.push(`budget: ${s.triangles.budgeted} of ${maxTriangles} triangles: ${ok ? 'ok' : 'OVER BUDGET'}`);
  }
  return out.join('\n');
}

function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { 'max-triangles': { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const usage = 'usage: node assets/scripts/glb-stats.mjs <model.glb> [--max-triangles N] [--json]';
  if (args.values.help) {
    console.log(usage);
    return 0;
  }
  if (args.positionals.length !== 1) {
    console.error(usage);
    return 2;
  }
  let maxTriangles;
  if (args.values['max-triangles'] !== undefined) {
    maxTriangles = Number(args.values['max-triangles']);
    if (!Number.isInteger(maxTriangles) || maxTriangles < 0) {
      console.error('--max-triangles must be a whole number of triangles');
      return 2;
    }
  }

  const path = args.positionals[0];
  let summary;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new GlbError('not a file');
    if (stat.size > MAX_FILE_BYTES) throw new GlbError(`larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    summary = summarize(parseGlb(readFileSync(path)), basename(path));
  } catch (err) {
    console.error(`${clean(path, 200)}: ${clean(err.message, 300)}`);
    return 2;
  }

  // JSON.stringify escapes control characters itself.
  console.log(args.values.json ? JSON.stringify(summary, null, 2) : formatReport(summary, maxTriangles));
  return maxTriangles !== undefined && summary.triangles.budgeted > maxTriangles ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
