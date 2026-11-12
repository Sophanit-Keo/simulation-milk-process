// The cup filling room's name tags (phase 31): a floating label over each of the room's units that is not a machine
// of its own, so the 3D view says what each is and what it does now. The units themselves are boxes in the wing's
// shared mesh (cupRoomDetail.ts); a tag is an empty group with a label, so it costs no draw call and takes no click.
import * as THREE from 'three';
import type { PointM } from '../../layout';
import type { Snapshot, YogurtSnapshot } from '../../../contracts';
import plantJson from '../../../data/plant.json';
import type { Equipment } from '../types';
import { AIR_UNIT, CIP_SKID, CUP_PALLET, cupsCalled, FOIL_CART, foilsCalled, QA_BENCH } from './cupRoomDetail';
import { yogurtOf } from './readings';

const P8 = plantJson.yogurt.p8;

/** "1 h 58 min", "12 min": the time to the next seal test, to the minute. */
function minutesText(durationS: number): string {
  const minutes = Math.max(0, Math.ceil(durationS / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes - 60 * hours).padStart(2, '0')} min` : `${minutes} min`;
}

/** What each tag says now. */
export const TAG_TEXT = {
  airUnit: (y: YogurtSnapshot): string => (y.p8.hepaPa === undefined ? '' : `+${y.p8.hepaPa.toFixed(1)} Pa${y.p8.hepaPa < P8.hepa.minPa ? ' · fan stopped' : ''}`),
  cipSkid: (y: YogurtSnapshot): string => (y.p8.state === 'cleaning' ? 'CIP running' : y.p8.state === 'sterilizing' ? `SIP · ${P8.sip.runC} °C steam` : 'standing by'),
  qaBench: (y: YogurtSnapshot, timeS: number): string => (typeof y.p8.nextSealTestS === 'number' ? `seal test in ${minutesText(y.p8.nextSealTestS - timeS)}` : 'no test planned'),
  cups: (y: YogurtSnapshot): string => (y.p8.magazines ? `magazine ${Math.round(y.p8.magazines.cupsPct)} %${cupsCalled(y) ? ' · refilling' : ''}` : ''),
  foils: (y: YogurtSnapshot): string => (y.p8.magazines ? `magazine ${Math.round(y.p8.magazines.foilsPct)} %${foilsCalled(y) ? ' · refilling' : ''}` : ''),
} as const;

function tag(id: string, label: string, anchorM: PointM, text: (y: YogurtSnapshot, timeS: number) => string): Equipment {
  const root = new THREE.Group();
  root.name = id;
  // Not a machine: a label over boxes the wing's shared mesh draws (the tests skip it as a machine).
  root.userData = { equipmentId: id, stage: 15, tokens: true };
  return {
    id,
    stage: 15,
    label,
    object: root,
    labelAnchorM: anchorM,
    labelText(snapshot: Snapshot) {
      const yogurt = yogurtOf(snapshot);
      return yogurt ? text(yogurt, snapshot.timeS) : '';
    },
    update() {},
    dispose() {
      root.removeFromParent();
    },
  };
}

/** The room's tags: the sterile air unit, the CIP/SIP skid, the QA bench, the cup cartons and the foil boxes. */
export function cupRoomTags(): Equipment[] {
  return [
    tag('p8-air-unit', 'Sterile air unit', [AIR_UNIT.xM - 0.3, 2.0, AIR_UNIT.zM], TAG_TEXT.airUnit),
    tag('p8-cip-skid', 'CIP/SIP skid', [CIP_SKID.xM + 0.4, 1.75, CIP_SKID.zM], TAG_TEXT.cipSkid),
    tag('p8-qa-bench', 'QA bench', [QA_BENCH.xM, 1.65, QA_BENCH.zM], TAG_TEXT.qaBench),
    tag('p8-cup-supply', 'Cup cartons', [CUP_PALLET.xM, 1.5, CUP_PALLET.zM], TAG_TEXT.cups),
    tag('p8-foil-supply', 'Foil lids', [FOIL_CART.xM, 1.45, FOIL_CART.zM], TAG_TEXT.foils),
  ];
}
