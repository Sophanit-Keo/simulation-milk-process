// Builds one grey-box fixture from scaled unit shapes, written with the preview's world coordinates so the
// port can be checked number by number against uht-plant-preview.html (stage 7 to stage 10 blocks).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PointM } from '../../layout';
import type { Kit, PacksMaterial, Shape } from './kit';

export type SizeM = readonly [xM: number, yM: number, zM: number];
export type RotationRad = readonly [xRad: number, yRad: number, zRad: number];

export interface PartOptions {
  /** Euler angles, applied in three.js's default XYZ order like the preview's rx, ry and rz. */
  rotationRad?: RotationRad;
  /** Only the big shapes cast shadows: each caster costs a draw call in the shadow pass too. */
  castShadow?: boolean;
  /** A group from this builder; the part's position is then relative to it, as in the preview's groups. */
  parent?: THREE.Object3D;
}

/** One copy of an instanced part, in world metres like part(). */
export interface InstanceM {
  atM: PointM;
  sizeM: SizeM;
  rotationRad?: RotationRad;
}

interface Bucket {
  parent: THREE.Object3D;
  material: PacksMaterial;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

export interface BuiltFixture {
  object: THREE.Group;
  /** Disposes what the builder made (merged geometry, instance buffers), never the kit's shapes or materials. */
  dispose(): void;
  /**
   * Takes one of the builder's groups out of the fixture and frees what it made inside, e.g. the grey-box
   * conveyor once the kit pieces have loaded. The rest of the fixture keeps working.
   */
  release(group: THREE.Object3D): void;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/**
 * Static parts of one fixture are merged into one mesh per material (and per group), which keeps the
 * packs line near one draw call per material per fixture; a click on any of them still finds the fixture.
 * Moving parts get meshes of their own on the kit's shared unit shapes, and repeats are instanced.
 *
 * The root sits at the fixture's footprint centre on the floor (`originM`, y = 0), so a hero model can
 * replace the grey box in place; parts are given in world metres and placed relative to it. A fixture
 * that is turned or moved as a whole (a vehicle) is built around [0, 0, 0] and placed afterwards.
 */
export class FixtureBuilder {
  readonly root = new THREE.Group();
  private readonly buckets = new Map<string, Bucket>();
  private readonly groupKeys = new Map<THREE.Object3D, number>();
  /** The root and its layers: parts placed in these take world metres. */
  private readonly worldFrame = new Set<THREE.Object3D>();
  /** Merged geometry and instanced meshes this builder made, by the group they sit in. */
  private readonly owned = new Map<THREE.Object3D, { geometries: THREE.BufferGeometry[]; instanced: THREE.InstancedMesh[] }>();

  constructor(
    private readonly kit: Kit,
    name: string,
    private readonly originM: PointM,
  ) {
    this.root.name = name;
    this.root.position.set(originM[0], originM[1], originM[2]);
    this.groupKeys.set(this.root, 0);
    this.worldFrame.add(this.root);
  }

  /** World metres to the root's frame. */
  local(atM: PointM): THREE.Vector3 {
    return new THREE.Vector3(atM[0] - this.originM[0], atM[1] - this.originM[1], atM[2] - this.originM[2]);
  }

  /** A static part; merged at build() with the fixture's other parts of the same material and group. */
  part(shape: Shape, material: PacksMaterial, atM: PointM, sizeM: SizeM, options: PartOptions = {}): void {
    const parent = options.parent ?? this.root;
    const castShadow = options.castShadow ?? false;
    const key = `${this.groupKey(parent)}|${material}|${castShadow}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { parent, material, castShadow, geometries: [] };
      this.buckets.set(key, bucket);
    }
    const geometry = this.kit.shape(shape).clone();
    geometry.applyMatrix4(this.matrixFor(parent, atM, sizeM, options.rotationRad));
    bucket.geometries.push(geometry);
  }

  /**
   * An empty group that moves as one (a reel that turns, an arm that swings) at `atM`; its parts take
   * `parent: group` and positions relative to it, as in the preview's groups.
   */
  group(name: string, atM: PointM, parent: THREE.Object3D = this.root): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    this.groupKey(parent); // the parent must be the root or one of this builder's groups
    group.position.copy(this.positionIn(parent, atM));
    parent.add(group);
    this.groupKeys.set(group, this.groupKeys.size);
    return group;
  }

  /**
   * A group at the fixture's own origin whose parts stay in world metres like the root's, so a whole layer
   * (the grey-box conveyor) can be swapped out in one go, e.g. once the kit model has loaded.
   */
  layer(name: string): THREE.Group {
    const layer = this.group(name, this.originM);
    this.worldFrame.add(layer);
    return layer;
  }

  /** A part that moves on its own, on the kit's shared unit shape (scaled, never merged). */
  mesh(name: string, shape: Shape, material: PacksMaterial | THREE.Material, atM: PointM, sizeM: SizeM, options: PartOptions = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(this.kit.shape(shape), this.materialOf(material));
    mesh.name = name;
    const parent = options.parent ?? this.root;
    this.groupKey(parent);
    mesh.position.copy(this.positionIn(parent, atM));
    mesh.scale.set(...sizeM);
    if (options.rotationRad) mesh.rotation.set(...options.rotationRad);
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * Many copies of one shape in one draw call (rack uprights, rollers, pallet loads). `capacity` leaves
   * room for more copies than are placed now; `count` starts at the number placed.
   */
  instanced(
    name: string,
    shape: Shape,
    material: PacksMaterial | THREE.Material,
    copies: readonly InstanceM[],
    options: { castShadow?: boolean; parent?: THREE.Object3D; capacity?: number } = {},
  ): THREE.InstancedMesh {
    const parent = options.parent ?? this.root;
    this.groupKey(parent);
    const capacity = Math.max(options.capacity ?? copies.length, copies.length, 1);
    const mesh = new THREE.InstancedMesh(this.kit.shape(shape), this.materialOf(material), capacity);
    mesh.name = name;
    copies.forEach(({ atM, sizeM, rotationRad }, i) => mesh.setMatrixAt(i, this.matrixFor(parent, atM, sizeM, rotationRad)));
    mesh.count = copies.length;
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    this.ownedBy(parent).instanced.push(mesh);
    return mesh;
  }

  /** Merges the static parts and returns the fixture, with dispose() and release() for what it made. */
  build(): BuiltFixture {
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const geometry of bucket.geometries) geometry.dispose();
      if (!merged) throw new Error(`${this.root.name}: could not merge its ${bucket.material} parts`);
      this.ownedBy(bucket.parent).geometries.push(merged);
      const mesh = new THREE.Mesh(merged, this.kit.material(bucket.material));
      mesh.name = `${bucket.parent.name}-${bucket.material}`;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      // The parts are baked into the geometry, so this mesh never moves within its group.
      mesh.matrixAutoUpdate = false;
      bucket.parent.add(mesh);
    }
    this.buckets.clear();
    const releaseKit = this.kit.hold();
    const owned = this.owned;
    const free = (group: THREE.Object3D): void => {
      for (const [holder, items] of owned) {
        if (holder !== group && !isInside(holder, group)) continue;
        for (const geometry of items.geometries) geometry.dispose();
        for (const mesh of items.instanced) mesh.dispose();
        owned.delete(holder);
      }
    };
    return {
      object: this.root,
      dispose: () => {
        free(this.root);
        releaseKit();
      },
      release: (group) => {
        free(group);
        group.removeFromParent();
      },
    };
  }

  private materialOf(material: PacksMaterial | THREE.Material): THREE.Material {
    return typeof material === 'string' ? this.kit.material(material) : material;
  }

  private ownedBy(group: THREE.Object3D): { geometries: THREE.BufferGeometry[]; instanced: THREE.InstancedMesh[] } {
    let items = this.owned.get(group);
    if (!items) {
      items = { geometries: [], instanced: [] };
      this.owned.set(group, items);
    }
    return items;
  }

  private groupKey(parent: THREE.Object3D): number {
    const key = this.groupKeys.get(parent);
    if (key === undefined) throw new Error(`${this.root.name}: a part's parent must be the fixture or one of its groups`);
    return key;
  }

  /** World metres within the root and its layers, the group's own frame within any other group. */
  private positionIn(parent: THREE.Object3D, atM: PointM): THREE.Vector3 {
    return this.worldFrame.has(parent) ? this.local(atM) : new THREE.Vector3(...atM);
  }

  private matrixFor(parent: THREE.Object3D, atM: PointM, sizeM: SizeM, rotationRad?: RotationRad): THREE.Matrix4 {
    _position.copy(this.positionIn(parent, atM));
    _euler.set(...(rotationRad ?? [0, 0, 0]));
    _quaternion.setFromEuler(_euler);
    _scale.set(...sizeM);
    return _matrix.compose(_position, _quaternion, _scale);
  }
}

/** True if `object` sits somewhere below `ancestor`. */
function isInside(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node = object.parent; node; node = node.parent) if (node === ancestor) return true;
  return false;
}
