import * as THREE from "three";
import { type Lod } from "./config";
import { makeMat } from "./partner3d";

/** deterministic little random generator (the crowd looks the same every time) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d");
  if (c) draw(c, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

// ring: x +-3, z from RING_BACK to RING_FRONT
export const RING_X = 3;
export const RING_BACK = -4.2;
export const RING_FRONT = 1.8;

/**
 * The ring and what is around it: the canvas floor, corner posts, three ropes on the back and both sides, a dark hall with
 * a painted crowd on the walls, tiers of stands and (medium / high) 3D spectators, light cones. Everything is built once;
 * `update` only moves the spectators (high) and the cheer level.
 */
export class Arena {
  readonly group = new THREE.Group();
  readonly lights = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rim: THREE.PointLight[] = [];
  private crowd: THREE.Group | null = null;
  private bodies: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private home: Float32Array | null = null;
  private phase: Float32Array | null = null;
  private n = 0;
  private shown = 0;
  private frame = 0;
  private cheer = 0;
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private sc = new THREE.Vector3(1, 1, 1);
  private cones: THREE.Mesh[] = [];

  constructor(private lod: Lod) {
    const seg = lod.seg;
    const stone = makeMat(lod, 0x1c2230, 0.9);
    // ---- floor: the canvas
    const floorTex = canvasTex(lod.tex, lod.tex, (c, w, h) => {
      c.fillStyle = "#274b86";
      c.fillRect(0, 0, w, h);
      const g = c.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.72);
      g.addColorStop(0, "rgba(255,255,255,.16)");
      g.addColorStop(1, "rgba(0,0,0,.35)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "#f4f1e8";
      c.lineWidth = w * 0.012;
      c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      // corner triangles: red (left), blue (right)
      const tri = (x: number, y: number, dx: number, dy: number, col: string): void => {
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + dx * w * 0.2, y);
        c.lineTo(x, y + dy * h * 0.2);
        c.closePath();
        c.fill();
      };
      tri(w * 0.05, h * 0.05, 1, 1, "#c1272d");
      tri(w * 0.95, h * 0.05, -1, 1, "#2160c4");
      tri(w * 0.05, h * 0.95, 1, -1, "#2160c4");
      tri(w * 0.95, h * 0.95, -1, -1, "#c1272d");
      c.fillStyle = "rgba(255,255,255,.22)";
      c.font = `900 ${Math.round(w * 0.2)}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("BOKS", w / 2, h * 0.5);
      c.strokeStyle = "rgba(255,255,255,.12)";
      c.lineWidth = w * 0.006;
      c.beginPath();
      c.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
      c.stroke();
    });
    const floorMat = lod.lambert ? new THREE.MeshLambertMaterial({ map: floorTex }) : new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 });
    const depth = RING_FRONT - RING_BACK;
    const midZ = (RING_FRONT + RING_BACK) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RING_X * 2, depth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.001, midZ);
    floor.receiveShadow = lod.shadows;
    this.group.add(floor);
    // platform and apron
    const plat = new THREE.Mesh(new THREE.BoxGeometry(RING_X * 2 + 0.5, 0.5, depth + 0.5), makeMat(lod, 0x8e1b22, 0.8));
    plat.position.set(0, -0.25, midZ);
    this.group.add(plat);
    const hall = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), stone);
    hall.rotation.x = -Math.PI / 2;
    hall.position.set(0, -0.5, midZ);
    this.group.add(hall);

    // ---- posts and ropes
    const postMat = makeMat(lod, 0x23262e, 0.5, 0.3);
    const padCols = [0xc1272d, 0xf4f1e8, 0x2160c4];
    const ropeMats = padCols.map((c) => makeMat(lod, c, 0.55));
    const corners: [number, number][] = [
      [-RING_X, RING_BACK],
      [RING_X, RING_BACK],
      [-RING_X, RING_FRONT],
      [RING_X, RING_FRONT],
    ];
    const ropeSeg = Math.max(5, Math.round(seg / 2));
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.7, seg), postMat);
      post.position.set(x, 0.85, z);
      this.group.add(post);
      for (let k = 0; k < 3; k++) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), ropeMats[k === 1 ? 1 : k === 0 ? 2 : 0]);
        pad.position.set(x, 0.5 + k * 0.45, z);
        this.group.add(pad);
      }
    }
    const heights = [0.5, 0.95, 1.4];
    const ropeGeoZ = new THREE.CylinderGeometry(0.022, 0.022, depth, ropeSeg);
    const ropeGeoX = new THREE.CylinderGeometry(0.022, 0.022, RING_X * 2, ropeSeg);
    heights.forEach((y, k) => {
      const mat = ropeMats[k === 1 ? 1 : k === 0 ? 2 : 0];
      const back = new THREE.Mesh(ropeGeoX, mat);
      back.rotation.z = Math.PI / 2;
      back.position.set(0, y, RING_BACK);
      this.group.add(back);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(ropeGeoZ, mat);
        side.rotation.x = Math.PI / 2;
        side.position.set(sx * RING_X, y, midZ);
        this.group.add(side);
      }
    });

    // ---- the hall: dark walls with a painted crowd, banners
    const wallTex = canvasTex(1024, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#04050a");
      g.addColorStop(0.55, "#0b1020");
      g.addColorStop(1, "#1a1d2b");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      const r = rng(11);
      // bokeh of the lights
      for (let i = 0; i < 70; i++) {
        c.fillStyle = `rgba(${r() < 0.5 ? "255,220,160" : "150,190,255"},${0.1 + r() * 0.35})`;
        c.beginPath();
        c.arc(r() * w, r() * h * 0.45, 1.5 + r() * 3.5, 0, Math.PI * 2);
        c.fill();
      }
      // rows of spectators (heads and shoulders)
      for (let row = 0; row < 4; row++) {
        const y = h * (0.52 + row * 0.12);
        for (let x = -10; x < w + 20; x += 16 + r() * 8) {
          const shade = 20 + Math.floor(r() * 40) + row * 8;
          c.fillStyle = `rgb(${shade + (r() < 0.2 ? 40 : 0)},${shade},${shade + (r() < 0.2 ? 30 : 5)})`;
          c.beginPath();
          c.arc(x, y - 10, 8 + r() * 2, 0, Math.PI * 2);
          c.fill();
          c.fillRect(x - 11, y - 3, 22, 40);
        }
      }
      // camera flashes
      for (let i = 0; i < 18; i++) {
        c.fillStyle = "rgba(255,255,255,.85)";
        c.fillRect(r() * w, h * (0.5 + r() * 0.4), 2, 2);
      }
    });
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.repeat.set(3, 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 9, 20, 1, true), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, fog: false }));
    wall.position.set(0, 3.6, midZ);
    this.group.add(wall);
    // stands: dark tiers behind the back ropes and on both sides
    const tierMat = makeMat(lod, 0x14192a, 0.9);
    for (let k = 0; k < 3; k++) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6 + k * 0.6, 1.4), tierMat);
      back.position.set(0, (0.6 + k * 0.6) / 2 - 0.4, RING_BACK - 3.3 - k * 1.4);
      this.group.add(back);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6 + k * 0.6, 12), tierMat);
        side.position.set(sx * (RING_X + 2.6 + k * 1.4), (0.6 + k * 0.6) / 2 - 0.4, midZ - 1.2);
        this.group.add(side);
      }
    }
    // banners on the back wall of the stands
    const banner = canvasTex(512, 96, (c, w, h) => {
      c.fillStyle = "#8e1b22";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#f4f1e8";
      c.font = "900 56px sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("HARAKAT BOKS", w / 2, h / 2 + 3);
    });
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({ map: banner, fog: false }));
    bn.position.set(0, 4.3, RING_BACK - 3.0);
    this.group.add(bn);

    // ---- lights
    this.hemi = new THREE.HemisphereLight(0xbfd2ff, 0x2a1c14, lod.lambert ? 0.85 : 0.6);
    this.key = new THREE.DirectionalLight(0xfff1dc, lod.lambert ? 2.0 : 2.4);
    this.key.position.set(1.5, 6.5, 2.5);
    this.key.target.position.set(0, 0.8, -1.6);
    if (lod.shadows) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(lod.shadowMap, lod.shadowMap);
      const sc = this.key.shadow.camera;
      sc.left = sc.bottom = -4;
      sc.right = sc.top = 4;
      sc.near = 2;
      sc.far = 14;
      this.key.shadow.bias = -0.0006;
      this.key.shadow.normalBias = 0.03;
      sc.updateProjectionMatrix();
    }
    this.lights.add(this.hemi, this.key, this.key.target);
    const rimCols = [0xff3b3b, 0x3b82ff];
    for (let i = 0; i < lod.rim; i++) {
      const p = new THREE.PointLight(rimCols[i], 14, 9, 2);
      p.position.set(i === 0 ? -3 : 3, 2.8, -4.4);
      this.rim.push(p);
      this.lights.add(p);
    }
    // light cones (visual only)
    if (lod.cones) {
      const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.055, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      for (const x of [-1.6, 1.6]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.9, 7, 14, 1, true), coneMat);
        cone.position.set(x, 3.6, -2.2);
        this.group.add(cone);
        this.cones.push(cone);
      }
    }
  }

  /** the 3D spectators (staged: built after the first frames) */
  buildCrowd(): THREE.Group | null {
    const lod = this.lod;
    if (lod.crowd <= 0 || this.crowd) return this.crowd;
    const r = rng(5);
    const want = lod.crowd;
    const home = new Float32Array(want * 4); // x, y, z, scale
    let n = 0;
    const midZ = (RING_FRONT + RING_BACK) / 2;
    // rows: the three tiers behind the back ropes, then the side stands
    const place = (x: number, y: number, z: number): void => {
      if (n >= want) return;
      home[n * 4] = x + (r() - 0.5) * 0.12;
      home[n * 4 + 1] = y;
      home[n * 4 + 2] = z + (r() - 0.5) * 0.1;
      home[n * 4 + 3] = 0.9 + r() * 0.25;
      n++;
    };
    // two people deep on every tier (the rear ones a little higher)
    for (let k = 0; k < 3 && n < want; k++) {
      for (let d = 0; d < 2; d++) {
        const y = 0.2 + k * 0.6 + 0.3 + d * 0.12;
        const z = RING_BACK - 3.3 - k * 1.4 - d * 0.4;
        for (let x = -7.8 + d * 0.3; x <= 7.8 && n < want * 0.6; x += 0.56) place(x, y, z);
      }
    }
    for (let k = 0; k < 3 && n < want; k++) {
      for (let d = 0; d < 2; d++) {
        const y = 0.2 + k * 0.6 + 0.3 + d * 0.12;
        for (const sx of [-1, 1]) {
          const x = sx * (RING_X + 2.6 + k * 1.4 + d * 0.4);
          for (let z = midZ - 6.4 + d * 0.3; z <= midZ + 3.4 && n < want; z += 0.62) place(x, y, z);
        }
      }
    }
    this.n = n;
    this.home = home.slice(0, n * 4);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.phase[i] = r() * 6.28;
    const palette = [0xc1272d, 0x2160c4, 0xd9a40a, 0x2f8f5b, 0x8a4fbf, 0xe8e3d6, 0x3a3f4d, 0xd9733a];
    const bodyMat = lod.lambert ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const headMat = makeMat(lod, 0xc99a74, 0.8);
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.55, 0.3), bodyMat, n);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 7, 6), headMat, n);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.bodies.setColorAt(i, col.setHex(palette[Math.floor(r() * palette.length)]));
      this.heads.setColorAt(i, col.setHex([0xc99a74, 0xa87754, 0xe0b690, 0x7a5239][Math.floor(r() * 4)]));
    }
    this.bodies.frustumCulled = false;
    this.heads.frustumCulled = false;
    this.crowd = new THREE.Group();
    this.crowd.add(this.bodies, this.heads);
    this.shown = n;
    this.writeAll(0);
    this.group.add(this.crowd);
    return this.crowd;
  }

  private write(i: number, t: number): void {
    const h = this.home!;
    const ph = this.phase!;
    const amp = 0.015 + this.cheer * 0.16;
    const y = h[i * 4 + 1] + Math.abs(Math.sin(t * (2 + this.cheer * 5) + ph[i])) * amp;
    const s = h[i * 4 + 3];
    this.sc.set(s, s, s);
    this.pos.set(h[i * 4], y, h[i * 4 + 2]);
    this.m.compose(this.pos, this.quat, this.sc);
    this.bodies!.setMatrixAt(i, this.m);
    this.pos.y = y + 0.42 * s;
    this.m.compose(this.pos, this.quat, this.sc);
    this.heads!.setMatrixAt(i, this.m);
  }

  private writeAll(t: number): void {
    for (let i = 0; i < this.shown; i++) this.write(i, t);
    if (this.bodies) {
      this.bodies.count = this.shown;
      this.heads!.count = this.shown;
      this.bodies.instanceMatrix.needsUpdate = true;
      this.heads!.instanceMatrix.needsUpdate = true;
    }
  }

  /** the crowd roars (after a good hit / a knockdown): 0..1 */
  roar(v: number): void {
    this.cheer = Math.max(this.cheer, Math.min(1, v));
  }

  /** `animate`: the spectators bob (high only, every other frame); `crowdShare` 0..1 of the crowd shown (live quality drop) */
  update(dt: number, t: number, animate: boolean, crowdShare: number): void {
    this.cheer = Math.max(0, this.cheer - dt * 0.6);
    if (!this.bodies) return;
    const want = Math.round(this.n * Math.max(0, Math.min(1, crowdShare)));
    if (want !== this.shown) {
      this.shown = want;
      this.writeAll(t);
      return;
    }
    if (!animate || this.shown === 0) return;
    this.frame++;
    if (this.frame % 2) return;
    // a third of the spectators per update keeps the cost flat
    const part = this.frame % 6 === 0 ? 0 : this.frame % 6 === 2 ? 1 : 2;
    for (let i = part; i < this.shown; i += 3) this.write(i, t);
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads!.instanceMatrix.needsUpdate = true;
  }

  get crowdCount(): number {
    return this.n;
  }
}
