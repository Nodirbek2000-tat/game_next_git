import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

/** Plain float position/normal/color attributes (meshopt/quantised input is fine) and an index, nothing else. */
function clean(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute("position");
  const n = pos.count;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const nor = src.getAttribute("normal");
  if (nor) {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = nor.getX(i);
      a[i * 3 + 1] = nor.getY(i);
      a[i * 3 + 2] = nor.getZ(i);
    }
    g.setAttribute("normal", new THREE.BufferAttribute(a, 3));
  }
  const col = src.getAttribute("color");
  const c = new Float32Array(n * 3).fill(1);
  if (col) for (let i = 0; i < n; i++) {
    c[i * 3] = col.getX(i);
    c[i * 3 + 1] = col.getY(i);
    c[i * 3 + 2] = col.getZ(i);
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const idx = src.getIndex();
  if (idx) g.setIndex(Array.from({ length: idx.count }, (_, i) => idx.getX(i)));
  else g.setIndex(Array.from({ length: n }, (_, i) => i));
  g.applyMatrix4(m);
  if (!nor) g.computeVertexNormals();
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
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(url);
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
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly trafficPaint: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly matte: THREE.MeshStandardMaterial;
  readonly lamp: THREE.MeshBasicMaterial;
  readonly brake: THREE.MeshBasicMaterial;

  constructor(clearcoat: boolean) {
    this.paint = new THREE.MeshPhysicalMaterial({
      color: 0xc1121f, vertexColors: true, metalness: 0.45, roughness: 0.34, clearcoat: clearcoat ? 1 : 0, clearcoatRoughness: 0.05, envMapIntensity: 1.15,
    });
    this.trafficPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.4, roughness: 0.38, envMapIntensity: 0.9 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.6, depthWrite: false });
    this.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.24, envMapIntensity: 1.1 });
    this.matte = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.78, envMapIntensity: 0.35 });
    this.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.brake = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.2, 1.4, 1.4) });
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
  }
}
