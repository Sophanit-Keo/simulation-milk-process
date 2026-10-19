// The fillers as the liquid line sees them: how many are ready to draw and how much they draw.
// Phase 3 stands in a stub (plan: "a constant 2 × 7,500 L/h"); phase 4 replaces this one file with
// fillers that break down and are repaired, behind the same interface.
import type { PlantConfig } from '../contracts';

export interface FillerSupply {
  /** Fillers that would draw now if the aseptic tank has product. The stub's never break down. */
  readyCount(timeS: number): number;
  /** L/h that `running` fillers draw from the aseptic tank at the live filler rate. */
  drawLph(running: number, ratePacksPerH: number): number;
}

export function createFillerStub(config: PlantConfig): FillerSupply {
  return {
    readyCount: () => config.fillers.count,
    drawLph: (running, ratePacksPerH) => running * Math.max(0, ratePacksPerH) * config.product.packVolumeL,
  };
}
