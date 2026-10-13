import { liquidLine } from './liquidLine';
import { packsLine } from './packsLine';
import type { EquipmentFactory } from './types';
import { utilities } from './utilities';

/** Every machine in the plant: the liquid line (stages 1–6), packs to trucks (stages 7–10) and the utilities. */
export const EQUIPMENT_FACTORIES: readonly EquipmentFactory[] = [liquidLine, packsLine, utilities];

export type { Equipment, EquipmentContext, EquipmentFactory, MaterialName } from './types';
