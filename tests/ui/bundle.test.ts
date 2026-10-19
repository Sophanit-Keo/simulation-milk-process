// What the main bundle carries: lil-gui only behind ?debug (a dynamic import), and Chart.js not at all: it
// comes in a chunk of its own when a trend chart is first shown, with only the parts the trends register.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const sources = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.ts$/.test(path))
  .map((path) => ({ path: join('src', path), text: readFileSync(join(ROOT, 'src', path), 'utf8') }));

/** Static import and export-from specifiers (not `import type`, which leaves nothing in the bundle). */
function staticImports(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map(
    (match) => match[1] ?? match[2],
  );
}

describe('the main bundle', () => {
  it('finds the sources to scan', () => {
    expect(sources.some((file) => file.path === join('src', 'main.ts'))).toBe(true);
  });

  it('imports lil-gui statically only in the debug panel, and the debug panel only with import()', () => {
    const lilGui = sources.filter((file) => staticImports(file.text).includes('lil-gui')).map((file) => file.path);
    expect(lilGui).toEqual([join('src', 'ui', 'debugPanel.ts')]);
    const debugPanel = sources.filter((file) => staticImports(file.text).some((spec) => /debugPanel$/.test(spec)));
    expect(debugPanel.map((file) => file.path)).toEqual([]);
    const main = sources.find((file) => file.path === join('src', 'main.ts'));
    expect(main?.text).toMatch(/import\(\s*['"]\.\/ui\/debugPanel['"]\s*\)/);
  });

  it('loads the debug panel only when the URL asks for ?debug', () => {
    const main = sources.find((file) => file.path === join('src', 'main.ts'))?.text ?? '';
    expect(main).toMatch(/if \(params\.has\('debug'\)\) \{\s*void import\('\.\/ui\/debugPanel'\)/);
  });

  it('takes Chart.js as named parts it registers, never chart.js/auto, in a chunk loaded with import()', () => {
    const specs = sources.flatMap((file) => staticImports(file.text).map((spec) => ({ path: file.path, spec })));
    expect(specs.filter(({ spec }) => spec.startsWith('chart.js/auto'))).toEqual([]);
    const users = specs.filter(({ spec }) => spec === 'chart.js').map(({ path }) => path);
    expect(users).toEqual([join('src', 'ui', 'trendCanvas.ts')]);
    const canvas = sources.find((file) => file.path === join('src', 'ui', 'trendCanvas.ts'))?.text ?? '';
    expect(canvas).toMatch(/Chart\.register\(LineController, LineElement, PointElement, LinearScale\)/);
    expect(specs.filter(({ spec }) => /trendCanvas$/.test(spec))).toEqual([]);
    const chart = sources.find((file) => file.path === join('src', 'ui', 'trendChart.ts'))?.text ?? '';
    expect(chart).toMatch(/import\('\.\/trendCanvas'\)/);
  });
});
