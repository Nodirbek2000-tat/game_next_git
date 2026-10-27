import { RULE_DEFAULTS, type RuleConfig } from "../config";
import { inRect, zoneAt, type Layout, type RuleDef, type SpeedZone } from "../world/layout";
import type { LightColor } from "./signals";

export type VerdictKind =
  | "speed"
  | "redLight"
  | "stop"
  | "pedestrian"
  | "pedHit"
  | "crash"
  | "wrongWay"
  | "noStop"
  | "giveWay"
  | "offRoad"
  | "lightOk"
  | "stopOk"
  | "pedOk"
  | "giveWayOk"
  | "cityOk";

export interface Verdict {
  kind: VerdictKind;
  ok: boolean;
  text: string;
  /** score delta in free / mission mode (prototype numbers) */
  score: number;
  /** exam penalty points (0 for good behaviour) */
  penalty: number;
}

export interface RuleContext {
  lightColor(def: Extract<RuleDef, { type: "light" }>): LightColor;
  /** a pedestrian is on the carriageway of this zebra right now */
  pedsOnRoad(zebra: string): boolean;
  /** pedestrians are (or just were) crossing at this zebra */
  pedsActive(zebra: string): boolean;
  /** a car is coming along the cross street of this node, close enough to matter */
  crossTraffic(node: string, dx: number, dz: number): boolean;
}

export interface VehicleSample {
  x: number;
  z: number;
  /** |forward speed| in m/s */
  speed: number;
  fx: number;
  fz: number;
  /** on a road surface */
  onRoad: boolean;
  grounded: boolean;
}

const TOL = 0.9;

interface DefState {
  prev: number | null;
  minV: number;
  judged: boolean;
  stopped: boolean;
  /** the car has been moving (> 3 m/s) inside the approach: a car that starts from rest does not get a free STOP */
  moved: boolean;
}

export function verdict(kind: VerdictKind, text: string, cfg: RuleConfig = RULE_DEFAULTS): Verdict {
  const s = cfg.score;
  const p = cfg.penalty;
  switch (kind) {
    case "speed": return { kind, ok: false, text, score: s.speed, penalty: p.speed };
    case "redLight": return { kind, ok: false, text, score: s.lightBad, penalty: p.redLight };
    case "stop": return { kind, ok: false, text, score: s.stopBad, penalty: p.stop };
    case "pedestrian": return { kind, ok: false, text, score: s.pedBad, penalty: p.pedestrian };
    case "pedHit": return { kind, ok: false, text, score: s.pedHit, penalty: p.pedHit };
    case "crash": return { kind, ok: false, text, score: s.crash, penalty: p.crash };
    case "wrongWay": return { kind, ok: false, text, score: s.wrongWay, penalty: p.wrongWay };
    case "noStop": return { kind, ok: false, text, score: s.noStop, penalty: p.noStop };
    case "giveWay": return { kind, ok: false, text, score: s.giveWayBad, penalty: p.giveWay };
    case "offRoad": return { kind, ok: false, text, score: 0, penalty: p.offRoad };
    case "lightOk": return { kind, ok: true, text, score: s.lightOk, penalty: 0 };
    case "stopOk": return { kind, ok: true, text, score: s.stopOk, penalty: 0 };
    case "pedOk": return { kind, ok: true, text, score: s.pedOk, penalty: 0 };
    case "giveWayOk": return { kind, ok: true, text, score: s.giveWayOk, penalty: 0 };
    case "cityOk": return { kind, ok: true, text, score: s.cityOk, penalty: 0 };
  }
}

/**
 * The rule judge (Uzbekistan YHQ): speed limit, red light, STOP, give way, pedestrian crossing, one-way, no stopping,
 * crashes. The decisions come from the tested prototype: STOP needs the speed below 1.5 m/s somewhere in the 40 m
 * before the line, speeding is judged after 1.5 s over limit + 10 km/h (cooldown 6 s), a pedestrian on the
 * crossing when the car reaches it is a violation.
 * It is pure: it reads the layout's rule definitions and a vehicle sample, and reports verdicts through the callback.
 */
export class RulesEngine {
  private st = new Map<string, DefState>();
  private speedOver = 0;
  private speedCool = 0;
  private zone: SpeedZone | null = null;
  private zoneSpeeding = false;
  private wrongT = 0;
  private wrongCool = 0;
  private stopT = 0;
  private noStopCool = 0;
  private offT = 0;
  private offCool = 0;
  private stoppedOnRed = new Set<string>();
  /** counters for the results screen */
  ok = 0;
  bad = 0;
  /** latest limit of the zone the car is in (km/h), Infinity if none */
  limit = Infinity;
  zoneName = "";
  zoneKind: SpeedZone["kind"] | null = null;

  constructor(
    private layout: Layout,
    private ctx: RuleContext,
    private out: (v: Verdict) => void,
    private cfg: RuleConfig = RULE_DEFAULTS,
    private onZone?: (z: SpeedZone | null, prev: SpeedZone | null) => void,
  ) {}

  reset(): void {
    this.st.clear();
    this.speedOver = this.speedCool = this.wrongT = this.wrongCool = this.stopT = this.noStopCool = this.offT = this.offCool = 0;
    this.zone = null;
    this.zoneSpeeding = false;
    this.stoppedOnRed.clear();
    this.ok = this.bad = 0;
    this.limit = Infinity;
  }

  /** Report an externally detected event (crash, pedestrian hit). */
  report(kind: VerdictKind, text: string): Verdict {
    const v = verdict(kind, text, this.cfg);
    this.emit(v);
    return v;
  }

  private emit(v: Verdict): void {
    if (v.ok) this.ok++;
    else this.bad++;
    this.out(v);
  }

  private state(id: string): DefState {
    let s = this.st.get(id);
    if (!s) {
      s = { prev: null, minV: 99, judged: false, stopped: false, moved: false };
      this.st.set(id, s);
    }
    return s;
  }

  update(dt: number, v: VehicleSample): void {
    const cfg = this.cfg;
    const kmh = v.speed * 3.6;

    // ---- speed zone
    const zone = zoneAt(this.layout, v.x, v.z);
    if (zone !== this.zone) {
      const prev = this.zone;
      if (prev && prev.kind === "shahar" && !this.zoneSpeeding) this.emit(verdict("cityOk", `${prev.name}dan qoidaga rioya qilib o‘tdingiz`, cfg));
      this.zone = zone;
      this.zoneSpeeding = false;
      this.speedOver = 0;
      this.limit = zone && zone.kind !== "maydon" ? zone.limit : Infinity;
      this.zoneName = zone?.name ?? "";
      this.zoneKind = zone?.kind ?? null;
      this.onZone?.(zone, prev);
    }
    this.speedCool -= dt;
    if (zone && zone.kind !== "maydon" && kmh > zone.limit + cfg.speedTolerance) {
      this.speedOver += dt;
      if (this.speedOver > cfg.speedHoldSec && this.speedCool <= 0) {
        this.emit(verdict("speed", `Tezlik oshdi! Chegara ${zone.limit} km/soat`, cfg));
        this.speedCool = cfg.speedCooldownSec;
        this.speedOver = 0;
        this.zoneSpeeding = true;
      }
    } else this.speedOver = Math.max(0, this.speedOver - dt);

    // ---- stop lines: red light, STOP, give way, zebra
    for (const d of this.layout.rules) {
      const dx = v.x - d.x;
      const dz = v.z - d.z;
      const along = dx * d.dx + dz * d.dz;
      const st = this.state(d.id);
      const prev = st.prev;
      st.prev = along;
      if (along < -80 || along > 40) {
        st.judged = false;
        st.minV = 99;
        st.stopped = false;
        st.moved = false;
        continue;
      }
      const lat = Math.abs(-dx * d.dz + dz * d.dx);
      const inLane = lat < d.half + TOL && v.fx * d.dx + v.fz * d.dz > 0.5;
      if (!inLane) continue;
      if (along < 0 && along > -this.cfg.stopWindow) {
        if (v.speed > 3) st.moved = true;
        if (st.moved) st.minV = Math.min(st.minV, v.speed);
        if (d.type === "light" && v.speed < 0.6 && along > -16 && this.ctx.lightColor(d) === "red") st.stopped = true;
      }
      const crossed = prev !== null && prev < 0 && along >= 0;
      if (!crossed) continue;
      if (d.type === "light") {
        const c = this.ctx.lightColor(d);
        if (c === "red") this.emit(verdict("redLight", "Qizil chiroqda o‘tdingiz!", cfg));
        else if (c === "green" && st.stopped) this.emit(verdict("lightOk", "Svetoforga bo‘ysundingiz", cfg));
        st.stopped = false;
      } else if (d.type === "stop") {
        if (st.minV < cfg.stopSpeed) this.emit(verdict("stopOk", "STOP belgisida to‘xtadingiz", cfg));
        else this.emit(verdict("stop", "STOP belgisida to‘liq to‘xtash shart!", cfg));
        st.minV = 99;
      } else if (d.type === "giveWay") {
        if (this.ctx.crossTraffic(d.node, d.dx, d.dz)) {
          if (v.speed > cfg.giveWaySpeed) this.emit(verdict("giveWay", "Yo‘l bering belgisi: asosiy yo‘ldagilarga yo‘l bering!", cfg));
          else this.emit(verdict("giveWayOk", "Asosiy yo‘ldagilarga yo‘l berdingiz", cfg));
        }
      } else if (d.type === "zebra") {
        if (this.ctx.pedsOnRoad(d.zebra)) this.emit(verdict("pedestrian", "Piyodaga yo‘l bering!", cfg));
        else if (this.ctx.pedsActive(d.zebra)) this.emit(verdict("pedOk", "Piyodaga yo‘l berdingiz", cfg));
      }
    }

    // ---- one way (wrong way), no stopping, off road
    this.wrongCool -= dt;
    let wrong = false;
    for (const o of this.layout.oneWays) {
      if (inRect(o, v.x, v.z) && v.speed > 2 && v.fx * o.dx + v.fz * o.dz < -0.5) wrong = true;
    }
    this.wrongT = wrong ? this.wrongT + dt : 0;
    if (this.wrongT > 0.6 && this.wrongCool <= 0) {
      this.emit(verdict("wrongWay", "Bir tomonlama yo‘lda teskari yurdingiz!", cfg));
      this.wrongCool = 8;
    }
    this.noStopCool -= dt;
    let inNoStop = false;
    for (const n of this.layout.noStops) if (inRect(n, v.x, v.z) && v.speed < 0.5) inNoStop = true;
    this.stopT = inNoStop ? this.stopT + dt : 0;
    if (this.stopT > cfg.noStopSeconds && this.noStopCool <= 0) {
      this.emit(verdict("noStop", "To‘xtash taqiqlangan joyda to‘xtadingiz", cfg));
      this.noStopCool = 10;
    }
    this.offCool -= dt;
    const offNow = !v.onRoad && v.grounded && v.speed > 4 && !!zone && zone.kind !== "maydon";
    this.offT = offNow ? this.offT + dt : 0;
    if (this.offT > 2 && this.offCool <= 0) {
      this.emit(verdict("offRoad", "Yo‘lga qayting!", cfg));
      this.offCool = 5;
    }
  }
}

export interface ExamResult {
  passed: boolean;
  penalty: number;
  gross: string[];
  reasons: string[];
  lines: [string, string | number][];
}

/** Driving-school scoring: every violation costs penalty points; a gross violation or too many points fail the exam. */
export class ExamScorer {
  penalty = 0;
  readonly log: { kind: VerdictKind; penalty: number }[] = [];

  constructor(private cfg: RuleConfig = RULE_DEFAULTS) {}

  reset(): void {
    this.penalty = 0;
    this.log.length = 0;
  }

  add(v: Verdict): void {
    if (v.penalty <= 0) return;
    this.penalty += v.penalty;
    this.log.push({ kind: v.kind, penalty: v.penalty });
  }

  result(completed: boolean): ExamResult {
    const gross = [...new Set(this.log.filter((l) => this.cfg.examGross.includes(l.kind)).map((l) => l.kind as string))];
    const reasons: string[] = [];
    if (!completed) reasons.push("Marshrut tugallanmadi");
    if (gross.length) reasons.push("Qo‘pol xato: " + gross.map((g) => KIND_NAME[g] ?? g).join(", "));
    if (this.penalty > this.cfg.examLimit) reasons.push(`Jarima ball ${this.penalty} (ruxsat: ${this.cfg.examLimit})`);
    const passed = completed && gross.length === 0 && this.penalty <= this.cfg.examLimit;
    const lines: [string, string | number][] = [
      ["Natija", passed ? "O‘tdi" : "O‘tmadi"],
      ["Jarima ball", `${this.penalty} / ${this.cfg.examLimit}`],
      ["Xatolar", this.log.length],
    ];
    if (reasons.length) lines.push(["Sabab", reasons.join("; ")]);
    return { passed, penalty: this.penalty, gross, reasons, lines };
  }
}

export const KIND_NAME: Record<string, string> = {
  speed: "tezlikni oshirish",
  redLight: "qizil chiroqda o‘tish",
  stop: "STOP belgisini buzish",
  pedestrian: "piyodaga yo‘l bermaslik",
  pedHit: "piyodaga urilish",
  crash: "avariya",
  wrongWay: "teskari yurish",
  noStop: "to‘xtash taqiqlangan joyda to‘xtash",
  giveWay: "yo‘l bermaslik",
  offRoad: "yo‘ldan chiqish",
};
