// Stage 14 (phase 17, D27): the P8 buffer, first in first out, so a parcel of set mix knows how long it has waited.
// It holds one product at a time; the changeover between two runs on P8 needs it empty.

export interface BufferParcel {
  litres: number;
  enteredS: number;
}

export interface Buffer {
  readonly levelL: number;
  add(litres: number, atS: number): void;
  /** Draws up to `litres` from the oldest parcels; returns what it drew. */
  draw(litres: number): number;
  /** Takes out every parcel that has waited more than `maxS` at `nowS`; returns the litres. */
  discardOlderThan(maxS: number, nowS: number): number;
  /** How long the oldest parcel has waited; null while empty. */
  oldestWaitS(nowS: number): number | null;
}

/** Litres below this count as none. */
const BUFFER_EPS_L = 1e-9;

export function createBuffer(): Buffer {
  const parcels: BufferParcel[] = [];
  let levelL = 0;
  return {
    get levelL() {
      return levelL;
    },
    add(litres, atS) {
      if (!(litres > BUFFER_EPS_L)) return;
      parcels.push({ litres, enteredS: atS });
      levelL += litres;
    },
    draw(litres) {
      let left = Math.min(Math.max(litres, 0), levelL);
      const drawn = left;
      while (left > BUFFER_EPS_L && parcels.length > 0) {
        const head = parcels[0];
        const take = Math.min(head.litres, left);
        head.litres -= take;
        left -= take;
        if (head.litres <= BUFFER_EPS_L) parcels.shift();
      }
      levelL = Math.max(0, levelL - drawn);
      if (parcels.length === 0) levelL = 0;
      return drawn;
    },
    discardOlderThan(maxS, nowS) {
      let gone = 0;
      while (parcels.length > 0 && nowS - parcels[0].enteredS > maxS) {
        gone += parcels[0].litres;
        parcels.shift();
      }
      levelL = parcels.length === 0 ? 0 : Math.max(0, levelL - gone);
      return gone;
    },
    oldestWaitS: (nowS) => (parcels.length > 0 ? nowS - parcels[0].enteredS : null),
  };
}
