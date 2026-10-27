import * as THREE from "three";
import { clamp } from "@/engine/math";

export type CamMode = "chase" | "cockpit";

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Vector3();

/** Chase camera (behind and above, lagging a little behind the heading so drifts are visible) and cockpit camera. */
export class CameraRig {
  mode: CamMode = "chase";
  private dir = new THREE.Vector3(0, 0, 1);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  private t = 0;
  private fov = 60;
  private ready = false;

  constructor(private cam: THREE.PerspectiveCamera) {}

  get camera(): THREE.PerspectiveCamera {
    return this.cam;
  }

  toggle(): CamMode {
    this.mode = this.mode === "chase" ? "cockpit" : "chase";
    return this.mode;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  snap(): void {
    this.ready = false;
  }

  /** @param px,py,pz car position; (fx,fz) forward, (vx,vz) velocity; q chassis rotation */
  update(dt: number, px: number, py: number, pz: number, fx: number, fz: number, vx: number, vz: number, speed: number, q: { x: number; y: number; z: number; w: number }): void {
    this.t += dt;
    const sp = Math.hypot(vx, vz);
    // direction the camera looks along: mostly the car's nose, a bit towards the velocity at speed (shows the slide)
    let tx = fx;
    let tz = fz;
    if (sp > 6 && speed > 0) {
      const k = clamp((sp - 6) / 20, 0, 0.35);
      tx = fx * (1 - k) + (vx / sp) * k;
      tz = fz * (1 - k) + (vz / sp) * k;
    }
    const tl = Math.hypot(tx, tz) || 1;
    if (!this.ready) this.dir.set(tx / tl, 0, tz / tl);
    else {
      const k = 1 - Math.exp(-dt * (this.mode === "chase" ? 4.5 : 12));
      this.dir.x += (tx / tl - this.dir.x) * k;
      this.dir.z += (tz / tl - this.dir.z) * k;
      this.dir.normalize();
    }
    const cam = this.cam;
    if (this.mode === "chase") {
      const back = 7.0 + clamp(sp / 20, 0, 1.4);
      _p.set(px - this.dir.x * back, py + 2.9 + clamp(sp / 60, 0, 0.5), pz - this.dir.z * back);
      _l.set(px + this.dir.x * 11, py + 0.9, pz + this.dir.z * 11);
      if (!this.ready) {
        this.pos.copy(_p);
        this.look.copy(_l);
      } else {
        const k = 1 - Math.exp(-dt * 7);
        this.pos.lerp(_p, k);
        this.look.lerp(_l, 1 - Math.exp(-dt * 10));
      }
    } else {
      _q.set(q.x, q.y, q.z, q.w);
      _e.set(0.36, 0.62, 0.1).applyQuaternion(_q);
      this.pos.set(px + _e.x, py + _e.y, pz + _e.z);
      _f.set(this.dir.x, 0, this.dir.z);
      this.look.set(this.pos.x + _f.x * 30, this.pos.y - 0.15, this.pos.z + _f.z * 30);
    }
    this.ready = true;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += Math.sin(this.t * 61) * s;
      cam.position.y += Math.sin(this.t * 73 + 1) * s * 0.7;
      cam.position.z += Math.cos(this.t * 57) * s;
      this.shake *= Math.exp(-dt * 5);
    }
    cam.lookAt(this.look);
    const fov = this.mode === "chase" ? 60 + clamp(sp * 0.35, 0, 16) : 72 + clamp(sp * 0.2, 0, 8);
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.15 || cam.near !== 0.2) {
      cam.fov = this.fov;
      cam.near = 0.2;
      cam.far = 1500;
      cam.updateProjectionMatrix();
    }
  }
}
