// Fishing gestures of ONE player, computed from the engine's filtered landmarks and gesture state.
// Pure (numbers in, numbers out) so it is unit-tested without a camera.

import { CrankReel, SteerTracker } from "./handmotion";
import { CastDetector, clamp, PumpTracker, StrikeDetector, TUNING, type Tuning } from "./rules";

export interface AnglerInput {
  present: boolean;
  /** body scale (px) */
  scale: number;
  /** rod hand (the dominant one) */
  rodVisible: boolean;
  rodX: number;
  rodY: number;
  shoulderX: number;
  shoulderY: number;
  /** rod wrist above the shoulder (engine StableBool) */
  handUp: boolean;
  /** rod wrist vertical velocity, screen heights / s (positive = down) */
  vy: number;
  /** reel hand (the other one): wrist position in stage px; its circles drive the reel */
  reelVisible: boolean;
  reelX: number;
  reelY: number;
  /** real seconds since the last frame (the game clock is capped, hand speeds are not); 0 = use dt */
  realDt: number;
  /** both wrists (stage px) and the hips for the landing-net gesture */
  leftY: number;
  rightY: number;
  leftVisible: boolean;
  rightVisible: boolean;
  hipY: number;
  /** keyboard fallback */
  keySwing: boolean;
  keyReel: boolean;
  keyPump: boolean;
  keyNet: boolean;
  /** -1..1 */
  keyAim: number;
  /** voice commands (kids): decided by the voice mixer for the current situation */
  voiceCast: boolean;
  voicePower: number;
  voiceStrike: boolean;
  voiceCrank: number;
}

export const emptyInput = (): AnglerInput => ({
  present: false, scale: 100, rodVisible: false, rodX: 0, rodY: 0, shoulderX: 0, shoulderY: 0, handUp: false, vy: 0,
  reelVisible: false, reelX: 0, reelY: 0, realDt: 0, leftY: 0, rightY: 0, leftVisible: false, rightVisible: false, hipY: 0,
  keySwing: false, keyReel: false, keyPump: false, keyNet: false, keyAim: 0,
  voiceCast: false, voicePower: 0, voiceStrike: false, voiceCrank: 0,
});

/** Both hands down (below the hips), then both up (above the shoulders) within a short time. */
export class NetDetector {
  private downT = 0;
  private cool = 0;
  fired = false;
  reset(): void {
    this.downT = 0;
    this.cool = 0;
    this.fired = false;
  }
  update(dt: number, i: AnglerInput, key = false): boolean {
    const n = TUNING.net;
    this.fired = false;
    this.cool = Math.max(0, this.cool - dt);
    this.downT = Math.max(0, this.downT - dt);
    if (key) {
      if (this.cool === 0) {
        this.fired = true;
        this.cool = n.cooldown;
      }
      return this.fired;
    }
    if (!i.present || !i.leftVisible || !i.rightVisible) return false;
    const s = Math.max(1, i.scale);
    const down = i.leftY > i.hipY - n.hipTol * s && i.rightY > i.hipY - n.hipTol * s;
    const up = i.leftY < i.shoulderY + n.upLift * s && i.rightY < i.shoulderY + n.upLift * s;
    if (down) this.downT = n.downWindow;
    else if (up && this.downT > 0 && this.cool === 0) {
      this.fired = true;
      this.cool = n.cooldown;
      this.downT = 0;
    }
    return this.fired;
  }
}

export interface AnglerSignals {
  /** rod pitch above horizontal, degrees (prototype: 24 + elevation * 18) */
  pitch: number;
  /** aim, degrees + = right */
  yawDeg: number;
  /** raw hand offset used for the cast direction (body scales) */
  yawNorm: number;
  cast: boolean;
  castPower: number;
  /** sideways aim of the cast stroke (hand offset from the shoulder, body scales) */
  castAim: number;
  /** the cast came from a real arm stroke (not the keyboard / voice) */
  castHand: boolean;
  armed: boolean;
  /** the forward stroke of a cast is under way */
  stroking: boolean;
  /** smoothed vertical hand speed, screen heights / s (positive = down): the rod bends against it */
  armV: number;
  strike: boolean;
  pumpLift: number;
  pumpLower: number;
  /** reeling speed, circles / s (>= 0) */
  crank: number;
  /** signed turn speed of the reel (+ = clockwise on the screen): the drawn handle turns with it */
  spin: number;
  reelVisible: boolean;
  /** rod hand sideways against its neutral, -1 (left) .. 1 (right): steers the fish */
  steer: number;
  net: boolean;
}

export const emptySignals = (): AnglerSignals => ({
  pitch: 25, yawDeg: 0, yawNorm: 0, cast: false, castPower: 0, castAim: 0, castHand: false, armed: false, stroking: false, armV: 0, strike: false,
  pumpLift: 0, pumpLower: 1, crank: 0, spin: 0, reelVisible: false, steer: 0, net: false,
});

export class AnglerGestures {
  readonly cast = new CastDetector();
  readonly strike = new StrikeDetector();
  readonly pump = new PumpTracker();
  readonly net = new NetDetector();
  readonly reel = new CrankReel();
  readonly steer = new SteerTracker();
  readonly out: AnglerSignals = emptySignals();
  private keyCrank = 0;
  /** how long the rod hand has been tracked without a break (s) */
  private seenT = 0;

  reset(): void {
    this.cast.reset();
    this.strike.reset();
    this.pump.reset();
    this.net.reset();
    this.reel.reset();
  }

  /** `wantStrike` / `wantCast`: the game state decides which of the two the same swing key means. */
  update(dt: number, i: AnglerInput, t: Tuning, wantCast: boolean, wantStrike: boolean): AnglerSignals {
    const o = this.out;
    const hdt = i.realDt > 0 ? Math.min(0.3, i.realDt) : dt;
    o.net = this.net.update(dt, i, i.keyNet);
    // rod angles
    const seen = i.present && i.rodVisible;
    this.seenT = seen ? this.seenT + hdt : 0;
    let elev = 0;
    if (seen) {
      const s = Math.max(1, i.scale);
      elev = clamp((i.shoulderY - i.rodY) / s, -1.2, 1.8);
      const yaw = clamp((i.rodX - i.shoulderX) / s, -1.6, 1.6);
      o.yawNorm = yaw;
      const kp = 1 - Math.exp(-dt * 16);
      const ky = 1 - Math.exp(-dt * 12);
      o.pitch += (clamp(24 + elev * 18, 16, 75) - o.pitch) * kp;
      o.yawDeg += (yaw * 13 - o.yawDeg) * ky;
    } else if (i.keyAim !== 0) {
      o.yawNorm = clamp(o.yawNorm + i.keyAim * dt * 1.2, -1.6, 1.6);
      o.yawDeg += (o.yawNorm * 13 - o.yawDeg) * (1 - Math.exp(-dt * 12));
    }
    // steering: the rod hand against its neutral (the keys A / D move the aim the same way)
    o.steer = this.steer.update(hdt, o.yawNorm, t.sensitivity);
    // reel: the circle of the reel hand (speed and direction), or the keyboard / voice
    const rate = this.reel.update(hdt, i.reelX, i.reelY, i.present && i.reelVisible, i.scale, t.sensitivity);
    this.keyCrank += ((i.keyReel ? 1.4 : 0) - this.keyCrank) * (1 - Math.exp(-dt * 10));
    const other = Math.max(this.keyCrank, i.voiceCrank);
    o.crank = clamp(Math.max(rate, other), 0, TUNING.reel.max);
    o.spin = rate >= other ? Math.sign(this.reel.omega) * rate : o.crank;
    o.reelVisible = i.present && i.reelVisible;
    // cast / strike share the swing. A hand that just came back into view jumps: its strokes do not count for a moment.
    const up = -i.vy;
    const handUp = seen && i.handUp;
    const swing = i.keySwing;
    const down = seen && this.seenT > TUNING.cast.settle ? Math.max(0, i.vy) : 0;
    o.armV += ((seen ? i.vy : 0) - o.armV) * (1 - Math.exp(-hdt / 0.06));
    const c = this.cast.update(dt, handUp && wantCast, down, elev, o.yawNorm, t, swing && wantCast);
    const vCast = wantCast && i.voiceCast;
    o.cast = (wantCast && c.fired) || vCast;
    o.castPower = vCast && !c.fired ? i.voicePower : c.power;
    o.castAim = c.fired ? c.aim : o.yawNorm;
    o.castHand = wantCast && c.fired && c.viaHand;
    o.armed = this.cast.armed;
    o.stroking = this.cast.stroking;
    const st = this.strike.update(dt, i.present ? Math.max(0, up) : 0, t, swing && wantStrike);
    o.strike = (st && wantStrike) || (wantStrike && i.voiceStrike);
    const p = this.pump.update(dt, i.present ? i.vy : 0, o.crank, t, i.keyPump);
    o.pumpLift = p.lift;
    o.pumpLower = p.lower;
    return o;
  }
}
