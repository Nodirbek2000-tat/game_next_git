// Open-world city plan: an endless grid of streets (every PITCH metres, both axes) with a block between each four
// crossroads. Everything is a pure function of the block indices (deterministic, no three.js), so the renderer, the car
// physics (collisions) and the traffic all read the same plan. World axes: x, z on the ground, y up.

export const PITCH = 120;
/** street half width: 2 lanes each way */
export const HW = 7;
export const LANE = 3.5;
export const CURB = 0.3;
/** pavement outer edge (= building line), measured from the street centre */
export const WALK = 13;
export const CURB_H = 0.15;
/** distance from the junction edge to the stop line */
export const STOP = 6.5;

export type BlockKind = "markaz" | "yangi" | "mahalla" | "bog" | "dala";

/** Integer hash -> [0, 1). */
export function ihash(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** the downtown (skyscrapers) is around this block */
export const DOWNTOWN: [number, number] = [3, 3];

/**
 * Open fields (dala): in some 6 x 6 block cells the inner 4 x 4 blocks are one big meadow (480 x 480 m) with no
 * buildings and no streets inside: free driving on the grass. The streets around the field stay.
 */
const FIELD_CELL = 6;
export function isField(i: number, j: number): boolean {
  const ci = Math.floor(i / FIELD_CELL);
  const cj = Math.floor(j / FIELD_CELL);
  const li = i - ci * FIELD_CELL;
  const lj = j - cj * FIELD_CELL;
  if (li < 1 || li > 4 || lj < 1 || lj > 4) return false;
  // never at the start or in the downtown
  if (ci === 0 && cj === 0) return false;
  if (Math.abs(ci * FIELD_CELL + 2.5 - DOWNTOWN[0]) < 5 && Math.abs(cj * FIELD_CELL + 2.5 - DOWNTOWN[1]) < 5) return false;
  return ihash(ci, cj, 21) < 0.38;
}

/** Street segments: along z at x = a * PITCH between z = k * PITCH .. (k + 1) * PITCH; along x likewise. A segment
 * between two field blocks does not exist (the meadow is continuous). */
export function segZ(a: number, k: number): boolean {
  return !(isField(a - 1, k) && isField(a, k));
}
export function segX(b: number, k: number): boolean {
  return !(isField(k, b - 1) && isField(k, b));
}
/** a crossroads (a, b) exists when any of its four arms does */
export function junction(a: number, b: number): boolean {
  return segZ(a, b) || segZ(a, b - 1) || segX(b, a) || segX(b, a - 1);
}

export function blockKind(i: number, j: number): BlockKind {
  if (isField(i, j)) return "dala";
  // districts of 3 x 3 blocks, a few special blocks; a dense downtown of towers
  const d = ihash(Math.floor(i / 3), Math.floor(j / 3), 11);
  const l = ihash(i, j, 3);
  if (i === 0 && j === 0) return "markaz";
  const dd = Math.hypot(i - DOWNTOWN[0], j - DOWNTOWN[1]);
  if (dd < 3.2 && l > 0.08) return l < 0.14 ? "bog" : "yangi";
  if (l < 0.11) return "bog";
  if (d < 0.5) return "markaz";
  if (d < 0.72) return "yangi";
  return "mahalla";
}

/** Axis-aligned box on the ground (x0 < x1, z0 < z1). */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type BuildingStyle = "flats" | "tower" | "house" | "wall" | "fence" | "mosque" | "minaret" | "fountain" | "water";

export type TowerModel = "deco" | "burama" | "pogona" | "ochqich" | "minora" | "ofis_0" | "ofis_1" | "ofis_2";
/** footprints of the Blender towers (model space, metres; x = west-east, z = south-north) */
export const TOWER_FOOT: Record<TowerModel, [number, number, number, number]> = {
  deco: [-30, -23, 30, 24],
  burama: [-34, -38, 41, 38],
  pogona: [-34, -34, 34, 34],
  ochqich: [-29, -31, 29, 31],
  minora: [-19, -31, 36, 31],
  ofis_0: [-20, -18, 20, 18],
  ofis_1: [-21, -18, 21, 18],
  ofis_2: [-23, -14, 23, 14],
};

export interface Building extends Box {
  style: BuildingStyle;
  /** a Blender tower drawn instead of the box (style "tower") */
  model?: TowerModel;
  /** where the model's origin goes */
  mx?: number;
  mz?: number;
  /** total height (m) */
  h: number;
  floors: number;
  /** the side facing the street: shops / gates there ("-x", "+x", "-z", "+z") */
  front: "-x" | "+x" | "-z" | "+z" | null;
  seed: number;
  /** solid for the car */
  solid: boolean;
}

export interface Post {
  x: number;
  z: number;
  r: number;
  kind: "tree" | "lamp" | "light" | "bench" | "rim";
  seed: number;
  /** tree species: poplars line the streets, plane trees in yards and parks */
  sp?: "terak" | "chinor" | "kocha";
  /** facing (benches) */
  rot?: number;
}

export interface Pond {
  /** outline (closed, CCW) */
  pts: [number, number][];
  cx: number;
  cz: number;
}

export interface BlockPlan {
  i: number;
  j: number;
  kind: BlockKind;
  /** inner area (inside the pavement ring) */
  inner: Box;
  buildings: Building[];
  posts: Post[];
  /** park paths: polylines (width 2.6 m) */
  paths: [number, number][][];
  ponds: Pond[];
}

/**
 * Natural scatter: points grouped in clumps around a few seeds (like trees that grew there), never closer than
 * `minD`, kept out of `avoid`. Deterministic for (i, j, salt).
 */
function scatter(i: number, j: number, salt: number, area: Box, n: number, minD: number, clumps: number, spread: number, avoid: (x: number, z: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  const seeds: [number, number][] = [];
  for (let c = 0; c < clumps; c++) seeds.push([area.x0 + ihash(i, j, salt + c * 3) * (area.x1 - area.x0), area.z0 + ihash(i, j, salt + c * 3 + 1) * (area.z1 - area.z0)]);
  for (let t = 0; t < n * 12 && out.length < n; t++) {
    let x: number;
    let z: number;
    if (ihash(i, j, salt + 500 + t) < 0.8) {
      // near a clump seed (gaussian-ish fall-off)
      const sd = seeds[Math.floor(ihash(i, j, salt + 900 + t) * seeds.length)];
      const a = ihash(i, j, salt + 1300 + t) * Math.PI * 2;
      const d = spread * Math.sqrt(-2 * Math.log(Math.max(1e-4, ihash(i, j, salt + 1700 + t)))) * 0.6;
      x = sd[0] + Math.cos(a) * d;
      z = sd[1] + Math.sin(a) * d;
    } else {
      x = area.x0 + ihash(i, j, salt + 2100 + t) * (area.x1 - area.x0);
      z = area.z0 + ihash(i, j, salt + 2500 + t) * (area.z1 - area.z0);
    }
    if (x < area.x0 || x > area.x1 || z < area.z0 || z > area.z1) continue;
    if (avoid(x, z)) continue;
    if (out.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < minD * minD)) continue;
    out.push([x, z]);
  }
  return out;
}

/** distance from (x, z) to a polyline */
export function distToPath(x: number, z: number, path: [number, number][]): number {
  let best = 1e9;
  for (let k = 0; k < path.length - 1; k++) {
    const [ax, az] = path[k];
    const [bx, bz] = path[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

export function inPond(x: number, z: number, p: Pond): boolean {
  let inside = false;
  const P = p.pts;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    if (P[a][1] > z !== P[b][1] > z && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) inside = !inside;
  }
  return inside;
}

const cache = new Map<string, BlockPlan>();

/** The plan of block (i, j) (cached; the cache is trimmed by `forgetFar`). */
export function plan(i: number, j: number): BlockPlan {
  const key = `${i},${j}`;
  let p = cache.get(key);
  if (!p) {
    p = makePlan(i, j);
    cache.set(key, p);
  }
  return p;
}

export function forgetFar(ci: number, cj: number, r: number): void {
  for (const [k, p] of cache) if (Math.abs(p.i - ci) > r || Math.abs(p.j - cj) > r) cache.delete(k);
}

function makePlan(i: number, j: number): BlockPlan {
  const kind = blockKind(i, j);
  const X0 = i * PITCH;
  const Z0 = j * PITCH;
  const inner: Box = { x0: X0 + WALK, z0: Z0 + WALK, x1: X0 + PITCH - WALK, z1: Z0 + PITCH - WALK };
  const B: Building[] = [];
  const posts: Post[] = [];
  const paths: [number, number][][] = [];
  const ponds: Pond[] = [];
  const r = (n: number) => ihash(i, j, 100 + n);
  // street trees and lamps along the four sides of the block (on the pavement)
  const sides: { a: [number, number]; b: [number, number]; o: [number, number] }[] = [
    { a: [X0 + HW, Z0 + HW], b: [X0 + PITCH - HW, Z0 + HW], o: [0, 1] },
    { a: [X0 + HW, Z0 + PITCH - HW], b: [X0 + PITCH - HW, Z0 + PITCH - HW], o: [0, -1] },
    { a: [X0 + HW, Z0 + HW], b: [X0 + HW, Z0 + PITCH - HW], o: [1, 0] },
    { a: [X0 + PITCH - HW, Z0 + HW], b: [X0 + PITCH - HW, Z0 + PITCH - HW], o: [-1, 0] },
  ];
  if (kind !== "dala") sides.forEach((s, si) => {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const dx = (s.b[0] - s.a[0]) / len;
    const dz = (s.b[1] - s.a[1]) / len;
    if (kind !== "yangi")
      for (let t = 14 + ihash(i, j, 40 + si) * 6; t < len - 14; t += 9 + ihash(i, j, 50 + si * 97 + Math.floor(t)) * 8) {
        if (ihash(i, j, 60 + si * 131 + Math.floor(t)) < 0.12) continue; // a gap: a tree that was never planted
        const wob = (ihash(i, j, 70 + si * 7 + Math.floor(t)) - 0.5) * 0.7;
        posts.push({ x: s.a[0] + dx * t + s.o[0] * (1.6 + wob), z: s.a[1] + dz * t + s.o[1] * (1.6 + wob), r: 0.3, kind: "tree", seed: i * 7919 + j * 104729 + si * 31 + t, sp: kind === "mahalla" ? "terak" : kind === "bog" ? "chinor" : "kocha" });
      }
    for (let t = 20; t < len - 18; t += 32) posts.push({ x: s.a[0] + dx * t + s.o[0] * 0.65, z: s.a[1] + dz * t + s.o[1] * 0.65, r: 0.14, kind: "lamp", seed: si * 7 + t });
  });
  // traffic light poles at this block's south-west crossroads (x = X0, z = Z0): four corners
  const arms = [segZ(i, j), segZ(i, j - 1), segX(j, i), segX(j, i - 1)].filter(Boolean).length;
  if (arms >= 3)
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
    posts.push({ x: X0 + sx * (HW + 1.1), z: Z0 + sz * (HW + 1.1), r: 0.1, kind: "light", seed: sx * 2 + sz });

  const { x0, z0, x1, z1 } = inner;
  const W = x1 - x0;
  if (kind === "markaz") {
    // perimeter blocks of flats around a green courtyard; shops on the street side
    const D = 13;
    const split = (a: number, b: number, n: number, gap: number) => {
      const out: [number, number][] = [];
      const L = (b - a - gap * (n - 1)) / n;
      for (let k = 0; k < n; k++) out.push([a + k * (L + gap), a + k * (L + gap) + L]);
      return out;
    };
    const floorsOf = (n: number) => 5 + Math.floor(r(n) * 5);
    const add = (b: Box, front: Building["front"], n: number) => {
      const fl = floorsOf(n);
      B.push({ ...b, style: "flats", floors: fl, h: fl * 3 + 0.9, front, seed: i * 1009 + j * 9173 + n, solid: true });
    };
    const nS = 2 + Math.floor(r(1) * 2);
    split(x0, x1, nS, 6).forEach(([a, b], k) => add({ x0: a, z0, x1: b, z1: z0 + D }, "-z", 10 + k));
    split(x0, x1, 2 + Math.floor(r(2) * 2), 6).forEach(([a, b], k) => add({ x0: a, z0: z1 - D, x1: b, z1 }, "+z", 20 + k));
    split(z0 + D + 6, z1 - D - 6, 1 + Math.floor(r(3) * 2), 6).forEach(([a, b], k) => add({ x0, z0: a, x1: x0 + D, z1: b }, "-x", 30 + k));
    split(z0 + D + 6, z1 - D - 6, 1 + Math.floor(r(4) * 2), 6).forEach(([a, b], k) => add({ x0: x1 - D, z0: a, x1, z1: b }, "+x", 40 + k));
    const yard: Box = { x0: x0 + D + 5, z0: z0 + D + 5, x1: x1 - D - 5, z1: z1 - D - 5 };
    for (const [x, z] of scatter(i, j, 4000, yard, 16, 4.5, 3, 9, () => false)) posts.push({ x, z, r: 0.3, kind: "tree", seed: Math.floor(x * 11 + z * 5), sp: "chinor" });
  } else if (kind === "yangi") {
    // the skyline: one landmark tower, or one / two glass offices (Blender models)
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const big: TowerModel[] = ["burama", "ochqich", "pogona", "deco", "minora"];
    const dd = Math.hypot(i - DOWNTOWN[0], j - DOWNTOWN[1]);
    const tower = (m: TowerModel, mx: number, mz: number, seed: number) => {
      const f = TOWER_FOOT[m];
      B.push({ x0: mx + f[0], z0: mz + f[1], x1: mx + f[2], z1: mz + f[3], style: "tower", model: m, mx, mz, floors: 0, h: 200, front: null, seed, solid: true });
    };
    if (r(5) < (dd < 1.6 ? 0.75 : 0.18)) tower(big[Math.floor(r(6) * big.length)], cx, cz, i * 31 + j);
    else if (r(7) < 0.5) tower((["ofis_0", "ofis_1", "ofis_2"] as TowerModel[])[Math.floor(r(8) * 3)], cx, cz, i * 37 + j);
    else {
      tower((["ofis_0", "ofis_2"] as TowerModel[])[Math.floor(r(9) * 2)], x0 + 24, z0 + 22, i * 41 + j);
      tower((["ofis_1", "ofis_0"] as TowerModel[])[Math.floor(r(10) * 2)], x1 - 24, z1 - 22, i * 43 + j);
    }
    for (let k = 0; k < 6; k++) {
      const x = x0 + 4 + r(70 + k) * (W - 8);
      const z = z0 + 4 + r(80 + k) * (W - 8);
      if (B.some((b) => x > b.x0 - 3 && x < b.x1 + 3 && z > b.z0 - 3 && z < b.z1 + 3)) continue;
      posts.push({ x, z, r: 0.3, kind: "tree", seed: k * 13 + j, sp: "chinor" });
    }
  } else if (kind === "mahalla") {
    // lots along the perimeter: a high wall on the street with a gate, a house with a tin roof inside
    const n = 3;
    const L = W / n;
    const lot = (bx0: number, bz0: number, bx1: number, bz1: number, front: Building["front"], k: number) => {
      const t = 0.35;
      const wall: Box =
        front === "-z" ? { x0: bx0, z0: bz0, x1: bx1, z1: bz0 + t } : front === "+z" ? { x0: bx0, z0: bz1 - t, x1: bx1, z1: bz1 } : front === "-x" ? { x0: bx0, z0: bz0, x1: bx0 + t, z1: bz1 } : { x0: bx1 - t, z0: bz0, x1: bx1, z1: bz1 };
      B.push({ ...wall, style: "wall", floors: 1, h: 2.4, front, seed: i * 71 + j * 53 + k, solid: true });
      const inset = 6;
      const hs = 10 + ihash(i, j, 300 + k) * 3;
      const cx = (bx0 + bx1) / 2;
      const cz = (bz0 + bz1) / 2;
      const ox = front === "-x" ? inset : front === "+x" ? -inset : 0;
      const oz = front === "-z" ? inset : front === "+z" ? -inset : 0;
      const fl = ihash(i, j, 400 + k) > 0.55 ? 2 : 1;
      B.push({ x0: cx + ox - hs / 2, z0: cz + oz - hs / 2, x1: cx + ox + hs / 2, z1: cz + oz + hs / 2, style: "house", floors: fl, h: fl * 3, front, seed: i * 13 + j * 29 + k, solid: true });
      posts.push({ x: cx - ox * 0.2 + (ihash(i, j, 500 + k) - 0.5) * 8, z: cz - oz * 0.2 + (ihash(i, j, 600 + k) - 0.5) * 8, r: 0.25, kind: "tree", seed: k * 7 + i, sp: "chinor" });
    };
    let k = 0;
    for (let a = 0; a < n; a++) {
      lot(x0 + a * L, z0, x0 + (a + 1) * L, z0 + L, "-z", k++);
      lot(x0 + a * L, z1 - L, x0 + (a + 1) * L, z1, "+z", k++);
    }
    lot(x0, z0 + L, x0 + L, z1 - L, "-x", k++);
    lot(x1 - L, z0 + L, x1, z1 - L, "+x", k++);
    for (let q = 0; q < 6; q++) posts.push({ x: x0 + L + 4 + ihash(i, j, 700 + q) * (L - 8), z: z0 + L + 4 + ihash(i, j, 800 + q) * (L - 8), r: 0.3, kind: "tree", seed: q * 11 + j, sp: "chinor" });
  } else if (kind === "bog") {
    // a real park: winding paths between the gates, often a pond, dense clumps of trees, open lawns, benches
    const t = 0.15;
    const mid = (x0 + x1) / 2;
    const midz = (z0 + z1) / 2;
    const gx = mid + (r(11) - 0.5) * 30;
    const gz = midz + (r(12) - 0.5) * 30;
    const gate = 4;
    for (const [a, b] of [[x0, gx - gate], [gx + gate, x1]]) {
      B.push({ x0: a, z0, x1: b, z1: z0 + t, style: "fence", floors: 1, h: 1.1, front: null, seed: 1, solid: true });
      B.push({ x0: a, z0: z1 - t, x1: b, z1, style: "fence", floors: 1, h: 1.1, front: null, seed: 2, solid: true });
    }
    for (const [a, b] of [[z0, gz - gate], [gz + gate, z1]]) {
      B.push({ x0, z0: a, x1: x0 + t, z1: b, style: "fence", floors: 1, h: 1.1, front: null, seed: 3, solid: true });
      B.push({ x0: x1 - t, z0: a, x1, z1: b, style: "fence", floors: 1, h: 1.1, front: null, seed: 4, solid: true });
    }
    // a pond (irregular outline) in most parks
    const pc: [number, number] = [mid + (r(13) - 0.5) * 24, midz + (r(14) - 0.5) * 24];
    if (r(15) < 0.7) {
      const R = 9 + r(16) * 7;
      const pts: [number, number][] = [];
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const rr = R * (0.75 + 0.5 * ihash(i, j, 1400 + k)) * (k % 2 ? 1 : 0.92);
        pts.push([pc[0] + Math.cos(a) * rr * 1.3, pc[1] + Math.sin(a) * rr]);
      }
      ponds.push({ pts, cx: pc[0], cz: pc[1] });
      // the water is not driveable: collision posts all along the shore (the car stops at the stone rim)
      for (let k = 0; k < pts.length; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[(k + 1) % pts.length];
        const L = Math.hypot(bx - ax, bz - az);
        for (let q = 0; q < L; q += 1.2) posts.push({ x: ax + ((bx - ax) * q) / L, z: az + ((bz - az) * q) / L, r: 0.7, kind: "rim", seed: k });
      }
    }
    // winding paths: gate to gate through a bend, and one around the pond
    const bend = (ax: number, az: number, bx: number, bz: number, k: number): [number, number][] => {
      const out: [number, number][] = [];
      const cx = (ax + bx) / 2 + (ihash(i, j, 1500 + k) - 0.5) * 34;
      const cz = (az + bz) / 2 + (ihash(i, j, 1600 + k) - 0.5) * 34;
      for (let q = 0; q <= 14; q++) {
        const u = q / 14;
        const w = Math.sin(u * Math.PI * 2) * 3 * (ihash(i, j, 1700 + k) - 0.5);
        out.push([(1 - u) * (1 - u) * ax + 2 * (1 - u) * u * cx + u * u * bx + w, (1 - u) * (1 - u) * az + 2 * (1 - u) * u * cz + u * u * bz - w]);
      }
      return out;
    };
    paths.push(bend(gx, z0, gx + (r(17) - 0.5) * 20, z1, 0));
    paths.push(bend(x0, gz, x1, gz + (r(18) - 0.5) * 20, 1));
    if (ponds.length) {
      const ring: [number, number][] = ponds[0].pts.map(([x, z]) => [pc[0] + (x - pc[0]) * 1.35, pc[1] + (z - pc[1]) * 1.4]);
      ring.push(ring[0]);
      paths.push(ring);
    }
    const nearPath = (x: number, z: number, m: number) => paths.some((pth) => distToPath(x, z, pth) < m);
    // inside the pond outline grown by about m metres
    const wet = (x: number, z: number, m: number) => ponds.some((p) => inPond(x, z, { ...p, pts: p.pts.map(([px, pz]) => [p.cx + (px - p.cx) * (1 + m / 10), p.cz + (pz - p.cz) * (1 + m / 10)] as [number, number]) }));
    const area: Box = { x0: x0 + 3, z0: z0 + 3, x1: x1 - 3, z1: z1 - 3 };
    for (const [x, z] of scatter(i, j, 3000, area, 85, 4.2, 6, 14, (x, z) => nearPath(x, z, 3.2) || wet(x, z, 4)))
      posts.push({ x, z, r: 0.35, kind: "tree", seed: Math.floor(x * 13 + z * 7), sp: ihash(Math.floor(x), Math.floor(z), 5) < 0.2 ? "terak" : "chinor" });
    // benches along the paths, facing the path
    for (let k = 0; k < paths.length; k++)
      for (let q = 2; q < paths[k].length - 2; q += 4) {
        const [ax, az] = paths[k][q];
        const [bx, bz] = paths[k][q + 1];
        const d = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / d;
        const nz = -(bx - ax) / d;
        posts.push({ x: ax + nx * 2.4, z: az + nz * 2.4, r: 0, kind: "bench", seed: k * 31 + q, rot: Math.atan2(-nx, -nz) });
      }
  } else if (kind === "dala") {
    // the meadow: a few groves and lone trees, the rest open grass
    const area: Box = { x0: X0 + 4, z0: Z0 + 4, x1: X0 + PITCH - 4, z1: Z0 + PITCH - 4 };
    const n = Math.floor(8 + r(30) * 26);
    for (const [x, z] of scatter(i, j, 5000, area, n, 5, 1 + Math.floor(r(31) * 3), 10, () => false))
      posts.push({ x, z, r: 0.35, kind: "tree", seed: Math.floor(x * 17 + z * 3), sp: ihash(Math.floor(x), Math.floor(z), 9) < 0.3 ? "terak" : "chinor" });
  }
  // no tree / bench inside or against a building (a crown reaches ~3 m): drop what overlaps
  const clear = posts.filter((p) => {
    if (p.kind === "lamp" || p.kind === "light" || p.kind === "rim") return true;
    // nothing on the asphalt (a tree keeps ~3 m off it, its crown must not hang over the lanes) or in a pond
    // (the street trees on the pavement stand 2 m from the curb by design)
    const yardTree = p.kind === "tree" && (kind === "dala" || (p.x > inner.x0 && p.x < inner.x1 && p.z > inner.z0 && p.z < inner.z1));
    const off = yardTree ? 3 : 0.5;
    if ([[0, 0], [off, 0], [-off, 0], [0, off], [0, -off]].some(([dx, dz]) => onRoad(p.x + dx, p.z + dz))) return false;
    if (ponds.some((pd) => inPond(p.x, p.z, pd))) return false;
    if (p.kind === "bench") return true;
    const m = p.kind === "tree" ? 3 : 1;
    return !B.some((b) => {
      const mm = b.style === "wall" || b.style === "fence" ? Math.min(m, 1.2) : m;
      return p.x > b.x0 - mm && p.x < b.x1 + mm && p.z > b.z0 - mm && p.z < b.z1 + mm;
    });
  });
  return { i, j, kind, inner, buildings: B, posts: clear, paths, ponds };
}

// ---------------------------------------------------------------------------------------------------- traffic lights

/** Signal state for traffic moving along `axis` ("x" or "z") at crossroads (i, j): 0 red, 1 yellow, 2 green. */
export const CYCLE = 28;
export function signal(axis: "x" | "z", i: number, j: number, t: number): 0 | 1 | 2 {
  const off = ihash(i, j, 77) * CYCLE;
  let u = (t + off) % CYCLE;
  if (axis === "z") u = (u + CYCLE / 2) % CYCLE;
  return u < 11.5 ? 2 : u < 14 ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------- queries

export const blockOf = (x: number, z: number): [number, number] => [Math.floor(x / PITCH), Math.floor(z / PITCH)];

/** Is (x, z) on the asphalt (an existing street or crossroads)? */
export function onRoad(x: number, z: number): boolean {
  const a = Math.round(x / PITCH);
  const b = Math.round(z / PITCH);
  const nearX = Math.abs(x - a * PITCH) < HW;
  const nearZ = Math.abs(z - b * PITCH) < HW;
  if (nearX && nearZ) return junction(a, b);
  if (nearX) return segZ(a, Math.floor(z / PITCH));
  if (nearZ) return segX(b, Math.floor(x / PITCH));
  return false;
}

/** Ground height under (x, z): 0 on the asphalt, the curb height on pavements / in blocks. */
export function groundY(x: number, z: number): number {
  return onRoad(x, z) ? 0 : CURB_H;
}

// ---------------------------------------------------------------------------------------------------- the warp

/**
 * The plan is a grid; the world is that grid gently bent: every street curves a little, crossroads are not exactly
 * square. world = warp(plan). x' depends on z only and z' on x only, so the inverse is a quick fixed point.
 * The slopes stay below ~0.16 (a street turns at most ~9 degrees over a few hundred metres).
 */
const WA = 24;
const WL = 300;
const WB = 8;
const WM = 97;
const fx = (z: number) => WA * Math.sin(z / WL + 1.3) + WB * Math.sin(z / WM + 0.4);
const fz = (x: number) => WA * Math.sin(x / WL + 2.1) + WB * Math.sin(x / WM + 1.7);
const dfx = (z: number) => (WA / WL) * Math.cos(z / WL + 1.3) + (WB / WM) * Math.cos(z / WM + 0.4);
const dfz = (x: number) => (WA / WL) * Math.cos(x / WL + 2.1) + (WB / WM) * Math.cos(x / WM + 1.7);

export const warpX = (x: number, z: number): number => x + fx(z);
export const warpZ = (x: number, z: number): number => z + fz(x);

/** world -> plan */
export function unwarp(wx: number, wz: number, out: [number, number] = [0, 0]): [number, number] {
  let x = wx;
  let z = wz;
  for (let k = 0; k < 6; k++) {
    x = wx - fx(z);
    z = wz - fz(x);
  }
  out[0] = x;
  out[1] = z;
  return out;
}

/** a plan direction (dx, dz) at plan point (x, z) as a world direction (the warp's Jacobian) */
export function warpDir(x: number, z: number, dx: number, dz: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = dx + dfx(z) * dz;
  out[1] = dz + dfz(x) * dx;
  return out;
}

/** the inverse Jacobian: a world direction at plan point (x, z) as a plan direction */
export function unwarpDir(x: number, z: number, dx: number, dz: number, out: [number, number] = [0, 0]): [number, number] {
  const a = dfx(z);
  const b = dfz(x);
  const det = 1 - a * b;
  out[0] = (dx - a * dz) / det;
  out[1] = (dz - b * dx) / det;
  return out;
}

/** world-space ground height */
export const groundYWorld = (wx: number, wz: number): number => {
  const [x, z] = unwarp(wx, wz, TMPW);
  return groundY(x, z);
};
const TMPW: [number, number] = [0, 0];
