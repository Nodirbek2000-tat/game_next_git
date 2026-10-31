// One angler: the cast -> wait -> nibble -> bite -> strike -> fight -> land flow, the float (buoyancy), the line (Verlet)
// and the rod. The game (BaliqRig) owns the shared world and calls update() while playing and render() every frame.

import * as THREE from "three";
import type { EngineApi } from "@/engine";
import { castPos, fillTrail, newCastPlan, planCast, RodWhip } from "./cast";
import { AnglerGestures, emptyInput, type AnglerSignals } from "./gestures";
import { AState, type Bait, type FishSim } from "./fishai";
import type { Ripples, Splashes } from "./effects";
import type { FishViews } from "./fishViews";
import type { LocationConfig, TimeOfDayPreset, WeatherState } from "./locations";
import { LineRibbon, makeAnglerGeometry, makeArmsGeometry, makeFloatGeometry, RodMesh, RodModel } from "./rod";
import {
  castDistance, castYaw, clamp, emptyTally, FightModel, lerp, lineInDanger, strikeWindow, TUNING, type FightEvent, type GameMode, type PlayerTally, type Tuning,
} from "./rules";
import { EYE } from "./view";
import type { GameSfx } from "./sfx";
import { SPECIES, type Rng, type SpeciesDef } from "./species";
import { VerletLine } from "./verlet";
import { FishViews as FV } from "./fishViews";
import type { CatchRecord } from "./collection";

/** kids: the game strikes this long after the bite (s), and reels at least this fast (circles/s) while the line is not red */
const KIDS_AUTO_STRIKE = 0.8;
const KIDS_ASSIST_CRANK = 0.4;

export type AnglerState = "ready" | "fly" | "wait" | "nibble" | "bite" | "fight" | "show";

export interface Host {
  engine: EngineApi;
  mode: GameMode;
  tuning: Tuning;
  weather: WeatherState;
  preset: TimeOfDayPreset;
  loc: LocationConfig;
  /** visual clock (s) */
  t: number;
  rng: Rng;
  waveAmp: number;
  sim: FishSim;
  views: FishViews;
  ripples: Ripples;
  splashes: Splashes;
  sfx: GameSfx;
  camera: THREE.Camera;
  /** gestures are processed (false in the lobby / end screens) */
  acceptInput: boolean;
  /** first-person view direction (rad, + = to the right) */
  viewYaw: number;
  force: string | null;
  waitScale: number;
  /** longest cast (m); tests shorten it */
  maxCast: number;
  particleScale: number;
  anglers: Angler[];
  water(x: number, z: number): number;
  depthAt(x: number, z: number): number;
  say(a: Angler, text: string, ms?: number): void;
  caught(a: Angler, sp: SpeciesDef, weight: number, friend: boolean): { pts: number; rec: CatchRecord };
  pickFor(depth: number): SpeciesDef;
  rollW(sp: SpeciesDef): number;
  recycle(agentIdx: number): void;
  /** compile the shaders of an object that is not in the scene yet, in the background (resolves when it can be shown without a stall) */
  warm?(o: THREE.Object3D): Promise<void>;
}

/** the cast swing (s, rad): back-load until t1, forward snap until t2, settle until T */
const CAST_ANIM = { t1: 0.11, t2: 0.25, T: 0.95, back: 1.35, low: 0.08 };
const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);
const easeIn = (u: number): number => u * u * u;
const smoothstep = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

export class Angler {
  state: AnglerState = "ready";
  stT = 0;
  readonly input = emptyInput();
  readonly gest = new AnglerGestures();
  sig: AnglerSignals = this.gest.out;
  readonly rod = new RodMesh();
  readonly ribbon: LineRibbon;
  readonly line: VerletLine;
  readonly body: THREE.Mesh;
  /** the player's own arms (first person): attached to the view, not to the world */
  readonly arms: THREE.Mesh;
  readonly floatMesh: THREE.Mesh;
  readonly whip = new RodWhip();
  /** sideways offset of the grip from the eye (m) */
  readonly gripOff: number;
  /** sideways offset of the anchor (two players stand apart) */
  readonly anchorOff: number;
  private trailX: Float32Array;
  private trailY: Float32Array;
  private trailZ: Float32Array;
  readonly tally: PlayerTally = emptyTally();
  /** grip position */
  gx: number;
  gy = 1.85;
  gz = 4.4;
  /** float */
  fx = 0;
  fy = 0;
  fz = 0;
  fvy = 0;
  /** extra sinking of the float (m) */
  dip = 0;
  private dipT = 0;
  castDir = 0;
  /** horizontal distance float <-> grip */
  D = 0;
  private plan = newCastPlan();
  private flyPos = { x: 0, y: 0, z: 0 };
  /** length of the line that trailed the float in the air (m), the extra slack that falls on the water at landing */
  private trailLen = 0;
  private slack = 0;
  private slackT = 0;
  /** previous jump state (splash when the fish falls back) */
  private wasJumping = false;
  private thrash = false;
  private thrashAt = 0;
  /** auto strike (kids) fired for this bite */
  autoStruck = false;
  fight: FightModel | null = null;
  agent = -1;
  sp: SpeciesDef | null = null;
  weight = 0;
  /** smoothed strain 0..~1.3 (relative to the break limit) */
  strain = 0;
  reelAngle = 0;
  rodYaw = 0;
  rodPitch = 0.45;
  private bend = 0.05;
  private bendYaw = 0;
  msg = "";
  msgT = 0;
  lost = 0;
  /** the partner may use the landing net on my fish */
  netOffer = false;
  /** last catch shown on the card */
  card: { name: string; weight: number; pts: number; msg: string; isNew: boolean; isRecord: boolean; friend: boolean } | null = null;
  readonly bait: Bait = { active: false, x: 0, z: 0, hookDepth: 0.8, disturb: 0 };
  private visitorIn = 0;
  private visitorSent = false;
  private biteT = 0;
  private lastLostAt = -9;
  dangerWarned = false;
  /** a friend landed my fish with the net */
  helpedBy = -1;
  private showFrom = new THREE.Vector3();
  private showTo = new THREE.Vector3();
  private grip = new THREE.Vector3();
  private clickAcc = 0;
  private tipHand = new THREE.Vector3();
  /** pose animations: time since the cast / the strike, the rod pitch when the cast started */
  private castAnimT = 99;
  /** reeling in an empty line: eased speed (m/s) */
  private retrieveV = 0;
  /** in "ready": the float hangs under the tip (after the first cast) */
  private floatShown = false;
  private castFrom = 0.5;
  /** the rod pitch the forward snap of the cast animation starts from, and how much of the hand load-up it shows (a real stroke already did it) */
  private castBack = CAST_ANIM.back;
  private castLoad = 1;
  /** where the rod hand is against its neutral, -1 .. 1 (steers the fish) */
  steer = 0;
  private strikeT = 99;
  private lefty: boolean;
  private disposed = false;

  constructor(
    readonly slot: number,
    readonly color: number,
    gx: number,
    private host: Host,
    group: THREE.Group,
  ) {
    const lefty = host.engine.players[slot]?.dominant === "L";
    this.lefty = lefty;
    this.gx = EYE.x + gx;
    this.gy = EYE.y - EYE.gripDown;
    this.gz = EYE.z - EYE.gripFwd;
    this.gripOff = gx + (lefty ? -1 : 1) * EYE.gripSide;
    this.anchorOff = gx;
    this.line = new VerletLine({ segments: host.engine.quality.level === "low" ? 20 : 30 });
    this.ribbon = new LineRibbon(this.line.n);
    this.trailX = new Float32Array(this.line.n);
    this.trailY = new Float32Array(this.line.n);
    this.trailZ = new Float32Array(this.line.n);
    // the old third-person figure stays in the code (an asset can still replace it) but is not drawn: we see through its eyes
    this.body = new THREE.Mesh(makeAnglerGeometry(color), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    this.body.visible = false;
    this.arms = new THREE.Mesh(makeArmsGeometry(color, lefty), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    this.arms.frustumCulled = false;
    // no first-person hands: only the rod is drawn
    this.arms.visible = false;
    this.arms.layers.set(3);
    // a bright, big float is easy to find (also for small children)
    this.floatMesh = new THREE.Mesh(makeFloatGeometry(color), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: color, emissiveIntensity: 0.35 }));
    this.floatMesh.visible = false;
    this.floatMesh.layers.set(3);
    this.body.layers.set(0);
    group.add(this.body, this.arms, this.rod.group, this.ribbon.mesh, this.floatMesh);
    this.line.surface = (x, z) => host.water(x, z);
    this.resetRoundVisuals();
    // the Blender rod set with the player's hands and sleeves replaces the procedural reel / arms
    this.rod.mirror = lefty;
    void RodModel.load(color).then(async (m) => {
      if (!m || this.disposed) return;
      await host.warm?.(m.group);
      if (!this.disposed) this.rod.useModel(m);
    });
  }

  get fighting(): boolean {
    return this.state === "fight";
  }

  private resetRoundVisuals(): void {
    this.setState("ready");
    this.fight = null;
    this.floatMesh.visible = false;
    this.floatShown = false;
    this.bait.active = false;
    this.gest.reset();
    this.tipHand.set(this.gx, this.gy + 1.2, this.gz - 2);
    this.line.reset(this.gx, this.gy + 1.4, this.gz - 2.5, this.gx, this.gy + 0.5, this.gz - 2.6);
    this.line.length = 1.2;
    this.whip.reset();
    this.slack = 0;
    this.autoStruck = false;
  }

  setState(s: AnglerState): void {
    this.state = s;
    this.stT = 0;
    this.gest.cast.reset();
    this.gest.strike.reset();
  }

  say(text: string, ms = 1600): void {
    this.msg = text;
    this.msgT = ms / 1000;
  }

  /** Back to the start (new round). */
  reset(): void {
    this.tally.score = this.tally.kg = this.tally.count = this.tally.best = this.tally.lost = 0;
    this.lost = 0;
    this.releaseFish();
    this.card = null;
    this.msg = "";
    this.resetRoundVisuals();
  }

  private releaseFish(): void {
    if (this.agent >= 0) {
      const a = this.host.sim.agents[this.agent];
      if (a.state === AState.Hooked || a.visitor) this.host.recycle(this.agent);
      this.hideHeld();
      this.agent = -1;
    }
    this.sp = null;
  }

  private hideHeld(): void {
    if (this.agent >= 0) this.host.views.meshes[this.agent].visible = this.host.sim.agents[this.agent].active && this.host.sim.agents[this.agent].state !== AState.Hooked;
    this.host.views.boots[this.slot].visible = false;
    this.host.views.bottles[this.slot].visible = false;
  }

  // ------------------------------------------------------------------ game logic (while playing)

  update(dt: number): void {
    const h = this.host;
    const wantCast = this.state === "ready" && h.acceptInput;
    const wantStrike = (this.state === "wait" || this.state === "nibble" || this.state === "bite") && h.acceptInput;
    if (!h.acceptInput) this.input.keySwing = this.input.keyNet = false;
    this.sig = this.gest.update(dt, this.input, h.tuning, wantCast, wantStrike);
    this.stT += dt;
    this.msgT -= dt;
    this.bait.disturb = Math.max(this.bait.disturb, 0);
    // reeling noise; the drawn handle turns with the real speed and direction of the hand
    this.reelAngle += this.sig.spin * TUNING.reel.visualSign * Math.PI * 2 * dt;
    this.clickAcc += this.sig.crank * dt * 3;
    if (this.clickAcc >= 1) {
      this.clickAcc = 0;
      if (this.sig.crank > 0.3 && this.state !== "ready") h.sfx.reelTick();
    }
    if (this.dipT > 0) this.dipT = Math.max(0, this.dipT - dt);

    switch (this.state) {
      case "ready":
        if (this.sig.cast) this.cast(this.sig.castPower, this.sig.castAim, this.sig.castHand);
        break;
      case "fly": {
        castPos(this.plan, this.stT, this.flyPos);
        this.fx = this.flyPos.x;
        this.fy = this.flyPos.y;
        this.fz = this.flyPos.z;
        this.fvy = 0;
        if (this.stT >= this.plan.T) this.land();
        break;
      }
      case "wait":
      case "nibble":
      case "bite":
        this.updateWaiting(dt);
        break;
      case "fight":
        this.updateFight(dt);
        break;
      case "show":
        this.updateShow();
        break;
    }
    this.updateDistance();
  }

  private updateDistance(): void {
    this.D = Math.hypot(this.fx - this.gx, this.fz - this.gz);
  }

  /** `power` 0..1 (arm speed), `aim`: hand offset during the stroke, `viaHand`: a real arm stroke (the hand already loaded the rod) */
  private cast(power: number, aim: number, viaHand: boolean): void {
    const h = this.host;
    // the arm decides the side relative to where the player looks
    this.castDir = h.viewYaw + castYaw(Number.isFinite(aim) ? aim : 0);
    let D = castDistance(power, h.tuning.kids, h.maxCast);
    // never land on the shore: shorten until there is enough water
    for (let k = 0; k < 8; k++) {
      const x = this.gx + Math.sin(this.castDir) * D;
      const z = this.gz - Math.cos(this.castDir) * D;
      if (h.depthAt(x, z) > 0.7) break;
      D *= 0.85;
    }
    D = Math.max(D, 5);
    const tx = this.gx + Math.sin(this.castDir) * D + (h.rng() - 0.5) * 0.6;
    const tz = this.gz - Math.cos(this.castDir) * D + (h.rng() - 0.5) * 0.6;
    const tip = this.rod.tip;
    planCast(tip.x, tip.y, tip.z, tx, tz, h.water(tx, tz), power, this.plan);
    this.D = D;
    this.fx = tip.x;
    this.fy = tip.y;
    this.fz = tip.z;
    this.floatMesh.visible = true;
    this.setState("fly");
    this.whip.trigger(power);
    // a real stroke already loaded the rod and moved the hands: the animation starts at the forward snap from the live pose
    this.castAnimT = viaHand ? CAST_ANIM.t1 : 0;
    this.castFrom = this.rodPitch;
    this.castBack = viaHand ? this.rodPitch : Math.max(this.rodPitch, CAST_ANIM.back);
    this.castLoad = viaHand ? 0.25 : 1;
    this.trailLen = 0;
    h.engine.audio.whoosh(0.25 + power * 0.5);
    h.say(this, `Tashlandi! ${Math.round(D)} m`, 1200);
  }

  private land(): void {
    const h = this.host;
    this.fx = this.plan.tx;
    this.fz = this.plan.tz;
    this.fy = h.water(this.fx, this.fz);
    this.fvy = -2.2;
    // the line that was in the air falls on the water as slack and then tightens
    const span = Math.hypot(this.fx - this.rod.tip.x, this.fz - this.rod.tip.z);
    this.slack = Math.max(0, this.trailLen - span * 1.035);
    this.slackT = 0;
    this.setState("wait");
    h.sfx.splash(true);
    h.ripples.addAt(this.fx, this.fz, 1.5, 1.9);
    h.ripples.addAt(this.fx, this.fz, 0.8, 1.3);
    h.splashes.burst(this.fx, this.fy, this.fz, 24, 1, h.particleScale);
    h.sim.scare(this.fx, this.fz, 2.5);
    const dep = h.depthAt(this.fx, this.fz);
    this.bait.active = true;
    this.bait.x = this.fx;
    this.bait.z = this.fz;
    this.bait.hookDepth = clamp(dep * 0.55, 0.4, 2.2);
    this.bait.disturb = 0.5;
    this.scheduleVisitor();
    h.say(this, "Kuting… poplavokni kuzating", 2200);
  }

  private scheduleVisitor(): void {
    const h = this.host;
    const kids = h.tuning.kids;
    const base = (kids ? 1.2 : 2) + h.rng() * (kids ? 2 : 3.5);
    this.visitorIn = (base / Math.max(0.5, h.preset.activity * (h.weather.rain ? 1.2 : 1))) * h.waitScale;
    this.visitorSent = false;
  }

  private updateWaiting(dt: number): void {
    const h = this.host;
    const s = this.sig;
    // the current / wind slowly moves the float
    this.fx += (h.loc.current.x + h.weather.wind * 0.03) * dt;
    this.fz += h.loc.current.z * dt;
    this.bait.x = this.fx;
    this.bait.z = this.fz;
    // reeling in to re-cast
    this.retrieveV = lerp(this.retrieveV, s.crank > 0.5 && this.state !== "bite" ? s.crank * 0.75 : 0, 1 - Math.exp(-dt * 3));
    if (this.retrieveV > 0.05) {
      const d = Math.hypot(this.fx - this.gx, this.fz - this.gz);
      const nd = Math.max(0, d - this.retrieveV * dt);
      const k = d > 1e-3 ? nd / d : 0;
      this.fx = this.gx + (this.fx - this.gx) * k;
      this.fz = this.gz + (this.fz - this.gz) * k;
      this.bait.x = this.fx;
      this.bait.z = this.fz;
      this.bait.disturb = Math.min(1, this.bait.disturb + s.crank * dt * 0.7);
      if (nd < 3) {
        this.reelBack();
        return;
      }
    }
    if (this.state === "wait") {
      if (!this.visitorSent) {
        this.visitorIn -= dt;
        if (this.visitorIn <= 0) this.sendVisitor();
      }
      if (s.strike && this.stT > 0.6) {
        h.say(this, "Hali erta! Baliq yo‘q edi", 1400);
        this.stT = 0;
      }
    } else if (this.state === "nibble") {
      const dip = this.dipT > 0 ? Math.sin((1 - this.dipT / 0.35) * Math.PI) * 0.13 : 0;
      this.dip = dip;
      if (s.strike) this.scareVisitor("Erta tortdingiz — baliq qo‘rqib ketdi");
    } else {
      // bite: the float dives; you have a short window
      this.dip = 0.5;
      this.biteT += dt;
      // kids: the game strikes for them a moment after the bite (a small child cannot flick that fast)
      const auto = h.tuning.kids && this.biteT > KIDS_AUTO_STRIKE;
      if (s.strike || auto) {
        this.autoStruck = auto && !s.strike;
        this.hook();
      }
      else if (this.biteT > strikeWindow(h.tuning.kids)) {
        this.lost++;
        this.tally.lost++;
        const a = this.agent >= 0 ? h.sim.agents[this.agent] : null;
        if (a) h.sim.dismiss(a);
        this.agent = -1;
        this.sp = null;
        this.bait.active = false;
        this.dip = 0;
        h.say(this, "Kech qoldingiz — baliq xo‘rakni yeb ketdi", 2000);
        h.engine.audio.bad();
        this.strikeT = 0;
        this.reelBack(true);
      }
    }
    if (this.state === "wait") this.dip = 0;
  }

  private sendVisitor(): void {
    const h = this.host;
    this.visitorSent = true;
    const dep = h.depthAt(this.fx, this.fz);
    const sp = h.pickFor(dep);
    const w = h.rollW(sp);
    const idx = SPECIES.indexOf(sp);
    const a = h.sim.sendVisitor(this.slot, this.bait, idx, w, !!sp.junk);
    if (!a) {
      this.visitorSent = false;
      this.visitorIn = 1;
      return;
    }
    this.agent = h.sim.agents.indexOf(a);
    this.sp = sp;
    this.weight = w;
    h.views.setSpecies(this.agent, sp);
  }

  /** FishSim events for this angler's visitor. */
  onNibble(): void {
    if (this.state !== "wait" && this.state !== "nibble") return;
    const h = this.host;
    if (this.state === "wait") this.setState("nibble");
    this.dipT = 0.35;
    h.engine.audio.plop();
    h.ripples.addAt(this.fx, this.fz, 0.6, 0.8);
  }

  onBite(): void {
    if (this.state !== "nibble" && this.state !== "wait") return;
    const h = this.host;
    this.setState("bite");
    this.biteT = 0;
    h.sfx.splash(false);
    h.ripples.addAt(this.fx, this.fz, 1.2, 1);
    h.splashes.burst(this.fx, this.fy, this.fz, 8, 0.6, h.particleScale);
    h.say(this, "HOZIR! Qarmoqni tepaga torting!", 1200);
  }

  private scareVisitor(text: string): void {
    const h = this.host;
    if (this.agent >= 0) h.sim.scareAgent(h.sim.agents[this.agent]);
    this.agent = -1;
    this.sp = null;
    this.setState("wait");
    this.dip = 0;
    this.scheduleVisitor();
    this.visitorIn += 2;
    h.say(this, text, 1800);
    h.engine.audio.bad();
  }

  private reelBack(missed = false): void {
    this.setState("ready");
    this.floatShown = true;
    this.bait.active = false;
    this.dip = 0;
    if (!missed) this.say("Qarmoq qaytdi — qaytadan tashlang", 1600);
    if (this.agent >= 0) {
      const a = this.host.sim.agents[this.agent];
      if (a.visitor) this.host.sim.dismiss(a);
      this.agent = -1;
      this.sp = null;
    }
  }

  private hook(): void {
    const h = this.host;
    const sp = this.sp;
    const a = this.agent >= 0 ? h.sim.agents[this.agent] : null;
    if (!sp || !a) return;
    this.updateDistance();
    this.wasJumping = false;
    this.fight = new FightModel({ species: sp, weight: this.weight, startD: Math.max(this.D, 7), kids: h.tuning.kids, rng: h.rng });
    this.castDir = Math.atan2(this.fx - this.gx, -(this.fz - this.gz));
    h.sim.hook(a);
    this.whip.jerk(TUNING.strike.jerk);
    this.dip = 0;
    this.strain = 0.3;
    this.setState("fight");
    this.strikeT = 0;
    this.netOffer = false;
    h.sfx.splash(true);
    h.engine.fx.shake(8, 0.25);
    h.splashes.burst(this.fx, this.fy, this.fz, 26, 1.2, h.particleScale);
    h.say(this, "ILINDI! Chap qo‘l bilan aylantiring!", 1800);
    if (sp.junk) {
      const m = sp.junk === "boot" ? h.views.boots[this.slot] : h.views.bottles[this.slot];
      m.visible = true;
      h.views.meshes[this.agent].visible = false;
    }
  }

  private updateFight(dt: number): void {
    const h = this.host;
    const f = this.fight;
    const sp = this.sp;
    if (!f || !sp) return;
    const s = this.sig;
    const assist = h.tuning.kids && this.strain < 0.75 ? KIDS_ASSIST_CRANK : 0;
    this.steer = s.steer;
    const ev: FightEvent = f.step(dt, { crank: Math.max(s.crank, assist), pump: s.pumpLift, reelMul: s.pumpLower, side: s.steer });
    this.strain = lerp(this.strain, f.strain, 1 - Math.exp(-dt * 10));
    if (f.ranNow) {
      h.sfx.splash(false);
      h.ripples.addAt(this.fx, this.fz, 0.8, 0.9);
    }
    if (f.surged) {
      // the fish surges to its side: a splash where the line cuts the water
      h.sfx.splash(false);
      h.splashes.burst(this.fx, this.fy, this.fz, Math.round(8 + 10 * f.big), 0.7 + 0.5 * f.big, h.particleScale);
      h.ripples.addAt(this.fx, this.fz, 0.9, 1);
    }
    if (f.jumped) {
      h.sfx.splash(true);
      h.splashes.burst(this.fx, this.fy, this.fz, 18, 1.1, h.particleScale);
      h.engine.fx.shake(4, 0.15);
    }
    // the fish falls back into the water
    const jumping = f.jumpT > 0;
    if (this.wasJumping && !jumping) {
      h.sfx.splash(true);
      h.splashes.burst(this.fx, this.fy, this.fz, 22, 1.2, h.particleScale);
      h.ripples.addAt(this.fx, this.fz, 1.2, 1.2);
    }
    this.wasJumping = jumping;
    if (f.strain > 0.85 && h.rng() < dt * 3) h.sfx.setStrain(f.strain);
    // float + fish follow the fight model
    const dx = Math.sin(this.castDir);
    const dz = -Math.cos(this.castDir);
    this.fx = this.gx + dx * f.D + -dz * f.lat;
    this.fz = this.gz + dz * f.D + dx * f.lat;
    this.fy = h.water(this.fx, this.fz);
    this.bait.x = this.fx;
    this.bait.z = this.fz;
    this.dip = 0.18 + f.T * 0.12;
    this.netOffer = f.D <= TUNING.fight.netDist;
    if (f.run && h.rng() < dt * 8) h.ripples.addAt(this.fx, this.fz, 0.7, 0.7);
    if (ev === "land") this.finishCatch(false);
    else if (ev === "break") this.loseFish("Ip uzildi! Taranglik qizil bo‘lganda aylantirmang");
    else if (ev === "escape") this.loseFish("Baliq qochib ketdi…");
    this.dangerWarned = lineInDanger(this.strain);
  }

  private loseFish(text: string): void {
    const h = this.host;
    this.lost++;
    this.tally.lost++;
    this.fight = null;
    this.strain = 0;
    this.netOffer = false;
    this.bait.active = false;
    this.floatMesh.visible = false;
    this.floatShown = false;
    h.engine.fx.shake(6, 0.2);
    h.engine.audio.bad();
    h.say(this, text, 2400);
    this.releaseFish();
    this.setState("ready");
  }

  /** The fish is in the net / on the bridge. `friend` = the partner's net landed it. */
  finishCatch(friend: boolean): void {
    const h = this.host;
    const sp = this.sp;
    if (!sp || this.state !== "fight") return;
    const c = h.caught(this, sp, this.weight, friend);
    this.card = { name: sp.name, weight: this.weight, pts: c.pts, msg: sp.msg ?? "", isNew: c.rec.isNew, isRecord: c.rec.isRecord, friend };
    this.fight = null;
    this.netOffer = false;
    this.strain = 0;
    this.bait.active = false;
    this.floatMesh.visible = false;
    this.showFrom.set(this.fx, this.fy, this.fz);
    // the caught fish is shown above the water in front of the camera
    if (sp.junk) {
      const m = sp.junk === "boot" ? h.views.boots[this.slot] : h.views.bottles[this.slot];
      m.visible = true;
      FV.setAbove(m, true);
    } else if (this.agent >= 0) {
      const m = h.views.meshes[this.agent];
      m.visible = true;
      FV.setAbove(m, true);
    }
    this.setState("show");
    h.sfx.splash(true);
    h.engine.audio.win();
    h.splashes.burst(this.fx, this.fy, this.fz, 30, 1.2, h.particleScale);
  }

  private updateShow(): void {
    if (this.stT > 4.0) {
      this.releaseFish();
      this.setState("ready");
      this.floatShown = true;
      this.say("Yana tashlang!", 1500);
    }
  }

  // ------------------------------------------------------------------ visuals (every frame)

  /** Where the displayed (caught) object sits at the moment. */
  private heldObject(): THREE.Object3D | null {
    const sp = this.sp;
    if (!sp) return null;
    if (sp.junk) return sp.junk === "boot" ? this.host.views.boots[this.slot] : this.host.views.bottles[this.slot];
    return this.agent >= 0 ? this.host.views.meshes[this.agent] : null;
  }

  render(dt: number): void {
    const h = this.host;
    const t = h.t;
    const cam = h.camera;
    // ---- pose animation: offsets of the hands (view frame: y up, z back) and of the rod pitch
    this.castAnimT += dt;
    this.strikeT += dt;
    let offY = Math.sin(t * 1.7 + this.slot) * 0.004;
    let offZ = Math.sin(t * 1.1 + this.slot) * 0.003;
    let dPitch = 0;
    let castPitch: number | null = null;
    const ct = this.castAnimT;
    if (ct < CAST_ANIM.T) {
      // load the rod back over the shoulder, snap it forward (the line goes), follow through and settle
      const back = this.castBack;
      const L = this.castLoad;
      if (ct < CAST_ANIM.t1) {
        const u = easeOut(ct / CAST_ANIM.t1);
        castPitch = lerp(this.castFrom, back, u);
        offY += 0.07 * u;
        offZ += 0.06 * u;
      } else if (ct < CAST_ANIM.t2) {
        const u = easeIn((ct - CAST_ANIM.t1) / (CAST_ANIM.t2 - CAST_ANIM.t1));
        castPitch = lerp(back, CAST_ANIM.low, u);
        offY += lerp(0.07 * L, -0.06, u);
        offZ += lerp(0.06 * L, -0.17, u);
      } else {
        const u = smoothstep((ct - CAST_ANIM.t2) / (CAST_ANIM.T - CAST_ANIM.t2));
        castPitch = lerp(CAST_ANIM.low, (20 * Math.PI) / 180, u);
        offY += lerp(-0.06, 0, u);
        offZ += lerp(-0.17, 0, u);
      }
    }
    if (this.strikeT < 0.55) {
      // the strike: a short hard lift of the rod and both hands towards the chest, then into the fight
      const u = this.strikeT / 0.55;
      const b = u < 0.2 ? easeOut(u / 0.2) : 1 - smoothstep((u - 0.2) / 0.8);
      dPitch += 0.62 * b;
      offY += 0.06 * b;
      offZ += 0.09 * b;
    }
    // ---- grip: in the view frame, in front of the eye (the arms are drawn there too)
    this.grip.set(this.gripOff, -EYE.gripDown + offY, -EYE.gripFwd + offZ).applyQuaternion(cam.quaternion).add(cam.position);
    this.arms.quaternion.copy(cam.quaternion);
    this.arms.position.set(cam.position.x + Math.cos(h.viewYaw) * this.anchorOff, cam.position.y, cam.position.z + Math.sin(h.viewYaw) * this.anchorOff);
    const gx = this.grip.x;
    const gy = this.grip.y;
    const gz = this.grip.z;

    // ---- rod pose
    const toFloat = this.state === "wait" || this.state === "nibble" || this.state === "bite" || this.state === "fight" || this.state === "fly";
    const fighting = this.state === "fight";
    let yaw = h.viewYaw + (this.sig.yawDeg * Math.PI) / 180;
    if (toFloat) {
      const dir = Math.atan2(this.fx - gx, -(this.fz - gz));
      yaw = lerp(yaw, dir, this.state === "fly" ? 0.5 : 0.85);
    }
    this.rodYaw = lerp(this.rodYaw, yaw, 1 - Math.exp(-dt * 14));
    // the hand height sets the pitch; waiting the tip points down at the float, fighting the rod stands up
    let pitchDeg = clamp(this.sig.pitch, 8, 70);
    if (this.state === "wait" || this.state === "nibble" || this.state === "bite") pitchDeg = lerp(pitchDeg, 20, 0.7);
    else if (fighting) pitchDeg = lerp(pitchDeg, 42, 0.55);
    this.rodPitch = castPitch ?? lerp(this.rodPitch, (pitchDeg * Math.PI) / 180, 1 - Math.exp(-dt * 14));
    const f = this.fight;
    const T = clamp(f?.T ?? 0, 0, 1.3);
    // the bend settles where the load wants it; the cast whip rings on top of it
    // ready: the rod lags behind the arm, so it bends back while the hand swings down and springs forward when the hand stops
    const armBend = this.state === "ready" ? clamp(-this.sig.armV * TUNING.cast.bendGain, -0.8, 0.25) : 0;
    const bendT = fighting ? 0.25 + T * 0.9 : toFloat && this.state !== "fly" ? 0.12 : 0.03 + armBend;
    this.whip.step(dt, bendT, this.whip.age < 1.4 ? 0.14 : 0.45);
    this.bend = this.whip.bend;
    // towards where the fish pulls: the tip is dragged sideways
    this.bendYaw = lerp(this.bendYaw, fighting && f ? clamp(f.ang * 1.3, -0.55, 0.55) * clamp(T, 0.35, 1) : 0, 1 - Math.exp(-dt * 6));
    this.rod.update(gx, gy, gz, this.rodYaw, this.rodPitch + dPitch + this.whip.kick * (castPitch === null ? 1 : 0.3), this.bend, this.bendYaw, this.reelAngle);
    this.rod.fixNormals();

    // ---- float buoyancy (spring towards the water level minus the dip)
    if (this.state === "ready") {
      // the float hangs under the tip; after a reel-back it swings in from where it was (no jump)
      const kk = 1 - Math.exp(-dt * 3.5);
      this.fx = lerp(this.fx, this.rod.tip.x, kk);
      this.fz = lerp(this.fz, this.rod.tip.z, kk);
      this.fy = lerp(this.fy, this.rod.tip.y - 0.9, kk);
    } else if (this.state !== "fly" && this.state !== "show") {
      const w = h.water(this.fx, this.fz);
      const target = w + 0.03 - this.dip;
      const k = fighting ? 40 : 90;
      this.fvy += (k * (target - this.fy) - 9 * this.fvy) * dt;
      this.fy += this.fvy * dt;
    }
    this.floatMesh.visible = this.state !== "show" && (this.state !== "ready" || this.floatShown);
    this.floatMesh.position.set(this.fx, this.fy, this.fz);
    // far away the float would be a speck: grow it with the distance to the camera (kids: bigger still)
    const far = Math.max(0, Math.hypot(this.fx - cam.position.x, this.fz - cam.position.z) - 6);
    this.floatMesh.scale.setScalar((1 + far * 0.09) * (h.tuning.kids ? 1.35 : 1));
    this.floatMesh.rotation.z = Math.sin(t * 2.3 + this.slot) * 0.08 + (fighting ? 0.3 : 0);
    this.floatMesh.rotation.x = this.state === "fly" ? this.stT * 9 : 0;

    // ---- line
    const tip = this.rod.tip;
    let ex = this.fx;
    let ey = this.fy + 0.02;
    let ez = this.fz;
    const span = Math.hypot(ex - tip.x, ey - tip.y, ez - tip.z);
    let len: number;
    let tremble = 0;
    this.slackT += dt;
    switch (this.state) {
      case "ready":
        // the line ends at the float while it swings in under the tip
        len = Math.max(1.25, span * 1.02);
        ex = this.fx + Math.sin(t * 1.3 + this.slot) * 0.05;
        ez = this.fz + Math.cos(t * 1.1) * 0.05;
        break;
      case "fly": {
        // the line trails behind the float along the path it has flown
        const n = this.line.n;
        this.trailLen = fillTrail(this.plan, Math.min(this.stT, this.plan.T), tip.x, tip.y, tip.z, this.trailX, this.trailY, this.trailZ, n);
        for (let i = 0; i < n; i++) this.line.setPoint(i, this.trailX[i], this.trailY[i], this.trailZ[i]);
        this.line.length = this.trailLen;
        len = -1;
        break;
      }
      case "fight":
        len = span * (1 + Math.max(0, 0.012 * (1 - this.strain)));
        tremble = clamp(this.strain, 0, 1.3) * (f?.run ? 1 : 0.4);
        break;
      case "show":
        len = 1.25;
        ex = tip.x;
        ey = tip.y - 0.9;
        ez = tip.z;
        break;
      default:
        len = span * (this.state === "bite" ? 1.015 : 1.035) + 0.05 + this.slack * Math.exp(-this.slackT * 2.2);
    }
    if (len >= 0) {
      this.line.driftX = h.weather.wind * 0.6;
      this.line.length = len;
      this.line.step(Math.min(dt, 0.033), tip.x, tip.y, tip.z, ex, ey, ez, tremble);
    }
    this.ribbon.update(this.line.x, this.line.y, this.line.z, cam);
    // line colour: white -> red with strain
    const red = clamp((this.strain - 0.55) / 0.45, 0, 1);
    this.ribbon.material.color.setRGB(0.95, 0.95 - red * 0.75, 0.95 - red * 0.8);
    this.ribbon.material.opacity = 0.75 + red * 0.25;

    // ---- the held fish / item
    this.renderHeld(dt);
  }

  private renderHeld(dt: number): void {
    const h = this.host;
    const sp = this.sp;
    if (!sp || this.agent < 0) return;
    const obj = this.heldObject();
    if (!obj) return;
    const f = this.fight;
    if (this.state === "fight" && f) {
      // the closer it comes, the nearer to the surface it swims; tired and close it thrashes on the surface
      const close = 1 - clamp((f.D - 2) / 8, 0, 1);
      let y = -0.3 - (f.run ? 0.1 : 0) + close * 0.2;
      let above = false;
      let roll = 0;
      if (f.jumpT > 0) {
        const k = 1 - f.jumpT / 0.75;
        const hgt = 0.5 + sp.power * 0.8 + (sp.len > 0.6 ? 0.2 : 0);
        y = 4 * hgt * k * (1 - k) - 0.1;
        above = y > 0.05;
        roll = (k - 0.5) * 2.4 * (f.runDir || 1);
      } else if (f.D < 4.5 && Math.sin(h.t * 7 + this.slot * 2) > 0.5) {
        y = 0.04;
        above = true;
        roll = Math.sin(h.t * 31) * 0.6;
        if (!this.thrash && h.t - this.thrashAt > 0.35) {
          this.thrashAt = h.t;
          h.splashes.burst(this.fx, this.fy, this.fz, 6, 0.6, h.particleScale);
          h.ripples.addAt(this.fx, this.fz, 0.5, 0.8);
        }
      }
      this.thrash = above && f.jumpT <= 0;
      obj.position.set(this.fx, h.water(this.fx, this.fz) + y, this.fz);
      // swims away from the rod, head towards the side it pulls to
      obj.rotation.set(0, Math.PI / 2 - (this.castDir + f.ang * 1.3), roll);
      (obj as THREE.Mesh).layers.set(above ? 0 : 2);
      if (above) (obj as THREE.Mesh).layers.enable(3);
      obj.scale.setScalar(this.fishScale(sp, this.weight));
      if (!sp.junk) h.views.animate(this.agent, sp, h.t * 14 + this.slot, clamp(0.3 + (f.run ? 0.7 : 0.2) * f.S, 0, 1));
    } else if (this.state === "show") {
      // lifted out of the water on the line, slowly, then held up
      const k = clamp(this.stT / 1.6, 0, 1);
      const e = k * k * (3 - 2 * k);
      // the catch is held up in front of the player's eyes
      const cp = h.camera.position;
      this.showTo.set(cp.x + Math.sin(h.viewYaw) * 2.6, cp.y - 0.3, cp.z - Math.cos(h.viewYaw) * 2.6);
      obj.position.lerpVectors(this.showFrom, this.showTo, e);
      obj.position.y += Math.sin(k * Math.PI) * 0.35;
      obj.rotation.set(0, -h.viewYaw + Math.sin(h.t * 1.4) * 0.5, Math.sin(h.t * 9) * 0.25 * (1 - k * 0.6));
      obj.scale.setScalar(this.fishScale(sp, this.weight) * (sp.junk ? 1.4 : 1.3));
      obj.visible = true;
      if (!sp.junk) h.views.animate(this.agent, sp, h.t * 18, 0.35 * (1 - k * 0.8));
    }
    void dt;
  }

  fishScale(sp: SpeciesDef, w: number): number {
    const mean = (sp.w[0] + sp.w[1]) / 2;
    return clamp(Math.cbrt(w / mean) * (sp.junk ? 1 : 1), 0.55, 1.9);
  }

  dispose(): void {
    this.disposed = true;
    this.floatMesh.geometry.dispose();
  }
}

