import { liquidLine } from './liquidLine';
import { packsLine } from './packsLine';
import type { EquipmentFactory } from './types';
import { utilities } from './utilities';
import { yogurtLine } from './yogurtLine';

/** Every machine in the plant: the liquid line (stages 1–6), packs to trucks (stages 7–10), the utilities and the yogurt wing (11–16). */
export const EQUIPMENT_FACTORIES: readonly EquipmentFactory[] = [liquidLine, packsLine, utilities, yogurtLine];

export type { Equipment, EquipmentContext, EquipmentFactory, MaterialName } from './types';
