// Fitnes: one workout = a list of steps (exercise + reps / seconds) with a short intro before each and a rest between them.
// Pure logic: the game feeds the analyser's readings and dt, draws what this says. No engine imports.

import { EXERCISES, kcal, SEC_PER_REP, type Exercise } from "@/lib/fitness/exercises";
import type { PlanStep } from "@/lib/fitness/plan";
import { makeAnalyser, type Analyser, type Reading } from "./form";

export type Phase = "intro" | "work" | "rest" | "done";

/** seconds of the "next: ..." card before every exercise */
export const INTRO_SEC = 4;

export interface StepResult {
  ex: Exercise;
  amount: number;
  reps: number;
  held: number;
  sec: number;
  kcal: number;
  /** the target was reached (not just the time cap) */
  done: boolean;
}

export class Session {
  phase: Phase = "intro";
  index = 0;
  /** seconds left in the intro / rest, or in the time cap of the work phase */
  left = INTRO_SEC;
  kcal = 0;
  reps = 0;
  workSec = 0;
  readonly results: StepResult[] = [];
  analyser: Analyser;
  /** the last reading of the current exercise */
  reading: Reading = { good: true, cue: null, rep: false };
  /** seconds the form was right during the work phases (for "aniqlik") */
  private goodSec = 0;
  private presentSec = 0;
  private stepSec = 0;
  private stepKcal = 0;

  constructor(
    readonly steps: readonly PlanStep[],
    readonly rest: number,
    readonly weightKg: number,
  ) {
    if (!steps.length) throw new Error("empty workout");
    this.analyser = makeAnalyser(steps[0].ex);
  }

  get step(): PlanStep {
    return this.steps[Math.min(this.index, this.steps.length - 1)];
  }
  get ex(): Exercise {
    return EXERCISES[this.step.ex];
  }
  get next(): PlanStep | null {
    return this.steps[this.index + 1] ?? null;
  }
  /** reps done / seconds held in the current step */
  get progress(): number {
    return this.ex.kind === "hold" ? this.analyser.held : this.analyser.reps;
  }
  /** 0..1 of the whole workout */
  get overall(): number {
    const cur = this.phase === "work" ? Math.min(1, this.progress / this.step.amount) : this.phase === "rest" ? 1 : 0;
    return Math.min(1, (this.index + cur) / this.steps.length);
  }
  /** share of the exercise time the form was right, 0..1 */
  get accuracy(): number {
    return this.presentSec > 0 ? this.goodSec / this.presentSec : 0;
  }

  /** the time cap of a step: generous, so a slow person still finishes, but a stuck one goes on */
  private cap(): number {
    const s = this.step;
    return this.ex.kind === "hold" ? s.amount * 2.5 + 15 : Math.max(45, s.amount * SEC_PER_REP[s.ex] * 3);
  }

  /** advance; `lm` = null when nobody is seen. Returns true on the frame a rep / the target is reached. */
  update(dt: number, lm: Parameters<Analyser["update"]>[0] | null, scale: number, stageH: number): boolean {
    if (this.phase === "done") return false;
    this.left -= dt;
    if (this.phase === "intro") {
      if (this.left <= 0) {
        this.phase = "work";
        this.left = this.cap();
        this.stepSec = 0;
        this.stepKcal = 0;
      }
      return false;
    }
    if (this.phase === "rest") {
      if (this.left <= 0) this.begin(this.index + 1);
      return false;
    }
    // work
    let hit = false;
    if (lm) {
      const beforeHeld = this.analyser.held;
      this.reading = this.analyser.update(lm, scale, stageH, dt);
      this.presentSec += dt;
      if (this.reading.good) this.goodSec += dt;
      if (this.reading.rep) {
        this.reps++;
        hit = true;
      }
      // calories: the exercise time; a hold counts only while it is held
      const active = this.ex.kind === "hold" ? this.analyser.held - beforeHeld : dt;
      const k = kcal(this.ex.met, this.weightKg, active);
      this.kcal += k;
      this.stepKcal += k;
      this.workSec += active;
      this.stepSec += active;
    } else this.reading = { good: false, cue: "Kamera oldiga turing", rep: false };
    const reached = this.progress >= this.step.amount;
    if (reached || this.left <= 0) this.endStep(reached);
    return hit || reached;
  }

  /** skip the rest / intro (keyboard) */
  skip(): void {
    if (this.phase === "intro") this.left = 0;
    else if (this.phase === "rest") this.left = 0;
  }

  private endStep(done: boolean): void {
    this.results.push({ ex: this.ex, amount: this.step.amount, reps: this.analyser.reps, held: this.analyser.held, sec: this.stepSec, kcal: this.stepKcal, done });
    if (this.index >= this.steps.length - 1) {
      this.phase = "done";
      this.left = 0;
      return;
    }
    this.phase = "rest";
    this.left = this.rest;
  }

  private begin(i: number): void {
    this.index = i;
    this.analyser = makeAnalyser(this.step.ex);
    this.reading = { good: true, cue: null, rep: false };
    this.phase = "intro";
    this.left = INTRO_SEC;
  }

  /** every step reached its target */
  get allDone(): boolean {
    return this.results.length === this.steps.length && this.results.every((r) => r.done);
  }
}
