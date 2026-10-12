// Tests for glb-load-check.mjs that need no browser: the static server, the request filter
// and the exit codes. Node's own runner:
//   node --test assets/scripts/glb-load-check.test.mjs
// Loading and rendering a GLB needs Chromium, which the CI check job does not install, so that
// part runs by hand (assets/README.md, export checklist step 9).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isLocalRequest, serve } from './glb-load-check.mjs';

const SCRIPT = fileURLToPath(new URL('./glb-load-check.mjs', import.meta.url));
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'glb-load-check-test-')));
after(() => rmSync(dir, { recursive: true, force: true }));

/** GET a raw path, so `..` reaches the server as written. */
function get(port, path) {
  return new Promise((resolvePromise, reject) => {
    request({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode, type: res.headers['content-type'], body }));
    })
      .on('error', reject)
      .end();
  });
}

/** A port that was free a moment ago. */
function freePort() {
  return new Promise((resolvePromise) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePromise(port));
    });
  });
}

describe('serve', () => {
  // kit/ is the mounted model folder; outside/ sits next to it and must stay unreachable.
  const kit = join(dir, 'kit');
  let server;
  let port;

  before(async () => {
    mkdirSync(join(kit, 'Textures'), { recursive: true });
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(kit, 'model.glb'), 'glb');
    writeFileSync(join(kit, 'Textures', 'colormap.png'), 'png');
    writeFileSync(join(dir, 'outside', 'secret.txt'), 'SECRET');
    symlinkSync(join('Textures', 'colormap.png'), join(kit, 'alias.png'));
    symlinkSync(join('..', 'outside'), join(kit, 'link'));
    symlinkSync(join('..', 'outside', 'secret.txt'), join(kit, 'leak.txt'));
    server = await serve(new Map([['/m0/', kit]]), 0);
    port = server.address().port;
  });
  after(() => server?.close());

  it('serves the test page and the files in a model folder', async () => {
    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /GLTFLoader/);
    assert.deepEqual(await get(port, '/m0/model.glb'), { status: 200, type: 'model/gltf-binary', body: 'glb' });
    assert.equal((await get(port, '/m0/Textures/colormap.png')).body, 'png');
    assert.equal((await get(port, '/m0/Textures%2Fcolormap.png')).body, 'png');
  });

  it('follows a symlink that stays inside the folder', async () => {
    assert.deepEqual(await get(port, '/m0/alias.png'), { status: 200, type: 'image/png', body: 'png' });
  });

  it('never serves a file outside the folder, not even through a symlink', async () => {
    for (const path of [
      '/m0/link/secret.txt',
      '/m0/leak.txt',
      '/m0/../outside/secret.txt',
      '/m0/..%2foutside%2fsecret.txt',
      '/m0/%2e%2e/outside/secret.txt',
      '/m0/..%5coutside%5csecret.txt',
    ]) {
      const r = await get(port, path);
      assert.equal(r.status, 404, path);
      assert.equal(r.body, '', path);
    }
  });

  it('answers 404 for folders, missing files, bad escapes and unknown prefixes', async () => {
    for (const path of ['/m0/Textures', '/m0/', '/m0/missing.png', '/m0/%E0%A4%A', '/m1/model.glb', '/three/']) {
      assert.equal((await get(port, path)).status, 404, path);
    }
  });
});

describe('isLocalRequest', () => {
  it('allows the local server, its blob: URLs and data: URLs', () => {
    assert.equal(isLocalRequest('http://127.0.0.1:5186/m0/model.glb', 5186), true);
    assert.equal(isLocalRequest('blob:http://127.0.0.1:5186/0f8fad5b-d9cb-469f-a165-70867728950e', 5186), true);
    assert.equal(isLocalRequest('data:image/png;base64,iVBORw0KGgo=', 5186), true);
  });

  it('blocks every other host, port and scheme', () => {
    for (const url of [
      'http://127.0.0.1:5187/m0/model.glb',
      'http://127.0.0.1:51860/',
      'http://localhost:5186/',
      'https://127.0.0.1:5186/',
      'http://127.0.0.1:5186@example.com/',
      'http://169.254.169.254/latest/meta-data/x.png',
      'http://192.168.1.1/x.png',
      'https://example.com/pixel.png',
      'blob:https://example.com/0f8fad5b-d9cb-469f-a165-70867728950e',
      'file:///etc/passwd',
      'not a url',
    ]) {
      assert.equal(isLocalRequest(url, 5186), false, url);
    }
  });
});

describe('command line', () => {
  const model = join(dir, 'cli.glb');
  before(() => writeFileSync(model, 'glb'));

  it('rejects bad arguments with exit code 2', () => {
    assert.equal(spawnSync(process.execPath, [SCRIPT]).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, model, '--port', 'lots']).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, join(dir, 'missing.glb')]).status, 2);
  });

  it('exits 2 with a clear message when the browser cannot start', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, model, '--port', String(await freePort())], {
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, 'no-browsers') },
      timeout: 60_000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^browser failed to start: /);
    assert.doesNotMatch(r.stderr, /node:internal|triggerUncaughtException/);
    assert.equal(r.stdout, '');
  });
});
