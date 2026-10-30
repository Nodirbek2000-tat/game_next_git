// City traffic on the street grid and pedestrians on the pavements. Few cars (a calm, believable city): they keep their
// lane, follow the car ahead, stop at red lights and turn at crossroads along a smooth curve. Pure TS.

import { clamp } from "@/engine/math";
import { HW, LANE, PITCH, STOP, WALK, ihash, segX, segZ, signal } from "./city";

/** does the street segment (axis, street index, segment index) exist (no streets inside open fields) */
const seg = (axis: "x" | "z", street: number, k: number): boolean => (axis === "z" ? segZ(street, k) : segX(street, k));

export type Kind = "sedan" | "krossover" | "van" | "truck";

export interface TCar {
  id: number;
  kind: Kind;
  len: number;
  width: number;
  color: number;
  x: number;
  z: number;
  h: number;
  v: number;
  braking: boolean;
  /** travel axis: "z" = along a street x = const, "x" = along a street z = const */
  axis: "x" | "z";
  dir: 1 | -1;
  lane: 0 | 1;
  /** the fixed coordinate of the lane (x for axis z, z for axis x) */
  line: number;
  /** coordinate along the axis */
  s: number;
  cruise: number;
  turn: { p: number[][]; t: number; len: number; next: { axis: "x" | "z"; dir: 1 | -1; lane: 0 | 1; line: number; s: number } } | null;
  /** the junction (along-axis coordinate) the car decided about */
  decided: number;
  stopped: number;
}

export interface Ped {
  x: number;
  z: number;
  h: number;
  i: number;
  j: number;
  u: number;
  dir: 1 | -1;
  speed: number;
  color: number;
  phase: number;
}

const KINDS: { kind: Kind; len: number; width: number; w: number }[] = [
  { kind: "sedan", len: 4.4, width: 1.85, w: 6 },
  { kind: "krossover", len: 4.6, width: 1.95, w: 3 },
  { kind: "van", len: 5.1, width: 1.95, w: 1.2 },
  { kind: "truck", len: 8.8, width: 2.5, w: 0.6 },
];
const COLORS = [0xf2f2f0, 0x1c1c1e, 0x8a8f94, 0xd9d9d6, 0x2b3a4a, 0x7a1a1a, 0x3b5d3a, 0xc9b38a, 0xb0b5ba, 0xffffff, 0x14284b];
const PED_COLORS = [0x2f4f7f, 0x8b2e2e, 0xe8e2d0, 0x3d5a3d, 0x6b4e9b, 0x222222, 0xc98a2e, 0x4f7f8f];

const laneOff = (lane: 0 | 1) => LANE * (lane + 0.5);

/** world position / heading of a car driving on (axis, dir, line, s) */
function pose(c: TCar): void {
  if (c.axis === "z") {
    c.x = c.line;
    c.z = c.s;
    c.h = c.dir > 0 ? 0 : Math.PI;
  } else {
    c.x = c.s;
    c.z = c.line;
    c.h = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}

/** lane line of a street (centre coordinate `street`) for a direction: right-hand traffic */
function lineOf(axis: "x" | "z", dir: 1 | -1, street: number, lane: 0 | 1): number {
  // heading +z: the right side is -x; heading +x: the right side is +z
  return axis === "z" ? street - dir * laneOff(lane) : street + dir * laneOff(lane);
}

function bez(p: number[][], t: number): [number, number, number, number] {
  const u = 1 - t;
  const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const z = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  const dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
  const dz = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
  return [x, z, dx, dz];
}

export class City {
  readonly cars: TCar[] = [];
  readonly peds: Ped[] = [];
  private seq = 0;
  private rnd: () => number;
  t = 0;

  constructor(
    private nCars = 10,
    private nPeds = 26,
    seed = 9,
  ) {
    let k = seed;
    this.rnd = () => ihash(k++, 7, 13);
  }

  /** Fill / recycle around the player (px, pz). */
  private keep(px: number, pz: number): void {
    while (this.cars.length < this.nCars) {
      const c = {} as TCar;
      if (this.spawnCar(c, px, pz, 40, 220)) this.cars.push(c);
      else break;
    }
    for (const c of this.cars) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 300) this.spawnCar(c, px, pz, 150, 260);
    }
    while (this.peds.length < this.nPeds) this.peds.push(this.spawnPed({} as Ped, px, pz));
    for (const p of this.peds) if (Math.hypot(p.x - px, p.z - pz) > 200) this.spawnPed(p, px, pz);
  }

  private spawnCar(c: TCar, px: number, pz: number, rMin: number, rMax: number): boolean {
    for (let tries = 0; tries < 12; tries++) {
      const axis: "x" | "z" = this.rnd() < 0.5 ? "x" : "z";
      const dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
      const lane: 0 | 1 = this.rnd() < 0.6 ? 1 : 0;
      // a street near the player, a spot between two crossroads
      const ci = Math.round((axis === "z" ? px : pz) / PITCH) + Math.floor((this.rnd() - 0.5) * 5);
      const street = ci * PITCH;
      const base = Math.floor((axis === "z" ? pz : px) / PITCH) + Math.floor((this.rnd() - 0.5) * 5);
      const s = base * PITCH + HW + 12 + this.rnd() * (PITCH - 2 * HW - 24);
      if (!seg(axis, ci, base)) continue;
      const line = lineOf(axis, dir, street, lane);
      const x = axis === "z" ? line : s;
      const z = axis === "z" ? s : line;
      const d = Math.hypot(x - px, z - pz);
      if (d < rMin || d > rMax) continue;
      if (this.cars.some((o) => o !== c && Math.hypot(o.x - x, o.z - z) < 14)) continue;
      const k = this.kindOf();
      Object.assign(c, {
        id: c.id ?? this.seq++, kind: k.kind, len: k.len, width: k.width, color: COLORS[Math.floor(this.rnd() * COLORS.length)],
        axis, dir, lane, line, s, v: 8, cruise: (k.kind === "truck" ? 9 : 11) + this.rnd() * 4, braking: false, turn: null, decided: NaN, stopped: 0,
      });
      pose(c);
      return true;
    }
    return false;
  }

  private kindOf(): (typeof KINDS)[number] {
    const tot = KINDS.reduce((a, k) => a + k.w, 0);
    let r = this.rnd() * tot;
    for (const k of KINDS) if ((r -= k.w) <= 0) return k;
    return KINDS[0];
  }

  private spawnPed(p: Ped, px: number, pz: number): Ped {
    const i = Math.floor(px / PITCH) + Math.floor((this.rnd() - 0.5) * 4);
    const j = Math.floor(pz / PITCH) + Math.floor((this.rnd() - 0.5) * 4);
    Object.assign(p, {
      i, j, u: this.rnd() * 4 * (PITCH - 2 * 10.5), dir: this.rnd() < 0.5 ? 1 : -1, speed: 1.1 + this.rnd() * 0.5,
      color: PED_COLORS[Math.floor(this.rnd() * PED_COLORS.length)], phase: this.rnd() * 10, x: 0, z: 0, h: 0,
    });
    this.pedPose(p);
    return p;
  }

  /** pedestrians walk around their block on the pavement (10.5 m from the street centres) */
  private pedPose(p: Ped): void {
    const off = 10.5;
    const L = PITCH - 2 * off;
    const per = 4 * L;
    const u = ((p.u % per) + per) % per;
    const x0 = p.i * PITCH + off;
    const z0 = p.j * PITCH + off;
    const side = Math.floor(u / L);
    const t = u - side * L;
    let x: number;
    let z: number;
    let dx: number;
    let dz: number;
    if (side === 0) [x, z, dx, dz] = [x0 + t, z0, 1, 0];
    else if (side === 1) [x, z, dx, dz] = [x0 + L, z0 + t, 0, 1];
    else if (side === 2) [x, z, dx, dz] = [x0 + L - t, z0 + L, -1, 0];
    else [x, z, dx, dz] = [x0, z0 + L - t, 0, -1];
    p.x = x;
    p.z = z;
    p.h = Math.atan2(dx * p.dir, dz * p.dir);
  }

  step(dt: number, px: number, pz: number, pv: { x: number; z: number }): void {
    this.t += dt;
    this.keep(px, pz);
    for (const c of this.cars) this.drive(c, dt, px, pz, pv);
    for (const p of this.peds) {
      // step aside from a car that comes too close
      const d = Math.hypot(p.x - px, p.z - pz);
      const sp = d < 6 ? 0 : p.speed;
      p.u += p.dir * sp * dt;
      p.phase += sp * dt * 2.2;
      this.pedPose(p);
    }
  }

  private drive(c: TCar, dt: number, px: number, pz: number, pv: { x: number; z: number }): void {
    if (c.stopped > 0) {
      c.stopped -= dt;
      c.v = Math.max(0, c.v - 12 * dt);
      c.braking = true;
      return;
    }
    let vT = c.cruise;
    if (c.turn) {
      vT = Math.min(vT, c.turn.next.lane === 1 ? 6 : 8);
    } else {
      // the next crossroads ahead
      const n = c.dir > 0 ? Math.ceil((c.s + HW + 0.01) / PITCH) * PITCH : Math.floor((c.s - HW - 0.01) / PITCH) * PITCH;
      const toEdge = Math.abs(n - c.s) - HW;
      // the front bumper stops half a metre before the stop line
      const toStop = toEdge - STOP - c.len / 2 - 0.5;
      const streetIdx = Math.round((c.axis === "z" ? c.line : c.line) / PITCH);
      const ji = n / PITCH;
      const sig = c.axis === "z" ? signal("z", streetIdx, ji, this.t) : signal("x", ji, streetIdx, this.t);
      if (sig !== 2 && toStop > -1 && toStop < 40) {
        // stop at the line (yellow: go on if too close to stop)
        if (!(sig === 1 && toStop < c.v * 0.6)) vT = Math.min(vT, Math.sqrt(2 * 3.5 * Math.max(0, toStop)));
      }
      if (toEdge <= 0.5 && c.decided !== n) {
        c.decided = n;
        this.decide(c, n, streetIdx);
      }
    }
    // the car ahead in the same lane / the player
    const fx = Math.sin(c.h);
    const fz = Math.cos(c.h);
    let gap = 1e9;
    let leadV = 0;
    for (const o of this.cars) {
      if (o === c) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      if (ahead > 0 && ahead < 40 && side < 2.2) {
        const g = ahead - (o.len + c.len) / 2;
        if (g < gap) {
          gap = g;
          leadV = o.v;
        }
      }
    }
    {
      const dx = px - c.x;
      const dz = pz - c.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      if (ahead > 0 && ahead < 40 && side < 2.4) {
        const g = ahead - (4.6 + c.len) / 2;
        if (g < gap) {
          gap = g;
          leadV = Math.max(0, pv.x * fx + pv.z * fz);
        }
      }
    }
    if (gap < 1e8) vT = Math.min(vT, Math.max(0, leadV + (gap - 6) * 0.6));
    c.braking = vT < c.v - 0.5;
    c.v += clamp(vT - c.v, -7 * dt, 2.2 * dt);
    if (c.turn) {
      const tr = c.turn;
      tr.t += (c.v * dt) / tr.len;
      if (tr.t >= 1) {
        Object.assign(c, tr.next);
        c.turn = null;
        pose(c);
      } else {
        const [x, z, dx, dz] = bez(tr.p, tr.t);
        c.x = x;
        c.z = z;
        c.h = Math.atan2(dx, dz);
      }
    } else {
      c.s += c.dir * c.v * dt;
      pose(c);
    }
  }

  /** at the crossroads: straight on, or a smooth right / left turn onto the crossing street */
  private decide(c: TCar, n: number, streetIdx: number): void {
    // directions as vectors; the right of heading (fx, fz) is (-fz, fx)
    const f = c.axis === "z" ? [0, c.dir] : [c.dir, 0];
    const right = [-f[1], f[0]];
    const jx = c.axis === "z" ? streetIdx * PITCH : n;
    const jz = c.axis === "z" ? n : streetIdx * PITCH;
    const go = (v: number[]) => {
      const axis: "x" | "z" = v[0] !== 0 ? "x" : "z";
      const dir = (v[0] !== 0 ? v[0] : v[1]) as 1 | -1;
      const street = axis === "z" ? jx / PITCH : jz / PITCH;
      const along = (axis === "z" ? jz : jx) / PITCH;
      return { axis, dir, street, ok: seg(axis, Math.round(street), Math.round(dir > 0 ? along : along - 1)) };
    };
    const opts = { straight: go(f), right: go(right), left: go([-right[0], -right[1]]) };
    const r = this.rnd();
    let turn: "straight" | "right" | "left" | "back" = c.lane === 1 ? (r < 0.4 ? "right" : "straight") : r < 0.35 ? "left" : "straight";
    if (!opts[turn].ok) turn = (["straight", "right", "left"] as const).find((t) => opts[t].ok) ?? "back";
    if (turn === "straight") return;
    if (turn === "back") {
      // a dead end (the edge of a field): turn round on the spot
      c.dir = -c.dir as 1 | -1;
      c.line = lineOf(c.axis, c.dir, streetIdx * PITCH, c.lane);
      c.decided = NaN;
      pose(c);
      return;
    }
    const o = opts[turn];
    const nf = turn === "right" ? right : [-right[0], -right[1]];
    const lane: 0 | 1 = turn === "right" ? 1 : 0;
    const street = o.axis === "z" ? jx : jz;
    const line = lineOf(o.axis, o.dir, street, lane);
    const s = (o.axis === "z" ? jz : jx) + o.dir * (HW + 1);
    const ex = o.axis === "z" ? line : s;
    const ez = o.axis === "z" ? s : line;
    const L = Math.hypot(ex - c.x, ez - c.z);
    const k = L * 0.5;
    const p = [
      [c.x, c.z],
      [c.x + f[0] * k, c.z + f[1] * k],
      [ex - nf[0] * k, ez - nf[1] * k],
      [ex, ez],
    ];
    c.turn = { p, t: 0, len: L * 1.12, next: { axis: o.axis, dir: o.dir, lane, line, s } };
  }

  /** a car hit by the player stops for a moment */
  bump(c: TCar): void {
    c.stopped = 2.5;
  }
}

/** Collision circle(s) of a traffic car: centre front / back. */
export function carCircles(c: TCar): [number, number, number][] {
  const fx = Math.sin(c.h);
  const fz = Math.cos(c.h);
  const r = c.width / 2;
  const o = c.len / 2 - r;
  return [
    [c.x + fx * o, c.z + fz * o, r],
    [c.x - fx * o, c.z - fz * o, r],
  ];
}

export { WALK };
