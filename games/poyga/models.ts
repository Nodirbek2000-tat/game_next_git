import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { newGltfLoader } from "@/engine/quality/assetUrl";

/**
 * Car GLBs built by tools/blender/cars.py. Each mesh primitive's material NAME is its role; the game owns the materials
 * (so there are only five car shaders in the whole game). Vertex colours = base colour x baked ambient occlusion.
 */
export type Role = "paint" | "glass" | "metal" | "matte" | "lamp";
export const ROLES: Role[] = ["paint", "glass", "metal", "matte", "lamp"];

export interface Part {
  role: Role;
  geo: THREE.BufferGeometry;
}
export interface CarModel {
  body: Part[];
  /** one wheel at the origin, axle on x, rim facing +x (empty for traffic models: their wheels are in the body) */
  wheel: Part[];
}

/** `size` floats per vertex as a plain Float32Array: a straight copy when the source already is one (the usual case), else the slow generic read. */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: 2 | 3): Float32Array {
  const n = a.count;
  if (!(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array && a.itemSize === size) return a.array.slice(0, n * size);
  const out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    out[i * size] = a.getX(i);
    out[i * size + 1] = a.getY(i);
    if (size === 3) out[i * size + 2] = a.getZ(i);
  }
  return out;
}

/** Plain float position/normal/color attributes (meshopt/quantised input is fine) and an index, nothing else. */
function clean(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute("position");
  const n = pos.count;
  g.setAttribute("position", new THREE.BufferAttribute(floats(pos, 3), 3));
  const nor = src.getAttribute("normal");
  if (nor) g.setAttribute("normal", new THREE.BufferAttribute(floats(nor, 3), 3));
  const col = src.getAttribute("color");
  g.setAttribute("color", new THREE.BufferAttribute(col ? floats(col, 3) : new Float32Array(n * 3).fill(1), 3));
  const idx = src.getIndex();
  if (idx) {
    // (a typed copy; the 16-bit index of a small mesh stays 16-bit)
    const ia = idx.array;
    g.setIndex(new THREE.BufferAttribute(ia instanceof Uint16Array || ia instanceof Uint32Array ? ia.slice() : Uint32Array.from(ia), 1));
  } else {
    const ia = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) ia[i] = i;
    g.setIndex(new THREE.BufferAttribute(ia, 1));
  }
  g.applyMatrix4(m);
  if (!nor) g.computeVertexNormals();
  return g;
}

/** Compile the shaders of an object (not in the scene yet) against the game's lights and haze; resolves when it can be drawn without a stall. */
export type Precompile = (o: THREE.Object3D) => Promise<void>;

const MAPS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"] as const;
/** Dispose a material and the textures it holds. */
export function disposeMaterial(m: THREE.Material): void {
  const t = m as unknown as Record<string, THREE.Texture | null | undefined>;
  for (const k of MAPS) t[k]?.dispose();
  m.dispose();
}

/**
 * One hidden triangle with every attribute the game's meshes use (normal, colour, uv, lamp): it is put in the scene with each
 * material so the engine's start-up precompile (`renderer.compileAsync`) builds the real shader variants before they are drawn.
 */
export function warmTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(9).fill(1), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(6).fill(0), 2));
  g.setAttribute("lamp", new THREE.Float32BufferAttribute([0, 0, 0], 1));
  return g;
}

/** Group a loaded scene's meshes by (wheel?, role) and merge each group into one geometry. */
export function partsFromScene(root: THREE.Object3D): CarModel {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let wheel = false;
    for (let a: THREE.Object3D | null = mesh; a && a !== root; a = a.parent) if (a.name.toLowerCase().startsWith("wheel")) wheel = true;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const role = (ROLES as string[]).includes(mat?.name) ? (mat.name as Role) : "matte";
    // the wheel stays in its own frame (the game moves it); the body is baked into the model frame
    if (wheel) {
      let w: THREE.Object3D = mesh;
      while (w.parent && w.parent !== root) w = w.parent;
      m.copy(w.matrixWorld).invert().multiply(mesh.matrixWorld);
    } else m.copy(inv).multiply(mesh.matrixWorld);
    const key = `${wheel ? "w" : "b"}:${role}`;
    const arr = groups.get(key) ?? [];
    arr.push(clean(mesh.geometry, m));
    groups.set(key, arr);
  });
  const out: CarModel = { body: [], wheel: [] };
  for (const [key, geos] of groups) {
    const [which, role] = key.split(":") as ["w" | "b", Role];
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
    if (geos.length > 1) for (const g of geos) g.dispose();
    geo.computeBoundingSphere();
    (which === "w" ? out.wheel : out.body).push({ role, geo });
  }
  const order = (p: Part) => ROLES.indexOf(p.role);
  out.body.sort((a, b) => order(a) - order(b));
  out.wheel.sort((a, b) => order(a) - order(b));
  return out;
}

const cache = new Map<string, Promise<CarModel | null>>();

export function loadCar(url: string): Promise<CarModel | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const gltf = await (await newGltfLoader()).loadAsync(url);
        const model = partsFromScene(gltf.scene);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            const mm = mesh.material as THREE.Material;
            mm.dispose?.();
          }
        });
        return model;
      } catch {
        return null;
      }
    })();
    cache.set(url, p);
  }
  return p;
}

export function disposeModels(): void {
  for (const p of cache.values()) void p.then((m) => m && [...m.body, ...m.wheel].forEach((x) => x.geo.dispose()));
  cache.clear();
}

/** The five car materials. The player's paint has a clear coat; the traffic paint is tinted per instance. */
export class CarMats {
  readonly paint: THREE.MeshStandardMaterial;
  readonly trafficPaint: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly matte: THREE.MeshStandardMaterial;
  readonly lamp: THREE.MeshBasicMaterial;
  readonly brake: THREE.MeshBasicMaterial;

  /** `clearcoat`: the glossy top layer on the player's paint (a physical material); without it a plain standard one, cheaper to shade */
  constructor(clearcoat: boolean) {
    const paint = { color: 0xc1121f, vertexColors: true, metalness: 0.45, roughness: 0.34, envMapIntensity: 1.15 };
    this.paint = clearcoat ? new THREE.MeshPhysicalMaterial({ ...paint, clearcoat: 1, clearcoatRoughness: 0.05 }) : new THREE.MeshStandardMaterial(paint);
    this.trafficPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.4, roughness: 0.38, envMapIntensity: 0.9 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.6, depthWrite: false });
    this.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.24, envMapIntensity: 1.1 });
    this.matte = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.78, envMapIntensity: 0.35 });
    this.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.brake = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.2, 1.4, 1.4) });
  }

  private warmGeo: THREE.BufferGeometry | null = null;

  /**
   * Hidden triangles with every car material, plain (the player) and instanced (the traffic, with per-instance colour where
   * the traffic uses it). In the scene at start they let the engine's precompile build every car shader up front: the
   * stand-in bodies use only some of the materials, the real models (which arrive later) all of them.
   */
  warm(): THREE.Group {
    const g = new THREE.Group();
    const geo = (this.warmGeo ??= warmTriangle());
    for (const m of [this.paint, this.glass, this.metal, this.matte, this.lamp]) g.add(new THREE.Mesh(geo, m));
    for (const m of [this.trafficPaint, this.glass, this.metal, this.matte, this.lamp]) {
      const im = new THREE.InstancedMesh(geo, m, 1);
      if (m === this.trafficPaint || m === this.lamp) im.setColorAt(0, new THREE.Color(1, 1, 1));
      g.add(im);
    }
    g.visible = false;
    return g;
  }

  of(role: Role, traffic = false): THREE.Material {
    switch (role) {
      case "paint":
        return traffic ? this.trafficPaint : this.paint;
      case "glass":
        return this.glass;
      case "metal":
        return this.metal;
      case "lamp":
        return this.lamp;
      default:
        return this.matte;
    }
  }

  dispose(): void {
    for (const m of [this.paint, this.trafficPaint, this.glass, this.metal, this.matte, this.lamp, this.brake]) m.dispose();
    this.warmGeo?.dispose();
  }
}
