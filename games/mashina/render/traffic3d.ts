import * as THREE from "three";
import { TRAFFIC_GLB } from "@/games/poyga/config";
import { loadCar, type CarMats } from "@/games/poyga/models";
import { TrafficView, type TrafficLike } from "@/games/poyga/views";
import type { AiCar, AiType } from "../traffic/sim";
import type { Ped } from "../traffic/peds";
import type { LightColor } from "../logic/signals";
import type { Layout, Light } from "../world/layout";
import { bridgeDeckY } from "../world/layout";
import { GeoBuilder } from "./geo";
import type { Mats } from "./materials";

const _o = new THREE.Object3D();
const _c = new THREE.Color();

/**
 * All AI cars: the four traffic bodies of Shahar simulyatori (the same GLB files and the same instanced view: per kind one mesh
 * per material role, paint tinted per car, tail lamps flaring when braking, a soft contact shadow). The procedural low-poly
 * bodies stand in until a model has arrived.
 */
interface CarPose extends TrafficLike {
  x: number;
  y: number;
  z: number;
  h: number;
}

const poseOf = (c: TrafficLike, o: THREE.Object3D): boolean => {
  const p = c as CarPose;
  o.position.set(p.x, p.y, p.z);
  o.rotation.set(0, p.h, 0);
  return true;
};

export class TrafficRenderer {
  readonly group = new THREE.Group();
  private view: TrafficView;
  /** what TrafficView reads from a car: the pool is reused every frame, `active` is its first n entries */
  private pool: CarPose[] = [];
  private active: CarPose[] = [];
  private alive = true;

  constructor(
    mats: CarMats,
    private L: Layout,
    cap = 14,
  ) {
    this.view = new TrafficView(mats, cap, false);
    this.group.add(this.view.group);
    for (const [kind, url] of Object.entries(TRAFFIC_GLB) as [AiType, string][]) {
      void loadCar(url).then((m) => {
        if (this.alive && m) this.view.setModel(kind, m);
      });
    }
  }

  update(cars: AiCar[]): void {
    const n = cars.length;
    while (this.pool.length < n) this.pool.push({ kind: "sedan", color: 0, braking: false, len: 4.4, width: 1.8, x: 0, y: 0, z: 0, h: 0 });
    this.active.length = n;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const t = this.pool[i];
      this.active[i] = t;
      t.kind = c.type;
      t.color = c.color;
      t.len = c.len;
      t.width = c.type === "truck" ? 2.5 : c.type === "van" ? 1.95 : 1.85;
      // brake lights: slower than it wants to be, or held at a stop line
      t.braking = c.v < c.vDes - 1 || c.waitT > 0;
      t.x = c.x;
      t.y = bridgeDeckY(this.L, c.x, c.z);
      t.z = c.z;
      t.h = Math.atan2(c.fx, c.fz);
    }
    this.view.update(this.active, poseOf);
  }

  dispose(): void {
    this.alive = false;
    this.view.dispose();
  }
}

/** Pedestrians: one instanced torso+head mesh and two leg meshes that swing. */
export class PedRenderer {
  readonly group = new THREE.Group();
  private upper: THREE.InstancedMesh;
  private legL: THREE.InstancedMesh;
  private legR: THREE.InstancedMesh;
  private geos: THREE.BufferGeometry[] = [];
  static readonly CAP = 24;

  constructor(mats: Mats) {
    const up = new GeoBuilder();
    up.box(0, 0.85, 0, 0.42, 0.62, 0.24, 0xb9c4d0);
    up.box(-0.27, 0.9, 0, 0.1, 0.55, 0.12, 0xb9c4d0);
    up.box(0.27, 0.9, 0, 0.1, 0.55, 0.12, 0xb9c4d0);
    up.blob(0, 1.68, 0, 0.14, 0xdcae82, 1);
    up.box(0, 1.76, 0, 0.26, 0.1, 0.26, 0x2b221c);
    const leg = (x: number): THREE.BufferGeometry => {
      const g = new GeoBuilder();
      g.box(0, -0.85, 0, 0.16, 0.85, 0.18, 0x2c3a4d);
      return g.build().translate(x, 0, 0); // pivot at the hip
    };
    const gu = up.build();
    const gl = leg(-0.1);
    const gr = leg(0.1);
    this.geos.push(gu, gl, gr);
    this.upper = new THREE.InstancedMesh(gu, mats.trim, PedRenderer.CAP);
    this.legL = new THREE.InstancedMesh(gl, mats.trim, PedRenderer.CAP);
    this.legR = new THREE.InstancedMesh(gr, mats.trim, PedRenderer.CAP);
    for (const mesh of [this.upper, this.legL, this.legR]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    this.upper.setColorAt(0, _c.set(0xffffff));
  }

  update(peds: Ped[]): void {
    const n = Math.min(peds.length, PedRenderer.CAP);
    const tints = [0xffffff, 0xffb3a8, 0xa8d4ff, 0xb9f0b0, 0xffe58a, 0xe2b3ff];
    for (let i = 0; i < n; i++) {
      const p = peds[i];
      const y = p.jump > 0 ? Math.sin(p.jump * 5) * 0.3 : 0;
      _o.position.set(p.x, y, p.z);
      _o.rotation.set(0, p.yaw, 0);
      _o.updateMatrix();
      this.upper.setMatrixAt(i, _o.matrix);
      _o.position.set(p.x, y + 0.85, p.z);
      this.upper.setColorAt(i, _c.setHex(tints[Math.floor(p.tint * tints.length) % tints.length]));
      const sw = p.done ? 0 : Math.sin(p.ph) * 0.5;
      _o.rotation.set(sw, p.yaw, 0, "YXZ");
      _o.updateMatrix();
      this.legL.setMatrixAt(i, _o.matrix);
      _o.rotation.set(-sw, p.yaw, 0, "YXZ");
      _o.updateMatrix();
      this.legR.setMatrixAt(i, _o.matrix);
    }
    this.upper.count = this.legL.count = this.legR.count = n;
    this.upper.instanceMatrix.needsUpdate = this.legL.instanceMatrix.needsUpdate = this.legR.instanceMatrix.needsUpdate = true;
    if (this.upper.instanceColor) this.upper.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.upper.dispose();
    this.legL.dispose();
    this.legR.dispose();
  }
}

/** The three lamps of every traffic light head, as one instanced mesh whose instance colours follow the phases. */
export class SignalLamps {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  private lights: Light[];
  private lastSig = "";
  static readonly OFF = [0x330c08, 0x332600, 0x08331a];
  static readonly ON = [0xff2a1a, 0xffb800, 0x2bff7a];

  constructor(L: Layout) {
    this.lights = L.lights;
    this.geo = new THREE.CircleGeometry(0.13, 10);
    this.mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(3, this.lights.length * 3));
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.mesh.count = this.lights.length * 3;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.layout();
  }

  private layout(): void {
    this.lights.forEach((l, i) => {
      const th = Math.atan2(-l.dx, -l.dz);
      for (let k = 0; k < 3; k++) {
        _o.position.set(l.x + Math.sin(th) * 0.3, 3.2 + (1 - k) * 0.37, l.z + Math.cos(th) * 0.3);
        _o.rotation.set(0, th, 0);
        _o.updateMatrix();
        this.mesh.setMatrixAt(i * 3 + k, _o.matrix);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** `colorOf` returns the colour the light shows to its own approach. */
  update(colorOf: (l: Light) => LightColor): void {
    let sig = "";
    const cols: LightColor[] = [];
    for (const l of this.lights) {
      const c = colorOf(l);
      cols.push(c);
      sig += c[0];
    }
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    cols.forEach((c, i) => {
      const lit = c === "red" ? 0 : c === "yellow" ? 1 : 2;
      for (let k = 0; k < 3; k++) this.mesh.setColorAt(i * 3 + k, _c.setHex(k === lit ? SignalLamps.ON[k] : SignalLamps.OFF[k]));
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
