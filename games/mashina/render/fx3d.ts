import * as THREE from "three";
import { dotTexture } from "./textures";

/** Skid marks: a ring buffer of ground quads written by the sliding wheels (one draw call, no allocation per frame). */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  private head = 0;
  private count = 0;
  private last = new Float32Array(4 * 3);
  private active = [false, false, false, false];
  static readonly CAP = 700;

  constructor() {
    const n = SkidMarks.CAP;
    this.pos = new Float32Array(n * 4 * 3);
    const idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  clear(): void {
    this.head = this.count = 0;
    this.active.fill(false);
    this.geo.setDrawRange(0, 0);
  }

  /** wheel `i` touches the ground at (x, y, z) heading (dx, dz); `sliding` leaves a mark. */
  wheel(i: number, x: number, y: number, z: number, dx: number, dz: number, sliding: boolean): void {
    const l = this.last;
    if (!sliding) {
      this.active[i] = false;
      return;
    }
    if (!this.active[i]) {
      this.active[i] = true;
      l[i * 3] = x;
      l[i * 3 + 1] = y;
      l[i * 3 + 2] = z;
      return;
    }
    const mx = x - l[i * 3];
    const mz = z - l[i * 3 + 2];
    const d = Math.hypot(mx, mz);
    if (d < 0.4) return;
    if (d > 3) {
      this.active[i] = false;
      return;
    }
    const nx = (-mz / d) * 0.11;
    const nz = (mx / d) * 0.11;
    const p = this.pos;
    const o = this.head * 12;
    const ax = l[i * 3];
    const ay = l[i * 3 + 1] + 0.03;
    const az = l[i * 3 + 2];
    p[o] = ax - nx;
    p[o + 1] = ay;
    p[o + 2] = az - nz;
    p[o + 3] = ax + nx;
    p[o + 4] = ay;
    p[o + 5] = az + nz;
    p[o + 6] = x + nx;
    p[o + 7] = y + 0.03;
    p[o + 8] = z + nz;
    p[o + 9] = x - nx;
    p[o + 10] = y + 0.03;
    p[o + 11] = z - nz;
    this.head = (this.head + 1) % SkidMarks.CAP;
    this.count = Math.min(SkidMarks.CAP, this.count + 1);
    l[i * 3] = x;
    l[i * 3 + 1] = y;
    l[i * 3 + 2] = z;
    void dx;
    void dz;
    const a = this.geo.getAttribute("position") as THREE.BufferAttribute;
    a.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Tyre smoke: a pool of billboards drawn as points with a soft sprite; size and alpha follow the age in the shader. */
export class Smoke {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private age: Float32Array;
  private vel: Float32Array;
  private head = 0;
  private tex: THREE.Texture;
  /** 0..1 particle budget from engine.quality.particles */
  density = 1;
  /** seconds until the last particle is gone (0 = nothing alive: no update work, the points are hidden) */
  private busyT = 0;
  private readonly cap: number;

  constructor(cap = 120) {
    this.cap = cap;
    const n = cap;
    this.pos = new Float32Array(n * 3).fill(0);
    this.age = new Float32Array(n).fill(2);
    this.vel = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAge", new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    this.tex = dotTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.tex }, uScale: { value: 600 } },
      vertexShader: `attribute float aAge; varying float vA; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float life = clamp(aAge/1.6, 0.0, 1.0);
          gl_PointSize = (1.6 + life*5.0) * uScale / max(0.1, -mv.z); vA = (1.0-life) * (aAge >= 1.6 ? 0.0 : 0.5);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.85), t.a * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  emit(x: number, y: number, z: number, vx: number, vz: number): void {
    if (Math.random() > this.density) return;
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.busyT = 1.7;
    this.points.visible = true;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y + 0.2;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx * 0.15 + (Math.random() - 0.5) * 0.8;
    this.vel[i * 3 + 1] = 0.5 + Math.random() * 0.7;
    this.vel[i * 3 + 2] = vz * 0.15 + (Math.random() - 0.5) * 0.8;
    this.age[i] = 0;
  }

  update(dt: number, viewportH: number): void {
    if (this.busyT <= 0) return;
    this.busyT -= dt;
    if (this.busyT <= 0) this.points.visible = false;
    this.mat.uniforms.uScale.value = viewportH * 0.9;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i] >= 1.6) continue;
      this.age[i] += dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] *= 1 - dt * 0.8;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aAge") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/** Rain streaks around the camera; the falling is done in the vertex shader (no per-frame CPU work except one uniform). */
export class Rain {
  readonly lines: THREE.LineSegments;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  /** streaks allocated (the count of the level at full rain) */
  private readonly N: number;

  constructor(n = 700) {
    this.N = n;
    const p = new Float32Array(n * 6);
    const seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 60;
      const y = Math.random() * 30;
      const z = (Math.random() - 0.5) * 60;
      p.set([x, y, z, x, y - 1.2, z], i * 6);
      seed[i * 2] = y;
      seed[i * 2 + 1] = y;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.geo.setAttribute("aY", new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAlpha: { value: 0 } },
      vertexShader: `attribute float aY; uniform float uTime; uniform vec3 uCenter; uniform float uAlpha; varying float vA;
        void main(){
          vec3 p = position;
          float len = position.y - aY;                       // streak length (0 for the head, -1.2 for the tail)
          p.y = mod(aY - uTime * 24.0, 30.0) + len + uCenter.y - 8.0;
          p.x = uCenter.x + mod(position.x - uCenter.x + 30.0, 60.0) - 30.0 + len * 0.15;
          p.z = uCenter.z + mod(position.z - uCenter.z + 30.0, 60.0) - 30.0;
          vA = uAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.75, 0.82, 0.9, 0.35 * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = true;
  }

  update(t: number, cam: THREE.Vector3, amount: number): void {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uCenter.value.copy(cam);
    this.mat.uniforms.uAlpha.value = amount;
    this.lines.visible = amount > 0.01;
    this.geo.setDrawRange(0, Math.floor(this.N * Math.min(1, amount)) * 2);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A pulsing light column marking the mission target / pickup. */
export class Beacon {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 20, 1, true), this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }
  set(x: number, z: number, r: number, color: number, t: number): void {
    this.mesh.visible = true;
    this.mesh.position.set(x, 30, z);
    this.mesh.scale.set(r, 1, r);
    this.mat.color.setHex(color);
    this.mat.opacity = 0.2 + 0.1 * Math.sin(t * 4);
  }
  hide(): void {
    this.mesh.visible = false;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Headlights at night without a light source (a spot light would add a shader variant to every material and switch it at dusk):
 * one additive soft pool on the road ahead of the car, drawn with the soft round sprite stretched along the heading.
 */
export class HeadGlow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private tex: THREE.Texture;

  constructor() {
    this.tex = dotTexture();
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xffe9b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** night 0..1; (x, z) the car, (fx, fz) its heading, y the road height under it */
  update(night: number, x: number, y: number, z: number, fx: number, fz: number): void {
    const on = night > 0.3;
    this.mesh.visible = on;
    if (!on) return;
    this.mat.opacity = 0.42 * Math.min(1, (night - 0.3) * 2);
    this.mesh.position.set(x + fx * 10, y + 0.06, z + fz * 10);
    this.mesh.rotation.y = Math.atan2(fx, fz);
    this.mesh.scale.set(8, 1, 20);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
