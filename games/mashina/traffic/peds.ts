import { ROAD, type Layout, type Zebra } from "../world/layout";

// Pedestrians cross the street on the zebras (pure sim). A group starts when the player gets near; they walk across at
// 1.2-1.6 m/s like in the prototype, then the zebra rests for a few seconds before the next group.

export interface Ped {
  id: number;
  zebra: Zebra;
  dir: 1 | -1;
  /** position across the road (0 = centre line), metres */
  u: number;
  /** position along the road relative to the zebra centre */
  ds: number;
  v: number;
  ph: number;
  done: boolean;
  jump: number;
  x: number;
  z: number;
  yaw: number;
  hit: boolean;
  tint: number;
}

interface ZState {
  zebra: Zebra;
  cool: number;
  lastDone: number;
  doneAt: number | null;
  peds: Ped[];
}

const H = ROAD.cityHalf;
const CURB = H + ROAD.sidewalk * 0.7;

export class PedSim {
  readonly peds: Ped[] = [];
  private zs = new Map<string, ZState>();
  private nextId = 1;
  private time = 0;
  /** distance (m) around the player within which zebras are populated */
  range = 95;
  maxPeds = 18;

  constructor(
    private L: Layout,
    private rng: () => number = Math.random,
  ) {
    for (const z of L.zebras) this.zs.set(z.id, { zebra: z, cool: 0.5 + this.rng() * 2, lastDone: -99, doneAt: null, peds: [] });
  }

  reset(): void {
    this.peds.length = 0;
    for (const s of this.zs.values()) {
      s.peds.length = 0;
      s.cool = 0.5 + this.rng() * 2;
      s.lastDone = -99;
      s.doneAt = null;
    }
  }

  private pose(p: Ped): void {
    const z = p.zebra;
    if (z.axis === "x") {
      p.x = z.x + p.ds;
      p.z = z.z + p.u;
      p.yaw = p.dir > 0 ? 0 : Math.PI; // walking along +z / -z
    } else {
      p.x = z.x + p.u;
      p.z = z.z + p.ds;
      p.yaw = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  update(dt: number, px: number, pz: number): void {
    this.time += dt;
    for (const s of this.zs.values()) {
      const near = Math.hypot(s.zebra.x - px, s.zebra.z - pz) < this.range;
      // walk
      for (const p of s.peds) {
        if (!p.done) {
          p.u += p.dir * p.v * dt;
          p.ph += dt * 7;
          if (p.dir * p.u > CURB + 1.4) p.done = true;
        }
        if (p.jump > 0) {
          p.jump -= dt;
          p.u += (p.dir * (CURB + 1.4) - p.u) * Math.min(1, dt * 6);
        }
        this.pose(p);
      }
      if (s.peds.length && s.peds.every((p) => p.done)) {
        if (s.doneAt === null) {
          s.doneAt = this.time;
          s.lastDone = this.time;
        } else if (this.time - s.doneAt > 1.5) {
          for (const p of s.peds) this.peds.splice(this.peds.indexOf(p), 1);
          s.peds.length = 0;
          s.doneAt = null;
          s.cool = 5 + this.rng() * 7;
        }
      }
      if (!near) {
        if (s.peds.length) {
          for (const p of s.peds) this.peds.splice(this.peds.indexOf(p), 1);
          s.peds.length = 0;
          s.doneAt = null;
        }
        continue;
      }
      if (!s.peds.length) {
        s.cool -= dt;
        if (s.cool <= 0 && this.peds.length < this.maxPeds - 3) this.spawnGroup(s);
      }
    }
  }

  private spawnGroup(s: ZState): void {
    const n = 1 + Math.floor(this.rng() * 3);
    const dir: 1 | -1 = this.rng() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const p: Ped = {
        id: this.nextId++,
        zebra: s.zebra,
        dir,
        u: -dir * (CURB + 0.4 + i * 1.4),
        ds: -1.2 + this.rng() * 2.4,
        v: 1.2 + this.rng() * 0.4,
        ph: this.rng() * 6,
        done: false,
        jump: 0,
        x: 0,
        z: 0,
        yaw: 0,
        hit: false,
        tint: this.rng(),
      };
      this.pose(p);
      s.peds.push(p);
      this.peds.push(p);
    }
  }

  /** Tests: start a group of pedestrians on this zebra right now (no cool-down). */
  forceGroup(zebra: string): boolean {
    const s = this.zs.get(zebra);
    if (!s || s.peds.length) return false;
    this.spawnGroup(s);
    return true;
  }

  /** A pedestrian is on the carriageway of this zebra right now (the prototype's `|p.d| < ROAD_EDGE + .2`). */
  onRoad(zebra: string): boolean {
    const s = this.zs.get(zebra);
    return !!s && s.peds.some((p) => !p.done && Math.abs(p.u) < H + 0.2);
  }

  /** Someone is about to step on / is on the zebra (the traffic AI waits). */
  block(zebra: string): boolean {
    const s = this.zs.get(zebra);
    return !!s && s.peds.some((p) => !p.done && Math.abs(p.u) < H + 2.2);
  }

  /** Pedestrians are or were just crossing (so the car that waited deserves a thank-you). */
  active(zebra: string): boolean {
    const s = this.zs.get(zebra);
    return !!s && (s.peds.some((p) => !p.done) || this.time - s.lastDone < 4);
  }

  /** The car (centre, forward) runs into a pedestrian? Returns the ped. */
  hit(cx: number, cz: number, fx: number, fz: number): Ped | null {
    for (const p of this.peds) {
      if (p.done || p.jump > 0) continue;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const lz = dx * fx + dz * fz;
      const lx = dx * -fz + dz * fx;
      if (Math.abs(lz) < 2.5 && Math.abs(lx) < 1.15) return p;
    }
    return null;
  }

  knock(p: Ped): void {
    p.jump = 0.6;
    p.hit = true;
  }
}
