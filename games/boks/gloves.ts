import * as THREE from "three";
import { type Lod } from "./config";
import { makeMat } from "./partner3d";
import { type View, pxToWorld } from "./space";

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------ the player's gloves

/**
 * The player's own gloves in first person: red = left hand, blue = right hand. Each glove sits on the camera ray through the
 * on-screen point `(px, py)` the hand maps to; the further the arm is stretched, the further away (and smaller) the glove, so
 * a punch visibly goes into the picture and lands on the pad. The fist points along the ray (+z of the group).
 */
export class PlayerGloves {
  readonly group = new THREE.Group();
  private g: THREE.Group[] = [];
  /** 0..1 how far each arm is stretched (smoothed) */
  private ext = [0, 0];
  private pulse = [0, 0];
  private seen = [0, 0];
  private p = { x: 0, y: 0, z: 0 };
  private tmp = new THREE.Vector3();

  constructor(lod: Lod) {
    const seg = lod.seg;
    const cols = [0xd5202c, 0x1e63d6];
    const white = makeMat(lod, 0xf4f1e8, 0.6);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const mat = makeMat(lod, cols[i], 0.32, 0.12);
      const g = new THREE.Group();
      // fist along +z, cuff towards the camera
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.1, seg, seg - 2), mat);
      fist.scale.set(1, 0.95, 1.25);
      fist.position.z = 0.05;
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat);
      thumb.scale.set(0.8, 1, 1.4);
      thumb.position.set(-sx * 0.09, -0.01, 0.0);
      // back of the hand (closed, towards the camera) and a thin white band around it, where the wrist goes in
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.085, seg, seg - 2), mat);
      back.position.z = -0.04;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 24), white);
      cuff.position.z = -0.09;
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), makeMat(lod, 0xffffff, 0.3, 0, 0x222222));
      knuckle.scale.set(1.2, 0.5, 0.5);
      knuckle.position.set(0, 0.045, 0.14);
      g.add(fist, back, thumb, cuff, knuckle);
      g.visible = false;
      this.g.push(g);
      this.group.add(g);
    }
  }

  /** a glove landed: it swells for a moment */
  bump(i: 0 | 1): void {
    this.pulse[i] = 1;
  }

  /**
   * place glove `i` at the on-screen point `(px, py)`; `ext` is the stretch of the arm 0..1, `live` forces the glove forward
   * (a punch in flight); `tracked` false hides it after a short grace time.
   */
  update(dt: number, v: View, i: 0 | 1, px: number, py: number, ext: number, live: boolean, tracked: boolean, now: number): void {
    const g = this.g[i];
    if (tracked) this.seen[i] = now;
    if (!tracked && now - this.seen[i] > 0.25) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const target = live ? 1 : ext;
    const k = 1 - Math.exp(-dt * (target > this.ext[i] ? 26 : 9));
    this.ext[i] += (target - this.ext[i]) * k;
    this.pulse[i] = Math.max(0, this.pulse[i] - dt * 5);
    const depth = 0.62 + 0.85 * this.ext[i];
    const p = pxToWorld(v, px, py, depth, this.p);
    g.position.set(p.x, p.y, p.z);
    // the fist points away along the camera ray
    this.tmp.set(p.x + (p.x - v.x), p.y + (p.y - v.y), p.z + (p.z - v.z));
    g.lookAt(this.tmp);
    g.rotateZ((i === 0 ? 0.35 : -0.35) * (1 - this.ext[i] * 0.7));
    const s = 1 + this.pulse[i] * 0.28;
    g.scale.set(s, s, s);
  }
}

// ------------------------------------------------------------------------------------------------ the pads

function padTexture(side: "L" | "R"): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d");
  const col = side === "L" ? "#ff3b5c" : "#2fa8ff";
  if (c) {
    const mid = 128;
    c.fillStyle = col;
    c.fillRect(0, 0, 256, 256);
    for (const [r, cc] of [
      [0.92, "#ffffff"],
      [0.78, col],
      [0.55, "#ffffff"],
      [0.38, col],
      [0.18, "#ffffff"],
    ] as [number, string][]) {
      c.fillStyle = cc;
      c.beginPath();
      c.arc(mid, mid, mid * r, 0, TAU);
      c.fill();
    }
    c.fillStyle = "#111";
    c.font = "900 64px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(side === "L" ? "CH" : "O‘", mid, mid + 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PadView {
  group: THREE.Group;
  ring: THREE.Mesh;
  /** "in" appearing, "idle" waiting, "out" flying off after a hit, "off" hidden */
  state: "off" | "in" | "idle" | "out";
  t: number;
  life: number;
  /** world centre */
  x: number;
  y: number;
  z: number;
  side: "L" | "R";
  recoil: number;
}

/** Four pooled pads (two per side). The pad is a disc with a target face; a ring around it closes as the time runs out. */
export class PadViews {
  readonly group = new THREE.Group();
  readonly pads: PadView[] = [];

  constructor(lod: Lod) {
    const seg = Math.max(12, lod.seg * 2);
    const texL = padTexture("L");
    const texR = padTexture("R");
    const matL = [makeMat(lod, 0xb0102a, 0.5), new THREE.MeshBasicMaterial({ map: texL }), makeMat(lod, 0x222222, 0.6)];
    const matR = [makeMat(lod, 0x0f5fa0, 0.5), new THREE.MeshBasicMaterial({ map: texR }), makeMat(lod, 0x222222, 0.6)];
    const geo = new THREE.CylinderGeometry(0.2, 0.2, 0.08, seg);
    const ringGeo = new THREE.RingGeometry(0.215, 0.245, seg);
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? "L" : "R";
      const g = new THREE.Group();
      const face = new THREE.Mesh(geo, side === "L" ? matL : matR);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: side === "L" ? 0xff6b81 : 0x6cc4ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.z = 0.06;
      g.add(ring);
      g.visible = false;
      this.group.add(g);
      this.pads.push({ group: g, ring, state: "off", t: 0, life: 1, x: 0, y: 0, z: 0, side, recoil: 0 });
    }
  }

  show(i: number, x: number, y: number, z: number, life: number): void {
    const p = this.pads[i];
    p.state = "in";
    p.t = 0;
    p.life = life;
    p.x = x;
    p.y = y;
    p.z = z;
    p.recoil = 0;
    p.group.visible = true;
    p.group.position.set(x, y, z);
    // tilted a little towards the player, like a pad held out
    p.group.rotation.set(-(y - 1.4) * 0.35, x * 0.5, 0);
  }

  /** the pad was hit: it jumps back and fades; the hand that holds it recoils */
  hit(i: number): void {
    const p = this.pads[i];
    p.state = "out";
    p.t = 0;
    p.recoil = 1;
  }

  hide(i: number): void {
    const p = this.pads[i];
    p.state = "off";
    p.group.visible = false;
  }

  hideAll(): void {
    for (let i = 0; i < this.pads.length; i++) this.hide(i);
  }

  update(dt: number): void {
    for (const p of this.pads) {
      if (p.state === "off") continue;
      p.t += dt;
      p.recoil = Math.max(0, p.recoil - dt * 3);
      if (p.state === "in") {
        const k = Math.min(1, p.t / 0.14);
        const s = 1 - Math.pow(1 - k, 3);
        p.group.scale.setScalar(Math.max(0.01, s));
        if (k >= 1) p.state = "idle";
      }
      if (p.state === "idle" || p.state === "in") {
        // the ring closes from 1.7x to the pad's edge, and pulses a little in the last third
        const left = Math.max(0, 1 - p.t / p.life);
        const pulse = left < 0.33 ? 1 + 0.06 * Math.sin(p.t * 30) : 1;
        p.ring.scale.setScalar((1 + left * 0.7) * pulse);
        (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.55 * (1 - left);
      } else if (p.state === "out") {
        const k = p.t / 0.28;
        if (k >= 1) {
          this.hide(this.pads.indexOf(p));
          continue;
        }
        p.group.position.set(p.x, p.y + k * 0.1, p.z - k * 0.55);
        p.group.rotation.z = k * 2.5;
        p.group.scale.setScalar(1 - k * 0.5);
        p.ring.scale.setScalar(1 + k * 0.6);
        (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      }
    }
  }
}
