import type * as THREE from "three";
import { GeoBuilder } from "../render/geo";
import { signKey, type SignAtlas } from "../render/textures";
import { DECK_H, deckProfile, hash2, RIVER_HALF, ROAD, STUB, TILE, type Dir, type Layout, type Rect, type Sign, type TileSpec } from "./layout";

// Builds the geometry of ONE tile: everything static is merged into a handful of meshes (ground+roads, buildings, props,
// signs, glowing lamps, water) plus the collision shapes for Rapier. Another tile kind (countryside, serpentine, ...)
// is another `case` here and more rows in the layout; nothing else in the game has to change.

export interface BoxCollider {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}
export interface MeshCollider {
  verts: Float32Array;
  idx: Uint32Array;
}
export interface TileBuild {
  base: THREE.BufferGeometry | null;
  bldg: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  signs: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
  boxes: BoxCollider[];
  meshes: MeshCollider[];
  /** flat ground colliders [x0, z0, x1, z1] at y = 0 (empty for the bridge tile: it has a river) */
  ground: Rect[];
  /** rough number of buildings / props (stats, tests) */
  stats: { buildings: number; props: number };
}

export const C = {
  asphalt: 0x3b3e43,
  concrete: 0xaaa9a2,
  sidewalk: 0xbdb7aa,
  lot: 0x8d897c,
  grass: 0x5f8b3b,
  grass2: 0x6b9a43,
  crop1: 0xbfae4a,
  crop2: 0x7fae3e,
  crop3: 0x9a7b46,
  stone: 0xdccfb0,
  stoneDark: 0xb7a57e,
  white: 0xf3f3ee,
  yellow: 0xe6bd1e,
  pole: 0x8c9399,
  dark: 0x1f2226,
  trunk: 0x5b3b22,
  river: 0x8b7d5e,
  barrier: 0xb9b9b5,
};
const FACADES = [0xe8dcc0, 0xd9c7a0, 0xcdb78c, 0xe3d3b3, 0xbfc6c9, 0xd8b99a, 0xe9e2d0];
const LEAVES = [0x3d7d31, 0x2f6b2a, 0x4a8a35, 0x5a9a3a];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Layer {
  r: Rect;
  color: number;
  pri: number;
}

/** Paint a rectangle with non-overlapping cells: breakpoints from the layer edges, highest priority wins per cell. */
function paintCells(gb: GeoBuilder, b: Rect, layers: Layer[], base: number, y = 0): void {
  const xs = new Set<number>([b.x0, b.x1]);
  const zs = new Set<number>([b.z0, b.z1]);
  for (const l of layers) {
    for (const x of [l.r.x0, l.r.x1]) if (x > b.x0 && x < b.x1) xs.add(x);
    for (const z of [l.r.z0, l.r.z1]) if (z > b.z0 && z < b.z1) zs.add(z);
  }
  const X = [...xs].sort((p, q) => p - q);
  const Z = [...zs].sort((p, q) => p - q);
  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Z.length - 1; j++) {
      const mx = (X[i] + X[i + 1]) / 2;
      const mz = (Z[j] + Z[j + 1]) / 2;
      let col = base;
      let pri = -1;
      for (const l of layers) if (l.pri > pri && mx > l.r.x0 && mx < l.r.x1 && mz > l.r.z0 && mz < l.r.z1) {
        col = l.color;
        pri = l.pri;
      }
      gb.flat(X[i], Z[j], X[i + 1], Z[j + 1], y, col);
    }
  }
}

const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });

class Ctx {
  base = new GeoBuilder();
  bldg = new GeoBuilder();
  detail = new GeoBuilder();
  signs = new GeoBuilder();
  glow = new GeoBuilder();
  water = new GeoBuilder();
  boxes: BoxCollider[] = [];
  meshes: MeshCollider[] = [];
  ground: Rect[] = [];
  buildings = 0;
  props = 0;
}

export function buildTile(spec: TileSpec, L: Layout, atlas: SignAtlas): TileBuild {
  const k = new Ctx();
  const rand = rng(spec.seed);
  const bounds: Rect = { x0: spec.x0, x1: spec.x0 + TILE, z0: spec.z0, z1: spec.z0 + TILE };
  switch (spec.kind) {
    case "city":
      city(k, spec, L, rand, bounds);
      break;
    case "plaza":
      plaza(k, spec, rand, bounds);
      break;
    case "highway":
      highway(k, spec, L, rand, bounds);
      break;
    case "bridge":
      bridge(k, spec, rand, bounds);
      break;
    case "airfield":
      airfield(k, spec, rand, bounds);
      break;
    default:
      field(k, spec, rand, bounds);
  }
  signsFor(k, spec, L, atlas);
  const g = (b: GeoBuilder): THREE.BufferGeometry | null => (b.empty ? null : b.build());
  return {
    base: g(k.base),
    bldg: g(k.bldg),
    detail: g(k.detail),
    signs: g(k.signs),
    glow: g(k.glow),
    water: g(k.water),
    boxes: k.boxes,
    meshes: k.meshes,
    ground: k.ground,
    stats: { buildings: k.buildings, props: k.props },
  };
}

// ------------------------------------------------------------------------------------------------ props

function tree(k: Ctx, x: number, z: number, rand: () => number, scale = 1): void {
  const d = k.detail;
  d.cyl(x, 0, z, 0.2 * scale, 2.3 * scale, C.trunk, 5);
  const col = LEAVES[Math.floor(rand() * LEAVES.length)];
  if (rand() < 0.35) {
    d.cone(x, 1.6 * scale, z, 1.5 * scale, 4.6 * scale, col, 6);
  } else {
    d.blob(x, 3.6 * scale, z, (1.5 + rand() * 0.7) * scale, col, 1.15);
  }
  k.props++;
}

function lamp(k: Ctx, x: number, z: number, outX: number, outZ: number): void {
  // pole with an arm reaching over the road (towards -out); the bulb glows at night
  const d = k.detail;
  d.cyl(x, 0, z, 0.07, 6, C.pole, 6, 0.05);
  d.push(x, z, Math.atan2(outX, outZ));
  d.box(0, 5.9, -0.7, 0.08, 0.08, 1.5, C.pole, { noTop: false });
  d.pop();
  k.glow.push(x, z, Math.atan2(outX, outZ));
  k.glow.box(0, 5.82, -1.35, 0.3, 0.1, 0.6, 0xfff1c9);
  k.glow.pop();
  k.props++;
}

function stripe(gb: GeoBuilder, cx: number, cz: number, lenX: number, lenZ: number, color: number, y = 0.02): void {
  gb.flat(cx - lenX / 2, cz - lenZ / 2, cx + lenX / 2, cz + lenZ / 2, y, color);
}

function signsFor(k: Ctx, spec: TileSpec, L: Layout, atlas: SignAtlas): void {
  for (const s of L.signs) {
    if (s.tile !== spec.id) continue;
    sign(k, s, atlas);
  }
}

function sign(k: Ctx, s: Sign, atlas: SignAtlas): void {
  const key = signKey(s.kind, s.text, s.sub);
  const cell = atlas.cells.get(key) ?? atlas.cells.get("limit:60")!;
  const yaw = Math.atan2(s.fx, s.fz);
  const board = key.startsWith("board:");
  const d = k.detail;
  if (board) {
    d.push(s.x, s.z, yaw);
    d.cyl(-1.2, 0, 0, 0.07, 3.2, C.pole, 6);
    d.cyl(1.2, 0, 0, 0.07, 3.2, C.pole, 6);
    d.pop();
    k.signs.push(s.x, s.z, yaw);
    k.signs.sign(0, 3.3, 0.06, cell.w, cell.h, cell.uv);
    k.signs.pop();
  } else {
    d.cyl(s.x, 0, s.z, 0.05, 2.3, C.pole, 6);
    k.signs.push(s.x, s.z, yaw);
    k.signs.sign(0, 2.35, 0.06, cell.w, cell.h, cell.uv);
    k.signs.pop();
  }
  k.props++;
}

/** White crosswalk stripes across a road of half width `h`, centred at (x, z); the road runs along `axis`. */
function zebraStripes(k: Ctx, x: number, z: number, axis: "x" | "z", h: number, depth = 3): void {
  for (let o = -h + 0.45; o < h; o += 1.0) {
    if (axis === "x") stripe(k.detail, x, z + o, depth, 0.5, C.white);
    else stripe(k.detail, x + o, z, 0.5, depth, C.white);
  }
}

/** Dashed centre line along a road from `a` to `b` (a < b) at the perpendicular coordinate `c`. */
function dashes(k: Ctx, axis: "x" | "z", a: number, b: number, c: number, color: number, dash = 3, gap = 3, w = 0.14): void {
  for (let p = a; p + dash <= b; p += dash + gap) {
    if (axis === "x") stripe(k.detail, p + dash / 2, c, dash, w, color);
    else stripe(k.detail, c, p + dash / 2, w, dash, color);
  }
}

// ------------------------------------------------------------------------------------------------ city

function city(k: Ctx, t: TileSpec, L: Layout, rand: () => number, b: Rect): void {
  const h = ROAD.cityHalf;
  const sw = ROAD.sidewalk;
  const layers: Layer[] = [];
  for (const r of t.road) layers.push({ r: grow(r, sw), color: C.sidewalk, pri: 1 });
  for (const r of t.road) layers.push({ r, color: C.asphalt, pri: 3 });
  paintCells(k.base, b, layers, C.lot);
  k.ground.push(b);

  // ---- buildings in the four quadrants
  const inner = h + sw + 0.8;
  const quads: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const dc = Math.hypot(t.cx - 240, t.cz - 180);
  for (const [sx, sz] of quads) {
    const qx0 = sx > 0 ? t.cx + inner : b.x0 + 1.2;
    const qx1 = sx > 0 ? b.x1 - 1.2 : t.cx - inner;
    const qz0 = sz > 0 ? t.cz + inner : b.z0 + 1.2;
    const qz1 = sz > 0 ? b.z1 - 1.2 : t.cz - inner;
    // a quadrant that contains a dead-end stub is still free (stubs are only 7.2 m wide + sidewalk)
    const nx = 2;
    const nz = 2;
    const pw = (qx1 - qx0) / nx;
    const pd = (qz1 - qz0) / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (rand() < 0.08) continue;
        const w = pw - 1.6 - rand() * 3;
        const d = pd - 1.6 - rand() * 3;
        const cx = qx0 + pw * (i + 0.5);
        const cz = qz0 + pd * (j + 0.5);
        const floors = 2 + Math.floor(rand() * (dc < 140 ? 8 : 5));
        const ht = floors * 3.4;
        building(k, cx, cz, w, d, ht, rand);
      }
    }
  }

  // ---- roads: markings, crosswalks, lamps, trees
  const link = (dir: Dir): boolean => t.arms[dir];
  const stubEnd = (dir: Dir): number => (t.link[dir] ? TILE / 2 : STUB);
  const sl = ROAD.stopLine;
  // centre dashes
  if (link("e")) dashes(k, "x", t.cx + sl + 4, t.cx + stubEnd("e"), t.cz, C.white);
  if (link("w")) dashes(k, "x", t.cx - stubEnd("w"), t.cx - sl - 4, t.cz, C.white);
  if (link("s")) dashes(k, "z", t.cz + sl + 4, t.cz + stubEnd("s"), t.cx, C.white);
  if (link("n")) dashes(k, "z", t.cz - stubEnd("n"), t.cz - sl - 4, t.cx, C.white);
  // stop lines + crosswalks at the intersection
  const bar = (x: number, z: number, axis: "x" | "z"): void => {
    if (axis === "x") stripe(k.detail, x, z, 0.45, ROAD.lane - 0.2, C.white);
    else stripe(k.detail, x, z, ROAD.lane - 0.2, 0.45, C.white);
  };
  if (link("w")) bar(t.cx - sl, t.cz + ROAD.lane / 2, "x");
  if (link("e")) bar(t.cx + sl, t.cz - ROAD.lane / 2, "x");
  if (link("n")) bar(t.cx - ROAD.lane / 2, t.cz - sl, "z");
  if (link("s")) bar(t.cx + ROAD.lane / 2, t.cz + sl, "z");
  if (t.control === "light") {
    const cw = sl - 3.2;
    if (link("w")) zebraStripes(k, t.cx - cw, t.cz, "x", h, 2.6);
    if (link("e")) zebraStripes(k, t.cx + cw, t.cz, "x", h, 2.6);
    if (link("n")) zebraStripes(k, t.cx, t.cz - cw, "z", h, 2.6);
    if (link("s")) zebraStripes(k, t.cx, t.cz + cw, "z", h, 2.6);
  }
  // mid-block zebra
  for (const z of L.zebras) if (z.tile === t.id) zebraStripes(k, z.x, z.z, z.axis, h, 3);

  // lamps and trees along the arms (right-hand sidewalk side alternates so both sides are lit)
  const sideOff = h + 1.0;
  for (const dir of ["e", "w", "s", "n"] as Dir[]) {
    if (!link(dir)) continue;
    const dx = dir === "e" ? 1 : dir === "w" ? -1 : 0;
    const dz = dir === "s" ? 1 : dir === "n" ? -1 : 0;
    const end = stubEnd(dir);
    for (let p = 18, i = 0; p < end - 2; p += 24, i++) {
      const side = i % 2 === 0 ? 1 : -1;
      // perpendicular
      const px = -dz;
      const pz = dx;
      const x = t.cx + dx * p + px * side * sideOff;
      const z = t.cz + dz * p + pz * side * sideOff;
      lamp(k, x, z, px * side, pz * side);
    }
    for (let p = 30; p < end - 4; p += 22) {
      const side = rand() < 0.5 ? 1 : -1;
      const px = -dz;
      const pz = dx;
      const o = h + sw * 0.5 + 0.2;
      if (rand() < 0.75) tree(k, t.cx + dx * p + px * side * o, t.cz + dz * p + pz * side * o, rand, 0.8 + rand() * 0.3);
    }
    // dead-end barrier at the end of a stub
    if (!t.link[dir]) {
      const ex = t.cx + dx * STUB;
      const ez = t.cz + dz * STUB;
      const alongX = dz !== 0;
      for (let q = 0; q < 6; q++) {
        const o = -h + (q + 0.5) * ((2 * h) / 6);
        const bx = ex + (alongX ? o : 0);
        const bz = ez + (alongX ? 0 : o);
        k.detail.box(bx, 0.45, bz, alongX ? (2 * h) / 6 : 0.3, 0.8, alongX ? 0.3 : (2 * h) / 6, q % 2 ? 0xd9261c : 0xf2f2f2);
      }
      k.boxes.push({ x: ex, y: 0.5, z: ez, hx: alongX ? h : 0.2, hy: 0.5, hz: alongX ? 0.2 : h, yaw: 0 });
    }
  }
  // traffic light poles
  for (const l of L.lights) {
    if (l.node !== t.id) continue;
    k.detail.cyl(l.x, 0, l.z, 0.09, 4.2, C.pole, 6);
    k.detail.push(l.x, l.z, Math.atan2(-l.dx, -l.dz));
    k.detail.box(0, 3.2, 0.12, 0.4, 1.15, 0.3, C.dark);
    k.detail.pop();
    k.props++;
  }
}

function building(k: Ctx, cx: number, cz: number, w: number, d: number, ht: number, rand: () => number): void {
  const col = FACADES[Math.floor(rand() * FACADES.length)];
  const roof = 0x6f6a62;
  const kind = rand();
  if (kind < 0.2 && ht < 16) {
    // low house with a gable roof
    k.bldg.box(cx, 0, cz, w, ht, d, col, { windows: true, top: roof });
    k.detail.gable(cx, ht, cz, w + 0.6, d + 0.6, 2.4 + rand() * 1.2, 0x8a3b2a);
  } else if (kind < 0.45 && ht > 12) {
    // stepped tower
    k.bldg.box(cx, 0, cz, w, ht * 0.6, d, col, { windows: true, top: roof });
    k.bldg.box(cx, ht * 0.6, cz, w * 0.7, ht * 0.4, d * 0.7, col, { windows: true, top: roof });
  } else {
    k.bldg.box(cx, 0, cz, w, ht, d, col, { windows: true, top: roof });
    // parapet
    k.detail.box(cx, ht, cz, w + 0.3, 0.5, d + 0.3, 0x8b857b);
  }
  k.boxes.push({ x: cx, y: ht / 2, z: cz, hx: w / 2, hy: ht / 2, hz: d / 2, yaw: 0 });
  k.buildings++;
}

// ------------------------------------------------------------------------------------------------ plaza (Registon)

const SAND = 0xd9c593;
const SAND2 = 0xc2ae7c;
const TURQ = 0x1f9bb5;
const BLUE = 0x1b4f9c;
const GOLD = 0xe0b43c;

function vdisc(gb: GeoBuilder, cx: number, cy: number, cz: number, r: number, color: number, n = 20, a0 = 0, a1 = Math.PI * 2): void {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    gb.tri([cx, cy, cz], [cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cz], [cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, cz], color);
  }
}

/** A low-poly madrasa facing +z of the current local frame: arcaded wing, pishtaq portal with arch, minarets, domes. */
function madrasa(k: Ctx, W: number, withBigDome: boolean, sun: boolean): void {
  const dpt = 15;
  const H = 13;
  k.bldg.box(0, 0, -dpt / 2, W, H, dpt, SAND, { windows: true, top: SAND2 });
  // pishtaq
  const pw = 22;
  const ph = 22;
  k.bldg.box(0, 0, 1.2, pw, ph, 3, SAND, { top: SAND2 });
  const d = k.detail;
  // blue/turquoise frames around the arch
  d.box(-pw / 2 + 1.3, 0, 2.8, 2.4, ph, 0.3, BLUE);
  d.box(pw / 2 - 1.3, 0, 2.8, 2.4, ph, 0.3, BLUE);
  d.box(0, ph - 3.6, 2.8, pw, 3.6, 0.3, TURQ);
  d.box(0, ph - 4.1, 2.9, pw - 4, 0.5, 0.3, GOLD);
  d.box(-pw / 2 + 1.3, 3, 2.95, 1.6, 0.6, 0.3, GOLD);
  d.box(pw / 2 - 1.3, 3, 2.95, 1.6, 0.6, 0.3, GOLD);
  // the arch itself: dark recess
  d.box(0, 0, 2.75, 8, 11, 0.3, 0x2a2118);
  vdisc(d, 0, 11, 2.95, 4, 0x2a2118, 14, 0, Math.PI);
  vdisc(d, 0, 11, 2.9, 4.8, TURQ, 14, 0, Math.PI);
  if (sun) vdisc(d, 0, ph - 9, 3.0, 2.6, GOLD, 14);
  // arcade bands on the wings
  d.box(0, H - 1.6, 0.15, W, 1.2, 0.3, TURQ);
  d.box(0, 0, 0.15, W, 0.6, 0.3, SAND2);
  // wing corner domes
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 3);
    d.cyl(x, H, -3, 2.6, 2.2, SAND2, 10);
    d.dome(x, H + 2.2, -3, 2.9, TURQ, 10, 4, 1.1);
    // minaret
    const mx = sx * (pw / 2 + 2.4);
    d.cyl(mx, 0, 2.2, 2.0, 24, SAND, 10, 1.7);
    d.cyl(mx, 8, 2.2, 2.15, 0.7, BLUE, 10);
    d.cyl(mx, 14, 2.2, 2.05, 0.7, TURQ, 10);
    d.cyl(mx, 20, 2.2, 1.95, 0.7, BLUE, 10);
    d.cyl(mx, 24, 2.2, 2.5, 0.9, GOLD, 10);
    d.dome(mx, 24.9, 2.2, 2.3, TURQ, 10, 4, 1.3);
    localBox(mx, 12, 2.2, 2.0, 12, 2.0);
  }
  if (withBigDome) {
    d.cyl(0, H, -9, 6.2, 5, SAND2, 14);
    d.dome(0, H + 5, -9, 7.4, TURQ, 16, 6, 1.25);
    d.cyl(0, H + 14.3, -9, 0.25, 3, GOLD, 5);
  }
  localBox(0, H / 2, -dpt / 2, W / 2, H / 2, dpt / 2);
  localBox(0, ph / 2, 1.2, pw / 2, ph / 2, 1.5);
  k.buildings++;
}

// Colliders of the madrasa are collected in the madrasa's local frame; the plaza maps them to world coordinates.
let _frame: { x: number; z: number; yaw: number; sink: BoxCollider[] } | null = null;
function localBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): BoxCollider {
  const f = _frame!;
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const box = { x: f.x + x * c + z * s, y, z: f.z - x * s + z * c, hx, hy, hz, yaw: f.yaw };
  f.sink.push(box);
  return box;
}

function plaza(k: Ctx, t: TileSpec, rand: () => number, b: Rect): void {
  const layers: Layer[] = [{ r: { x0: b.x0 + 3, x1: b.x1 - 3, z0: b.z0 + 3, z1: b.z1 }, color: C.stone, pri: 1 }];
  paintCells(k.base, b, layers, C.lot);
  k.ground.push(b);
  const d = k.detail;
  // inlaid paving: a ring and a star in the middle of the square
  d.ring(t.cx, 0.02, t.cz + 18, 10, 11.2, 0x2b5f8a, 40);
  d.ring(t.cx, 0.02, t.cz + 18, 4, 5, TURQ, 32);
  d.disc(t.cx, 0.02, t.cz + 18, 1.6, GOLD, 12);
  // the three madrasas: north (Tilya-Kori, big dome), west (Ulugbek), east (Sher-Dor, with the sun)
  const place = (x: number, z: number, yaw: number, W: number, dome: boolean, sun: boolean): void => {
    _frame = { x, z, yaw, sink: k.boxes };
    for (const g of [k.bldg, k.detail]) g.push(x, z, yaw);
    madrasa(k, W, dome, sun);
    for (const g of [k.bldg, k.detail]) g.pop();
    _frame = null;
  };
  place(t.cx, b.z0 + 22, 0, 60, true, false);
  place(b.x0 + 22, b.z0 + 62, Math.PI / 2, 52, false, false);
  place(b.x1 - 22, b.z0 + 62, -Math.PI / 2, 52, false, true);
  // trees and lamps at the open side
  for (const x of [b.x0 + 14, b.x1 - 14]) for (const z of [b.z1 - 14, b.z1 - 40]) tree(k, x, z, rand, 0.9);
  for (const x of [t.cx - 30, t.cx + 30]) lamp(k, x, b.z1 - 6, 0, 1);
}

// ------------------------------------------------------------------------------------------------ highway + bridge

function farmland(k: Ctx, layers: Layer[], b: Rect, rand: () => number, avoid: Rect): void {
  // a few big rectangular fields beside the road
  const cols = [C.crop1, C.crop2, C.crop3, C.grass2];
  for (let i = 0; i < 4; i++) {
    const w = 26 + rand() * 30;
    const d = 18 + rand() * 24;
    const x0 = b.x0 + 4 + rand() * (TILE - w - 8);
    const z0 = rand() < 0.5 ? b.z0 + 6 + rand() * 20 : b.z1 - d - 6 - rand() * 20;
    const r = { x0, x1: x0 + w, z0, z1: z0 + d };
    if (r.z1 > avoid.z0 - 4 && r.z0 < avoid.z1 + 4) continue;
    layers.push({ r, color: cols[Math.floor(rand() * cols.length)], pri: 1 });
  }
}

function highway(k: Ctx, t: TileSpec, L: Layout, rand: () => number, b: Rect): void {
  const hh = ROAD.hwHalf;
  const layers: Layer[] = [];
  const road = t.road[0];
  const roadRect: Rect = { x0: road.x0, x1: road.x1, z0: t.cz - hh, z1: t.cz + hh };
  farmland(k, layers, b, rand, roadRect);
  layers.push({ r: roadRect, color: C.asphalt, pri: 3 });
  paintCells(k.base, b, layers, C.grass);
  k.ground.push(b);
  highwayFurniture(k, t, b, rand, roadRect);
  // trees + poles in the fields
  for (let i = 0; i < 8; i++) {
    const x = b.x0 + 8 + rand() * (TILE - 16);
    const z = rand() < 0.5 ? b.z0 + 5 + rand() * (t.cz - hh - b.z0 - 14) : t.cz + hh + 9 + rand() * (b.z1 - t.cz - hh - 14);
    tree(k, x, z, rand, 0.9 + rand() * 0.5);
  }
  // transition from the city street: grass wedges narrow the carriageway
  const west = L.specAt(t.c - 1, t.r);
  if (west.kind === "city" && t.link.w) {
    for (const sz of [-1, 1]) {
      const zin = t.cz + sz * ROAD.cityHalf;
      const zout = t.cz + sz * hh;
      k.detail.tri([b.x0, 0.03, zin], [b.x0, 0.03, zout], [b.x0 + 36, 0.03, zout], C.grass);
      k.detail.tri([b.x0, 0.03, zin], [b.x0 + 36, 0.03, zout], [b.x0, 0.03, zout], C.grass);
    }
    // a roadside police post (DPS) at the city exit
    const px = b.x0 + 14;
    k.detail.box(px, 0, t.cz - hh - 4, 4.5, 2.8, 3.2, 0xe6e6e6);
    k.detail.box(px, 2.8, t.cz - hh - 4, 5.2, 0.3, 3.9, 0x1565c0);
    k.boxes.push({ x: px, y: 1.4, z: t.cz - hh - 4, hx: 2.25, hy: 1.4, hz: 1.6, yaw: 0 });
  }
}

/** Markings, median barrier, guard rails, light poles of a highway tile (also used by the bridge). */
function highwayFurniture(k: Ctx, t: TileSpec, b: Rect, rand: () => number, r: Rect): void {
  void rand;
  const xa = r.x0;
  const xb = r.x1;
  const d = k.detail;
  const L = ROAD.hwLane;
  const m = ROAD.hwMedian / 2;
  // edge lines + lane dividers (both carriageways)
  for (const sz of [-1, 1]) {
    stripe(d, (xa + xb) / 2, t.cz + sz * (m + 0.2), xb - xa, 0.16, C.white);
    stripe(d, (xa + xb) / 2, t.cz + sz * (m + 3 * L + 0.4), xb - xa, 0.16, C.white);
    for (let i = 1; i < 3; i++) dashes(k, "x", xa + 2, xb, t.cz + sz * (m + L * i), C.white, 3, 9, 0.15);
  }
  // median barrier (collision too) and light poles in it
  d.box((xa + xb) / 2, 0, t.cz, xb - xa, 0.85, 0.7, C.barrier);
  k.boxes.push({ x: (xa + xb) / 2, y: 0.45, z: t.cz, hx: (xb - xa) / 2, hy: 0.45, hz: 0.35, yaw: 0 });
  for (let x = xa + 20; x < xb; x += 40) {
    d.cyl(x, 0, t.cz, 0.1, 9, C.pole, 6, 0.07);
    for (const sz of [-1, 1]) {
      d.box(x, 8.8, t.cz + sz * 1.4, 0.1, 0.1, 2.8, C.pole);
      k.glow.box(x, 8.7, t.cz + sz * 2.7, 0.5, 0.12, 0.35, 0xfff1c9);
    }
    k.props++;
  }
  // guard rails
  for (const sz of [-1, 1]) {
    const z = t.cz + sz * (ROAD.hwHalf + 0.3);
    d.box((xa + xb) / 2, 0.55, z, xb - xa, 0.3, 0.08, 0xc9cdd0);
    for (let x = xa + 2; x < xb; x += 4) d.box(x, 0, z + sz * 0.1, 0.1, 0.6, 0.1, C.pole);
    k.boxes.push({ x: (xa + xb) / 2, y: 0.5, z, hx: (xb - xa) / 2, hy: 0.5, hz: 0.1, yaw: 0 });
  }
  void b;
}

function bridge(k: Ctx, t: TileSpec, rand: () => number, b: Rect): void {
  const hh = ROAD.hwHalf;
  const x0 = b.x0;
  const x1 = b.x1;
  const rx0 = t.cx - RIVER_HALF;
  const rx1 = t.cx + RIVER_HALF;
  // ground: the two banks (grass) and the river bed
  k.base.flat(x0, b.z0, rx0, b.z1, 0, C.grass);
  k.base.flat(rx1, b.z0, x1, b.z1, 0, C.grass);
  k.base.flat(rx0, b.z0, rx1, b.z1, -3, C.river);
  k.ground.push({ x0, x1: rx0, z0: b.z0, z1: b.z1 }, { x0: rx1, x1, z0: b.z0, z1: b.z1 });
  k.boxes.push({ x: t.cx, y: -3.5, z: t.cz, hx: RIVER_HALF + 0.5, hy: 0.5, hz: TILE / 2, yaw: 0 });
  // bank walls
  for (const [x, nx] of [[rx0, 1], [rx1, -1]] as [number, number][]) {
    void nx;
    k.base.quad([x, -3, b.z0], [x, -3, b.z1], [x, 0, b.z1], [x, 0, b.z0], 0x7d7767);
    k.base.quad([x, 0, b.z0], [x, 0, b.z1], [x, -3, b.z1], [x, -3, b.z0], 0x7d7767);
  }
  // water surface (own mesh, translucent)
  k.water.flat(rx0 - 2, b.z0, rx1 + 2, b.z1, -0.9, 0x2a6f97);

  // deck: a strip along x with the height profile (asphalt), sampled every 4 m
  const step = 4;
  const verts: number[] = [];
  const idx: number[] = [];
  const rows: number[] = [];
  for (let x = x0; x <= x1 + 0.01; x += step) rows.push(x);
  const y = (x: number): number => deckProfile(x - t.cx) + 0.02;
  for (const z of [t.cz - hh, t.cz + hh]) for (const x of rows) verts.push(x, y(x), z);
  const n = rows.length;
  for (let i = 0; i < n - 1; i++) {
    const a = i;
    const bb = i + 1;
    const c = n + i;
    const dd = n + i + 1;
    // collision strip (both windings so rays hit from above regardless)
    idx.push(a, c, bb, bb, c, dd);
    k.base.quad([rows[i], y(rows[i]), t.cz - hh], [rows[i], y(rows[i]), t.cz + hh], [rows[i + 1], y(rows[i + 1]), t.cz + hh], [rows[i + 1], y(rows[i + 1]), t.cz - hh], C.asphalt);
  }
  k.meshes.push({ verts: new Float32Array(verts), idx: new Uint32Array(idx) });
  // side walls (embankment) under the deck, railings on top
  const d = k.detail;
  for (const sz of [-1, 1]) {
    const z = t.cz + sz * hh;
    for (let i = 0; i < n - 1; i++) {
      const ya = y(rows[i]);
      const yb = y(rows[i + 1]);
      if (ya < 0.05 && yb < 0.05) continue;
      const lo = Math.abs(rows[i] + 2 - t.cx) < RIVER_HALF + 2 ? -3 : 0;
      d.quad([rows[i], lo, z], [rows[i + 1], lo, z], [rows[i + 1], yb, z], [rows[i], ya, z], 0x9a978f);
      d.quad([rows[i + 1], lo, z], [rows[i], lo, z], [rows[i], ya, z], [rows[i + 1], yb, z], 0x9a978f);
      // rail
      d.quad([rows[i], ya + 0.5, z], [rows[i + 1], yb + 0.5, z], [rows[i + 1], yb + 1.0, z], [rows[i], ya + 1.0, z], 0xd7d9db);
      d.quad([rows[i + 1], yb + 0.5, z], [rows[i], ya + 0.5, z], [rows[i], ya + 1.0, z], [rows[i + 1], yb + 1.0, z], 0xd7d9db);
      if (i % 2 === 0) d.box(rows[i], ya, z, 0.2, 1.0, 0.2, 0x9a978f);
    }
    // invisible rails for the physics: a vertical ribbon along the deck edge
    const rv: number[] = [];
    const ri: number[] = [];
    rows.forEach((x, i) => {
      rv.push(x, y(x) - 0.2, z, x, y(x) + 1.2, z);
      if (i < n - 1) ri.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    });
    k.meshes.push({ verts: new Float32Array(rv), idx: new Uint32Array(ri) });
  }
  // pillars in the river
  for (const x of [t.cx - 12, t.cx + 12]) for (const sz of [-1, 1]) d.box(x, -3, t.cz + sz * (hh - 2), 2.4, DECK_H + 3, 2.4, 0x9a978f);
  // lane markings + median on the deck (ride on the profile with short segments)
  const m = ROAD.hwMedian / 2;
  for (let i = 0; i < n - 1; i++) {
    const xa = rows[i];
    const xb = rows[i + 1];
    const ya = y(xa) + 0.015;
    const yb = y(xb) + 0.015;
    for (const sz of [-1, 1]) {
      for (const o of [m + 0.2, m + 3 * ROAD.hwLane + 0.4]) d.quad([xa, ya, t.cz + sz * o - 0.08], [xa, ya, t.cz + sz * o + 0.08], [xb, yb, t.cz + sz * o + 0.08], [xb, yb, t.cz + sz * o - 0.08], C.white);
    }
    d.box((xa + xb) / 2, Math.min(ya, yb), t.cz, step, 0.85, 0.7, C.barrier);
  }
  for (let x = x0 + 16; x < x1; x += 32) {
    const yy = y(x);
    d.cyl(x, yy, t.cz, 0.1, 8, C.pole, 6, 0.07);
    for (const sz of [-1, 1]) k.glow.box(x, yy + 7.8, t.cz + sz * 2.6, 0.5, 0.12, 0.35, 0xfff1c9);
  }
  // trees on the banks
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side < 0 ? x0 + 6 + rand() * (rx0 - x0 - 14) : rx1 + 8 + rand() * (x1 - rx1 - 14);
    const z = rand() < 0.5 ? b.z0 + 6 + rand() * 30 : b.z1 - 6 - rand() * 30;
    tree(k, x, z, rand, 1);
  }
}

// ------------------------------------------------------------------------------------------------ airfield (drift area)

function cone(k: Ctx, x: number, z: number): void {
  k.detail.cone(x, 0, z, 0.28, 0.7, 0xf26a1b, 6);
  k.detail.box(x, 0, z, 0.55, 0.04, 0.55, 0xf26a1b);
}

function airfield(k: Ctx, t: TileSpec, rand: () => number, b: Rect): void {
  const layers: Layer[] = [];
  for (const r of t.road) layers.push({ r, color: r.surface === "concrete" ? C.concrete : C.asphalt, pri: 2 });
  paintCells(k.base, b, layers, C.grass2);
  k.ground.push(b);
  const d = k.detail;
  const idc = `${t.c},${t.r}`;
  const x0 = b.x0;
  const z0 = b.z0;
  // the painted slabs of the concrete + taxi lines
  for (let x = x0 + 6; x < b.x1 - 6; x += 30) stripe(d, x, t.cz, 0.12, TILE - 12, 0x8e8d86, 0.02);
  if (idc === "9,1") {
    // slalom of cones at the entrance
    for (let i = 0; i < 7; i++) cone(k, x0 + 22 + i * 12, t.cz + (i % 2 ? 6 : -6));
    d.box(x0 + 30, 0, z0 + 14, 14, 0.03, 0.5, C.yellow);
  } else if (idc === "10,1") {
    // big drift circle with cone markers
    d.ring(t.cx, 0.02, t.cz, 25.6, 26.2, C.white, 64);
    d.ring(t.cx, 0.02, t.cz, 9.8, 10.2, C.yellow, 40);
    for (let i = 0; i < 24; i++) cone(k, t.cx + Math.cos((i / 24) * Math.PI * 2) * 30, t.cz + Math.sin((i / 24) * Math.PI * 2) * 30);
  } else if (idc === "9,2") {
    // figure eight
    d.ring(t.cx - 22, 0.02, t.cz, 17.6, 18.2, C.white, 48);
    d.ring(t.cx + 22, 0.02, t.cz, 17.6, 18.2, C.white, 48);
    cone(k, t.cx, t.cz);
    cone(k, t.cx - 22, t.cz);
    cone(k, t.cx + 22, t.cz);
  } else if (idc === "10,2") {
    // hangar + control tower in the far corner
    const hx = b.x1 - 30;
    const hz = b.z1 - 24;
    k.bldg.box(hx, 0, hz, 44, 11, 22, 0xc9cdd0, { top: 0x8e9398 });
    d.gable(hx, 11, hz, 46, 24, 4, 0x6c7378);
    k.boxes.push({ x: hx, y: 5.5, z: hz, hx: 22, hy: 5.5, hz: 11, yaw: 0 });
    const tx = b.x0 + 24;
    const tz = b.z1 - 20;
    k.bldg.box(tx, 0, tz, 6, 14, 6, 0xe7e2d4, { windows: true, top: 0x8e9398 });
    d.box(tx, 14, tz, 8, 3, 8, 0x28323d);
    d.box(tx, 17, tz, 9, 0.4, 9, 0xd9d9d9);
    k.boxes.push({ x: tx, y: 7, z: tz, hx: 3, hy: 7, hz: 3, yaw: 0 });
    d.disc(b.x0 + 70, 0.02, b.z0 + 40, 12, 0x2d333a, 24);
    d.ring(b.x0 + 70, 0.03, b.z0 + 40, 8, 8.8, C.yellow, 24);
  }
  // crash barriers around the outer edge of the airfield
  const edge = (cx: number, cz: number, w: number, dd: number, hx: number, hz: number): void => {
    const alongX = w > dd;
    const n = Math.floor((alongX ? w : dd) / 4);
    for (let i = 0; i < n; i++) {
      const bx = alongX ? cx - w / 2 + (i + 0.5) * 4 : cx;
      const bz = alongX ? cz : cz - dd / 2 + (i + 0.5) * 4;
      d.box(bx, 0, bz, alongX ? 3.9 : 0.8, 0.9, alongX ? 0.8 : 3.9, i % 2 ? 0xd9261c : 0xf2f2f2);
    }
    k.boxes.push({ x: cx, y: 0.5, z: cz, hx, hy: 0.5, hz, yaw: 0 });
  };
  const west = !t.link.w && t.c === 9;
  if (t.c === 10) edge(b.x1 - 3, t.cz, 0.8, TILE - 12, 0.4, (TILE - 12) / 2);
  if (west) edge(b.x0 + 3, t.cz, 0.8, TILE - 12, 0.4, (TILE - 12) / 2);
  if (t.r === 1) edge(t.cx, b.z0 + 3, TILE - 12, 0.8, (TILE - 12) / 2, 0.4);
  if (t.r === 2) edge(t.cx, b.z1 - 3, TILE - 12, 0.8, (TILE - 12) / 2, 0.4);
  if (t.link.w) {
    // open entrance: barrier on both sides of the gap
    for (const sz of [-1, 1]) {
      const zc = sz < 0 ? (b.z0 + 6 + (t.cz - ROAD.hwHalf)) / 2 : (t.cz + ROAD.hwHalf + b.z1 - 6) / 2;
      const len = Math.abs(sz < 0 ? t.cz - ROAD.hwHalf - (b.z0 + 6) : b.z1 - 6 - (t.cz + ROAD.hwHalf));
      edge(b.x0 + 3, zc, 0.8, len, 0.4, len / 2);
    }
  }
  for (let i = 0; i < 3; i++) lamp(k, x0 + 20 + i * 40, z0 + 8, 0, 1);
  void rand;
}

// ------------------------------------------------------------------------------------------------ open countryside

function field(k: Ctx, t: TileSpec, rand: () => number, b: Rect): void {
  const layers: Layer[] = [];
  const cols = [C.crop1, C.crop2, C.crop3, C.grass2];
  for (let i = 0; i < 3; i++) {
    const w = 30 + rand() * 50;
    const d = 20 + rand() * 40;
    const x = b.x0 + 4 + rand() * (TILE - w - 8);
    const z = b.z0 + 4 + rand() * (TILE - d - 8);
    layers.push({ r: { x0: x, x1: x + w, z0: z, z1: z + d }, color: cols[Math.floor(rand() * cols.length)], pri: 1 });
  }
  paintCells(k.base, b, layers, C.grass);
  k.ground.push(b);
  const n = 4 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) tree(k, b.x0 + 4 + rand() * (TILE - 8), b.z0 + 4 + rand() * (TILE - 8), rand, 0.8 + rand() * 0.6);
  if (hash2(t.c, t.r) < 0.25) {
    const hx = b.x0 + 30 + rand() * 60;
    const hz = b.z0 + 30 + rand() * 60;
    k.bldg.box(hx, 0, hz, 8, 3.4, 9, 0xe4d7b8, { windows: true, top: 0xe4d7b8 });
    k.detail.gable(hx, 3.4, hz, 9, 10, 2.4, 0x8a3b2a);
    k.boxes.push({ x: hx, y: 1.7, z: hz, hx: 4, hy: 1.7, hz: 4.5, yaw: 0 });
    k.buildings++;
  }
}
