// Types of machine.mjs, for machine.test.ts.

export interface Machine {
  /** OS, its release and the CPU architecture, e.g. "darwin 24.6.0 arm64". */
  platform: string;
  cpu: string;
  cores: number;
  memoryGb: number;
  node: string;
  /** 1, 5 and 15 minute load averages; null on Windows, which has none. */
  loadAverage: number[] | null;
}

export function machine(): Machine;
