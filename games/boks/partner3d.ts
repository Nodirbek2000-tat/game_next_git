import * as THREE from "three";
import { type PartnerAnim, ik2 } from "./anim";
import { type Lod, PARTNER_Z } from "./config";

type Mat = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/** one material: Standard on medium / high, the cheaper Lambert on low */
export function makeMat(lod: Lod, color: number, rough = 0.7, metal = 0, emissive = 0): Mat {
  if (lod.lambert) return new THREE.MeshLambertMaterial({ color, emissive });
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
}

// body proportions (metres, partner-local, y up, facing +z)
const PELVIS_Y = 0.9;
const TORSO_Y = 0.1;
const SHOULDER_X = 0.21;
const SHOULDER_Y = 0.47;
const UPPER = 0.33;
const FORE = 0.31;
const THIGH = 0.45;
const SHIN = 0.43;
const HIP_X = 0.1;
const DOWN = new THREE.Vector3(0, -1, 0);

interface Limb {
  top: THREE.Group;
  low: THREE.Group;
}

/**
 * The sparring partner: a boxer made of a few dozen simple shapes (capsules, spheres, boxes), about 1.78 m tall. The arms and
 * legs are two-bone IK chains: `apply` takes the numbers of a PartnerAnim (body, head, hand and foot targets) and sets the
 * joints. Nothing is allocated per frame.
 */
export class PartnerRig {
  readonly group = new THREE.Group();
  private pelvis = new THREE.Group();
  private torso = new THREE.Group();
  private headG = new THREE.Group();
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private gloveMats: Mat[] = [];
  private out = new Float64Array(6);
  private v = new THREE.Vector3();
  private d1 = new THREE.Vector3();
  private d2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();

  constructor(lod: Lod, shadows: boolean) {
    const seg = lod.seg;
    const skin = makeMat(lod, 0xc98d63, 0.7);
    const trunks = makeMat(lod, 0xf4f1e8, 0.6);
    const band = makeMat(lod, 0xd9a40a, 0.5);
    const hair = makeMat(lod, 0x1b1410, 0.9);
    const dark = makeMat(lod, 0x0c0c0e, 0.5);
    const white = makeMat(lod, 0xffffff, 0.6);
    const shoe = makeMat(lod, 0x1a1a1f, 0.6);
    const cap = Math.max(3, Math.round(seg / 3));
    this.group.add(this.pelvis);
    this.pelvis.position.y = PELVIS_Y;

    const mesh = (g: THREE.BufferGeometry, m: Mat, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = shadows;
      parent.add(o);
      return o;
    };
    const capsule = (r: number, total: number): THREE.CapsuleGeometry => new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), cap, seg);

    // ---- hips: trunks with a gold waistband
    const hips = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, seg), trunks, this.pelvis, 0, -0.02, 0);
    hips.scale.set(1.12, 1, 0.85);
    const wb = mesh(new THREE.CylinderGeometry(0.182, 0.182, 0.05, seg), band, this.pelvis, 0, 0.12, 0);
    wb.scale.set(1.12, 1, 0.85);

    // ---- torso (leans / twists about the hips)
    this.pelvis.add(this.torso);
    this.torso.position.y = TORSO_Y;
    const abs = mesh(capsule(0.145, 0.34), skin, this.torso, 0, 0.14, 0);
    abs.scale.set(1.08, 1, 0.82);
    const chest = mesh(capsule(0.175, 0.4), skin, this.torso, 0, 0.34, 0);
    chest.scale.set(1.3, 1, 0.82);
    mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.12, Math.max(6, seg - 2)), skin, this.torso, 0, 0.56, 0);
    for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.075, seg, cap + 1), skin, this.torso, sx * SHOULDER_X, SHOULDER_Y, 0);

    // ---- head
    this.torso.add(this.headG);
    this.headG.position.y = 0.66;
    const head = mesh(new THREE.SphereGeometry(0.115, seg, seg - 2), skin, this.headG);
    head.scale.set(0.95, 1.12, 1.02);
    const jaw = mesh(new THREE.SphereGeometry(0.08, seg, cap + 1), skin, this.headG, 0, -0.07, 0.025);
    jaw.scale.set(1.05, 0.85, 1);
    const cp = mesh(new THREE.SphereGeometry(0.122, seg, Math.max(3, seg / 2), 0, Math.PI * 2, 0, Math.PI * 0.52), hair, this.headG, 0, 0.012, -0.014);
    cp.scale.set(0.97, 1.12, 1.03);
    mesh(new THREE.SphereGeometry(0.022, 6, 5), skin, this.headG, 0, -0.012, 0.118);
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.028, 6, 5), skin, this.headG, sx * 0.108, -0.005, 0);
      ear.scale.set(0.5, 1, 0.8);
      mesh(new THREE.SphereGeometry(0.013, 6, 5), dark, this.headG, sx * 0.04, 0.022, 0.104);
      const brow = mesh(new THREE.BoxGeometry(0.05, 0.011, 0.012), hair, this.headG, sx * 0.04, 0.052, 0.106);
      brow.rotation.z = -sx * 0.18;
    }
    mesh(new THREE.BoxGeometry(0.06, 0.016, 0.012), white, this.headG, 0, -0.062, 0.108);

    // ---- arms: shoulder -> upper arm -> forearm -> glove
    for (const sx of [-1, 1]) {
      const top = new THREE.Group();
      top.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
      this.torso.add(top);
      mesh(capsule(0.05, UPPER), skin, top, 0, -UPPER / 2, 0);
      const low = new THREE.Group();
      low.position.y = -UPPER;
      top.add(low);
      mesh(capsule(0.044, FORE), skin, low, 0, -FORE / 2, 0);
      const gm = makeMat(lod, 0xe2b007, 0.4, 0.1, 0xff2a14);
      (gm as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      this.gloveMats.push(gm);
      const glove = new THREE.Group();
      glove.position.y = -FORE;
      low.add(glove);
      const fist = mesh(new THREE.SphereGeometry(0.105, seg, seg - 2), gm, glove, 0, -0.075, 0);
      fist.scale.set(0.95, 1.1, 1.0);
      const thumb = mesh(new THREE.SphereGeometry(0.045, 8, 6), gm, glove, -sx * 0.085, -0.05, 0.055);
      thumb.scale.set(0.8, 1.2, 1);
      mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.07, Math.max(6, seg - 2)), white, glove, 0, 0.0, 0);
      this.arms.push({ top, low });
    }

    // ---- legs: hip -> thigh -> shin -> shoe
    for (const sx of [-1, 1]) {
      const top = new THREE.Group();
      top.position.set(sx * HIP_X, -0.05, 0);
      this.pelvis.add(top);
      mesh(capsule(0.082, THIGH), skin, top, 0, -THIGH / 2, 0);
      const trunkLeg = mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.26, seg), trunks, top, 0, -0.1, 0);
      trunkLeg.scale.set(1, 1, 1);
      const low = new THREE.Group();
      low.position.y = -THIGH;
      top.add(low);
      mesh(capsule(0.062, SHIN), skin, low, 0, -SHIN / 2, 0);
      const foot = mesh(new THREE.BoxGeometry(0.115, 0.085, 0.27), shoe, low, 0, -SHIN - 0.0, 0.06);
      foot.position.y = -SHIN + 0.0;
      this.legs.push({ top, low });
    }
  }

  /** set the joints from the animation numbers */
  apply(a: PartnerAnim): void {
    const g = this.group;
    g.position.set(a.swayX, a.fallY, PARTNER_Z + a.lunge + a.fallZ);
    g.rotation.x = a.fall;
    this.pelvis.position.y = PELVIS_Y + a.bob;
    this.torso.rotation.set(a.lean, a.twist, a.roll);
    this.headG.rotation.set(a.nod, a.headYaw, 0);
    g.updateMatrixWorld(true);
    const o = this.out;
    const v = this.v;
    // arms (targets are partner-local; the chain lives in the torso's frame)
    for (let i = 0; i < 2; i++) {
      const h = a.hand[i];
      const sg = i === 0 ? -1 : 1;
      v.set(h[0], h[1], h[2]);
      g.localToWorld(v);
      this.torso.worldToLocal(v);
      const sx = sg * SHOULDER_X;
      ik2(sx, SHOULDER_Y, 0, v.x, v.y, v.z, UPPER, FORE, sg * 0.6, -1, -0.25, o);
      this.setLimb(this.arms[i], sx, SHOULDER_Y, 0);
    }
    // legs (pelvis frame: it is only translated)
    const py = PELVIS_Y + a.bob;
    for (let i = 0; i < 2; i++) {
      const f = i === 0 ? a.footL : a.footR;
      const sg = i === 0 ? -1 : 1;
      ik2(sg * HIP_X, -0.05, 0, f[0], f[1] + 0.09 - py, f[2], THIGH, SHIN, 0, 0.15, 1, o);
      this.setLimb(this.legs[i], sg * HIP_X, -0.05, 0);
    }
    // the punching glove glows red while it is loaded
    for (let i = 0; i < 2; i++) (this.gloveMats[i] as THREE.MeshStandardMaterial).emissiveIntensity = i === a.glowHand ? a.glow * 1.5 : 0;
  }

  private setLimb(l: Limb, sx: number, sy: number, sz: number): void {
    const o = this.out;
    this.d1.set(o[0] - sx, o[1] - sy, o[2] - sz).normalize();
    this.q1.setFromUnitVectors(DOWN, this.d1);
    l.top.quaternion.copy(this.q1);
    this.d2.set(o[3] - o[0], o[4] - o[1], o[5] - o[2]).normalize();
    this.q2.setFromUnitVectors(DOWN, this.d2);
    l.low.quaternion.copy(this.q1).invert().multiply(this.q2);
  }

  /** world position of the head's centre, written into `out` */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.headG.updateWorldMatrix(true, false);
    return this.headG.localToWorld(out.set(0, 0, 0));
  }

  /** world position of a glove (for effects), written into `out` */
  gloveWorld(i: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    this.arms[i].low.updateWorldMatrix(true, false);
    out.set(0, -FORE - 0.07, 0);
    return this.arms[i].low.localToWorld(out);
  }
}
