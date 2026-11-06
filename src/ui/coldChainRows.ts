// The yogurt cold chain's states in words (phase 19, D29), for the stage 16 panel: the trays and the pallet at the
// palletizer, the warm room's pH queue, the chiller, the cold room and its next release, and the reefers. Each reads
// the snapshot's coldChain part; a field an older snapshot lacks reads "—".
import type { ColdChainSnapshot, PlantConfig, Snapshot } from '../contracts';
import plantJson from '../data/plant.json';
import { formatDuration, formatNumber, NO_VALUE, withUnit } from './format';
import type { StateText } from './liquidRows';

const CHAIN: PlantConfig['yogurt']['coldChain'] = plantJson.yogurt.coldChain;
const NONE: StateText = { text: NO_VALUE, status: 'idle' };

/** The cold chain of a snapshot, or undefined for one without the yogurt line. */
export const coldChainOf = (snapshot: Snapshot): ColdChainSnapshot | undefined => (snapshot as Partial<Snapshot>).yogurt?.coldChain;

const count = (value: number, one: string, many: string): string => `${formatNumber(value)} ${value === 1 ? one : many}`;

/** The trays packed and the pallet building: "19,872 trays packed · P8-008-1's pallet at 109 of 120 trays". */
export function traysText(chain: ColdChainSnapshot | undefined): StateText {
  const trays = chain?.trays;
  if (!trays) return NONE;
  const building = trays.openBatch === null ? 'no pallet building' : `${trays.openBatch}'s pallet at ${formatNumber(trays.openTrays)} of ${formatNumber(CHAIN.traysPerPallet)} trays`;
  return { text: `${count(trays.made, 'tray', 'trays')} packed · ${building}`, status: trays.openBatch === null ? 'idle' : 'ok' };
}

/** The warm room and its pH queue: "30 of 36 pallets · pH 4.63 to 6.12, out at 4.60"; amber once it is full. */
export function warmRoomText(chain: ColdChainSnapshot | undefined): StateText {
  if (!chain) return NONE;
  const { pallets, capacity } = chain.warmRoom;
  const held = capacity === undefined ? count(pallets, 'pallet', 'pallets') : `${formatNumber(pallets)} of ${formatNumber(capacity)} pallets`;
  const phs = (chain.pallets ?? []).filter((pallet) => pallet.place === 'warmRoom').map((pallet) => pallet.ph);
  if (phs.length === 0) return { text: `${held} · empty`, status: 'idle' };
  const queue = `pH ${formatNumber(Math.min(...phs), 2)} to ${formatNumber(Math.max(...phs), 2)}, out at ${formatNumber(CHAIN.releasePh, 2)}`;
  return { text: `${held} · ${queue}`, status: capacity !== undefined && pallets >= capacity ? 'warn' : 'ok' };
}

/** The blast chiller: "18 of 32 pallets · air −2 °C · warmest core 15.2 °C"; amber once it is full. */
export function chillerText(chain: ColdChainSnapshot | undefined): StateText {
  if (!chain) return NONE;
  const { pallets, capacity, airC } = chain.chiller;
  const held = capacity === undefined ? count(pallets, 'pallet', 'pallets') : `${formatNumber(pallets)} of ${formatNumber(capacity)} pallets`;
  const air = airC === undefined ? '' : ` · air ${withUnit(formatNumber(airC), '°C')}`;
  const cores = (chain.pallets ?? []).filter((pallet) => pallet.place === 'chiller').map((pallet) => pallet.tempC);
  const warmest = cores.length > 0 ? ` · warmest core ${withUnit(formatNumber(Math.max(...cores), 1), '°C')}` : '';
  return { text: `${held}${air}${warmest}`, status: pallets === 0 ? 'idle' : capacity !== undefined && pallets >= capacity ? 'warn' : 'ok' };
}

/** The cold room: "180 of 360 positions · 3.0 °C"; amber outside the 2–4 °C band or full. */
export function coldRoomText(chain: ColdChainSnapshot | undefined): StateText {
  if (!chain) return NONE;
  const { positionsUsed, capacity, tempC } = chain.coldRoom;
  const used = capacity === undefined ? count(positionsUsed, 'position', 'positions') : `${formatNumber(positionsUsed)} of ${formatNumber(capacity)} positions`;
  const outside = tempC < CHAIN.roomMinC || tempC > CHAIN.roomMaxC;
  return { text: `${used} · ${withUnit(formatNumber(tempC, 1), '°C')}`, status: outside || (capacity !== undefined && positionsUsed >= capacity) ? 'warn' : 'ok' };
}

/** The next pallet released and those waiting: "In 25 min · 12 released, waiting for a reefer". */
export function releaseText(chain: ColdChainSnapshot | undefined, timeS: number): StateText {
  if (!chain || chain.coldRoom.nextReleaseS === undefined) return NONE;
  const waiting = (chain.pallets ?? []).filter((pallet) => pallet.place === 'coldRoom' && pallet.released).length;
  const next = chain.coldRoom.nextReleaseS === null ? 'None on hold' : `In ${formatDuration(Math.max(0, chain.coldRoom.nextReleaseS - timeS))}`;
  return { text: `${next} · ${count(waiting, 'pallet', 'pallets')} released, waiting for a reefer`, status: waiting > 0 ? 'ok' : 'idle' };
}

/** The reefers at the dock and the day's shipments: "Reefer 7 loading at door 1, 13 of 26 · 6 shipped". */
export function reefersText(chain: ColdChainSnapshot | undefined, timeS: number): StateText {
  if (!chain) return NONE;
  const shipped = `${formatNumber(chain.reefersShipped)} shipped`;
  const reefers = chain.reefers;
  if (!reefers) return { text: shipped, status: 'idle' };
  if (reefers.length === 0) return { text: `None at the dock · ${shipped}`, status: 'idle' };
  const each = reefers.map((reefer) =>
    reefer.state === 'arriving'
      ? `reefer ${reefer.id} backing to door ${reefer.door + 1} in ${formatDuration(Math.max(0, reefer.untilS - timeS))}`
      : `reefer ${reefer.id} loading at door ${reefer.door + 1}, ${formatNumber(reefer.pallets)} of ${formatNumber(reefer.load)}`,
  );
  const text = each.join(' · ');
  return { text: `${text.charAt(0).toUpperCase()}${text.slice(1)} · ${shipped}`, status: 'ok' };
}
