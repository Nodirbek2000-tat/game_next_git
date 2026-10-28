// The wall director: one friendly wall at a time (~6.5 s), every child is judged separately when it arrives, then the next wall.
// No losing: a child who is not in the pose gets a soft bump and another chance with the next wall. Pure logic (no canvas, no
// audio): the game passes hooks for sound / stars. Allocation-free after construction.

import { HoldGate, POSE_IDS, poseById, poseMatches, type PoseDef, type PoseId, type PoseKid } from "./poses";

export const ROUND_CFG = {
  /** pause before the very first wall */
  lead: 0.8,
  /** the wall travels from far away to the children */
  approach: 5.2,
  /** poses count only from this share of the approach (so the pose of the previous wall does not count) */
  armFrac: 0.3,
  /** the wall flies through, results are celebrated */
  result: 1.5,
  /** pause between two walls */
  gap: 0.4,
  /** do not start a new wall with less than this left of the round */
  minLeft: 6,
  /** chimes this many seconds before the wall arrives */
  chimeAt: [3, 2, 1],
} as const;

export const SLOTS = 5;

export type Phase = "gap" | "approach" | "result";

export type RoundKid = PoseKid & { slot: number; active: boolean; present: boolean };

export interface RoundHooks {
  /** a new wall starts to come: show it, play the whoosh, say the prompt */
  spawn(pose: PoseDef, index: number, holes: number): void;
  /** n = 3, 2, 1: a chime of the countdown */
  chime(n: number): void;
  /** the wall arrived: this child passed (or got a soft bump) */
  judge(slot: number, passed: boolean): void;
  /** after all children were judged (`total` = children taking part) */
  result(passed: number, total: number, all: boolean): void;
}

/** small deterministic-friendly shuffle helpers */
export function parseSeq(s: string | null | undefined): PoseId[] {
  if (!s) return [];
  const out: PoseId[] = [];
  for (const part of s.split(",")) {
    const id = part.trim() as PoseId;
    if ((POSE_IDS as readonly string[]).includes(id)) out.push(id);
  }
  return out;
}

/** Order of the poses: the easiest first (hands up), then shuffled "bags" without an immediate repeat; or a fixed cycle (tests). */
export class Deck {
  private bag: PoseId[] = [];
  private n = 0;
  last: PoseId | "" = "";

  constructor(
    private rnd: () => number = Math.random,
    private fixed: readonly PoseId[] = [],
  ) {}

  next(): PoseId {
    let id: PoseId;
    if (this.fixed.length) id = this.fixed[this.n % this.fixed.length];
    else if (this.n === 0) id = "handsUp";
    else {
      if (this.bag.length === 0) {
        for (let i = 0; i < POSE_IDS.length; i++) this.bag.push(POSE_IDS[i]);
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rnd() * (i + 1));
          const t = this.bag[i];
          this.bag[i] = this.bag[j];
          this.bag[j] = t;
        }
        // never the same pose twice in a row
        if (this.bag[this.bag.length - 1] === this.last) {
          const t = this.bag[0];
          this.bag[0] = this.bag[this.bag.length - 1];
          this.bag[this.bag.length - 1] = t;
        }
      }
      id = this.bag.pop() as PoseId;
    }
    this.n++;
    this.last = id;
    return id;
  }
}

export class Round {
  phase: Phase = "gap";
  /** seconds since the phase started */
  t = 0;
  /** 0-based number of the current wall, -1 before the first */
  index = -1;
  pose: PoseDef = poseById("handsUp");
  /** number of holes drawn in the wall (1..3) */
  holes = 1;
  /** per slot: 0 not judged, 1 passed, 2 bumped (valid in the result phase) */
  readonly results = new Uint8Array(SLOTS);
  readonly gates: HoldGate[] = Array.from({ length: SLOTS }, () => new HoldGate());
  /** how many countdown chimes were played for the current wall (0..3) */
  lit = 0;
  passed = 0;
  participants = 0;
  allPassed = false;
  /** totals over the whole round */
  passTotal = 0;
  bumpTotal = 0;
  allCount = 0;
  private begun = false;

  constructor(
    private deck: Deck,
    private hooks: RoundHooks,
    private cfg: typeof ROUND_CFG = ROUND_CFG,
  ) {}

  /** the round started */
  begin(): void {
    this.begun = true;
    this.phase = "gap";
    this.t = 0;
    this.index = -1;
  }

  /** 0..1 progress of the approach (1 while the wall is arriving / flying through) */
  get progress(): number {
    if (this.phase === "approach") return Math.min(1, this.t / this.cfg.approach);
    return this.phase === "result" ? 1 : 0;
  }

  private spawn(kids: readonly RoundKid[]): void {
    this.index++;
    this.pose = poseById(this.deck.next());
    this.phase = "approach";
    this.t = 0;
    this.lit = 0;
    let n = 0;
    for (let i = 0; i < SLOTS; i++) {
      this.results[i] = 0;
      this.gates[i].reset();
      if (kids[i].active) n++;
    }
    this.holes = Math.max(1, Math.min(3, n));
    this.hooks.spawn(this.pose, this.index, this.holes);
  }

  private judge(kids: readonly RoundKid[]): void {
    let part = 0;
    let pass = 0;
    for (let i = 0; i < SLOTS; i++) {
      this.results[i] = 0;
      const k = kids[i];
      if (!k.active) continue;
      const ok = this.gates[i].ok;
      if (!k.present && !ok) continue; // not in the picture any more: nobody is judged for that
      part++;
      if (ok) {
        pass++;
        this.results[i] = 1;
      } else {
        this.results[i] = 2;
      }
      this.hooks.judge(i, ok);
    }
    this.participants = part;
    this.passed = pass;
    this.allPassed = part >= 2 && pass === part;
    this.passTotal += pass;
    this.bumpTotal += part - pass;
    if (this.allPassed) this.allCount++;
    this.phase = "result";
    this.t = 0;
    this.hooks.result(pass, part, this.allPassed);
  }

  /** Call every frame while playing. Returns "finish" when the round should end (no time for another wall). */
  update(dt: number, kids: readonly RoundKid[], timeLeft: number): "finish" | undefined {
    if (!this.begun) return undefined;
    const c = this.cfg;
    this.t += dt;
    if (this.phase === "gap") {
      if (this.t >= (this.index < 0 ? c.lead : c.gap)) {
        if (this.index >= 0 && timeLeft < c.minLeft) return "finish";
        this.spawn(kids);
      }
    } else if (this.phase === "approach") {
      const p = this.t / c.approach;
      if (p >= c.armFrac) {
        for (let i = 0; i < SLOTS; i++) {
          const k = kids[i];
          const g = this.gates[i];
          if (!k.active) g.reset();
          else g.step(poseMatches(this.pose.id, k), k.present, dt);
        }
      }
      while (this.lit < c.chimeAt.length && this.t >= c.approach - c.chimeAt[this.lit]) {
        this.lit++;
        this.hooks.chime(c.chimeAt[this.lit - 1]);
      }
      if (this.t >= c.approach) this.judge(kids);
    } else if (this.t >= c.result) {
      this.phase = "gap";
      this.t = 0;
    }
    return undefined;
  }
}
