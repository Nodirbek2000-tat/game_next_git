import * as THREE from "three";
import { drawText } from "@/engine/fx/fx2d";
import { clamp, lerp, portraitFov, segPointDist } from "@/engine/math";
import { bottomLift } from "@/engine/ui/safe";
import type { EngineApi, QualityLevel } from "@/engine/types";
import { type AnimInput, PartnerAnim } from "./anim";
import { DefenseTracker, type DefenseInput, type PadLike, type Side, judgeDefense, resolvePunch } from "./combat";
import { CAM, GLOVE_S, GLOVE_Y0, LOD, type Lod, PAD_PLANE_Z, PARTNER_Z, ROUNDS, ROUND_SEC, effectiveLevel } from "./config";
import { Fight, type Attack, type Pad, type Phase } from "./fight";
import { PadViews, PlayerGloves } from "./gloves";
import { PartnerRig } from "./partner3d";
import { type HandSample, PunchDetector } from "./punch";
import { LEAN_M_PER_SW, type Px, type View, gloveToPx, newView, pxToWorld, worldToPx } from "./space";
import { Arena } from "./world";

export interface BoksProbe {
  snapshot(): {
    phase: Phase;
    state: string;
    round: number;
    health: number;
    stamina: number;
    enemyHealth: number;
    score: number;
    combo: number;
    lastSpeed: number;
    bestSpeed: number;
    hits: number;
    thrown: number;
    accuracy: number;
    dodges: number;
    blocks: number;
    taken: number;
    partner: { phase: string; down: number; attack: { active: boolean; kind: string; from: number; t: number } };
    pads: { id: number; side: Side; age: number; x: number; y: number; r: number }[];
    /** where the player's wrists have to be on the stage (px) to hold the glove on the pad; `guard` is the guard position */
    aim: { side: Side; x: number; y: number; guardX: number; guardY: number; r: number } | null;
    present: boolean;
    level: QualityLevel;
    crowd: number;
    shadows: boolean;
    post: boolean;
  };
}

const SIDES: Side[] = ["L", "R"];
const HIT_WORDS = ["ZARB!", "POW!", "BAM!", "BOOM!"];

interface Msg {
  text: string;
  sub: string;
  col: string;
  size: number;
  t: number;
  life: number;
}

interface Hand {
  /** the hand is tracked this frame */
  tracked: boolean;
  /** glove position on the stage (px) and last frame's */
  gx: number;
  gy: number;
  pgx: number;
  pgy: number;
  /** arm stretch 0..1 */
  ext: number;
  /** keyboard jab timer */
  jab: number;
  jabTo: { x: number; y: number };
}

const newHand = (): Hand => ({ tracked: false, gx: 0, gy: 0, pgx: 0, pgy: 0, ext: 0, jab: 0, jabTo: { x: 0, y: 0 } });

/**
 * Boks (slug "boks"): first-person boxing against a sparring partner built from simple shapes. Rounds, health and stamina;
 * pads the player punches with the matching hand (red = left, blue = right); the partner telegraphs his punches (wind-up)
 * and the player dodges with the head or blocks with both hands. The rules live in fight.ts / punch.ts / combat.ts (pure,
 * tested); this class connects them to the camera, the 3D scene, the sound and the 2D overlay.
 */
export class BoksGame {
  private scene: THREE.Scene;
  private saved: { bg: THREE.Scene["background"]; fog: THREE.Scene["fog"]; fov: number; near: number; far: number; pos: THREE.Vector3; quat: THREE.Quaternion; shadow: boolean };
  private built: QualityLevel;
  private lodLevel: QualityLevel | null = null;
  private lod: Lod;
  private alive = true;
  private t = 0;
  private clock = 0;
  private stage = 0;

  private arena: Arena;
  private rig: PartnerRig;
  private anim = new PartnerAnim();
  private gloves: PlayerGloves;
  private padViews: PadViews;
  private fight: Fight;
  private det: [PunchDetector, PunchDetector] = [new PunchDetector(), new PunchDetector()];
  private defTr = new DefenseTracker();
  private defIn: DefenseInput = { devXMax: 0, devXMin: 0, devY: 0, guard: 0 };
  private hands: [Hand, Hand] = [newHand(), newHand()];
  private view: View = newView();
  private base: View = newView();
  private padPx: Px[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, s: 1 }));
  private padLike: PadLike[] = [0, 1, 2, 3].map(() => ({ active: false, side: "L" as Side, age: 0, d: 1e9, r: 0 }));
  private animIn: AnimInput = {
    pad: [
      { on: false, x: 0, y: 0, z: 0, recoil: 0 },
      { on: false, x: 0, y: 0, z: 0, recoil: 0 },
    ],
    attack: { active: false, kind: "straight", from: 1, t: 0, windup: 0.7 },
    faceX: 0,
    faceY: CAM.y,
    faceZ: CAM.z - PARTNER_Z,
    down: false,
  };
  private tmpP = { x: 0, y: 0, z: 0 };
  private tmpPx: Px = { x: 0, y: 0, s: 1 };
  private tmpG = { x: 0, y: 0 };
  private sa = { x: 0, y: 0 };
  private sb = { x: 0, y: 0 };

  // player
  private present = false;
  private sw = 80;
  private leanX = 0;
  private leanY = 0;
  private kbDx = 0;
  private kbDy = 0;
  private kbPrev = { L: false, R: false };
  private kbGuard = false;
  private lastKmh = 0;
  private lastKmhT = -99;
  private hitsKb = 0;
  private playT = 0;

  // effects
  private shakeA = 0;
  private shakeT = 0;
  private camBump = 0;
  private msgs: Msg[] = [];
  private enemyDown = false;
  private overT = -1;
  private finished = false;
  private started = false;
  private lastSec = -1;
  private hudLast = { round: -1, score: -1, combo: -1, sec: -1, phase: "" };
  private hudDirty = true;
  private speedLine = "";
  private speedKey = -1;
  private warnFlash = 0;
  private hurtFlash = 0;

  private probe: BoksProbe;
  private shadowsOn = false;
  private crowdShare = 1;
  private crowdAnim = false;
  private roundSec: number;
  private compiling = false;

  constructor(
    private engine: EngineApi,
    private root: THREE.Group,
    private camera: THREE.PerspectiveCamera,
    private gl: THREE.WebGLRenderer,
  ) {
    const e = engine;
    let p: THREE.Object3D | null = root;
    while (p && !(p as THREE.Scene).isScene) p = p.parent;
    this.scene = (p as THREE.Scene) ?? new THREE.Scene();
    this.saved = {
      bg: this.scene.background,
      fog: this.scene.fog,
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      pos: camera.position.clone(),
      quat: camera.quaternion.clone(),
      shadow: gl.shadowMap.enabled,
    };
    this.built = e.quality.level;
    this.lod = LOD[this.built];
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = null;
    camera.fov = CAM.fov;
    camera.near = 0.08;
    camera.far = 60;
    camera.position.set(CAM.x, CAM.y, CAM.z);
    camera.quaternion.identity();
    camera.updateProjectionMatrix();
    this.shadowsOn = this.lod.shadows && e.quality.shadows;
    gl.shadowMap.enabled = this.shadowsOn;
    if (this.shadowsOn) gl.shadowMap.type = THREE.PCFShadowMap;

    // the round length can be shortened for tests: ?duration=12
    const dur = Number(e.query.get("duration"));
    this.roundSec = dur > 3 ? Math.min(600, dur) : ROUND_SEC;

    this.arena = new Arena(this.lod);
    this.rig = new PartnerRig(this.lod, this.shadowsOn);
    this.gloves = new PlayerGloves(this.lod);
    this.padViews = new PadViews(this.lod);
    root.add(this.arena.group, this.arena.lights, this.rig.group, this.padViews.group, this.gloves.group);

    this.fight = new Fight(
      { rounds: ROUNDS, roundSec: this.roundSec, kids: e.kids },
      {
        judge: (a) => this.judge(a),
        bell: (k) => this.bell(k),
        phase: (ph, r) => this.onPhase(ph, r),
        padSpawn: (pad) => this.onPadSpawn(pad),
        padExpire: (pad) => this.onPadExpire(pad),
        attackStart: (a) => this.onAttackStart(a),
        impact: (a, def, dmg, pts) => this.onImpact(a, def, dmg, pts),
        knockdown: (who) => this.onKnockdown(who),
        over: (o) => {
          this.overT = 0;
          this.padViews.hideAll();
          if (o !== "lost") this.msg("JANG TUGADI", "#ffd23f", 64, 1.8, o === "win" ? "G‘alaba nokaut bilan!" : "Natijalar hisoblanmoqda");
        },
      },
    );
    this.applyLod();
    this.probe = { snapshot: () => this.snapshot() };
    (window as unknown as { __boks?: BoksProbe }).__boks = this.probe;
    e.hud.set({ title: `🥊 Raund 1/${ROUNDS}`, score: 0, combo: null, time: this.roundSec, timeLabel: "Vaqt", lives: null });
  }

  /** the post pipeline (high only) follows the live level */
  get postOn(): boolean {
    return LOD[effectiveLevel(this.built, this.engine.quality.level)].post;
  }

  // ------------------------------------------------------------------------------------------------ staging

  /** what the first picture does not need arrives a few frames later: the 3D spectators */
  streamIn(dt: number): void {
    if (!this.alive) return;
    this.clock += dt;
    if (this.stage === 0 && this.clock > 0.12) {
      this.stage = 1;
      const g = this.arena.buildCrowd();
      if (g && !this.compiling) {
        this.compiling = true;
        // build the shaders now (not at the first frame the crowd is seen)
        void this.gl.compileAsync(g, this.camera, this.scene).catch(() => undefined);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ quality

  private applyLod(): void {
    const q = this.engine.quality;
    const lvl = effectiveLevel(this.built, q.level);
    if (lvl !== this.lodLevel) {
      this.lodLevel = lvl;
      const L = LOD[lvl];
      this.crowdShare = this.lod.crowd > 0 ? L.crowd / this.lod.crowd : 0;
      this.crowdAnim = L.crowdAnim;
      for (let i = 0; i < this.arena.rim.length; i++) this.arena.rim[i].intensity = i < L.rim ? 14 : 0;
    }
    const want = LOD[lvl].shadows && q.shadows && this.lod.shadows;
    if (want !== this.shadowsOn || this.gl.shadowMap.enabled !== want) {
      this.shadowsOn = want;
      this.gl.shadowMap.enabled = want;
      this.arena.key.castShadow = want;
    }
  }

  // ------------------------------------------------------------------------------------------------ fight callbacks

  private msg(text: string, col = "#fff", size = 64, life = 1.4, sub = ""): void {
    if (this.msgs.length < 4) {
      this.msgs.push({ text, sub, col, size, t: 0, life });
      return;
    }
    // reuse the oldest message object
    const m = this.msgs.shift()!;
    m.text = text;
    m.sub = sub;
    m.col = col;
    m.size = size;
    m.t = 0;
    m.life = life;
    this.msgs.push(m);
  }

  private bell(kind: "start" | "end" | "ko"): void {
    const a = this.engine.audio;
    const hits = kind === "start" ? 2 : kind === "end" ? 3 : 5;
    const gap = kind === "ko" ? 0.14 : 0.26;
    for (let i = 0; i < hits; i++) {
      a.tone(1568, 1560, 0.7, "sine", 0.1, i * gap);
      a.tone(2349, 2340, 0.5, "sine", 0.05, i * gap);
    }
    this.arena.roar(kind === "end" ? 0.7 : 0.5);
  }

  private onPhase(ph: Phase, round: number): void {
    if (ph === "intro") {
      this.msg(`RAUND ${round}`, "#ffd23f", 70, 2.2, round === 1 ? "Qizil lapa — chap qo‘l · ko‘k lapa — o‘ng qo‘l" : "");
    } else if (ph === "round") {
      this.enemyDown = false;
      this.msg("JANG!", "#ff6a3c", 84, 1.1);
    } else if (ph === "rest") {
      this.padViews.hideAll();
      this.enemyDown = false;
      this.msg("RAUND TUGADI", "#ffd23f", 56, 1.8, "Dam oling — tez orada keyingi raund");
      this.engine.audio.win();
    } else if (ph === "ko") {
      this.padViews.hideAll();
      this.msg("NOKAUT!", "#ff5a6a", 92, 2.4, "Raqib yiqildi");
    }
    this.hudDirty = true;
  }

  private padWorld(p: Pad, out: { x: number; y: number; z: number }): void {
    // where the hand has to go -> the stage -> the pad plane in front of the partner (the camera as it stands without a lean)
    gloveToPx(this.base, p.rx, p.ry, this.tmpG);
    pxToWorld(this.base, this.tmpG.x, this.tmpG.y, CAM.z - PAD_PLANE_Z, out);
    // the partner can only hold it where his arm reaches: pull it towards his shoulder
    const sx = p.side === "L" ? -0.21 : 0.21;
    const sy = 1.47;
    const dx = out.x - sx;
    const dy = out.y - sy;
    const r = Math.hypot(dx, dy);
    if (r > 0.5) {
      out.x = sx + (dx / r) * 0.5;
      out.y = sy + (dy / r) * 0.5;
    }
    out.y = Math.max(1.05, out.y);
    // a portrait picture is narrow: the whole pad stays inside it
    const edge = Math.max(0.25, (CAM.z - PAD_PLANE_Z) * this.base.th * (this.base.w / Math.max(1, this.base.h)) - 0.24);
    out.x = clamp(out.x, -edge, edge);
  }

  private onPadSpawn(p: Pad): void {
    this.padWorld(p, this.tmpP);
    this.padViews.show(p.id, this.tmpP.x, this.tmpP.y, this.tmpP.z, p.life);
    this.engine.audio.tone(760, 1020, 0.05, "sine", 0.05);
  }

  private onPadExpire(p: Pad): void {
    const px = this.padPx[p.id];
    this.padViews.hide(p.id);
    this.engine.fx.popup("o‘tkazildi", px.x, px.y, "#b8c0cc", 20 * this.u(), 0.7);
  }

  private onAttackStart(a: Attack): void {
    this.defTr.begin();
    const au = this.engine.audio;
    au.tone(150, 330, a.windup, "sawtooth", 0.05);
    au.whoosh(0.15);
    this.warnFlash = 1;
    void a;
  }

  private judge(a: Attack): ReturnType<typeof judgeDefense> {
    this.defTr.read(this.t, this.defIn);
    return judgeDefense(a.kind, a.from, this.defIn);
  }

  private onImpact(a: Attack, def: "dodge" | "block" | "hit", dmg: number, pts: number): void {
    const e = this.engine;
    const W = e.stage.w;
    const H = e.stage.h;
    const u = this.u();
    this.defTr.end();
    this.anim.hit(a.from < 0 ? 0 : 1);
    if (def === "dodge") {
      e.audio.whoosh(0.35);
      e.audio.good();
      e.fx.popup("QOCHDINGIZ!", W / 2, H * 0.4, "#34d399", 44 * u, 1.0);
      e.fx.popup(`+${pts}`, W / 2, H * 0.4 + 44 * u, "#bdf5dc", 26 * u, 0.9);
      this.arena.roar(0.6);
    } else if (def === "block") {
      e.audio.clash();
      e.fx.popup("BLOK!", W / 2, H * 0.4, "#22d3ee", 44 * u, 1.0);
      e.fx.shake(6, 0.15);
      this.addShake(0.02, 0.2);
      this.camBump = 0.5;
    } else {
      e.audio.hurt();
      e.audio.punch();
      e.fx.flash("255,40,60", 0.55);
      e.fx.shake(22, 0.4);
      e.fx.popup("URILDINGIZ!", W / 2, H * 0.4, "#ff5a6a", 48 * u, 1.1);
      e.fx.burst(W / 2, H * 0.5, Math.round(26 * e.quality.particles), "#ffeb3b", [150, 520], [2, 6], [0.2, 0.5], true, 600);
      this.addShake(0.07, 0.4);
      this.camBump = 1;
      this.hurtFlash = 1;
      this.arena.roar(0.4);
    }
    void dmg;
  }

  private onKnockdown(who: "enemy" | "player"): void {
    const e = this.engine;
    if (who === "enemy") {
      this.enemyDown = true;
      e.audio.boom(true);
      e.audio.combo(8);
      this.arena.roar(1);
      e.fx.flash("255,235,160", 0.4);
    } else {
      e.audio.lose();
      this.msg("NOKAUT!", "#ff5a6a", 92, 2.4, "Siz yiqildingiz");
      e.fx.flash("255,40,60", 0.6);
    }
  }

  // ------------------------------------------------------------------------------------------------ helpers

  private u(): number {
    return Math.min(this.engine.stage.w, this.engine.stage.h) / 720;
  }

  private addShake(a: number, t: number): void {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = Math.max(this.shakeT, t);
  }

  // ------------------------------------------------------------------------------------------------ input

  private readBody(dt: number): void {
    const e = this.engine;
    const p = e.players[0];
    const W = e.stage.w;
    const H = e.stage.h;
    const L = p.lm;
    const ok = !!p && p.present && L[11].v > 0.3 && L[12].v > 0.3;
    this.present = ok;
    const now = performance.now();
    let hx = 0;
    let hy = 0;
    let guard = false;
    if (ok) {
      const sw = Math.max(30, p.scale);
      this.sw = sw;
      const cx = (L[11].x + L[12].x) / 2;
      const cy = (L[11].y + L[12].y) / 2;
      // the head against the stage centre in shoulder widths: stepping closer or further does not read as a lean
      hx = (L[0].x - W / 2) / sw;
      hy = (L[0].y - H / 2) / sw;
      const nose = L[0];
      guard = L[15].v > 0.4 && L[16].v > 0.4 && Math.hypot(L[15].x - nose.x, L[15].y - nose.y) < 1.05 * sw && Math.hypot(L[16].x - nose.x, L[16].y - nose.y) < 1.05 * sw;
      for (let h = 0; h < 2; h++) {
        const hd = this.hands[h];
        const wi = 15 + h;
        const si = 11 + h;
        const w = L[wi];
        const s = L[si];
        const tracked = p.blades[h].active && w.v >= 0.4;
        hd.tracked = tracked;
        hd.pgx = hd.gx;
        hd.pgy = hd.gy;
        if (!tracked) {
          this.det[h].reset();
          continue;
        }
        const rx = (w.x - cx) / sw;
        const ry = (w.y - cy) / sw;
        gloveToPx(this.view, rx, ry, this.tmpG);
        if (hd.pgx === 0 && hd.pgy === 0) {
          hd.pgx = this.tmpG.x;
          hd.pgy = this.tmpG.y;
        }
        hd.gx = this.tmpG.x;
        hd.gy = this.tmpG.y;
        const ex = (w.x - s.x) / sw;
        const ey = (w.y - s.y) / sw;
        hd.ext = clamp((Math.hypot(ex, ey) - 0.85) / 0.8, 0, 1);
        const el = L[13 + h];
        const ix = L[19 + h];
        const wd = p.world;
        const sample: HandSample = this.sample;
        sample.t = now;
        sample.valid = true;
        sample.speed = (p.blades[h].speed * H) / sw;
        sample.ex = ex;
        sample.ey = ey;
        sample.fore = el.v >= 0.4 ? Math.hypot(el.x - w.x, el.y - w.y) / sw : 0;
        sample.size = ix.v >= 0.4 ? Math.hypot(ix.x - w.x, ix.y - w.y) / sw : 0;
        sample.dz = wd && wd[wi] && wd[si] ? (wd[wi].z ?? 0) - (wd[si].z ?? 0) : NaN;
        this.det[h].update(sample, e.sensitivity);
      }
    } else {
      this.hands[0].tracked = this.hands[1].tracked = false;
      this.det[0].reset();
      this.det[1].reset();
    }
    // keyboard stand-ins: arrows lean / duck, S blocks (they add to the body, so tests and desks work)
    const k = e.keys;
    const tx = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    const ty = k.has("ArrowDown") ? 1 : 0;
    const a = 1 - Math.exp(-dt * 12);
    this.kbDx += (tx * 0.9 - this.kbDx) * a;
    this.kbDy += (ty * 0.9 - this.kbDy) * a;
    this.kbGuard = k.has("s") || k.has("ArrowUp");
    this.defTr.push(this.t, hx + this.kbDx, hy + this.kbDy, guard || this.kbGuard, dt);
  }

  private sample: HandSample = { t: 0, valid: true, speed: 0, ex: 0, ey: 0, fore: 0, size: 0, dz: NaN };

  /** keyboard punches: A / Q = left, D / E = right (when there is no body, the gloves rest in a guard) */
  private keyboard(dt: number): void {
    const k = this.engine.keys;
    for (let h = 0; h < 2; h++) {
      const side = SIDES[h];
      const hd = this.hands[h];
      hd.jab = Math.max(0, hd.jab - dt);
      const down = h === 0 ? k.has("a") || k.has("q") : k.has("d") || k.has("e");
      if (down && !this.kbPrev[side] && this.fight.phase === "round") this.keyPunch(h, side);
      this.kbPrev[side] = down;
      if (!hd.tracked) {
        // guard stand-in
        const sgn = h === 0 ? -1 : 1;
        gloveToPx(this.view, sgn * 0.6, -0.45, this.tmpG);
        let x = this.tmpG.x;
        let y = this.tmpG.y;
        let ext = 0;
        if (hd.jab > 0) {
          const j = Math.sin(Math.PI * (1 - hd.jab / 0.22));
          x = lerp(x, hd.jabTo.x, j);
          y = lerp(y, hd.jabTo.y, j);
          ext = j;
        }
        hd.pgx = hd.gx || x;
        hd.pgy = hd.gy || y;
        hd.gx = x;
        hd.gy = y;
        hd.ext = ext;
      }
    }
  }

  private keyPunch(h: number, side: Side): void {
    const f = this.fight;
    f.punchThrown();
    let hit = -1;
    let age = 0;
    for (const p of f.pads) {
      if (p.active && p.side === side && p.age >= 0.1 && p.age > age) {
        hit = p.id;
        age = p.age;
      }
    }
    const hd = this.hands[h];
    hd.jab = 0.22;
    if (hit >= 0) {
      hd.jabTo.x = this.padPx[hit].x;
      hd.jabTo.y = this.padPx[hit].y;
      this.hitsKb++;
      this.landed(hit, h, 22 + (this.hitsKb % 5) * 3);
    } else {
      hd.jabTo.x = this.view.w / 2;
      hd.jabTo.y = this.view.h * 0.45;
      f.whiff();
      this.engine.audio.whoosh(0.2);
    }
  }

  // ------------------------------------------------------------------------------------------------ punches and pads

  private updatePadPx(): void {
    const v = this.view;
    const pads = this.padViews.pads;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i].state !== "off") worldToPx(v, pads[i].x, pads[i].y, pads[i].z, this.padPx[i]);
    }
  }

  private detectPunches(): void {
    const f = this.fight;
    for (let h = 0; h < 2; h++) {
      const st = this.det[h].st;
      if (st.fired) {
        f.punchThrown();
        this.engine.audio.whoosh(clamp(st.peak / 25, 0.1, 0.5));
      }
      if (st.live || st.fired) {
        this.lastKmh = st.kmh;
        this.lastKmhT = this.t;
      }
      // the glove's path of this frame through a pad: while the punch flies, and on the frame it ends (the hand has just
      // stopped on the pad, which is when most punches arrive)
      if ((st.live || st.ended) && !st.used) this.testPads(h);
      if (st.ended && !st.used) f.whiff();
    }
  }

  private testPads(h: number): void {
    const f = this.fight;
    const e = this.engine;
    const st = this.det[h].st;
    const hd = this.hands[h];
    const side = SIDES[h];
    this.sa.x = hd.pgx;
    this.sa.y = hd.pgy;
    this.sb.x = hd.gx;
    this.sb.y = hd.gy;
    for (let i = 0; i < 4; i++) {
      const p = f.pads[i];
      const pl = this.padLike[i];
      pl.active = p.active;
      pl.side = p.side;
      pl.age = p.age;
      if (p.active) {
        const px = this.padPx[i];
        pl.r = Math.max(px.s * 0.2 * 1.5, this.view.h * 0.1);
        pl.d = segPointDist(px, this.sa, this.sb);
      }
    }
    const r = resolvePunch(this.padLike, side);
    if (r.index >= 0) {
      this.det[h].consume();
      this.landed(r.index, h, st.kmh);
    } else if (r.wrong) {
      this.det[h].consume();
      f.wrongHand();
      let wi = -1;
      for (let i = 0; i < 4; i++) if (this.padLike[i].active && this.padLike[i].side !== side && this.padLike[i].d <= this.padLike[i].r) wi = i;
      if (wi >= 0) e.fx.popup("Boshqa qo‘l!", this.padPx[wi].x, this.padPx[wi].y - 40 * this.u(), "#ffb3b3", 26 * this.u(), 0.8);
      e.audio.bad();
    }
  }

  /** the punch of hand `h` landed on pad `i` */
  private landed(i: number, h: number, kmh: number): void {
    const f = this.fight;
    const e = this.engine;
    const u = this.u();
    const px = this.padPx[i];
    const side: Side = f.pads[i].side;
    const res = f.padHit(i, kmh);
    this.lastKmh = kmh;
    this.lastKmhT = this.t;
    this.padViews.hit(i);
    this.gloves.bump(h as 0 | 1);
    this.anim.hit(side === "L" ? 0 : 1);
    const q = e.quality.particles;
    const col = side === "L" ? "#ff6b81" : "#6cc4ff";
    e.audio.punch();
    if (kmh > 30) e.audio.boom(false);
    e.fx.burst(px.x, px.y, Math.round(22 * q), col, [160, 620], [2, 6], [0.2, 0.5], true, 500);
    e.fx.ring(px.x, px.y, 40 * u, "#ffffff", 0.35, 8);
    e.fx.popup(HIT_WORDS[f.stats.hits % 4], px.x, px.y - 50 * u, "#ffffff", 40 * u, 0.7);
    e.fx.popup(`${Math.round(kmh)} km/soat`, px.x, px.y + 56 * u, "#9fe8ff", 20 * u, 0.9);
    if (res.pts > 0) e.fx.popup(`+${res.pts}`, px.x + 46 * u, px.y - 8 * u, "#ffe66d", 26 * u, 0.8);
    e.fx.shake(4, 0.1);
    this.addShake(0.012, 0.1);
    this.arena.roar(0.35);
    if (f.combo > 0 && f.combo % 5 === 0) {
      e.fx.popup(`${f.combo} KOMBO!`, e.stage.w / 2, e.stage.h * 0.28, "#ffd23f", 48 * u, 1.0);
      e.audio.combo(Math.min(8, f.combo / 2));
    }
  }

  // ------------------------------------------------------------------------------------------------ frame

  frame(dtIn: number): void {
    if (!this.alive) return;
    const e = this.engine;
    const dt = Math.min(0.05, dtIn);
    this.t += dt;
    const playing = e.state === "play";
    this.syncView();
    this.applyLod();
    this.readBody(dt);
    this.keyboard(dt);
    this.updatePadPx();
    if (playing) {
      if (!this.started) {
        this.started = true;
        this.fight.start();
      }
      this.playT += dt;
      this.fight.update(dt);
      if (this.fight.phase === "round") this.detectPunches();
      if (!e.audio.musicOn) e.audio.musicStart(126, "drive");
    } else {
      this.det[0].reset();
      this.det[1].reset();
    }
    this.padViews.update(dt);
    this.updatePartner(dt);
    this.updateGloves(dt);
    this.updateCamera(dt);
    this.arena.update(dt, this.t, this.crowdAnim && this.lod.crowdAnim, this.crowdShare);
    this.syncHud();
    // the last seconds of a round tick
    if (playing && this.fight.phase === "round") {
      const s = Math.ceil(this.fight.roundLeft);
      if (s !== this.lastSec && s <= 3 && s > 0) e.audio.beep(false);
      this.lastSec = s;
    }
    for (const m of this.msgs) m.t += dt;
    this.warnFlash = Math.max(0, this.warnFlash - dt * 3);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    // the end: the knockdown is shown first
    if (this.overT >= 0 && !this.finished) {
      this.overT += dt;
      if (this.overT > 1.8) this.finishGame();
    }
  }

  private syncView(): void {
    const e = this.engine;
    this.view.w = this.base.w = e.stage.w;
    this.view.h = this.base.h = e.stage.h;
    // portrait phone: a wider vertical field keeps the opponent and both pads in the picture (landscape: CAM.fov as before)
    const fov = portraitFov(CAM.fov, e.stage.w / Math.max(1, e.stage.h));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.view.th = this.base.th = Math.tan((fov * Math.PI) / 360);
    }
  }

  private updatePartner(dt: number): void {
    const f = this.fight;
    const ai = this.animIn;
    const a = this.anim;
    // pads held in the two hands (partner-local = world minus the partner's root)
    const ox = a.swayX;
    const oz = PARTNER_Z + a.lunge + a.fallZ;
    for (let s = 0; s < 2; s++) {
      const t = ai.pad[s];
      t.on = false;
      for (let k = 0; k < 2; k++) {
        const pv = this.padViews.pads[s * 2 + k];
        if (pv.state === "off") continue;
        if (pv.state === "out" && pv.t > 0.2) continue;
        t.on = true;
        t.x = pv.x - ox;
        t.y = pv.y;
        t.z = pv.z - oz;
        t.recoil = pv.recoil;
      }
    }
    const at = f.attack;
    const aa = ai.attack;
    aa.active = at.active && f.phase === "round";
    aa.kind = at.kind;
    aa.from = at.from;
    aa.t = at.t;
    aa.windup = at.windup;
    ai.faceX = CAM.x - ox;
    ai.faceY = CAM.y - 0.02;
    ai.faceZ = CAM.z - PARTNER_Z;
    ai.down = this.enemyDown;
    a.update(dt, this.t, ai);
    this.rig.apply(a);
  }

  private updateGloves(dt: number): void {
    const now = this.t;
    for (let h = 0; h < 2; h++) {
      const hd = this.hands[h];
      const live = this.det[h].st.live || hd.jab > 0;
      // no body at all (keyboard test): the gloves stay in a guard; a lost hand fades out after a moment
      this.gloves.update(dt, this.view, h as 0 | 1, hd.gx, hd.gy, hd.ext, live, hd.tracked || !this.present, now);
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    // the view follows the head a little (lean left / right, duck) so a dodge is felt and the missing glove is seen passing
    const tx = clamp(this.defTr.curDx * LEAN_M_PER_SW, -0.45, 0.45);
    const ty = clamp(-this.defTr.curDy * 0.22, -0.3, 0.1);
    const a = 1 - Math.exp(-dt * 14);
    this.leanX += (tx - this.leanX) * a;
    this.leanY += (ty - this.leanY) * a;
    let sx = 0;
    let sy = 0;
    let roll = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT) * 4;
      const amp = this.shakeA * Math.min(1, k);
      sx = Math.sin(this.t * 83) * amp;
      sy = Math.cos(this.t * 71) * amp;
      roll = Math.sin(this.t * 61) * amp * 0.25;
      if (this.shakeT <= 0) this.shakeA = 0;
    }
    this.camBump = Math.max(0, this.camBump - dt * 4);
    const bob = Math.sin(this.t * 1.6) * 0.008;
    this.view.x = CAM.x + this.leanX;
    this.view.y = CAM.y + this.leanY + bob;
    this.view.z = CAM.z + this.camBump * 0.1;
    cam.position.set(this.view.x + sx, this.view.y + sy, this.view.z);
    cam.rotation.set(0, 0, roll);
  }

  private syncHud(): void {
    const f = this.fight;
    const sec = f.phase === "round" ? Math.ceil(f.roundLeft) : f.phase === "rest" ? Math.ceil(f.restSec - f.phaseT) : 0;
    const hk = this.hudLast;
    if (hk.round === f.round && hk.score === f.score && hk.combo === f.combo && hk.sec === sec && hk.phase === f.phase && !this.hudDirty) return;
    hk.round = f.round;
    hk.score = f.score;
    hk.combo = f.combo;
    hk.sec = sec;
    hk.phase = f.phase;
    this.hudDirty = false;
    this.engine.hud.set({
      title: `🥊 Raund ${f.round}/${f.rounds}`,
      score: f.score,
      combo: f.combo > 1 ? `${f.combo}` : null,
      time: f.phase === "rest" ? sec : f.phase === "round" ? sec : null,
      timeLabel: f.phase === "rest" ? "Dam olish" : "Vaqt",
      bar: f.phase === "round" ? 1 - f.roundT / f.roundSec : 0,
    });
  }

  private finishGame(): void {
    if (this.finished) return;
    this.finished = true;
    const f = this.fight;
    const s = f.stats;
    const acc = Math.round(f.accuracy * 100);
    const kcal = Math.max(1, Math.round(s.thrown * 0.35 + this.playT * 0.12));
    this.engine.audio.musicStop();
    this.engine.finish({
      score: Math.round(f.score),
      lines: [
        ["Zarbalar", s.hits],
        ["Eng tez zarba", `${Math.round(s.maxKmh)} km/soat (taxminiy)`],
        ["Aniqlik", `${acc}%`],
        ["Qochish / blok", `${s.dodges} / ${s.blocks}`],
        ["Nokautlar", s.kos],
        ["Raundlar", `${Math.min(f.rounds, s.roundsDone)}/${f.rounds}`],
        ["Kaloriya", `~${kcal} kkal`],
      ],
      stats: { zarbalar: s.hits, tezlik: Math.round(s.maxKmh), aniqlik: acc, nokaut: s.kos },
    });
  }

  // ------------------------------------------------------------------------------------------------ overlay

  draw(c: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const e = this.engine;
    const W = e.stage.w;
    const H = e.stage.h;
    const u = this.u();
    const f = this.fight;
    const at = f.attack;

    // the partner's punch: where it comes from, and how long is left
    if (at.active && !at.resolved && f.phase === "round") {
      const k = clamp(at.t / at.impactAt, 0, 1);
      const x = at.from < 0 ? 0 : W;
      const g = c.createLinearGradient(x, 0, W / 2, 0);
      const al = (0.15 + 0.45 * k) * (0.7 + 0.3 * Math.sin(this.t * 24));
      g.addColorStop(0, `rgba(255,40,40,${al})`);
      g.addColorStop(0.5, "rgba(255,40,40,0)");
      c.fillStyle = g;
      c.fillRect(at.from < 0 ? 0 : W / 2, 0, W / 2, H);
      const bx = at.from < 0 ? 64 * u : W - 64 * u;
      const blink = Math.sin(this.t * 22) > 0;
      // (below the small camera picture at the top right)
      drawText(c, "⚠", bx, H * 0.56, 64 * u, blink ? "#ff3b3b" : "#ffd23f");
      drawText(c, at.from < 0 ? "CHAPDAN!" : "O‘NGDAN!", bx, H * 0.56 + 52 * u, 22 * u, "#fff");
      drawText(c, at.kind === "hook" ? "Yon zarba — boshni teskari tomonga oling" : "Boshni chetga oling yoki ikki qo‘lni yuzga qo‘ying!", W / 2, H * 0.84, 20 * u, "#fff");
      // closing ring: the time until the glove lands
      c.save();
      c.strokeStyle = "rgba(255,255,255,.25)";
      c.lineWidth = 6 * u;
      c.beginPath();
      c.arc(W / 2, H * 0.2, 30 * u, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = k > 0.75 ? "#ff3b3b" : "#ffd23f";
      c.beginPath();
      c.arc(W / 2, H * 0.2, 30 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      c.stroke();
      c.restore();
    }
    if (this.hurtFlash > 0) {
      c.fillStyle = `rgba(200,0,20,${0.25 * this.hurtFlash})`;
      c.fillRect(0, 0, W, H);
    }

    // health and stamina bars (portrait phone: full width, one above the other, clear of the engine's bottom row)
    const lift = bottomLift(W, H);
    const tall = lift > 0;
    const bw = tall ? W - 28 : clamp(W * 0.26, 150, 300);
    const by = H - 46 * u - lift;
    const stack = tall ? 56 * u : 0;
    this.bars(c, 14 * u, by - stack, bw, u, "SIZ", f.hp / 100, f.stamina / 100, "#34d399", f.tired ? "Charchadingiz!" : "");
    this.bars(c, tall ? 14 * u : W - 176 * u - bw, by, bw, u, "RAQIB", f.enemyHp / 100, f.enemyStamina / 100, "#ff5a6a", "");

    // punch speed (a rough estimate) and the best one
    const fresh = this.t - this.lastKmhT < 2.5;
    const best = Math.round(f.stats.maxKmh);
    // (the text is rebuilt only when a number changes)
    const key = fresh ? Math.round(this.lastKmh) + 1000 : best;
    if (key !== this.speedKey) {
      this.speedKey = key;
      this.speedLine = fresh ? `Zarba tezligi: ${Math.round(this.lastKmh)} km/soat (taxminiy)` : best > 0 ? `Eng tez zarba: ${best} km/soat (taxminiy)` : "Tez va keskin uring — sekin tegish hisoblanmaydi";
    }
    const up = bottomLift(W, H) + (bottomLift(W, H) > 0 ? 56 * u : 0);
    drawText(c, this.speedLine, W / 2, H - 74 * u - up, 17 * u, fresh ? "#9fe8ff" : "rgba(255,255,255,.8)", "center", 700);
    if (this.playT < 9 && !this.present) drawText(c, "Klaviatura: A / D — zarba · ← → ↓ — qochish · S — blok", W / 2, H - 98 * u - up, 15 * u, "#ffd23f", "center", 700);

    // big messages
    let row = 0;
    for (const m of this.msgs) {
      if (m.t >= m.life) continue;
      const k = m.t / m.life;
      const a = k < 0.1 ? k / 0.1 : k > 0.75 ? (1 - k) / 0.25 : 1;
      c.save();
      c.globalAlpha = clamp(a, 0, 1);
      const pop = 1 + Math.max(0, 0.25 - m.t) * 1.6;
      drawText(c, m.text, W / 2, H * 0.3 + row * 70 * u, m.size * u * pop, m.col, "center", 900);
      if (m.sub) drawText(c, m.sub, W / 2, H * 0.3 + (m.size * 0.7 + row * 70) * u, 22 * u, "#fff", "center", 700);
      c.restore();
      row++;
    }
    if (f.phase === "rest") drawText(c, `Dam olish · ${Math.max(0, Math.ceil(f.restSec - f.phaseT))}`, W / 2, H * 0.62, 30 * u, "#ffd23f");
    if (f.phase === "ko") drawText(c, `${Math.min(10, Math.floor(f.phaseT * 3) + 1)}…`, W / 2, H * 0.55, 60 * u, "#fff");
  }

  private bars(c: CanvasRenderingContext2D, x: number, y: number, w: number, u: number, label: string, hp: number, st: number, col: string, note: string): void {
    const h = 15 * u;
    c.save();
    drawText(c, label, x, y - 14 * u, 15 * u, "#fff", "left", 900);
    if (note) drawText(c, note, x + w, y - 14 * u, 14 * u, "#ff8a8a", "right", 800);
    c.fillStyle = "rgba(0,0,0,.55)";
    c.beginPath();
    c.roundRect(x - 2 * u, y - 2 * u, w + 4 * u, h + 4 * u, 8 * u);
    c.fill();
    const hv = clamp(hp, 0, 1);
    c.fillStyle = hv > 0.5 ? col : hv > 0.25 ? "#ffb02e" : "#ff3b3b";
    c.beginPath();
    c.roundRect(x, y, Math.max(0, w * hv), h, 6 * u);
    c.fill();
    c.fillStyle = "rgba(0,0,0,.55)";
    c.fillRect(x - 2 * u, y + h + 4 * u, w + 4 * u, 8 * u);
    c.fillStyle = st < 0.15 ? "#ff6a6a" : "#ffd23f";
    c.fillRect(x, y + h + 5 * u, w * clamp(st, 0, 1), 6 * u);
    c.restore();
  }

  // ------------------------------------------------------------------------------------------------ probe

  private snapshot(): ReturnType<BoksProbe["snapshot"]> {
    const f = this.fight;
    const pads: ReturnType<BoksProbe["snapshot"]>["pads"] = [];
    let aim: ReturnType<BoksProbe["snapshot"]>["aim"] = null;
    let bestAge = -1;
    for (const p of f.pads) {
      if (!p.active) continue;
      const px = this.padPx[p.id];
      const r = Math.max(px.s * 0.2 * 1.5, this.view.h * 0.1);
      pads.push({ id: p.id, side: p.side, age: p.age, x: px.x, y: px.y, r });
      if (p.age > bestAge) {
        bestAge = p.age;
        // the wrist has to be where the glove maps to the pad: invert gloveToPx on the player's shoulders
        const pl = this.engine.players[0];
        const L = pl.lm;
        const sw = Math.max(30, pl.scale);
        const cx = (L[11].x + L[12].x) / 2;
        const cy = (L[11].y + L[12].y) / 2;
        const S = GLOVE_S * this.view.h;
        const rx = (px.x - this.view.w / 2) / S;
        const ry = (px.y - this.view.h * GLOVE_Y0) / S;
        const sgn = p.side === "L" ? -1 : 1;
        aim = { side: p.side, x: cx + rx * sw, y: cy + ry * sw, guardX: cx + sgn * 0.6 * sw, guardY: cy - 0.45 * sw, r };
      }
    }
    const at = f.attack;
    return {
      phase: f.phase,
      state: this.engine.state,
      round: f.round,
      health: f.hp,
      stamina: f.stamina,
      enemyHealth: f.enemyHp,
      score: f.score,
      combo: f.combo,
      lastSpeed: this.lastKmh,
      bestSpeed: f.stats.maxKmh,
      hits: f.stats.hits,
      thrown: f.stats.thrown,
      accuracy: f.accuracy,
      dodges: f.stats.dodges,
      blocks: f.stats.blocks,
      taken: f.stats.taken,
      partner: { phase: this.anim.phase, down: this.anim.downProgress, attack: { active: at.active, kind: at.kind, from: at.from, t: at.t } },
      pads,
      aim,
      present: this.present,
      level: this.lodLevel ?? this.built,
      crowd: this.arena.crowdCount,
      shadows: this.shadowsOn,
      post: this.postOn,
    };
  }

  // ------------------------------------------------------------------------------------------------ end

  dispose(): void {
    this.alive = false;
    const w = window as unknown as { __boks?: BoksProbe };
    if (w.__boks === this.probe) delete w.__boks;
    this.engine.audio.musicStop();
    // free everything here (the engine's own clean-up runs after this and would find an empty group)
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.root.clear();
    this.gl.shadowMap.enabled = this.saved.shadow;
    const s = this.scene;
    s.background = this.saved.bg;
    s.fog = this.saved.fog;
    const cam = this.camera;
    cam.fov = this.saved.fov;
    cam.near = this.saved.near;
    cam.far = this.saved.far;
    cam.position.copy(this.saved.pos);
    cam.quaternion.copy(this.saved.quat);
    cam.updateProjectionMatrix();
  }
}
