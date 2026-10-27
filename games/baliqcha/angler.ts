// One child's fishing line as a tiny state machine (pure logic, no browser APIs, no allocation after construction).
//
//   idle  --(hand up, then down / "baliq" shout)-->  fly  -->  wait  -->  bite  --(hand up / "tort" shout)-->  reel  -->  idle
//
// Kindergarten rules: nothing can go wrong. The bite always comes within a few seconds, a fish never gets away, and a child
// who cannot do the gesture is helped by the game (the line casts / pulls itself after a while).

export const ST = { idle: 0, fly: 1, wait: 2, bite: 3, reel: 4 } as const;
export type AnglerState = (typeof ST)[keyof typeof ST];

/** bit flags returned by `Angler.update` (what happened during this update) */
export const EV = { cast: 1, land: 2, bite: 4, pull: 8, catch: 16, assist: 32 } as const;

export const TUNE = {
  /** hand height above the shoulder line, in shoulder widths: "hand is up" / "hand is down again" */
  upOn: 0.55,
  upOff: 0.2,
  /** the cast fires when the hand came down this far from its highest point */
  dropFromPeak: 0.6,
  /** ... or fell this fast (shoulder widths / s) after having been up */
  dropRate: 2.8,
  /** the hand must stay up this long (s) to pull (a flicker is not a pull) */
  pullHold: 0.08,
  /** the bite is shown for at least this long before a hand can pull it (s) */
  biteShow: 0.25,
  flyTime: 0.5,
  /** the fish bites this long after the float landed (s) — kids cannot wait */
  biteMin: 1.2,
  biteMax: 2.6,
  reelTime: 0.9,
  /** after a catch the line rests this long (s): the "Ura!" moment */
  cool: 0.9,
  /** help: the line casts itself after this long idle (s) / the fish pulls itself after this long biting (s) */
  assistIdle: 9,
  assistBite: 7,
} as const;

export interface AnglerInput {
  /** the child is seen right now (gestures are ignored while not) */
  present: boolean;
  /** height of the best hand above the shoulder line in shoulder widths (negative = below); see `handHeight` */
  up: number;
  /** a voice command asks to cast / to pull (one frame) */
  voiceCast: boolean;
  voicePull: boolean;
}

export class Angler {
  state: AnglerState = ST.idle;
  /** seconds in the current state */
  t = 0;
  /** seconds from landing to the bite (set when the float lands) */
  biteIn = 0;
  /** rest after a catch */
  cool = 0;
  /** seconds idle (drives the help and the hint) */
  idleT = 0;
  /** the hand has been up (waiting for it to come down) */
  armed = false;
  peak = 0;
  prevU = -1;
  upHold = 0;
  /** flags of the last update */
  ev = 0;
  /** the last cast / pull was done by the game, not by the child */
  assisted = false;

  constructor(private rand: () => number = Math.random) {}

  reset(): void {
    this.state = ST.idle;
    this.t = this.biteIn = this.cool = this.idleT = 0;
    this.armed = false;
    this.peak = 0;
    this.prevU = -1;
    this.upHold = 0;
    this.ev = 0;
    this.assisted = false;
  }

  update(dt: number, inp: AnglerInput): number {
    let ev = 0;
    const u = inp.present ? inp.up : -1;
    const rate = dt > 0 && inp.present ? (u - this.prevU) / dt : 0;
    if (inp.present) this.prevU = u;
    this.t += dt;
    switch (this.state) {
      case ST.idle: {
        this.idleT += dt;
        let go = false;
        if (this.cool > 0) {
          this.cool -= dt;
          this.armed = false;
          this.peak = 0;
        } else {
          if (inp.present && u > TUNE.upOn) {
            this.armed = true;
            if (u > this.peak) this.peak = u;
          }
          if (this.armed && inp.present && (u < TUNE.upOff || u < this.peak - TUNE.dropFromPeak || (rate < -TUNE.dropRate && u < this.peak - 0.3))) go = true;
          if (inp.voiceCast) go = true;
          if (this.idleT > TUNE.assistIdle) {
            go = true;
            this.assisted = true;
            ev |= EV.assist;
          }
        }
        if (go) {
          if (!(ev & EV.assist)) this.assisted = false;
          this.state = ST.fly;
          this.t = 0;
          this.armed = false;
          this.peak = 0;
          this.idleT = 0;
          ev |= EV.cast;
        }
        break;
      }
      case ST.fly:
        if (this.t >= TUNE.flyTime) {
          this.state = ST.wait;
          this.t = 0;
          this.biteIn = TUNE.biteMin + this.rand() * (TUNE.biteMax - TUNE.biteMin);
          ev |= EV.land;
        }
        break;
      case ST.wait:
        if (this.t >= this.biteIn) {
          this.state = ST.bite;
          this.t = 0;
          this.upHold = 0;
          ev |= EV.bite;
        }
        break;
      case ST.bite: {
        let pull = inp.voicePull;
        if (inp.present && u > TUNE.upOn && this.t >= TUNE.biteShow) {
          this.upHold += dt;
          if (this.upHold >= TUNE.pullHold) pull = true;
        } else this.upHold = 0;
        if (this.t > TUNE.assistBite) {
          pull = true;
          this.assisted = true;
          ev |= EV.assist;
        }
        if (pull) {
          this.state = ST.reel;
          this.t = 0;
          ev |= EV.pull;
        }
        break;
      }
      case ST.reel:
        if (this.t >= TUNE.reelTime) {
          this.state = ST.idle;
          this.t = 0;
          this.idleT = 0;
          this.cool = TUNE.cool;
          this.armed = false;
          this.peak = 0;
          ev |= EV.catch;
        }
        break;
    }
    this.ev = ev;
    return ev;
  }
}
