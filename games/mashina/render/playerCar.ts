import * as THREE from "three";
import { CARS as POYGA_CARS, TRAFFIC_GLB } from "@/games/poyga/config";
import { loadCar, type CarMats, type CarModel } from "@/games/poyga/models";
import { contactShadow } from "@/games/poyga/views";
import type { CarId, CarSpec } from "../config";
import type { RaycastCar } from "../physics/vehicle";
import { carParts, rideHeight } from "./carModel";

/**
 * Where each of Mashina's cars gets its model: the car files of Shahar simulyatori (the same URLs, so the browser cache is
 * shared and nothing is downloaded twice). The sedan and the crossover are the traffic bodies (wheels are part of the body: they
 * do not turn), the sport car is the Sport GT with four separate wheels that spin, steer and ride on the suspension.
 */
const MODEL: Record<CarId, { glb: string; wheels: { x: number; zf: number; zr: number } | null }> = {
  sedan: { glb: TRAFFIC_GLB.sedan, wheels: null },
  krossover: { glb: TRAFFIC_GLB.krossover, wheels: null },
  sport: { glb: POYGA_CARS.sport.glb, wheels: { x: POYGA_CARS.sport.wheels.x, zf: POYGA_CARS.sport.wheels.zf, zr: POYGA_CARS.sport.wheels.zr } },
};

/**
 * The player's car: body meshes and (for the cars that have them) four wheels. The procedural low-poly body is shown until the
 * model has arrived (and stays if it never does). The wheels follow the raycast suspension (travel), steering and spin; a soft
 * contact shadow lies under the car (there are no real-time shadows).
 */
export class PlayerCar {
  readonly group = new THREE.Group();
  /** soft shadow on the road (a separate object: it must stay flat while the body pitches and rolls) */
  readonly shadow: THREE.Mesh;
  private model = new THREE.Group();
  private body: THREE.Mesh[] = [];
  private wheels: THREE.Group[] = [];
  private wheelX = 0.85;
  private wheelZ: [number, number] = [1.3, -1.3];
  private shadowMat = contactShadow();
  private shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private token = 0;
  private alive = true;
  spec: CarSpec | null = null;
  private spin = [0, 0, 0, 0];

  constructor(private mats: CarMats) {
    this.group.add(this.model);
    this.shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    this.shadow.renderOrder = -1;
    this.shadow.frustumCulled = false;
  }

  /** Switch to another car (spec) and paint. */
  set(spec: CarSpec, color: string): void {
    this.spec = spec;
    this.mats.paint.color.set(color);
    this.clear();
    const t = ++this.token;
    this.standIn(spec);
    this.shadow.scale.set(spec.half[0] * 2 + 0.75, 1, spec.half[2] * 2 + 0.5);
    const entry = MODEL[spec.id];
    void loadCar(entry.glb).then((m) => {
      if (!this.alive || t !== this.token || !m) return;
      this.useModel(m, entry.wheels, spec);
    });
  }

  /** The procedural body (the cached parts of carModel.ts, shared with the traffic stand-ins: not disposed here). */
  private standIn(spec: CarSpec): void {
    const p = carParts(spec.id);
    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [p.paint, this.mats.paint],
      [p.trim, this.mats.matte],
      [p.lamps, this.mats.lamp],
    ];
    for (const [g, m] of parts) {
      const mesh = new THREE.Mesh(g, m);
      this.body.push(mesh);
      this.model.add(mesh);
    }
    this.model.position.y = -rideHeight(spec);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      w.rotation.order = "YXZ";
      w.add(new THREE.Mesh(p.wheel, this.mats.matte));
      this.wheels.push(w);
      this.group.add(w);
    }
    this.wheelX = spec.trackHalf + 0.06;
    this.wheelZ = [spec.wheelBase / 2, -spec.wheelBase / 2];
  }

  private useModel(m: CarModel, layout: { x: number; zf: number; zr: number } | null, spec: CarSpec): void {
    this.clear();
    for (const p of m.body) {
      const mesh = new THREE.Mesh(p.geo, this.mats.of(p.role));
      this.body.push(mesh);
      this.model.add(mesh);
    }
    this.model.position.y = -rideHeight(spec);
    if (layout && m.wheel.length) {
      for (let i = 0; i < 4; i++) {
        const w = new THREE.Group();
        w.rotation.order = "YXZ";
        // the model's wheel faces +x; the right side is mirrored
        if (i % 2 === 1) w.scale.x = -1;
        for (const p of m.wheel) w.add(new THREE.Mesh(p.geo, this.mats.of(p.role)));
        this.wheels.push(w);
        this.group.add(w);
      }
      this.wheelX = layout.x;
      this.wheelZ = [layout.zf, layout.zr];
    }
  }

  /** Remove the current body and wheels (the geometry of a loaded model is cached by poyga/models.ts; the stand-in's is shared). */
  private clear(): void {
    for (const m of this.body) this.model.remove(m);
    for (const w of this.wheels) this.group.remove(w);
    this.body = [];
    this.wheels = [];
    this.spin.fill(0);
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
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const x = i % 2 === 0 ? this.wheelX : -this.wheelX;
      const z = i < 2 ? this.wheelZ[0] : this.wheelZ[1];
      // suspension length from the controller; the wheel centre hangs below the hard point
      w.position.set(x, hy - car.wheelSusp[i], z);
      this.spin[i] = car.wheelSpin[i];
      w.rotation.set(-this.spin[i], i < 2 ? -car.steerAngle : 0, 0);
    }
    // the shadow lies on the road under the car (yaw only)
    this.shadow.position.set(t.x, t.y - rideHeight(s) + 0.03, t.z);
    this.shadow.rotation.y = Math.atan2(car.fx, car.fz);
  }

  dispose(): void {
    this.alive = false;
    this.clear();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
  }
}
