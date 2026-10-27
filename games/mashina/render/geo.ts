import * as THREE from "three";

const _c = new THREE.Color();

/** Linear RGB triple of a hex colour (what vertex colours expect with colour management on). */
export function rgb(hex: number | string): [number, number, number] {
  _c.set(hex as THREE.ColorRepresentation);
  return [_c.r, _c.g, _c.b];
}

type Col = number | string | [number, number, number];
const col3 = (c: Col): [number, number, number] => (Array.isArray(c) ? c : rgb(c));

/**
 * Accumulates triangles (flat shaded: every face has its own vertices) with vertex colours and UVs, then builds ONE
 * BufferGeometry. All the static scenery of a tile is merged this way (the prototype's mergeStatic idea), which is
 * what keeps the draw-call count tiny. A small transform stack (translate + yaw) lets one function build a rotated
 * building from local coordinates.
 */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  // current transform: x' = a*x + b*z + tx ; z' = -b*x + a*z + tz (rotation about y), y unchanged
  private a = 1;
  private b = 0;
  private tx = 0;
  private tz = 0;
  private stack: number[][] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Enter a local frame at (x, z) rotated by `yaw` (radians, three.js rotation.y convention). */
  push(x: number, z: number, yaw: number): this {
    this.stack.push([this.a, this.b, this.tx, this.tz]);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // compose: new = old * local
    const na = this.a * c + this.b * -s;
    const nb = this.a * s + this.b * c;
    const ntx = this.a * x + this.b * z + this.tx;
    const ntz = -this.b * x + this.a * z + this.tz;
    this.a = na;
    this.b = nb;
    this.tx = ntx;
    this.tz = ntz;
    return this;
  }
  pop(): this {
    const s = this.stack.pop();
    if (s) [this.a, this.b, this.tx, this.tz] = s;
    return this;
  }

  private tp(x: number, z: number): [number, number] {
    return [this.a * x + this.b * z + this.tx, -this.b * x + this.a * z + this.tz];
  }
  private tn(x: number, z: number): [number, number] {
    return [this.a * x + this.b * z, -this.b * x + this.a * z];
  }

  /** Quad from 4 local points (counter-clockwise seen from the normal side). */
  quad(
    p: [number, number, number],
    q: [number, number, number],
    r: [number, number, number],
    s: [number, number, number],
    color: Col,
    uv?: [number, number, number, number, number, number, number, number],
  ): this {
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [tnx, tnz] = this.tn(nx, nz);
    const c = col3(color);
    const base = this.vertexCount;
    const pts = [p, q, r, s];
    for (let i = 0; i < 4; i++) {
      const [x, z] = this.tp(pts[i][0], pts[i][2]);
      this.pos.push(x, pts[i][1], z);
      this.nor.push(tnx, ny, tnz);
      this.col.push(c[0], c[1], c[2]);
    }
    if (uv) this.uv.push(...uv);
    else this.uv.push(0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  /** Triangle (counter-clockwise seen from the normal side). */
  tri(p: [number, number, number], q: [number, number, number], r: [number, number, number], color: Col): this {
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [tnx, tnz] = this.tn(nx, nz);
    const c = col3(color);
    const base = this.vertexCount;
    for (const v of [p, q, r]) {
      const [x, z] = this.tp(v[0], v[2]);
      this.pos.push(x, v[1], z);
      this.nor.push(tnx, ny, tnz);
      this.col.push(c[0], c[1], c[2]);
      this.uv.push(0.03, 0.03);
    }
    this.idx.push(base, base + 1, base + 2);
    return this;
  }

  /** Horizontal rectangle facing up: x0..x1, z0..z1 (local), at height y. UVs are world metres / 8 (grain texture). */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: Col): this {
    const [ax, az] = this.tp(x0, z0);
    const [bx, bz] = this.tp(x1, z1);
    const k = 1 / 8;
    return this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], color, [ax * k, az * k, ax * k, bz * k, bx * k, bz * k, bx * k, az * k]);
  }

  /** Cylinder lying along the local x axis (wheels). */
  cylX(cx: number, cy: number, cz: number, r: number, len: number, color: Col, n = 14): this {
    const x0 = cx - len / 2;
    const x1 = cx + len / 2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (x: number, a: number): [number, number, number] => [x, cy + Math.sin(a) * r, cz + Math.cos(a) * r];
      this.quad(p(x0, a0), p(x0, a1), p(x1, a1), p(x1, a0), color);
      this.tri([x1, cy, cz], p(x1, a0), p(x1, a1), color);
      this.tri([x0, cy, cz], p(x0, a1), p(x0, a0), color);
    }
    return this;
  }

  /** Extrude a side profile (z, y pairs, convex, any winding) along x between -hw and +hw; the top is inset by `inset`. */
  profile(pts: [number, number][], hw: number, color: Col, inset = 0): this {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [z0, y0] = pts[i];
      const [z1, y1] = pts[(i + 1) % pts.length];
      area += z0 * y1 - z1 * y0;
    }
    const p = area > 0 ? pts : [...pts].reverse();
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const [, y] of p) {
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    const w = (y: number): number => hw - inset * ((y - ymin) / Math.max(1e-6, ymax - ymin));
    // side caps
    for (const sgn of [1, -1]) {
      for (let i = 1; i < p.length - 1; i++) {
        const A: [number, number, number] = [sgn * w(p[0][1]), p[0][1], p[0][0]];
        const B: [number, number, number] = [sgn * w(p[i][1]), p[i][1], p[i][0]];
        const C: [number, number, number] = [sgn * w(p[i + 1][1]), p[i + 1][1], p[i + 1][0]];
        if (sgn > 0) this.tri(A, C, B, color);
        else this.tri(A, B, C, color);
      }
    }
    // outer surfaces
    for (let i = 0; i < p.length; i++) {
      const [z0, y0] = p[i];
      const [z1, y1] = p[(i + 1) % p.length];
      this.quad([w(y0), y0, z0], [w(y1), y1, z1], [-w(y1), y1, z1], [-w(y0), y0, z0], color);
    }
    return this;
  }

  /** Axis-aligned (in the local frame) box standing on y0. UVs on the walls tile one window bay per 3.2 m x 3.4 m. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: Col, opts: { top?: Col; windows?: boolean; noTop?: boolean } = {}): this {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const y1 = y0 + h;
    const win = opts.windows;
    const uw = win ? w / 3.2 : 0;
    const ud = win ? d / 3.2 : 0;
    const vh = win ? h / 3.4 : 0;
    const wall = (a: [number, number, number], b: [number, number, number], c: [number, number, number], e: [number, number, number], u: number): void => {
      this.quad(a, b, c, e, color, win ? [0, 0, u, 0, u, vh, 0, vh] : undefined);
    };
    // +z, -z, +x, -x walls (outward normals)
    wall([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uw);
    wall([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uw);
    wall([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], ud);
    wall([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], ud);
    if (!opts.noTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opts.top ?? color);
    return this;
  }

  /** Vertical cylinder (n sides) with a flat top. */
  cyl(cx: number, y0: number, cz: number, r: number, h: number, color: Col, n = 8, r2 = r): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0: [number, number, number] = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p1: [number, number, number] = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const q0: [number, number, number] = [cx + Math.cos(a0) * r2, y0 + h, cz + Math.sin(a0) * r2];
      const q1: [number, number, number] = [cx + Math.cos(a1) * r2, y0 + h, cz + Math.sin(a1) * r2];
      this.quad(p1, p0, q0, q1, color);
      if (r2 > 0) this.tri([cx, y0 + h, cz], q1, q0, color);
    }
    return this;
  }

  cone(cx: number, y0: number, cz: number, r: number, h: number, color: Col, n = 7): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri([cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx, y0 + h, cz], color);
    }
    return this;
  }

  /** Low-poly blob (octahedron subdivided once = 32 faces) for tree crowns / bushes. */
  blob(cx: number, cy: number, cz: number, r: number, color: Col, sy = 1): this {
    const v = (x: number, y: number, z: number): [number, number, number] => {
      const l = Math.hypot(x, y, z) || 1;
      return [cx + (x / l) * r, cy + (y / l) * r * sy, cz + (z / l) * r];
    };
    const P = [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)];
    const faces = [
      [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
      [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5],
    ];
    for (const [i, j, k] of faces) {
      const a = P[i];
      const b = P[j];
      const c = P[k];
      const m = (p: [number, number, number], q: [number, number, number]): [number, number, number] =>
        v((p[0] + q[0] - 2 * cx) / 2, (p[1] + q[1] - 2 * cy) / 2 / sy, (p[2] + q[2] - 2 * cz) / 2);
      const ab = m(a, b);
      const bc = m(b, c);
      const ca = m(c, a);
      this.tri(a, ab, ca, color);
      this.tri(ab, b, bc, color);
      this.tri(ca, bc, c, color);
      this.tri(ab, bc, ca, color);
    }
    return this;
  }

  /** Half sphere dome with `rings` x `seg` quads. */
  dome(cx: number, y0: number, cz: number, r: number, color: Col, seg = 12, rings = 5, sy = 1): this {
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * (Math.PI / 2);
      const t1 = ((j + 1) / rings) * (Math.PI / 2);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const pt = (t: number, a: number): [number, number, number] => [cx + Math.cos(a) * Math.cos(t) * r, y0 + Math.sin(t) * r * sy, cz + Math.sin(a) * Math.cos(t) * r];
        const p00 = pt(t0, a0);
        const p01 = pt(t0, a1);
        const p10 = pt(t1, a0);
        const p11 = pt(t1, a1);
        if (j === rings - 1) this.tri(p01, p00, p10, color);
        else this.quad(p01, p00, p10, p11, color);
      }
    }
    return this;
  }

  /** Gable roof over a w x d footprint (ridge along z). */
  gable(cx: number, y0: number, cz: number, w: number, d: number, h: number, color: Col): this {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const ym = y0 + h;
    this.quad([x0, y0, z1], [cx, ym, z1], [cx, ym, z0], [x0, y0, z0], color);
    this.quad([cx, ym, z1], [x1, y0, z1], [x1, y0, z0], [cx, ym, z0], color);
    this.tri([x1, y0, z1], [cx, ym, z1], [x0, y0, z1], color);
    this.tri([x0, y0, z0], [cx, ym, z0], [x1, y0, z0], color);
    return this;
  }

  /** Disc lying on the ground (n-gon). */
  disc(cx: number, y: number, cz: number, r: number, color: Col, n = 16): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri([cx, y, cz], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], color);
    }
    return this;
  }

  /** Flat ring on the ground. */
  ring(cx: number, y: number, cz: number, r0: number, r1: number, color: Col, n = 48): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.quad(
        [cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0],
        [cx + Math.cos(a1) * r0, y, cz + Math.sin(a1) * r0],
        [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1],
        [cx + Math.cos(a0) * r1, y, cz + Math.sin(a0) * r1],
        color,
      );
    }
    return this;
  }

  /** Textured quad facing +z of the local frame, centred at (cx, cy, cz) (signs). UV = [u0, v0, u1, v1]. */
  sign(cx: number, cy: number, cz: number, w: number, h: number, uv: [number, number, number, number]): this {
    const [u0, v0, u1, v1] = uv;
    return this.quad([cx - w / 2, cy - h / 2, cz], [cx + w / 2, cy - h / 2, cz], [cx + w / 2, cy + h / 2, cz], [cx - w / 2, cy + h / 2, cz], 0xffffff, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
