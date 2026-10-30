// The lane kit (scripts/lanes.mjs, scripts/lanes.json): its pure parts, and that the lanes map still fits
// the repo: every owned path exists, every source file and every browser spec has a lane.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  areaOf,
  checkLanes,
  configKeysDiff,
  handoffNote,
  isOwned,
  laneSpecs,
  leafKeys,
  loadLanes,
  outsideOwned,
  ownersOf,
} from './lanes.mjs';

const config = loadLanes();
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
/** Lanes that run a part of the plant, not the test lane, which owns every test. */
const featureLanes = Object.entries(config.lanes).filter(([id]) => id !== 'qa');

describe('scripts/lanes.json', () => {
  it('is usable: unique ports, and owns, unit and e2e lists for every lane', () => {
    assert.deepEqual(checkLanes(config), []);
  });

  it('names only paths that exist', () => {
    for (const [id, lane] of Object.entries(config.lanes)) {
      for (const path of [...lane.owns, ...lane.unit, ...lane.e2e]) assert.ok(existsSync(path), `${id}: ${path}`);
    }
    for (const spec of config.alwaysE2e) assert.ok(existsSync(spec), spec);
  });

  it('gives every file under src/ a lane, so no change lands without an owner', () => {
    const orphans = tracked.filter((path) => path.startsWith('src/') && ownersOf(path, Object.fromEntries(featureLanes)).length === 0);
    assert.deepEqual(orphans, [], 'add these to a lane in scripts/lanes.json');
  });

  it('puts every browser spec in some lane tier (or the always-run list), so a lane change runs it before the merge', () => {
    const inATier = new Set([...config.alwaysE2e, ...featureLanes.flatMap(([, lane]) => lane.e2e)]);
    const specs = tracked.filter((path) => path.startsWith('e2e/') && path.endsWith('.spec.ts'));
    assert.deepEqual(specs.filter((spec) => !inATier.has(spec)), []);
  });

  it('gives the lead the contracts and the plan, and the qa lane every test', () => {
    assert.ok(isOwned('src/contracts/snapshot.ts', config.lanes.lead.owns));
    assert.ok(isOwned('plan/agent-plan/README.md', config.lanes.lead.owns));
    assert.ok(isOwned('e2e/divert.spec.ts', config.lanes.qa.owns));
    assert.ok(isOwned('tests/sim/liquidLine.test.ts', config.lanes.qa.owns));
  });
});

describe('checkLanes', () => {
  it('lists every problem: a shared port, a missing list, an empty owns, a bad id', () => {
    const problems = checkLanes({
      alwaysE2e: [],
      lanes: {
        a: { port: 5900, owns: ['src/a/'], unit: [], e2e: [] },
        b: { port: 5900, owns: [], unit: [], e2e: [] },
        Bad_Id: { port: 80, owns: ['x'], e2e: [] },
      },
    });
    assert.ok(problems.some((problem) => problem.includes('5900') && problem.includes("a's")));
    assert.ok(problems.includes('b.owns must name at least one path'));
    assert.ok(problems.includes('Bad_Id.unit must be a list of paths'));
    assert.ok(problems.some((problem) => problem.startsWith('lane id "Bad_Id"')));
    assert.ok(problems.some((problem) => problem.startsWith('Bad_Id.port')));
  });
});

describe('ownership', () => {
  const owns = ['src/sim/', 'tests/helpers/liquidRun.ts'];

  it('owns everything under a folder entry, and only the named file otherwise', () => {
    assert.equal(isOwned('src/sim/liquidLine.ts', owns), true);
    assert.equal(isOwned('src/sim/liquid/stageModels.ts', owns), true);
    assert.equal(isOwned('tests/helpers/liquidRun.ts', owns), true);
    assert.equal(isOwned('tests/helpers/plantConfig.ts', owns), false);
    // A folder entry is not a prefix of a longer folder name.
    assert.equal(isOwned('src/simulation/x.ts', owns), false);
  });

  it('lists the paths outside, in order, and who owns them', () => {
    assert.deepEqual(outsideOwned(['src/sim/a.ts', 'src/ui/hud.ts', 'plan/README.md'], owns), ['src/ui/hud.ts', 'plan/README.md']);
    assert.deepEqual(ownersOf('src/ui/hud.ts', config.lanes), ['ui']);
    assert.deepEqual(ownersOf('src/data/stages.json', config.lanes).sort(), ['process', 'ui']);
    assert.deepEqual(ownersOf('nowhere/at/all', config.lanes), []);
  });
});

describe('laneSpecs', () => {
  it('runs the always-run specs first, then the lane’s own, once each', () => {
    const specs = laneSpecs(config, 'ui');
    assert.equal(specs[0], 'e2e/smoke.spec.ts');
    assert.ok(specs.includes('e2e/controls.spec.ts'));
    assert.equal(new Set(specs).size, specs.length);
  });

  it('throws for a lane that is not in the map', () => {
    assert.throws(() => laneSpecs(config, 'nobody'), /no lane "nobody"/);
  });
});

describe('config keys and the hand-off note', () => {
  it('reads plant.json as dotted leaf keys, arrays as leaves', () => {
    assert.deepEqual(leafKeys({ uht: { setpointC: 140, list: [1, 2] }, seed: 1 }), ['uht.setpointC', 'uht.list', 'seed']);
  });

  it('finds the keys a change added and removed', () => {
    assert.deepEqual(configKeysDiff({ uht: { setpointC: 140, old: 1 } }, { uht: { setpointC: 141, mode: 'direct' } }), {
      added: ['uht.mode'],
      removed: ['uht.old'],
    });
  });

  it('groups src/ by its folders and the rest by the top folder', () => {
    assert.equal(areaOf('src/sim/liquidLine.ts'), 'src/sim/');
    assert.equal(areaOf('src/main.ts'), 'src/');
    assert.equal(areaOf('tests/sim/a.test.ts'), 'tests/');
    assert.equal(areaOf('index.html'), 'index.html');
  });

  it('fills the note: areas, the contract version, the new keys, tests, the lane command, and files for their owner', () => {
    const note = handoffNote({
      id: 'sim',
      config,
      files: ['src/contracts/snapshot.ts', 'src/sim/liquidLine.ts', 'tests/sim/x.test.ts', 'src/ui/hud.ts', 'scripts/y.test.mjs'],
      contractVersion: { before: '7', after: '8' },
      configKeys: { added: ['uht.mode'], removed: [] },
    });
    assert.match(note, /^Changed: {5}src\/contracts\/ \(1\), src\/sim\/ \(1\), tests\/ \(1\), src\/ui\/ \(1\), scripts\/ \(1\)/);
    assert.match(note, /CONTRACT_VERSION 7 → 8/);
    assert.match(note, /plant\.json: added uht\.mode; removed none/);
    assert.match(note, /Tests: {7}tests\/sim\/x\.test\.ts, scripts\/y\.test\.mjs/);
    assert.match(note, /E2E_PORT=5920 npm run lane -- e2e sim/);
    assert.match(note, /src\/ui\/hud\.ts \(owner: ui\)/);
    assert.match(note, /src\/contracts\/snapshot\.ts \(owner: lead\)/);
  });
});
