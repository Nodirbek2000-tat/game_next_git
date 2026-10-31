// The challenge director: one animal at a time (~8 s), every child is judged separately, a short celebration, next animal.
// No losing: a child who does not manage it simply gets no star for this animal. Pure logic (no canvas, no audio): the game
// passes hooks for sound / stars. Allocation-free after construction.

import type { KidSlot } from "../bogcha/common";
import { animalById, ANIMALS, type AnimalDef } from "./animals";
import { KidProgress, softHands, type SoftHands } from "./moves";
import type { Deck } from "./sequence";

export const ROUND_CFG = {
  /** length of one challenge in seconds (the animal calls its name and sounds first, so one second more than before) */
  act: 9,
  /** the prompt is spoken this long after the animal appeared (its own sound goes first); `hooks.promptAt` may delay it */
  voiceAt: 0.9,
  /** moves count from here (so the previous animal's pose does not count for the new one) */
  armAt: 0.8,
  /** when every child who is in the picture is done, the challenge ends after this pause */
  allDoneHold: 1,
  /** celebration between two challenges */
  praise: 1.4,
  /** do not start a new challenge with less than this left of the round */
  minLeft: 6,
} as const;

export type Phase = "act" | "praise";

/** `pts` / `scale` are optional: with them far children (poorly seen wrists) can still raise their hands */
export type KidLike = Pick<KidSlot, "slot" | "active" | "present" | "signals"> & Partial<Pick<KidSlot, "pts" | "scale">>;

export interface RoundHooks {
  /** a new animal appeared: show it, call its name, play its sound */
  start(a: AnimalDef, index: number): void;
  /** time to say the prompt */
  prompt(a: AnimalDef): void;
  /** optional: seconds after the animal appeared at which the prompt is due (default `ROUND_CFG.voiceAt`) */
  promptAt?(a: AnimalDef): number;
  /** a child did it: give the star. `first` = the first child of this challenge */
  done(kid: KidLike, a: AnimalDef, first: boolean): void;
  /** the challenge is over (`any`: at least one child did it) */
  end(a: AnimalDef, any: boolean): void;
}

const NOKIDS = 5;

export class Round {
  phase: Phase = "praise";
  /** seconds since the phase started */
  t = 0;
  animal: AnimalDef = ANIMALS[0];
  /** 0-based number of the current challenge, -1 before begin() */
  index = -1;
  /** children who completed the current challenge */
  doneCount = 0;
  readonly progress: KidProgress[] = Array.from({ length: NOKIDS }, () => new KidProgress());
  private prompted = false;
  private allDoneT = 0;
  private readonly soft: SoftHands = { L: false, R: false };

  constructor(
    private deck: Deck,
    private hooks: RoundHooks,
    private cfg: typeof ROUND_CFG = ROUND_CFG,
  ) {}

  /** Start the first challenge (the round started). */
  begin(): void {
    this.index = -1;
    this.nextChallenge();
  }

  private nextChallenge(): void {
    this.index++;
    this.animal = animalById(this.deck.next()) ?? ANIMALS[0];
    this.phase = "act";
    this.t = 0;
    this.doneCount = 0;
    this.prompted = false;
    this.allDoneT = 0;
    for (const p of this.progress) p.reset();
    this.hooks.start(this.animal, this.index);
  }

  private endAct(): void {
    this.phase = "praise";
    this.t = 0;
    this.hooks.end(this.animal, this.doneCount > 0);
  }

  /** Returns "finish" when the round should end (not enough time left for another animal). */
  update(dt: number, kids: readonly KidLike[], timeLeft: number): "finish" | undefined {
    const c = this.cfg;
    this.t += dt;
    if (this.phase === "praise") {
      if (this.t >= c.praise) {
        if (timeLeft < c.minLeft) return "finish";
        this.nextChallenge();
      }
      return undefined;
    }
    if (!this.prompted && this.t >= (this.hooks.promptAt?.(this.animal) ?? c.voiceAt)) {
      this.prompted = true;
      this.hooks.prompt(this.animal);
    }
    let present = 0;
    let done = 0;
    const move = this.animal.move;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k.active || !k.present) continue;
      present++;
      const p = this.progress[k.slot];
      if (p.done) {
        done++;
        continue;
      }
      const soft = k.pts && k.scale !== undefined && move === "handsUp" ? softHands(k.pts, k.scale, this.soft) : undefined;
      if (this.t >= c.armAt && p.step(move, k.signals, dt, soft)) {
        done++;
        this.doneCount++;
        this.hooks.done(k, this.animal, this.doneCount === 1);
      }
    }
    if (present > 0 && done === present) this.allDoneT += dt;
    else this.allDoneT = 0;
    if (this.allDoneT >= c.allDoneHold || this.t >= c.act) this.endAct();
    return undefined;
  }
}
