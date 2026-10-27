// Fish AI: every species swims at its own depth, schools hold together, fish get curious about the bait and approach it,
// sometimes they are scared off (splash, fast reeling, an early strike). A "visitor" is a fish sent to a bait: it
// approaches, nibbles 1-3 times and then bites. Pure logic, no three.js; positions are world metres, y < 0 under water.

import { SPECIES, type Rng } from "./species";

export const AState = { Wander: 0, Curious: 1, Sniff: 2, Bite: 3, Leave: 4, Scared: 5, Hooked: 6 } as const;
export type AState = (typeof AState)[keyof typeof AState];

export interface Agent {
  active: boolean;
  /** index into SPECIES */
  species: number;
  weight: number;
  x: number;
  y: number;
  z: number;
  /** heading (unit vector in xz) */
  hx: number;
  hz: number;
  speed: number;
  state: AState;
  t: number;
  school: number;
  visitor: boolean;
  bait: number;
  nibbles: number;
  nibbleTarget: number;
  nibbleT: number;
  tx: number;
  tz: number;
  retarget: number;
  depthFrac: number;
  /** swimming animation phase */
  phase: number;
  /** curiosity trait 0..1 */
  curio: number;
  /** can't be tempted until this time (s) */
  immune: number;
  /** orbit angle around the bait while sniffing */
  orbit: number;
  /** vertical velocity for pitch */
  vy: number;
}

export interface Bait {
  active: boolean;
  x: number;
  z: number;
  /** how deep the hook hangs below the surface (m) */
  hookDepth: number;
  /** 0..1 how much the bait was disturbed recently (splash, fast reeling); decays by itself */
  disturb: number;
}

export interface WorldEnv {
  /** water depth at (x, z) (m) */
  depth(x: number, z: number): number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  rng: Rng;
  /** time of day activity (waiting time is divided by this) */
  activity: number;
  /** ambient fish like to stay around this spot (the part of the lake the player can see) */
  home?: { x: number; z: number; r: number };
  /** TOD multiplier per species index (curiosity) */
  speciesActivity?: (speciesIdx: number) => number;
}

export type AIEvent = "nibble" | "bite" | "scared" | "leave";

const newAgent = (): Agent => ({
  active: false, species: 0, weight: 1, x: 0, y: -1, z: 0, hx: 1, hz: 0, speed: 0.6, state: AState.Wander, t: 0, school: -1, visitor: false, bait: -1,
  nibbles: 0, nibbleTarget: 1, nibbleT: 0, tx: 0, tz: 0, retarget: 0, depthFrac: 0.5, phase: 0, curio: 0.5, immune: 0, orbit: 0, vy: 0,
});

export const CURIOUS_RADIUS = 4.5;
export const SNIFF_RADIUS = 0.55;
const NIBBLE_GAP = 0.9;

export class FishSim {
  readonly agents: Agent[];
  onEvent: ((e: AIEvent, a: Agent) => void) | null = null;
  private cx: Float32Array;
  private cz: Float32Array;
  private cn: Int16Array;
  private schools: number;

  constructor(readonly env: WorldEnv, capacity: number, schools = 4) {
    this.agents = Array.from({ length: capacity }, newAgent);
    this.schools = schools;
    this.cx = new Float32Array(schools);
    this.cz = new Float32Array(schools);
    this.cn = new Int16Array(schools);
  }

  // ---------------------------------------------------------------- placement
  private findWater(minDepth: number, cx: number, cz: number, radius: number): { x: number; z: number } | null {
    const e = this.env;
    for (let k = 0; k < 14; k++) {
      const a = e.rng() * Math.PI * 2;
      const r = radius * (0.4 + e.rng() * 0.6);
      const x = Math.min(e.maxX, Math.max(e.minX, cx + Math.cos(a) * r));
      const z = Math.min(e.maxZ, Math.max(e.minZ, cz + Math.sin(a) * r));
      if (e.depth(x, z) >= minDepth) return { x, z };
    }
    return null;
  }

  /** Put an agent somewhere in the water with the given species. */
  place(a: Agent, species: number, weight: number, x: number, z: number): void {
    const sp = SPECIES[species];
    a.active = true;
    a.species = species;
    a.weight = weight;
    a.x = x;
    a.z = z;
    const d = this.env.depth(x, z);
    a.depthFrac = sp.depth[0] + (sp.depth[1] - sp.depth[0]) * this.env.rng();
    a.y = -this.targetDepth(a, d);
    const ang = this.env.rng() * Math.PI * 2;
    a.hx = Math.cos(ang);
    a.hz = Math.sin(ang);
    a.speed = 0.45 + this.env.rng() * 0.5;
    a.state = AState.Wander;
    a.t = 0;
    a.visitor = false;
    a.bait = -1;
    a.nibbles = 0;
    a.retarget = 0;
    a.curio = this.env.rng();
    a.immune = 1 + this.env.rng() * 3;
    a.phase = this.env.rng() * 6.28;
    a.vy = 0;
    a.tx = x;
    a.tz = z;
  }

  /** Spawn `count` ambient fish of the given species indices inside the visible area, in schools. */
  populate(speciesList: number[], cx: number, cz: number, radius: number): void {
    const e = this.env;
    let ai = 0;
    let school = 0;
    for (let si = 0; si < speciesList.length && ai < this.agents.length; si++) {
      const sp = SPECIES[speciesList[si]];
      const size = Math.max(1, Math.min(sp.school, this.agents.length - ai));
      const home = this.findWater(sp.minWater, cx, cz, radius);
      if (!home) continue;
      for (let k = 0; k < size && ai < this.agents.length; k++) {
        const a = this.agents[ai++];
        const p = this.findWater(sp.minWater, home.x, home.z, 2.2) ?? home;
        const w = sp.w[0] + (sp.w[1] - sp.w[0]) * (0.15 + e.rng() * 0.5);
        this.place(a, speciesList[si], w, p.x, p.z);
        a.school = size > 1 ? school : -1;
      }
      if (size > 1) school = (school + 1) % this.schools;
    }
    for (; ai < this.agents.length; ai++) this.agents[ai].active = false;
  }

  private targetDepth(a: Agent, waterDepth: number): number {
    return Math.max(0.18, Math.min(waterDepth - 0.12, a.depthFrac * waterDepth));
  }

  /** Free (or least useful) agent for a visitor: an inactive one, else an ambient fish far from the bait. */
  private grab(bx: number, bz: number): Agent | null {
    let best: Agent | null = null;
    let bestD = -1;
    for (const a of this.agents) {
      if (a.visitor || a.state === AState.Hooked) continue;
      if (!a.active) return a;
      const d = Math.hypot(a.x - bx, a.z - bz);
      if (d > bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** A fish that will come to the bait. Returns null when no agent is free. */
  sendVisitor(baitIdx: number, bait: Bait, species: number, weight: number, junk = false): Agent | null {
    const a = this.grab(bait.x, bait.z);
    if (!a) return null;
    const sp = SPECIES[species];
    const e = this.env;
    let px = bait.x;
    let pz = bait.z;
    if (!junk) {
      const p = this.findWater(sp.minWater, bait.x, bait.z, 8) ?? { x: bait.x, z: bait.z - 4 };
      px = p.x;
      pz = p.z;
    }
    this.place(a, species, weight, px, pz);
    a.visitor = true;
    a.bait = baitIdx;
    a.school = -1;
    a.immune = 0;
    a.curio = 1;
    a.nibbleTarget = 1 + Math.floor(e.rng() * 3);
    a.state = junk ? AState.Sniff : AState.Curious;
    if (junk) {
      a.y = -Math.max(0.2, e.depth(bait.x, bait.z) - 0.15);
      a.x = bait.x;
      a.z = bait.z;
    }
    return a;
  }

  /** A fish takes the hook; movement is controlled by the game from now on. */
  hook(a: Agent): void {
    a.state = AState.Hooked;
    a.visitor = false;
  }

  /** The fish lost interest (strike window missed) and swims away; it can be reused later. */
  dismiss(a: Agent): void {
    if (a.state === AState.Hooked) return;
    a.state = AState.Leave;
    a.t = 0;
    a.visitor = false;
    a.bait = -1;
    a.immune = 8;
  }

  /** Back to the ambient pool, somewhere else. */
  recycle(a: Agent, species: number, weight: number, cx: number, cz: number, radius: number): void {
    const sp = SPECIES[species];
    const p = this.findWater(sp.minWater, cx, cz, radius);
    if (p) this.place(a, species, weight, p.x, p.z);
    else a.active = false;
  }

  scareAgent(a: Agent): void {
    if (a.state === AState.Hooked) return;
    a.state = AState.Scared;
    a.t = 0;
    a.visitor = false;
    a.bait = -1;
    a.immune = 6;
    this.onEvent?.("scared", a);
  }

  /** Scare every free fish within radius of (x, z). */
  scare(x: number, z: number, radius: number): number {
    let n = 0;
    for (const a of this.agents) {
      if (!a.active || a.state === AState.Hooked || a.state === AState.Scared) continue;
      if (Math.hypot(a.x - x, a.z - z) < radius) {
        this.scareAgent(a);
        n++;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- step
  step(dt: number, baits: Bait[]): void {
    const e = this.env;
    // school centroids
    this.cn.fill(0);
    this.cx.fill(0);
    this.cz.fill(0);
    for (const a of this.agents) {
      if (!a.active || a.school < 0 || a.state === AState.Hooked) continue;
      this.cx[a.school] += a.x;
      this.cz[a.school] += a.z;
      this.cn[a.school]++;
    }
    for (const b of baits) b.disturb = Math.max(0, b.disturb - dt * 0.6);
    for (const a of this.agents) {
      if (!a.active) continue;
      a.t += dt;
      a.immune = Math.max(0, a.immune - dt);
      a.phase += dt * (3 + a.speed * 4);
      if (a.state === AState.Hooked) continue;
      const water = Math.max(0.2, e.depth(a.x, a.z));
      let steerX = 0;
      let steerZ = 0;
      let speed = 0.5;
      const bait = a.bait >= 0 ? baits[a.bait] : null;

      // opportunistic curiosity for free fish
      if (a.state === AState.Wander && a.immune <= 0) {
        for (let bi = 0; bi < baits.length; bi++) {
          const b = baits[bi];
          if (!b.active) continue;
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          if (d < CURIOUS_RADIUS) {
            const act = e.activity * (e.speciesActivity ? e.speciesActivity(a.species) : 1);
            if (e.rng() < dt * 0.5 * a.curio * act) {
              a.state = AState.Curious;
              a.bait = bi;
              a.t = 0;
            }
          }
          if (b.disturb > 0.6 && d < 3.5) {
            this.scareAgent(a);
          }
        }
      }

      switch (a.state) {
        case AState.Wander: {
          a.retarget -= dt;
          const dx = a.tx - a.x;
          const dz = a.tz - a.z;
          if (a.retarget <= 0 || dx * dx + dz * dz < 1) {
            a.retarget = 3 + e.rng() * 5;
            const sp = SPECIES[a.species];
            let nx = a.x;
            let nz = a.z;
            if (a.school >= 0 && this.cn[a.school] > 1 && e.rng() < 0.5) {
              nx = this.cx[a.school] / this.cn[a.school] + (e.rng() - 0.5) * 6;
              nz = this.cz[a.school] / this.cn[a.school] + (e.rng() - 0.5) * 6;
            } else if (e.home && e.rng() < 0.6) {
              nx = e.home.x + (e.rng() * 2 - 1) * e.home.r;
              nz = e.home.z + (e.rng() * 2 - 1) * e.home.r * 0.8;
            } else {
              const ang = e.rng() * 6.28;
              const r = 3 + e.rng() * 7;
              nx = a.x + Math.cos(ang) * r;
              nz = a.z + Math.sin(ang) * r;
            }
            nx = Math.min(e.maxX, Math.max(e.minX, nx));
            nz = Math.min(e.maxZ, Math.max(e.minZ, nz));
            if (e.depth(nx, nz) >= sp.minWater) {
              a.tx = nx;
              a.tz = nz;
            } else {
              a.tx = a.x - (a.tx - a.x) * 0.5;
              a.tz = a.z - (a.tz - a.z) * 0.5;
            }
          }
          steerX = a.tx - a.x;
          steerZ = a.tz - a.z;
          // schooling: cohesion
          if (a.school >= 0 && this.cn[a.school] > 1) {
            steerX += (this.cx[a.school] / this.cn[a.school] - a.x) * 0.6;
            steerZ += (this.cz[a.school] / this.cn[a.school] - a.z) * 0.6;
          }
          speed = 0.5 + 0.25 * Math.sin(a.phase * 0.2);
          break;
        }
        case AState.Curious: {
          if (!bait || !bait.active) {
            this.dismiss(a);
            break;
          }
          steerX = bait.x - a.x;
          steerZ = bait.z - a.z;
          const d = Math.hypot(steerX, steerZ);
          speed = Math.min(1.8, 0.7 + d * 0.3);
          if (bait.disturb > 0.7 && d < 4 && !a.visitor) {
            this.scareAgent(a);
            break;
          }
          if (d < SNIFF_RADIUS + 0.2) {
            if (a.visitor || e.rng() < 0.3) {
              a.state = AState.Sniff;
              a.t = 0;
              a.nibbleT = 0.4;
              a.orbit = Math.atan2(a.z - bait.z, a.x - bait.x);
            } else {
              // looked at the bait and was not interested
              a.state = AState.Leave;
              a.t = 0;
              a.immune = 6;
              a.bait = -1;
              this.onEvent?.("leave", a);
            }
          } else if (a.t > 14) this.dismiss(a);
          break;
        }
        case AState.Sniff: {
          if (!bait || !bait.active) {
            this.dismiss(a);
            break;
          }
          // circle around the bait
          a.orbit += dt * 1.6;
          const tx = bait.x + Math.cos(a.orbit) * SNIFF_RADIUS;
          const tz = bait.z + Math.sin(a.orbit) * SNIFF_RADIUS;
          steerX = tx - a.x;
          steerZ = tz - a.z;
          speed = 0.9;
          if (bait.disturb > 0.8 && !a.visitor) this.scareAgent(a);
          a.nibbleT -= dt;
          if (a.nibbleT <= 0) {
            if (a.nibbles >= a.nibbleTarget) {
              a.state = AState.Bite;
              a.t = 0;
              this.onEvent?.("bite", a);
            } else {
              a.nibbles++;
              a.nibbleT = NIBBLE_GAP;
              this.onEvent?.("nibble", a);
            }
          }
          break;
        }
        case AState.Bite: {
          // holds the bait; the game decides (hook or dismiss)
          if (bait) {
            steerX = bait.x - a.x;
            steerZ = bait.z - a.z;
          }
          speed = 0.2;
          break;
        }
        case AState.Scared: {
          // flee away from the bait / the disturbance for ~1.8 s
          const away = bait ?? (baits[0]?.active ? baits[0] : null);
          if (away) {
            steerX = a.x - away.x;
            steerZ = a.z - away.z;
          } else {
            steerX = a.hx;
            steerZ = a.hz;
          }
          speed = 3;
          if (a.t > 1.8) {
            a.state = AState.Wander;
            a.retarget = 0;
            a.bait = -1;
          }
          break;
        }
        case AState.Leave: {
          if (a.t < 0.01) {
            a.tx = a.x + a.hx * 6;
            a.tz = a.z + a.hz * 6;
          }
          steerX = a.hx;
          steerZ = a.hz;
          speed = 0.9;
          if (a.t > 2.5) {
            a.state = AState.Wander;
            a.retarget = 0;
          }
          break;
        }
        default:
          break;
      }

      // separation from close schoolmates
      if (a.school >= 0) {
        for (const o of this.agents) {
          if (o === a || !o.active || o.school !== a.school) continue;
          const dx = a.x - o.x;
          const dz = a.z - o.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 0.5 && d2 > 1e-6) {
            steerX += (dx / Math.sqrt(d2)) * 0.8;
            steerZ += (dz / Math.sqrt(d2)) * 0.8;
          }
        }
      }
      // keep inside the area and away from the shallows
      const pad = 3;
      if (a.x < e.minX + pad) steerX += (e.minX + pad - a.x) * 2;
      if (a.x > e.maxX - pad) steerX -= (a.x - (e.maxX - pad)) * 2;
      if (a.z < e.minZ + pad) steerZ += (e.minZ + pad - a.z) * 2;
      if (a.z > e.maxZ - pad) steerZ -= (a.z - (e.maxZ - pad)) * 2;
      const sp = SPECIES[a.species];
      if (water < sp.minWater * 0.8 && a.state !== AState.Sniff && a.state !== AState.Bite && a.state !== AState.Curious) {
        // swim towards deeper water: probe a few directions
        let bx = 0;
        let bz = 0;
        let bd = water;
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * 6.28;
          const px = a.x + Math.cos(ang) * 2;
          const pz = a.z + Math.sin(ang) * 2;
          const dd = e.depth(px, pz);
          if (dd > bd) {
            bd = dd;
            bx = Math.cos(ang);
            bz = Math.sin(ang);
          }
        }
        steerX += bx * 3;
        steerZ += bz * 3;
      }

      // heading
      const sl = Math.hypot(steerX, steerZ);
      if (sl > 1e-4) {
        const tx = steerX / sl;
        const tz = steerZ / sl;
        const turn = 1 - Math.exp(-dt * (a.state === AState.Scared ? 12 : 3.2));
        let hx = a.hx + (tx - a.hx) * turn;
        let hz = a.hz + (tz - a.hz) * turn;
        const hl = Math.hypot(hx, hz) || 1;
        hx /= hl;
        hz /= hl;
        a.hx = hx;
        a.hz = hz;
      }
      a.speed += (speed - a.speed) * (1 - Math.exp(-dt * 3));
      a.x += a.hx * a.speed * dt;
      a.z += a.hz * a.speed * dt;
      // depth
      let ty = -this.targetDepth(a, water);
      if (a.state === AState.Sniff || a.state === AState.Bite) ty = -Math.min(bait?.hookDepth ?? 0.8, water - 0.1);
      else if (a.state === AState.Curious && bait) ty = -Math.min(bait.hookDepth, water - 0.1);
      const ny = a.y + (ty - a.y) * (1 - Math.exp(-dt * 1.8));
      a.vy = (ny - a.y) / dt;
      a.y = ny;
    }
  }
}
