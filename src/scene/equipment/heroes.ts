// The four hero machines' first-pass models (the assets lane's block-outs in public/models/hero), loaded only
// behind the ?heroes flag: the grey boxes stay the default until phase 5 (phase 4 card). Once a model loads it
// goes into the machine's root as it is, filler B's mirrored along z; the grey parts it replaces are hidden,
// and the machine's update code is pointed at the model's moving nodes. Those carry the grey nodes' names and
// rest transforms (assets/hero-specs.md, "What scene needs for the swap"), so the same writes drive them.
import * as THREE from 'three';
import type { EquipmentContext } from './types';

/** Each hero model under public/models; both fillers load the one file. */
export const HERO_MODELS = {
  separator: 'hero/separator.glb',
  homogenizer: 'hero/homogenizer.glb',
  filler: 'hero/aseptic-filler.glb',
  palletizer: 'hero/palletizer.glb',
} as const;

export interface HeroSwap<Node extends string> {
  /** The model file under public/models (HERO_MODELS). */
  path: string;
  /** The machine's moving nodes the model must have, by name; a model short of one is left out. */
  nodes: readonly Node[];
  /** Children of the root that stay: what the model leaves out (the homogenizer's needles, the palletizer's pallet and load). */
  keep?: readonly THREE.Object3D[];
  /** Mirror the model along z, for filler B, the mirror image of A. */
  mirrorZ?: boolean;
}

const isGlass = (material: THREE.Material | THREE.Material[]): boolean =>
  (Array.isArray(material) ? material : [material]).some((one) => one.transparent);

/**
 * With ctx.heroModels, loads the hero model and swaps it in for the root's grey parts, then hands its moving
 * nodes to `onSwapped`. Without the flag, or if the file is missing or the machine is gone (`isAlive`), the
 * grey box stays. The model belongs to the host's cache (a fresh clone per call), so the machine never
 * disposes it.
 */
export function swapInHero<Node extends string>(
  ctx: EquipmentContext,
  root: THREE.Object3D,
  swap: HeroSwap<Node>,
  onSwapped: (nodes: Record<Node, THREE.Object3D>) => void,
  isAlive: () => boolean,
): void {
  if (!ctx.heroModels) return;
  ctx.loadModel(swap.path).then(
    (model) => {
      if (!isAlive()) return;
      const nodes = {} as Record<Node, THREE.Object3D>;
      for (const name of swap.nodes) {
        const node = model.getObjectByName(name);
        if (!node) {
          console.warn(`${swap.path} has no node "${name}": ${root.name} keeps its grey box`);
          return;
        }
        nodes[name] = node;
      }
      // GLTFLoader leaves shadows off; the glass of the filler's aseptic zone casts none, as the scene's own glass.
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = !isGlass(object.material);
        object.receiveShadow = true;
      });
      if (swap.mirrorZ) model.scale.z = -1;
      const keep = new Set(swap.keep ?? []);
      for (const child of root.children) if (!keep.has(child)) child.visible = false;
      model.name = `${root.name}-hero`;
      root.add(model);
      onSwapped(nodes);
    },
    () => {}, // no model: the grey box stays
  );
}
