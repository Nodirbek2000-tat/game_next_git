import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { carParts } from "@/games/mashina/render/carModel";
import type { CarMats, CarModel, Part } from "./models";

/** Soft contact shadow (works with real shadows off too): a radial gradient under each car. */
let shadowTex: THREE.CanvasTexture | null = null;
export function contactShadow(): THREE.MeshBasicMaterial {
  if (!shadowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.72)");
    gr.addColorStop(0.55, "rgba(0,0,0,0.42)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2 });
}
const shadowGeo = (): THREE.BufferGeometry => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export interface WheelLayout {
  /** wheel centre x (left side, +x); the right side is mirrored */
  x: number;
  r: number;
  /** axle z positions (front, rear) */
  zf: number;
  zr: number;
}

/** Procedural stand-in (mashina's low-poly bodies) until the GLB is loaded. */
function fallback(kind: "sport" | "sedan" | "krossover" | "van" | "truck", withWheels: boolean): CarModel {
  const p = carParts(kind);
  const body: Part[] = [
    { role: "paint", geo: p.paint },
    { role: "matte", geo: p.trim },
    { role: "lamp", geo: p.lamps },
  ];
  if (withWheels)
    for (const [x, y, z] of p.wheelPos) body.push({ role: "matte", geo: p.wheel.clone().translate(x, y, z) });
  return { body, wheel: withWheels ? [] : [{ role: "matte", geo: p.wheel }] };
}

/** The player's car: body meshes + four wheel groups (spin, steer). */
export class PlayerView {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private flames: THREE.Mesh[] = [];
  private flameMat = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private flameGeo = new THREE.ConeGeometry(0.07, 0.6, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.3);
  private spin = 0;
  private owned: THREE.BufferGeometry[] = [];

  private shadowMat = contactShadow();
  private shadowGeo = shadowGeo();
  private shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);

  constructor(
    private mats: CarMats,
    private shadows: boolean,
  ) {
    this.group.add(this.body);
    this.shadow.position.y = 0.025;
    this.shadow.renderOrder = -1;
    this.group.add(this.shadow);
    this.group.rotation.order = "YXZ";
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(this.flameGeo, this.flameMat);
      f.visible = false;
      this.flames.push(f);
      this.group.add(f);
    }
  }

  set(model: CarModel | null, layout: WheelLayout, exhaust: [number, number, number][], color: string): void {
    this.body.clear();
    for (const w of this.wheels) this.group.remove(w);
    this.wheels = [];
    for (const g of this.owned) g.dispose();
    this.owned = [];
    const m = model ?? fallback("sport", false);
    for (const p of m.body) {
      const mesh = new THREE.Mesh(p.geo, this.mats.of(p.role));
      mesh.castShadow = this.shadows && p.role !== "glass";
      this.body.add(mesh);
    }
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.rotation.order = "YXZ";
      for (const p of m.wheel) {
        const mesh = new THREE.Mesh(p.geo, this.mats.of(p.role));
        mesh.castShadow = this.shadows;
        g.add(mesh);
      }
      const left = i % 2 === 0;
      if (!left) g.scale.x = -1;
      g.position.set(left ? layout.x : -layout.x, layout.r, i < 2 ? layout.zf : layout.zr);
      this.wheels.push(g);
      this.group.add(g);
    }
    exhaust.forEach((e, i) => this.flames[i]?.position.set(e[0], e[1], e[2]));
    this.mats.paint.color.set(color);
    this.layout = layout;
    this.shadow.scale.set(layout.x * 2 + 0.75, 1, (layout.zf - layout.zr) + 2.4);
  }

  private layout: WheelLayout = { x: 0.85, r: 0.35, zf: 1.3, zr: -1.3 };

  /** speed m/s, steer -1..1 (visual wheel angle), dt */
  update(speed: number, steer: number, dt: number, nitro: boolean, t: number): void {
    this.spin += (speed / this.layout.r) * dt;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.rotation.x = this.spin;
      // turning right = negative yaw (x is the car's left)
      w.rotation.y = i < 2 ? -steer * 0.38 : 0;
    }
    for (const f of this.flames) {
      f.visible = nitro;
      if (nitro) f.scale.set(1, 1, 0.7 + 0.5 * Math.sin(t * 60 + f.id) * Math.sin(t * 23));
    }
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.flameGeo.dispose();
    this.flameMat.dispose();
  }
}

export interface TrafficLike {
  kind: "sedan" | "krossover" | "van" | "truck";
  color: number;
  braking: boolean;
  len: number;
  width: number;
}

const KINDS = ["sedan", "krossover", "van", "truck"] as const;
type Kind = (typeof KINDS)[number];
const _o = new THREE.Object3D();
const _c = new THREE.Color();
const BRAKE = new THREE.Color(3.2, 1.3, 1.3);
const LIT = new THREE.Color(1, 1, 1);

/** All traffic as instanced meshes: per kind one mesh per role (paint tinted per car, lamps flare when braking). */
export class TrafficView {
  readonly group = new THREE.Group();
  private meshes = new Map<Kind, { paint: THREE.InstancedMesh | null; lamp: THREE.InstancedMesh | null; all: THREE.InstancedMesh[] }>();
  private owned: THREE.BufferGeometry[] = [];
  private shadowGeo = shadowGeo();
  private shadowMat = contactShadow();
  private shadowMesh: THREE.InstancedMesh;
  private _m = new THREE.Matrix4();
  private _s = new THREE.Matrix4();

  constructor(
    private mats: CarMats,
    private cap: number,
    private shadows: boolean,
  ) {
    for (const k of KINDS) this.setModel(k, null);
    this.shadowMesh = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, cap);
    this.shadowMesh.count = 0;
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.renderOrder = -1;
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.shadowMesh);
  }

  setModel(kind: Kind, model: CarModel | null): void {
    const old = this.meshes.get(kind);
    if (old) for (const m of old.all) {
      this.group.remove(m);
      m.dispose();
    }
    const m = model ?? fallback(kind, true);
    // (the fallback's wheel clones are freed with the rest of mashina's cached parts: disposeCarParts)
    const entry: { paint: THREE.InstancedMesh | null; lamp: THREE.InstancedMesh | null; all: THREE.InstancedMesh[] } = { paint: null, lamp: null, all: [] };
    for (const p of m.body) {
      const im = new THREE.InstancedMesh(p.geo, this.mats.of(p.role, true), this.cap);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = this.shadows && p.role === "paint";
      if (p.role === "paint" || p.role === "lamp") im.setColorAt(0, _c.set(0xffffff));
      if (p.role === "paint") entry.paint = im;
      if (p.role === "lamp") entry.lamp = im;
      entry.all.push(im);
      this.group.add(im);
    }
    this.meshes.set(kind, entry);
  }

  private counts = new Map<Kind, number>();

  /** pose(c, obj) writes the world transform of a traffic car into obj */
  update<T extends TrafficLike>(cars: readonly T[], pose: (c: T, o: THREE.Object3D) => boolean): void {
    this.counts.clear();
    let ns = 0;
    for (const c of cars) {
      const e = this.meshes.get(c.kind);
      if (!e) continue;
      const i = this.counts.get(c.kind) ?? 0;
      if (i >= this.cap) continue;
      if (!pose(c, _o)) continue;
      _o.updateMatrix();
      this.counts.set(c.kind, i + 1);
      for (const m of e.all) m.setMatrixAt(i, _o.matrix);
      e.paint?.setColorAt(i, _c.setHex(c.color));
      e.lamp?.setColorAt(i, c.braking ? BRAKE : LIT);
      if (ns < this.cap) {
        this._s.makeScale(c.width + 0.7, 1, c.len + 1.1).setPosition(0, 0.025, 0);
        this._m.multiplyMatrices(_o.matrix, this._s);
        this.shadowMesh.setMatrixAt(ns++, this._m);
      }
    }
    this.shadowMesh.count = ns;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    for (const [k, e] of this.meshes) {
      const n = this.counts.get(k) ?? 0;
      for (const m of e.all) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.shadowMesh.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    for (const e of this.meshes.values()) for (const m of e.all) m.dispose();
    for (const g of this.owned) g.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------- pedestrians

export interface PedLike {
  x: number;
  z: number;
  h: number;
  color: number;
  phase: number;
}

/** Simple people (two instanced meshes: the tinted clothes, the rest) walking with a gentle bob. */
export class PedView {
  readonly group = new THREE.Group();
  private clothes: THREE.InstancedMesh;
  private rest: THREE.InstancedMesh;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private o = new THREE.Object3D();
  private c = new THREE.Color();

  constructor(
    private cap: number,
    shadows: boolean,
  ) {
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
    const cloth = mergeAll([box(0.42, 0.62, 0.24, 0, 1.12, 0), box(0.1, 0.56, 0.11, -0.27, 1.12, 0), box(0.1, 0.56, 0.11, 0.27, 1.12, 0)]);
    const head = new THREE.SphereGeometry(0.12, 12, 10).scale(1, 1.15, 1).translate(0, 1.62, 0);
    const hair = new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.65, -0.005);
    const legs = mergeAll([box(0.15, 0.82, 0.17, -0.1, 0.41, 0), box(0.15, 0.82, 0.17, 0.1, 0.41, 0)]);
    const paint = (g: THREE.BufferGeometry, hex: number) => {
      const n = g.getAttribute("position").count;
      const col = new THREE.Color(hex);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
      return g;
    };
    const restGeo = mergeAll([paint(head, 0xc99a76), paint(hair, 0x2a1f18), paint(legs, 0x2b3340)]);
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const restMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.clothes = new THREE.InstancedMesh(cloth, clothMat, cap);
    this.rest = new THREE.InstancedMesh(restGeo, restMat, cap);
    for (const m of [this.clothes, this.rest]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.clothes.setColorAt(0, this.c.set(0xffffff));
    this.geos.push(cloth, restGeo);
    this.mats.push(clothMat, restMat);
  }

  /** the first `count` entries of `peds` are drawn (the list may be a longer pool) */
  update(peds: readonly PedLike[], y: number, count = peds.length): void {
    const n = Math.min(count, peds.length, this.cap);
    for (let i = 0; i < n; i++) {
      const p = peds[i];
      this.o.position.set(p.x, y + Math.abs(Math.sin(p.phase * Math.PI)) * 0.04, p.z);
      this.o.rotation.set(0, p.h, Math.sin(p.phase * Math.PI) * 0.03);
      this.o.updateMatrix();
      this.clothes.setMatrixAt(i, this.o.matrix);
      this.rest.setMatrixAt(i, this.o.matrix);
      this.clothes.setColorAt(i, this.c.setHex(p.color));
    }
    this.clothes.count = this.rest.count = n;
    this.clothes.instanceMatrix.needsUpdate = this.rest.instanceMatrix.needsUpdate = true;
    if (this.clothes.instanceColor) this.clothes.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.clothes.dispose();
    this.rest.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ng = gs.map((g) => {
    const n = g.index ? g : g;
    n.deleteAttribute("uv");
    return n;
  });
  const out = mergeGeometries(ng)!;
  for (const g of gs) g.dispose();
  return out;
}
