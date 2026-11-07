// Types for what TypeScript tests import from make-heroes.mjs (phase 24): the yogurt gantry palletizer's layout, which
// the scene's motion (src/scene/equipment/yogurt/palletLine.ts) must keep to.
export declare const GANTRY: {
  readonly postsXM: readonly [number, number];
  readonly postsZM: number;
  readonly beamTopM: number;
  readonly bridgeYM: number;
  readonly liftRestM: number;
  readonly mastM: number;
  readonly head: { readonly xM: number; readonly zM: number; readonly padsM: number; readonly plateM: number };
  readonly bridgeTravelM: readonly [number, number];
  readonly trolleyTravelM: readonly [number, number];
  readonly lowestM: number;
  readonly pickXM: number;
  readonly infeed: { readonly xM: readonly [number, number]; readonly topM: number; readonly widthM: number };
  readonly rollerTopM: number;
  readonly place: { readonly xM: readonly [number, number]; readonly widthM: number };
  readonly dispenser: { readonly zM: number; readonly guideXM: number; readonly guideZM: number; readonly heightM: number };
};
