// Fishing gestures of ONE player, computed from the engine's filtered landmarks and gesture state.
// Pure (numbers in, numbers out) so it is unit-tested without a camera.

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
  /** reel hand: circles per second from the engine's crank tracker */
  crank: number;
  reelVisible: boolean;
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
  crank: 0, reelVisible: false, leftY: 0, rightY: 0, leftVisible: false, rightVisible: false, hipY: 0,
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
  armed: boolean;
  strike: boolean;
  pumpLift: number;
  pumpLower: number;
  crank: number;
  reelVisible: boolean;
  net: boolean;
}

export const emptySignals = (): AnglerSignals => ({
  pitch: 25, yawDeg: 0, yawNorm: 0, cast: false, castPower: 0, armed: false, strike: false, pumpLift: 0, pumpLower: 1, crank: 0, reelVisible: false, net: false,
});

export class AnglerGestures {
  readonly cast = new CastDetector();
  readonly strike = new StrikeDetector();
  readonly pump = new PumpTracker();
  readonly net = new NetDetector();
  readonly out: AnglerSignals = emptySignals();
  private keyCrank = 0;

  reset(): void {
    this.cast.reset();
    this.strike.reset();
    this.pump.reset();
    this.net.reset();
  }

  /** `wantStrike` / `wantCast`: the game state decides which of the two the same swing key means. */
  update(dt: number, i: AnglerInput, t: Tuning, wantCast: boolean, wantStrike: boolean): AnglerSignals {
    const o = this.out;
    o.net = this.net.update(dt, i, i.keyNet);
    // rod angles
    if (i.present && i.rodVisible) {
      const s = Math.max(1, i.scale);
      const elev = clamp((i.shoulderY - i.rodY) / s, -1.2, 1.8);
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
    // reel
    this.keyCrank += ((i.keyReel ? 1.4 : 0) - this.keyCrank) * (1 - Math.exp(-dt * 10));
    o.crank = clamp(Math.max(i.present ? i.crank : 0, this.keyCrank, i.voiceCrank), 0, 2.6);
    o.reelVisible = i.present && i.reelVisible;
    // cast / strike share the swing
    const up = -i.vy;
    const handUp = i.present && i.handUp;
    const swing = i.keySwing;
    const c = this.cast.update(dt, handUp && wantCast, i.present ? Math.max(0, i.vy) : 0, t, swing && wantCast);
    const vCast = wantCast && i.voiceCast;
    o.cast = (wantCast && c.fired) || vCast;
    o.castPower = vCast && !c.fired ? i.voicePower : c.power;
    o.armed = this.cast.armed;
    const st = this.strike.update(dt, i.present ? Math.max(0, up) : 0, t, swing && wantStrike);
    o.strike = (st && wantStrike) || (wantStrike && i.voiceStrike);
    const p = this.pump.update(dt, i.present ? i.vy : 0, o.crank, t, i.keyPump);
    o.pumpLift = p.lift;
    o.pumpLower = p.lower;
    return o;
  }
}
