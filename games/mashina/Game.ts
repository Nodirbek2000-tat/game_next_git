import * as THREE from "three";
import { clamp } from "@/engine/math";
import type { EngineApi, QualityLevel } from "@/engine/types";
import { SKY_HDR } from "@/games/poyga/config";
import { CarMats, disposeModels, type Precompile } from "@/games/poyga/models";
import { CARS, CONTROL_DEFAULTS, DAY_SECONDS, DRIFT_DEFAULTS, RULE_DEFAULTS, type ModeId } from "./config";
import { laneAssist } from "./logic/assist";
import { DriftScorer } from "./logic/drift";
import { InputMapper, newControls, type PadState } from "./logic/input";
import { EXAM_NODES, MISSIONS, MissionRunner, spawnFor, yawOf, type MissionEvent } from "./logic/modes";
import { Picker, type Choice } from "./logic/picker";
import { ExamScorer, RulesEngine, type VehicleSample, type Verdict } from "./logic/rules";
import { lightColor, type LightColor } from "./logic/signals";
import { PhysWorld } from "./physics/world";
import { RaycastCar } from "./physics/vehicle";
import { rideHeight, disposeCarParts } from "./render/carModel";
import { CameraRig } from "./render/cameraRig";
import { Beacon, HeadGlow, Rain, SkidMarks, Smoke } from "./render/fx3d";
import { drawHud, newHudModel, type HudModel } from "./render/hud";
import { LOD, effectiveLevel, loadMetres, squeeze, type Lod } from "./render/lod";
import { Mats } from "./render/materials";
import { PlayerCar } from "./render/playerCar";
import { Sky } from "./render/sky";
import { SignAtlas, signKey, skyCube, type BoardSpec } from "./render/textures";
import { PedRenderer, SignalLamps, TrafficRenderer } from "./render/traffic3d";
import { PropLayer, TreeLayer } from "./render/vegetation";
import { loadSettings, parseQuery, choiceFrom, saveSettings, type QueryOptions } from "./settings";
import { PedSim } from "./traffic/peds";
import { TrafficSim } from "./traffic/sim";
import { buildLayout, findRoute, nearestNode, SURFACE_GRIP, surfaceAt, zoneAt, bridgeDeckY, type Layout, type Light } from "./world/layout";
import { WorldStreamer } from "./world/streamer";

type Phase = "loading" | "menu" | "driving" | "over";

const BOARD_KINDS = ["cityIn", "cityOut", "dir", "airfield", "bridge"];

/** Everything the e2e tests / debug panel can read (window.__mashina). */
export interface Probe {
  snapshot(): ProbeState;
  game: MashinaGame;
}
export interface ProbeState {
  phase: Phase;
  mode: ModeId;
  clock: number;
  score: number;
  car: { x: number; y: number; z: number; fx: number; fz: number; speed: number; kmh: number; slipDeg: number; grounded: number };
  input: { gas: number; brake: number; steer: number; handbrake: boolean; reverse: boolean; source: string };
  /** pedal calibration + what the camera reads (e2e: wait for `ready` before using the knees) */
  legs: { ready: boolean; calib: number; gasRaw: number; brakeRaw: number; okGas: boolean; okBrake: boolean };
  verdicts: { kind: string; ok: boolean }[];
  penalty: number;
  drift: { total: number; chain: number; combo: number; chains: number; best: number };
  tiles: { loaded: number; built: number; released: number; pending: number; ids: string[] };
  traffic: { cars: number; spawned: number; overtakes: number };
  target: { x: number; z: number; r: number } | null;
  next: { x: number; z: number } | null;
  wet: number;
  night: number;
  crashes: number;
  lives: number;
  exam: { passed: boolean; penalty: number } | null;
  missions: { index: number; completed: number; failed: number; id: string } | null;
  ready: boolean;
  cam: string;
  limit: number;
}

export interface Oracle {
  stop: { type: string; dist: number; color: string | null; peds: boolean; cross: boolean } | null;
  leader: { gap: number; v: number } | null;
  boxBusy: boolean;
}

export class MashinaGame {
  readonly L: Layout = buildLayout();
  private mats: Mats;
  private carMats: CarMats;
  private atlas: SignAtlas;
  readonly sky: Sky;
  readonly streamer: WorldStreamer;
  /** the traffic models, trees and street furniture stream in after the first picture (see `stream`) */
  private trafficR: TrafficRenderer | null = null;
  private trees: TreeLayer | null = null;
  private props: PropLayer | null = null;
  private pedR: PedRenderer;
  private lamps: SignalLamps;
  private skid = new SkidMarks();
  private smoke: Smoke;
  private rain: Rain;
  private beacon = new Beacon();
  private headGlow = new HeadGlow();
  private playerCar: PlayerCar;
  private cam: CameraRig;
  private phys: PhysWorld | null = null;
  private car: RaycastCar | null = null;
  private alive = true;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private camSaved: { fov: number; near: number; far: number; pos: THREE.Vector3; quat: THREE.Quaternion; env: THREE.Texture | null; envK: number };
  /** the quality level the scene was built for, and the numbers it follows now (the controller never goes above the built level) */
  private built: QualityLevel;
  private lod: Lod;
  private lodLevel: QualityLevel | null = null;
  private lodSqueeze = 0;
  /** seconds of streaming time (loading screen + play) and how many of the loading stages have started */
  private streamT = 0;
  private stage = 0;
  private savedShadow = false;
  private envTex: THREE.Texture | null = null;
  private envOn = false;
  private cube: THREE.CubeTexture | null = null;
  private probeRT: THREE.WebGLRenderTarget | null = null;
  private warm: THREE.Group[] = [];
  private rainAlloc = 1;
  private lampT = 0;
  /** what the traffic and the rules read about the player's car, reused every step */
  private obstacle = { x: 0, z: 0, fx: 0, fz: 1, speed: 0 };
  private sample: VehicleSample = { x: 0, z: 0, speed: 0, fx: 0, fz: 1, onRoad: true, grounded: true };
  private lampColor = (l: Light): LightColor => lightColor(this.clock, l.axis, l.offset);
  /** compile the shaders of an object that is not in the scene yet, against the real lights and haze (no stall when it is shown) */
  private precompile: Precompile = (o) => this.compileFor(o, this.scene);
  private musicOn = false;
  private timescale = 1;

  // logic
  private input: InputMapper;
  readonly controls = newControls();
  private picker: Picker | null;
  private choice: Choice;
  private qopt: QueryOptions;
  readonly traffic: TrafficSim;
  readonly peds: PedSim;
  readonly rules: RulesEngine;
  readonly exam = new ExamScorer();
  readonly drift: DriftScorer;
  private missions: MissionRunner | null = null;
  private hud: HudModel = newHudModel();
  phase: Phase = "loading";
  mode: ModeId = "erkin";
  clock = 0;
  score = 0;
  private distance = 0;
  private overtakes = 0;
  private crashes = 0;
  private hp = 3;
  private inv = 0;
  private sessionLeft = 150;
  private duration = 150;
  private kids = false;
  private seated = false;
  private verdicts: Verdict[] = [];
  private passedCars = new Map<number, number>();
  private lastSafe = { x: 0, z: 0, fx: 0, fz: 1, t: 0 };
  private flipT = 0;
  private prevV = { x: 0, z: 0 };
  private rainTarget = 0;
  private rainNow = 0;
  private timeFixed: number | null = null;
  private timeStart = 0.3;
  private examIdx = 1;
  private examDone: { passed: boolean; penalty: number } | null = null;
  private endAt = -1;
  private gpsT = 0;
  private gpsIdx = 0;
  private route: { x: number; z: number }[] = [];
  private targetPt: { x: number; z: number; r: number } | null = null;
  private nextPt: { x: number; z: number } | null = null;
  private hudT = 0;
  private startupT = 0;
  private audioOn = false;
  private lastMsg = "";
  private hudView = { w: 1, h: 1 };
  private probeObj: Probe;
  private keyPrev = { next: false, confirm: false };

  constructor(
    private engine: EngineApi,
    private root: THREE.Group,
    camera: THREE.PerspectiveCamera,
    gl: THREE.WebGLRenderer,
  ) {
    const q = (this.qopt = parseQuery(engine.query));
    const settings = loadSettings();
    this.choice = choiceFrom(settings, q);
    this.mode = this.choice.mode;
    this.timeFixed = q.time ?? null;
    this.rainTarget = q.rain ? 1 : 0;
    this.timescale = q.timescale ?? 1;

    // ---- shared resources
    const boards: BoardSpec[] = [];
    for (const s of this.L.signs) {
      if (!BOARD_KINDS.includes(s.kind)) continue;
      const key = signKey(s.kind, s.text, s.sub);
      if (!boards.some((b) => b.key === key)) boards.push({ key, kind: s.kind, text: s.text ?? "", sub: s.sub });
    }
    this.gl = gl;
    this.built = engine.quality.level;
    this.lod = LOD[this.built];
    // no real-time shadows (the cars keep their soft contact shadows): the sun's shadow pass and the shadow lookups of every
    // material cost a lot on an integrated GPU. The engine's Canvas switches them on for "high"; we switch them off (and put them back on exit).
    this.savedShadow = gl.shadowMap.enabled;
    gl.shadowMap.enabled = false;
    this.atlas = new SignAtlas(boards);
    this.mats = new Mats(this.atlas, gl, this.built, this.lod);
    this.carMats = new CarMats(this.lod.clearcoat);
    // without the HDR image light (the lite level) the car materials reflect a tiny sky gradient instead
    if (!this.lod.hdr) {
      this.cube = skyCube("#9fc3e8", "#e8eef2");
      for (const m of [this.carMats.paint, this.carMats.trafficPaint, this.carMats.glass, this.carMats.metal, this.carMats.matte]) m.envMap = this.cube;
      // (a bright gradient at the full strength of the HDR materials washes the paint out under the stronger lite-level sun)
      this.carMats.paint.envMapIntensity = 0.4;
      this.carMats.trafficPaint.envMapIntensity = 0.35;
      this.carMats.glass.envMapIntensity = 0.8;
      this.carMats.metal.envMapIntensity = 0.7;
      this.carMats.matte.envMapIntensity = 0.15;
    }
    this.scene = this.sceneOf(root) ?? new THREE.Scene();
    this.camSaved = {
      fov: camera.fov, near: camera.near, far: camera.far, pos: camera.position.clone(), quat: camera.quaternion.clone(),
      env: this.scene.environment, envK: this.scene.environmentIntensity,
    };
    this.camera = camera;
    this.sky = new Sky(this.scene, this.mats, gl, this.built);
    root.add(this.sky.group);
    this.streamer = new WorldStreamer(this.L, this.mats, this.atlas, () => this.phys);
    root.add(this.streamer.group);

    this.pedR = new PedRenderer(this.mats);
    this.lamps = new SignalLamps(this.L);
    this.playerCar = new PlayerCar(this.carMats);
    this.playerCar.set(CARS[this.choice.car], CARS[this.choice.car].colors[this.choice.color]);
    this.smoke = new Smoke(this.lod.smoke);
    this.rain = new Rain(this.lod.rain);
    this.rainAlloc = this.lod.rain;
    // (hidden triangles with every material, so the engine's start-up shader precompile sees them all, also those no tile uses yet)
    this.warm = [this.mats.warm(), this.carMats.warm()];
    root.add(this.pedR.group, this.lamps.group, this.skid.mesh, this.smoke.points, this.rain.lines, this.beacon.mesh, this.headGlow.mesh, this.playerCar.group, this.playerCar.shadow, ...this.warm);
    this.cam = new CameraRig(camera);

    // ---- logic
    this.input = new InputMapper(this.controlConfig(), { seated: this.choice.seated, handbrakeSide: engine.leftHanded ? "L" : "R" });
    this.picker = q.mode ? null : new Picker(this.choice);
    this.peds = new PedSim(this.L);
    this.traffic = new TrafficSim(this.L, {
      lightColor: (n, axis) => lightColor(this.clock, axis, this.L.tiles.get(n.id)!.offset),
      pedsBlock: (z) => this.peds.block(z.id),
    });
    this.rules = new RulesEngine(
      this.L,
      {
        lightColor: (d) => lightColor(this.clock, d.axis, this.L.tiles.get(d.node)!.offset),
        pedsOnRoad: (z) => this.peds.onRoad(z),
        pedsActive: (z) => this.peds.active(z),
        crossTraffic: (node, dx, dz) => this.traffic.crossTrafficNear(node, dx, dz),
      },
      (v) => this.onVerdict(v),
      RULE_DEFAULTS,
      (z, prev) => this.onZone(z?.name ?? "", z?.kind ?? null, prev?.kind ?? null),
    );
    this.drift = new DriftScorer(DRIFT_DEFAULTS, {
      banked: (pts, combo) => {
        this.msg(`Drift +${pts}${combo > 1 ? `  ×${combo}` : ""}`, "#ff9f43", 1800);
        this.engine.audio.coin();
      },
      lost: () => this.msg("Drift yo‘qoldi!", "#ff6b6b", 1400),
      combo: (n) => {
        this.engine.audio.combo(n);
        this.msg(`Kombo ×${n}`, "#ffd23f", 1000);
      },
    });

    // ---- the essentials, built now: the tiles around the spawn (the first one is the floor the car stands on), the car, the sky.
    // The rest of the district, the traffic models, the image light, trees and street furniture stream in afterwards (see `stream`),
    // a few milliseconds per frame, so the game opens fast.
    const sp = spawnFor(this.L, this.mode);
    this.streamer.loadAll(sp.x, sp.z, this.engine.quality.viewDistance, 3);
    this.applyLod();
    const t0 = this.timeFixed ?? (this.mode === "erkin" ? this.timeStart : 0.42);
    this.sky.set(t0, 0);
    this.sky.follow(sp.x, sp.z);
    this.cam.snap();

    this.probeObj = { snapshot: () => this.snapshot(), game: this };
    (window as unknown as { __mashina?: Probe }).__mashina = this.probeObj;

    void PhysWorld.create().then((p) => {
      if (!this.alive) {
        p.dispose();
        return;
      }
      this.phys = p;
      this.makeCar();
    });
  }

  private sceneOf(o: THREE.Object3D): THREE.Scene | null {
    let p: THREE.Object3D | null = o;
    while (p && !(p as THREE.Scene).isScene) p = p.parent;
    return p as THREE.Scene | null;
  }

  private controlConfig(): typeof CONTROL_DEFAULTS {
    const s = loadSettings();
    return {
      ...CONTROL_DEFAULTS,
      steerFullDeg: s.steerFullDeg / clamp(this.engine.sensitivity, 0.5, 1.5),
      handbrake: this.qopt.handbrake ?? s.handbrake,
    };
  }

  // ------------------------------------------------------------------------------------------ session

  private makeCar(): void {
    if (!this.phys) return;
    const spec = CARS[this.choice.car];
    this.car?.dispose();
    const sp = spawnFor(this.L, this.mode);
    this.car = new RaycastCar(this.phys.R, this.phys.world, spec, sp.x, rideHeight(spec) + 0.2, sp.z, yawOf(sp.fx, sp.fz));
    this.playerCar.set(spec, spec.colors[this.choice.color]);
    this.car.driftAssist = this.mode === "drift" ? 0.55 : engineKids(this.engine) ? 1 : 0.7;
    this.prevV.x = this.prevV.z = 0;
    this.lastSafe = { x: sp.x, z: sp.z, fx: sp.fx, fz: sp.fz, t: 0 };
    if (this.phase === "loading") this.phase = this.picker ? "menu" : "driving";
    if (this.phase === "driving" && this.clock === 0) this.startSession();
  }

  private startSession(): void {
    const e = this.engine;
    this.kids = e.kids;
    this.seated = this.choice.seated;
    this.mode = this.choice.mode;
    this.clock = 0;
    this.score = 0;
    this.distance = 0;
    this.overtakes = 0;
    this.crashes = 0;
    this.hp = this.kids ? 99 : 3;
    this.inv = 0;
    this.verdicts.length = 0;
    this.passedCars.clear();
    this.hud.msgs.length = 0;
    this.examIdx = 1;
    this.examDone = null;
    this.endAt = -1;
    this.exam.reset();
    this.drift.reset();
    this.rules.reset();
    this.peds.reset();
    this.traffic.reset();
    this.skid.clear();
    this.input.setOptions({ seated: this.seated, handbrakeSide: e.leftHanded ? "L" : "R" });
    this.input.reset();
    this.missions = null;
    const q = this.qopt;
    const dur = q.duration;
    this.duration = dur ?? (this.mode === "imtihon" ? RULE_DEFAULTS.examTimeSec : this.mode === "drift" ? DRIFT_DEFAULTS.sessionSec : this.mode === "missiya" ? 420 : 240);
    this.sessionLeft = this.duration;
    this.timeFixed = q.time ?? null;
    if (this.timeFixed === null && this.mode !== "erkin") this.timeFixed = 0.42;
    this.timeStart = 0.3;
    this.rainTarget = q.rain ? 1 : 0;
    this.applyDensity();
    // place the car for the mode (the tile under it now, the rest streams in)
    const sp = spawnFor(this.L, this.mode);
    this.streamer.loadAll(sp.x, sp.z, e.quality.viewDistance, 2);
    this.makeCarIfChanged();
    this.car?.place(sp.x, rideHeight(CARS[this.choice.car]) + 0.2, sp.z, yawOf(sp.fx, sp.fz));
    this.lastSafe = { x: sp.x, z: sp.z, fx: sp.fx, fz: sp.fz, t: 0 };
    this.cam.snap();
    if (this.mode === "missiya") {
      const spot = (id: string) => {
        const lm = this.L.landmarks.find((l) => l.id === id)!;
        return { x: lm.x, z: lm.z, r: lm.r };
      };
      this.missions = new MissionRunner(MISSIONS, spot, (ev) => this.onMission(ev));
      this.missions.start();
    }
    e.hud.set({ title: `🚗 ${CARS[this.choice.car].name} · ${modeName(this.mode)}`, score: 0, combo: null, time: Math.round(this.sessionLeft), timeLabel: "Vaqt", lives: this.kids ? null : hearts(this.hp, 3) });
    this.audioOn = false;
    this.musicOn = false;
    saveSettings({ ...loadSettings(), car: this.choice.car, color: this.choice.color, seated: this.choice.seated });
    this.hint(this.mode === "imtihon" ? "Imtihon: STOP, svetofor va piyodalar qoidasiga rioya qiling. Marshrut — Registon." : this.mode === "drift" ? "Qo‘l tormozini torting va burilib drift qiling!" : "", 5000);
  }

  private makeCarIfChanged(): void {
    if (!this.car || this.car.spec.id !== this.choice.car) this.makeCar();
    else this.playerCar.set(CARS[this.choice.car], CARS[this.choice.car].colors[this.choice.color]);
  }

  private hintT = 0;
  private hint(text: string, ms: number): void {
    this.hud.hint = text;
    this.hintT = text ? ms / 1000 : 0;
  }

  msg(text: string, col = "#fff", ms = 2200): void {
    if (text === this.lastMsg && this.hud.msgs.length && this.hud.msgs[this.hud.msgs.length - 1].t > 0.3) return;
    this.lastMsg = text;
    this.hud.msgs.push({ text, col, t: ms / 1000, max: ms / 1000 });
    if (this.hud.msgs.length > 3) this.hud.msgs.shift();
  }

  private onZone(name: string, kind: string | null, prevKind: string | null): void {
    if (this.phase !== "driving") return;
    if (kind === "shahar") this.msg(`${name} — tezlik 60 km/soat`, "#fff");
    else if (kind === "trassa") this.msg("Trassa — tezlik 90 km/soat", "#fff");
    else if (kind === "maydon") this.msg("Drift maydoni", "#ff9f43");
    void prevKind;
  }

  private onVerdict(v: Verdict): void {
    this.verdicts.push(v);
    if (this.verdicts.length > 60) this.verdicts.shift();
    const e = this.engine;
    if (this.mode === "imtihon") {
      this.exam.add(v);
      if (v.penalty > 0) this.msg(`${v.text}  −${v.penalty} ball`, "#ff8a80", 2600);
      else this.msg(v.text, "#34d399", 2200);
      if (v.ok) e.audio.good();
      else e.audio.bad();
      // a gross mistake ends the exam at once (as in a real driving test)
      if (!v.ok && RULE_DEFAULTS.examGross.includes(v.kind) && this.endAt < 0) {
        this.endAt = this.clock + 2.2;
        this.msg("Qo‘pol xato — imtihon to‘xtatildi", "#ff5a6a", 2400);
      }
      return;
    }
    if (this.mode === "drift") return;
    this.score = Math.max(0, this.score + v.score);
    this.msg(`${v.text}  ${v.score > 0 ? "+" : ""}${v.score}`, v.ok ? "#34d399" : "#ff8a80", 2600);
    if (v.ok) e.audio.good();
    else e.audio.bad();
    if (v.kind === "pedestrian" || v.kind === "pedHit") e.audio.horn();
    if (v.kind === "redLight" || v.kind === "stop") e.fx.flash("255,60,60", 0.25);
  }

  private onMission(ev: MissionEvent): void {
    const e = this.engine;
    if (ev.type === "start") this.msg(`Missiya: ${ev.mission.title}`, "#9fe8ff", 4000);
    else if (ev.type === "pickup") {
      this.msg("Yo‘lovchi o‘tirdi — Bozorga eltib qo‘ying", "#34d399", 3000);
      e.audio.good();
    } else if (ev.type === "done") {
      this.score += ev.reward;
      this.msg(`Missiya bajarildi! +${ev.reward}`, "#34d399", 3000);
      e.audio.win();
    } else if (ev.type === "fail") {
      this.msg("Vaqt tugadi — missiya bajarilmadi", "#ff6b6b", 3000);
      e.audio.bad();
    }
  }

  private crash(text: string): void {
    if (this.inv > 0 || this.phase !== "driving") return;
    this.crashes++;
    this.inv = 2.2;
    const e = this.engine;
    e.audio.crash();
    e.fx.shake(26, 0.5);
    e.fx.flash("255,80,60", 0.45);
    this.cam.kick(0.6);
    if (this.mode === "drift") {
      this.drift.crash();
      this.msg(text, "#ff5a6a", 2000);
    } else {
      this.rules.report("crash", text);
      if (!this.kids && this.mode !== "imtihon") {
        this.hp--;
        e.hud.set({ lives: hearts(this.hp, 3) });
        if (this.hp <= 0) this.finish("Avariya! O‘yin tugadi");
      }
    }
  }

  // ------------------------------------------------------------------------------------------ frame

  /** Called by the scene every frame while playing / counting down. */
  frame(dt: number, now: number): void {
    if (!this.alive) return;
    const e = this.engine;
    this.startupT += dt;
    this.keepShadowsOff();
    this.applyLod();
    // before the car exists the world is shown from the spawn point
    if (!this.car) {
      const sp = spawnFor(this.L, this.mode);
      this.stream(sp.x, sp.z, dt, 2);
      return;
    }
    const counting = e.state === "countdown";
    // sound starts once the browser allows audio (first click / pose): both calls are idempotent
    if (e.state === "play" && e.audio.ready && this.phase !== "over") {
      if (!this.audioOn) {
        e.audio.engineStart();
        this.audioOn = true;
      }
      if (!this.musicOn && this.phase === "driving") {
        e.audio.musicStart(112, "drive");
        this.musicOn = true;
      }
    }
    // controls (body / keys / gamepad)
    if (this.phase === "menu" && !counting) {
      this.readInput(dt);
      this.runPicker(dt);
    } else if (this.phase === "driving" && !counting) {
      // (timescale > 1 only in tests: several simulation steps per rendered frame, each with its own input read)
      for (let i = 0; i < this.timescale; i++) {
        this.readInput(dt);
        this.stepSim(dt, now);
        if (this.phase !== "driving") break;
      }
    } else this.readInput(dt);
    this.updateVisuals(dt, now);
  }

  private readInput(dt: number): void {
    const e = this.engine;
    const p = e.players[0];
    const c = this.controls;
    const speed = this.car ? this.car.speed : 0;
    let pad: PadState | null = null;
    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      const g = navigator.getGamepads()[0];
      if (g) pad = g as unknown as PadState;
    }
    this.input.update(dt, p, e.keys, pad, speed, e.stage.h, c);
  }

  // ------------------------------------------------------------------------------------------ quality and streaming

  /** the engine's Canvas re-applies its own shadow setting when it reconfigures (e.g. a resolution change): keep ours off */
  private keepShadowsOff(): void {
    if (this.gl.shadowMap.enabled) this.gl.shadowMap.enabled = false;
  }

  /** whether the post pipeline (Scene.tsx) is drawing the game now: it draws into a linear render target, the screen gets tone mapping */
  private postOn(): boolean {
    return LOD[effectiveLevel(this.built, this.engine.quality.level)].post;
  }

  /**
   * `compileAsync` of `o` for the lights of the game and the haze / image light of `target`. The shader variant depends on where
   * the picture goes: the post pipeline draws the game into a linear render target (no tone mapping), the screen gets ACES and
   * sRGB. A render target is bound while the variants are chosen, so the right ones are built.
   */
  private async compileFor(o: THREE.Object3D, target: THREE.Scene): Promise<void> {
    const gl = this.gl;
    const prev = gl.getRenderTarget();
    try {
      if (this.postOn()) gl.setRenderTarget((this.probeRT ??= new THREE.WebGLRenderTarget(1, 1)));
      const done = gl.compileAsync(o, this.camera, target);
      gl.setRenderTarget(prev);
      await done;
    } catch {
      /* it compiles when first drawn instead */
      gl.setRenderTarget(prev);
    }
  }

  /** the image light: the HDR sky turned into a reflection map (a few shaders and a GPU pass: not in the first frames) */
  private async loadEnv(): Promise<void> {
    try {
      const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js");
      const tex = await new HDRLoader().loadAsync(SKY_HDR);
      if (!this.alive) {
        tex.dispose();
        return;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.gl);
      this.envTex = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      tex.dispose();
      // every shader changes with an image light: build the new variants first (against a stand-in scene that already has it),
      // switch when they are ready, so no frame waits for a whole district of shaders
      const probe = new THREE.Scene();
      probe.environment = this.envTex;
      probe.fog = this.scene.fog;
      await this.compileFor(this.root, probe);
      if (!this.alive) return;
      this.scene.environment = this.envTex;
      this.envOn = true;
      // (the image light shares the ambient work with the hemisphere light)
      this.sky.setAmbientScale(0.55);
    } catch {
      /* no image lighting: the sun and the hemisphere light still work */
    }
  }

  /**
   * Follow the quality level, live (no reload): streamed radius, haze and far plane, backdrop, traffic and people counts, tree
   * and furniture caps. What was decided when the scene was built (texture maps, clear coat, which models were fetched) stays;
   * the controller never goes above the level the game started on.
   */
  private applyLod(): void {
    const q = this.engine.quality;
    const lvl = effectiveLevel(this.built, q.level);
    // the emergency squeeze of the controller (below the lowest level) shortens everything a bit more
    const sq = squeeze(q.level, q.viewDistance);
    if (lvl === this.lodLevel && Math.abs(sq - this.lodSqueeze) < 0.005) return;
    this.lodLevel = lvl;
    this.lodSqueeze = sq;
    const lod = LOD[lvl];
    this.lod = lod;
    this.sky.setView(loadMetres(q.viewDistance), lod);
    this.camera.far = this.sky.far;
    this.camera.updateProjectionMatrix();
    this.cam.far = this.sky.far;
    this.sky.setLights(lod.sun, lod.hemi);
    this.trees?.setLevel(lvl);
    if (this.trees) this.trees.reach = this.sky.far;
    this.smoke.density = q.particles;
    this.peds.maxPeds = Math.max(4, Math.round(lod.peds * sq));
    // (cars are only simulated inside what the haze shows)
    this.traffic.spawnMax = clamp(this.sky.far * 0.95, 120, 250);
    this.applyDensity();
  }

  /** the number of AI cars: the level's density (and the squeeze), none in the drift area, the test option on top */
  private applyDensity(): void {
    this.traffic.density = this.mode === "drift" ? 0 : this.lod.density * this.lodSqueeze * (this.qopt.traffic ?? 1);
  }

  /**
   * What the first picture does not need arrives afterwards, one step per frame at most: traffic models and the image light,
   * trees, street furniture. Meanwhile the district around the car is built a little per frame (`boost` stretches the time
   * allowed per frame: on the loading screen and the countdown nobody sees a slow frame).
   */
  private stream(x: number, z: number, dt: number, boost: number): void {
    this.streamT += dt;
    if (this.stage === 0 && this.streamT > 0.15) {
      this.stage = 1;
      this.trafficR = new TrafficRenderer(this.carMats, this.L);
      this.root.add(this.trafficR.group);
      if (LOD[this.built].hdr) void this.loadEnv();
    } else if (this.stage === 1 && this.streamT > 0.8) {
      this.stage = 2;
      this.trees = new TreeLayer(this.gl, this.built, this.precompile);
      this.root.add(this.trees.group);
      this.lodLevel = null;
      this.applyLod();
    } else if (this.stage === 2 && this.streamT > 1.6) {
      this.stage = 3;
      if (LOD[this.built].props) {
        this.props = new PropLayer(this.precompile);
        this.root.add(this.props.group);
      }
    }
    const e = this.engine;
    // few tiles yet: more time per frame and up to three tiles finished (the loading screen / countdown); later one tile per frame
    const few = this.streamer.loadedCount < 9;
    const until = performance.now() + this.lod.workMs * boost * (few ? 3 : 1);
    this.streamer.update(x, z, e.quality.viewDistance, dt, until, few ? 3 : 1);
    this.trees?.update(dt, x, z, this.streamer.sources, this.streamer.version);
    this.props?.update(this.streamer.sources, this.streamer.version, this.lod.props);
  }

  /** Called while the engine shows its loading screen (the game frame does not run yet): builds the district meanwhile. */
  preload(dt: number): void {
    if (!this.alive) return;
    this.keepShadowsOff();
    this.applyLod();
    const sp = spawnFor(this.L, this.mode);
    this.stream(sp.x, sp.z, dt, 2.5);
  }

  private runPicker(dt: number): void {
    const pk = this.picker!;
    const c = this.controls;
    const k = this.engine.keys;
    const next = k.has("ArrowRight") || k.has("ArrowLeft") || k.has("Tab") || k.has("ArrowDown") || k.has("d") || k.has("a");
    const conf = k.has("Enter") || k.has("ArrowUp");
    const edges = { next: next && !this.keyPrev.next, confirm: conf && !this.keyPrev.confirm };
    this.keyPrev.next = next;
    this.keyPrev.confirm = conf;
    // the pedals select; the keyboard keys must not also steer/brake (they are the same keys): use only pad/leg values in the menu
    const gas = c.source === "keys" ? 0 : c.gas;
    const brake = c.source === "keys" ? 0 : c.brake;
    const before = pk.step;
    pk.update(dt, gas, brake, k, edges);
    if (pk.stepId === "body" || pk.step !== before) this.input.setOptions({ seated: pk.choice.seated });
    this.choice = { ...pk.choice };
    // live preview of car / colour
    const spec = CARS[this.choice.car];
    if (this.playerCar.spec?.id !== this.choice.car || this.playerCar.spec === null) this.makeCarIfChanged();
    this.carMats.paint.color.set(spec.colors[this.choice.color] ?? spec.colors[0]);
    if (pk.done) {
      this.picker = null;
      this.phase = "driving";
      this.mode = this.choice.mode;
      this.startSession();
    }
  }

  private stepSim(dt: number, now: number): void {
    const e = this.engine;
    const car = this.car!;
    const phys = this.phys!;
    const L = this.L;
    const c = this.controls;
    this.clock += dt;
    this.sessionLeft -= dt;
    for (const m of this.hud.msgs) m.t -= dt;
    while (this.hud.msgs.length && this.hud.msgs[0].t <= 0) this.hud.msgs.shift();
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hud.hint = "";
    }

    // ---- environment: weather and time of day
    this.updateWeather(dt);
    const t01 = this.timeFixed ?? (this.timeStart + this.clock / DAY_SECONDS) % 1;
    this.sky.set(t01, this.rainNow);
    this.mats.setWet(clamp(this.rainNow * 1.1, 0, 1));

    // ---- controls -> car
    const steerHelp = this.kids && this.mode !== "drift" ? laneAssist(L, car.body.translation().x, car.body.translation().z, car.fx, car.fz, Math.abs(car.speed), CONTROL_DEFAULTS.kidsLaneAssist) : 0;
    const inp = car.input;
    // gentle start: from a standstill the engine gives ~55 % of the pedal, full power from ~5 m/s (no wheelspin, no lurch)
    // (a released pedal stays exactly 0: the factor only shapes a gas that is really there)
    const launch = 0.55 + 0.45 * clamp(Math.abs(car.speed) / 5, 0, 1);
    inp.gas = c.gas > 0 ? c.gas * launch : 0;
    inp.brake = c.brake;
    inp.steer = clamp(c.steer + steerHelp, -1, 1);
    inp.handbrake = c.handbrake;
    inp.reverse = c.reverse;
    if (c.gearEdge) {
      this.msg(c.reverse ? "Orqaga yurish (R)" : "Oldinga yurish (D)", "#ffd23f", 1600);
      e.audio.beep(true);
    }
    if (c.camToggle) {
      const m = this.cam.toggle();
      this.msg(m === "cockpit" ? "Kabinadan ko‘rinish" : "Orqadan ko‘rinish", "#9fe8ff", 1400);
      e.audio.click();
    }

    // ---- physics (fixed steps); the car waits until the floor under it exists
    const pos = car.body.translation();
    if (this.streamer.groundReady(pos.x, pos.z)) {
      const surf = surfaceAt(L, pos.x, pos.z);
      const env = { surface: SURFACE_GRIP[surf], wet: this.rainNow };
      car.body.setLinearDamping(surf === "grass" ? 0.35 : 0.02);
      let impact = 0;
      phys.advance(
        dt,
        (h) => {
          const v = car.body.linvel();
          this.prevV.x = v.x;
          this.prevV.z = v.z;
          car.update(h, env);
        },
        () => {
          const v = car.body.linvel();
          impact = Math.max(impact, Math.hypot(v.x - this.prevV.x, v.z - this.prevV.z));
        },
      );
      if (impact > 1.15) this.crash(this.crashText(car));
    }
    const p = car.body.translation();
    const q = car.body.rotation();

    // ---- respawn: river, flipped
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    this.flipT = upY < 0.3 ? this.flipT + dt : 0;
    if (p.y < -2.2 || this.flipT > 1.8 || Math.abs(p.x) > 1e5) {
      const fell = p.y < -2.2;
      this.respawn();
      this.crash(fell ? "Daryoga tushdingiz!" : "Mashina ag‘darilib ketdi!");
    }
    this.lastSafe.t += dt;
    if (this.lastSafe.t > 1 && car.grounded >= 3 && upY > 0.9 && Math.abs(car.speed) > 2 && surfaceAt(L, p.x, p.z) !== "grass") {
      this.lastSafe = { x: p.x, z: p.z, fx: car.fx, fz: car.fz, t: 0 };
    }
    this.inv = Math.max(0, this.inv - dt);

    // ---- traffic + pedestrians
    const obstacle = this.obstacle;
    obstacle.x = p.x;
    obstacle.z = p.z;
    obstacle.fx = car.fx;
    obstacle.fz = car.fz;
    obstacle.speed = Math.abs(car.speed);
    this.traffic.update(dt, this.clock, obstacle);
    this.peds.update(dt, p.x, p.z);
    this.collideTraffic(car, p);

    // ---- rules
    const onRoad = surfaceAt(L, p.x, p.z) !== "grass";
    if (this.mode !== "drift") {
      const vs = this.sample;
      vs.x = p.x;
      vs.z = p.z;
      vs.speed = Math.abs(car.speed);
      vs.fx = car.fx;
      vs.fz = car.fz;
      vs.onRoad = onRoad;
      vs.grounded = car.grounded >= 3;
      this.rules.update(dt, vs);
      const hit = this.peds.hit(p.x, p.z, car.fx, car.fz);
      if (hit && Math.abs(car.speed) > 0.5 && this.inv <= 0) {
        this.peds.knock(hit);
        this.inv = Math.max(this.inv, 1.5);
        car.body.setLinvel({ x: car.vx * 0.2, y: 0, z: car.vz * 0.2 }, true);
        e.audio.horn();
        this.rules.report("pedHit", "Piyoda! Juda xavfli — tormoz bering!");
      }
      if (this.mode !== "imtihon") {
        const ds = Math.max(0, car.speed) * dt;
        this.distance += ds;
        this.score += ds * RULE_DEFAULTS.score.perMetre;
      }
    } else {
      const zn = zoneAt(L, p.x, p.z);
      this.drift.update(dt, car.slip, Math.abs(car.speed), car.grounded >= 3, !!zn && zn.kind === "maydon");
      this.score = this.drift.score;
    }
    this.countOvertakes(car, p);
    this.modeLogic(dt, car, p);

    // ---- audio
    const sp = Math.abs(car.speed);
    const gear = gearOf(sp);
    e.audio.engineSet(gear.rpm, car.input.gas);
    const sliding = car.grounded >= 2 && ((Math.abs(car.slip) > 0.28 && sp > 6) || (car.input.handbrake && sp > 5));
    if (sliding) e.audio.screech(clamp(Math.abs(car.slip) * 1.5 + 0.3, 0.3, 1));

    // ---- HUD numbers (throttled)
    this.hudT += dt;
    if (this.hudT > 0.2) {
      this.hudT = 0;
      this.refreshHudApi();
    }
    // end of the session
    if (this.phase === "driving") {
      if (this.endAt >= 0 && this.clock >= this.endAt) this.finishMode();
      else if (this.sessionLeft <= 0) this.finishMode();
      else if (this.mode === "missiya" && this.missions?.allDone) this.finishMode();
    }
    void now;
  }

  private crashText(car: RaycastCar): string {
    return Math.abs(car.speed) > 3 ? "To‘siqqa urildingiz!" : "To‘qnashuv!";
  }

  private updateWeather(dt: number): void {
    if (this.mode === "erkin" && this.qopt.rain === undefined) {
      // a shower in the middle of a free drive
      const t = this.clock;
      const want = t > 75 && t < 135 ? 1 : 0;
      if (want !== this.rainTarget) {
        this.rainTarget = want;
        this.msg(want ? "Yomg‘ir boshlandi — yo‘l sirpanchiq, ehtiyot bo‘ling" : "Yomg‘ir tindi", "#9fd4ff", 3200);
      }
    }
    this.rainNow += clamp(this.rainTarget - this.rainNow, -dt / 6, dt / 6);
  }

  private respawn(): void {
    const car = this.car!;
    const s = this.lastSafe;
    car.place(s.x, rideHeight(car.spec) + 0.25, s.z, yawOf(s.fx, s.fz));
    this.cam.snap();
    this.flipT = 0;
    this.prevV.x = this.prevV.z = 0;
  }

  private collideTraffic(car: RaycastCar, p: { x: number; z: number }): void {
    if (this.inv > 0) return;
    for (const a of this.traffic.cars) {
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      if (dx * dx + dz * dz > 49) continue;
      const lz = dx * car.fx + dz * car.fz;
      const lx = dx * -car.fz + dz * car.fx;
      // the AI car's own heading matters little at this size: use an axis box in the player's frame
      if (Math.abs(lz) < (a.len + 4.35) / 2 - 0.2 && Math.abs(lx) < 1.85) {
        this.traffic.bump(a, 2);
        car.body.setLinvel({ x: car.vx * 0.25 - car.fx * 1.5, y: 0, z: car.vz * 0.25 - car.fz * 1.5 }, true);
        this.crash(a.fx * car.fx + a.fz * car.fz < -0.3 ? "Qarama-qarshi mashina bilan to‘qnashdingiz!" : "Mashinaga urildingiz!");
        return;
      }
    }
  }

  private countOvertakes(car: RaycastCar, p: { x: number; z: number }): void {
    for (const a of this.traffic.cars) {
      if (a.fx * car.fx + a.fz * car.fz < 0.7) continue;
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      if (dx * dx + dz * dz > 900) continue;
      const lz = dx * car.fx + dz * car.fz;
      const prev = this.passedCars.get(a.id);
      const side = lz > 0 ? 1 : -1;
      if (prev === 1 && side === -1 && Math.abs(dx * -car.fz + dz * car.fx) < 6 && this.mode !== "imtihon" && this.mode !== "drift") {
        this.overtakes++;
        this.score += RULE_DEFAULTS.score.overtake;
        this.msg(`Quvib o‘tdingiz +${RULE_DEFAULTS.score.overtake}`, "#9fe8ff", 1400);
      }
      this.passedCars.set(a.id, side);
    }
    if (this.passedCars.size > 80) this.passedCars.clear();
  }

  // ------------------------------------------------------------------------------------------ modes

  private modeLogic(dt: number, car: RaycastCar, p: { x: number; z: number }): void {
    const L = this.L;
    this.gpsT -= dt;
    // target of the GPS
    let tgt: { x: number; z: number; r: number } | null = null;
    if (this.mode === "missiya" && this.missions) {
      this.missions.update(dt, p.x, p.z, car.speed);
      tgt = this.missions.target();
    } else if (this.mode === "imtihon") {
      const reg = L.landmarks.find((l) => l.id === "registon")!;
      const n = L.nodes.get(EXAM_NODES[Math.min(this.examIdx, EXAM_NODES.length - 1)])!;
      if (this.examIdx < EXAM_NODES.length - 1 && Math.hypot(p.x - n.x, p.z - n.z) < 16) this.examIdx++;
      tgt = this.examIdx >= EXAM_NODES.length - 1 ? { x: reg.x, z: reg.z, r: reg.r } : { x: n.x, z: n.z, r: 8 };
      if (Math.hypot(p.x - reg.x, p.z - reg.z) < reg.r && this.endAt < 0) {
        const res = this.exam.result(true);
        this.examDone = { passed: res.passed, penalty: res.penalty };
        this.endAt = this.clock + 0.5;
        this.msg(res.passed ? "Marshrut tugadi!" : "Marshrut tugadi", "#34d399", 2000);
      }
    } else if (this.mode === "drift") {
      const a = L.tileList.find((t) => t.id === "10,1")!;
      tgt = { x: a.cx, z: a.cz, r: 26 };
    } else {
      const lm = L.landmarks[this.gpsIdx % L.landmarks.length];
      if (this.engine.keys.has("g") && !this.gKey) {
        this.gpsIdx++;
        this.msg(`GPS: ${L.landmarks[this.gpsIdx % L.landmarks.length].name}`, "#9fe8ff", 1500);
      }
      this.gKey = this.engine.keys.has("g");
      tgt = { x: lm.x, z: lm.z, r: lm.r };
    }
    this.targetPt = tgt;
    if (this.gpsT <= 0 && tgt) {
      this.gpsT = 0.8;
      this.computeRoute(p.x, p.z, tgt);
    }
  }
  private gKey = false;

  private computeRoute(px: number, pz: number, tgt: { x: number; z: number }): void {
    const L = this.L;
    const a = nearestNode(L, px, pz);
    const b = nearestNode(L, tgt.x, tgt.z);
    const pts: { x: number; z: number }[] = [{ x: px, z: pz }];
    if (a && b) {
      const ids = findRoute(L, a.id, b.id);
      for (const id of ids) {
        const n = L.nodes.get(id)!;
        pts.push({ x: n.x, z: n.z });
      }
    }
    pts.push({ x: tgt.x, z: tgt.z });
    // drop the first node when it is behind us
    if (pts.length > 3) {
      const car = this.car!;
      const n1 = pts[1];
      const ahead = (n1.x - px) * car.fx + (n1.z - pz) * car.fz;
      if (ahead < 0 && Math.hypot(n1.x - px, n1.z - pz) < 70) pts.splice(1, 1);
    }
    this.route = pts;
  }

  private finish(text: string): void {
    this.msg(text, "#ff5a6a", 3000);
    this.phase = "over";
    this.finishMode(text);
  }

  private finishMode(reason = ""): void {
    if (this.phase === "over" && !reason) return;
    this.phase = "over";
    const e = this.engine;
    const km = (this.distance / 1000).toFixed(2);
    let result: Parameters<EngineApi["finish"]>[0];
    if (this.mode === "imtihon") {
      const completed = !!this.examDone;
      const r = this.exam.result(completed);
      const score = r.passed ? Math.max(2600, 5200 - r.penalty * 300) : Math.max(0, 1500 - r.penalty * 100);
      result = { score, lines: [...r.lines, ["Masofa", km + " km"]], stats: { passed: r.passed ? 1 : 0, penalty: r.penalty } };
      this.examDone = { passed: r.passed, penalty: r.penalty };
    } else if (this.mode === "drift") {
      const d = this.drift;
      d.bank();
      result = {
        score: d.total,
        lines: [["Drift ochkosi", d.total], ["Eng yaxshi seriya", d.bestChain], ["Seriyalar", d.chains], ["Avariyalar", this.crashes]],
        stats: { drift: d.total },
      };
    } else {
      const lines: [string, string | number][] = [
        ["Masofa", km + " km"],
        ["Quvib o‘tishlar", this.overtakes],
        ["Qoidaga rioya", `✅ ${this.rules.ok} · ❌ ${this.rules.bad}`],
        ["Avariyalar", this.crashes],
      ];
      if (this.missions) lines.push(["Missiyalar", `${this.missions.completed} / ${MISSIONS.length}`]);
      result = { score: Math.round(this.score), lines };
    }
    e.finish(result);
    this.phase = "over";
    this.audioOn = false;
  }

  private refreshHudApi(): void {
    const e = this.engine;
    const m = this.mode;
    const left = m === "missiya" && this.missions?.current ? this.missions.timeLeft : this.sessionLeft;
    const comboTxt = m === "drift" && this.drift.combo > 1 ? `×${this.drift.combo}` : null;
    e.hud.set({
      score: m === "imtihon" ? Math.max(0, 100 - this.exam.penalty * 10) : this.score,
      time: Math.max(0, Math.ceil(left)),
      combo: comboTxt,
      bar: clamp(this.sessionLeft / this.duration, 0, 1),
    });
  }

  // ------------------------------------------------------------------------------------------ visuals

  private updateVisuals(dt: number, now: number): void {
    const car = this.car!;
    const e = this.engine;
    const L = this.L;
    const t = car.body.translation();
    const q = car.body.rotation();
    this.playerCar.update(car);
    const cockpit = this.cam.mode === "cockpit";
    this.playerCar.group.visible = !cockpit && !(this.inv > 0 && Math.sin(now / 60) > 0);
    // streaming + sky (the view and the counts follow the quality level, live)
    this.stream(t.x, t.z, dt, 1);
    this.sky.follow(t.x, t.z);
    if (this.phase !== "driving" && this.phase !== "over") {
      const t01 = this.timeFixed ?? 0.42;
      if (this.clock === 0) this.sky.set(t01, 0);
    }
    // camera
    this.cam.update(dt, t.x, t.y, t.z, car.fx, car.fz, car.vx, car.vz, car.speed, q);
    // light at night: the headlight pool on the road (no light source), the image light fades with the daylight
    const night = this.sky.state.night;
    this.headGlow.update(night, t.x, t.y - rideHeight(car.spec), t.z, car.fx, car.fz);
    if (this.envOn) this.scene.environmentIntensity = this.lod.env * (0.12 + 0.88 * (1 - night));
    // traffic, pedestrians, signal lamps
    this.trafficR?.update(this.traffic.cars);
    this.pedR.update(this.peds.peds);
    // (the signals change every few seconds: ten checks a second are plenty)
    this.lampT -= dt;
    if (this.lampT <= 0) {
      this.lampT = 0.1;
      this.lamps.update(this.lampColor);
    }
    // effects
    this.updateFx(dt, car, t);
    this.rain.update(this.clock, this.camera.position, clamp(this.rainNow * 1.3, 0, 1) * Math.min(1, this.lod.rain / this.rainAlloc) * (e.quality.particles > 0.3 ? 1 : 0.5));
    this.smoke.update(dt, e.stage.h);
    // beacon at the mission target / pickup
    if (this.targetPt && (this.mode === "missiya" || this.mode === "imtihon")) {
      const y = bridgeDeckY(L, this.targetPt.x, this.targetPt.z);
      this.beacon.set(this.targetPt.x, this.targetPt.z, Math.max(2.5, this.targetPt.r * 0.5), this.mode === "imtihon" ? 0x34d399 : 0xffd23f, this.clock);
      this.beacon.mesh.position.y = 30 + y;
    } else this.beacon.hide();
    this.refreshHudModel(car, t);
  }

  private updateFx(dt: number, car: RaycastCar, t: { x: number; y: number; z: number }): void {
    const s = car.spec;
    const sp = Math.abs(car.speed);
    const slidingBody = Math.abs(car.slip) > 0.3 && sp > 5;
    for (let i = 0; i < 4; i++) {
      // wheel contact point on the ground, in world space (chassis frame -> world)
      const lx = i % 2 === 0 ? s.trackHalf : -s.trackHalf;
      const lz = i < 2 ? s.wheelBase / 2 : -s.wheelBase / 2;
      const wx = t.x + lx * -car.fz + lz * car.fx;
      const wz = t.z + lx * car.fx + lz * car.fz;
      const rear = i >= 2;
      const lock = car.input.handbrake && rear && sp > 3;
      const slide = car.wheelContact[i] && (lock || (slidingBody && (rear || sp > 14)) || (car.input.brake > 0.9 && sp > 18));
      this.skid.wheel(i, wx, t.y - rideHeight(s) + 0.01, wz, car.fx, car.fz, slide);
      if (slide && rear && Math.random() < dt * 28) this.smoke.emit(wx, t.y - rideHeight(s), wz, car.vx, car.vz);
    }
  }

  private refreshHudModel(car: RaycastCar, t: { x: number; z: number }): void {
    const h = this.hud;
    const c = this.controls;
    h.mode = this.mode;
    h.kmh = Math.abs(car.speed) * 3.6;
    h.limit = this.mode === "drift" ? Infinity : this.rules.limit;
    h.reverse = c.reverse;
    h.gas = c.gas;
    h.brake = c.brake;
    h.steer = c.steer;
    h.handsOk = c.handsOk || c.source !== "body";
    h.legsOk = c.legsOk || c.source !== "body";
    const lg = h.legs;
    lg.ready = c.legsReady || c.source !== "body";
    lg.calib = c.legsCalib;
    lg.sitting = c.legsSitting;
    lg.gasRaw = c.gasRaw;
    lg.brakeRaw = c.brakeRaw;
    lg.gasThr = c.gasThr;
    lg.brakeThr = c.brakeThr;
    lg.okGas = c.okGas;
    lg.okBrake = c.okBrake;
    lg.keys = c.source !== "body";
    h.kids = this.kids;
    h.seated = this.seated;
    h.handbrake = c.handbrake;
    h.px = t.x;
    h.pz = t.z;
    h.fx = car.fx;
    h.fz = car.fz;
    h.cars = this.traffic.cars;
    h.route = this.route;
    h.target = this.targetPt;
    h.cockpit = this.cam.mode === "cockpit";
    h.night = this.sky.state.night;
    h.raining = this.rainNow > 0.3;
    h.clock = this.clock;
    // GPS arrow
    let np: { x: number; z: number } | null = null;
    for (let i = 1; i < this.route.length; i++) {
      const r = this.route[i];
      if (Math.hypot(r.x - t.x, r.z - t.z) > 16 || i === this.route.length - 1) {
        np = r;
        break;
      }
    }
    this.nextPt = np;
    if (np) {
      const vx = np.x - t.x;
      const vz = np.z - t.z;
      h.gpsAngle = Math.atan2(vx * -car.fz + vz * car.fx, vx * car.fx + vz * car.fz);
      const tg = this.targetPt;
      h.gpsDist = tg ? Math.hypot(tg.x - t.x, tg.z - t.z) : Math.hypot(vx, vz);
      h.gpsName = this.gpsLabel();
    }
    h.mission =
      this.mode === "missiya" && this.missions?.current
        ? { title: this.missions.current.title, timeLeft: this.missions.timeLeft, sub: this.missions.current.kind === "ride" ? (this.missions.passenger ? "Yo‘lovchi bor — manzilga eltib qo‘ying" : "Yo‘lovchini oling (to‘xtang)") : "Manzilga yetib boring" }
        : null;
    h.exam = this.mode === "imtihon" ? { penalty: this.exam.penalty, limit: RULE_DEFAULTS.examLimit, last: "" } : null;
    h.drift = this.mode === "drift" ? { chain: this.drift.chain, combo: this.drift.combo, total: this.drift.total, angle: this.drift.angle, drifting: this.drift.drifting } : null;
    if (this.picker) {
      const o = this.picker.options();
      h.picker = { step: this.picker.stepId, options: o.labels, subs: o.subs, selected: o.selected, index: Math.min(this.picker.step, 3), count: 4 };
    } else h.picker = null;
  }

  private gpsLabel(): string {
    if (this.mode === "imtihon") return this.examIdx >= EXAM_NODES.length - 1 ? "Registon (marshrut oxiri)" : "Marshrut bo‘yicha";
    if (this.mode === "missiya" && this.missions?.current) return this.missions.current.kind === "ride" && !this.missions.passenger ? "Yo‘lovchi" : (this.L.landmarks.find((l) => l.id === this.missions!.current!.target)?.name ?? "");
    if (this.mode === "drift") return "Drift maydoni";
    return this.L.landmarks[this.gpsIdx % this.L.landmarks.length].name;
  }

  /** 2D overlay: speedometer, pedals, wheel, mini-map, GPS arrow, messages, menu. */
  draw(c: CanvasRenderingContext2D, e: EngineApi, now: number): void {
    this.hudView.w = e.stage.w;
    this.hudView.h = e.stage.h;
    if (!this.car) return;
    drawHud(c, e.stage.w, e.stage.h, this.hud, this.L, now);
  }

  // ------------------------------------------------------------------------------------------ test hook

  snapshot(): ProbeState {
    const car = this.alive ? this.car : null;
    const p = car ? car.body.translation() : { x: 0, y: 0, z: 0 };
    const t = this.streamer;
    return {
      phase: this.phase,
      mode: this.mode,
      clock: this.clock,
      score: this.score,
      car: car
        ? { x: p.x, y: p.y, z: p.z, fx: car.fx, fz: car.fz, speed: car.speed, kmh: Math.abs(car.speed) * 3.6, slipDeg: (car.slip * 180) / Math.PI, grounded: car.grounded }
        : { x: 0, y: 0, z: 0, fx: 0, fz: 1, speed: 0, kmh: 0, slipDeg: 0, grounded: 0 },
      input: { gas: this.controls.gas, brake: this.controls.brake, steer: this.controls.steer, handbrake: this.controls.handbrake, reverse: this.controls.reverse, source: this.controls.source },
      legs: { ready: this.controls.legsReady, calib: this.controls.legsCalib, gasRaw: this.controls.gasRaw, brakeRaw: this.controls.brakeRaw, okGas: this.controls.okGas, okBrake: this.controls.okBrake },
      verdicts: this.verdicts.map((v) => ({ kind: v.kind, ok: v.ok })),
      penalty: this.exam.penalty,
      drift: { total: this.drift.total, chain: this.drift.chain, combo: this.drift.combo, chains: this.drift.chains, best: this.drift.bestChain },
      tiles: { loaded: t.loadedCount, built: t.built, released: t.released, pending: t.pending, ids: t.ids() },
      traffic: { cars: this.traffic.cars.length, spawned: this.traffic.spawned, overtakes: this.traffic.overtakes },
      target: this.targetPt,
      next: this.nextPt,
      wet: this.mats.wet,
      night: this.sky.state.night,
      crashes: this.crashes,
      lives: this.hp,
      exam: this.examDone,
      missions: this.missions ? { index: this.missions.index, completed: this.missions.completed, failed: this.missions.failed, id: this.missions.current?.id ?? "" } : null,
      ready: !!this.car && !!this.phys,
      cam: this.cam.mode,
      limit: this.rules.limit,
    };
  }

  /**
   * What is ahead of the car, for the e2e autopilot / debugging: the nearest stop line (STOP, light, zebra, give way) in
   * the car's lane within 60 m, the car in front, and whether the intersection box is busy.
   */
  oracle(): Oracle {
    const car = this.car;
    const out: Oracle = { stop: null, leader: null, boxBusy: false };
    if (!car || !this.alive) return out;
    const p = car.body.translation();
    let best = Infinity;
    for (const d of this.L.rules) {
      const dx = p.x - d.x;
      const dz = p.z - d.z;
      const along = dx * d.dx + dz * d.dz;
      if (along > 1 || along < -60) continue;
      if (car.fx * d.dx + car.fz * d.dz < 0.7) continue;
      if (Math.abs(-dx * d.dz + dz * d.dx) > d.half + 1.6) continue;
      const dist = -along;
      if (dist < best) {
        best = dist;
        out.stop = {
          type: d.type,
          dist,
          color: d.type === "light" ? lightColor(this.clock, d.axis, this.L.tiles.get(d.node)!.offset) : null,
          peds: d.type === "zebra" ? this.peds.block(d.zebra) : false,
          cross: d.type === "stop" || d.type === "giveWay" ? this.traffic.crossTrafficNear(d.node, d.dx, d.dz, 35) : false,
        };
      }
    }
    for (const a of this.traffic.cars) {
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      const ahead = dx * car.fx + dz * car.fz;
      if (ahead <= 0 || ahead > 45) continue;
      if (Math.abs(dx * -car.fz + dz * car.fx) > 2.4) continue;
      const gap = ahead - a.len / 2 - 2.2;
      if (!out.leader || gap < out.leader.gap) out.leader = { gap, v: a.v * (a.fx * car.fx + a.fz * car.fz) };
    }
    for (const n of this.L.nodes.values()) {
      if (n.kind !== "city") continue;
      if (Math.abs(n.x - p.x) < 40 && Math.abs(n.z - p.z) < 40 && this.traffic.crossTrafficNear(n.id, car.fx, car.fz, 12)) out.boxBusy = true;
    }
    return out;
  }

  /** Tests: pedestrians start crossing at this zebra immediately. */
  debugForcePeds(zebra: string): boolean {
    return this.peds.forceGroup(zebra);
  }

  /** Set the traffic-light clock (tests: start at a known phase). */
  debugSetClock(t: number): void {
    this.clock = t;
  }

  /** Teleport the car (tests: free-drive streaming across the map). */
  debugTeleport(x: number, z: number, fx: number, fz: number): void {
    const car = this.car;
    if (!car) return;
    car.place(x, rideHeight(car.spec) + 0.3, z, yawOf(fx, fz));
    this.lastSafe = { x, z, fx, fz, t: 0 };
    this.cam.snap();
  }

  dispose(): void {
    this.alive = false;
    this.phase = "over";
    const w = window as unknown as { __mashina?: Probe };
    if (w.__mashina === this.probeObj) delete w.__mashina;
    this.car?.dispose();
    this.car = null;
    this.streamer.dispose();
    this.phys?.dispose();
    this.phys = null;
    this.trafficR?.dispose();
    this.trees?.dispose();
    this.props?.dispose();
    this.pedR.dispose();
    this.lamps.dispose();
    this.skid.dispose();
    this.smoke.dispose();
    this.rain.dispose();
    this.beacon.dispose();
    this.headGlow.dispose();
    this.playerCar.dispose();
    this.sky.dispose();
    for (const w of this.warm)
      w.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
    this.mats.dispose();
    this.carMats.dispose();
    this.atlas.texture.dispose();
    disposeCarParts();
    disposeModels();
    this.cube?.dispose();
    this.envTex?.dispose();
    this.probeRT?.dispose();
    this.root.clear();
    // give the engine's scene, camera and renderer back the way we found them
    this.gl.shadowMap.enabled = this.savedShadow;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.environment = this.camSaved.env;
    this.scene.environmentIntensity = this.camSaved.envK;
    const cam = this.camera;
    cam.fov = this.camSaved.fov;
    cam.near = this.camSaved.near;
    cam.far = this.camSaved.far;
    cam.position.copy(this.camSaved.pos);
    cam.quaternion.copy(this.camSaved.quat);
    cam.updateProjectionMatrix();
  }
}

function engineKids(e: EngineApi): boolean {
  return e.kids;
}

export function modeName(m: ModeId): string {
  return m === "erkin" ? "Erkin haydash" : m === "missiya" ? "Missiyalar" : m === "imtihon" ? "YHQ imtihoni" : "Drift";
}

function hearts(n: number, max: number): string {
  return "❤".repeat(Math.max(0, Math.min(n, max))) + "♡".repeat(Math.max(0, max - Math.max(0, n)));
}

const GEAR_TOPS = [0, 9, 17, 26, 36, 48, 70];
/** Fake gearbox for the engine sound: rpm 0.2..1 inside each gear. */
export function gearOf(speed: number): { gear: number; rpm: number } {
  let g = 1;
  while (g < GEAR_TOPS.length - 1 && speed > GEAR_TOPS[g]) g++;
  const lo = GEAR_TOPS[g - 1];
  const hi = GEAR_TOPS[g];
  return { gear: g, rpm: 0.2 + 0.8 * clamp((speed - lo) / (hi - lo), 0, 1) };
}
