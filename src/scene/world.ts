import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { msToS, type ViewBus, type World } from '../contracts';
import { createCameraFlight } from './cameraFlight';
import { debugRequested, installDebugHook, type DebugHook } from './debugHook';
import { createEquipmentHost } from './equipmentHost';
import { createEquipmentLabels } from './equipmentLabels';
import './labels.css';
import { FLOOR, OVERVIEW, PLANT_BOUNDS, PLANT_HEIGHT_M, overviewDistanceM, type RectM } from './layout';
import { createPicker, type PickTarget } from './picking';
import { createPipes } from './pipes';
import { readSceneColor, watchTheme } from './theme';
import { createZones } from './zones';

const FOV_DEG = 40;
const NEAR_M = 0.5;
const FAR_M = 700;
/** Sharper than 2× costs fill rate for little gain (plan 07: 60 fps on a mid-range laptop). */
const MAX_PIXEL_RATIO = 2;
/** About 79°: the orbit stops short of the horizon, so the camera stays above the floor. */
const MAX_POLAR_RAD = 1.38;
const MIN_DISTANCE_M = 5;
const MAX_DISTANCE_M = 320;
/** Used only when the host has no height of its own yet, so the view still shows. */
const FALLBACK_ASPECT = 16 / 9;
/**
 * Machine labels refresh their values and lamps at the HUD's rate (plan 07: 4 times a second), on real
 * time as main.ts counts the HUD's, so they keep up with the rail however slow the frames come.
 */
const LABEL_REFRESH_S = 0.25;

/** The preview's sun: high and from the dock side, so shadows fall short and back toward the milk row. */
const SUN_DIRECTION = new THREE.Vector3(40, 80, 44).normalize();
const SUN_DISTANCE_M = 120;
const SHADOW_MAP_PX = 2048;
/** Soft shadow edge in shadow-map texels. three r186 dropped PCFSoftShadowMap; PCFShadowMap with a radius replaces it. */
const SHADOW_RADIUS = 3;

/**
 * The 3D view: renderer, camera, orbit controls, one shadow-casting light, the floor and zones, the
 * equipment modules with their labels and lamps, the pipes, picking and the camera's fly-to.
 * Both a rail click and a 3D click arrive here as selectStage on the bus; the camera flies to that stage.
 * An overview event (the rail's "Whole plant") flies it back to the whole plant.
 */
export function createWorld(host: HTMLElement, bus: ViewBus): World {
  // Make the WebGL 2 context here rather than in WebGLRenderer, which logs an error and throws
  // when it can't (three.js needs WebGL 2 since r163). Without it the rest of the app still runs.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!context) return createNoWebGlWorld(host);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  } catch {
    return createNoWebGlWorld(host);
  }
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Block, so no inline gap appears under it; zero height until measured, so a host that takes its
  // height from its content doesn't measure the canvas's default 150 px.
  canvas.style.display = 'block';
  canvas.style.height = '0px';
  host.append(canvas);

  // Labels live in their own scene graph, so the label renderer walks a few dozen labels per frame,
  // not every mesh in the plant. Their positions are world positions.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'scene-labels';
  host.append(labelRenderer.domElement);
  const labelScene = new THREE.Scene();

  const scene = new THREE.Scene();
  const background = new THREE.Color();
  scene.background = background;

  const camera = new THREE.PerspectiveCamera(FOV_DEG, FALLBACK_ASPECT, NEAR_M, FAR_M);
  const overviewTarget = new THREE.Vector3(...OVERVIEW.targetM);
  const overviewDirection = new THREE.Vector3(...OVERVIEW.direction).normalize();

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Pan along the floor, so the target keeps its height and the polar limit keeps the camera above the floor.
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = MAX_POLAR_RAD;
  controls.minDistance = MIN_DISTANCE_M;
  controls.maxDistance = MAX_DISTANCE_M;
  // Keep the target over the plant, so a long pan can't lose it; every stage focus lies within this radius.
  const plant = centreOf(PLANT_BOUNDS);
  controls.cursor.set(plant.xM, 0, plant.zM);
  controls.maxTargetRadius = Math.max(PLANT_BOUNDS.xMaxM - PLANT_BOUNDS.xMinM, PLANT_BOUNDS.zMaxM - PLANT_BOUNDS.zMinM) / 2;
  // Like the preview, the overview refits the window until the viewer takes the camera or picks a stage.
  let cameraTaken = false;

  const sky = new THREE.HemisphereLight(0xffffff, 0x9aa7b2, 1.3);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = SHADOW_RADIUS;
  aimSunAt(sun, PLANT_BOUNDS);
  scene.add(sky, sun, sun.target);

  const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.xMaxM - FLOOR.xMinM, FLOOR.zMaxM - FLOOR.zMinM), floorMaterial);
  const floorCentre = centreOf(FLOOR);
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(floorCentre.xM, 0, floorCentre.zM);
  floor.receiveShadow = true;
  scene.add(floor);

  const zones = createZones(scene, labelScene);
  const equipmentHost = createEquipmentHost(scene);
  const pipes = createPipes(scene, equipmentHost.materials.steel);
  const labels = createEquipmentLabels(equipmentHost.equipment, labelScene);
  const flight = createCameraFlight(scene, camera, controls, host);

  const takeCamera = (): void => {
    cameraTaken = true;
    flight.cancel();
  };
  const pickTargets: PickTarget[] = [
    ...equipmentHost.equipment.map(({ object, stage }) => ({ object, stage })),
    ...pipes.pickTargets,
  ];
  const picker = createPicker({
    canvas,
    camera,
    targets: pickTargets,
    onPick: (stage) => bus.emit({ type: 'selectStage', stage }),
    onTakeCamera: takeCamera,
  });

  // The scene reacts to every selection, its own clicks included: the rail and the view stay in step.
  const stopListening = bus.on((event) => {
    if (event.type === 'selectStage') {
      cameraTaken = true;
      labels.select(event.stage);
      flight.flyTo(event.stage);
    } else if (event.type === 'overview') {
      labels.select(null);
      flight.flyHome(overviewPosition(), overviewTarget);
      // As in the preview, the overview refits the window again until the viewer takes the camera.
      cameraTaken = false;
    }
  });

  const applyTheme = (): void => {
    background.set(readSceneColor('--scene-bg'));
    floorMaterial.color.set(readSceneColor('--floor'));
    zones.applyTheme();
    equipmentHost.applyTheme();
    pipes.applyTheme();
    flight.applyTheme();
  };
  applyTheme();
  const stopWatchingTheme = watchTheme(applyTheme);

  const viewSize = new THREE.Vector2();
  const overviewPosition = (): THREE.Vector3 => {
    const viewHalfWidthPerM = camera.getViewSize(1, viewSize).x / 2;
    return overviewTarget.clone().addScaledVector(overviewDirection, overviewDistanceM(viewHalfWidthPerM));
  };
  const frameOverview = (): void => {
    camera.position.copy(overviewPosition());
    controls.target.copy(overviewTarget);
    controls.update();
  };
  frameOverview();

  const render = (): void => {
    renderer.render(scene, camera);
    labelRenderer.render(labelScene, camera);
  };

  const resize = (widthPx: number, contentHeightPx: number): void => {
    if (widthPx <= 0) return;
    const heightPx = contentHeightPx > 0 ? contentHeightPx : Math.round(widthPx / FALLBACK_ASPECT);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(widthPx, heightPx);
    labelRenderer.setSize(widthPx, heightPx);
    camera.aspect = widthPx / heightPx;
    camera.updateProjectionMatrix();
    if (!cameraTaken) {
      flight.cancel(); // a fly home aimed at the old window shape: jump to the new fit instead
      frameOverview();
    }
    render(); // resizing clears the canvas; draw now rather than show a blank frame
  };
  // The host's last content size, kept for a change of pixel ratio alone (below).
  let hostWidthPx = 0;
  let hostHeightPx = 0;
  // The content box, not clientHeight, so padding on the host can't feed back into the canvas size.
  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    hostWidthPx = entry.contentRect.width;
    hostHeightPx = entry.contentRect.height;
    resize(hostWidthPx, hostHeightPx);
  });
  resizeObserver.observe(host);

  // Moving the window to a screen with another pixel ratio changes devicePixelRatio but not the CSS
  // size, so the observer stays quiet. A resolution query matches one ratio only: re-arm it on each change.
  let ratioQuery: MediaQueryList | null = null;
  const onRatioChange = (): void => {
    resize(hostWidthPx, hostHeightPx);
    watchRatio();
  };
  const watchRatio = (): void => {
    ratioQuery?.removeEventListener('change', onRatioChange);
    ratioQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    ratioQuery.addEventListener('change', onRatioChange);
  };
  watchRatio();

  const debug: DebugHook | null = debugRequested()
    ? installDebugHook({
        stageScreenPoint: (stage) => picker.stageScreenPoint(stage),
        focusStage: () => flight.focusStage,
        cameraTargetM: () => controls.target.toArray(),
        cameraPositionM: () => camera.position.toArray(),
        info: () => renderer.info.render,
        equipmentIds: () => equipmentHost.equipment.map((item) => item.id),
      })
    : null;

  let lastUpdateMs = performance.now();
  let sinceLabelsS = LABEL_REFRESH_S;
  return {
    update(snapshot, realDtS) {
      picker.update();
      flight.update(realDtS); // before the controls, which then apply their limits and damping
      controls.update(realDtS);
      equipmentHost.update(snapshot, realDtS);
      // Paused means the plant's time stands still: the milk stops flowing with it.
      pipes.update(snapshot.line, realDtS, !snapshot.paused);
      // The labels count real time, not realDtS, which counts no frame as longer than maxFrameS: right for the
      // camera (a stall doesn't make it jump), but slow frames would leave the labels behind the rail.
      const nowMs = performance.now();
      sinceLabelsS += Math.max(0, msToS(nowMs - lastUpdateMs));
      lastUpdateMs = nowMs;
      if (sinceLabelsS >= LABEL_REFRESH_S) {
        sinceLabelsS = 0;
        labels.refresh(snapshot);
      }
      labels.updateDetail(camera.position);
      zones.updateLabels(camera.position.distanceTo(controls.target));
    },
    render() {
      render();
      debug?.frame(performance.now());
    },
    dispose() {
      debug?.dispose();
      stopListening();
      resizeObserver.disconnect();
      ratioQuery?.removeEventListener('change', onRatioChange);
      stopWatchingTheme();
      picker.dispose();
      labels.dispose();
      zones.dispose();
      flight.dispose();
      pipes.dispose();
      equipmentHost.dispose();
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss(); // free the GPU context now, not at garbage collection (Vite hot reloads)
      canvas.remove();
      labelRenderer.domElement.remove();
    },
  };
}

function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

function centreOf(rect: RectM): { xM: number; zM: number } {
  return { xM: (rect.xMinM + rect.xMaxM) / 2, zM: (rect.zMinM + rect.zMaxM) / 2 };
}

/**
 * Points the one shadow-casting light (plan 07) at the plant and fits its shadow camera around
 * a sphere holding every zone up to the tallest machine, plus room for that machine's shadow.
 */
function aimSunAt(sun: THREE.DirectionalLight, plant: RectM): void {
  const centre = centreOf(plant);
  const radiusM =
    Math.hypot(plant.xMaxM - plant.xMinM, plant.zMaxM - plant.zMinM, PLANT_HEIGHT_M) / 2 + PLANT_HEIGHT_M;
  sun.target.position.set(centre.xM, 0, centre.zM);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE_M);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -radiusM;
  shadowCamera.right = radiusM;
  shadowCamera.top = radiusM;
  shadowCamera.bottom = -radiusM;
  shadowCamera.near = SUN_DISTANCE_M - radiusM;
  shadowCamera.far = SUN_DISTANCE_M + radiusM;
  shadowCamera.updateProjectionMatrix();
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of [object.material].flat()) material.dispose();
    } else if (object instanceof THREE.Light) {
      object.dispose(); // a shadow-casting light owns its shadow map
    }
  });
}

/** Without WebGL 2: a short message in the view, and a world that does nothing. */
function createNoWebGlWorld(host: HTMLElement): World {
  const message = document.createElement('p');
  message.className = 'webgl-missing';
  message.textContent =
    'The 3D view needs WebGL 2, which this browser does not support or has turned off. The rest of the simulation still runs.';
  message.style.cssText = 'margin:0;padding:24px;max-width:48ch;line-height:1.4'; // readable before any app CSS
  host.append(message);
  return {
    update() {},
    render() {},
    dispose() {
      message.remove();
    },
  };
}
