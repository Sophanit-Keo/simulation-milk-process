import type { StageId } from './stages';

/** UI ↔ 3D view. View events never reach the sim. */
export type ViewEvent =
  | { type: 'selectStage'; stage: StageId }
  | { type: 'selectBatch'; batchId: number }
  | { type: 'tour'; on: boolean };

export type ViewListener = (event: ViewEvent) => void;

/**
 * The one channel between `ui` and `scene` (contracts v1): a rail click and a 3D click both emit
 * selectStage, and both sides react to it, so they always agree on the selected stage.
 */
export interface ViewBus {
  emit(event: ViewEvent): void;
  /** Returns a function that removes the listener. */
  on(listener: ViewListener): () => void;
}

export function createViewBus(): ViewBus {
  const listeners = new Set<ViewListener>();
  return {
    emit(event) {
      // A copy, so a listener that unsubscribes while handling the event doesn't skip the next one.
      for (const listener of [...listeners]) listener(event);
    },
    on(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
