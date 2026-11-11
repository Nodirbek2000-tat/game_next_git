// Fitnes: is the exercise done right? One analyser per exercise, from the MediaPipe landmarks (px, with visibility). Pure logic,
// no engine imports. Joint angles (hip-knee-ankle ...) decide, measured in the picture, so they work at any distance; lengths are
// relative to the shoulder width (`scale`).
//
// Every analyser returns the same Reading each frame:
//   good  - the pose / movement is right at this moment (green skeleton)
//   cue   - a short correction in Uzbek, or null
//   rep   - true on the frame a correct repetition is completed (reps exercises)
// A "hold" exercise counts the seconds while `good` (short wobbles under GRACE are forgiven).

import type { ExerciseId } from "@/lib/fitness/exercises";
import { classify, JackCounter, type Pose as JackPose } from "../yulduzcha/logic";

export interface Lm {
  x: number;
  y: number;
  v: number;
}

export interface Reading {
  good: boolean;
  cue: string | null;
  rep: boolean;
}

export interface Analyser {
  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading;
  /** repetitions so far */
  reps: number;
  /** seconds held correctly so far (hold exercises) */
  held: number;
}

const VIS = 0.4;
/** a hold exercise forgives a wrong pose this long (s) */
const GRACE = 0.5;

const seen = (...p: Lm[]): boolean => p.every((q) => q && q.v >= VIS);

/** angle at b (degrees) between b->a and b->c */
export function angle(a: Lm, b: Lm, c: Lm): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (d === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d))) * 180) / Math.PI;
}

const mid = (a: Lm, b: Lm): Lm => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });

/** lean of the line from `low` up to `high` away from the vertical (degrees, 0 = upright); sign: + = towards +x */
function lean(high: Lm, low: Lm): number {
  return (Math.atan2(high.x - low.x, low.y - high.y) * 180) / Math.PI;
}

/**
 * How bent one leg is, 0 = straight .. 1 = thigh horizontal. Two measures, the larger wins: the knee angle (right when the camera
 * sees the leg from the side) and how far the hip came down towards the knee compared with the shin length (facing the camera
 * the knee angle hardly changes in the picture, but the thigh gets short).
 */
export function flex(hip: Lm, knee: Lm, ankle: Lm): number {
  const byAngle = (170 - angle(hip, knee, ankle)) / 80;
  const shin = Math.max(1, ankle.y - knee.y);
  const byDrop = (1 - (knee.y - hip.y) / shin) / 0.8;
  return Math.max(0, Math.min(1, Math.max(byAngle, byDrop)));
}

const LEGS_CUE = "Orqaroq turing — oyoqlar ko‘rinsin";

function legsSeen(lm: ArrayLike<Lm>, stageH: number): boolean {
  return seen(lm[23], lm[24], lm[25], lm[26], lm[27], lm[28]) && lm[27].y < stageH - 2 && lm[28].y < stageH - 2;
}

const R = (good: boolean, cue: string | null, rep = false): Reading => ({ good, cue, rep });

// ------------------------------------------------------------------------------------------- squat

/** Standing (legs straight) -> down (thighs about parallel: flex > 0.8) -> standing = 1 rep. A shallow dip says "Pastroq". */
export class SquatAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private down = false;
  private deepest = 0;
  private cue: string | null = null;
  private cueT = 0;

  update(lm: ArrayLike<Lm>, _scale: number, stageH: number, dt: number): Reading {
    this.cueT = Math.max(0, this.cueT - dt);
    if (!legsSeen(lm, stageH)) return R(false, LEGS_CUE);
    const k = (flex(lm[23], lm[25], lm[27]) + flex(lm[24], lm[26], lm[28])) / 2;
    const torso = Math.abs(lean(mid(lm[11], lm[12]), mid(lm[23], lm[24])));
    let rep = false;
    this.deepest = Math.max(this.deepest, k);
    if (k > 0.8) this.down = true;
    if (k < 0.2) {
      if (this.down) {
        this.reps++;
        rep = true;
        this.say(null);
      } else if (this.deepest > 0.4) this.say("Pastroq o‘tiring — son polga parallel");
      this.down = false;
      this.deepest = 0;
    }
    const back = torso > 50;
    if (back && k > 0.4) this.say("Ko‘krakni tik tuting");
    return R(!back, this.cueT > 0 ? this.cue : null, rep);
  }

  private say(c: string | null): void {
    this.cue = c;
    this.cueT = c ? 1.6 : 0;
  }
}

// ------------------------------------------------------------------------------------------- lunge

/** The front leg bent to about 90° (flex > 0.75) -> both legs straight again = 1 rep (facing the camera the back knee hardly shows). */
export class LungeAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private down = false;
  private deepest = 0;
  private cue: string | null = null;
  private cueT = 0;

  update(lm: ArrayLike<Lm>, _scale: number, stageH: number, dt: number): Reading {
    this.cueT = Math.max(0, this.cueT - dt);
    if (!legsSeen(lm, stageH)) return R(false, LEGS_CUE);
    const a = flex(lm[23], lm[25], lm[27]);
    const b = flex(lm[24], lm[26], lm[28]);
    const front = Math.max(a, b);
    const back = Math.min(a, b);
    let rep = false;
    this.deepest = Math.max(this.deepest, front);
    if (front > 0.75) this.down = true;
    if (front < 0.2 && back < 0.2) {
      if (this.down) {
        this.reps++;
        rep = true;
        this.cueT = 0;
      } else if (this.deepest > 0.4) {
        this.cue = "Pastroq tushing — ikkala tizza bukilsin";
        this.cueT = 1.6;
      }
      this.down = false;
      this.deepest = 0;
    }
    const torso = Math.abs(lean(mid(lm[11], lm[12]), mid(lm[23], lm[24])));
    if (torso > 35 && front > 0.4) {
      this.cue = "Gavdani tik tuting";
      this.cueT = 1.2;
    }
    return R(torso <= 35, this.cueT > 0 ? this.cue : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- jumping jack

export class JackAnalyser implements Analyser {
  held = 0;
  private readonly pose: JackPose = { up: false, down: false, apart: false, together: false, legs: false };
  private readonly jack = new JackCounter();
  get reps(): number {
    return this.jack.reps;
  }
  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading {
    if (!seen(lm[11], lm[12], lm[15], lm[16])) return R(false, "Qo‘llar ko‘rinsin");
    classify(lm, scale, stageH, this.pose);
    const rep = this.jack.update(dt, this.pose);
    const half = this.pose.up && this.pose.legs && !this.pose.apart;
    return R(true, half ? "Oyoqlarni kengroq oching" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- high knees

/** A knee up near hip height, then down; the other knee next = 1 rep each (the same knee twice does not count). */
export class KneesAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private up: -1 | 0 | 1 = -1;
  private last: -1 | 0 | 1 = -1;
  private half = 0;

  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading {
    if (!seen(lm[23], lm[24], lm[25], lm[26])) return R(false, LEGS_CUE);
    void stageH;
    const hipY = (lm[23].y + lm[24].y) / 2;
    // knee height above the hip in shoulder widths (0 = at the hip, negative = below)
    const hL = (hipY - lm[25].y) / scale;
    const hR = (hipY - lm[26].y) / scale;
    let rep = false;
    this.half = Math.max(0, this.half - dt);
    const side: 0 | 1 = hL > hR ? 0 : 1;
    const h = Math.max(hL, hR);
    if (this.up < 0 && h > -0.35) this.up = side;
    if (this.up >= 0 && h < -0.9) {
      if (this.up !== this.last) {
        this.reps++;
        rep = true;
      }
      this.last = this.up;
      this.up = -1;
    }
    if (this.up < 0 && h > -0.75 && h <= -0.35) this.half = 0.8;
    return R(true, this.half > 0 ? "Tizzani balandroq ko‘taring" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- alternating helper

/** Counts alternating sides: a side "reached" counts once it is back home, and only after the other side (or the first time). */
class Alternate {
  reps = 0;
  private armed: -1 | 0 | 1 = -1;
  private last: -1 | 0 | 1 = -1;
  /** `reach` = the side at the goal now (-1 = none), `home` = back at the start position */
  step(reach: -1 | 0 | 1, home: boolean): boolean {
    if (this.armed < 0 && reach >= 0) this.armed = reach;
    if (this.armed >= 0 && home) {
      const ok = this.armed !== this.last;
      if (ok) this.reps++;
      this.last = this.armed;
      this.armed = -1;
      return ok;
    }
    return false;
  }
}

// ------------------------------------------------------------------------------------------- shadow boxing (cross punches)

/**
 * Facing the camera a straight punch hardly changes the picture, so the cross is counted: a fist goes from its own side across
 * the middle of the face (nose) to the other side, at face / shoulder height, then back. Left and right alternate.
 */
export class PunchAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private readonly alt = new Alternate();
  private low = 0;
  update(lm: ArrayLike<Lm>, scale: number, _stageH: number, dt: number): Reading {
    if (!seen(lm[0], lm[11], lm[12], lm[15], lm[16])) return R(false, "Qo‘llar va yuz ko‘rinsin");
    const nose = lm[0];
    // which side of the nose each shoulder is on (the picture may be mirrored)
    const lSide = Math.sign(lm[11].x - nose.x) || 1;
    const rSide = Math.sign(lm[12].x - nose.x) || -1;
    const shY = (lm[11].y + lm[12].y) / 2;
    const height = (w: Lm): boolean => w.y > nose.y - 0.6 * scale && w.y < shY + 0.6 * scale;
    const crossed = (w: Lm, side: number): boolean => Math.sign(w.x - nose.x) === -side && Math.abs(w.x - nose.x) > 0.25 * scale && height(w);
    const atHome = (w: Lm, side: number): boolean => Math.sign(w.x - nose.x) === side;
    const reach: -1 | 0 | 1 = crossed(lm[15], lSide) ? 0 : crossed(lm[16], rSide) ? 1 : -1;
    const rep = this.alt.step(reach, atHome(lm[15], lSide) && atHome(lm[16], rSide));
    this.reps = this.alt.reps;
    // fists dropped below the chest: guard up
    this.low = lm[15].y > shY + 0.9 * scale && lm[16].y > shY + 0.9 * scale ? this.low + dt : 0;
    return R(true, this.low > 0.8 ? "Mushtlarni iyak oldida ushlang" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- overhead reach (press)

/** Both wrists from shoulder height up above the head, then back down = 1 rep. A half lift says so. */
export class OverheadAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private up = false;
  private best = 0;
  private cueT = 0;
  update(lm: ArrayLike<Lm>, scale: number, _stageH: number, dt: number): Reading {
    if (!seen(lm[0], lm[11], lm[12], lm[15], lm[16])) return R(false, "Qo‘llar ko‘rinsin");
    this.cueT = Math.max(0, this.cueT - dt);
    const shY = (lm[11].y + lm[12].y) / 2;
    // the lower wrist: 0 = shoulder height, 1 = well above the head
    const lowWrist = Math.max(lm[15].y, lm[16].y);
    const k = (shY - lowWrist) / Math.max(1, shY - (lm[0].y - 0.6 * scale));
    let rep = false;
    this.best = Math.max(this.best, k);
    if (k > 0.95) this.up = true;
    if (k < 0.15) {
      if (this.up) {
        this.reps++;
        rep = true;
      } else if (this.best > 0.35) this.cueT = 1.5;
      this.up = false;
      this.best = 0;
    }
    return R(true, this.cueT > 0 ? "Qo‘llarni to‘liq tepaga cho‘zing" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- standing knee to elbow

/** A knee up near hip height with the opposite elbow close to it, then down; sides alternate. */
export class KneeElbowAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private readonly alt = new Alternate();
  private far = 0;
  update(lm: ArrayLike<Lm>, scale: number, _stageH: number, dt: number): Reading {
    if (!seen(lm[13], lm[14], lm[23], lm[24], lm[25], lm[26])) return R(false, LEGS_CUE);
    const hipY = (lm[23].y + lm[24].y) / 2;
    const near = (knee: Lm, elbow: Lm): boolean => Math.hypot(knee.x - elbow.x, knee.y - elbow.y) < 1.1 * scale;
    const hL = (hipY - lm[25].y) / scale;
    const hR = (hipY - lm[26].y) / scale;
    const upL = hL > -0.6;
    const upR = hR > -0.6;
    const reach: -1 | 0 | 1 = upL && near(lm[25], lm[14]) ? 0 : upR && near(lm[26], lm[13]) ? 1 : -1;
    const rep = this.alt.step(reach, hL < -0.9 && hR < -0.9);
    this.reps = this.alt.reps;
    this.far = (upL || upR) && reach < 0 ? this.far + dt : 0;
    return R(true, this.far > 0.4 ? "Tirsakni qarama-qarshi tizzaga yaqinlashtiring" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- side steps

/** The hips move well to one side of their average position, then to the other: 1 rep per side. */
export class SideStepAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private readonly alt = new Alternate();
  private base: number | null = null;
  private small = 0;
  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading {
    if (!legsSeen(lm, stageH)) return R(false, LEGS_CUE);
    const x = (lm[23].x + lm[24].x) / 2;
    // the middle of the movement: a slow average of the hip position
    this.base = this.base === null ? x : this.base + (x - this.base) * Math.min(1, dt / 1.5);
    const d = (x - this.base) / scale;
    const reach: -1 | 0 | 1 = d > 0.55 ? 1 : d < -0.55 ? 0 : -1;
    // a step counts when the body comes back through the middle
    const rep = this.alt.step(reach, Math.abs(d) < 0.2);
    this.reps = this.alt.reps;
    this.small = Math.abs(d) > 0.25 && Math.abs(d) <= 0.55 ? this.small + dt : 0;
    return R(true, this.small > 0.6 ? "Kengroq qadam tashlang" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- side leg raise

/** A straight leg lifted out to the side (the ankle well out and up), then back; sides alternate. */
export class SideLegAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private readonly alt = new Alternate();
  private half = 0;
  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading {
    if (!legsSeen(lm, stageH)) return R(false, LEGS_CUE);
    const out = (ank: Lm, hip: Lm, otherAnk: Lm): number => (otherAnk.y - ank.y > 0.25 * scale ? Math.abs(ank.x - hip.x) / scale : 0);
    const l = out(lm[27], lm[23], lm[28]);
    const r = out(lm[28], lm[24], lm[27]);
    const reach: -1 | 0 | 1 = l > 1.1 ? 0 : r > 1.1 ? 1 : -1;
    const home = Math.abs(lm[27].x - lm[28].x) / scale < 1.3 && Math.abs(lm[27].y - lm[28].y) / scale < 0.25;
    const rep = this.alt.step(reach, home);
    this.reps = this.alt.reps;
    const m = Math.max(l, r);
    this.half = m > 0.5 && m <= 1.1 ? this.half + dt : 0;
    return R(true, this.half > 0.5 ? "Oyoqni balandroq ko‘taring" : null, rep);
  }
}

// ------------------------------------------------------------------------------------------- hold helpers

abstract class HoldAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private bad = GRACE;
  update(lm: ArrayLike<Lm>, scale: number, stageH: number, dt: number): Reading {
    const r = this.check(lm, scale, stageH);
    this.bad = r.good ? 0 : this.bad + dt;
    const good = this.bad < GRACE;
    if (good) this.held += dt;
    return R(good, r.good ? null : r.cue);
  }
  protected abstract check(lm: ArrayLike<Lm>, scale: number, stageH: number): { good: boolean; cue: string | null };
}

/** the side (11/23/25/27 = left, 12/24/26/28 = right) the camera sees better */
function bestSide(lm: ArrayLike<Lm>): [Lm, Lm, Lm, Lm] {
  const l = lm[11].v + lm[23].v + lm[25].v + lm[27].v;
  const r = lm[12].v + lm[24].v + lm[26].v + lm[28].v;
  return l >= r ? [lm[11], lm[23], lm[25], lm[27]] : [lm[12], lm[24], lm[26], lm[28]];
}

// ------------------------------------------------------------------------------------------- plank

/** Side view: shoulder - hip - ankle a straight line (> 160°), the body roughly horizontal, knees straight. */
export class PlankAnalyser extends HoldAnalyser {
  protected check(lm: ArrayLike<Lm>): { good: boolean; cue: string | null } {
    const [sh, hip, knee, ank] = bestSide(lm);
    if (!seen(sh, hip, ank)) return { good: false, cue: "Kameraga yon tomon bilan turing — butun tana ko‘rinsin" };
    const len = Math.hypot(sh.x - ank.x, sh.y - ank.y);
    if (len < 1 || Math.abs(sh.y - ank.y) > len * 0.6) return { good: false, cue: "Polga yoting: tirsak va oyoq uchlariga tayaning" };
    const body = angle(sh, hip, ank);
    if (body < 160) {
      // the hip above the shoulder-ankle line = too high
      const t = (hip.x - sh.x) / (ank.x - sh.x || 1);
      const lineY = sh.y + (ank.y - sh.y) * t;
      return { good: false, cue: hip.y < lineY ? "Belni pastroq tushiring" : "Belni ko‘taring — tana tekis bo‘lsin" };
    }
    if (seen(knee) && angle(hip, knee, ank) < 150) return { good: false, cue: "Tizzalarni tekis tuting" };
    return { good: true, cue: null };
  }
}

// ------------------------------------------------------------------------------------------- tree (vrikshasana)

/** Standing on one leg: the other ankle well above the floor, near the standing leg; hands above the head. */
export class TreeAnalyser extends HoldAnalyser {
  protected check(lm: ArrayLike<Lm>, scale: number): { good: boolean; cue: string | null } {
    if (!seen(lm[27], lm[28], lm[25], lm[26])) return { good: false, cue: LEGS_CUE };
    const lifted = lm[27].y < lm[28].y ? 27 : 28;
    const stand = lifted === 27 ? 28 : 27;
    const rise = (lm[stand].y - lm[lifted].y) / scale;
    if (rise < 0.5) return { good: false, cue: "Bir oyoqni ko‘tarib, tovonni ikkinchi oyoq ichiga qo‘ying" };
    const standKnee = stand === 27 ? lm[25] : lm[26];
    if (Math.abs(lm[lifted].x - standKnee.x) / scale > 1.1) return { good: false, cue: "Tovonni tizza yoki son ichiga qo‘ying" };
    if (!seen(lm[15], lm[16], lm[0]) || lm[15].y > lm[0].y || lm[16].y > lm[0].y) return { good: false, cue: "Qo‘llarni boshdan yuqori ko‘taring" };
    return { good: true, cue: null };
  }
}

// ------------------------------------------------------------------------------------------- warrior II (virabhadrasana II)

/** Feet wide, one knee bent (75-130°), the other leg straight; both arms out sideways at shoulder height. */
export class WarriorAnalyser extends HoldAnalyser {
  protected check(lm: ArrayLike<Lm>, scale: number, stageH: number): { good: boolean; cue: string | null } {
    if (!legsSeen(lm, stageH)) return { good: false, cue: LEGS_CUE };
    if (Math.abs(lm[27].x - lm[28].x) / scale < 2) return { good: false, cue: "Oyoqlarni kengroq qo‘ying" };
    const a = angle(lm[23], lm[25], lm[27]);
    const b = angle(lm[24], lm[26], lm[28]);
    const bent = Math.min(a, b);
    const straight = Math.max(a, b);
    if (bent > 135) return { good: false, cue: "Oldingi tizzani bukling" };
    if (bent < 70) return { good: false, cue: "Tizzani sal ko‘taring — 90° atrofida" };
    if (straight < 155) return { good: false, cue: "Orqa oyoqni tekis tuting" };
    if (!seen(lm[11], lm[12], lm[15], lm[16])) return { good: false, cue: "Qo‘llar ko‘rinsin" };
    const shY = (lm[11].y + lm[12].y) / 2;
    const level = Math.abs(lm[15].y - shY) / scale < 0.45 && Math.abs(lm[16].y - shY) / scale < 0.45;
    const wide = Math.abs(lm[15].x - lm[16].x) / scale > 2.6;
    if (!level || !wide) return { good: false, cue: "Qo‘llarni yelka balandligida yon tomonga cho‘zing" };
    return { good: true, cue: null };
  }
}

// ------------------------------------------------------------------------------------------- side bend

/** Arms up, the torso bends > 15° to one side and back to the middle; left and right alternate (1 rep each). */
export class SideBendAnalyser implements Analyser {
  reps = 0;
  held = 0;
  private side = 0;
  private last = 0;
  private part = 0;

  update(lm: ArrayLike<Lm>, scale: number, _stageH: number, dt: number): Reading {
    void scale;
    if (!seen(lm[11], lm[12], lm[23], lm[24])) return R(false, "Orqaroq turing — gavda ko‘rinsin");
    const tilt = lean(mid(lm[11], lm[12]), mid(lm[23], lm[24]));
    const armsUp = seen(lm[15], lm[16], lm[0]) && lm[15].y < lm[0].y && lm[16].y < lm[0].y;
    this.part = Math.max(0, this.part - dt);
    let rep = false;
    if (this.side === 0 && Math.abs(tilt) > 15) this.side = tilt > 0 ? 1 : -1;
    if (this.side !== 0 && Math.abs(tilt) < 6) {
      if (this.side !== this.last) {
        this.reps++;
        rep = true;
      }
      this.last = this.side;
      this.side = 0;
    }
    if (this.side === 0 && Math.abs(tilt) > 8 && Math.abs(tilt) <= 15) this.part = 0.8;
    const cue = !armsUp ? "Qo‘llarni tepaga ko‘taring" : this.part > 0 ? "Ko‘proq egiling" : null;
    return R(armsUp, cue, rep);
  }
}

export function makeAnalyser(id: ExerciseId): Analyser {
  switch (id) {
    case "squat":
      return new SquatAnalyser();
    case "lunge":
      return new LungeAnalyser();
    case "jack":
      return new JackAnalyser();
    case "knees":
      return new KneesAnalyser();
    case "boks":
      return new PunchAnalyser();
    case "tepaga":
      return new OverheadAnalyser();
    case "tirsak":
      return new KneeElbowAnalyser();
    case "yonqadam":
      return new SideStepAnalyser();
    case "yonoyoq":
      return new SideLegAnalyser();
    case "plank":
      return new PlankAnalyser();
    case "daraxt":
      return new TreeAnalyser();
    case "jangchi":
      return new WarriorAnalyser();
    case "egilish":
      return new SideBendAnalyser();
  }
}
