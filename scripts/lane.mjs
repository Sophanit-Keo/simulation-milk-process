#!/usr/bin/env node
// The lane kit (plan/agent-plan/README.md, "Working together faster"): one command for what every agent
// lane did by hand in phases 2–10. Run it through npm: `npm run lane -- <command> <lane> …`.
//
//   ports                         every lane's port
//   start <lane> <task> [--base]  a worktree .claude/worktrees/lane-<lane>-<task> on branch agent/<lane>/<task>, set up
//   setup <lane>                  in a worktree already made (e.g. by the Agent tool): link node_modules, print the lane card
//   owns <lane> [--base]          fail if the lane changed a path it does not own
//   check <lane> [--base] [--e2e] owns, typecheck, lint of the changed files, the lane's unit tests and those the
//                                 change reaches; with --e2e also its browser specs
//   e2e <lane> [-- <args>]        the lane's browser specs on its port, against a production build
//   handoff <lane> [--base]       a hand-off note with what the diff can tell filled in
//
// --base <ref> is where the lane started (default $LANE_BASE, else origin/master, else master).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { configKeysDiff, handoffNote, laneSpecs, loadLanes, outsideOwned } from './lanes.mjs';

const config = loadLanes();
const [command, ...rest] = process.argv.slice(2);
const passThrough = rest.includes('--') ? rest.slice(rest.indexOf('--') + 1) : [];
const args = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1] === '--base'));

function fail(message) {
  console.error(`lane: ${message}`);
  process.exit(1);
}

function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Runs a command with its output shown, and stops the lane command if it fails. */
function run(label, cmd, cmdArgs, env = {}) {
  console.log(`\n=== ${label}: ${[cmd, ...cmdArgs].join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? result.signal})`);
}

function laneOf(id) {
  if (!id) fail(`name a lane: ${Object.keys(config.lanes).join(', ')}`);
  const lane = config.lanes[id];
  if (!lane) fail(`no lane "${id}"; lanes: ${Object.keys(config.lanes).join(', ')}`);
  return lane;
}

function baseRef() {
  for (const ref of [option('--base'), process.env.LANE_BASE, 'origin/master', 'master']) {
    if (ref && git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)) return ref;
  }
  return fail('no base to compare with: pass --base <ref>');
}

/** Every path changed since the lane left its base: committed, staged, unstaged and untracked. */
function changedFiles(base) {
  const mergeBase = git('merge-base', 'HEAD', base) ?? fail(`HEAD and ${base} share no history`);
  const lists = [
    git('diff', '--name-only', mergeBase, 'HEAD'),
    git('diff', '--name-only', 'HEAD'),
    git('ls-files', '--others', '--exclude-standard'),
  ];
  return { mergeBase, files: [...new Set(lists.flatMap((list) => (list ? list.split('\n') : [])))].sort() };
}

function printLane(id, lane) {
  console.log(`Lane ${id} · port ${lane.port} (a reviewer of this lane uses ${lane.port + 5})`);
  console.log(`  owns:  ${lane.owns.join(', ')}`);
  console.log(`  unit:  ${lane.unit.join(', ') || '(none of its own)'}`);
  console.log(`  e2e:   ${laneSpecs(config, id).join(', ')}`);
  console.log(`  check: npm run lane -- check ${id}    browser: npm run lane -- e2e ${id}    note: npm run lane -- handoff ${id}`);
}

function setup(id, root) {
  const lane = laneOf(id);
  const shared = dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir') ?? fail('not in a git repository'));
  const modules = join(root, 'node_modules');
  if (!existsSync(modules) && root !== shared && existsSync(join(shared, 'node_modules'))) {
    symlinkSync(join(shared, 'node_modules'), modules);
    console.log(`Linked node_modules from ${shared} (never npm install in a lane).`);
  }
  printLane(id, lane);
}

function ownsCheck(id, files) {
  const foreign = outsideOwned(files, laneOf(id).owns);
  if (foreign.length > 0) {
    fail(`${id} changed paths it does not own:\n  ${foreign.join('\n  ')}\nAsk their owner in the hand-off note, or move the change.`);
  }
  console.log(`${id} owns all ${files.length} changed path(s).`);
}

function e2e(id) {
  const lane = laneOf(id);
  const env = { E2E_PORT: process.env.E2E_PORT ?? String(lane.port), E2E_SERVER: process.env.E2E_SERVER ?? 'preview' };
  run(`browser specs of ${id}`, 'npx', ['playwright', 'test', ...laneSpecs(config, id), ...passThrough], env);
}

const id = positional[0];
switch (command) {
  case 'ports':
    for (const [laneId, lane] of Object.entries(config.lanes)) console.log(`${String(lane.port).padEnd(6)} ${laneId}`);
    break;
  case 'start': {
    laneOf(id);
    const task = positional[1] ?? fail('name the task: npm run lane -- start <lane> <task>');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(task)) fail('a task name is lower-case words joined by -');
    const top = git('rev-parse', '--show-toplevel') ?? fail('not in a git repository');
    const path = join(top, '.claude', 'worktrees', `lane-${id}-${task}`);
    const result = spawnSync('git', ['worktree', 'add', '-b', `agent/${id}/${task}`, path, baseRef()], { stdio: 'inherit' });
    if (result.status !== 0) fail('git worktree add failed');
    process.chdir(path);
    setup(id, path);
    console.log(`\nWork in ${relative(top, path)} on agent/${id}/${task}.`);
    break;
  }
  case 'setup':
    setup(id, git('rev-parse', '--show-toplevel') ?? fail('not in a git repository'));
    break;
  case 'owns':
    ownsCheck(id, changedFiles(baseRef()).files);
    break;
  case 'check': {
    const lane = laneOf(id);
    const { files } = changedFiles(baseRef());
    ownsCheck(id, files);
    run('typecheck', 'npm', ['run', 'typecheck']);
    const lintable = files.filter((file) => /\.(ts|mjs|js)$/.test(file) && existsSync(file));
    if (lintable.length > 0) run('lint (changed files)', 'npx', ['eslint', ...lintable]);
    if (lane.unit.length > 0) run(`unit tests of ${id}`, 'npx', ['vitest', 'run', ...lane.unit]);
    const sources = files.filter((file) => file.startsWith('src/') && /\.ts$/.test(file) && existsSync(file));
    if (sources.length > 0) run('unit tests the change reaches', 'npx', ['vitest', 'related', '--run', ...sources]);
    if (files.some((file) => file.startsWith('assets/scripts/'))) run('asset-script tests', 'npm', ['run', 'test:assets']);
    if (files.some((file) => file.startsWith('scripts/'))) run('lane-kit tests', 'npm', ['run', 'test:scripts']);
    if (flag('--e2e')) e2e(id);
    console.log(`\n${id}: lane checks pass. The full suite (npm run check, npm run e2e) runs once, at the merge.`);
    break;
  }
  case 'e2e':
    e2e(id);
    break;
  case 'handoff': {
    const { mergeBase, files } = changedFiles(baseRef());
    const versionAt = (text) => /CONTRACT_VERSION = (\d+)/.exec(text ?? '')?.[1];
    const snapshotPath = 'src/contracts/snapshot.ts';
    const before = versionAt(git('show', `${mergeBase}:${snapshotPath}`));
    const after = versionAt(existsSync(snapshotPath) ? readFileSync(snapshotPath, 'utf8') : '');
    const plantPath = 'src/data/plant.json';
    const plantBefore = git('show', `${mergeBase}:${plantPath}`);
    const configKeys = plantBefore && existsSync(plantPath)
      ? configKeysDiff(JSON.parse(plantBefore), JSON.parse(readFileSync(plantPath, 'utf8')))
      : undefined;
    laneOf(id);
    console.log(handoffNote({ id, config, files, contractVersion: before !== after ? { before, after } : undefined, configKeys }));
    break;
  }
  default:
    {
      // The comment at the top of this file, from its second line to the first line of code.
      const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
      const usage = lines.slice(0, lines.findIndex((line) => !line.startsWith('//')));
      console.log(usage.map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    }
    if (command) process.exit(1);
}
