import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

/** Every module specifier in import, export-from and import() statements. */
function moduleSpecifiers(text: string): string[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
  const found: string[] = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g];
  for (const pattern of patterns) for (const match of withoutComments.matchAll(pattern)) found.push(match[1]);
  return found;
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

  it.each(files.map((file) => [file.path, file] as const))('%s does not import three.js', (_path, file) => {
    const three = moduleSpecifiers(file.text).filter((spec) => spec === 'three' || spec.startsWith('three/'));
    expect(three).toEqual([]);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s does not import src/scene or src/ui', (_path, file) => {
    const viewOrUi = moduleSpecifiers(file.text).filter((spec) => /(^|\/)(scene|ui)(\/|$)/.test(spec));
    expect(viewOrUi).toEqual([]);
  });

  it.each(files.map((file) => [file.path, file] as const))('%s does not touch window or document', (_path, file) => {
    expect(codeOnly(file.text).match(/\b(window|document)\b/g) ?? []).toEqual([]);
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
