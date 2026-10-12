// STUB (phase 1 scaffold): `sim` replaces this with the clock, event queue and static plant.
import { CONTRACT_VERSION, STAGE_IDS, type Command, type Kpis, type PlantConfig, type Sim, type Snapshot, type Speed, type StageId, type StageSnapshot } from '../contracts';

export function createSim(config: PlantConfig): Sim {
  let timeS = config.clock.startTimeS;
  let speed = config.clock.defaultSpeed as Speed;
  let paused = false;
  return {
    step(realDtS) {
      if (!paused) timeS += Math.min(realDtS, config.clock.maxFrameS) * speed;
    },
    dispatch(command: Command) {
      if (command.type === 'setSpeed') speed = command.speed;
      if (command.type === 'pause') paused = command.paused;
    },
    snapshot(): Snapshot {
      const stages = Object.fromEntries(
        STAGE_IDS.map((id): [StageId, StageSnapshot] => [id, { id, status: 'idle', values: {} }]),
      ) as Record<StageId, StageSnapshot>;
      const kpis: Kpis = {
        uhtFlowLph: 0, f0Min: 0, bStar: 0, divertedL: 0, tankLevelPct: 0, packsPerH: 0, oeePct: 0, traysMade: 0,
        palletsMade: 0, batchesOnHold: 0, batchesReleased: 0, batchesBlocked: 0, palletsInStock: 0, daysOfCover: 0,
        orderFillPct: 0, trucksShipped: 0,
      };
      return { version: CONTRACT_VERSION, timeS, speed, paused, nextEventS: null, stages, kpis, log: [] };
    },
  };
}
