// window.__scene, for browser tests and perf checks (shared phase 2 spec). Only with ?debug in the URL.
import type { StageId } from '../contracts';
import { STAGE_IDS } from '../contracts';

export interface SceneDebug {
  /** Client pixels of a point on the stage's equipment that is visible and pickable from the current camera. */
  stageScreenPoint(stage: number): { x: number; y: number } | null;
  /** The stage the camera last landed on, or null. */
  focusStage(): number | null;
  /** renderer.info of the last frame. */
  drawCalls(): number;
  triangles(): number;
  /** Frames per second, averaged over the last second. */
  fps(): number;
  equipmentIds(): string[];
}

declare global {
  interface Window {
    __scene?: SceneDebug;
  }
}

/** Averaging window for fps(). */
const FPS_WINDOW_MS = 1_000;

export interface DebugSources {
  stageScreenPoint(stage: StageId): { x: number; y: number } | null;
  focusStage(): StageId | null;
  info(): { calls: number; triangles: number };
  equipmentIds(): string[];
}

export interface DebugHook {
  /** Call once per rendered frame. */
  frame(nowMs: number): void;
  dispose(): void;
}

export function debugRequested(): boolean {
  return new URLSearchParams(location.search).has('debug');
}

export function installDebugHook(sources: DebugSources): DebugHook {
  const frameTimesMs: number[] = [];
  const hook: SceneDebug = {
    stageScreenPoint: (stage) => (STAGE_IDS.includes(stage as StageId) ? sources.stageScreenPoint(stage as StageId) : null),
    focusStage: () => sources.focusStage(),
    drawCalls: () => sources.info().calls,
    triangles: () => sources.info().triangles,
    fps() {
      const recent = frameTimesMs.filter((timeMs) => timeMs >= performance.now() - FPS_WINDOW_MS);
      if (recent.length < 2) return 0;
      return ((recent.length - 1) * 1_000) / (recent[recent.length - 1] - recent[0]);
    },
    equipmentIds: () => sources.equipmentIds(),
  };
  window.__scene = hook;
  return {
    frame(nowMs) {
      frameTimesMs.push(nowMs);
      while (frameTimesMs.length > 0 && frameTimesMs[0] < nowMs - FPS_WINDOW_MS) frameTimesMs.shift();
    },
    dispose() {
      if (window.__scene === hook) delete window.__scene;
    },
  };
}
