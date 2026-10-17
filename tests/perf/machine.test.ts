import { describe, expect, it, vi } from 'vitest';
import { machine } from './machine.mjs';

// measure.mjs needs a build and a browser, so only the machine section of its report is tested here. The
// 60 fps sign-off runs the script on the developer's laptop (tests/perf/baseline.md), likely macOS or
// Windows: the report must read there, or the finished measurement is lost with it.

const host = vi.hoisted(() => ({ platform: 'linux' as NodeJS.Platform, loadavg: [0, 0, 0] }));

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, platform: () => host.platform, loadavg: () => host.loadavg };
});

// Neither macOS nor Windows has /proc or /sys: reading a file there fails as it does on those systems.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
    if (/^\/(proc|sys)\//.test(String(path))) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${String(path)}'`), { code: 'ENOENT' });
    }
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

describe('measure.mjs report: the machine', () => {
  it('reads on macOS, which has no /proc: the load average comes from Node', () => {
    host.platform = 'darwin';
    host.loadavg = [2.346, 1.5, 0.125];
    const read = machine();
    expect(read.platform).toMatch(/^darwin /);
    expect(read.loadAverage, 'rounded to two decimals, as /proc/loadavg gives them').toEqual([2.35, 1.5, 0.13]);
    expect(read.cpu).not.toBe('');
    expect(Number.isInteger(read.cores) && read.cores >= 1, `cores: ${read.cores}`).toBe(true);
    expect(read.memoryGb).toBeGreaterThanOrEqual(0);
    expect(read.node).toBe(process.version);
    // The report is JSON: every field must survive the round trip.
    expect(JSON.parse(JSON.stringify(read))).toEqual(read);
  });

  it('reads on Windows, which has no load average: null rather than an idle machine', () => {
    host.platform = 'win32';
    host.loadavg = [0, 0, 0];
    const read = machine();
    expect(read.platform).toMatch(/^win32 /);
    expect(read.loadAverage).toBeNull();
  });
});
