// One floating label per machine (CSS2D, styled in labels.css): a status lamp, the machine's name and
// one live value. Far from the camera a label shrinks to its lamp, so the overview reads as a map of
// lamps and a close view names every machine. A machine with a labelRing (a fermentation tank, phase 17) has a
// ring round its lamp, filled as far as the machine says: a tank's pH on its way from the start to the end pH.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Snapshot, StageId, Status } from '../contracts';
import type { Equipment } from './equipment';

/** Closer than this a label shows its name and value; further away only its lamp (the preview's compact badges). */
export const FULL_LABEL_WITHIN_M = 60;

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
  /** The ring round the lamp, for a machine with a labelRing. */
  ring: HTMLElement | null;
  shownRing: string | null;
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
    let ring: HTMLElement | null = null;
    if (item.labelRing) {
      // The lamp stands inside the ring; the value beside it says the same in numbers, so the ring is decoration.
      ring = document.createElement('span');
      ring.className = 'equipment-ring';
      ring.hidden = true;
      ring.setAttribute('aria-hidden', 'true');
      ring.append(lamp);
      element.append(ring, name, value);
    } else {
      element.append(lamp, name, value);
    }

    const object = new CSS2DObject(element);
    object.position.set(...item.labelAnchorM);
    object.center.set(0.5, 1); // the label stands on its anchor, just above the machine
    labelRoot.add(object);
    return {
      item,
      object,
      element,
      value,
      ring,
      shownRing: null,
      anchor: new THREE.Vector3(...item.labelAnchorM),
      shownText: null,
      shownStatus: null,
      compact: null,
      selected: false,
    };
  });

  // A machine whose labelText throws is reported once and keeps its last text; the rest carry on.
  const failed = new Set<string>();

  /** Fills the ring to the machine's fraction, in whole percent so a 4 Hz refresh writes the style only on a change. */
  const showRing = (label: Label, snapshot: Snapshot): void => {
    let frac: number | null;
    try {
      frac = label.item.labelRing?.(snapshot) ?? null;
    } catch (error) {
      if (!failed.has(label.item.id)) console.error(`Label ring of "${label.item.id}" failed:`, error);
      failed.add(label.item.id);
      return;
    }
    const shown = frac === null || !Number.isFinite(frac) ? null : String(Math.round(Math.min(Math.max(frac, 0), 1) * 100));
    if (shown === label.shownRing || !label.ring) return;
    label.shownRing = shown;
    label.ring.hidden = shown === null;
    if (shown !== null) {
      label.ring.style.setProperty('--ring-pct', shown);
      label.ring.dataset.ringPct = shown;
    }
  };

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
        if (label.ring) showRing(label, snapshot);
      }
    },
    updateDetail(cameraPosition) {
      for (const label of labels) {
        const nowM = label.item.labelAnchorNowM?.();
        if (nowM) {
          label.object.position.set(...nowM);
          label.anchor.set(...nowM);
        }
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
