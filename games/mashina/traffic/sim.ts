import { ROAD, laneOffset, type Edge, type Layout, type Node, type Zebra } from "../world/layout";
import type { LightColor } from "../logic/signals";

// Traffic AI (pure, no three.js): cars follow lanes of the road graph, obey traffic lights, STOP / give-way signs and
// pedestrians on zebras, keep their distance, wait for a free intersection box and overtake slow vehicles on the highway.
// The simulation runs only near the player (cars are spawned ahead and released far behind).

export type AiType = "sedan" | "krossover" | "truck" | "van";

export interface AiCar {
  id: number;
  type: AiType;
  color: number;
  len: number;
  edge: Edge;
  /** distance of the car centre from the start node along the edge */
  s: number;
  lane: number;
  /** lateral offset to the right of the road centre line (smoothed) */
  lat: number;
  v: number;
  vDes: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  /** intersection connector in progress */
  conn: { node: Node; next: Edge; t: number; len: number; ex: number; ez: number; px: number; pz: number; tx: number; tz: number; occ: boolean } | null;
  next: Edge | null;
  /** seconds waited at a stop line */
  waitT: number;
  stopDone: boolean;
  overtakeT: number;
  /** seconds the car is held after a collision */
  hold: number;
  age: number;
}

export interface TrafficCtx {
  lightColor(node: Node, axis: "x" | "z"): LightColor;
  /** a pedestrian is on or about to step on this zebra */
  pedsBlock(zebra: Zebra): boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
}

const BOX = 6;
const CAR_LEN: Record<AiType, number> = { sedan: 4.4, krossover: 4.6, truck: 8.8, van: 5.1 };

// (edges live as long as the layout: the key string is made once per edge, not once per car and frame)
const KEYS = new WeakMap<Edge, string>();
const key = (e: Edge): string => {
  let k = KEYS.get(e);
  if (k === undefined) KEYS.set(e, (k = `${e.from}>${e.to}`));
  return k;
};
const rightOf = (e: Edge): [number, number] => [-e.dz, e.dx];

export class TrafficSim {
  cars: AiCar[] = [];
  private nextId = 1;
  private edgeCars = new Map<string, AiCar[]>();
  /** cars that hold a reservation of an intersection box (from just before the stop line until they have left it) */
  private occ = new Map<string, Set<AiCar>>();
  /** target number of cars near the player */
  density = 1;
  /** cars appear this far from the player at most (m): the game keeps it inside the view of the quality level, so no car is simulated out of sight */
  spawnMax = 250;
  /** counters for tests / HUD */
  overtakes = 0;
  spawned = 0;

  constructor(
    private L: Layout,
    private ctx: TrafficCtx,
    private rng: () => number = Math.random,
  ) {}

  reset(): void {
    this.cars.length = 0;
    this.occ.clear();
    this.overtakes = 0;
    this.spawned = 0;
  }

  private node(id: string): Node {
    return this.L.nodes.get(id)!;
  }

  private laneAt(e: Edge, s: number, lane: number): number {
    if (e.taper) {
      const k = Math.min(1, Math.max(0, s / e.len));
      const t = k * k * (3 - 2 * k);
      const cityEnd = this.node(e.from).kind === "city";
      const a = ROAD.lane / 2;
      const b = ROAD.hwMedian / 2 + ROAD.hwLane / 2;
      return cityEnd ? a + (b - a) * t : b + (a - b) * t;
    }
    return laneOffset(e.highway, lane);
  }

  private place(c: AiCar): void {
    const e = c.edge;
    const A = this.node(e.from);
    const [rx, rz] = rightOf(e);
    if (c.conn) {
      const k = c.conn;
      const t = k.t;
      const u = 1 - t;
      c.x = u * u * k.ex + 2 * u * t * k.px + t * t * k.tx;
      c.z = u * u * k.ez + 2 * u * t * k.pz + t * t * k.tz;
      let dx = 2 * u * (k.px - k.ex) + 2 * t * (k.tx - k.px);
      let dz = 2 * u * (k.pz - k.ez) + 2 * t * (k.tz - k.pz);
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      c.fx = dx;
      c.fz = dz;
      return;
    }
    c.x = A.x + e.dx * c.s + rx * c.lat;
    c.z = A.z + e.dz * c.s + rz * c.lat;
    // slight yaw while changing lanes
    const target = this.laneAt(e, c.s, c.lane);
    const lean = Math.max(-0.25, Math.min(0.25, (target - c.lat) * 0.15));
    const fx = e.dx + rx * lean;
    const fz = e.dz + rz * lean;
    const l = Math.hypot(fx, fz) || 1;
    c.fx = fx / l;
    c.fz = fz / l;
  }

  private rebuildIndex(): void {
    // (the lists are emptied and reused: one per edge, no new array per frame)
    for (const l of this.edgeCars.values()) l.length = 0;
    for (const c of this.cars) {
      const k = key(c.conn ? c.conn.next : c.edge);
      // cars in a connector count for the NEXT edge (as leaders of whoever follows them) at s ~ 0
      let l = this.edgeCars.get(k);
      if (!l) this.edgeCars.set(k, (l = []));
      l.push(c);
      if (c.conn) {
        const k2 = key(c.edge);
        let l2 = this.edgeCars.get(k2);
        if (!l2) this.edgeCars.set(k2, (l2 = []));
        l2.push(c);
      }
    }
  }

  private chooseNext(c: AiCar): void {
    const e = c.edge;
    const B = this.node(e.to);
    const outs = (this.L.adj.get(B.id) ?? []).filter((o) => o.to !== e.from);
    if (!outs.length) {
      c.next = null;
      return;
    }
    const minor = (e.dx === 0) && (B.control === "stop" || B.control === "giveWay");
    const choices: { o: Edge; w: number }[] = [];
    for (const o of outs) {
      const cross = e.dx * o.dz - e.dz * o.dx;
      const straight = cross === 0;
      const left = cross < 0;
      if (left && !(minor || B.kind !== "city")) continue;
      choices.push({ o, w: straight ? 0.6 : left ? 0.15 : 0.3 });
    }
    if (!choices.length) {
      c.next = outs.find((o) => e.dx * o.dz - e.dz * o.dx === 0) ?? null;
      return;
    }
    let sum = 0;
    for (const ch of choices) sum += ch.w;
    let r = this.rng() * sum;
    for (const ch of choices) {
      r -= ch.w;
      if (r <= 0) {
        c.next = ch.o;
        return;
      }
    }
    c.next = choices[0].o;
  }

  private startConnector(c: AiCar): void {
    const e = c.edge;
    const o = c.next!;
    const B = this.node(e.to);
    const isCity = B.kind === "city";
    const [rx, rz] = rightOf(e);
    const [qx, qz] = rightOf(o);
    const offIn = this.laneAt(e, c.s, c.lane);
    const offOut = o.highway ? laneOffset(true, Math.min(c.lane, o.lanes - 1)) : this.laneAt(o, 0, 0);
    const h = isCity ? BOX : 0;
    const ex = B.x - e.dx * h + rx * offIn;
    const ez = B.z - e.dz * h + rz * offIn;
    const tx = B.x + o.dx * h + qx * offOut;
    const tz = B.z + o.dz * h + qz * offOut;
    let px = (ex + tx) / 2;
    let pz = (ez + tz) / 2;
    const cross = e.dx * o.dz - e.dz * o.dx;
    if (cross !== 0) {
      const dot = (tx - ex) * e.dx + (tz - ez) * e.dz;
      px = ex + e.dx * dot;
      pz = ez + e.dz * dot;
    }
    const len = Math.max(0.5, (Math.hypot(px - ex, pz - ez) + Math.hypot(tx - px, tz - pz)) * 0.85);
    c.conn = { node: B, next: o, t: 0, len, ex, ez, px, pz, tx, tz, occ: isCity };
    if (isCity) this.claim(B.id, c);
  }

  private claim(node: string, c: AiCar): void {
    let set = this.occ.get(node);
    if (!set) this.occ.set(node, (set = new Set()));
    set.add(c);
  }
  private release(node: string, c: AiCar): void {
    this.occ.get(node)?.delete(c);
  }
  private releaseAll(c: AiCar): void {
    for (const set of this.occ.values()) set.delete(c);
  }

  private endConnector(c: AiCar): void {
    const k = c.conn!;
    this.release(k.node.id, c);
    c.edge = k.next;
    c.s = k.node.kind === "city" ? BOX : 0;
    c.lane = Math.min(c.lane, c.edge.lanes - 1);
    c.lat = this.laneAt(c.edge, c.s, c.lane);
    c.conn = null;
    c.next = null;
    c.waitT = 0;
    c.stopDone = false;
  }

  /**
   * Another car (or the player) holds the intersection box in a way that conflicts with `self` entering it: a car
   * crossing from the side, or any car that is turning across.
   */
  private busy(node: Node, self: AiCar, player: Obstacle | null): boolean {
    const set = this.occ.get(node.id);
    if (set) {
      for (const o of set) {
        if (o === self) continue;
        const perpendicular = o.edge.dx * self.edge.dx + o.edge.dz * self.edge.dz === 0;
        const turning = !!o.conn && o.conn.next.dx * o.edge.dx + o.conn.next.dz * o.edge.dz !== 1;
        const sameEdge = o.edge === self.edge;
        if (perpendicular || (turning && !sameEdge)) return true;
      }
    }
    if (player && Math.abs(player.x - node.x) < BOX + 1 && Math.abs(player.z - node.z) < BOX + 1) return true;
    return false;
  }

  /** Is a car coming along the cross street of `node` close to the stop line? (also used by the rules for "yo'l bering") */
  crossTrafficNear(node: string, dx: number, dz: number, range = 30): boolean {
    const n = this.node(node);
    for (const o of this.occ.get(node) ?? []) if (o.edge.dx * dx + o.edge.dz * dz === 0) return true;
    for (const c of this.cars) {
      if (c.conn) continue;
      if (c.edge.to !== node) continue;
      const cross = c.edge.dx * dx + c.edge.dz * dz === 0;
      if (!cross) continue;
      const dist = Math.hypot(c.x - n.x, c.z - n.z) - ROAD.stopLine;
      if (dist < range && c.v > 1.2) return true;
    }
    return false;
  }

  private leaderGap(c: AiCar, player: Obstacle | null): { gap: number; v: number } {
    let best = Infinity;
    let bv = 99;
    const e = c.conn ? c.conn.next : c.edge;
    const list = [...(this.edgeCars.get(key(c.edge)) ?? []), ...(this.edgeCars.get(key(e)) ?? [])];
    for (const o of list) {
      if (o === c) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      const ahead = dx * c.fx + dz * c.fz;
      if (ahead <= 0 || ahead > 60) continue;
      const lat = Math.abs(dx * -c.fz + dz * c.fx);
      if (lat > (c.edge.highway ? 1.7 : 2.0)) continue;
      if (o.fx * c.fx + o.fz * c.fz < 0.3) continue;
      const g = ahead - (o.len + c.len) / 2;
      if (g < best) {
        best = g;
        bv = o.v;
      }
    }
    if (player) {
      const dx = player.x - c.x;
      const dz = player.z - c.z;
      const ahead = dx * c.fx + dz * c.fz;
      const lat = Math.abs(dx * -c.fz + dz * c.fx);
      if (ahead > 0 && ahead < 40 && lat < 2.1) {
        const g = ahead - (4.4 + c.len) / 2;
        if (g < best) {
          best = g;
          bv = Math.max(0, player.speed * (player.fx * c.fx + player.fz * c.fz));
        }
      }
    }
    return { gap: best, v: bv };
  }

  /** Speed profile: the fastest allowed speed so that the car can still stop `dist` metres ahead. */
  private stopSpeed(dist: number, brake = 3.5): number {
    return dist <= 0.3 ? 0 : Math.sqrt(2 * brake * dist);
  }

  private update1(c: AiCar, dt: number, t: number, player: Obstacle | null): void {
    c.age += dt;
    c.hold = Math.max(0, c.hold - dt);
    const e = c.edge;
    let vmax = c.hold > 0 ? 0 : c.vDes;

    if (!c.conn) {
      // ---- the next turn is decided well before the intersection
      if (!c.next && c.s > e.len - 45) this.chooseNext(c);
      const B = this.node(e.to);
      const front = c.s + c.len / 2;
      const isCity = B.kind === "city";
      // ---- stop line / light / sign / reservation of the box
      if (isCity) {
        const stopS = e.len - ROAD.stopLine;
        const dist = stopS - front;
        if (dist > -2) {
          const axis: "x" | "z" = e.dx !== 0 ? "x" : "z";
          let must = false;
          if (B.control === "light") {
            const col = this.ctx.lightColor(B, axis);
            must = col === "red" || (col === "yellow" && dist > (c.v * c.v) / 9 + 1);
          } else if ((B.control === "stop" || B.control === "giveWay") && axis === "z") {
            if (!c.stopDone) {
              must = true;
              if (dist < 2.5 && c.v < 0.4) {
                c.waitT += dt;
                const need = B.control === "stop" ? 1.3 : 0.5;
                if (c.waitT > need && !this.busy(B, c, player) && !this.priorityArriving(B, c)) c.stopDone = true;
              }
            }
          }
          // never drive into a box that is in use by a conflicting car, or when the queue beyond it has no room for us
          if (!must && dist > -0.5 && dist < 16 && (this.busy(B, c, player) || this.exitBlocked(c))) must = true;
          if (must && dist > -0.5) vmax = Math.min(vmax, this.stopSpeed(dist - 1.0));
          else if (!must && dist <= 1.0) this.claim(B.id, c);
        } else this.claim(B.id, c);
      }
      // ---- pedestrians on a zebra ahead
      for (const z of this.L.zebras) {
        const zOnEdge = z.axis === (e.dx !== 0 ? "x" : "z");
        if (!zOnEdge) continue;
        const A = this.node(e.from);
        const zs = (z.x - A.x) * e.dx + (z.z - A.z) * e.dz;
        const perp = Math.abs((z.x - A.x) * -e.dz + (z.z - A.z) * e.dx);
        if (perp > 1.5) continue;
        const d = zs - 3.2 - front;
        if (d > -1 && d < 40 && this.ctx.pedsBlock(z)) vmax = Math.min(vmax, this.stopSpeed(d));
      }
    }

    // ---- leader / player ahead
    const lead = this.leaderGap(c, player);
    if (lead.gap < 40) {
      // stay able to stop behind the leader: v_safe^2 = v_lead^2 + 2 b (gap - standstill distance)
      const safe = Math.sqrt(lead.v * lead.v + 2 * 3.2 * Math.max(0, lead.gap - 2.5));
      vmax = Math.min(vmax, safe);
      // overtake on the highway: slow leader, free lane on the left
      if (e.highway && c.lane > 0 && lead.gap < 28 && lead.v < c.vDes - 3 && c.overtakeT <= 0 && this.laneFree(c, c.lane - 1)) {
        c.lane--;
        c.overtakeT = 6;
        this.overtakes++;
      }
    }
    c.overtakeT = Math.max(0, c.overtakeT - dt);
    if (e.highway && c.lane < e.lanes - 1 && c.overtakeT <= 0 && lead.gap > 60 && this.laneFree(c, c.lane + 1)) c.lane++;

    // ---- speed
    c.v = Math.max(0, c.v + Math.max(-6.5 * dt, Math.min(2.6 * dt, vmax - c.v)));

    // ---- move
    const ds = c.v * dt;
    if (c.conn) {
      c.conn.t += ds / c.conn.len;
      if (c.conn.t >= 1) this.endConnector(c);
    } else {
      c.s += ds;
      c.lat += (this.laneAt(e, c.s, c.lane) - c.lat) * Math.min(1, dt * 1.6);
      const B = this.node(e.to);
      const boxH = B.kind === "city" ? BOX : 0;
      if (c.s >= e.len - boxH) {
        if (!c.next) this.chooseNext(c);
        if (c.next) {
          if (B.kind === "city" && this.busy(B, c, player)) {
            c.s = e.len - boxH - 0.01;
            c.v = 0;
          } else {
            c.s = e.len - boxH;
            this.startConnector(c);
          }
        } else if (c.s > e.len + 20) c.age = 1e9; // dead end: release
      }
    }
    void t;
    this.place(c);
  }

  /** The street we are about to turn into is jammed right behind the intersection. */
  private exitBlocked(c: AiCar): boolean {
    const n = c.next;
    if (!n) return false;
    for (const o of this.edgeCars.get(key(n)) ?? []) {
      if (o === c || o.conn) continue;
      if (o.s < 26 && o.v < 2.5 && (!n.highway || o.lane === Math.min(c.lane, n.lanes - 1))) return true;
    }
    return false;
  }

  private priorityArriving(node: Node, self: AiCar): boolean {
    for (const o of this.cars) {
      if (o === self || o.conn || o.edge.to !== node.id) continue;
      if (o.edge.dx === 0) continue; // same (minor) axis
      const dist = Math.hypot(o.x - node.x, o.z - node.z) - ROAD.stopLine;
      if (dist < 28 && o.v > 1.5) return true;
    }
    return false;
  }

  private laneFree(c: AiCar, lane: number): boolean {
    for (const o of this.edgeCars.get(key(c.edge)) ?? []) {
      if (o === c || o.lane !== lane) continue;
      const d = o.s - c.s;
      if (d > -22 && d < 45) return false;
    }
    return true;
  }

  /** Advance all cars. `player` is an obstacle (also blocks intersections). Spawns and releases cars around the player. */
  update(dt: number, t: number, player: Obstacle | null): void {
    this.rebuildIndex();
    for (const c of this.cars) this.update1(c, dt, t, player);
    if (player) this.manage(player);
  }

  private manage(p: Obstacle): void {
    // release (in place: no new array per frame)
    const cars = this.cars;
    let n = 0;
    for (const c of cars) {
      const gone = Math.hypot(c.x - p.x, c.z - p.z) > this.spawnMax + 80 || c.age > 1e8;
      if (gone) this.releaseAll(c);
      else cars[n++] = c;
    }
    cars.length = n;
    const want = Math.round(10 * this.density);
    if (this.cars.length >= want) return;
    if (this.rng() > 0.08) return;
    // candidate edges within spawn range, not in front of the camera
    const edges = this.L.edges;
    for (let tries = 0; tries < 6; tries++) {
      const e = edges[Math.floor(this.rng() * edges.length)];
      const A = this.node(e.from);
      const B = this.node(e.to);
      const s = BOX + 4 + this.rng() * (e.len - BOX - 4 - 46);
      const x = A.x + e.dx * s;
      const z = A.z + e.dz * s;
      const dp = Math.hypot(x - p.x, z - p.z);
      if (dp < 90 || dp > this.spawnMax) continue;
      // keep away from airfield / plaza ends
      if (B.kind === "airfield" && A.kind === "airfield") continue;
      const lane = e.highway ? Math.floor(this.rng() * Math.min(2, e.lanes)) + (e.lanes > 2 ? 1 : 0) : 0;
      if (this.spawnAt(e, s, lane)) return;
    }
  }

  spawnAt(e: Edge, s: number, lane: number, type?: AiType, color?: number): AiCar | null {
    const ty: AiType = type ?? (e.highway ? (this.rng() < 0.3 ? "truck" : this.rng() < 0.3 ? "van" : this.rng() < 0.5 ? "sedan" : "krossover") : this.rng() < 0.12 ? "van" : this.rng() < 0.55 ? "sedan" : "krossover");
    const len = CAR_LEN[ty];
    // free space around the spawn point
    for (const o of this.cars) {
      if (o.edge !== e && key(o.edge) !== key(e)) continue;
      if (Math.abs(o.s - s) < len + o.len + 14 && (!e.highway || o.lane === lane)) return null;
    }
    const palette = [0xffffff, 0x222222, 0x9e9e9e, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6d4c41, 0xb0bec5, 0xc62828, 0x283593];
    const cap = e.highway ? 26 : 13;
    const base = ty === "truck" ? 0.62 : 1;
    const c: AiCar = {
      id: this.nextId++,
      type: ty,
      color: color ?? palette[Math.floor(this.rng() * palette.length)],
      len,
      edge: e,
      s,
      lane,
      lat: this.laneAt(e, s, lane),
      v: 0,
      vDes: (e.highway ? 18 + this.rng() * (cap - 18) : 8 + this.rng() * 5) * base,
      x: 0,
      z: 0,
      fx: e.dx,
      fz: e.dz,
      conn: null,
      next: null,
      waitT: 0,
      stopDone: false,
      overtakeT: 0,
      hold: 0,
      age: 0,
    };
    c.v = c.vDes * 0.8;
    this.place(c);
    this.cars.push(c);
    this.spawned++;
    return c;
  }

  /** Hit a car (collision with the player): it stops for a moment. */
  bump(c: AiCar, secs = 1.5): void {
    c.hold = secs;
    c.v = 0;
  }
}

