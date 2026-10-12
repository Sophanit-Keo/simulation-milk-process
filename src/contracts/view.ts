import type { StageId } from './stages';

/** UI ↔ 3D view. View events never reach the sim. */
export type ViewEvent =
  | { type: 'selectStage'; stage: StageId }
  | { type: 'selectBatch'; batchId: number }
  | { type: 'tour'; on: boolean };
