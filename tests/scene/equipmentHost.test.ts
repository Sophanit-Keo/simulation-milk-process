import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentContext } from '../../src/scene/equipment';
import { createEquipmentHost } from '../../src/scene/equipmentHost';
import { stubTheme } from './browserStubs';

// The host owns what it loads for the equipment: each GLB's scene (whose clones share its geometries,
// materials and textures) and the token prints. Its dispose() must free them before it returns, because
// world.ts disposes the renderer straight after, and a free that comes later never reaches the GPU.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A loaded GLB as GLTFLoader gives it: a scene with a textured mesh in a group, and the parts to watch. */
function gltfScene() {
  const geometry = new THREE.BoxGeometry();
  const map = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map });
  const scene = new THREE.Group();
  scene.add(new THREE.Group().add(new THREE.Mesh(geometry, material)));
  return { scene, parts: [geometry, material, map] };
}

/** Records which of `parts` have fired 'dispose'. */
function watchDisposal(parts: readonly THREE.EventDispatcher<{ dispose: object }>[]): Set<unknown> {
  const disposed = new Set<unknown>();
  for (const part of parts) part.addEventListener('dispose', () => disposed.add(part));
  return disposed;
}

/** A host whose one module asks for what `use` asks for; `ready` settles once every load has. */
function hostUsing(use: (ctx: EquipmentContext) => Promise<unknown>[]) {
  stubTheme();
  let ready: Promise<unknown> = Promise.resolve();
  const host = createEquipmentHost(new THREE.Scene(), [
    (ctx) => {
      ready = Promise.allSettled(use(ctx));
      return [];
    },
  ]);
  return { host, ready: () => ready };
}

describe('equipmentHost.dispose', () => {
  it('frees every loaded model and token print before it returns', async () => {
    const truck = gltfScene();
    const forklift = gltfScene();
    const print = new THREE.Texture<HTMLImageElement>();
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
      const { scene } = url.endsWith('truck.glb') ? truck : forklift;
      return { scene } as unknown as GLTF;
    });
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(print);
    const { host, ready } = hostUsing((ctx) => [
      ctx.loadModel('vehicles/truck.glb'),
      ctx.loadModel('vehicles/truck.glb'),
      ctx.loadModel('vehicles/forklift.glb'),
      ctx.loadTexture?.('carton.png') ?? Promise.reject(new Error('the host loads no textures')),
    ]);
    await ready();
    const parts = [...truck.parts, ...forklift.parts, print];
    const disposed = watchDisposal(parts);

    host.dispose(); // no await: everything is freed by the time it returns
    expect(parts.filter((part) => !disposed.has(part)).map((part) => part.constructor.name), 'not freed').toEqual([]);
  });

  it('frees a model or print that arrives after dispose', async () => {
    const late = gltfScene();
    const print = new THREE.Texture<HTMLImageElement>();
    let arrive = (): void => {};
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      await arrived;
      return { scene: late.scene } as unknown as GLTF;
    });
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
      await arrived;
      return print;
    });
    const { host, ready } = hostUsing((ctx) => [
      ctx.loadModel('vehicles/truck.glb'),
      ctx.loadTexture?.('pallet.png') ?? Promise.reject(new Error('the host loads no textures')),
    ]);
    const parts = [...late.parts, print];
    const disposed = watchDisposal(parts);

    host.dispose();
    arrive();
    await ready();
    expect(parts.filter((part) => !disposed.has(part)).map((part) => part.constructor.name), 'not freed').toEqual([]);
  });
});
