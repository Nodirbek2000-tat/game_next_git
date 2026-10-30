// First-person view: the player turns the view by turning the head / shoulders (or with the arrow keys).
// head pose -> normalised turn -> dead zone -> smoothed yaw. Pure numbers, unit tested without a camera.

import { clamp } from "./rules";

export const VIEW = {
  /** furthest the view turns (degrees, + = right) */
  maxYawDeg: 80,
  /** head turn (normalised, 1 = a clear ~45 degree turn) that is ignored around the neutral pose */
  deadZone: 0.16,
  /** exponent > 1: fine control near the centre, quicker further out */
  curve: 1.25,
  /** smoothing (1/s): following a turn / coming back */
  follow: 7,
  back: 5,
  /** keyboard turning speed (deg/s) */
  keyDegPerSec: 75,
  /** the neutral pose is learnt from the first moments of play (s) */
  calibrate: 0.7,
  /** slow re-centring of the neutral pose while the head is almost still (normalised per s) */
  drift: 0.06,
  /** camera pitch limits (degrees, negative = down) */
  pitchMin: -32,
  pitchMax: 4,
} as const;

export interface HeadInput {
  noseX: number;
  noseV: number;
  earLX: number;
  earLV: number;
  earRX: number;
  earRV: number;
  shLX: number;
  shRX: number;
  shV: number;
}

export const emptyHead = (): HeadInput => ({ noseX: 0, noseV: 0, earLX: 0, earLV: 0, earRX: 0, earRV: 0, shLX: 0, shRX: 0, shV: 0 });

/**
 * Raw head turn from the pose landmarks (stage px, mirrored: + = the user's right). Returns NaN when nothing is visible.
 * Preferred cue: the nose against the middle of the ears (independent of where the body stands in the picture);
 * fallback: the nose against the middle of the shoulders. The result is divided by the shoulder width, so it does not
 * depend on how far from the camera the player stands.
 */
export function headTurn(h: HeadInput): number {
  const sw = Math.abs(h.shRX - h.shLX);
  if (h.shV < 0.35 || sw < 1e-3 || h.noseV < 0.35) return NaN;
  if (h.earLV > 0.4 && h.earRV > 0.4) {
    const mid = (h.earLX + h.earRX) / 2;
    return (h.noseX - mid) / (sw * 0.18);
  }
  const mid = (h.shLX + h.shRX) / 2;
  return (h.noseX - mid) / (sw * 0.4);
}

/** Dead zone + curve: turn (relative to the neutral pose) -> -1..1 */
export function shapeTurn(rel: number): number {
  const a = Math.abs(rel);
  if (a <= VIEW.deadZone) return 0;
  const s = Math.min(1, (a - VIEW.deadZone) / (1 - VIEW.deadZone));
  return Math.sign(rel) * Math.pow(s, VIEW.curve);
}

/** first-person camera: vertical field of view (degrees) */
export const FOV = 58;

/** The player's eye and the rod grip (first person): the camera stands on the bridge, the grip is in front, to the right / left. */
export const EYE = { x: 0, y: 2.3, z: 4.95, gripSide: 0.25, gripDown: 0.235, gripFwd: 0.58 } as const;

/** Head turn relative to a neutral pose -> target yaw in degrees. */
export function turnToYawDeg(turn: number, neutral: number): number {
  return shapeTurn(turn - neutral) * VIEW.maxYawDeg;
}

/** Comfortable camera pitch (degrees): look a little towards where the float / fish is, never far from the horizon. */
export function lookPitch(eyeY: number, targetY: number, dist: number): number {
  if (!(dist > 0.5)) return -8;
  const toTarget = (Math.atan2(targetY - eyeY, dist) * 180) / Math.PI;
  return clamp(-3 + (toTarget + 3) * 0.55, VIEW.pitchMin, VIEW.pitchMax);
}

/** Smoothly turning first-person view (yaw only; the pitch is eased by the game). */
export class ViewController {
  /** current yaw (degrees) */
  yawDeg = 0;
  /** where it is heading (degrees) */
  targetDeg = 0;
  /** the pose the player held at the start (normalised head turn) */
  neutral = 0;
  calibrated = false;
  /** last measured raw head turn (NaN = none) */
  raw = NaN;
  private calT = 0;
  private calSum = 0;
  private calN = 0;
  private keyDeg = 0;

  reset(): void {
    this.yawDeg = this.targetDeg = this.neutral = 0;
    this.calibrated = false;
    this.raw = NaN;
    this.calT = this.calSum = this.calN = 0;
    this.keyDeg = 0;
  }

  /** Forget the neutral pose: it is learnt again from the next frames. */
  recalibrate(): void {
    this.calibrated = false;
    this.calT = this.calSum = this.calN = 0;
  }

  /** Put the manual (keyboard) offset back to the centre and learn the neutral pose again. */
  center(): void {
    this.keyDeg = 0;
    this.recalibrate();
  }

  /** `turn` = headTurn() or NaN when the player is not visible; `key` = -1 (left) .. 1 (right): the keys add to the head turn. */
  update(dt: number, turn: number, key: number): number {
    this.raw = turn;
    const valid = Number.isFinite(turn);
    if (valid && !this.calibrated) {
      this.calT += dt;
      this.calSum += turn;
      this.calN++;
      if (this.calT >= VIEW.calibrate && this.calN >= 3) {
        const m = this.calSum / this.calN;
        this.neutral = clamp(m, -0.6, 0.6);
        this.calibrated = true;
      }
    }
    if (key !== 0) this.keyDeg = clamp(this.keyDeg + key * VIEW.keyDegPerSec * dt, -VIEW.maxYawDeg, VIEW.maxYawDeg);
    let head = 0;
    if (valid && this.calibrated) {
      head = turnToYawDeg(turn, this.neutral);
      // posture drifts: while the head is nearly in the dead zone, creep the neutral pose towards it
      if (Math.abs(turn - this.neutral) < VIEW.deadZone * 1.6) this.neutral += (turn - this.neutral) * Math.min(1, VIEW.drift * dt);
    }
    this.targetDeg = clamp(head + this.keyDeg, -VIEW.maxYawDeg, VIEW.maxYawDeg);
    const rate = Math.abs(this.targetDeg) < Math.abs(this.yawDeg) ? VIEW.back : VIEW.follow;
    this.yawDeg += (this.targetDeg - this.yawDeg) * (1 - Math.exp(-dt * rate));
    return this.yawDeg;
  }
}
