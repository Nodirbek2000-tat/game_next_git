// "Qotib qol!" (musical statues) — the pure rules: the dance / freeze / result phase machine and the tolerant stillness
// scoring. No canvas, no audio, no allocation per frame (typed arrays + bit masks), so it is easy to test with noisy data.
//
// A round is a loop:  dance (music, 4-9 s)  ->  freeze (music stopped, ~2 s of stillness = a star)  ->  result (friendly
// feedback, nobody is punished)  ->  dance ... The kit's round timer ends the whole thing.

export const SLOTS = 5;

export type Phase = "dance" | "freeze" | "result";

export interface FreezeCfg {
  /** random length of one dance (music) part, seconds */
  danceMin: number;
  danceMax: number;
  /** the first dance is never shorter than this (the children are still looking for the camera) */
  firstDanceMin: number;
  /** the freeze part lasts at most this long */
  freezeSec: number;
  /** seconds of calm needed for a star */
  holdSec: number;
  /** after all present children froze, wait this long (celebration) and end the freeze early */
  celebrateSec: number;
  /** length of the "result" part (stars shown, wobble for the ones who still moved) */
  resultSec: number;
  /** a freeze only starts when at least this much of the round is left (so it never gets cut off) */
  minLeftForFreeze: number;
  /** energy (kit signal, 0 frozen / ~1 walking / 3+ dancing) below which a child counts as calm; hysteresis: enter / exit */
  calmEnter: number;
  calmExit: number;
  /** while moving, the collected calm time shrinks this many times faster than it grows (a noise spike does not wipe it) */
  decay: number;
  /** dance reward: energy above `danceBase` (max `danceCap`) fills a meter; a full meter = one star */
  danceBase: number;
  danceCap: number;
  danceNeed: number;
}

export const DEFAULT_CFG: FreezeCfg = {
  danceMin: 4,
  danceMax: 9,
  firstDanceMin: 5,
  freezeSec: 5.5,
  holdSec: 2,
  celebrateSec: 1,
  resultSec: 2.4,
  minLeftForFreeze: 7.5,
  // generous for small children and a noisy skeleton (the kit's own `still` flag is < 0.3 / > 0.6)
  calmEnter: 0.55,
  calmExit: 0.95,
  decay: 1.2,
  danceBase: 0.5,
  danceCap: 1.5,
  danceNeed: 6,
};

/**
 * The tolerant "did the child stay still long enough" gate of ONE child.
 *  - hysteresis on the movement energy (enter < calmEnter, leave only above calmExit)
 *  - calm time is collected; moving does not reset it, it only drains it (decay x faster than it grows)
 *  - a child who is not seen keeps what it has (no gain, no loss) and can not win while away
 */
export class StillGate {
  hold = 0;
  calm = false;
  done = false;

  constructor(private cfg: FreezeCfg) {}

  reset(): void {
    this.hold = 0;
    this.calm = false;
    this.done = false;
  }

  /** 0..1 */
  get progress(): number {
    return this.done ? 1 : Math.min(1, this.hold / this.cfg.holdSec);
  }

  /** @returns true exactly once: the moment the child earns the star */
  step(energy: number, present: boolean, dt: number): boolean {
    if (this.done || !present) return false;
    this.calm = energy < (this.calm ? this.cfg.calmExit : this.cfg.calmEnter);
    if (this.calm) this.hold += dt;
    else this.hold = Math.max(0, this.hold - dt * this.cfg.decay);
    if (this.hold >= this.cfg.holdSec) {
      this.done = true;
      return true;
    }
    return false;
  }
}

/** The dance reward of ONE child: lively movement fills a meter, a full meter is a star. */
export class DanceMeter {
  fill = 0;

  constructor(private cfg: FreezeCfg) {}

  reset(): void {
    this.fill = 0;
  }

  step(energy: number, dt: number): boolean {
    const c = this.cfg;
    this.fill += Math.min(c.danceCap, Math.max(0, energy - c.danceBase)) * dt;
    if (this.fill >= c.danceNeed) {
      this.fill -= c.danceNeed;
      return true;
    }
    return false;
  }

  get progress(): number {
    return Math.min(1, this.fill / this.cfg.danceNeed);
  }
}

const bit = (i: number): number => 1 << i;
export const hasBit = (mask: number, i: number): boolean => (mask & bit(i)) !== 0;

/** Events of the last `update`; cleared at the start of every update. Masks have one bit per kid slot. */
export interface RoundEvents {
  /** a freeze began this frame */
  froze: boolean;
  /** the result part began this frame */
  thawed: boolean;
  /** a new dance began this frame (the music should play) */
  danced: boolean;
  /** children who earned a freeze star this frame */
  starMask: number;
  /** children who earned a dance star this frame */
  danceMask: number;
}

export class FreezeRound {
  phase: Phase = "dance";
  /** seconds in the current phase */
  t = 0;
  /** finished freezes so far */
  cycle = 0;
  danceLen: number;
  readonly gates: StillGate[];
  readonly meters: DanceMeter[];
  readonly ev: RoundEvents = { froze: false, thawed: false, danced: false, starMask: 0, danceMask: 0 };
  /** children who got the freeze star in the current / last freeze */
  doneMask = 0;
  /** at the end of a freeze: children who were present but still moving (they get the friendly wobble) */
  triedMask = 0;
  /** `t` of the freeze at which each child earned the star (for animations) */
  readonly doneAt = new Float32Array(SLOTS);
  private allDoneAt = -1;

  constructor(
    readonly cfg: FreezeCfg = DEFAULT_CFG,
    private rng: () => number = Math.random,
  ) {
    this.gates = Array.from({ length: SLOTS }, () => new StillGate(cfg));
    this.meters = Array.from({ length: SLOTS }, () => new DanceMeter(cfg));
    this.danceLen = Math.max(cfg.firstDanceMin, this.pickDance());
  }

  private pickDance(): number {
    const c = this.cfg;
    return c.danceMin + this.rng() * (c.danceMax - c.danceMin);
  }

  /**
   * @param dt seconds
   * @param timeLeft seconds of the round that are left
   * @param present 1 = the child in this slot is in the picture
   * @param energy the kit's `signals.energy` of each slot
   */
  update(dt: number, timeLeft: number, present: ArrayLike<number | boolean>, energy: ArrayLike<number>): void {
    const ev = this.ev;
    ev.froze = ev.thawed = ev.danced = false;
    ev.starMask = ev.danceMask = 0;
    this.t += dt;
    const c = this.cfg;
    if (this.phase === "dance") {
      for (let i = 0; i < SLOTS; i++) if (present[i] && this.meters[i].step(energy[i], dt)) ev.danceMask |= bit(i);
      if (this.t >= this.danceLen) {
        if (timeLeft >= c.minLeftForFreeze) this.startFreeze();
        else this.danceLen += 2; // too little time left for a whole freeze: just keep dancing
      }
    } else if (this.phase === "freeze") {
      let pres = 0;
      let done = 0;
      for (let i = 0; i < SLOTS; i++) {
        if (!present[i]) continue;
        pres++;
        if (this.gates[i].step(energy[i], true, dt)) {
          ev.starMask |= bit(i);
          this.doneMask |= bit(i);
          this.doneAt[i] = this.t;
        }
        if (this.gates[i].done) done++;
      }
      if (pres > 0 && done === pres) {
        if (this.allDoneAt < 0) this.allDoneAt = this.t;
      } else this.allDoneAt = -1;
      if (this.t >= c.freezeSec || (this.allDoneAt >= 0 && this.t - this.allDoneAt >= c.celebrateSec)) {
        this.triedMask = 0;
        for (let i = 0; i < SLOTS; i++) if (present[i] && !this.gates[i].done) this.triedMask |= bit(i);
        this.phase = "result";
        this.t = 0;
        this.cycle++;
        ev.thawed = true;
      }
    } else if (this.t >= c.resultSec) {
      this.phase = "dance";
      this.t = 0;
      this.danceLen = this.pickDance();
      this.doneMask = 0;
      this.triedMask = 0;
      for (let i = 0; i < SLOTS; i++) this.meters[i].reset();
      ev.danced = true;
    }
  }

  private startFreeze(): void {
    this.phase = "freeze";
    this.t = 0;
    this.allDoneAt = -1;
    this.doneMask = 0;
    this.triedMask = 0;
    for (let i = 0; i < SLOTS; i++) {
      this.gates[i].reset();
      this.doneAt[i] = 0;
    }
    this.ev.froze = true;
  }
}

/** Songs of the round, in order: music + tempo variety. */
export const PLAYLIST: readonly { song: "march" | "bouncy" | "calm"; tempo: number }[] = [
  { song: "march", tempo: 1 },
  { song: "bouncy", tempo: 1 },
  { song: "calm", tempo: 1.3 },
  { song: "march", tempo: 1.2 },
  { song: "bouncy", tempo: 1.15 },
  { song: "march", tempo: 1.08 },
  { song: "bouncy", tempo: 1.25 },
];
