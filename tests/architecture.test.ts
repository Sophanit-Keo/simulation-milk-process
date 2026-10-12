import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../vitest.config';

// The sim core and the contracts must run headless (plan 07): no three.js, no 3D view, no UI, no browser.
// ESLint enforces this too; this test also catches what a lint override or a disable comment would let through.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = /\.(m?ts|tsx|m?js)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => SOURCE.test(path))
    .map((path) => join(dir, path));
}

/** The code with comments and string contents blanked, so prose never trips a rule. Keeps the quotes. */
function codeOnly(text: string): string {
  return text.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (match) => (/^['"`]/.test(match) ? match[0] + match[0] : ' '),
  );
}

/** Every module specifier in import, export-from and import() statements, in any quotes. */
function moduleSpecifiers(text: string): string[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
  const found: string[] = [];
  const patterns = [/\bfrom\s*(['"`])(.+?)\1/g, /\bimport\s*(['"`])(.+?)\1/g, /\bimport\s*\(\s*(['"`])(.+?)\1/g];
  for (const pattern of patterns) for (const match of withoutComments.matchAll(pattern)) found.push(match[2]);
  return found;
}

/** Every import() call, whatever its specifier: a computed one cannot be checked, so none are allowed. */
function dynamicImports(text: string): string[] {
  return codeOnly(text).match(/\bimport\s*\(/g) ?? [];
}

const files = [...sourceFiles('src/sim'), ...sourceFiles('src/contracts')].map((path) => ({
  path,
  text: readFileSync(join(ROOT, path), 'utf8'),
}));
const simFiles = files.filter((file) => file.path.startsWith(join('src', 'sim')));

describe('architecture: src/sim and src/contracts stay headless', () => {
  it('finds the files to scan', () => {
    expect(files.some((file) => file.path === join('src', 'contracts', 'index.ts'))).toBe(true);
    expect(simFiles.some((file) => file.path === join('src', 'sim', 'index.ts'))).toBe(true);
  });

  it('the scanners see every form of import', () => {
    const probe = [
      "import * as THREE from 'three';",
      'import "three/addons/a.js";',
      "export { World } from '../scene/world';",
      "const a = import('three');",
      'const b = import(`three/webgpu`);',
      "// import('commented-out')",
      'const c = import(name);',
      "const d = import.meta.url, e = typeof import('./clock');",
    ].join('\n');
    expect(moduleSpecifiers(probe)).toEqual(['three', '../scene/world', 'three/addons/a.js', 'three', 'three/webgpu', './clock']);
    expect(dynamicImports(probe)).toHaveLength(4);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s does not import three.js', (_path, file) => {
    const three = moduleSpecifiers(file.text).filter((spec) => spec === 'three' || spec.startsWith('three/'));
    expect(three).toEqual([]);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s does not import src/scene or src/ui', (_path, file) => {
    const viewOrUi = moduleSpecifiers(file.text).filter((spec) => /(^|\/)(scene|ui)(\/|$)/.test(spec));
    expect(viewOrUi).toEqual([]);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s uses static imports only (no import())', (_path, file) => {
    expect(dynamicImports(file.text)).toEqual([]);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s does not touch window or document', (_path, file) => {
    expect(codeOnly(file.text).match(/\b(window|document)\b/g) ?? []).toEqual([]);
  });
});

// The lint rule itself (plan/agent-plan/README.md, ownership rule 5), fed probe code as if it were a file in src/.
describe('architecture: ESLint rejects what the headless core may not use', () => {
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (code: string, folder = 'sim') => {
    const [result] = await eslint.lintText(`${code}\n`, { filePath: join(ROOT, 'src', folder, 'probe.ts') });
    return result.messages.map((message) => message.ruleId);
  };

  it.each([
    ["import * as THREE from 'three';", 'no-restricted-imports'],
    ["export { World } from '../scene/world';", 'no-restricted-imports'],
    ["export const load = () => import('three');", 'no-restricted-syntax'],
    ['export const load = () => import(`three`);', 'no-restricted-syntax'],
    ['export const s = self.location.search;', 'no-restricted-globals'],
    ['export const w = globalThis.window;', 'no-restricted-globals'],
    ["sessionStorage.setItem('a', 'b');", 'no-restricted-globals'],
    ["export const d = indexedDB.open('x');", 'no-restricted-globals'],
    ["export const f = fetch('/x');", 'no-restricted-globals'],
    ['export const x = new XMLHttpRequest();', 'no-restricted-globals'],
    ['export const e = process.env.X;', 'no-restricted-globals'],
  ])('flags %s', async (code, rule) => {
    expect(await lint(code)).toContain(rule);
  });

  it('covers src/contracts too, and only the headless folders', async () => {
    expect(await lint("export const load = () => import('three');", 'contracts')).toContain('no-restricted-syntax');
    expect(await lint("export const f = fetch('/x');", 'contracts')).toContain('no-restricted-globals');
    expect(await lint("export const f = fetch('/x');", 'scene')).toEqual([]);
  });

  it('passes plain headless code', async () => {
    expect(await lint("import { createRng } from './rng';\nexport const n = Math.floor(createRng(1).next() * 2);")).toEqual([]);
  });
});

describe('architecture: src/sim is deterministic and keeps the units rule', () => {
  it.each(simFiles.map((file) => [file.path, file] as const))(
    '%s uses no Math.random, Date or performance.now (all randomness comes from createRng(config.seed))',
    (_path, file) => {
      expect(codeOnly(file.text).match(/\bMath\s*\.\s*random\b|\bDate\b|\bperformance\s*\.\s*now\b/g) ?? []).toEqual([]);
    },
  );

  it.each(simFiles.map((file) => [file.path, file] as const))(
    '%s converts hours and days only through src/contracts/units.ts (no 3600 or 86400 literals; R8)',
    (_path, file) => {
      expect(codeOnly(file.text).match(/(?<![\w.])(3_?600|86_?400)(?![\w.])/g) ?? []).toEqual([]);
    },
  );
});

describe('architecture: the checks cannot pass by running nothing', () => {
  it('vitest.config.ts fails a run that finds no test files (no passWithNoTests)', () => {
    expect(vitestConfig.test?.passWithNoTests ?? false).toBe(false);
  });
});
