// The fillers as the liquid line sees them: how many are ready to draw and how much they draw.
// Phase 3 stood in this stub (plan: "a constant 2 × 7,500 L/h"); since phase 4 the sim runs the fillers of
// packsLine.ts behind the same interface, and the stub stays the liquid line's default for its own tests.
import type { PlantConfig } from '../contracts';

export interface FillerSupply {
  /** Fillers that would draw now if the aseptic tank has product. The stub's never break down. */
  readyCount(timeS: number): number;
  /** L/h that `running` fillers draw from the aseptic tank at the live filler rate. */
  drawLph(running: number, ratePacksPerH: number): number;
  /**
   * Told after every cut of a liquid-line step: the fillers ran for dtS up to endS at the live rate, fed by
   * the aseptic tank or starved by it. The phase 4 fillers make their packs here; the stub counts nothing.
   */
  ran?(dtS: number, endS: number, fed: boolean, ratePacksPerH: number): void;
}

export function createFillerStub(config: PlantConfig): FillerSupply {
  return {
    readyCount: () => config.fillers.count,
    drawLph: (running, ratePacksPerH) => running * Math.max(0, ratePacksPerH) * config.product.packVolumeL,
  };
}
