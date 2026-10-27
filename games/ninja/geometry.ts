import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TAU } from "@/engine/math";

// Procedural 3D shapes of Meva Ninja: smooth parametric fruit bodies, cut halves, accessories (stems, crowns), the bomb.
// Everything here is pure geometry (no canvas) so it can be unit-tested. Units: the fruit "radius" is ~1.

export type PosFn = (u: number, v: number, out: THREE.Vector3) => void;

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();
const P = new THREE.Vector3();

/**
 * Parametric surface -> indexed geometry. Normals come from finite differences of `fn`, so seams and poles are smooth.
 * uv = (u, 1 - v) so that canvas row 0 (top) is v = 0. `flip` reverses the winding / normals for surfaces whose
 * parametrisation is left handed.
 */
export function parametric(fn: PosFn, nu: number, nv: number, v0 = 0, v1 = 1, flip = false): THREE.BufferGeometry {
  const cols = nu + 1;
  const rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const eu = 1 / (nu * 4);
  const ev = Math.max(1e-4, (v1 - v0) / (nv * 4));
  const pad = (v1 - v0) * 0.004;
  for (let j = 0; j < rows; j++) {
    const v = v0 + ((v1 - v0) * j) / nv;
    const vc = Math.min(v1 - pad, Math.max(v0 + pad, v));
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      const k = j * cols + i;
      fn(u, v, P);
      pos[k * 3] = P.x;
      pos[k * 3 + 1] = P.y;
      pos[k * 3 + 2] = P.z;
      fn(u + eu, vc, A);
      fn(u - eu, vc, B);
      fn(u, vc + ev, C);
      fn(u, vc - ev, D);
      A.sub(B); // dP/du
      C.sub(D); // dP/dv
      A.cross(C);
      if (flip) A.negate();
      A.normalize();
      nor[k * 3] = A.x;
      nor[k * 3 + 1] = A.y;
      nor[k * 3 + 2] = A.z;
      uv[k * 2] = u;
      uv[k * 2 + 1] = 1 - v;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

export type FruitId = "tarvuz" | "apelsin" | "olma" | "banan" | "ananas" | "kivi" | "anor" | "qovun";
export const FRUIT_IDS: FruitId[] = ["tarvuz", "apelsin", "olma", "banan", "ananas", "kivi", "anor", "qovun"];

interface Lathe {
  rx: number;
  ry: number;
  /** radial scale as a function of the polar angle (0 = stem end, PI = blossom end) */
  k?: (theta: number) => number;
  /** barrel shaping exponent for the radius (1 = ellipsoid) */
  barrel?: number;
}

const LATHE: Partial<Record<FruitId, Lathe>> = {
  tarvuz: { rx: 1, ry: 1.12, k: (t) => 1 - 0.03 * bump(t, 0, 0.3) },
  apelsin: { rx: 1, ry: 0.96, k: (t) => 1 - 0.08 * bump(t, 0, 0.22) - 0.05 * bump(t, Math.PI, 0.22) },
  olma: { rx: 1.02, ry: 0.92, k: (t) => 1 - 0.26 * bump(t, 0, 0.42) - 0.11 * bump(t, Math.PI, 0.45) + 0.06 * Math.cos(t) },
  ananas: { rx: 0.8, ry: 1.1, barrel: 0.78, k: (t) => 1 - 0.05 * bump(t, Math.PI, 0.3) },
  kivi: { rx: 0.88, ry: 1.12, k: (t) => 1 - 0.07 * bump(t, 0, 0.3) - 0.05 * bump(t, Math.PI, 0.3) },
  anor: { rx: 0.98, ry: 0.93, k: (t) => 1 + 0.06 * bump(t, 0.42, 0.2) - 0.1 * bump(t, 0, 0.16) - 0.03 * bump(t, Math.PI, 0.3) },
  qovun: { rx: 0.94, ry: 1.2, k: (t) => 1 - 0.06 * bump(t, 0, 0.25) - 0.04 * bump(t, Math.PI, 0.25) },
};

function lathePos(s: Lathe): PosFn {
  const k = s.k;
  const barrel = s.barrel ?? 1;
  return (u, v, out) => {
    const th = v * Math.PI;
    const ph = u * TAU;
    const kk = k ? k(th) : 1;
    const sn = Math.pow(Math.max(0, Math.sin(th)), barrel);
    out.set(s.rx * kk * sn * Math.cos(ph), s.ry * kk * Math.cos(th), s.rx * kk * sn * Math.sin(ph));
  };
}

// ---- banana: a curved, five-ridged tube --------------------------------------------------------
const BANANA_R = 2;
const BANANA_A = 0.56;
const BANANA_Y0 = -0.5 * BANANA_R * (1 - Math.cos(BANANA_A));
const bananaCenter = (t: number, out: THREE.Vector3): void => {
  const a = (t - 0.5) * 2 * BANANA_A;
  out.set(BANANA_R * Math.sin(a), BANANA_R * (1 - Math.cos(a)) + BANANA_Y0, 0);
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const bananaRadius = (t: number): number => {
  const p = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.45);
  return 0.31 * (0.12 + 0.88 * p) * (1 - 0.45 * smooth(0.82, 1, t));
};
const bananaPos: PosFn = (u, t, out) => {
  const a = (t - 0.5) * 2 * BANANA_A;
  bananaCenter(t, out);
  const ph = u * TAU;
  const rr = bananaRadius(t) * (1 + 0.075 * Math.cos(5 * ph));
  // outer (convex) normal of the arc, and z
  out.x += Math.sin(a) * Math.cos(ph) * rr;
  out.y += -Math.cos(a) * Math.cos(ph) * rr;
  out.z += Math.sin(ph) * rr;
};

// ---- the public shape API ------------------------------------------------------------------------------
export interface Segs {
  nu: number;
  nv: number;
}

/** Whole fruit body. */
export function bodyGeometry(id: FruitId, seg: Segs): THREE.BufferGeometry {
  if (id === "banan") return parametric(bananaPos, seg.nu, seg.nv * 2, 0, 1, true);
  const s = LATHE[id] as Lathe;
  return parametric(lathePos(s), seg.nu, seg.nv * 2);
}

/** Radius of the cut face (cross section at the equator / banana middle). */
export function capRadius(id: FruitId): number {
  if (id === "banan") return bananaRadius(0.5);
  const s = LATHE[id] as Lathe;
  return s.rx * (s.k ? s.k(Math.PI / 2) : 1);
}

/**
 * One half of the fruit, cut perpendicular to the stem axis. Canonical orientation: the body extends along +Y, the flat cut
 * face sits at y = 0 and looks towards -Y. The other half is the same mesh mirrored with scale.y = -1.
 */
export function halfGeometry(id: FruitId, seg: Segs): THREE.BufferGeometry {
  if (id === "banan") {
    const g = parametric(bananaPos, seg.nu, seg.nv, 0.5, 1, true);
    g.translate(0, -BANANA_Y0, 0);
    g.rotateZ(Math.PI / 2);
    return g;
  }
  const s = LATHE[id] as Lathe;
  return parametric(lathePos(s), seg.nu, seg.nv, 0, 0.5);
}

/** Flat cut face at y = 0 facing -Y. */
export function capGeometry(id: FruitId, segments: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(capRadius(id) * 0.996, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

// ---- accessories (stems, leaves, crowns) merged into one vertex-coloured geometry ---------------------------------
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();

function part(g: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const c = g;
  E.set(rot[0], rot[1], rot[2]);
  Q.setFromEuler(E);
  M4.compose(V1.set(pos[0], pos[1], pos[2]), Q, V2.set(scale[0], scale[1], scale[2]));
  c.applyMatrix4(M4);
  const n = c.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  const k = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    // slight per-vertex variation so flat parts do not look plastic
    const sh = 0.86 + 0.14 * Math.sin(i * 1.7);
    col[i * 3] = k.r * sh;
    col[i * 3 + 1] = k.g * sh;
    col[i * 3 + 2] = k.b * sh;
  }
  c.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return c;
}

function tube(points: [number, number, number][], r0: number, r1: number, color: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, 8, 1, 6, false);
  // taper: scale the ring around the curve by moving vertices towards their curve point
  const pos = g.getAttribute("position");
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const r = r0 + (r1 - r0) * t;
    curve.getPointAt(t, V1);
    for (let j = 0; j <= 6; j++) {
      const k = i * 7 + j;
      V2.set(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(V1).multiplyScalar(r).add(V1);
      pos.setXYZ(k, V2.x, V2.y, V2.z);
    }
  }
  g.computeVertexNormals();
  return part(g, color, [0, 0, 0]);
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return m ?? new THREE.BufferGeometry();
}

/** Stem / leaves / crown of a fruit (null = nothing). One mesh, vertex colours. */
export function accessoryGeometry(id: FruitId): THREE.BufferGeometry | null {
  switch (id) {
    case "olma": {
      const stem = tube([[0, 0.6, 0], [0.02, 0.85, 0], [0.09, 1.0, 0]], 0.05, 0.035, 0x5a3a22);
      const leaf = part(new THREE.SphereGeometry(1, 12, 6), 0x3f9d3c, [0.3, 0.97, 0], [0, 0, 0.35], [0.3, 0.055, 0.15]);
      return merge([stem, leaf]);
    }
    case "apelsin": {
      const button = part(new THREE.SphereGeometry(1, 10, 5), 0x4c9a2a, [0, 0.9, 0], [0, 0, 0], [0.15, 0.05, 0.15]);
      const nub = part(new THREE.CylinderGeometry(0.03, 0.04, 0.1, 6), 0x7a5a2a, [0, 0.95, 0]);
      return merge([button, nub]);
    }
    case "tarvuz": {
      const stem = tube([[0, 1.05, 0], [0.04, 1.2, 0], [0.16, 1.28, 0], [0.24, 1.22, 0]], 0.06, 0.04, 0x6a8a3a);
      return merge([stem]);
    }
    case "qovun": {
      const stem = part(new THREE.CylinderGeometry(0.06, 0.1, 0.22, 7), 0x7a6a3a, [0.0, 1.2, 0], [0, 0, 0.12]);
      return merge([stem]);
    }
    case "anor": {
      const parts: THREE.BufferGeometry[] = [];
      const ty = 0.93 * 0.9;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        parts.push(part(new THREE.ConeGeometry(0.1, 0.34, 5), 0x7a1d24, [Math.cos(a) * 0.13, ty + 0.1, Math.sin(a) * 0.13], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]));
      }
      parts.push(part(new THREE.CylinderGeometry(0.15, 0.2, 0.1, 10), 0x8b2a2a, [0, ty - 0.01, 0]));
      return merge(parts);
    }
    case "ananas": {
      const parts: THREE.BufferGeometry[] = [];
      const greens = [0x2f7d32, 0x3f9a3a, 0x5aa83a, 0x2a6b2c];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + (i % 2) * 0.2;
        const tilt = 0.28 + (i % 3) * 0.12;
        const g = new THREE.ConeGeometry(0.13, 1.0, 4);
        g.translate(0, 0.5, 0);
        parts.push(part(g, greens[i % 4], [Math.cos(a) * 0.1, 1.02, Math.sin(a) * 0.1], [Math.sin(a) * tilt, a, -Math.cos(a) * tilt]));
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.4;
        const g = new THREE.ConeGeometry(0.1, 0.85, 4);
        g.translate(0, 0.42, 0);
        parts.push(part(g, greens[(i + 1) % 4], [Math.cos(a) * 0.03, 1.05, Math.sin(a) * 0.03], [Math.sin(a) * 0.08, a, -Math.cos(a) * 0.08]));
      }
      return merge(parts);
    }
    case "banan": {
      // the stalk continues the arc at t = 1
      const a = BANANA_A;
      const sx = BANANA_R * Math.sin(a);
      const sy = BANANA_R * (1 - Math.cos(a)) + BANANA_Y0;
      const stalk = part(new THREE.CylinderGeometry(0.075, 0.055, 0.34, 7), 0x6f7d2a, [sx + Math.cos(a) * 0.14, sy + Math.sin(a) * 0.14, 0], [0, 0, a - Math.PI / 2]);
      const cut = part(new THREE.CylinderGeometry(0.078, 0.078, 0.04, 7), 0x3b2a14, [sx + Math.cos(a) * 0.32, sy + Math.sin(a) * 0.32, 0], [0, 0, a - Math.PI / 2]);
      return merge([stalk, cut]);
    }
    default:
      return null;
  }
}

// ---- bomb --------------------------------------------------------------------------------------------------------
/** Local position of the fuse tip (on the Y axis, so spinning around Y does not move it). */
export const BOMB_TIP_Y = 1.74;

/** Iron ball + collar + red band + rope fuse in one vertex-coloured mesh. */
export function bombGeometry(seg: Segs): THREE.BufferGeometry {
  const body = parametric(lathePos({ rx: 1, ry: 1 }), seg.nu, seg.nv * 2);
  const colBody = new Float32Array(body.getAttribute("position").count * 3);
  for (let i = 0; i < colBody.length; i += 3) {
    colBody[i] = 0.1;
    colBody[i + 1] = 0.1;
    colBody[i + 2] = 0.14;
  }
  body.setAttribute("color", new THREE.BufferAttribute(colBody, 3));
  const collar = part(new THREE.CylinderGeometry(0.3, 0.38, 0.28, 14), 0x3a3a46, [0, 1.02, 0]);
  const lip = part(new THREE.TorusGeometry(0.31, 0.06, 6, 16), 0x55555f, [0, 1.17, 0], [Math.PI / 2, 0, 0]);
  const band = part(new THREE.TorusGeometry(1.0, 0.07, 8, 40), 0xe0262a, [0, 0, 0], [Math.PI / 2, 0, 0]);
  const band2 = part(new THREE.TorusGeometry(0.88, 0.05, 8, 36), 0xe0262a, [0, 0.5, 0], [Math.PI / 2, 0, 0], [1, 1, 1]);
  const rope = tube([[0, 1.15, 0], [0.12, 1.35, 0], [0.3, 1.5, 0], [0.12, 1.65, 0], [0, BOMB_TIP_Y, 0]], 0.065, 0.05, 0xc9a56a);
  return merge([body, collar, lip, band, band2, rope]);
}

// ---- power-ups ---------------------------------------------------------------------------------------------------
export function freezeGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1.0, 1);
}
export function frenzyGeometry(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(1.0, 0);
}
