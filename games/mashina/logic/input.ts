import { clamp } from "@/engine/math";
import { LegPedals } from "@/engine/tracking/legCalibration";
import { CONTROL_DEFAULTS, type ControlConfig } from "../config";

/** The slice of a PlayerFrame the driving controls need (structurally compatible with the engine type). */
export interface BodyLike {
  present: boolean;
  scale: number;
  lm: { x: number; y: number; v: number }[];
  /** the engine's own leg values; NOT used for the pedals (see LegPedals) */
  legs?: { gas: number; brake: number; ok: boolean; rest: number };
  gestures: { handsAboveHead: boolean };
}

export interface PadState {
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}

export interface Controls {
  gas: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** gear: true = R */
  reverse: boolean;
  /** true for exactly one update when the camera must switch (chase <-> cockpit) */
  camToggle: boolean;
  /** true for one update when the gear changed (HUD / sound) */
  gearEdge: boolean;
  /** both legs are seen right now */
  legsOk: boolean;
  handsOk: boolean;
  /** pedal calibration ("ikkala oyoqda turing") done; until then the pedals read 0 */
  legsReady: boolean;
  /** calibration progress 0..1 */
  legsCalib: number;
  /** the player seems to sit although the standing mode is on */
  legsSitting: boolean;
  /** what the camera reads (0..1, before smoothing) for the HUD bars; each leg seen or not */
  gasRaw: number;
  brakeRaw: number;
  gasThr: number;
  brakeThr: number;
  okGas: boolean;
  okBrake: boolean;
  source: "body" | "keys" | "pad";
}

export const newControls = (): Controls => ({
  gas: 0, brake: 0, steer: 0, handbrake: false, reverse: false, camToggle: false, gearEdge: false, legsOk: false, handsOk: false,
  legsReady: false, legsCalib: 0, legsSitting: false, gasRaw: 0, brakeRaw: 0, gasThr: 0.14, brakeThr: 0.14, okGas: false, okBrake: false, source: "body",
});

export interface InputOptions {
  seated: boolean;
  kids: boolean;
  /** which wrist pulls the handbrake: the right hand, or the left one for left-handed players */
  handbrakeSide: "L" | "R";
}

const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

/** Right hand pulled sharply down from the wheel while the other hand stays: handbrake pulse (TZ 6.3). */
export class HandbrakeDetector {
  private py: number | null = null;
  private pyO: number | null = null;
  private left = 0;

  constructor(private cfg: Pick<ControlConfig, "handbrakeDownVel" | "handbrakeLeftMax" | "handbrakeHoldSec">) {}

  reset(): void {
    this.py = this.pyO = null;
    this.left = 0;
  }

  /** `y` wrist y of the pulling hand, `yOther` the other wrist (stage px), H stage height. Returns true while the handbrake is on. */
  update(y: number | null, yOther: number | null, H: number, dt: number): boolean {
    if (y !== null && this.py !== null && dt > 0) {
      const vy = (y - this.py) / dt / H;
      const vo = yOther !== null && this.pyO !== null ? (yOther - this.pyO) / dt / H : 0;
      if (vy > this.cfg.handbrakeDownVel && Math.abs(vo) < this.cfg.handbrakeLeftMax * this.cfg.handbrakeDownVel) this.left = this.cfg.handbrakeHoldSec;
    }
    this.py = y;
    this.pyO = yOther;
    this.left = Math.max(0, this.left - dt);
    return this.left > 0;
  }
}

export function mapPad(pad: PadState, out: Controls): boolean {
  const dead = 0.12;
  const ax = pad.axes[0] ?? 0;
  const gas = pad.buttons[7]?.value ?? 0;
  const brake = pad.buttons[6]?.value ?? 0;
  const hb = !!pad.buttons[0]?.pressed;
  const cam = !!pad.buttons[3]?.pressed;
  const active = Math.abs(ax) > dead || gas > 0.05 || brake > 0.05 || hb || cam;
  if (!active) return false;
  out.steer = Math.abs(ax) > dead ? clamp((Math.abs(ax) - dead) / (1 - dead), 0, 1) * Math.sign(ax) : 0;
  out.gas = gas;
  out.brake = brake;
  out.handbrake = out.handbrake || hb;
  out.camToggle = out.camToggle || cam;
  out.source = "pad";
  return true;
}

/**
 * Whole-body input -> driving controls.
 *   gas = right knee lift (proportional), brake = left knee, steer = tilt of the line between the two wrists
 *   (imaginary wheel), handbrake = right hand pulled sharply down, reverse = brake held 1.5 s at a standstill,
 *   camera = both hands above the head. Keyboard and gamepad override the body when used.
 */
export class InputMapper {
  private legs: LegPedals;
  private hand: HandbrakeDetector;
  private lwSeen = false;
  private rwSeen = false;
  private steerTarget = 0;
  private handsLostT = 0;
  private gasSm = 0;
  private brakeSm = 0;
  private steerSm = 0;
  private reverse = false;
  private holdT = 0;
  private gearArmed = true;
  private camPrev = false;
  private camCooldown = 0;
  private keyCamPrev = false;
  private keyRevPrev = false;
  private hbKeys = false;

  constructor(
    private cfg: ControlConfig = CONTROL_DEFAULTS,
    private opts: InputOptions = { seated: false, kids: false, handbrakeSide: "R" },
  ) {
    this.legs = new LegPedals({ seated: opts.seated, range: cfg.legRange, dead: cfg.legDead, seatedRange: cfg.seatedRange, calibSec: cfg.legCalibSec, engageSec: cfg.legEngageSec });
    this.hand = new HandbrakeDetector(cfg);
  }

  /** the pedal reader (HUD / tests look at its calibration state) */
  get pedals(): LegPedals {
    return this.legs;
  }

  get gearReverse(): boolean {
    return this.reverse;
  }

  /** Changing standing <-> seated needs a new calibration; setting the same options again (every menu frame) changes nothing. */
  setOptions(o: Partial<InputOptions>): void {
    Object.assign(this.opts, o);
    this.legs.setSeated(this.opts.seated);
  }

  /** New session. The pedal calibration is KEPT (the player stands the same way as in the menu); `recalibrate` starts it over. */
  reset(recalibrate = false): void {
    this.gasSm = this.brakeSm = this.steerSm = 0;
    this.reverse = false;
    this.holdT = 0;
    this.gearArmed = true;
    this.steerTarget = 0;
    this.handsLostT = 0;
    this.lwSeen = this.rwSeen = false;
    if (recalibrate) this.legs.reset();
    this.hand.reset();
  }

  /**
   * @param speed signed forward speed of the car (m/s), needed for the reverse-gear timing
   * @param H stage height in px (hand velocity is measured in screen heights per second)
   */
  update(dt: number, body: BodyLike | null, keys: ReadonlySet<string>, pad: PadState | null, speed: number, H: number, out: Controls): Controls {
    const c = this.cfg;
    let gas = 0;
    let brake = 0;
    let steer = 0;
    let hb = false;
    out.camToggle = false;
    out.gearEdge = false;
    out.source = "body";
    out.legsOk = false;
    out.handsOk = false;
    out.legsReady = this.legs.ready;
    out.legsCalib = this.legs.calib;
    out.legsSitting = false;
    out.gasRaw = out.brakeRaw = 0;
    out.okGas = out.okBrake = false;
    out.gasThr = this.legs.gasThr || 0.14;
    out.brakeThr = this.legs.brakeThr || 0.14;

    if (body && body.present) {
      const L = body.lm;
      const lg = this.legs;
      lg.update(L, body.scale, dt);
      gas = lg.gas;
      brake = lg.brake;
      out.legsOk = lg.ok;
      out.legsReady = lg.ready;
      out.legsCalib = lg.calib;
      out.legsSitting = lg.sitting;
      out.gasRaw = lg.gasRaw;
      out.brakeRaw = lg.brakeRaw;
      out.gasThr = lg.gasThr;
      out.brakeThr = lg.brakeThr;
      out.okGas = lg.okR;
      out.okBrake = lg.okL;
      const lw = L[LEFT_WRIST];
      const rw = L[RIGHT_WRIST];
      // wheel: both wrists seen (sticky) and not on top of each other. A short loss holds the last angle, then the wheel
      // returns to the middle (never a stuck turn, never a jump to a noise angle)
      this.lwSeen = lw.v >= (this.lwSeen ? 0.25 : 0.4);
      this.rwSeen = rw.v >= (this.rwSeen ? 0.25 : 0.4);
      const sep = Math.abs(rw.x - lw.x) / Math.max(1, body.scale);
      if (this.lwSeen && this.rwSeen && sep >= c.steerMinSep) {
        out.handsOk = true;
        this.handsLostT = 0;
        const dx = rw.x - lw.x;
        const dy = rw.y - lw.y;
        // atan2 of the line from the left to the right wrist; mirrored stage: right hand lower = clockwise = steer right
        let a = (Math.atan2(dx < 0 ? -dy : dy, Math.abs(dx)) * 180) / Math.PI;
        a = Math.abs(a) < c.steerDeadDeg ? 0 : a - Math.sign(a) * c.steerDeadDeg;
        this.steerTarget = clamp(a / (c.steerFullDeg - c.steerDeadDeg), -1, 1);
      } else {
        this.handsLostT += dt;
        if (this.handsLostT > c.handsHoldSec) this.steerTarget *= Math.exp(-dt * c.handsCentreRate);
      }
      steer = this.steerTarget;
      // handbrake
      if (c.handbrake === "hand") {
        const side = this.opts.handbrakeSide;
        const w = side === "R" ? rw : lw;
        const o = side === "R" ? lw : rw;
        hb = this.hand.update(w.v > 0.4 ? w.y : null, o.v > 0.4 ? o.y : null, H, dt);
      } else if (c.handbrake === "knees") {
        hb = gas > 0.6 && brake > 0.6;
        if (hb) {
          gas = 0;
          brake = 0;
        }
      }
      // camera: both hands above the head (edge, with a cooldown)
      const up = body.gestures.handsAboveHead;
      if (up && !this.camPrev && this.camCooldown <= 0) {
        out.camToggle = true;
        this.camCooldown = c.cameraCooldownSec;
      }
      this.camPrev = up;
    } else {
      this.legs.absent(dt);
      this.steerTarget = 0;
      this.lwSeen = this.rwSeen = false;
    }
    this.camCooldown = Math.max(0, this.camCooldown - dt);

    // keyboard (letters are lower-case in engine.keys)
    let keyed = false;
    if (keys.has("ArrowUp") || keys.has("w")) {
      gas = 1;
      keyed = true;
    }
    if (keys.has("ArrowDown") || keys.has("s")) {
      brake = 1;
      keyed = true;
    }
    if (keys.has("ArrowLeft") || keys.has("a")) {
      steer = -1;
      keyed = true;
    } else if (keys.has("ArrowRight") || keys.has("d")) {
      steer = 1;
      keyed = true;
    }
    this.hbKeys = keys.has("Shift") || keys.has("b");
    if (this.hbKeys) {
      hb = true;
      keyed = true;
    }
    const camKey = keys.has("c");
    if (camKey && !this.keyCamPrev) out.camToggle = true;
    this.keyCamPrev = camKey;
    const revKey = keys.has("r");
    const revEdge = revKey && !this.keyRevPrev;
    this.keyRevPrev = revKey;
    if (keyed) out.source = "keys";

    out.gas = gas;
    out.brake = brake;
    out.steer = steer;
    out.handbrake = hb;
    if (pad && mapPad(pad, out)) {
      gas = out.gas;
      brake = out.brake;
      steer = out.steer;
      hb = out.handbrake;
    }

    // kids: automatic gas unless the brake is pressed
    if (this.opts.kids && brake < 0.2) gas = Math.max(gas, c.kidsGas);

    // reverse gear: brake held at a standstill for 1.5 s toggles D <-> R
    if (Math.abs(speed) < c.reverseMaxSpeed && brake > 0.5 && gas < 0.3) {
      this.holdT += dt;
      if (this.holdT >= c.reverseHoldSec && this.gearArmed) {
        this.reverse = !this.reverse;
        this.gearArmed = false;
        out.gearEdge = true;
      }
    } else {
      this.holdT = 0;
      if (brake < 0.3) this.gearArmed = true;
    }
    if (revEdge) {
      this.reverse = !this.reverse;
      out.gearEdge = true;
    }

    // smoothing (the prototype's per-frame lerps converted to rates)
    // (releasing a pedal is faster than pressing it: a lost leg must stop the engine at once)
    this.gasSm += (gas - this.gasSm) * (1 - Math.exp(-c.gasSmooth * (gas < this.gasSm ? 1.8 : 1) * dt));
    this.brakeSm += (brake - this.brakeSm) * (1 - Math.exp(-c.brakeSmooth * (brake < this.brakeSm ? 1.8 : 1) * dt));
    this.steerSm += (steer - this.steerSm) * (1 - Math.exp(-c.steerSmooth * dt));
    out.gas = this.gasSm;
    out.brake = this.brakeSm;
    out.steer = this.steerSm;
    out.handbrake = hb;
    out.reverse = this.reverse;
    return out;
  }
}
