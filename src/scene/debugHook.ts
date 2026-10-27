// window.__scene, for browser tests and perf checks (shared phase 2 spec). Only with ?debug in the URL.
import type { StageId } from '../contracts';
import { STAGE_IDS, msToS } from '../contracts';
import type { PointM } from './layout';

export interface SceneDebug {
  /** Client pixels of a point on the stage's equipment that is visible and pickable from the current camera. */
  stageScreenPoint(stage: number): { x: number; y: number } | null;
  /** Client pixels of a point on a quarantine batch's block that a click would pick (phase 4), or null. */
  batchScreenPoint(batchId: number): { x: number; y: number } | null;
  /** The stage the camera last landed on, or null. */
  focusStage(): number | null;
  /** The point the camera looks at (the orbit controls' target), in metres: a stage's focusM once it has landed there. */
  cameraTarget(): [xM: number, yM: number, zM: number];
  /** The camera's position, in metres. */
  cameraPosition(): [xM: number, yM: number, zM: number];
  /** renderer.info of the last frame. */
  drawCalls(): number;
  triangles(): number;
  /** Frames per second, averaged over the last second. */
  fps(): number;
  equipmentIds(): string[];
  /**
   * What a machine shows now (Equipment.debugState), e.g. { fillFrac: 0.5 } for a tank or
   * { diverting: true, lamp: 'bad', flagRad: -1.57 } for the divert valve; null for an unknown id or a
   * machine that reports nothing. A hero machine adds hero: true once its model has swapped in.
   */
  equipmentState(id: string): EquipmentState | null;
  /** The pipes: whether the divert route is lit, and each line point's stripe offset in metres. */
  pipeState(): { divertLit: boolean; phaseM: Record<string, number> };
}

export type EquipmentState = Readonly<Record<string, number | string | boolean>>;

declare global {
  interface Window {
    __scene?: SceneDebug;
  }
}

/** Averaging window for fps(). */
const FPS_WINDOW_MS = 1_000;

export interface DebugSources {
  stageScreenPoint(stage: StageId): { x: number; y: number } | null;
  batchScreenPoint(batchId: number): { x: number; y: number } | null;
  focusStage(): StageId | null;
  cameraTargetM(): PointM;
  cameraPositionM(): PointM;
  info(): { calls: number; triangles: number };
  equipmentIds(): string[];
  equipmentState(id: string): EquipmentState | null;
  pipeState(): { divertLit: boolean; phaseM: Record<string, number> };
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
    batchScreenPoint: (batchId) => (Number.isInteger(batchId) ? sources.batchScreenPoint(batchId) : null),
    focusStage: () => sources.focusStage(),
    cameraTarget: () => [...sources.cameraTargetM()],
    cameraPosition: () => [...sources.cameraPositionM()],
    drawCalls: () => sources.info().calls,
    triangles: () => sources.info().triangles,
    fps() {
      const recent = frameTimesMs.filter((timeMs) => timeMs >= performance.now() - FPS_WINDOW_MS);
      if (recent.length < 2) return 0;
      return (recent.length - 1) / msToS(recent[recent.length - 1] - recent[0]);
    },
    equipmentIds: () => sources.equipmentIds(),
    // Copies, so a test can't change what the scene holds.
    equipmentState: (id) => {
      const state = sources.equipmentState(String(id));
      return state ? { ...state } : null;
    },
    pipeState: () => {
      const { divertLit, phaseM } = sources.pipeState();
      return { divertLit, phaseM: { ...phaseM } };
    },
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
