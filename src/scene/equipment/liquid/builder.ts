// Builds one grey-box machine from scaled unit shapes, written with the preview's world coordinates
// so the port can be checked number by number against uht-plant-preview.html.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PointM } from '../../layout';
import type { Kit, LiquidMaterial, Shape } from './kit';

export type SizeM = readonly [xM: number, yM: number, zM: number];

export interface PartOptions {
  /** Euler angles, applied in three.js's default XYZ order like the preview's rx, ry and rz. */
  rotationRad?: readonly [xRad: number, yRad: number, zRad: number];
  /** Only the big shapes cast shadows: each caster costs a draw call in the shadow pass too. */
  castShadow?: boolean;
  /** A pivot from this builder; the part's position is then relative to it, as in the preview's groups. */
  parent?: THREE.Object3D;
}

interface Bucket {
  parent: THREE.Object3D;
  material: LiquidMaterial;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/**
 * Static parts of one machine are merged into one mesh per material (and per moving pivot), which keeps
 * the line near one draw call per material per machine; a click on any of them still finds the machine.
 * Moving parts get meshes of their own on the kit's shared unit shapes.
 *
 * The root sits at the machine's footprint centre on the floor (`originM`, y = 0), so a hero model
 * can replace the grey box in place; parts are given in world metres and placed relative to it.
 */
export class MachineBuilder {
  readonly root = new THREE.Group();
  private readonly buckets = new Map<string, Bucket>();
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly ownedInstanced: THREE.InstancedMesh[] = [];
  private readonly parentKeys = new Map<THREE.Object3D, number>();

  constructor(
    private readonly kit: Kit,
    name: string,
    private readonly originM: PointM,
  ) {
    this.root.name = name;
    this.root.position.set(originM[0], originM[1], originM[2]);
    this.parentKeys.set(this.root, 0);
  }

  /** World metres to the root's frame. */
  local(atM: PointM): THREE.Vector3 {
    return new THREE.Vector3(atM[0] - this.originM[0], atM[1] - this.originM[1], atM[2] - this.originM[2]);
  }

  /** A static part; merged at build() with the machine's other parts of the same material. */
  part(shape: Shape, material: LiquidMaterial, atM: PointM, sizeM: SizeM, options: PartOptions = {}): void {
    const parent = options.parent ?? this.root;
    const castShadow = options.castShadow ?? false;
    const key = `${this.parentKey(parent)}|${material}|${castShadow}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { parent, material, castShadow, geometries: [] };
      this.buckets.set(key, bucket);
    }
    const geometry = this.kit.shape(shape).clone();
    geometry.applyMatrix4(this.matrixFor(parent, atM, sizeM, options.rotationRad));
    bucket.geometries.push(geometry);
  }

  /** Round legs under a vessel, as the preview's legs(): `count` of them on a circle, the first at 0.4 rad. */
  legs(centreM: readonly [xM: number, zM: number], circleRadiusM: number, heightM: number, count: number, legRadiusM: number): void {
    for (let i = 0; i < count; i++) {
      const angleRad = (i / count) * Math.PI * 2 + 0.4;
      const atM: PointM = [centreM[0] + circleRadiusM * Math.cos(angleRad), heightM / 2, centreM[1] + circleRadiusM * Math.sin(angleRad)];
      this.part('cylLo', 'steelDark', atM, [legRadiusM, heightM, legRadiusM]);
    }
  }

  /** An empty group that moves as one (spins, flips); its parts take `parent: pivot` and local positions. */
  pivot(name: string, atM: PointM): THREE.Group {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(this.local(atM));
    this.root.add(pivot);
    this.parentKeys.set(pivot, this.parentKeys.size);
    return pivot;
  }

  /** A part that moves on its own, on the kit's shared unit shape (scaled, never merged). */
  mesh(name: string, shape: Shape, material: LiquidMaterial, atM: PointM, sizeM: SizeM, options: PartOptions = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(this.kit.shape(shape), this.kit.material(material));
    mesh.name = name;
    const parent = options.parent ?? this.root;
    mesh.position.copy(parent === this.root ? this.local(atM) : new THREE.Vector3(...atM));
    mesh.scale.set(...sizeM);
    if (options.rotationRad) mesh.rotation.set(...options.rotationRad);
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Many copies of one shape in one draw call, e.g. the heat exchanger's plates; positions in world metres. */
  instanced(name: string, shape: Shape, material: LiquidMaterial, copies: readonly { atM: PointM; sizeM: SizeM }[], castShadow = false): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.kit.shape(shape), this.kit.material(material), copies.length);
    mesh.name = name;
    copies.forEach(({ atM, sizeM }, i) => mesh.setMatrixAt(i, this.matrixFor(this.root, atM, sizeM)));
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.ownedInstanced.push(mesh);
    return mesh;
  }

  /** Merges the static parts and returns the machine, with a dispose() for the geometry and instance buffers it made. */
  build(): { object: THREE.Group; dispose: () => void } {
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const geometry of bucket.geometries) geometry.dispose();
      if (!merged) throw new Error(`${this.root.name}: could not merge its ${bucket.material} parts`);
      this.owned.push(merged);
      const mesh = new THREE.Mesh(merged, this.kit.material(bucket.material));
      mesh.name = `${bucket.parent.name}-${bucket.material}`;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      // The parts are baked into the geometry, so this mesh never moves within its parent.
      mesh.matrixAutoUpdate = false;
      bucket.parent.add(mesh);
    }
    this.buckets.clear();
    const release = this.kit.hold();
    const owned = this.owned;
    const ownedInstanced = this.ownedInstanced;
    return {
      object: this.root,
      dispose: () => {
        for (const geometry of owned) geometry.dispose();
        for (const mesh of ownedInstanced) mesh.dispose(); // its instance matrices; the shape is the kit's
        owned.length = 0;
        ownedInstanced.length = 0;
        release();
      },
    };
  }

  private parentKey(parent: THREE.Object3D): number {
    const key = this.parentKeys.get(parent);
    if (key === undefined) throw new Error(`${this.root.name}: a part's parent must be the machine or one of its pivots`);
    return key;
  }

  private matrixFor(parent: THREE.Object3D, atM: PointM, sizeM: SizeM, rotationRad?: PartOptions['rotationRad']): THREE.Matrix4 {
    if (parent === this.root) _position.copy(this.local(atM));
    else _position.set(...atM);
    _euler.set(...(rotationRad ?? [0, 0, 0]));
    _quaternion.setFromEuler(_euler);
    _scale.set(...sizeM);
    return _matrix.compose(_position, _quaternion, _scale);
  }
}
