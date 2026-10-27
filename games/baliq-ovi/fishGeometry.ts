// Procedural fish. EVERY species shares one topology (body rings + tail + fins + whisker triangles) so a pooled fish mesh
// can change species by copying a different position array into its own dynamic geometry. Swimming bends the body on the CPU.
// A fish is <= ~500 triangles (budget: 6k). Junk items (boot, bottle) are separate small meshes.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SpeciesDef } from "./species";

const R = 18; // rings along the body
const S = 12; // sides
const BODY_VERTS = (R + 1) * (S + 1);
// tail 4, dorsal 4, pectoral 2x3, anal 3, ventral 3, whiskers 4x3
const FIN_VERTS = 4 + 4 + 6 + 3 + 3 + 12;
export const FISH_VERTS = BODY_VERTS + FIN_VERTS;

/** Body profile 0..1 along the fish (0 tail, 1 nose): thin tail stalk, deepest at 38 %, rounded nose. */
export function profile(u: number): number {
  if (u <= 0) return 0;
  if (u < 0.38) return Math.pow(u / 0.38, 1.3);
  const k = Math.min(1, (u - 0.38) / 0.62);
  return Math.pow(Math.max(0, 1 - Math.pow(k, 2.2)), 0.5);
}

interface Topo {
  uv: Float32Array;
  index: Uint16Array;
}
let topo: Topo | null = null;

export function fishTopology(): Topo {
  if (topo) return topo;
  const uv = new Float32Array(FISH_VERTS * 2);
  const idx: number[] = [];
  for (let i = 0; i <= R; i++) for (let j = 0; j <= S; j++) {
    const v = i * (S + 1) + j;
    uv[v * 2] = i / R;
    uv[v * 2 + 1] = 1 - (j / S) * 0.93;
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) {
    const a = i * (S + 1) + j;
    const b = a + S + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  let v = BODY_VERTS;
  const fin = (n: number, tris: number[][]): void => {
    for (let k = 0; k < n; k++) {
      uv[(v + k) * 2] = 0.5;
      uv[(v + k) * 2 + 1] = 0.03;
    }
    for (const t of tris) idx.push(v + t[0], v + t[1], v + t[2]);
    v += n;
  };
  fin(4, [[0, 1, 2], [0, 2, 3]]); // tail
  fin(4, [[0, 1, 2], [0, 2, 3]]); // dorsal
  fin(3, [[0, 1, 2]]); // pectoral L
  fin(3, [[0, 1, 2]]); // pectoral R
  fin(3, [[0, 1, 2]]); // anal
  fin(3, [[0, 1, 2]]); // ventral
  for (let k = 0; k < 4; k++) fin(3, [[0, 1, 2]]); // whiskers
  topo = { uv, index: new Uint16Array(idx) };
  return topo;
}

/** Fills `out` (FISH_VERTS * 3) with the rest pose of the species (nose towards +x, back towards +y). */
export function fishPositions(sp: SpeciesDef, out: Float32Array): void {
  const L = sp.len;
  const H = sp.h;
  const sh = sp.shape ?? {};
  const thick = sh.thick ?? 1;
  const head = sh.head ?? 1;
  const half = H / 2;
  const hh = (u: number): number => {
    let h = half * profile(u);
    if (u > 0.75) h *= sh.flatHead ? 0.62 : 1;
    return h;
  };
  const ww = (u: number): number => {
    let w = half * 0.55 * thick * profile(u);
    if (u > 0.7) w *= head * (sh.flatHead ? 1.35 : 1);
    return w;
  };
  let o = 0;
  const put = (x: number, y: number, z: number): void => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = z;
  };
  for (let i = 0; i <= R; i++) {
    const u = i / R;
    const x = (u - 0.5) * L;
    const a = hh(u);
    const b = ww(u);
    for (let j = 0; j <= S; j++) {
      const th = (j / S) * Math.PI * 2;
      put(x, a * Math.cos(th) - a * 0.08, b * Math.sin(th));
    }
  }
  const xAt = (u: number): number => (u - 0.5) * L;
  // tail
  const tailK = sh.tail ?? 1;
  const tl = L * 0.26 * tailK;
  const ts = H * 0.62 * tailK;
  put(xAt(0.02), 0, 0);
  put(xAt(0) - tl, ts, 0);
  put(xAt(0) - tl * 0.55, 0, 0);
  put(xAt(0) - tl, -ts, 0);
  // dorsal
  const da = sh.dorsalLong ? 0.2 : 0.34;
  const db = sh.dorsalLong ? 0.78 : 0.62;
  const df = H * (sh.dorsalLong ? 0.32 : 0.46);
  put(xAt(da), hh(da) * 0.9, 0);
  put(xAt(db), hh(db) * 0.9, 0);
  put(xAt(db) - L * 0.04, hh(db) + df * 0.55, 0);
  put(xAt(da) + L * 0.05, hh(da) + df, 0);
  // pectoral fins
  for (const z of [1, -1]) {
    const u = 0.7;
    const y = -hh(u) * 0.3;
    put(xAt(u), y, ww(u) * 0.9 * z);
    put(xAt(u) - L * 0.06, y + H * 0.04, ww(u) * 0.95 * z);
    put(xAt(u) - L * 0.13, y - H * 0.16, ww(u) * 1.9 * z);
  }
  // anal + ventral
  put(xAt(0.22), -hh(0.22) * 0.9, 0);
  put(xAt(0.34), -hh(0.34) * 0.9, 0);
  put(xAt(0.2), -hh(0.22) - H * 0.2, 0);
  put(xAt(0.5), -hh(0.5) * 0.9, 0);
  put(xAt(0.58), -hh(0.58) * 0.9, 0);
  put(xAt(0.5), -hh(0.5) - H * 0.18, 0);
  // whiskers (degenerate for species without)
  const wl = sh.whiskers ? L * 0.2 : 0;
  for (const z of [1, -1]) for (const dy of [0, -1]) {
    const nx = xAt(0.985);
    const base = ww(0.93) * 0.8;
    put(nx, -H * 0.05 + dy * H * 0.05, base * z);
    put(nx + 0.001, -H * 0.05 + dy * H * 0.05 + 0.002, base * z);
    put(nx + wl, -H * 0.12 + dy * H * 0.12, (base + wl * 0.5) * z);
  }
}

/** Body bend while swimming: amplitude grows towards the tail. `base` = rest positions; writes into `pos`. */
export function swimBend(base: Float32Array, pos: Float32Array, L: number, phase: number, amp: number): void {
  const k = 7 / L;
  for (let i = 0; i < FISH_VERTS; i++) {
    const x = base[i * 3];
    const u = x / L + 0.5;
    const e = Math.max(0, 1 - u);
    const w = amp * L * e * e * 0.55;
    pos[i * 3] = x;
    pos[i * 3 + 1] = base[i * 3 + 1];
    pos[i * 3 + 2] = base[i * 3 + 2] + w * Math.sin(phase - x * k);
  }
}

export function makeFishGeometry(): THREE.BufferGeometry {
  const t = fishTopology();
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(FISH_VERTS * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("position", pos);
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(FISH_VERTS * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(t.uv, 2));
  g.setIndex(new THREE.BufferAttribute(t.index, 1));
  return g;
}

// ---------------------------------------------------------------- junk items

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  const ng = g.index ? g.toNonIndexed() : g;
  return ng;
}

/** Old boot (one geometry, vertex colours). */
export function makeBootGeometry(): THREE.BufferGeometry {
  const leg = new THREE.BoxGeometry(0.14, 0.38, 0.14).translate(-0.05, 0.2, 0);
  const foot = new THREE.BoxGeometry(0.34, 0.13, 0.15).translate(0.05, 0, 0);
  const toe = new THREE.SphereGeometry(0.075, 10, 8).translate(0.22, 0, 0);
  const sole = new THREE.BoxGeometry(0.4, 0.04, 0.16).translate(0.07, -0.08, 0);
  const rim = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 10).translate(-0.05, 0.4, 0);
  return mergeGeometries([colored(leg, 0x5d3a1a), colored(foot, 0x5d3a1a), colored(toe, 0x5d3a1a), colored(sole, 0x1a1a1a), colored(rim, 0x3a2410)])!;
}

/** Glass bottle. */
export function makeBottleGeometry(): THREE.BufferGeometry {
  const pts = [[0, 0], [0.06, 0], [0.065, 0.03], [0.065, 0.2], [0.05, 0.27], [0.022, 0.31], [0.022, 0.4], [0.03, 0.41], [0, 0.41]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(pts, 10).translate(0, -0.2, 0).rotateZ(Math.PI / 2);
  return mergeGeometries([colored(body, 0x3f9a6a)])!;
}
