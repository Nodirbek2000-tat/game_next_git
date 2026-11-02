// Round flow, health, stamina, score and the partner's plan of Boks. Pure: no three.js, no engine; everything that is random
// goes through the injected `rng`, so the tests can replay a fight. Units: seconds, shoulder widths (pad positions).

import { type AttackKind, type Defense, type Side, damageFor } from "./combat";
import {
  ENEMY_PUNCH_COST,
  ENEMY_REGEN,
  IMPACT_AFTER_STRIKE,
  INTRO_SEC,
  KO_SEC,
  PLAYER_HP,
  PUNCH_COST,
  RECOVER_SEC,
  REST_SEC,
  ROUNDS,
  ROUND_SEC,
  ROUND_SPECS,
  STAMINA_MAX,
  STAMINA_REGEN,
  STRIKE_SEC,
  TIRED_AT,
  type RoundSpec,
} from "./config";

export type Phase = "intro" | "round" | "ko" | "rest" | "over";
export type Outcome = "" | "points" | "win" | "lost";

export interface Pad {
  /** slots 0-1 are left-hand (red) pads, 2-3 right-hand (blue) pads */
  id: number;
  active: boolean;
  side: Side;
  /** where the player's hand has to go, relative to the shoulders' centre, shoulder widths (x right, y down) */
  rx: number;
  ry: number;
  age: number;
  life: number;
}

export interface Attack {
  active: boolean;
  kind: AttackKind;
  /** the side of the screen the glove comes from */
  from: -1 | 1;
  t: number;
  windup: number;
  impactAt: number;
  total: number;
  resolved: boolean;
  result: Defense | null;
  second: boolean;
}

export interface FightStats {
  hits: number;
  /** recognised punches that landed on nothing */
  whiffs: number;
  /** punches with the wrong hand */
  wrong: number;
  /** pads that ran out */
  missed: number;
  dodges: number;
  blocks: number;
  taken: number;
  thrown: number;
  maxKmh: number;
  maxCombo: number;
  kos: number;
  roundsDone: number;
}

export interface FightHooks {
  /** what the player's body did at the moment of an impact */
  judge(a: Attack): Defense;
  bell?(kind: "start" | "end" | "ko"): void;
  phase?(p: Phase, round: number): void;
  padSpawn?(pad: Pad): void;
  padExpire?(pad: Pad): void;
  attackStart?(a: Attack): void;
  impact?(a: Attack, def: Defense, dmg: number, pts: number): void;
  knockdown?(who: "enemy" | "player"): void;
  over?(outcome: Outcome): void;
}

export interface FightOpts {
  rounds?: number;
  roundSec?: number;
  restSec?: number;
  kids?: boolean;
  rng?: () => number;
}

export interface HitResult {
  pts: number;
  dmg: number;
  ko: boolean;
}

const newAttack = (): Attack => ({ active: false, kind: "straight", from: 1, t: 0, windup: 0.7, impactAt: 0.8, total: 1.3, resolved: false, result: null, second: false });

const SIDE_PAD: Record<Side, [number, number]> = { L: [0, 1], R: [2, 3] };

export class Fight {
  readonly rounds: number;
  readonly roundSec: number;
  readonly restSec: number;
  readonly kids: boolean;
  private rng: () => number;
  private hooks: FightHooks;

  phase: Phase = "intro";
  phaseT = 0;
  round = 1;
  roundT = 0;
  outcome: Outcome = "";

  hp = PLAYER_HP;
  stamina = STAMINA_MAX;
  enemyHp = 100;
  enemyStamina = 100;
  score = 0;
  combo = 0;

  readonly pads: Pad[] = [0, 1, 2, 3].map((id) => ({ id, active: false, side: id < 2 ? "L" : "R", rx: 0, ry: 0, age: 0, life: 1 }));
  readonly attack: Attack = newAttack();
  readonly stats: FightStats = { hits: 0, whiffs: 0, wrong: 0, missed: 0, dodges: 0, blocks: 0, taken: 0, thrown: 0, maxKmh: 0, maxCombo: 0, kos: 0, roundsDone: 0 };

  private mode: "pads" | "closing" | "attack" = "pads";
  private modeT = 0;
  private padT = 0;
  private chain: Side | null = null;
  private second = false;
  private secondT = 0;
  private lastPad: Record<Side, [number, number]> = { L: [-1, 0], R: [1, 0] };

  constructor(opts: FightOpts, hooks: FightHooks) {
    this.rounds = opts.rounds ?? ROUNDS;
    this.roundSec = opts.roundSec ?? ROUND_SEC;
    this.restSec = opts.restSec ?? REST_SEC;
    this.kids = !!opts.kids;
    this.rng = opts.rng ?? Math.random;
    this.hooks = hooks;
  }

  get spec(): RoundSpec {
    return ROUND_SPECS[Math.min(ROUND_SPECS.length - 1, this.round - 1)];
  }

  get roundLeft(): number {
    return Math.max(0, this.roundSec - this.roundT);
  }

  get tired(): boolean {
    return this.stamina < STAMINA_MAX * TIRED_AT;
  }

  get accuracy(): number {
    const s = this.stats;
    const n = s.hits + s.missed + s.whiffs + s.wrong;
    return n ? s.hits / n : 0;
  }

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  start(): void {
    this.phase = "intro";
    this.phaseT = 0;
    this.hooks.phase?.("intro", this.round);
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    this.hooks.phase?.(p, this.round);
  }

  private startRound(): void {
    this.roundT = 0;
    this.enemyHp = 100;
    this.enemyStamina = 100;
    this.combo = 0;
    this.mode = "pads";
    this.modeT = this.kids ? Infinity : this.rand(this.spec.attackGap[0], this.spec.attackGap[1]) * 0.7 + 1.5;
    this.padT = 0.5;
    this.chain = null;
    this.second = false;
    this.setPhase("round");
    this.hooks.bell?.("start");
  }

  private clearPads(): void {
    for (const p of this.pads) p.active = false;
    this.attack.active = false;
    this.second = false;
  }

  // ------------------------------------------------------------------------------------------------ the player's punches

  /** a punch was recognised (landed or not): it costs stamina */
  punchThrown(): void {
    this.stamina = Math.max(0, this.stamina - PUNCH_COST);
    this.stats.thrown++;
  }

  whiff(): void {
    this.stats.whiffs++;
  }

  wrongHand(): void {
    this.stats.wrong++;
  }

  /** punch `kmh` landed on pad `i` (the right hand) */
  padHit(i: number, kmh: number): HitResult {
    const p = this.pads[i];
    if (!p || !p.active || this.phase !== "round") return { pts: 0, dmg: 0, ko: false };
    p.active = false;
    const s = this.stats;
    s.hits++;
    // the record is the fastest punch that LANDED (a tracking glitch in the air cannot make it)
    if (kmh > s.maxKmh) s.maxKmh = kmh;
    this.combo++;
    if (this.combo > s.maxCombo) s.maxCombo = this.combo;
    const f = this.tired ? 0.6 : 1;
    const speedBonus = Math.max(0, Math.min(30, (kmh - 12) * 1.2));
    const comboBonus = Math.min(30, this.combo * 2.5);
    const pts = Math.round((65 + speedBonus + comboBonus) * f);
    this.score += pts;
    const dmg = (3.2 + Math.min(2, kmh / 20)) * f;
    this.enemyHp = Math.max(0, this.enemyHp - dmg);
    let ko = false;
    if (this.enemyHp <= 0) {
      ko = true;
      this.knockout();
    }
    return { pts, dmg, ko };
  }

  private knockout(): void {
    this.stats.kos++;
    this.stats.roundsDone++;
    this.score += 500 + Math.round(this.roundLeft * 6);
    this.clearPads();
    this.setPhase("ko");
    this.hooks.knockdown?.("enemy");
    this.hooks.bell?.("ko");
  }

  // ------------------------------------------------------------------------------------------------ time

  update(dt: number): void {
    // the player's stamina always comes back
    this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
    this.phaseT += dt;
    switch (this.phase) {
      case "intro":
        if (this.phaseT >= INTRO_SEC) this.startRound();
        break;
      case "round":
        this.updateRound(dt);
        break;
      case "ko":
        if (this.phaseT >= KO_SEC) this.afterRound();
        break;
      case "rest":
        if (this.phaseT >= this.restSec) {
          this.round++;
          this.startRound();
        }
        break;
      default:
        break;
    }
  }

  private afterRound(): void {
    this.score += Math.round(this.hp * 1.5);
    if (this.round >= this.rounds) {
      this.finishFight();
      return;
    }
    this.hp = Math.min(PLAYER_HP, this.hp + 30);
    this.stamina = STAMINA_MAX;
    this.setPhase("rest");
  }

  private finishFight(): void {
    this.outcome = this.stats.kos > 0 ? "win" : "points";
    this.setPhase("over");
    this.hooks.over?.(this.outcome);
  }

  private updateRound(dt: number): void {
    this.roundT += dt;
    this.enemyStamina = Math.min(100, this.enemyStamina + ENEMY_REGEN * dt);
    // pads
    for (const p of this.pads) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.stats.missed++;
        this.combo = 0;
        this.hooks.padExpire?.(p);
      }
    }
    // the plan: pads for a while, then the pads are cleared and the partner attacks
    if (this.mode === "pads") {
      this.modeT -= dt;
      this.padT -= dt;
      if (this.padT <= 0) this.spawnPad();
      if (this.modeT <= 0 && !this.kids && this.enemyStamina >= ENEMY_PUNCH_COST) this.mode = "closing";
    } else if (this.mode === "closing") {
      if (!this.padLive()) this.startAttack(false);
    } else this.updateAttack(dt);
    if (this.phase === "round" && this.roundT >= this.roundSec) {
      this.stats.roundsDone++;
      this.clearPads();
      this.hooks.bell?.("end");
      this.afterRound();
    }
  }

  private padLive(): boolean {
    for (let i = 0; i < this.pads.length; i++) if (this.pads[i].active) return true;
    return false;
  }

  private freeSlot(side: Side): number {
    const [a, b] = SIDE_PAD[side];
    // one live pad per side
    if (this.pads[a].active || this.pads[b].active) return -1;
    return a;
  }

  private spawnPad(): void {
    const spec = this.spec;
    let side: Side = this.chain ?? (this.rng() < 0.5 ? "L" : "R");
    this.chain = null;
    let slot = this.freeSlot(side);
    if (slot < 0) {
      side = side === "L" ? "R" : "L";
      slot = this.freeSlot(side);
    }
    if (slot < 0) {
      this.padT = 0.15;
      return;
    }
    const p = this.pads[slot];
    const sgn = side === "L" ? -1 : 1;
    let rx = 0;
    let ry = 0;
    for (let tries = 0; tries < 4; tries++) {
      // out to the side and a little forward: further from the guard than a hand resting at the chin (a real thrust, not a touch)
      rx = sgn * (1.45 + this.rng() * 0.4);
      ry = -1.0 + this.rng() * 1.4;
      const l = this.lastPad[side];
      if (Math.hypot(rx - l[0], ry - l[1]) >= 0.4) break;
    }
    this.lastPad[side] = [rx, ry];
    p.active = true;
    p.side = side;
    p.rx = rx;
    p.ry = ry;
    p.age = 0;
    p.life = spec.padLife + (this.kids ? 0.9 : 0);
    this.hooks.padSpawn?.(p);
    // the pace quickens during the round; a chance of the other hand following at once (jab - cross)
    const progress = Math.min(1, this.roundT / this.roundSec);
    const k = (1 - 0.2 * progress) * (this.kids ? 1.5 : 1);
    this.padT = this.rand(spec.padGap[0], spec.padGap[1]) * k;
    if (this.round >= 2 && !this.kids && this.rng() < 0.3 && this.freeSlot(side === "L" ? "R" : "L") >= 0) {
      this.chain = side === "L" ? "R" : "L";
      this.padT = 0.35;
    }
  }

  private startAttack(second: boolean): void {
    const spec = this.spec;
    const a = this.attack;
    a.active = true;
    a.second = second;
    a.kind = second ? "straight" : this.rng() < spec.hook ? "hook" : "straight";
    a.from = second ? ((a.from * -1) as -1 | 1) : this.rng() < 0.5 ? -1 : 1;
    a.t = 0;
    a.windup = spec.windup * (second ? 0.8 : 1);
    a.impactAt = a.windup + IMPACT_AFTER_STRIKE;
    a.total = a.windup + STRIKE_SEC + RECOVER_SEC;
    a.resolved = false;
    a.result = null;
    this.mode = "attack";
    if (!second) {
      this.enemyStamina = Math.max(0, this.enemyStamina - ENEMY_PUNCH_COST);
      this.second = this.rng() < spec.double;
      this.secondT = 0;
    } else this.second = false;
    this.hooks.attackStart?.(a);
  }

  private updateAttack(dt: number): void {
    const a = this.attack;
    a.t += dt;
    if (!a.resolved && a.t >= a.impactAt) {
      a.resolved = true;
      const def = this.hooks.judge(a);
      a.result = def;
      const base = this.spec.damage * (this.kids ? 0.5 : 1);
      const dmg = damageFor(def, base, a.kind === "hook");
      let pts = 0;
      if (def === "dodge") {
        this.stats.dodges++;
        pts = 120;
      } else if (def === "block") {
        this.stats.blocks++;
        pts = 50;
        this.hp = Math.max(0, this.hp - dmg);
      } else {
        this.stats.taken++;
        this.combo = 0;
        this.hp = Math.max(0, this.hp - dmg);
      }
      this.score += pts;
      this.hooks.impact?.(a, def, dmg, pts);
      if (this.hp <= 0) {
        a.active = false;
        this.clearPads();
        this.outcome = "lost";
        this.setPhase("over");
        this.hooks.knockdown?.("player");
        this.hooks.over?.("lost");
        return;
      }
    }
    if (a.resolved && this.second) {
      this.secondT += dt;
      if (this.secondT >= 0.25) {
        this.startAttack(true);
        return;
      }
    }
    if (a.t >= a.total) {
      a.active = false;
      this.mode = "pads";
      const gap = this.spec.attackGap;
      this.modeT = this.rand(gap[0], gap[1]);
      this.padT = 0.5;
    }
  }
}
