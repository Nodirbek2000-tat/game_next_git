// Pooled water effects: expanding ripples (one instanced mesh), splash droplets (one Points object) and rain (a shader).

import * as THREE from "three";
import { makeDotTexture } from "./textures";
import { L_NOREFL } from "./water";

const RIPPLES = 28;
const DROPS = 220;

export class Ripples {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(RIPPLES);
  private y = new Float32Array(RIPPLES);
  private z = new Float32Array(RIPPLES);
  private t = new Float32Array(RIPPLES);
  private life = new Float32Array(RIPPLES).fill(0);
  private size = new Float32Array(RIPPLES);
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private waterAt: (x: number, z: number) => number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.88, 1, 40), mat, RIPPLES);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(L_NOREFL);
    this.mesh.renderOrder = 3;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RIPPLES * 3), 3);
    for (let i = 0; i < RIPPLES; i++) this.hide(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private hide(i: number): void {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
  }

  addAt(x: number, z: number, size = 1, life = 1.4): void {
    this.add(x, this.waterAt(x, z), z, size, life);
  }

  add(x: number, waterY: number, z: number, size = 1, life = 1.4): void {
    const i = this.next++ % RIPPLES;
    this.x[i] = x;
    this.y[i] = waterY + 0.03;
    this.z[i] = z;
    this.t[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < RIPPLES; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.t[i] += dt;
      const k = this.t[i] / this.life[i];
      if (k >= 1) {
        this.life[i] = 0;
        this.hide(i);
        continue;
      }
      const r = 0.15 + k * 1.7 * this.size[i];
      this.p.set(this.x[i], this.waterAt(this.x[i], this.z[i]) + 0.03, this.z[i]);
      this.s.set(r, r, r);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      const a = 0.55 * (1 - k) * (1 - k);
      this.c.setRGB(a, a, a);
      this.mesh.setColorAt(i, this.c);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

export class Splashes {
  readonly points: THREE.Points;
  private pos = new Float32Array(DROPS * 3);
  private vel = new Float32Array(DROPS * 3);
  private life = new Float32Array(DROPS);
  private next = 0;
  private attr: THREE.BufferAttribute;
  private tex = makeDotTexture();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.attr);
    for (let i = 0; i < DROPS; i++) this.pos[i * 3 + 1] = -100;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe6f7ff, size: 0.09, map: this.tex, transparent: true, depthWrite: false, opacity: 0.9, fog: false }));
    this.points.frustumCulled = false;
    this.points.layers.set(L_NOREFL);
  }

  burst(x: number, y: number, z: number, n: number, power = 1, density = 1): void {
    const count = Math.round(n * density);
    for (let k = 0; k < count; k++) {
      const i = this.next++ % DROPS;
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.6) * power;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * s * 0.7;
      this.vel[i * 3 + 1] = (1.2 + Math.random() * 2.4) * power;
      this.vel[i * 3 + 2] = Math.sin(a) * s * 0.7;
      this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < DROPS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100;
        continue;
      }
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.attr.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
  }
}

const RAIN_V = /* glsl */ `
attribute float aEnd; attribute vec3 aBase; uniform float uTime; uniform vec3 uCenter;
varying float vA;
void main(){
  float fall = mod(aBase.y - uTime*22., 20.);
  vec3 p = vec3(aBase.x + uCenter.x, fall - 1., aBase.z + uCenter.z);
  p.x += fall*0.12; p.y += aEnd*0.7;
  vA = (1. - aEnd*0.9) * 0.45;
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
}`;
const RAIN_F = /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.86, 0.95, vA); }`;

export function makeRain(count: number): THREE.LineSegments {
  const base = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 50;
    const y = Math.random() * 20;
    const z = -34 + Math.random() * 46;
    for (let k = 0; k < 2; k++) {
      base.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
  g.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
  g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({ vertexShader: RAIN_V, fragmentShader: RAIN_F, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(0, 0, 0) } } });
  const l = new THREE.LineSegments(g, m);
  l.frustumCulled = false;
  l.layers.set(L_NOREFL);
  return l;
}
