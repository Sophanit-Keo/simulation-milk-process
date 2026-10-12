import { liquidLine } from './liquidLine';
import { packsLine } from './packsLine';
import type { EquipmentFactory } from './types';

/** Every machine in the plant: the liquid line (stages 1–6) and packs to trucks (stages 7–10). */
export const EQUIPMENT_FACTORIES: readonly EquipmentFactory[] = [liquidLine, packsLine];

export type { Equipment, EquipmentContext, EquipmentFactory, MaterialName } from './types';
