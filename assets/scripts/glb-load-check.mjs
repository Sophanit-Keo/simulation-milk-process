#!/usr/bin/env node
// Load GLB files with three.js' GLTFLoader at the version pinned in package.json, in
// Playwright's Chromium, and render each one once. This is the "loads in our three.js" step
// of the export checklist in assets/README.md.
//
//   node assets/scripts/glb-load-check.mjs <model.glb>... [--port 5186] [--shots <dir>]
//
// A static server on 127.0.0.1 serves three from node_modules, a one-file test page, and
// each model's own folder (so textures next to it resolve) and nothing else, not even through
// a symlink. The page may load nothing but that server: any other URL a GLB names is blocked
// before it leaves the machine, and fails the model. A model fails on a load error, a failed
// or blocked request or any console error. --shots saves a PNG per model.
// Exit codes: 0 all loaded, 1 a model failed, 2 bad arguments or the server/browser failed.

import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5186; // the assets lane's port; strict, so a busy port is an error
const MIME = {
  '.js': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
};

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>glb-load-check</title>
<style>body { margin: 0; background: #dde3ea; }</style>
<script type="importmap">
{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }
</script>
<script type="module">
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(480, 360);
document.body.appendChild(renderer.domElement);
// Decoders for the phase-5 compressed GLBs (Draco or meshopt geometry, KTX2 textures).
const loader = new GLTFLoader()
  .setDRACOLoader(new DRACOLoader().setDecoderPath('/three/examples/jsm/libs/draco/gltf/'))
  .setKTX2Loader(new KTX2Loader().setTranscoderPath('/three/examples/jsm/libs/basis/').detectSupport(renderer))
  .setMeshoptDecoder(MeshoptDecoder);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde3ea);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 5, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(40, 480 / 360, 0.01, 500);
let current;

window.checkModel = async (url) => {
  if (current) scene.remove(current);
  const gltf = await loader.loadAsync(url);
  current = gltf.scene;
  scene.add(current);
  const names = [];
  const maps = new Set();
  let meshes = 0;
  let triangles = 0;
  current.traverse((o) => {
    if (o !== current) names.push(o.name);
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    triangles += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    for (const m of [o.material].flat()) {
      for (const key of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        const image = m[key] && m[key].image;
        if (image) maps.add(key + ' ' + image.width + 'x' + image.height);
      }
    }
  });
  const box = new THREE.Box3().setFromObject(current);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const distM = Math.max(size.x, size.y, size.z, 0.1) * 2.2;
  camera.position.copy(centre).add(new THREE.Vector3(1, 0.8, 1.3).normalize().multiplyScalar(distM));
  camera.lookAt(centre);
  renderer.render(scene, camera);
  return {
    revision: THREE.REVISION,
    names,
    meshes,
    triangles,
    drawnTriangles: renderer.info.render.triangles,
    maps: [...maps],
    sizeM: size.toArray(),
    minYM: box.min.y,
    animations: gltf.animations.length,
  };
};
window.glbCheckReady = true;
</script>
`;

/** Whether the test page may load `url`: only the local server (and its blob: URLs) or a data: URL. */
export function isLocalRequest(url, port) {
  try {
    const u = new URL(url);
    return u.protocol === 'data:' || u.origin === `http://${HOST}:${port}`;
  } catch {
    return false;
  }
}

/** Serve the test page and the mounts ({ '/prefix/' => real path of its root }) on 127.0.0.1. */
export function serve(mounts, port) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      return;
    }
    for (const [prefix, root] of mounts) {
      if (!path.startsWith(prefix)) continue;
      let file;
      try {
        // realpath follows symlinks, so a link inside a model's folder cannot reach outside it.
        file = realpathSync(resolve(root, decodeURIComponent(path.slice(prefix.length))));
      } catch {
        break;
      }
      // Only files under the mount's root, never above it.
      if (!file.startsWith(root + sep)) break;
      try {
        if (!statSync(file).isFile()) break;
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
        return;
      } catch {
        break;
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolvePromise(server));
  });
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { port: { type: 'string' }, shots: { type: 'string' } },
    });
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const files = args.positionals.map((f) => resolve(f));
  const port = args.values.port === undefined ? DEFAULT_PORT : Number(args.values.port);
  if (files.length === 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('usage: node assets/scripts/glb-load-check.mjs <model.glb>... [--port 5186] [--shots <dir>]');
    return 2;
  }
  for (const f of files) {
    if (!statSync(f, { throwIfNoEntry: false })?.isFile()) {
      console.error(`${f}: not a file`);
      return 2;
    }
  }

  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const mounts = new Map([['/three/', realpathSync(join(repoRoot, 'node_modules', 'three'))]]);
  files.forEach((f, i) => mounts.set(`/m${i}/`, realpathSync(dirname(f))));

  let server;
  try {
    server = await serve(mounts, port);
  } catch (err) {
    console.error(`server on ${HOST}:${port} failed: ${err.message}`);
    return 2;
  }
  let browser;
  try {
    // Imported here, so a missing Playwright is reported like a missing browser.
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch();
  } catch (err) {
    console.error(`browser failed to start: ${err.message}`);
    server.close();
    return 2;
  }
  let failed = 0;
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    // Untrusted GLBs can name any URL; nothing but the local server is fetched.
    await page.route('**/*', (route) =>
      isLocalRequest(route.request().url(), port) ? route.continue() : route.abort('blockedbyclient'),
    );
    try {
      await page.goto(`http://${HOST}:${port}/`);
      await page.waitForFunction(() => window.glbCheckReady === true, null, { timeout: 15_000 });
    } catch (err) {
      console.error(`test page did not start:\n  ${problems.join('\n  ') || err.message.split('\n')[0]}`);
      return 2;
    }
    if (args.values.shots) mkdirSync(args.values.shots, { recursive: true });

    for (const [i, file] of files.entries()) {
      problems.length = 0;
      const url = `/m${i}/${encodeURIComponent(basename(file))}`;
      let r;
      try {
        r = await page.evaluate((u) => window.checkModel(u), url);
      } catch (err) {
        problems.push(err.message.split('\n')[0]);
      }
      if (r && problems.length === 0) {
        const size = r.sizeM.map((v) => v.toFixed(2)).join(' x ');
        console.log(
          `OK   ${basename(file)}: three r${r.revision}, ${r.meshes} mesh(es), ${r.triangles} tri (${r.drawnTriangles} drawn),` +
            ` ${size} m, min y ${r.minYM.toFixed(3)}, maps: ${r.maps.join(', ') || 'none'}` +
            `${r.animations ? `, ${r.animations} animation(s)` : ''}; nodes: ${r.names.join(', ') || '(none)'}`,
        );
        if (args.values.shots) {
          await page.locator('canvas').screenshot({ path: join(args.values.shots, `${basename(file, '.glb')}.png`) });
        }
      } else {
        failed++;
        console.log(`FAIL ${basename(file)}:\n  ${problems.join('\n  ')}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
