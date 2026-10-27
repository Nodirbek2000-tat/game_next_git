import type { ModeId } from "../config";
import { findRoute, STUB, type Layout } from "../world/layout";

export interface Spawn {
  x: number;
  z: number;
  /** unit forward vector */
  fx: number;
  fz: number;
}

export const yawOf = (fx: number, fz: number): number => Math.atan2(fx, fz);

/** Start position per mode. Every spawn is on a lane facing the traffic direction. */
export function spawnFor(L: Layout, mode: ModeId): Spawn {
  if (mode === "imtihon") {
    const t = L.tiles.get("1,2")!;
    return { x: t.cx + 1.8, z: t.cz + STUB - 5, fx: 0, fz: -1 };
  }
  if (mode === "drift") {
    const t = L.tileList.find((k) => k.kind === "airfield")!;
    return { x: t.x0 + 60, z: t.z0 + 60, fx: 1, fz: 0 };
  }
  const t = L.tiles.get("2,1")!;
  return { x: t.cx - 38, z: t.cz + 1.8, fx: 1, fz: 0 };
}

/** The driving-school route of the exam: node path from the start to the Registan (STOP, zebras, a light, STOP again). */
export const EXAM_NODES = ["1,2", "0,2", "0,1", "0,0"];

export interface Waypoint {
  x: number;
  z: number;
  name: string;
}

export function examWaypoints(L: Layout): Waypoint[] {
  return EXAM_NODES.map((id) => {
    const n = L.nodes.get(id)!;
    return { x: n.x, z: n.z, name: id };
  });
}

/** Waypoints (intersection centres + finish) for GPS. */
export function routePoints(L: Layout, from: string, to: string): Waypoint[] {
  return findRoute(L, from, to).map((id) => {
    const n = L.nodes.get(id)!;
    return { x: n.x, z: n.z, name: id };
  });
}

export interface Mission {
  id: string;
  /** shown on the HUD */
  title: string;
  kind: "reach" | "ride";
  /** landmark id of the destination */
  target: string;
  /** landmark id of the pickup spot (ride) */
  pickup?: string;
  timeSec: number;
  reward: number;
}

export const MISSIONS: Mission[] = [
  { id: "m1", title: "Registon maydoniga 3 daqiqada yetib boring", kind: "reach", target: "registon", timeSec: 180, reward: 600 },
  { id: "m2", title: "Yo‘lovchini oling va Bozorga eltib qo‘ying", kind: "ride", pickup: "yolovchi", target: "bozor", timeSec: 150, reward: 700 },
  { id: "m3", title: "Aerodromdagi drift maydoniga 2 daqiqada yetib boring", kind: "reach", target: "aerodrom", timeSec: 120, reward: 900 },
];

export type MissionEvent =
  | { type: "start"; mission: Mission }
  | { type: "pickup"; mission: Mission }
  | { type: "done"; mission: Mission; timeLeft: number; reward: number }
  | { type: "fail"; mission: Mission };

export interface Point {
  x: number;
  z: number;
  r: number;
}

/** Missions one after another; "reach" needs the target circle, "ride" needs a short stop at the pickup, then the target. */
export class MissionRunner {
  index = -1;
  timeLeft = 0;
  passenger = false;
  completed = 0;
  failed = 0;
  private hold = 0;
  private finished = false;

  constructor(
    private missions: Mission[],
    private spot: (id: string) => Point,
    private ev: (e: MissionEvent) => void,
  ) {}

  get current(): Mission | null {
    return this.missions[this.index] ?? null;
  }
  get allDone(): boolean {
    return this.finished;
  }

  start(): void {
    this.index = -1;
    this.finished = false;
    this.completed = this.failed = 0;
    this.next();
  }

  private next(): void {
    this.index++;
    this.passenger = false;
    this.hold = 0;
    const m = this.current;
    if (!m) {
      this.finished = true;
      return;
    }
    this.timeLeft = m.timeSec;
    this.ev({ type: "start", mission: m });
  }

  /** The point the car should drive to now (pickup, then destination). */
  target(): Point | null {
    const m = this.current;
    if (!m) return null;
    return m.kind === "ride" && !this.passenger ? this.spot(m.pickup!) : this.spot(m.target);
  }

  update(dt: number, x: number, z: number, speed: number): void {
    const m = this.current;
    if (!m) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.failed++;
      this.ev({ type: "fail", mission: m });
      this.next();
      return;
    }
    const t = this.target()!;
    const inside = (x - t.x) ** 2 + (z - t.z) ** 2 <= t.r * t.r;
    if (m.kind === "reach") {
      if (inside) this.finish(m);
      return;
    }
    // ride: stop for a moment at the pickup / destination
    if (inside && Math.abs(speed) < 1.5) this.hold += dt;
    else this.hold = Math.max(0, this.hold - dt);
    if (this.hold >= 1.2) {
      this.hold = 0;
      if (!this.passenger) {
        this.passenger = true;
        this.ev({ type: "pickup", mission: m });
      } else this.finish(m);
    }
  }

  private finish(m: Mission): void {
    this.completed++;
    this.ev({ type: "done", mission: m, timeLeft: this.timeLeft, reward: m.reward + Math.round(this.timeLeft * 2) });
    this.next();
  }
}
