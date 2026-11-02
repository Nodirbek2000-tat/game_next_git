// The 3D partner without a renderer: the scene graph is built and posed, and the world positions of gloves and head are
// checked (the glove must reach the face of the player on a punch and the pad when holding one; a knocked-down partner lies low).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type AnimAttack, type AnimInput, PartnerAnim } from "./anim";
import { CAM, LOD, PARTNER_Z } from "./config";
import { PadViews, PlayerGloves } from "./gloves";
import { PartnerRig } from "./partner3d";
import { newView, worldToPx } from "./space";
import { Arena } from "./world";

const FACE = new THREE.Vector3(CAM.x, CAM.y, CAM.z);
const input = (atk: AnimAttack, over: Partial<AnimInput> = {}): AnimInput => ({
  pad: [
    { on: false, x: 0, y: 0, z: 0, recoil: 0 },
    { on: false, x: 0, y: 0, z: 0, recoil: 0 },
  ],
  attack: atk,
  faceX: 0,
  faceY: CAM.y - 0.02,
  faceZ: CAM.z - PARTNER_Z,
  down: false,
  ...over,
});
const idleAtk = (): AnimAttack => ({ active: false, kind: "straight", from: 1, t: 0, windup: 0.7 });

function make(level: "low" | "medium" | "high"): { rig: PartnerRig; anim: PartnerAnim; scene: THREE.Scene } {
  const rig = new PartnerRig(LOD[level], LOD[level].shadows);
  const scene = new THREE.Scene();
  scene.add(rig.group);
  return { rig, anim: new PartnerAnim(), scene };
}

describe("partner rig", () => {
  for (const level of ["low", "medium", "high"] as const) {
    it(`${level}: a straight punch and a hook arrive at the face of the player`, () => {
      for (const kind of ["straight", "hook"] as const) {
        const { rig, anim } = make(level);
        const atk: AnimAttack = { active: true, kind, from: -1, t: 0, windup: 0.7 };
        const inp = input(atk);
        const g = new THREE.Vector3();
        let t = 0;
        for (let i = 0; i < 20; i++, t += 1 / 60) {
          anim.update(1 / 60, t, inp);
          rig.apply(anim);
        }
        let near = 9;
        let minWind = 9;
        for (atk.t = 0; atk.t < 1.1; atk.t += 1 / 60, t += 1 / 60) {
          anim.update(1 / 60, t, inp);
          rig.apply(anim);
          rig.gloveWorld(0, g);
          if (atk.t < 0.7) minWind = Math.min(minWind, g.z - PARTNER_Z);
          if (atk.t > 0.7) near = Math.min(near, g.distanceTo(FACE));
        }
        // wound up: the glove is pulled back to the shoulder line; struck: within a glove's length of the camera
        expect(minWind).toBeLessThan(0.2);
        expect(near).toBeLessThan(0.75);
      }
    });
  }

  it("holds a pad in the glove", () => {
    const { rig, anim } = make("high");
    const padWorld = new THREE.Vector3(-0.45, 1.35, PARTNER_Z + 0.44);
    const inp = input(idleAtk());
    inp.pad[0] = { on: true, x: padWorld.x, y: padWorld.y, z: padWorld.z - PARTNER_Z, recoil: 0 };
    const g = new THREE.Vector3();
    for (let t = 0; t < 1.2; t += 1 / 60) {
      anim.update(1 / 60, t, inp);
      rig.apply(anim);
    }
    rig.gloveWorld(0, g);
    // the glove sits right behind the pad
    expect(g.distanceTo(padWorld)).toBeLessThan(0.3);
    expect(g.z).toBeLessThan(padWorld.z + 0.02);
    // the other hand stays in the guard, near the chin
    const o = new THREE.Vector3();
    rig.gloveWorld(1, o);
    expect(o.y).toBeGreaterThan(1.25);
    expect(o.y).toBeLessThan(1.7);
  });

  it("is about 1.8 m tall with the head at eye height, and lies low when knocked down", () => {
    const { rig, anim } = make("medium");
    const inp = input(idleAtk());
    const h = new THREE.Vector3();
    for (let t = 0; t < 1; t += 1 / 60) {
      anim.update(1 / 60, t, inp);
      rig.apply(anim);
    }
    rig.headWorld(h);
    expect(h.y).toBeGreaterThan(1.5);
    expect(h.y).toBeLessThan(1.8);
    inp.down = true;
    for (let t = 1; t < 3; t += 1 / 60) {
      anim.update(1 / 60, t, inp);
      rig.apply(anim);
    }
    rig.headWorld(h);
    expect(h.y).toBeLessThan(0.7);
    // he lay down backwards (away from the player)
    expect(h.z).toBeLessThan(PARTNER_Z);
  });

  it("every matrix stays finite through a long run of random poses", () => {
    const { rig, anim, scene } = make("high");
    const atk: AnimAttack = { active: true, kind: "hook", from: 1, t: 0, windup: 0.6 };
    const inp = input(atk);
    for (let t = 0; t < 8; t += 1 / 60) {
      atk.active = Math.sin(t * 2) > 0;
      atk.t = (t * 1.3) % 1.4;
      inp.down = Math.sin(t) > 0.9;
      anim.update(1 / 60, t, inp);
      rig.apply(anim);
    }
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const e = o.matrixWorld.elements;
      for (let i = 0; i < 16; i++) expect(Number.isFinite(e[i])).toBe(true);
    });
  });

  it("is a few dozen simple meshes (cheap), fewer triangles on low", () => {
    const count = (level: "low" | "high"): { meshes: number; tris: number } => {
      const { rig } = make(level);
      let meshes = 0;
      let tris = 0;
      rig.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          meshes++;
          tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
        }
      });
      return { meshes, tris };
    };
    const hi = count("high");
    const lo = count("low");
    expect(hi.meshes).toBeLessThan(60);
    expect(hi.tris).toBeLessThan(9000);
    expect(lo.tris).toBeLessThan(hi.tris);
    expect(lo.tris).toBeLessThan(3500);
  });
});

describe("arena, pads and gloves", () => {
  it("builds at every level; the spectators follow the table", () => {
    for (const level of ["low", "medium", "high"] as const) {
      const a = new Arena(LOD[level]);
      a.buildCrowd();
      let meshes = 0;
      a.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(a.crowdCount).toBeLessThanOrEqual(LOD[level].crowd);
      if (LOD[level].crowd > 0) expect(a.crowdCount).toBeGreaterThan(LOD[level].crowd * 0.8);
      expect(a.rim.length).toBe(LOD[level].rim);
      expect(a.key.castShadow).toBe(LOD[level].shadows);
      // the ring is a few dozen draw calls; the crowd is two instanced meshes however many people there are
      expect(meshes).toBeLessThan(80);
      a.update(1 / 60, 1, true, 0.5);
      a.update(1 / 60, 1.1, true, 0.5);
    }
  });

  it("a pad shows, closes its ring, flies off when hit and hides", () => {
    const pads = new PadViews(LOD.low);
    pads.show(2, 0.4, 1.4, -1.4, 1.5);
    const p = pads.pads[2];
    expect(p.group.visible).toBe(true);
    pads.update(0.2);
    expect(p.state).toBe("idle");
    const s0 = p.ring.scale.x;
    pads.update(0.7);
    expect(p.ring.scale.x).toBeLessThan(s0);
    pads.hit(2);
    pads.update(0.1);
    expect(p.state).toBe("out");
    pads.update(0.5);
    expect(p.state).toBe("off");
    expect(p.group.visible).toBe(false);
  });

  it("the glove sits where the hand maps to; a stretched arm puts it further away", () => {
    const v = newView();
    const g = new PlayerGloves(LOD.low);
    g.update(1 / 60, v, 1, 700, 300, 0, false, true, 0);
    g.update(1 / 60, v, 1, 700, 300, 0, false, true, 0.1);
    const glove = g.group.children[1];
    const px = { x: 0, y: 0, s: 0 };
    worldToPx(v, glove.position.x, glove.position.y, glove.position.z, px);
    expect(px.x).toBeCloseTo(700, 0);
    expect(px.y).toBeCloseTo(300, 0);
    const zNear = glove.position.z;
    for (let i = 0; i < 30; i++) g.update(1 / 60, v, 1, 700, 300, 1, true, true, 0.2 + i / 60);
    expect(glove.position.z).toBeLessThan(zNear - 0.5);
    // a lost hand is hidden after a short grace time
    g.update(1 / 60, v, 1, 700, 300, 0, false, false, 5);
    expect(glove.visible).toBe(false);
  });
});
