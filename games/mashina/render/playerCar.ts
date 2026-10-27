import * as THREE from "three";
import type { CarSpec } from "../config";
import type { RaycastCar } from "../physics/vehicle";
import { carParts, rideHeight, type CarParts } from "./carModel";
import type { Mats } from "./materials";

/**
 * The player's car: paint / trim / lamps meshes and four wheels. The wheels follow the raycast suspension (travel),
 * steering and spin. If a GLB model is available (assets.json) it replaces the procedural body; the wheels stay.
 */
export class PlayerCar {
  readonly group = new THREE.Group();
  private model = new THREE.Group();
  private body: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  private custom: THREE.Object3D | null = null;
  private parts: CarParts | null = null;
  spec: CarSpec | null = null;
  private spin = [0, 0, 0, 0];

  constructor(private mats: Mats) {
    this.group.add(this.model);
    this.group.matrixAutoUpdate = true;
  }

  /** Switch to another car (spec) and paint. */
  set(spec: CarSpec, color: string): void {
    this.spec = spec;
    this.clear();
    const p = carParts(spec.id);
    this.parts = p;
    this.mats.paint.color.set(color);
    const paint = new THREE.Mesh(p.paint, this.mats.paint);
    const trim = new THREE.Mesh(p.trim, this.mats.trim);
    const lamps = new THREE.Mesh(p.lamps, this.mats.lamps);
    for (const m of [paint, trim, lamps]) {
      m.castShadow = true;
      this.body.push(m);
      this.model.add(m);
    }
    this.model.position.y = -rideHeight(spec);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(p.wheel, this.mats.trim);
      w.castShadow = true;
      w.rotation.order = "YXZ";
      this.wheels.push(w);
      this.group.add(w);
    }
  }

  /** Attach a loaded GLB scene (already scaled/oriented to face +z) in place of the procedural body. */
  useModel(obj: THREE.Object3D): void {
    this.custom?.removeFromParent();
    this.custom = obj;
    this.model.add(obj);
    for (const m of this.body) m.visible = false;
  }

  private clear(): void {
    for (const m of this.body) this.model.remove(m);
    for (const w of this.wheels) this.group.remove(w);
    this.body = [];
    this.wheels = [];
    this.custom?.removeFromParent();
    this.custom = null;
    this.spin.fill(0);
  }

  setVisible(body: boolean): void {
    for (const m of this.body) m.visible = body && !this.custom;
    if (this.custom) this.custom.visible = body;
  }

  /** Copy the physics pose to the meshes. */
  update(car: RaycastCar): void {
    const s = this.spec;
    if (!s) return;
    const t = car.body.translation();
    const q = car.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
    const hy = -s.half[1] * 0.4;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w) continue;
      const x = i % 2 === 0 ? s.trackHalf : -s.trackHalf;
      const z = i < 2 ? s.wheelBase / 2 : -s.wheelBase / 2;
      // suspension length from the controller; wheel centre hangs below the hard point
      w.position.set(x + (x > 0 ? 0.06 : -0.06), hy - car.wheelSusp[i], z);
      this.spin[i] = car.wheelSpin[i];
      w.rotation.set(-this.spin[i], i < 2 ? -car.steerAngle : 0, 0);
    }
  }

  dispose(): void {
    this.clear();
    this.parts = null;
  }
}
