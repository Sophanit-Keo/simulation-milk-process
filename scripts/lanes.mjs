// The lane kit's pure parts (plan/agent-plan/README.md, "Working together faster"): reading
// scripts/lanes.json, who owns a path, a lane's browser specs, and the hand-off note's skeleton.
// scripts/lane.mjs runs git and npm around them; scripts/lanes.test.mjs checks them.
import { readFileSync } from 'node:fs';

/** Reads scripts/lanes.json and throws, listing every problem, if it is not usable. */
export function loadLanes(path = new URL('./lanes.json', import.meta.url)) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const problems = checkLanes(config);
  if (problems.length > 0) throw new Error(`scripts/lanes.json is not usable:\n${problems.join('\n')}`);
  return config;
}

/** Every problem in a lanes config; an empty list means it is usable. */
export function checkLanes(config) {
  const problems = [];
  const lanes = config?.lanes;
  if (!lanes || typeof lanes !== 'object') return ['lanes must be an object of lane id → lane'];
  if (!Array.isArray(config.alwaysE2e)) problems.push('alwaysE2e must be a list of specs');
  const ports = new Map();
  for (const [id, lane] of Object.entries(lanes)) {
    if (!/^[a-z][a-z-]*$/.test(id)) problems.push(`lane id "${id}" must be lower-case words joined by -`);
    if (!Number.isInteger(lane.port) || lane.port < 1024 || lane.port > 65_000) problems.push(`${id}.port must be a whole number 1024–65000`);
    else if (ports.has(lane.port)) problems.push(`${id}.port ${lane.port} is also ${ports.get(lane.port)}'s`);
    else ports.set(lane.port, id);
    for (const key of ['owns', 'unit', 'e2e']) {
      if (!Array.isArray(lane[key]) || !lane[key].every((entry) => typeof entry === 'string' && entry.length > 0)) {
        problems.push(`${id}.${key} must be a list of paths`);
      }
    }
    if (Array.isArray(lane.owns) && lane.owns.length === 0) problems.push(`${id}.owns must name at least one path`);
  }
  return problems;
}

/** Whether a repo-relative path is inside one of `owns`: an entry ending in / owns everything under it. */
export function isOwned(path, owns) {
  return owns.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

/** The paths a lane changed that it does not own, in the order given. */
export function outsideOwned(paths, owns) {
  return paths.filter((path) => !isOwned(path, owns));
}

/** The lanes that own a path, for "ask its owner" in a hand-off note. */
export function ownersOf(path, lanes) {
  return Object.entries(lanes)
    .filter(([, lane]) => isOwned(path, lane.owns))
    .map(([id]) => id);
}

/** A lane's browser specs for its lane tier: the always-run ones, then its own, once each. */
export function laneSpecs(config, id) {
  const lane = config.lanes[id];
  if (!lane) throw new Error(`no lane "${id}" in scripts/lanes.json`);
  return [...new Set([...config.alwaysE2e, ...lane.e2e])];
}

/** The keys of a JSON object as dotted paths to its leaves, such as "uht.setpointC". */
export function leafKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

/** The plant.json keys added and removed between two versions of the file. */
export function configKeysDiff(before, after) {
  const was = new Set(leafKeys(before));
  const now = new Set(leafKeys(after));
  return {
    added: [...now].filter((key) => !was.has(key)).sort(),
    removed: [...was].filter((key) => !now.has(key)).sort(),
  };
}

/** Where a file sits, for grouping: "src/sim/" under src/, else its top folder, or the file at the root. */
export function areaOf(file) {
  const parts = file.split('/');
  if (parts.length === 1) return file;
  if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}/`;
  return `${parts[0]}/`;
}

/**
 * The hand-off note (agent plan, "The task loop") with what the diff can tell filled in: the files by
 * area, contract and plant.json changes, tests touched, how to see it, and files to hand to their owner.
 */
export function handoffNote({ id, config, files, contractVersion, configKeys }) {
  const lane = config.lanes[id];
  const byArea = new Map();
  for (const file of files) byArea.set(areaOf(file), [...(byArea.get(areaOf(file)) ?? []), file]);
  const changed = [...byArea].map(([area, list]) => `${area} (${list.length})`).join(', ') || 'nothing yet';
  const contracts = files.filter((file) => file.startsWith('src/contracts/'));
  const contract =
    contracts.length === 0
      ? 'none changed'
      : `${contracts.join(', ')}${contractVersion ? `; CONTRACT_VERSION ${contractVersion.before} → ${contractVersion.after}` : ''}`;
  const keys = configKeys && (configKeys.added.length > 0 || configKeys.removed.length > 0)
    ? `plant.json: added ${configKeys.added.join(', ') || 'none'}; removed ${configKeys.removed.join(', ') || 'none'}`
    : 'plant.json unchanged';
  const tests = files.filter((file) => file.startsWith('tests/') || file.startsWith('e2e/') || /\.test\.m?[jt]s$/.test(file));
  const foreign = outsideOwned(files, lane.owns).map((file) => `${file} (owner: ${ownersOf(file, config.lanes).join(' or ') || 'none'})`);
  return [
    `Changed:     ${changed}  <- say what, in one or two lines`,
    `Contract:    ${contract}; ${keys}`,
    `Tests:       ${tests.length > 0 ? tests.join(', ') : 'none touched'}`,
    `See it:      E2E_PORT=${lane.port} npm run lane -- e2e ${id}   <- plus the speed and stage to click`,
    `For others:  ${foreign.length > 0 ? `outside ${id}'s paths: ${foreign.join(', ')}` : '<- follow-up tasks this creates, by agent'}`,
  ].join('\n');
}
