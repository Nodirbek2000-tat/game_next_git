import * as THREE from "three";
import { type BlockPlan, type Building, CURB, CURB_H, HW, LANE, PITCH, STOP, WALK, ihash, junction, plan, segX, segZ, signal, unwarp, warpX, warpZ } from "./city";

/**
 * Renders the open city around the car, block by block (the look of tools/blender/street.py: clean plaster blocks with
 * recessed dark windows and balconies, smooth round plane trees, tiled pavements, real asphalt). Each block tile is a
 * few merged meshes (asphalt, pavement, ground, buildings, glass, leaves, glow, signs); tiles further than `radius`
 * blocks are dropped.
 */

const PLAIN = 4;
const SIGNS = ["DORIXONA", "NON VA SOMSA", "OZIQ-OVQAT", "KAFE", "MEVA-SABZAVOT", "TELEFONLAR", "KITOBLAR", "GULLAR", "OSHXONA", "KIYIM-KECHAK", "BANK", "SARTAROSHXONA", "SUPERMARKET", "CHOYXONA", "SHIRINLIKLAR", "SPORT"];
const SIGN_BG = ["#0b6e3a", "#a81d1d", "#1d4fa8", "#c77700", "#5b2a86", "#0e7490", "#7c2d12", "#be185d"];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

const tex = (cv: HTMLCanvasElement, aniso: number, repeat = true): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};

/** soft plaster / grass grain (multiplied with the vertex colours) */
function grainTexture(aniso: number): THREE.CanvasTexture {
  const N = 256;
  const [cv, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const n = 0.5 * ihash(x, y, 1) + 0.3 * ihash(x >> 3, y >> 3, 2) + 0.2 * ihash(x >> 5, y >> 5, 3);
      const v = 205 + n * 50;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(cv, aniso);
}

function signTexture(): THREE.CanvasTexture {
  const W = 1024;
  const RH = 64;
  const [cv, g] = canvas(W, RH * SIGNS.length);
  SIGNS.forEach((name, i) => {
    g.fillStyle = SIGN_BG[i % SIGN_BG.length];
    g.fillRect(0, i * RH, W, RH);
    g.fillStyle = "#fff";
    g.font = "bold 42px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(name, W / 2, i * RH + RH / 2 + 2);
  });
  return tex(cv, 1, false);
}

// ---------------------------------------------------------------------------------------------------- geometry kit

class Geo {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  lamp: number[] = [];
  idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  v(x: number, y: number, z: number, c: THREE.Color, u = 0, w = 0, lamp = 0): number {
    // the plan is a grid; the world is the bent grid (city.ts warp)
    this.pos.push(warpX(x, z), y, warpZ(x, z));
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, w);
    this.lamp.push(lamp);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** wall from (x0, z0) to (x1, z1), outward normal on the right of that direction; uv in metres / 4 (tessellated every
   * ~8 m so long walls follow the bent streets) */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: THREE.Color, lamp = 0): void {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(L / 8));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const ax = x0 + (x1 - x0) * t0;
      const az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1;
      const bz = z0 + (z1 - z0) * t1;
      const a = this.v(ax, y0, az, c, (L * t0) / 4, y0 / 4, lamp);
      const b = this.v(bx, y0, bz, c, (L * t1) / 4, y0 / 4, lamp);
      const d = this.v(bx, y1, bz, c, (L * t1) / 4, y1 / 4, lamp);
      const e = this.v(ax, y1, az, c, (L * t0) / 4, y1 / 4, lamp);
      this.quad(a, b, d, e);
    }
  }

  /** wall with texture coordinates in tiles: u = along / tu, v = (y - vy0) / tv */
  texWall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: THREE.Color, tu: number, tv: number, vy0: number, uOff = 0): void {
    const L = Math.hypot(x1 - x0, z1 - z0);
    // whole tiles along the wall (no cut window at the corners)
    const nt = Math.max(1, Math.round(L / tu));
    const n = Math.max(1, Math.ceil(L / 8));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const a = this.v(x0 + (x1 - x0) * t0, y0, z0 + (z1 - z0) * t0, c, uOff + nt * t0, (y0 - vy0) / tv);
      const b = this.v(x0 + (x1 - x0) * t1, y0, z0 + (z1 - z0) * t1, c, uOff + nt * t1, (y0 - vy0) / tv);
      const d = this.v(x0 + (x1 - x0) * t1, y1, z0 + (z1 - z0) * t1, c, uOff + nt * t1, (y1 - vy0) / tv);
      const e = this.v(x0 + (x1 - x0) * t0, y1, z0 + (z1 - z0) * t0, c, uOff + nt * t0, (y1 - vy0) / tv);
      this.quad(a, b, d, e);
    }
  }

  /** horizontal rectangle facing up (a grid of <= 8 m cells: it bends with the world) */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color, uv?: number[][], lamp = 0): void {
    const U = uv ?? [[x0 / 7, z0 / 7], [x0 / 7, z1 / 7], [x1 / 7, z1 / 7], [x1 / 7, z0 / 7]];
    const nx = Math.max(1, Math.ceil(Math.abs(x1 - x0) / 8));
    const nz = Math.max(1, Math.ceil(Math.abs(z1 - z0) / 8));
    // bilinear uv over the corners (a, b, d, e) = (x0z0, x0z1, x1z1, x1z0)
    const uvAt = (fx: number, fz: number): [number, number] => {
      const lerp2 = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const l = lerp2(U[0], U[1], fz);
      const r = lerp2(U[3], U[2], fz);
      const m = lerp2(l, r, fx);
      return [m[0], m[1]];
    };
    const ids: number[][] = [];
    for (let i = 0; i <= nx; i++) {
      const row: number[] = [];
      for (let k = 0; k <= nz; k++) {
        const fx = i / nx;
        const fz = k / nz;
        const [u, w] = uvAt(fx, fz);
        row.push(this.v(x0 + (x1 - x0) * fx, y, z0 + (z1 - z0) * fz, c, u, w, lamp));
      }
      ids.push(row);
    }
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) this.quad(ids[i][k], ids[i][k + 1], ids[i + 1][k + 1], ids[i + 1][k]);
  }

  /** closed box (no bottom), axis aligned */
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: THREE.Color, top: THREE.Color = c): void {
    this.wall(x1, z0, x0, z0, y0, y1, c);
    this.wall(x0, z0, x0, z1, y0, y1, c);
    this.wall(x0, z1, x1, z1, y0, y1, c);
    this.wall(x1, z1, x1, z0, y0, y1, c);
    this.flat(x0, z0, x1, z1, y1, top);
  }

  /** box centred at (x, z) */
  cbox(x: number, z: number, sx: number, sz: number, y0: number, y1: number, c: THREE.Color): void {
    this.box(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, y0, y1, c);
  }

  /** a rectangle on the wall plane p(t) = p0 + d t + n o (t along the wall, o outwards) */
  onWall(p0x: number, p0z: number, dx: number, dz: number, t0: number, t1: number, y0: number, y1: number, o: number, c: THREE.Color, uv?: number[][], lamp = 0): void {
    const nx = -dz;
    const nz = dx;
    const P = (t: number) => [p0x + dx * t + nx * o, p0z + dz * t + nz * o];
    const [ax, az] = P(t0);
    const [bx, bz] = P(t1);
    const U = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const a = this.v(ax, y0, az, c, U[0][0], U[0][1], lamp);
    const b = this.v(bx, y0, bz, c, U[1][0], U[1][1], lamp);
    const d = this.v(bx, y1, bz, c, U[2][0], U[2][1], lamp);
    const e = this.v(ax, y1, az, c, U[3][0], U[3][1], lamp);
    this.quad(a, b, d, e);
  }

  /** small box sticking out of a wall (sill, balcony): along t0..t1, out from o0 to o1, height y0..y1 */
  outBox(p0x: number, p0z: number, dx: number, dz: number, t0: number, t1: number, o0: number, o1: number, y0: number, y1: number, c: THREE.Color): void {
    const nx = -dz;
    const nz = dx;
    const P = (t: number, o: number) => [p0x + dx * t + nx * o, p0z + dz * t + nz * o];
    const A = P(t0, o0);
    const Bp = P(t1, o0);
    const Cp = P(t1, o1);
    const D = P(t0, o1);
    // outward face, the two ends, top, bottom
    this.wallP(D, Cp, y0, y1, c);
    this.wallP(A, D, y0, y1, c);
    this.wallP(Cp, Bp, y0, y1, c);
    const ids = [A, D, Cp, Bp].map((p) => this.v(p[0], y1, p[1], c));
    this.quad(ids[0], ids[1], ids[2], ids[3]);
    const bot = [A, Bp, Cp, D].map((p) => this.v(p[0], y0, p[1], c.clone().multiplyScalar(0.7)));
    this.quad(bot[0], bot[1], bot[2], bot[3]);
  }

  private wallP(a: number[], b: number[], y0: number, y1: number, c: THREE.Color): void {
    this.wall(a[0], a[1], b[0], b[1], y0, y1, c);
  }

  /** vertical cylinder / cone */
  cyl(x: number, z: number, r0: number, r1: number, y0: number, y1: number, n: number, c: THREE.Color, cap = true, c2?: THREE.Color): void {
    const base: number[] = [];
    const top: number[] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      base.push(this.v(x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0, c));
      top.push(this.v(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1, c2 ?? c));
    }
    for (let k = 0; k < n; k++) this.quad(base[k], top[k], top[k + 1], base[k + 1]);
    if (cap && r1 > 0.01) {
      const ctr = this.v(x, y1, z, c2 ?? c);
      for (let k = 0; k < n; k++) this.idx.push(ctr, top[k + 1], top[k]);
    }
  }

  /** smooth (ellipsoidal) sphere; `half` = dome only */
  sphere(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: THREE.Color, rows = 8, n = 14, half = false, jitter = 0, seed = 0): void {
    const ring: number[][] = [];
    const cc = new THREE.Color();
    const r1 = half ? rows / 2 : rows;
    for (let i = 0; i <= r1; i++) {
      const th = (i / rows) * Math.PI;
      const row: number[] = [];
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const j = jitter && i > 0 && i < rows ? 1 + jitter * (ihash(seed, i, k % n) - 0.5) : 1;
        // light from above: tops a bit lighter (the bake of a sky light)
        cc.copy(c).multiplyScalar(0.78 + 0.32 * Math.cos(th * 0.5));
        row.push(this.v(x + Math.cos(a) * Math.sin(th) * rx * j, y + Math.cos(th) * ry * j, z + Math.sin(a) * Math.sin(th) * rz * j, cc));
      }
      ring.push(row);
    }
    for (let i = 0; i < r1; i++) for (let k = 0; k < n; k++) this.quad(ring[i][k], ring[i][k + 1], ring[i + 1][k + 1], ring[i + 1][k]);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("lamp", new THREE.Float32BufferAttribute(this.lamp, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------- colours

const C = (h: number) => new THREE.Color(h);
const WHITE = C(0xffffff);
const PAINT = C(0xefefea);
const CURBC = C(0xc8c4bb);
const POLE = C(0x43474d);
const LAMPC = C(0xfff0d0);
const BARK = C(0x7a6a58);
const LEAVES = [C(0x2f5a1e), C(0x3a6824), C(0x335f22), C(0x45722a)];
const ROOF = C(0x46474b);
const FRAME = C(0xe6e2da);
const SHOP = C(0xffe2b8);
const GLASSC = [C(0x2a3440), C(0x26303a), C(0x303a46)];
const PLASTER = [C(0xe9e4da), C(0xe2d6bf), C(0xd7c3a6), C(0xdfe1dd), C(0xe8dcc4), C(0xcfd4d6), C(0xc9b29a)];
const TOWERC = [C(0x5c7189), C(0x4f6378), C(0x6a7e92)];
const TIN = [C(0x2f6f5e), C(0x355c8a), C(0x8a3b2f), C(0x9aa0a6)];
const WALLC = [C(0xe3d6bd), C(0xd8c6a5), C(0xcfc3ad), C(0xe9e1cf)];
const GATE = [C(0x2c4f7c), C(0x5a3b22), C(0x2f5d3a), C(0x7a2a2a)];
const GRASS = C(0xb4bca8);
const DIRT = C(0xb8a888);
const STONE = C(0xd8c7a3);
const TILE_BLUE = C(0x1f7a9c);
const TILE_TURQ = C(0x2aa7b5);

// lamp codes for the glow shader: 0 always lit; 1..3 = signal of axis x (red, yellow, green); 4..6 = axis z
const SIG_COL = [C(0xff2a14), C(0xffb000), C(0x2bff6a)];

interface Tile {
  key: string;
  i: number;
  j: number;
  group: THREE.Group;
  geos: THREE.BufferGeometry[];
  glow: THREE.MeshBasicMaterial | null;
}

export class CityView {
  readonly group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  readonly roadMat: THREE.MeshStandardMaterial;
  readonly curbMat: THREE.MeshStandardMaterial;
  readonly paintMat: THREE.MeshStandardMaterial;
  readonly walkMat: THREE.MeshStandardMaterial;
  readonly groundMat: THREE.MeshStandardMaterial;
  readonly bldgMat: THREE.MeshStandardMaterial;
  readonly glassMat: THREE.MeshStandardMaterial;
  readonly leafMat: THREE.MeshStandardMaterial;
  readonly signMat: THREE.MeshBasicMaterial;
  readonly flatsMat: THREE.MeshStandardMaterial;
  readonly shopMat: THREE.MeshStandardMaterial;
  private glowBase: THREE.MeshBasicMaterial;
  private far: THREE.Mesh;
  private floor: THREE.Mesh;

  constructor(
    aniso: number,
    private shadows: boolean,
    private radius = 2,
  ) {
    const grain = grainTexture(aniso);
    // CC0 PBR materials (ambientCG): asphalt Road012A, paving PavingStones099, concrete Concrete034, grass Grass004
    const pbr = (name: string, color = true) => {
      const load = (k: string, srgb: boolean) => {
        const t = new THREE.TextureLoader().load(`/textures/poyga/pbr/${name}_${k}.jpg`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      return { map: color ? load("color", true) : undefined, normalMap: load("normal", false), roughnessMap: load("rough", false) };
    };
    this.roadMat = new THREE.MeshStandardMaterial({ ...pbr("road"), color: new THREE.Color(0.62, 0.62, 0.64), roughness: 1, envMapIntensity: 0.3, normalScale: new THREE.Vector2(1.2, 1.2) });
    this.walkMat = new THREE.MeshStandardMaterial({ ...pbr("paving"), vertexColors: true, roughness: 1, envMapIntensity: 0.4 });
    this.groundMat = new THREE.MeshStandardMaterial({ ...pbr("grass"), vertexColors: true, roughness: 1, envMapIntensity: 0.25 });
    this.curbMat = new THREE.MeshStandardMaterial({ ...pbr("concrete"), roughness: 1, envMapIntensity: 0.35 });
    this.paintMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e2, roughness: 0.75, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.bldgMat = new THREE.MeshStandardMaterial({ map: grain, vertexColors: true, roughness: 0.82, envMapIntensity: 0.55 });
    this.glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.85, envMapIntensity: 1.25 });
    this.leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.45 });
    this.signMat = new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.85) });
    // facade tiles rendered in Blender (tools/blender/buildings.py): one bay x two floors, and the shop floor
    const ftex = (name: string) => {
      const t = new THREE.TextureLoader().load(`/textures/poyga/facades/${name}.png`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      return t;
    };
    this.flatsMat = new THREE.MeshStandardMaterial({ map: ftex("facade_flats"), vertexColors: true, roughness: 0.75, envMapIntensity: 0.5 });
    const shop = ftex("facade_shop");
    this.shopMat = new THREE.MeshStandardMaterial({ map: shop, vertexColors: true, roughness: 0.6, envMapIntensity: 0.6, emissive: new THREE.Color(0xffffff), emissiveMap: shop, emissiveIntensity: 0.18 });
    this.glowBase = glowMaterial();
    // (the photo sky is the backdrop: no geometric mountains)
    this.far = this.makeFar();
    this.far.visible = false;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f6a58, roughness: 1 }));
    // well below the asphalt: the post-processing depth buffer is coarse, a floor 2 cm under the road z-fights with it
    this.floor.position.y = -0.6;
    this.floor.receiveShadow = shadows;
    this.group.add(this.floor);
  }

  get count(): number {
    return this.tiles.size;
  }

  /** stream the tiles around (x, z); build at most `budget` per call; update the traffic lights */
  update(x: number, z: number, t: number, budget = 1): void {
    const [px, pz] = unwarp(x, z);
    const ci = Math.floor(px / PITCH);
    const cj = Math.floor(pz / PITCH);
    const R = this.radius;
    for (const [k, tl] of this.tiles)
      if (Math.abs(tl.i - ci) > R + 1 || Math.abs(tl.j - cj) > R + 1) {
        this.group.remove(tl.group);
        for (const g of tl.geos) g.dispose();
        tl.glow?.dispose();
        this.tiles.delete(k);
      }
    // nearest first
    const want: [number, number, number][] = [];
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) if (!this.tiles.has(`${i},${j}`)) want.push([i, j, Math.hypot(i + 0.5 - px / PITCH, j + 0.5 - pz / PITCH)]);
    want.sort((a, b) => a[2] - b[2]);
    for (let n = 0; n < Math.min(budget, want.length); n++) {
      const [i, j] = want[n];
      const tl = this.build(i, j);
      this.tiles.set(tl.key, tl);
    }
    for (const tl of this.tiles.values()) {
      if (!tl.glow) continue;
      const u = tl.glow.userData.uSig as { value: THREE.Vector2 };
      u.value.set(signal("x", tl.i, tl.j, t), signal("z", tl.i, tl.j, t));
    }
    this.floor.position.x = x;
    this.floor.position.z = z;
    this.far.position.set(x, 0, z);
  }

  // ------------------------------------------------------------------------------------------ one tile

  private build(i: number, j: number): Tile {
    const P = plan(i, j);
    const X0 = i * PITCH;
    const Z0 = j * PITCH;
    const G = { road: new Geo(), walk: new Geo(), ground: new Geo(), bldg: new Geo(), glass: new Geo(), leaf: new Geo(), glow: new Geo(), sign: new Geo(), flats: new Geo(), shop: new Geo(), curb: new Geo(), paint: new Geo() };
    const uLine = (2 * HW) / (2 * HW + PLAIN);
    const uPlain = (2 * HW + PLAIN / 2) / (2 * HW + PLAIN);
    // ---- streets this tile owns: along z at x = X0, along x at z = Z0, the crossroads (X0, Z0) - only where they
    // exist (open fields have no streets inside)
    const hasZ = segZ(i, j);
    const hasX = segX(j, i);
    const hasJ = junction(i, j);
    const field = P.kind === "dala";
    const yp = CURB_H;
    {
      const za = Z0 + HW;
      const zb = Z0 + PITCH - HW;
      const xa = X0 + HW;
      const xb = X0 + PITCH - HW;
      const ruv = (x0: number, z0: number, x1: number, z1: number) => [[x0 / 6, z0 / 6], [x0 / 6, z1 / 6], [x1 / 6, z1 / 6], [x1 / 6, z0 / 6]];
      const m = G.paint;
      const y = 0.004;
      if (hasZ) {
        G.road.flat(X0 - HW, za, X0 + HW, zb, 0, WHITE, ruv(X0 - HW, za, X0 + HW, zb));
        for (const o of [-0.09, 0.09]) m.flat(X0 + o - 0.06, za + 5.6, X0 + o + 0.06, zb - 5.6, y, PAINT);
        for (const o of [-HW + 0.35, HW - 0.35]) m.flat(X0 + o - 0.06, za, X0 + o + 0.06, zb, y, PAINT);
        for (const o of [-LANE, LANE]) for (let t = za + 7.6; t + 3 < zb - 5.6; t += 12) m.flat(X0 + o - 0.07, t, X0 + o + 0.07, t + 3, y, PAINT);
        for (let d = -HW + 0.6; d < HW - 0.5; d += 1) {
          m.flat(X0 + d, Z0 + HW + 1, X0 + d + 0.5, Z0 + HW + 5, y, PAINT);
          m.flat(X0 + d, Z0 + PITCH - HW - 5, X0 + d + 0.5, Z0 + PITCH - HW - 1, y, PAINT);
        }
        const sN = Z0 + PITCH - HW - STOP;
        const sS = Z0 + HW + STOP;
        m.flat(X0 - HW + 0.3, sN - 0.2, X0 - 0.2, sN + 0.2, y, PAINT);
        m.flat(X0 + 0.2, sS - 0.2, X0 + HW - 0.3, sS + 0.2, y, PAINT);
      } else G.ground.flat(X0 - HW, za, X0 + HW, zb, yp, GRASS);
      if (hasX) {
        G.road.flat(xa, Z0 - HW, xb, Z0 + HW, 0, WHITE, ruv(xa, Z0 - HW, xb, Z0 + HW));
        for (const o of [-0.09, 0.09]) m.flat(xa + 5.6, Z0 + o - 0.06, xb - 5.6, Z0 + o + 0.06, y, PAINT);
        for (const o of [-HW + 0.35, HW - 0.35]) m.flat(xa, Z0 + o - 0.06, xb, Z0 + o + 0.06, y, PAINT);
        for (const o of [-LANE, LANE]) for (let t = xa + 7.6; t + 3 < xb - 5.6; t += 12) m.flat(t, Z0 + o - 0.07, t + 3, Z0 + o + 0.07, y, PAINT);
        for (let d = -HW + 0.6; d < HW - 0.5; d += 1) {
          m.flat(X0 + HW + 1, Z0 + d, X0 + HW + 5, Z0 + d + 0.5, y, PAINT);
          m.flat(X0 + PITCH - HW - 5, Z0 + d, X0 + PITCH - HW - 1, Z0 + d + 0.5, y, PAINT);
        }
        const sE = X0 + PITCH - HW - STOP;
        const sW = X0 + HW + STOP;
        m.flat(sE - 0.2, Z0 + 0.2, sE + 0.2, Z0 + HW - 0.3, y, PAINT);
        m.flat(sW - 0.2, Z0 - HW + 0.3, sW + 0.2, Z0 - 0.2, y, PAINT);
      } else G.ground.flat(xa, Z0 - HW, xb, Z0 + HW, yp, GRASS);
      if (hasJ) G.road.flat(X0 - HW, Z0 - HW, X0 + HW, Z0 + HW, 0, WHITE, ruv(X0 - HW, Z0 - HW, X0 + HW, Z0 + HW));
      else G.ground.flat(X0 - HW, Z0 - HW, X0 + HW, Z0 + HW, yp, GRASS);
      void uLine;
      void uPlain;
    }
    // ---- pavement ring, curbs, tree strips (a field is grass right to the curb)
    const ox0 = X0 + HW;
    const ox1 = X0 + PITCH - HW;
    const oz0 = Z0 + HW;
    const oz1 = Z0 + PITCH - HW;
    const ix0 = X0 + WALK;
    const ix1 = X0 + PITCH - WALK;
    const iz0 = Z0 + WALK;
    const iz1 = Z0 + PITCH - WALK;
    const wuv = (x0: number, z0: number, x1: number, z1: number) => [[x0 / 2, z0 / 2], [x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2]];
    const ring: [number, number, number, number][] = [
      [ox0 + CURB, oz0 + CURB, ox1 - CURB, iz0],
      [ox0 + CURB, iz1, ox1 - CURB, oz1 - CURB],
      [ox0 + CURB, iz0, ix0, iz1],
      [ix1, iz0, ox1 - CURB, iz1],
    ];
    for (const [a, b, c, d] of ring) {
      if (field) G.ground.flat(a, b, c, d, yp, GRASS);
      else G.walk.flat(a, b, c, d, yp, WHITE, wuv(a, b, c, d));
    }
    // curbs: top strip + the face to the street (only where a street runs along)
    const cb = G.curb;
    const north = segX(j + 1, i);
    const east = segZ(i + 1, j);
    if (hasX) {
      cb.flat(ox0, oz0, ox1, oz0 + CURB, yp, CURBC);
      cb.wall(ox1, oz0, ox0, oz0, 0, yp, CURBC);
    } else G.ground.flat(ox0, oz0, ox1, oz0 + CURB, yp, GRASS);
    if (north) {
      cb.flat(ox0, oz1 - CURB, ox1, oz1, yp, CURBC);
      cb.wall(ox0, oz1, ox1, oz1, 0, yp, CURBC);
    } else G.ground.flat(ox0, oz1 - CURB, ox1, oz1, yp, GRASS);
    if (hasZ) {
      cb.flat(ox0, oz0 + CURB, ox0 + CURB, oz1 - CURB, yp, CURBC);
      cb.wall(ox0, oz0, ox0, oz1, 0, yp, CURBC);
    } else G.ground.flat(ox0, oz0 + CURB, ox0 + CURB, oz1 - CURB, yp, GRASS);
    if (east) {
      cb.flat(ox1 - CURB, oz0 + CURB, ox1, oz1 - CURB, yp, CURBC);
      cb.wall(ox1, oz1, ox1, oz0, 0, yp, CURBC);
    } else G.ground.flat(ox1 - CURB, oz0 + CURB, ox1, oz1 - CURB, yp, GRASS);
    if (!field && P.kind !== "yangi") {
      const g0 = 0.9;
      const g1 = 2.3;
      const e = 12;
      G.ground.flat(ox0 + e, oz0 + g0, ox1 - e, oz0 + g1, yp + 0.02, GRASS);
      G.ground.flat(ox0 + e, oz1 - g1, ox1 - e, oz1 - g0, yp + 0.02, GRASS);
      G.ground.flat(ox0 + g0, oz0 + e, ox0 + g1, oz1 - e, yp + 0.02, GRASS);
      G.ground.flat(ox1 - g1, oz0 + e, ox1 - g0, oz1 - e, yp + 0.02, GRASS);
    }
    // ---- block inside: lawns everywhere (the glass towers stand in a park, paths cross it)
    const inner = P.inner;
    G.ground.flat(inner.x0, inner.z0, inner.x1, inner.z1, yp, P.kind === "mahalla" ? DIRT : GRASS);
    if (P.kind === "yangi") {
      const mx = (inner.x0 + inner.x1) / 2;
      const mz = (inner.z0 + inner.z1) / 2;
      G.walk.flat(mx - 2.5, inner.z0, mx + 2.5, inner.z1, yp + 0.03, WHITE, wuv(mx - 2.5, inner.z0, mx + 2.5, inner.z1));
      G.walk.flat(inner.x0, mz - 2.5, inner.x1, mz + 2.5, yp + 0.03, WHITE, wuv(inner.x0, mz - 2.5, inner.x1, mz + 2.5));
    }
    // park paths (winding strips) and ponds (sky-reflecting water with a stone rim)
    for (const path of P.paths) {
      const hw2 = 1.3;
      let prev: number[] | null = null;
      for (let k = 0; k < path.length; k++) {
        const [x, z] = path[k];
        const [ax, az] = path[Math.max(0, k - 1)];
        const [bx, bz] = path[Math.min(path.length - 1, k + 1)];
        const dl = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / dl;
        const nz = -(bx - ax) / dl;
        const a = G.walk.v(x + nx * hw2, yp + 0.035, z + nz * hw2, C(0xc9c1b0), (x + nx * hw2) / 2, (z + nz * hw2) / 2);
        const b = G.walk.v(x - nx * hw2, yp + 0.035, z - nz * hw2, C(0xc9c1b0), (x - nx * hw2) / 2, (z - nz * hw2) / 2);
        if (prev) {
          G.walk.quad(prev[0], prev[1], b, a);
          G.walk.quad(prev[0], a, b, prev[1]);
        }
        prev = [a, b];
      }
    }
    for (const pond of P.ponds) {
      const n = pond.pts.length;
      const c0 = G.glass.v(pond.cx, yp + 0.05, pond.cz, C(0x2c4a58));
      const ids = pond.pts.map(([x, z]) => G.glass.v(x, yp + 0.05, z, C(0x3b5d6b)));
      for (let k = 0; k < n; k++) G.glass.idx.push(c0, ids[(k + 1) % n], ids[k]);
      // the stone rim
      for (let k = 0; k < n; k++) {
        const [ax, az] = pond.pts[k];
        const [bx, bz] = pond.pts[(k + 1) % n];
        const grow = (x: number, z: number, m: number) => [pond.cx + (x - pond.cx) * m, pond.cz + (z - pond.cz) * m];
        const [ox, oz] = grow(ax, az, 1.09);
        const [px, pz] = grow(bx, bz, 1.09);
        const q = [G.bldg.v(ax, yp + 0.18, az, STONE), G.bldg.v(bx, yp + 0.18, bz, STONE), G.bldg.v(px, yp + 0.12, pz, STONE), G.bldg.v(ox, yp + 0.12, oz, STONE)];
        G.bldg.quad(q[0], q[1], q[2], q[3]);
        G.bldg.quad(q[0], q[3], q[2], q[1]);
      }
    }
    if (P.kind === "yangi") {
      // a paved apron around each tower
      for (const b of P.buildings) G.walk.flat(b.x0 - 4, b.z0 - 4, b.x1 + 4, b.z1 + 4, yp + 0.02, WHITE, wuv(b.x0 - 4, b.z0 - 4, b.x1 + 4, b.z1 + 4));
    }
    for (const b of P.buildings) this.building(G, b, P);
    for (const p of P.posts) {
      // a tree pit only for the trees on the pavement (not in lawns, parks or fields)
      const onPavement = p.x < inner.x0 || p.x > inner.x1 || p.z < inner.z0 || p.z > inner.z1;
      if (p.kind === "tree" && !field && onPavement) G.ground.flat(p.x - 0.7, p.z - 0.7, p.x + 0.7, p.z + 0.7, yp + 0.025, C(0x4a3c2c));
      else if (p.kind === "lamp") this.lamp(G, p.x, p.z, X0, Z0);

    }
    if (hasJ && [segZ(i, j), segZ(i, j - 1), segX(j, i), segX(j, i - 1)].filter(Boolean).length >= 3) this.lights(G, X0, Z0);
    // ---- meshes
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    let glow: THREE.MeshBasicMaterial | null = null;
    const add = (g: Geo, m: THREE.Material, cast: boolean, recv: boolean) => {
      if (g.empty) return;
      const geo = g.build();
      geos.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = this.shadows && cast;
      mesh.receiveShadow = this.shadows && recv;
      group.add(mesh);
    };
    add(G.road, this.roadMat, false, true);
    add(G.paint, this.paintMat, false, true);
    add(G.curb, this.curbMat, false, true);
    add(G.walk, this.walkMat, false, true);
    add(G.ground, this.groundMat, false, true);
    add(G.bldg, this.bldgMat, true, true);
    add(G.glass, this.glassMat, false, false);
    add(G.leaf, this.leafMat, true, false);
    if (!G.glow.empty) {
      glow = this.glowBase.clone();
      glow.userData.uSig = { value: new THREE.Vector2(2, 0) };
      glow.onBeforeCompile = this.glowBase.onBeforeCompile;
      glow.customProgramCacheKey = this.glowBase.customProgramCacheKey;
      (glow.userData as { bind: (s: THREE.WebGLProgramParametersWithUniforms) => void }).bind = (s) => {
        s.uniforms.uSig = glow!.userData.uSig;
      };
      add(G.glow, glow, false, false);
    }
    add(G.flats, this.flatsMat, true, true);
    add(G.shop, this.shopMat, true, true);
    add(G.sign, this.signMat, false, false);
    this.group.add(group);
    return { key: `${i},${j}`, i, j, group, geos, glow };
  }

  private tree(G: Record<string, Geo>, x: number, z: number, y0: number, seed: number, scale: number): void {
    const h = (8 + ihash(seed, 1, 2) * 3) * scale;
    G.bldg.cyl(x, z, 0.22 * scale, 0.12 * scale, y0, y0 + h * 0.6, 8, BARK, false, BARK.clone().multiplyScalar(0.85));
    const top = y0 + h * 0.52;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = ihash(seed, k, 3) * Math.PI * 2;
      const rr = (0.3 + ihash(seed, k, 4) * 1.5) * (h / 9);
      const r = (1.3 + ihash(seed, k, 5) * 0.8) * (h / 9);
      const c = LEAVES[Math.floor(ihash(seed, k, 6) * LEAVES.length)];
      G.leaf.sphere(x + Math.cos(a) * rr, top + 0.8 + ihash(seed, k, 7) * h * 0.36, z + Math.sin(a) * rr, r, r * 0.9, r, c, 5, 9, false, 0.16, seed + k);
    }
  }

  private lamp(G: Record<string, Geo>, x: number, z: number, X0: number, Z0: number): void {
    // the arm reaches over the street: towards the nearest street centre line
    const dxs = [x - X0, x - (X0 + PITCH)];
    const dzs = [z - Z0, z - (Z0 + PITCH)];
    const ax = Math.abs(dxs[0]) < Math.abs(dxs[1]) ? dxs[0] : dxs[1];
    const az = Math.abs(dzs[0]) < Math.abs(dzs[1]) ? dzs[0] : dzs[1];
    const alongX = Math.abs(az) < Math.abs(ax);
    const ux = alongX ? 0 : -Math.sign(ax);
    const uz = alongX ? -Math.sign(az) : 0;
    G.bldg.cyl(x, z, 0.1, 0.065, CURB_H, 8.3, 8, POLE);
    const hx = x + ux * 2.2;
    const hz = z + uz * 2.2;
    G.bldg.box(Math.min(x, hx) - 0.04, Math.min(z, hz) - 0.04, Math.max(x, hx) + 0.04, Math.max(z, hz) + 0.04, 8.0, 8.08, POLE);
    G.bldg.cbox(hx, hz, 0.7, 0.7, 7.9, 8.02, POLE);
    G.glow.flat(hx - 0.28, hz - 0.28, hx + 0.28, hz + 0.28, 7.89, LAMPC);
    // (the glow quad faces up; the glow material is double sided so the lamp is seen from below)
  }

  /** four signal heads at the crossroads (X0, Z0), each facing the traffic that approaches on its right */
  private lights(G: Record<string, Geo>, X0: number, Z0: number): void {
    const o = HW + 1.1;
    // [corner x, corner z, facing x, facing z, axis code base]
    const heads: [number, number, number, number, number][] = [
      [X0 - o, Z0 - o, 0, -1, 4], // heading +z (comes from -z)
      [X0 + o, Z0 + o, 0, 1, 4], // heading -z
      [X0 - o, Z0 + o, -1, 0, 1], // heading +x (comes from -x)
      [X0 + o, Z0 - o, 1, 0, 1], // heading -x
    ];
    for (const [x, z, fx, fz, base] of heads) {
      G.bldg.cyl(x, z, 0.07, 0.07, CURB_H, 4.0, 8, POLE);
      G.bldg.cbox(x, z, 0.32, 0.32, 2.95, 3.95, C(0x15171a));
      for (let k = 0; k < 3; k++) {
        const y = 3.75 - k * 0.32;
        const r = 0.11;
        const cx = x + fx * 0.17;
        const cz = z + fz * 0.17;
        // a small quad facing (fx, fz)
        const px = -fz;
        const pz = fx;
        const code = base + k;
        const col = SIG_COL[k];
        const a = G.glow.v(cx - px * r, y - r, cz - pz * r, col, 0, 0, code);
        const b = G.glow.v(cx + px * r, y - r, cz + pz * r, col, 0, 0, code);
        const c = G.glow.v(cx + px * r, y + r, cz + pz * r, col, 0, 0, code);
        const d = G.glow.v(cx - px * r, y + r, cz - pz * r, col, 0, 0, code);
        G.glow.quad(a, b, c, d);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ buildings

  private building(G: Record<string, Geo>, b: Building, P: BlockPlan): void {
    const m = G.bldg;
    const yb = CURB_H;
    const seed = b.seed;
    if (b.style === "flats") this.flats(G, b);
    else if (b.style === "tower") {
      if (!b.model) this.tower(G, b);
    }
    else if (b.style === "house") this.house(G, b);
    else if (b.style === "wall") {
      const c = WALLC[Math.floor(ihash(seed, 1) * WALLC.length)];
      m.box(b.x0, b.z0, b.x1, b.z1, yb, yb + b.h, c, c.clone().multiplyScalar(0.85));
      // the gate, in the middle of the street side
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const gc = GATE[Math.floor(ihash(seed, 2) * GATE.length)];
      const along = b.x1 - b.x0 > b.z1 - b.z0;
      if (along) m.box(cx - 1.7, b.z0 - 0.05, cx + 1.7, b.z1 + 0.05, yb, yb + 2.6, gc);
      else m.box(b.x0 - 0.05, cz - 1.7, b.x1 + 0.05, cz + 1.7, yb, yb + 2.6, gc);
    } else if (b.style === "fence") {
      const along = b.x1 - b.x0 > b.z1 - b.z0;
      const L = along ? b.x1 - b.x0 : b.z1 - b.z0;
      for (let t = 0; t <= L; t += 2.5) {
        const x = along ? b.x0 + t : (b.x0 + b.x1) / 2;
        const z = along ? (b.z0 + b.z1) / 2 : b.z0 + t;
        m.cbox(x, z, 0.08, 0.08, yb, yb + b.h, C(0x2b2f33));
      }
      m.box(b.x0, b.z0, b.x1, b.z1, yb + b.h - 0.08, yb + b.h, C(0x2b2f33));
      m.box(b.x0, b.z0, b.x1, b.z1, yb + 0.25, yb + 0.31, C(0x2b2f33));
    } else if (b.style === "fountain") {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      m.cyl(cx, cz, 5, 5, yb, yb + 0.6, 28, STONE, false);
      m.cyl(cx, cz, 4.6, 4.6, yb + 0.6, yb, 28, STONE, false);
      m.flat(cx - 0.1, cz - 0.1, cx + 0.1, cz + 0.1, yb + 0.6, STONE);
      G.glass.cyl(cx, cz, 4.6, 4.6, yb + 0.45, yb + 0.45, 28, C(0x3c6f80), true);
      m.cyl(cx, cz, 0.5, 0.35, yb, yb + 2.2, 12, STONE);
      m.cyl(cx, cz, 1.4, 1.4, yb + 2.2, yb + 2.4, 16, STONE);
    } else if (b.style === "mosque") this.mosque(G, b);
    else if (b.style === "minaret") {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const r = (b.x1 - b.x0) / 2;
      m.cyl(cx, cz, r * 1.15, r * 1.15, yb, yb + 2, 16, STONE);
      m.cyl(cx, cz, r, r * 0.8, yb + 2, yb + b.h * 0.82, 16, STONE);
      for (let k = 0; k < 4; k++) {
        const y = yb + 6 + k * (b.h * 0.18);
        m.cyl(cx, cz, r * (1 - k * 0.04) + 0.04, r * (1 - k * 0.045) + 0.04, y, y + 1.2, 16, k % 2 ? TILE_TURQ : TILE_BLUE, false);
      }
      m.cyl(cx, cz, r * 1.3, r * 1.3, yb + b.h * 0.82, yb + b.h * 0.86, 16, STONE);
      m.cyl(cx, cz, r * 0.75, r * 0.75, yb + b.h * 0.86, yb + b.h * 0.93, 16, STONE);
      G.leaf.sphere(cx, yb + b.h * 0.93, cz, r * 0.8, r * 1.1, r * 0.8, TILE_TURQ, 8, 14, true);
    }
    void P;
  }

  /** Windows (frame + recessed-looking glass + sill) along a wall from p0 to p1 (outward on the right). */
  private windows(G: Record<string, Geo>, x0: number, z0: number, x1: number, z1: number, y0: number, floors: number, fh: number, step: number, glass: THREE.Color, balconies: boolean, wallC: THREE.Color): void {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / L;
    const dz = (z1 - z0) / L;
    const n = Math.max(1, Math.floor((L - 1.4) / step));
    const t0 = (L - (n - 1) * step) / 2;
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh;
      for (let k = 0; k < n; k++) {
        const t = t0 + k * step;
        G.bldg.onWall(x0, z0, dx, dz, t - 0.82, t + 0.82, y + 0.75, y + 2.45, 0.02, FRAME);
        G.glass.onWall(x0, z0, dx, dz, t - 0.7, t + 0.7, y + 0.86, y + 2.34, 0.045, glass.clone().multiplyScalar(0.85 + 0.3 * ihash(k, f, 9)));
        // sill: its top and front only (2 quads)
        G.bldg.onWall(x0, z0, dx, dz, t - 0.92, t + 0.92, y + 0.68, y + 0.75, 0.18, FRAME);
        {
          const nx = -dz;
          const nz = dx;
          const a0 = [x0 + dx * (t - 0.92), z0 + dz * (t - 0.92)];
          const a1 = [x0 + dx * (t + 0.92), z0 + dz * (t + 0.92)];
          const ids = [
            G.bldg.v(a0[0], y + 0.75, a0[1], FRAME),
            G.bldg.v(a0[0] + nx * 0.18, y + 0.75, a0[1] + nz * 0.18, FRAME),
            G.bldg.v(a1[0] + nx * 0.18, y + 0.75, a1[1] + nz * 0.18, FRAME),
            G.bldg.v(a1[0], y + 0.75, a1[1], FRAME),
          ];
          G.bldg.quad(ids[0], ids[1], ids[2], ids[3]);
        }
        if (balconies && f > 0 && k % 2 === 0) {
          G.bldg.outBox(x0, z0, dx, dz, t - 1.25, t + 1.25, 0, 1.25, y - 0.05, y + 0.08, wallC);
          G.bldg.outBox(x0, z0, dx, dz, t - 1.25, t + 1.25, 1.18, 1.25, y + 0.08, y + 1.0, wallC.clone().multiplyScalar(0.96));
        }
      }
    }
  }

  private flats(G: Record<string, Geo>, b: Building): void {
    const yb = CURB_H;
    const col = PLASTER[Math.floor(ihash(b.seed, 4) * PLASTER.length)];
    const SH = 4; // shop floor height (the facade_shop tile)
    const H = SH + (b.floors - 1) * 3 + 0.3;
    // roof + parapet
    G.bldg.flat(b.x0, b.z0, b.x1, b.z1, yb + H, ROOF);
    G.bldg.box(b.x0 - 0.1, b.z0 - 0.1, b.x1 + 0.1, b.z1 + 0.1, yb + H, yb + H + 0.4, col.clone().multiplyScalar(0.9), col.clone().multiplyScalar(0.75));
    const walls: [number, number, number, number, string][] = [
      [b.x1, b.z0, b.x0, b.z0, "-z"],
      [b.x0, b.z0, b.x0, b.z1, "-x"],
      [b.x0, b.z1, b.x1, b.z1, "+z"],
      [b.x1, b.z1, b.x1, b.z0, "+x"],
    ];
    const tint = col.clone().lerp(WHITE, 0.25);
    for (const [x0, z0, x1, z1, side] of walls) {
      const front = side === b.front;
      const L = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / L;
      const dz = (z1 - z0) / L;
      if (front) {
        G.shop.texWall(x0, z0, x1, z1, yb, yb + SH, WHITE, 3.2, SH, yb);
        G.flats.texWall(x0, z0, x1, z1, yb + SH, yb + H, tint, 3.2, 6, yb + SH);
        const si = Math.floor(ihash(b.seed, 11) * SIGNS.length);
        const SL = Math.min(L - 2, 11);
        const v0 = 1 - (si + 1) / SIGNS.length;
        const v1 = 1 - si / SIGNS.length;
        G.bldg.outBox(x0, z0, dx, dz, L / 2 - SL / 2 - 0.1, L / 2 + SL / 2 + 0.1, 0, 0.42, yb + 3.15, yb + 3.82, C(0x222226));
        G.sign.onWall(x0, z0, dx, dz, L / 2 - SL / 2, L / 2 + SL / 2, yb + 3.2, yb + 3.77, 0.43, WHITE, [[0, v0], [1, v0], [1, v1], [0, v1]]);
      } else {
        // the plain sides: the same flats tile from the ground (offset half a floor so the ground floor gets windows)
        G.flats.texWall(x0, z0, x1, z1, yb, yb + H, tint, 3.2, 6, yb - 0.6);
      }
    }
  }

  private tower(G: Record<string, Geo>, b: Building): void {
    const yb = CURB_H;
    const tint = TOWERC[Math.floor(ihash(b.seed, 1) * TOWERC.length)];
    const H = b.h;
    G.bldg.box(b.x0, b.z0, b.x1, b.z1, yb, yb + 4, C(0xbfc3c6));
    const walls: [number, number, number, number][] = [
      [b.x1, b.z0, b.x0, b.z0],
      [b.x0, b.z0, b.x0, b.z1],
      [b.x0, b.z1, b.x1, b.z1],
      [b.x1, b.z1, b.x1, b.z0],
    ];
    for (const [x0, z0, x1, z1] of walls) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / L;
      const dz = (z1 - z0) / L;
      G.glass.onWall(x0, z0, dx, dz, 0, L, yb + 4, yb + H, 0.0, tint);
      G.glow.onWall(x0, z0, dx, dz, 0.4, L - 0.4, yb + 0.3, yb + 3.6, 0.02, SHOP.clone().multiplyScalar(0.32));
      for (let t = 0; t <= L + 0.01; t += 1.6) G.bldg.outBox(x0, z0, dx, dz, t - 0.05, t + 0.05, 0, 0.12, yb + 4, yb + H, C(0xd5d9dc));
      for (let y = yb + 4; y < yb + H; y += 3.4) G.bldg.outBox(x0, z0, dx, dz, 0, L, 0, 0.1, y, y + 0.14, C(0xd5d9dc));
    }
    G.bldg.box(b.x0 + 0.3, b.z0 + 0.3, b.x1 - 0.3, b.z1 - 0.3, yb + H - 0.2, yb + H + 1.2, C(0x8c9196));
    G.bldg.box(b.x0 - 1.5, b.z0 - 1.5, b.x1 + 1.5, b.z1 + 1.5, yb + 3.9, yb + 4.3, C(0x6d7276));
  }

  private house(G: Record<string, Geo>, b: Building): void {
    const yb = CURB_H;
    const wc = WALLC[Math.floor(ihash(b.seed, 0) * WALLC.length)].clone().multiplyScalar(1.04);
    const H = b.h;
    G.bldg.box(b.x0, b.z0, b.x1, b.z1, yb, yb + H, wc);
    const walls: [number, number, number, number][] = [
      [b.x1, b.z0, b.x0, b.z0],
      [b.x0, b.z0, b.x0, b.z1],
      [b.x0, b.z1, b.x1, b.z1],
      [b.x1, b.z1, b.x1, b.z0],
    ];
    for (const [x0, z0, x1, z1] of walls) this.windows(G, x0, z0, x1, z1, yb, b.floors, 3, 3.4, GLASSC[0], false, wc);
    // gable tin roof along x
    const tin = TIN[Math.floor(ihash(b.seed, 4) * TIN.length)];
    const y0 = yb + H;
    const y1 = y0 + 2.2;
    const zm = (b.z0 + b.z1) / 2;
    const e = 0.5;
    const g = G.bldg;
    const q = (pts: number[][], c: THREE.Color) => {
      const ids = pts.map((p) => g.v(p[0], p[1], p[2], c, p[0] / 4, p[2] / 4));
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    };
    q([[b.x1 + e, y0, b.z0 - e], [b.x0 - e, y0, b.z0 - e], [b.x0 - e, y1, zm], [b.x1 + e, y1, zm]], tin);
    q([[b.x0 - e, y0, b.z1 + e], [b.x1 + e, y0, b.z1 + e], [b.x1 + e, y1, zm], [b.x0 - e, y1, zm]], tin.clone().multiplyScalar(0.82));
    for (const x of [b.x0, b.x1]) {
      const ids = [[x, y0, b.z0], [x, y0, b.z1], [x, y1, zm]].map((p) => g.v(p[0], p[1], p[2], wc));
      g.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[1]);
    }
  }

  private mosque(G: Record<string, Geo>, b: Building): void {
    const yb = CURB_H;
    const g = G.bldg;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    g.box(b.x0, b.z0, b.x1, b.z1, yb, yb + b.h, STONE, STONE.clone().multiplyScalar(0.9));
    // portal (pishtoq) on the front with a dark arch
    const pw = 14;
    g.box(cx - pw / 2, b.z0 - 2, cx + pw / 2, b.z0 + 1, yb, yb + b.h + 7, STONE);
    g.box(cx - pw / 2 - 0.2, b.z0 - 2.2, cx + pw / 2 + 0.2, b.z0 - 1.8, yb + b.h + 5.6, yb + b.h + 7, TILE_BLUE);
    G.glass.onWall(cx + 4, b.z0 - 2, -1, 0, 0, 8, yb, yb + b.h + 2, 0.03, C(0x20262c));
    for (let k = 0; k < 6; k++) g.onWall(cx + 4.2, b.z0 - 2, -1, 0, k * 1.4, k * 1.4 + 0.7, yb + b.h + 2.2, yb + b.h + 5.2, 0.04, k % 2 ? TILE_TURQ : TILE_BLUE);
    // drum + dome
    g.cyl(cx, cz + 2, 8.5, 8.5, yb + b.h, yb + b.h + 4, 28, TILE_BLUE, false);
    G.leaf.sphere(cx, yb + b.h + 4, cz + 2, 8.7, 10.5, 8.7, TILE_TURQ, 12, 28, true);
    g.cyl(cx, cz + 2, 0.15, 0.05, yb + b.h + 14.3, yb + b.h + 16.5, 6, C(0xd4af37));
    // arched windows along the sides
    for (const [x0, z0, x1, z1] of [[b.x0, b.z0, b.x0, b.z1], [b.x1, b.z1, b.x1, b.z0], [b.x0, b.z1, b.x1, b.z1]] as [number, number, number, number][]) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / L;
      const dz = (z1 - z0) / L;
      for (let t = 3; t < L - 2; t += 4) G.glass.onWall(x0, z0, dx, dz, t - 0.9, t + 0.9, yb + 2, yb + 7, 0.03, C(0x1e2a33));
      g.onWall(x0, z0, dx, dz, 0, L, yb + b.h - 1.4, yb + b.h - 0.6, 0.03, TILE_BLUE);
    }
  }

  /** distant mountains (no fog: a hazy silhouette on the horizon) */
  private makeFar(): THREE.Mesh {
    const g = new Geo();
    const rock = new THREE.Color();
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + ihash(i, 1, 1) * 0.1;
      const h = 90 + Math.pow(ihash(i, 2, 1), 1.5) * 300;
      const R = 1500 * (0.92 + 0.16 * ihash(i, 3, 1));
      const w = h * (1.6 + ihash(i, 4, 1));
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const n = 12;
      const levels = [0, 0.35, 0.65, 0.88, 1];
      const ids: number[][] = [];
      levels.forEach((lv, li) => {
        const row: number[] = [];
        for (let k = 0; k <= n; k++) {
          const b = ((k % n) / n) * Math.PI * 2;
          const j = li === levels.length - 1 ? 0 : 0.75 + 0.5 * ihash(i, li, k % n);
          const r = w * (1 - lv) ** 1.2 * j;
          rock.set(0x9aa6b4).lerp(new THREE.Color(0xeef2f6), lv > 0.6 && h > 220 ? (lv - 0.6) * 2.2 : 0);
          row.push(g.v(x + Math.cos(b) * r, h * lv, z + Math.sin(b) * r, rock));
        }
        ids.push(row);
      });
      for (let li = 0; li < levels.length - 1; li++) for (let k = 0; k < n; k++) g.quad(ids[li][k], ids[li + 1][k], ids[li + 1][k + 1], ids[li][k + 1]);
    }
    const m = new THREE.Mesh(g.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
    m.frustumCulled = false;
    m.renderOrder = -2;
    return m;
  }

  dispose(): void {
    for (const t of this.tiles.values()) {
      for (const g of t.geos) g.dispose();
      t.glow?.dispose();
    }
    this.tiles.clear();
    this.far.geometry.dispose();
    (this.far.material as THREE.Material).dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    for (const m of [this.roadMat, this.walkMat, this.groundMat, this.curbMat, this.paintMat, this.bldgMat, this.glassMat, this.leafMat, this.signMat, this.glowBase, this.flatsMat, this.shopMat]) {
      const mm = m as THREE.MeshStandardMaterial;
      mm.normalMap?.dispose();
      mm.roughnessMap?.dispose();
      mm.map?.dispose();
      m.dispose();
    }
  }
}

/** Unlit vertex-colour material whose `lamp` attribute switches traffic-light lamps by the per-tile signal state. */
function glowMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  m.onBeforeCompile = function (this: THREE.MeshBasicMaterial, s) {
    (this.userData as { bind?: (s: THREE.WebGLProgramParametersWithUniforms) => void }).bind?.(s);
    if (!s.uniforms.uSig) s.uniforms.uSig = { value: new THREE.Vector2(2, 0) };
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nattribute float lamp;\nvarying float vLamp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLamp = lamp;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLamp;\nuniform vec2 uSig;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vLamp > 0.5) {
          float code = floor(vLamp + 0.5) - 1.0;
          float axisZ = step(2.5, code);
          float idx = code - axisZ * 3.0;
          float state = mix(uSig.x, uSig.y, axisZ);
          diffuseColor.rgb *= (abs(idx - state) < 0.5) ? 1.6 : 0.06;
        }`,
      );
  };
  m.customProgramCacheKey = () => "poyga-glow";
  return m;
}

export { SIGNS };
