// The machine section of measure.mjs's report, in a module of its own so that machine.test.ts can check it
// without a build or a browser. Node's own calls only: the 60 fps sign-off runs measure.mjs on the
// developer's laptop, which may be macOS or Windows, and a Linux-only read there (/proc) would throw after
// the measurement and lose the whole report.

import { arch, availableParallelism, cpus, loadavg, platform, release, totalmem } from 'node:os';
import process from 'node:process';

/** The machine as far as Node sees it; the GPU comes from the browser. */
export function machine() {
  const cores = cpus();
  return {
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cores[0]?.model.trim() ?? 'unknown',
    cores: availableParallelism(),
    memoryGb: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    // Other work on the machine slows software GL; the load average says how busy it was. Windows has
    // none (os.loadavg() reads 0, 0, 0 there), so null rather than an idle machine that may not have been.
    loadAverage: platform() === 'win32' ? null : loadavg().map((value) => Math.round(value * 100) / 100),
  };
}
