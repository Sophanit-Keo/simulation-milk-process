// Phase 10: the factory floor in 3D (D20), drawn beside the Factory board's cards. The board's page loads this
// module by import() when the viewer first opens the 3D view, so the board alone loads no three.js. It lays the
// floor out from each view the page hands it (layout.ts), builds the machines (floor.ts) again only when the
// layout's key changes, and between builds moves the lamps, labels, belts and pipes on to the new statuses.
//
// The renderer, lights and resize follow the 3D plant's world.ts; the labels are buttons, so a click or the
// keyboard picks a machine as a click on its mesh does; the camera flies to what is picked. With ?debug in the
// address, window.__factory3d shows the floor's state to the browser tests.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createEquipmentHost } from '../../scene/equipmentHost';
import { readSceneColor, watchTheme } from '../../scene/theme';
import { el, setAttr, setText } from '../../ui/dom';
import { formatNumber } from '../../ui/format';
import { fillerText, troublesText } from '../board';
import { cameraPositionM, floorBays, layoutFactory } from '../layout';
import type { CreateFactoryScene, FactoryLayout, FactoryScene, FactorySelection, FactoryView, FloorBay, FloorPointM, FloorRectM } from '../types';
import { buildFloor, type Floor, type FloorMachine, type FloorState } from './floor';

const FOV_DEG = 40;
const NEAR_M = 0.5;
const FAR_M = 600;
/** As the 3D plant: sharper than 2× costs fill rate for little gain. */
const MAX_PIXEL_RATIO = 2;
/** The orbit stops short of the horizon, so the camera stays above the floor (the 3D plant's 79°). */
const MAX_POLAR_RAD = 1.38;
const MIN_DISTANCE_M = 4;
const MAX_DISTANCE_M = 260;
const FALLBACK_ASPECT = 16 / 9;
/** No frame counts as longer than this, so a stall in a background tab doesn't make the belts jump. */
const MAX_FRAME_S = 0.1;
/** A fly to a machine or back to the whole floor; the 3D plant's 1.2 s, a shade quicker on a smaller floor. */
const FLY_S = 1;
/** A press that moves further than this is a drag, not a click (as picking.ts). */
const CLICK_SLOP_PX = 6;
/**
 * A label shows as much as the room on screen to its nearest neighbour allows: its name, status and troubles,
 * then its lamp and name, then its lamp alone (the 3D plant's far labels), so neighbours never run together.
 * Its width is reckoned from its text: about this many pixels per character, plus the lamp and the padding.
 */
const LABEL_PX_PER_CHAR = 6.2;
const LABEL_FRAME_PX = 26;
/** Space kept between two labels side by side. */
const LABEL_GAP_PX = 6;
/** The overview fits the floor across the view from no nearer and no further than this. */
const OVERVIEW_MIN_M = 40;
const OVERVIEW_MAX_M = 240;
/** Floor beyond the bays, so its edge doesn't show at the overview. */
const FLOOR_MARGIN_M = 30;
/** The sun as the 3D plant's: high and from the front, so shadows fall short and back. */
const SUN_DIRECTION = new THREE.Vector3(40, 80, 44).normalize();
const SUN_DISTANCE_M = 120;
const SHADOW_MAP_PX = 2048;
const SHADOW_RADIUS = 3;

/** The floor's state for the browser tests, with ?debug in the address. */
export interface FactorySceneDebug {
  /** The layout's key the floor was last built for; null before the first view. */
  key(): string | null;
  /** How many times the floor has been built: a change of status must not add one. */
  builds(): number;
  /** Each machine as floor.ts reports it, with the name its label shows. */
  machines(): (FloorState['machines'][number] & { name: string })[];
  pipes(): FloorState['pipes'];
  /** What is marked now. */
  selection(): FactorySelection | null;
  camera(): { targetM: number[]; positionM: number[]; flying: boolean };
  /** Client pixels of a point on the machine that a click on the canvas would pick, or null if none shows. */
  screenPoint(machineId: string): { x: number; y: number } | null;
  drawCalls(): number;
}

declare global {
  interface Window {
    __factory3d?: FactorySceneDebug;
  }
}

/** How much a label shows: everything, its lamp and name, or its lamp. */
type LabelDetail = 'full' | 'name' | 'lamp';

interface Label {
  machine: FloorMachine;
  object: CSS2DObject;
  button: HTMLButtonElement;
  name: HTMLSpanElement;
  value: HTMLSpanElement;
  trouble: HTMLSpanElement;
  anchor: THREE.Vector3;
  /** To the nearest other label's anchor: the room it has, whatever the camera. */
  roomM: number;
  detail: LabelDetail | null;
}

interface Title {
  object: CSS2DObject;
  element: HTMLElement;
  anchor: THREE.Vector3;
  /** Its bay's width: a title wider than that on screen would run into the next bay's. */
  roomM: number;
  shown: boolean | null;
}

/** About how wide a text shows in a label, in pixels. */
const textPx = (text: string): number => text.length * LABEL_PX_PER_CHAR + LABEL_FRAME_PX;

const vector = (point: FloorPointM): THREE.Vector3 => new THREE.Vector3(point[0], point[1], point[2]);

/** The machine on the floor that shows `selection` in `bays`: the first of that name or id. */
function machineFor(floor: Floor, bays: readonly FloorBay[], selection: FactorySelection | null): FloorMachine | null {
  if (!selection) return null;
  return (
    floor.machines.find((machine) => {
      const bay = bays[machine.bay];
      if (!bay) return false;
      if (selection.kind === 'uht') return machine.kind === 'uht' && bay.uht?.name === selection.name;
      return machine.kind === 'line' && bay.lines[machine.filler ?? -1]?.id === selection.id;
    }) ?? null
  );
}

/** What a machine picks in `bays`. */
function selectionOf(machine: FloorMachine, bays: readonly FloorBay[]): FactorySelection | null {
  const bay = bays[machine.bay];
  if (!bay) return null;
  if (machine.kind === 'uht') return bay.uht ? { kind: 'uht', name: bay.uht.name } : null;
  const line = bay.lines[machine.filler ?? -1];
  return line ? { kind: 'line', id: line.id } : null;
}

export const createFactoryScene: CreateFactoryScene = (host, options) => {
  // As the 3D plant: make the WebGL 2 context here, so a browser without one gets a message, not a thrown error.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!context) return noWebGlScene(host);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  } catch {
    return noWebGlScene(host);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvas.className = 'fs-canvas';
  canvas.style.display = 'block';
  canvas.style.height = '0px';
  canvas.setAttribute('aria-label', 'The factory floor in 3D: drag to orbit, scroll to zoom; the labels pick a machine');
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'fs-labels';
  host.append(labelRenderer.domElement);
  const labelScene = new THREE.Scene();

  const overviewButton = el('button', 'btn fs-overview', 'Whole factory');
  overviewButton.type = 'button';
  overviewButton.dataset.testid = 'scene-overview';
  overviewButton.title = 'Back to the whole factory floor (Esc)';
  const emptyNote = el('p', 'fs-empty', 'Let Report lists no UHT plants or UHT lines yet.');
  emptyNote.hidden = true;
  host.append(overviewButton, emptyNote);

  const scene = new THREE.Scene();
  const background = new THREE.Color();
  scene.background = background;
  const camera = new THREE.PerspectiveCamera(FOV_DEG, FALLBACK_ASPECT, NEAR_M, FAR_M);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = MAX_POLAR_RAD;
  controls.minDistance = MIN_DISTANCE_M;
  controls.maxDistance = MAX_DISTANCE_M;

  const sky = new THREE.HemisphereLight(0xffffff, 0x9aa7b2, 1.3);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = SHADOW_RADIUS;
  scene.add(sky, sun, sun.target);

  const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // The 3D plant's shared materials, themed, and its model loader, which caches the hero filler and frees it.
  const host3d = createEquipmentHost(scene, [], { heroModels: options.heroModels ?? true });

  let layout: FactoryLayout | null = null;
  let floor: Floor | null = null;
  let bays: FloorBay[] = [];
  let builds = 0;
  let labels: Label[] = [];
  let titles: Title[] = [];
  /** What is marked, and the machine that shows it on this floor. */
  let selection: FactorySelection | null = null;
  let selected: FloorMachine | null = null;
  /** A select() before the first view: flown to once the floor is built. */
  let pending = false;
  let cameraTaken = false;

  // ── the camera's flights ──
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let fly: { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; toPosition: THREE.Vector3; toTarget: THREE.Vector3; elapsedS: number; focus: string | null } | null = null;

  const land = (focus: string | null): void => {
    fly = null;
    delete host.dataset.flying;
    if (focus) host.dataset.focus = focus;
    else delete host.dataset.focus;
  };
  const flyTo = (toPosition: THREE.Vector3, toTarget: THREE.Vector3, focus: string | null): void => {
    delete host.dataset.focus;
    if (reducedMotion.matches) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      controls.update();
      land(focus);
      return;
    }
    fly = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition, toTarget, elapsedS: 0, focus };
    host.dataset.flying = 'true';
  };
  const stepFlight = (dtS: number): void => {
    if (!fly) return;
    fly.elapsedS += dtS;
    const k = Math.min(1, fly.elapsedS / FLY_S);
    const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; // ease in and out (cubic), as the 3D plant
    camera.position.lerpVectors(fly.fromPosition, fly.toPosition, eased);
    controls.target.lerpVectors(fly.fromTarget, fly.toTarget, eased);
    if (k >= 1) land(fly.focus);
  };

  const viewSize = new THREE.Vector2();
  const overviewStop = (): { position: THREE.Vector3; target: THREE.Vector3 } => {
    const overview = layout?.overview ?? { targetM: [0, 0, 0] as FloorPointM, direction: [0, 0.74, 0.67] as FloorPointM, halfWidthM: 20 };
    const viewHalfWidthPerM = camera.getViewSize(1, viewSize).x / 2;
    const distanceM = Math.min(Math.max(overview.halfWidthM / viewHalfWidthPerM, OVERVIEW_MIN_M), OVERVIEW_MAX_M);
    const target = vector(overview.targetM);
    return { target, position: target.clone().addScaledVector(vector(overview.direction).normalize(), distanceM) };
  };
  const frameOverview = (): void => {
    const { position, target } = overviewStop();
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
  };

  /** Flies to what is selected, or to the whole floor. */
  const flyToSelection = (): void => {
    if (selected) {
      flyTo(vector(cameraPositionM(selected.camera)), vector(selected.camera.targetM), selected.id);
      cameraTaken = true;
    } else {
      const { position, target } = overviewStop();
      flyTo(position, target, null);
      cameraTaken = false;
    }
  };

  // ── labels ──
  const markLabels = (): void => {
    for (const label of labels) {
      const on = label.machine === selected;
      label.button.classList.toggle('is-selected', on);
      setAttr(label.button, 'aria-pressed', on ? 'true' : 'false');
      label.detail = null;
    }
  };

  const pick = (machine: FloorMachine): void => {
    const next = selectionOf(machine, bays);
    if (!next) return;
    selection = next;
    selected = machine;
    markLabels();
    flyToSelection();
    options.onSelect(next);
  };

  const goHome = (): void => {
    const was = selection;
    selection = null;
    selected = null;
    markLabels();
    flyToSelection();
    if (was !== null) options.onSelect(null);
  };
  overviewButton.addEventListener('click', goHome);

  const clearLabels = (): void => {
    for (const label of labels) label.object.removeFromParent(); // CSS2DObject removes its element on 'removed'
    for (const title of titles) title.object.removeFromParent();
    labels = [];
    titles = [];
  };

  const buildLabels = (next: Floor): void => {
    clearLabels();
    labels = next.machines.map((machine) => {
      const button = el('button', `fs-label fs-label-${machine.kind}`);
      button.type = 'button';
      button.dataset.machine = machine.id;
      const lamp = el('span', 'fs-lamp');
      lamp.setAttribute('aria-hidden', 'true');
      const name = el('span', 'fs-name');
      const value = el('span', 'fs-value');
      const trouble = el('span', 'fs-trouble');
      trouble.hidden = true;
      button.append(lamp, name, value, trouble);
      button.addEventListener('click', () => pick(machine));
      const object = new CSS2DObject(button);
      object.position.set(...machine.labelM);
      object.center.set(0.5, 1);
      labelScene.add(object);
      return { machine, object, button, name, value, trouble, anchor: vector(machine.labelM), roomM: Infinity, detail: null };
    });
    for (const label of labels) {
      for (const other of labels) if (other !== label) label.roomM = Math.min(label.roomM, label.anchor.distanceTo(other.anchor));
    }
    titles = next.layout.bays.map((bay, index) => {
      const element = el('div', 'fs-title', bay.title);
      element.dataset.testid = `scene-bay-${index}`;
      const object = new CSS2DObject(element);
      object.position.set(...bay.titleM);
      object.center.set(0, 0);
      labelScene.add(object);
      return { object, element, anchor: vector(bay.titleM), roomM: bay.rect.xMaxM - bay.rect.xMinM, shown: null };
    });
  };

  /** The labels' words from the view: the board's texts, so the floor and the cards say the same. */
  const writeLabels = (): void => {
    for (const label of labels) {
      const bay = bays[label.machine.bay];
      let name = '';
      let value = '';
      let trouble = '';
      let status = 'idle';
      let words = '';
      if (label.machine.kind === 'uht') {
        const uht = bay?.uht;
        if (uht) {
          name = uht.name;
          value = uht.overCapacity ? `${uht.stateText} · over by ${formatNumber(uht.drawLph - uht.capacityLph)} L/h` : uht.stateText;
          status = uht.lamp;
          words = `${name}: ${value}`;
        }
        setAttr(label.button, 'data-testid', `scene-uht-${name}`);
      } else {
        const line = bay?.lines[label.machine.filler ?? -1];
        if (line) {
          name = line.name;
          value = line.statusText;
          trouble = troublesText(line);
          status = line.lamp;
          words = `${name}, ${fillerText(line)}: ${value}${trouble ? `, ${trouble}` : ''}`;
        }
        setAttr(label.button, 'data-testid', `scene-line-${name}`);
      }
      setText(label.name, name);
      setText(label.value, value);
      setText(label.trouble, trouble);
      label.trouble.hidden = trouble === '';
      setAttr(label.button, 'data-status', status);
      setAttr(label.button, 'aria-label', words);
      setAttr(label.button, 'title', words);
    }
  };

  /** Pixels per metre at `point`, from the camera's distance and the view's height. */
  const pxPerMAt = (point: THREE.Vector3): number => {
    const distanceM = Math.max(NEAR_M, camera.position.distanceTo(point));
    return heightPx / (2 * distanceM * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };

  const updateLabelDetail = (): void => {
    if (heightPx <= 0) return;
    for (const label of labels) {
      const roomPx = label.roomM * pxPerMAt(label.anchor) - LABEL_GAP_PX;
      const name = label.name.textContent ?? '';
      const full = [name, label.value.textContent ?? '', label.trouble.hidden ? '' : (label.trouble.textContent ?? '')].join('  ');
      // The picked machine's label shows in full however little room it has, as the 3D plant's does.
      const detail: LabelDetail =
        label.machine === selected || roomPx >= textPx(full) ? 'full' : roomPx >= textPx(name) ? 'name' : 'lamp';
      if (detail === label.detail) continue;
      label.detail = detail;
      label.button.dataset.detail = detail;
    }
    for (const title of titles) {
      const shown = title.roomM * pxPerMAt(title.anchor) >= textPx(title.element.textContent ?? '');
      if (shown === title.shown) continue;
      title.shown = shown;
      title.element.classList.toggle('is-hidden', !shown);
    }
  };

  // ── picking on the canvas ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ownerOf = (object: THREE.Object3D): FloorMachine | null => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return null; // hidden grey parts under a hero model must not catch clicks
      const id = (node.userData as { floorMachine?: string }).floorMachine;
      if (id !== undefined) return floor?.machines.find((machine) => machine.id === id) ?? null;
    }
    return null;
  };
  const machineAtNdc = (x: number, y: number): FloorMachine | null => {
    if (!floor) return null;
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(floor.machines.map((machine) => machine.object), true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      const owner = ownerOf(hit.object);
      if (owner) return owner;
    }
    return null;
  };
  const toNdc = (clientX: number, clientY: number): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return [((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1];
  };
  const machineAt = (clientX: number, clientY: number): FloorMachine | null => {
    const point = toNdc(clientX, clientY);
    return point ? machineAtNdc(...point) : null;
  };

  const abort = new AbortController();
  const { signal } = abort;
  let press: { id: number; x: number; y: number; dragged: boolean } | null = null;
  let hover: { x: number; y: number } | null = null;
  let hoverDirty = false;
  const takeCamera = (): void => {
    cameraTaken = true;
    if (fly) land(null);
    if (press) press.dragged = true;
  };
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary) {
        takeCamera(); // a second finger: a pinch
        return;
      }
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      if (event.button !== 0) takeCamera();
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (press) {
        if (event.pointerId === press.id && !press.dragged && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) takeCamera();
        return;
      }
      hover = { x: event.clientX, y: event.clientY };
      hoverDirty = true;
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (!press || event.pointerId !== press.id) return;
      const clicked = !press.dragged;
      press = null;
      if (!clicked) return;
      const machine = machineAt(event.clientX, event.clientY);
      if (machine) pick(machine);
    },
    { signal },
  );
  canvas.addEventListener('pointercancel', () => (press = null), { signal });
  canvas.addEventListener(
    'pointerleave',
    () => {
      hover = null;
      hoverDirty = true;
    },
    { signal },
  );
  canvas.addEventListener('wheel', takeCamera, { passive: true, signal });

  let active = false;
  window.addEventListener(
    'keydown',
    (event) => {
      if (!active || event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      goHome();
    },
    { signal },
  );

  // ── the floor ──
  const aimSun = (bounds: FloorRectM, heightM: number): void => {
    const centre = new THREE.Vector3((bounds.xMinM + bounds.xMaxM) / 2, 0, (bounds.zMinM + bounds.zMaxM) / 2);
    const radiusM = Math.hypot(bounds.xMaxM - bounds.xMinM, bounds.zMaxM - bounds.zMinM, heightM) / 2 + heightM;
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(SUN_DIRECTION, SUN_DISTANCE_M);
    const shadow = sun.shadow.camera;
    shadow.left = -radiusM;
    shadow.right = radiusM;
    shadow.top = radiusM;
    shadow.bottom = -radiusM;
    shadow.near = Math.max(0.5, SUN_DISTANCE_M - radiusM);
    shadow.far = SUN_DISTANCE_M + radiusM;
    shadow.updateProjectionMatrix();
  };

  const rebuild = (next: FactoryLayout): void => {
    floor?.dispose();
    floor = buildFloor(next, host3d.context, readSceneColor);
    builds += 1;
    layout = next;
    scene.add(floor.root);
    buildLabels(floor);
    const { bounds } = next;
    ground.scale.set(bounds.xMaxM - bounds.xMinM + 2 * FLOOR_MARGIN_M, bounds.zMaxM - bounds.zMinM + 2 * FLOOR_MARGIN_M, 1);
    ground.position.set((bounds.xMinM + bounds.xMaxM) / 2, 0, (bounds.zMinM + bounds.zMaxM) / 2);
    aimSun(bounds, next.heightM);
    controls.cursor.set(next.overview.targetM[0], 0, next.overview.targetM[2]);
    controls.maxTargetRadius = (bounds.xMaxM - bounds.xMinM) / 2 + FLOOR_MARGIN_M;
    emptyNote.hidden = next.bays.length > 0;
  };

  const applyTheme = (): void => {
    background.set(readSceneColor('--scene-bg'));
    floorMaterial.color.set(readSceneColor('--floor'));
    host3d.applyTheme();
    floor?.applyTheme();
  };
  applyTheme();
  const stopWatchingTheme = watchTheme(applyTheme);

  // ── size ──
  let widthPx = 0;
  let heightPx = 0;
  const render = (): void => {
    renderer.render(scene, camera);
    labelRenderer.render(labelScene, camera);
  };
  const resize = (): void => {
    if (widthPx <= 0) return;
    const h = heightPx > 0 ? heightPx : Math.round(widthPx / FALLBACK_ASPECT);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(widthPx, h);
    labelRenderer.setSize(widthPx, h);
    camera.aspect = widthPx / h;
    camera.updateProjectionMatrix();
    if (!cameraTaken && !fly) frameOverview();
    render();
  };
  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    widthPx = entry.contentRect.width;
    heightPx = entry.contentRect.height;
    resize();
  });
  resizeObserver.observe(host);
  frameOverview();

  // ── the frame loop, while the 3D view shows ──
  let frameId = 0;
  let lastMs = 0;
  const frame = (nowMs: number): void => {
    const dtS = Math.min(MAX_FRAME_S, Math.max(0, (nowMs - lastMs) / 1000));
    lastMs = nowMs;
    stepFlight(dtS);
    controls.update(dtS);
    floor?.tick(dtS);
    updateLabelDetail();
    if (hoverDirty) {
      hoverDirty = false;
      canvas.style.cursor = hover && machineAt(hover.x, hover.y) ? 'pointer' : '';
    }
    render();
    frameId = requestAnimationFrame(frame);
  };

  const scene3d: FactoryScene = {
    render(view: FactoryView) {
      const next = layoutFactory(view);
      bays = floorBays(view);
      if (!floor || next.key !== layout?.key) {
        rebuild(next);
        // The selection stays on what it names, wherever the new floor puts it.
        selected = floor ? machineFor(floor, bays, selection) : null;
        if (selection && !selected) {
          selection = null;
          options.onSelect(null);
        }
        markLabels();
        if (pending || !cameraTaken) {
          pending = false;
          if (selected) flyToSelection();
          else frameOverview();
        }
      }
      floor?.update(bays);
      writeLabels();
    },
    select(next) {
      // A repeat flies again, as the 3D plant's: the viewer may have moved the camera since.
      selection = next;
      if (!floor) {
        pending = true;
        return;
      }
      selected = machineFor(floor, bays, selection);
      if (selection && !selected) selection = null;
      markLabels();
      flyToSelection();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        lastMs = performance.now();
        frameId = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(frameId);
      }
    },
    dispose() {
      scene3d.setActive(false);
      if (window.__factory3d === debug) delete window.__factory3d;
      abort.abort();
      resizeObserver.disconnect();
      stopWatchingTheme();
      clearLabels();
      floor?.dispose();
      floor = null;
      host3d.dispose();
      controls.dispose();
      ground.geometry.dispose();
      floorMaterial.dispose();
      sun.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labelRenderer.domElement.remove();
      overviewButton.remove();
      emptyNote.remove();
      delete host.dataset.flying;
      delete host.dataset.focus;
    },
  };

  // ── ?debug ──
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const PROBES: readonly (readonly [number, number, number])[] = [[0, 0, 0], [0, 0.25, 0], [0, -0.25, 0], [0.25, 0, 0], [-0.25, 0, 0], [0, 0, 0.25], [0, 0, -0.25]];
  const debug: FactorySceneDebug | null = new URLSearchParams(location.search).has('debug')
    ? {
        key: () => layout?.key ?? null,
        builds: () => builds,
        machines: () => {
          const names = new Map(labels.map((label) => [label.machine.id, label.name.textContent ?? '']));
          return (floor?.state().machines ?? []).map((machine) => ({ ...machine, name: names.get(machine.id) ?? '' }));
        },
        pipes: () => floor?.state().pipes ?? [],
        selection: () => selection,
        camera: () => ({ targetM: controls.target.toArray(), positionM: camera.position.toArray(), flying: fly !== null }),
        screenPoint(machineId) {
          const machine = floor?.machines.find((one) => one.id === machineId);
          if (!machine) return null;
          const rect = canvas.getBoundingClientRect();
          camera.updateMatrixWorld();
          machine.object.updateWorldMatrix(true, true);
          const meshes: THREE.Mesh[] = [];
          machine.object.traverseVisible((node) => {
            if (node instanceof THREE.Mesh) meshes.push(node);
          });
          for (const mesh of meshes) {
            box.setFromObject(mesh);
            if (box.isEmpty()) continue;
            box.getCenter(centre);
            box.getSize(size);
            for (const [fx, fy, fz] of PROBES) {
              probe.set(centre.x + fx * size.x, centre.y + fy * size.y, centre.z + fz * size.z).project(camera);
              if (Math.abs(probe.x) > 0.95 || Math.abs(probe.y) > 0.95 || probe.z > 1) continue;
              if (machineAtNdc(probe.x, probe.y) !== machine) continue;
              const x = rect.left + ((probe.x + 1) / 2) * rect.width;
              const y = rect.top + ((1 - probe.y) / 2) * rect.height;
              if (document.elementFromPoint(x, y) !== canvas) continue; // a label or a button on top would take the click
              return { x, y };
            }
          }
          return null;
        },
        drawCalls: () => renderer.info.render.calls,
      }
    : null;
  if (debug) window.__factory3d = debug;

  return scene3d;
};

/** Without WebGL 2: a short message where the floor would be, and a scene that does nothing. */
function noWebGlScene(host: HTMLElement): FactoryScene {
  const message = el(
    'p',
    'fs-empty fs-no-webgl',
    'The 3D view needs WebGL 2, which this browser does not support or has turned off. The board beside it still shows the factory.',
  );
  message.dataset.testid = 'scene-no-webgl';
  host.append(message);
  return {
    render() {},
    select() {},
    setActive() {},
    dispose() {
      message.remove();
    },
  };
}
