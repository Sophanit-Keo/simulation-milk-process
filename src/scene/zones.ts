// The seven zone floors and the truck apron (preview: "floor and zones"): tinted slabs a few
// centimetres above the floor, a thin outline round each zone and its name just in front of it.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StageId } from '../contracts';
import { APRON, ZONES, type PointM, type RectM, type Zone } from './layout';
import { readSceneColor } from './theme';

/** Slab thickness: enough to read as a floor marking from a low camera, too little to trip over. */
const SLAB_HEIGHT_M = 0.04;
/** The apron is a shade lower than the halls, as in the preview. */
const APRON_HEIGHT_M = 0.03;
/** Outlines sit just above the slabs so they never z-fight with them. */
const OUTLINE_Y_M = 0.06;
/** The name lines up with the zone's end, this far in. */
const LABEL_INSET_M = 0.6;
/** Gap between the zone's near edge and the top of its name. */
const LABEL_GAP_M = 0.5;
/** Beyond this camera distance the zone labels hide (preview: 170 m), so they don't crowd a far view. */
const LABEL_HIDE_BEYOND_M = 170;

export interface Zones {
  /** Hides the labels when the camera is far from what it looks at. */
  updateLabels(cameraToTargetM: number): void;
  applyTheme(): void;
  dispose(): void;
}

/** "2–5" for stages [2, 3, 4, 5], "1" for [1]: the stage numbers after a zone's name. */
export function stageRangeText(stages: readonly StageId[]): string {
  const first = stages[0];
  const last = stages[stages.length - 1];
  return first === last ? String(first) : `${first}–${last}`;
}

/**
 * Where a zone's name goes: its anchor on the floor and the point of the text that sits on it (CSS2DObject
 * `center`, (0, 0) for the top-left corner).
 *
 * The preview writes each name inside the zone's far (north-west) corner. Seen from the overview, which
 * looks from the docks (+z), that corner lies behind the zone's machines: the silos and the racks rise in
 * front of it on screen, and muted text over grey steel or stacked loads doesn't read. Every machine's
 * label also stands above the machine, so its lamp lands on that far corner too, and CSS2DRenderer draws
 * nearer labels on top, so the lamps cover the names. In front of the near (+z) edge nothing stands
 * between the name and the camera, and the lamps are drawn further up the screen: the name hangs just
 * below that edge, in the aisle for the top row and on the floor or the apron for the bottom row.
 */
export function zoneLabelPlacement(zone: Zone): { anchorM: PointM; center: readonly [x: number, y: number] } {
  const { rect } = zone;
  const right = zone.labelAlign === 'right';
  return {
    anchorM: [right ? rect.xMaxM - LABEL_INSET_M : rect.xMinM + LABEL_INSET_M, OUTLINE_Y_M, rect.zMaxM + LABEL_GAP_M],
    center: [right ? 1 : 0, 0],
  };
}

export function createZones(scene: THREE.Scene, labelRoot: THREE.Object3D): Zones {
  // All slabs are one mesh with a colour per vertex: eight boxes would cost eight draw calls for nothing.
  const slabs = [
    ...ZONES.map((zone) => ({ rect: zone.rect, heightM: SLAB_HEIGHT_M, colorVar: zone.colorVar })),
    { rect: APRON.rect, heightM: APRON_HEIGHT_M, colorVar: APRON.colorVar },
  ];
  const parts = slabs.map(({ rect, heightM }) => {
    const box = new THREE.BoxGeometry(rect.xMaxM - rect.xMinM, heightM, rect.zMaxM - rect.zMinM);
    box.translate((rect.xMinM + rect.xMaxM) / 2, heightM / 2, (rect.zMinM + rect.zMaxM) / 2);
    return box;
  });
  const vertexCounts = parts.map((part) => part.getAttribute('position').count);
  const slabGeometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!slabGeometry) throw new Error('zones: the slab geometries could not be merged');
  const colors = new THREE.BufferAttribute(new Float32Array(slabGeometry.getAttribute('position').count * 3), 3);
  slabGeometry.setAttribute('color', colors);
  const slabMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const slabMesh = new THREE.Mesh(slabGeometry, slabMaterial);
  slabMesh.name = 'zone-slabs';
  slabMesh.receiveShadow = true;
  scene.add(slabMesh);

  // One line set for all seven outlines, for the same reason.
  const outlinePoints = ZONES.flatMap(({ rect }) => outlineSegments(rect));
  const outlineMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 });
  const outlines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outlinePoints), outlineMaterial);
  outlines.name = 'zone-outlines';
  scene.add(outlines);

  const labels = ZONES.map((zone) => {
    const element = document.createElement('div');
    element.className = 'zone-label';
    element.dataset.zone = zone.id;
    element.textContent = zone.label;
    const stages = document.createElement('em');
    stages.textContent = stageRangeText(zone.stages);
    element.append(stages);
    const label = new CSS2DObject(element);
    const { anchorM, center } = zoneLabelPlacement(zone);
    label.position.set(...anchorM);
    label.center.set(...center);
    labelRoot.add(label);
    return label;
  });

  const color = new THREE.Color();
  const applyTheme = (): void => {
    let offset = 0;
    slabs.forEach(({ colorVar }, i) => {
      color.set(readSceneColor(colorVar));
      const count = vertexCounts[i];
      for (let k = offset; k < offset + count; k++) colors.setXYZ(k, color.r, color.g, color.b);
      offset += count;
    });
    colors.needsUpdate = true;
    outlineMaterial.color.set(readSceneColor('--steel-dark'));
  };
  applyTheme();

  let labelsShown = true;
  return {
    updateLabels(cameraToTargetM) {
      const show = cameraToTargetM <= LABEL_HIDE_BEYOND_M;
      if (show === labelsShown) return;
      labelsShown = show;
      for (const label of labels) label.visible = show;
    },
    applyTheme,
    dispose() {
      for (const label of labels) label.removeFromParent(); // CSS2DObject removes its element on 'removed'
      slabMesh.removeFromParent();
      outlines.removeFromParent();
      slabGeometry.dispose();
      slabMaterial.dispose();
      outlines.geometry.dispose();
      outlineMaterial.dispose();
    },
  };
}

/** The four edges of a rectangle as line-segment end points, just above the slab. */
function outlineSegments(rect: RectM): THREE.Vector3[] {
  const corners = [
    new THREE.Vector3(rect.xMinM, OUTLINE_Y_M, rect.zMinM),
    new THREE.Vector3(rect.xMaxM, OUTLINE_Y_M, rect.zMinM),
    new THREE.Vector3(rect.xMaxM, OUTLINE_Y_M, rect.zMaxM),
    new THREE.Vector3(rect.xMinM, OUTLINE_Y_M, rect.zMaxM),
  ];
  return corners.flatMap((corner, i) => [corner, corners[(i + 1) % corners.length]]);
}
