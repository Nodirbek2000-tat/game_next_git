// Visuals of one angler: low-poly figure in the player's colour, the bending rod (one dynamic tube), the reel, the float and
// the fishing line (camera facing ribbon). Created once, nothing is allocated per frame.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { L_NOREFL } from "./water";

export const ROD_LEN = 3.4;
const STATIONS = 16;
const SIDES = 6;

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}

export function makeAnglerGeometry(color: number): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.CapsuleGeometry(0.2, 0.62, 3, 8).translate(0, 1.25, 0), color), // torso
    paint(new THREE.SphereGeometry(0.17, 12, 10).translate(0, 1.93, 0), 0xf0c9a0), // head
    paint(new THREE.CylinderGeometry(0.18, 0.2, 0.09, 10).translate(0, 2.03, 0), color), // cap
    paint(new THREE.CylinderGeometry(0.075, 0.07, 0.8, 7).translate(-0.1, 0.4, 0), 0x2b3a55), // legs
    paint(new THREE.CylinderGeometry(0.075, 0.07, 0.8, 7).translate(0.1, 0.4, 0), 0x2b3a55),
    paint(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6).rotateX(Math.PI / 2.4).translate(0.26, 1.35, -0.18), color), // arms reaching to the rod
    paint(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6).rotateX(Math.PI / 2.4).translate(-0.26, 1.35, -0.18), color),
  ];
  return mergeGeometries(parts)!;
}

const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A capsule from a to b (view frame coordinates), painted. */
function capsuleBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, 8);
  _q.setFromUnitVectors(WORLD_UP, _b.copy(b).sub(a).normalize());
  g.applyQuaternion(_q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, hex);
}

/**
 * The player's own arms in first person, in the VIEW frame (x right, y up, -z forward; the camera is the origin): the rod
 * hand holds the grip, the other hand turns the reel. One merged mesh, `lefty` mirrors it. Grip at (0.30, -0.33, -0.70).
 */
export function makeArmsGeometry(color: number, lefty = false): THREE.BufferGeometry {
  const m = lefty ? -1 : 1;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x * m, y, z);
  const skin = 0xf0c9a0;
  const parts = [
    capsuleBetween(v(0.62, -1.05, 0.2), v(0.33, -0.39, -0.65), 0.045, color),
    paint(new THREE.SphereGeometry(0.048, 10, 8).translate(0.31 * m, -0.34, -0.70), skin),
    capsuleBetween(v(-0.55, -1.05, 0.2), v(0.2, -0.5, -0.64), 0.043, color),
    paint(new THREE.SphereGeometry(0.046, 10, 8).translate(0.19 * m, -0.46, -0.68), skin),
  ];
  return mergeGeometries(parts)!;
}

/** Float: coloured top, white bottom, thin antenna. */
export function makeFloatGeometry(color: number): THREE.BufferGeometry {
  const top = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const ant = new THREE.CylinderGeometry(0.009, 0.012, 0.28, 6).translate(0, 0.2, 0);
  const tip = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6).translate(0, 0.34, 0);
  return mergeGeometries([paint(top, color), paint(bot, 0xf4f4f4), paint(ant, 0xe8e8e8), paint(tip, 0xff3b1a)])!;
}

const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const _px = new THREE.Vector3();
const _sx = new THREE.Vector3();
const _ux = new THREE.Vector3();
const _dx = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** A rod: one dynamic tube bent along a curve, a handle, and a reel with a rotating crank. */
export class RodMesh {
  readonly group = new THREE.Group();
  readonly blank: THREE.Mesh;
  readonly handle: THREE.Mesh;
  readonly reel: THREE.Mesh;
  readonly crank: THREE.Group;
  /** world-space tip position of the last update() */
  readonly tip = new THREE.Vector3();
  /** centre line stations (x, y, z) */
  readonly pts = new Float32Array(STATIONS * 3);
  private pos: THREE.BufferAttribute;
  private mats: THREE.Material[] = [];
  /** per station: side and up vectors of the bent blank (for the guides) */
  private sides = new Float32Array(STATIONS * 3);
  private ups = new Float32Array(STATIONS * 3);
  /** the rod frame of the last update (x side, y along the rod, z up; origin at the grip) */
  readonly frame = new THREE.Matrix4();
  model: RodModel | null = null;
  /** mirrored set (left-handed player) */
  mirror = false;

  constructor(handColor = 0x1b2633) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(STATIONS * SIDES * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(STATIONS * SIDES * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < STATIONS - 1; i++) for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
    }
    g.setIndex(idx);
    const blankMat = new THREE.MeshStandardMaterial({ color: handColor, metalness: 0.35, roughness: 0.4 });
    this.blank = new THREE.Mesh(g, blankMat);
    this.blank.frustumCulled = false;
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.9 });
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.5, 8).translate(0, 0.25, 0), corkMat);
    const reelMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.8, roughness: 0.3 });
    this.reel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 14).rotateZ(Math.PI / 2), reelMat);
    this.crank = new THREE.Group();
    const armMat = new THREE.MeshStandardMaterial({ color: 0xc0c6d0, metalness: 0.9, roughness: 0.3 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xd84315 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.014).translate(0, 0.04, 0), armMat);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 8).rotateZ(Math.PI / 2).translate(0.018, 0.08, 0), knobMat);
    this.crank.add(arm, knob);
    this.group.add(this.blank, this.handle, this.reel, this.crank);
    for (const o of this.group.children) o.layers.set(L_NOREFL);
    this.crank.children.forEach((c) => c.layers.set(L_NOREFL));
    this.mats.push(blankMat, corkMat, reelMat, armMat, knobMat);
  }

  /**
   * Pose the rod. (gx,gy,gz) grip; yaw (rad, + = right), pitch (rad above horizontal); bend (0..~1.2) curves the blank
   * downward towards the tip; bendYaw adds a sideways bend (towards where the fish pulls).
   */
  update(gx: number, gy: number, gz: number, yaw: number, pitch: number, bend: number, bendYaw: number, reelAngle: number): void {
    const n = STATIONS;
    const step = ROD_LEN / (n - 1);
    let x = gx;
    let y = gy;
    let z = gz;
    const pos = this.pos.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const p = pitch - bend * f * f * 0.95;
      const yw = yaw + bendYaw * f * f;
      const cp = Math.cos(p);
      tmpDir.set(Math.sin(yw) * cp, Math.sin(p), -Math.cos(yw) * cp);
      this.pts[i * 3] = x;
      this.pts[i * 3 + 1] = y;
      this.pts[i * 3 + 2] = z;
      tmpSide.crossVectors(tmpDir, WORLD_UP);
      if (tmpSide.lengthSq() < 1e-6) tmpSide.set(1, 0, 0);
      tmpSide.normalize();
      tmpUp.crossVectors(tmpSide, tmpDir).normalize();
      this.sides[i * 3] = tmpSide.x;
      this.sides[i * 3 + 1] = tmpSide.y;
      this.sides[i * 3 + 2] = tmpSide.z;
      this.ups[i * 3] = tmpUp.x;
      this.ups[i * 3 + 1] = tmpUp.y;
      this.ups[i * 3 + 2] = tmpUp.z;
      const r = 0.0118 * (1 - f) + 0.0028 * f;
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const c = Math.cos(a) * r;
        const s = Math.sin(a) * r;
        const o = (i * SIDES + j) * 3;
        pos[o] = x + tmpSide.x * c + tmpUp.x * s;
        pos[o + 1] = y + tmpSide.y * c + tmpUp.y * s;
        pos[o + 2] = z + tmpSide.z * c + tmpUp.z * s;
      }
      x += tmpDir.x * step;
      y += tmpDir.y * step;
      z += tmpDir.z * step;
    }
    this.tip.set(this.pts[(n - 1) * 3], this.pts[(n - 1) * 3 + 1], this.pts[(n - 1) * 3 + 2]);
    this.pos.needsUpdate = true;
    // handle: along the first station's direction, a bit behind the grip
    const cp0 = Math.cos(pitch);
    tmpDir.set(Math.sin(yaw) * cp0, Math.sin(pitch), -Math.cos(yaw) * cp0);
    this.handle.position.set(gx - tmpDir.x * 0.35, gy - tmpDir.y * 0.35, gz - tmpDir.z * 0.35);
    this.handle.quaternion.setFromUnitVectors(WORLD_UP, tmpDir);
    tmpSide.crossVectors(tmpDir, WORLD_UP).normalize();
    tmpUp.crossVectors(tmpSide, tmpDir).normalize();
    this.reel.position.set(gx + tmpDir.x * 0.1 - tmpUp.x * 0.07, gy + tmpDir.y * 0.1 - tmpUp.y * 0.07, gz + tmpDir.z * 0.1 - tmpUp.z * 0.07);
    this.reel.quaternion.setFromUnitVectors(WORLD_UP, tmpDir);
    this.crank.position.copy(this.reel.position).addScaledVector(tmpSide, 0.035);
    this.crank.quaternion.setFromUnitVectors(WORLD_UP, tmpDir);
    // spin the crank around the reel axis (local x = side)
    this.crank.rotateX(reelAngle);
    // the rod frame (the Blender parts are modelled in it)
    this.frame.makeBasis(tmpSide, tmpDir, tmpUp).setPosition(gx, gy, gz);
    if (this.mirror) this.frame.multiply(MIRROR);
    this.model?.pose(this, reelAngle);
  }

  /** frame of the blank at fraction f (0 grip .. 1 tip): position, side, up */
  stationFrame(f: number, out: THREE.Matrix4, scale: number): THREE.Matrix4 {
    const x = f * (STATIONS - 1);
    const i = Math.min(STATIONS - 2, Math.floor(x));
    const t = x - i;
    const L = (k: Float32Array, c: number): number => k[i * 3 + c] * (1 - t) + k[(i + 1) * 3 + c] * t;
    const p = this.pts;
    _px.set(L(p, 0), L(p, 1), L(p, 2));
    _sx.set(L(this.sides, 0), L(this.sides, 1), L(this.sides, 2)).normalize();
    _ux.set(L(this.ups, 0), L(this.ups, 1), L(this.ups, 2)).normalize();
    _dx.crossVectors(_ux, _sx).normalize();
    out.makeBasis(_sx.multiplyScalar(scale), _dx.multiplyScalar(scale), _ux.multiplyScalar(scale)).setPosition(_px);
    if (this.mirror) out.multiply(MIRROR);
    return out;
  }

  /** Swap the procedural handle / reel for the Blender set (rod.glb) once it is loaded. */
  useModel(m: RodModel): void {
    this.model = m;
    this.handle.visible = this.reel.visible = this.crank.visible = false;
    this.group.add(m.group);
  }

  /** Recompute lighting normals now and then (the tube bends). */
  fixNormals(): void {
    this.blank.geometry.computeVertexNormals();
  }
}

/** Fishing line drawn as a camera-facing ribbon (2 vertices per Verlet point). */
export class LineRibbon {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private n: number;
  readonly material: THREE.MeshBasicMaterial;
  private t = new THREE.Vector3();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(points: number) {
    this.n = points;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(points * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    const idx: number[] = [];
    for (let i = 0; i < points - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.material = new THREE.MeshBasicMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(L_NOREFL);
    this.mesh.renderOrder = 5;
  }

  update(x: Float32Array, y: Float32Array, z: Float32Array, cam: THREE.Camera): void {
    const a = this.pos.array as Float32Array;
    const n = this.n;
    const cp = cam.position;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      this.t.set(x[i1] - x[i0], y[i1] - y[i0], z[i1] - z[i0]).normalize();
      this.v.set(cp.x - x[i], cp.y - y[i], cp.z - z[i]);
      const d = this.v.length();
      this.v.divideScalar(d || 1);
      this.s.crossVectors(this.t, this.v);
      if (this.s.lengthSq() < 1e-8) this.s.set(0, 1, 0);
      this.s.normalize();
      const w = 0.006 + d * 0.0011;
      const o = i * 6;
      a[o] = x[i] - this.s.x * w;
      a[o + 1] = y[i] - this.s.y * w;
      a[o + 2] = z[i] - this.s.z * w;
      a[o + 3] = x[i] + this.s.x * w;
      a[o + 4] = y[i] + this.s.y * w;
      a[o + 5] = z[i] + this.s.z * w;
    }
    this.pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the Blender rod set + hands (tools/blender/baliq_rod.py)

/** constants of baliq_rod.py (rod frame, metres) */
const REEL_AXIS = new THREE.Vector3(-0.004, 0, -0.088);
const KNOB = new THREE.Vector3(-0.058, 0, 0.05);
const WRIST_R = new THREE.Vector3(0.05, -0.1, 0.022);
const WRIST_L = new THREE.Vector3(-0.084, -0.0134, 0.0414);
const GUIDES = [0.07, 0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.84, 0.995];
const UPPER = 0.31;
const FORE = 0.29;

let rodGltf: Promise<THREE.Object3D | null> | null = null;
function loadRodGltf(): Promise<THREE.Object3D | null> {
  rodGltf ??= import("three/examples/jsm/loaders/GLTFLoader.js")
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync("/models/baliq-ovi/rod.glb"))
    .then((g) => g.scene)
    .catch(() => null);
  return rodGltf;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _e = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/** A sleeve from a to b (the mesh runs y 0..1). */
function placeSleeve(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thick: number): void {
  _v.subVectors(b, a);
  const len = _v.length();
  _q2.setFromUnitVectors(Y, _v.divideScalar(len || 1));
  mesh.position.copy(a);
  mesh.quaternion.copy(_q2);
  mesh.scale.set(thick, len, thick);
}

/**
 * Two-bone IK: elbow between shoulder s and wrist w (bones UPPER, FORE), bending towards `pole`.
 * The shoulder slides towards the wrist when the arm would have to stretch (it is off screen).
 */
function solveElbow(s: THREE.Vector3, w: THREE.Vector3, pole: THREE.Vector3, out: THREE.Vector3): void {
  _a.subVectors(w, s);
  let d = _a.length();
  const max = (UPPER + FORE) * 0.985;
  if (d > max) {
    s.addScaledVector(_a, (d - max) / d);
    d = max;
  }
  _a.divideScalar(d || 1);
  const x = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - x * x));
  _e.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
  out.copy(s).addScaledVector(_a, x).addScaledVector(_e, h);
}

export class RodModel {
  readonly group = new THREE.Group();
  private handle: THREE.Object3D;
  private reel: THREE.Object3D;
  private crank: THREE.Object3D;
  private guides: THREE.Object3D[] = [];
  private handR: THREE.Object3D;
  private handL: THREE.Object3D;
  private sleeves: THREE.Mesh[] = [];
  private shoulderR = new THREE.Vector3();
  private shoulderL = new THREE.Vector3();
  private elbow = new THREE.Vector3();
  private wrist = new THREE.Vector3();
  private knob = new THREE.Vector3();

  static async load(sleeveColor: number): Promise<RodModel | null> {
    const root = await loadRodGltf();
    return root ? new RodModel(root, sleeveColor) : null;
  }

  private constructor(root: THREE.Object3D, sleeveColor: number) {
    const get = (n: string): THREE.Object3D => {
      const o = root.getObjectByName(n);
      if (!o) throw new Error("rod.glb: " + n);
      const c = o.clone();
      c.position.set(0, 0, 0);
      c.quaternion.identity();
      c.scale.set(1, 1, 1);
      c.matrixAutoUpdate = false;
      return c;
    };
    this.handle = get("handle");
    this.reel = get("reel");
    this.crank = get("crank");
    this.handR = get("hand_r");
    this.handL = get("hand_l");
    const guide = get("guide");
    for (let i = 0; i < GUIDES.length; i++) this.guides.push(i ? guide.clone() : guide);
    const sl = root.getObjectByName("sleeve") as THREE.Mesh;
    const cloth = (sl.material as THREE.MeshStandardMaterial).clone();
    cloth.side = THREE.DoubleSide;
    // a dark jacket in the player's colour
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(sleeveColor).getHSL(hsl);
    cloth.color.setHSL(hsl.h, hsl.s * 0.4, 0.42);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(sl.geometry, cloth);
      m.frustumCulled = false;
      this.sleeves.push(m);
    }
    this.group.add(this.handle, this.reel, this.crank, this.handR, this.handL, ...this.guides, ...this.sleeves);
    // the hands / sleeves stay in the file but are not shown (only the rod set is drawn)
    this.shoulders(null, null);
    this.group.traverse((o) => {
      o.layers.set(L_NOREFL);
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) m.envMapIntensity = 0.8;
    });
  }

  /** shoulders (world) for the arms: set by the game from the camera every frame; null = no arms */
  shoulders(right: THREE.Vector3 | null, left: THREE.Vector3 | null): void {
    if (right) this.shoulderR.copy(right);
    if (left) this.shoulderL.copy(left);
    for (const s of this.sleeves) s.visible = !!(right && left);
    this.handR.visible = this.handL.visible = !!(right && left);
  }

  pose(rod: RodMesh, reelAngle: number): void {
    const F = rod.frame;
    for (const o of [this.handle, this.reel, this.handR]) o.matrix.copy(F);
    // crank: about the reel axis
    _m.makeRotationX(reelAngle).setPosition(REEL_AXIS);
    this.crank.matrix.multiplyMatrices(F, _m);
    // left hand on the knob (keeps the rod frame's orientation, follows the knob around)
    this.knob.copy(KNOB).applyMatrix4(_m);
    _m2.makeTranslation(this.knob.x, this.knob.y, this.knob.z);
    this.handL.matrix.multiplyMatrices(F, _m2);
    GUIDES.forEach((f, i) => rod.stationFrame(f, this.guides[i].matrix, 1.15 - 0.55 * f));
    for (const o of [this.handle, this.reel, this.crank, this.handR, this.handL, ...this.guides]) o.matrixWorldNeedsUpdate = true;
    if (!this.sleeves[0].visible) return;
    // arms: shoulder -> elbow -> wrist, elbows down and out
    // column 0 of the frame is the rod hand's outer side (mirrored for a left-handed player)
    const sideSign = 1;
    _w.set(F.elements[0], F.elements[1], F.elements[2]).normalize();
    // right arm
    this.wrist.copy(WRIST_R).applyMatrix4(F);
    _pole.set(0, -1, 0).addScaledVector(_w, 0.7 * sideSign);
    const sR = this.shoulderR;
    solveElbow(sR, this.wrist, _pole, this.elbow);
    placeSleeve(this.sleeves[0], sR, this.elbow, 1.12);
    placeSleeve(this.sleeves[1], this.elbow, this.wrist, 0.92);
    // left arm
    this.wrist.copy(this.knob).add(WRIST_L).applyMatrix4(F);
    _pole.set(0, -1, 0).addScaledVector(_w, -0.7 * sideSign);
    const sL = this.shoulderL;
    solveElbow(sL, this.wrist, _pole, this.elbow);
    placeSleeve(this.sleeves[2], sL, this.elbow, 1.12);
    placeSleeve(this.sleeves[3], this.elbow, this.wrist, 0.92);
  }
}
