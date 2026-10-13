// One floating label per machine (CSS2D, styled in labels.css): a status lamp, the machine's name and
// one live value. Far from the camera a label shrinks to its lamp, so the overview reads as a map of
// lamps and a close view names every machine.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Snapshot, StageId, Status } from '../contracts';
import type { Equipment } from './equipment';

/** Closer than this a label shows its name and value; further away only its lamp (the preview's compact badges). */
const FULL_LABEL_WITHIN_M = 60;

export interface EquipmentLabels {
  /** Values and lamps from the snapshot; about 4 times a second is enough (plan 07, HUD rate). */
  refresh(snapshot: Snapshot): void;
  /** Every frame: which labels are close enough to show in full. */
  updateDetail(cameraPosition: THREE.Vector3): void;
  /** The selected stage's labels show in full at any distance and take the accent outline. */
  select(stage: StageId | null): void;
  dispose(): void;
}

interface Label {
  item: Equipment;
  object: CSS2DObject;
  element: HTMLElement;
  value: HTMLElement;
  anchor: THREE.Vector3;
  shownText: string | null;
  shownStatus: Status | null;
  compact: boolean | null;
  selected: boolean;
}

export function createEquipmentLabels(equipment: readonly Equipment[], labelRoot: THREE.Object3D): EquipmentLabels {
  const labels: Label[] = equipment.map((item) => {
    const element = document.createElement('div');
    element.className = 'equipment-label';
    element.dataset.equipment = item.id;
    element.dataset.stage = String(item.stage);
    const lamp = document.createElement('span');
    lamp.className = 'equipment-lamp';
    const name = document.createElement('span');
    name.className = 'equipment-name';
    name.textContent = item.label;
    const value = document.createElement('span');
    value.className = 'equipment-value';
    element.append(lamp, name, value);

    const object = new CSS2DObject(element);
    object.position.set(...item.labelAnchorM);
    object.center.set(0.5, 1); // the label stands on its anchor, just above the machine
    labelRoot.add(object);
    return {
      item,
      object,
      element,
      value,
      anchor: new THREE.Vector3(...item.labelAnchorM),
      shownText: null,
      shownStatus: null,
      compact: null,
      selected: false,
    };
  });

  // A machine whose labelText throws is reported once and keeps its last text; the rest carry on.
  const failed = new Set<string>();

  return {
    refresh(snapshot) {
      for (const label of labels) {
        const status = snapshot.stages[label.item.stage].status;
        if (status !== label.shownStatus) {
          label.shownStatus = status;
          label.element.dataset.status = status;
        }
        let text = label.shownText ?? '';
        try {
          text = label.item.labelText(snapshot);
        } catch (error) {
          if (!failed.has(label.item.id)) console.error(`Label of "${label.item.id}" failed:`, error);
          failed.add(label.item.id);
        }
        if (text !== label.shownText) {
          label.shownText = text;
          label.value.textContent = text;
        }
      }
    },
    updateDetail(cameraPosition) {
      for (const label of labels) {
        const compact = !label.selected && cameraPosition.distanceTo(label.anchor) > FULL_LABEL_WITHIN_M;
        if (compact === label.compact) continue;
        label.compact = compact;
        label.element.classList.toggle('is-compact', compact);
      }
    },
    select(stage) {
      for (const label of labels) {
        label.selected = label.item.stage === stage;
        label.element.classList.toggle('is-selected', label.selected);
        label.compact = null; // re-decide on the next updateDetail
      }
    },
    dispose() {
      for (const label of labels) label.object.removeFromParent(); // CSS2DObject removes its element on 'removed'
    },
  };
}
