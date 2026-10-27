import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EQUIPMENT_FACTORIES, type Equipment, type EquipmentContext, type MaterialName } from '../../src/scene/equipment';
import * as at from '../../src/scene/equipment/packs/layout';
import { FULL_LABEL_WITHIN_M } from '../../src/scene/equipmentLabels';
import { APRON, OVERVIEW, PLANT_BOUNDS, ZONES, overviewDistanceM, type Zone } from '../../src/scene/layout';
import { stageRangeText, zoneLabelPlacement } from '../../src/scene/zones';
import { stubTheme } from './browserStubs';

// The zone names and the apron, checked against the plant the overview shows: without WebGL or a DOM,
// by projecting the label anchors with the overview camera and casting rays into the grey-box plant.
// The CIP station's lamps read their colours from the theme, which falls back to the light one's.

afterEach(() => vi.unstubAllGlobals());

/** world.ts's camera: vertical field of view. */
const FOV_DEG = 40;
/**
 * The 3D view at the two window sizes the G1 review uses, 1440 × 900 and 1280 × 720 (the HUD's columns
 * take the rest), in CSS pixels.
 */
const REVIEW_VIEWS_PX = [
  { name: '1440 × 900', widthPx: 846, heightPx: 733 },
  { name: '1280 × 720', widthPx: 686, heightPx: 553 },
] as const;
/**
 * A zone name's box in labels.css: 12.5 px uppercase Barlow Condensed with 0.09 em tracking, the stage
 * numbers in 12 px IBM Plex Mono. Measured in Chromium at 6.2 to 6.7 px a character and 17 px tall;
 * estimated a little wide, so a name that passes here has room to spare.
 */
const NAME_PX_PER_CHAR = 6.8;
const NAME_HEIGHT_PX = 17;
/** A machine label far from the camera is its lamp alone: 9 px, 2 px padding and a 1 px border, standing on its anchor. */
const LAMP_BOX_PX = 13;
/** Floor markings (quarantine border, dock guide lines) are paint on the floor, 7 cm high at most. */
const FLOOR_MARKING_TOP_M = 0.07;

interface BoxPx {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: BoxPx, b: BoxPx): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function makeContext(): EquipmentContext {
  const names: MaterialName[] = ['steel', 'steelDark', 'milk', 'glass', 'rubber', 'concrete', 'wood', 'carton', 'rack', 'paint', 'gauge'];
  return {
    materials: Object.fromEntries(names.map((name) => [name, new THREE.MeshStandardMaterial()])) as unknown as Record<MaterialName, THREE.Material>,
    // No files in unit tests: the grey boxes stay, at the sizes the models are fitted to.
    loadModel: () => Promise.reject(new Error('no models in unit tests')),
  };
}

/** The camera as world.ts frames the overview for a view of this size. */
function overviewCamera(widthPx: number, heightPx: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV_DEG, widthPx / heightPx, 0.5, 700);
  const target = new THREE.Vector3(...OVERVIEW.targetM);
  const viewHalfWidthPerM = camera.getViewSize(1, new THREE.Vector2()).x / 2;
  camera.position.copy(target).addScaledVector(new THREE.Vector3(...OVERVIEW.direction).normalize(), overviewDistanceM(viewHalfWidthPerM));
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}

function toPx(camera: THREE.Camera, pointM: readonly [number, number, number], view: { widthPx: number; heightPx: number }): { x: number; y: number } {
  const ndc = new THREE.Vector3(...pointM).project(camera);
  return { x: ((ndc.x + 1) / 2) * view.widthPx, y: ((1 - ndc.y) / 2) * view.heightPx };
}

function nameBox(zone: Zone, camera: THREE.Camera, view: { widthPx: number; heightPx: number }): BoxPx {
  const { anchorM, center } = zoneLabelPlacement(zone);
  const { x, y } = toPx(camera, anchorM, view);
  const widthPx = (zone.label.length + stageRangeText(zone.stages).length) * NAME_PX_PER_CHAR;
  const left = x - center[0] * widthPx;
  const top = y - center[1] * NAME_HEIGHT_PX;
  return { left, top, right: left + widthPx, bottom: top + NAME_HEIGHT_PX };
}

function lampBox(item: Equipment, camera: THREE.Camera, view: { widthPx: number; heightPx: number }): BoxPx {
  const { x, y } = toPx(camera, item.labelAnchorM, view);
  return { left: x - LAMP_BOX_PX / 2, top: y - LAMP_BOX_PX, right: x + LAMP_BOX_PX / 2, bottom: y };
}

describe('zone names', () => {
  it('stand just in front of each zone’s near edge, lined up with its left end or, for the warehouse, its right', () => {
    for (const zone of ZONES) {
      const { anchorM, center } = zoneLabelPlacement(zone);
      const { rect } = zone;
      // Outside the zone, toward the overview camera, and close to its edge.
      expect(anchorM[2], zone.id).toBeGreaterThan(rect.zMaxM);
      expect(anchorM[2] - rect.zMaxM, zone.id).toBeLessThan(1);
      expect(anchorM[1], zone.id).toBeGreaterThan(0);
      expect(anchorM[1], zone.id).toBeLessThan(0.1);
      // The text hangs below the anchor on screen, starting at the left end or ending at the right one.
      expect(center[1], zone.id).toBe(0);
      if (zone.labelAlign === 'left') {
        expect(center[0], zone.id).toBe(0);
        expect(anchorM[0] - rect.xMinM, zone.id).toBeGreaterThan(0);
        expect(anchorM[0] - rect.xMinM, zone.id).toBeLessThan(1);
      } else {
        expect(center[0], zone.id).toBe(1);
        expect(rect.xMaxM - anchorM[0], zone.id).toBeGreaterThan(0);
        expect(rect.xMaxM - anchorM[0], zone.id).toBeLessThan(1);
      }
    }
    expect(ZONES.find((zone) => zone.id === 'warehouse')?.labelAlign).toBe('right');
  });

  /** True unless the object or one of its parents is hidden. */
  const shown = (object: THREE.Object3D): boolean => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  };

  it.each(REVIEW_VIEWS_PX)('read in full from the overview at $name: in view, apart, clear of every lamp and machine', (view) => {
    const camera = overviewCamera(view.widthPx, view.heightPx);
    stubTheme();
    const machines = EQUIPMENT_FACTORIES.flatMap((make) => make(makeContext()));
    const scene = new THREE.Scene();
    for (const machine of machines) scene.add(machine.object);
    scene.updateMatrixWorld(true);
    const boxes = ZONES.map((zone) => ({ zone, box: nameBox(zone, camera, view) }));
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    for (const { zone, box } of boxes) {
      expect(box.left, zone.id).toBeGreaterThan(0);
      expect(box.right, zone.id).toBeLessThan(view.widthPx);
      expect(box.top, zone.id).toBeGreaterThan(0);
      expect(box.bottom, zone.id).toBeLessThan(view.heightPx);
      for (const other of boxes) if (other.zone !== zone) expect(overlaps(box, other.box), `${zone.id} and ${other.zone.id}`).toBe(false);

      for (const machine of machines) {
        // Far from the camera every machine label is its lamp alone, so the lamp's box is the label's.
        expect(camera.position.distanceTo(new THREE.Vector3(...machine.labelAnchorM)), machine.id).toBeGreaterThan(FULL_LABEL_WITHIN_M);
        expect(overlaps(box, lampBox(machine, camera, view)), `${zone.id} name and ${machine.id} lamp`).toBe(false);
      }

      // Nothing of the plant stands between the camera and the name: rays through a grid over its box
      // reach the floor, or a marking painted on it (the docks' guide lines), which no text hides behind.
      for (let y = box.top; y <= box.bottom; y += 3) {
        for (let x = box.left; x <= box.right; x += 3) {
          ndc.set((x / view.widthPx) * 2 - 1, 1 - (y / view.heightPx) * 2);
          raycaster.setFromCamera(ndc, camera);
          // Something hidden (a truck at a door no truck is docked at) hides nothing.
          const hit = raycaster.intersectObject(scene, true).find((h) => h.point.y > FLOOR_MARKING_TOP_M && shown(h.object));
          let owner: THREE.Object3D | null = hit?.object ?? null;
          while (owner && owner.userData.equipmentId === undefined) owner = owner.parent;
          expect(owner?.userData.equipmentId, `${zone.id} name at ${x.toFixed(0)}, ${y.toFixed(0)} px`).toBeUndefined();
        }
      }
    }
    for (const machine of machines) machine.dispose();
  });
});

describe('truck apron', () => {
  it('holds the docked truck, with room round its cab, and every dock door', () => {
    const truck = {
      xMinM: at.DOOR_X_M[1] - at.TRUCK_SIZE_M.widthM / 2,
      xMaxM: at.DOOR_X_M[1] + at.TRUCK_SIZE_M.widthM / 2,
      zMinM: at.DOCKED_TAIL_Z_M,
      zMaxM: at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM,
    };
    const apron = APRON.rect;
    expect(truck.zMinM).toBeGreaterThanOrEqual(apron.zMinM);
    expect(apron.zMaxM - truck.zMaxM).toBeGreaterThan(1);
    expect(truck.xMinM).toBeGreaterThan(apron.xMinM);
    expect(truck.xMaxM).toBeLessThan(apron.xMaxM);
    for (const doorXM of at.DOOR_X_M) {
      expect(doorXM - 1.7).toBeGreaterThan(apron.xMinM);
      expect(doorXM + 1.7).toBeLessThan(apron.xMaxM);
    }
    // The apron lies along the warehouse's dock wall, and the plant's bounds take it in.
    expect(apron.zMinM).toBe(ZONES.find((zone) => zone.id === 'warehouse')?.rect.zMaxM);
    expect(PLANT_BOUNDS.zMaxM).toBe(apron.zMaxM);
  });

  it('keeps the docked truck and the dock doors in the overview at both review sizes', () => {
    // The overview fits the plant's width at its target, so the apron's empty near-west corner, nearest
    // the camera, falls a few pixels past the view's edge, as the preview's shallower apron already did.
    for (const view of REVIEW_VIEWS_PX) {
      const camera = overviewCamera(view.widthPx, view.heightPx);
      const halfWidthM = at.TRUCK_SIZE_M.widthM / 2;
      const truckEndZM = at.DOCKED_TAIL_Z_M + at.TRUCK_SIZE_M.lengthM;
      const points: [number, number, number][] = [
        [at.DOOR_X_M[1] - halfWidthM, 0, truckEndZM],
        [at.DOOR_X_M[1] + halfWidthM, 0, truckEndZM],
        [at.DOOR_X_M[1], at.TRUCK_SIZE_M.heightM, at.DOCKED_TAIL_Z_M],
        ...at.DOOR_X_M.map((xM): [number, number, number] => [xM - 1.7, 0, at.DOOR_Z_M]),
      ];
      for (const pointM of points) {
        const { x, y } = toPx(camera, pointM, view);
        expect(x, `${view.name} ${pointM.join(', ')}`).toBeGreaterThan(0);
        expect(x, `${view.name} ${pointM.join(', ')}`).toBeLessThan(view.widthPx);
        expect(y, `${view.name} ${pointM.join(', ')}`).toBeGreaterThan(0);
        expect(y, `${view.name} ${pointM.join(', ')}`).toBeLessThan(view.heightPx);
      }
    }
  });
});
