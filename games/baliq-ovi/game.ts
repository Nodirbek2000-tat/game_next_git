// BaliqRig: the whole "Baliq ovi" game (imperative, created once when the Scene mounts, disposed on unmount).
// Owns: world, water, fish simulation, 1-2 anglers, modes (solo / Birgalikda / Musobaqa), HUD, the lobby and the
// collection screen. Nothing is allocated per frame.

import * as THREE from "three";
import { disposeTree, type EngineApi, type PlayerFrame } from "@/engine";
import { AssetLib } from "./assets";
import { Angler, type Host } from "./angler";
import { collectionSize, loadCollection, recordCatch, saveCollection, type Collection } from "./collection";
import { Ripples, Splashes, makeRain } from "./effects";
import { AState, FishSim, type Agent, type Bait } from "./fishai";
import { FishViews } from "./fishViews";
import type { AnglerInput } from "./gestures";
import { bedDepth, LAKE, LOCATIONS, rollWeather, TIMES_OF_DAY, waveHeight, type LocationConfig, type TimeOfDayPreset, type WeatherState } from "./locations";
import {
  addCatch, clamp, coopDone, duelWinner, netHelpApplies, TUNING, type GameMode, type Tuning, lineInDanger,
} from "./rules";
import { GameSfx } from "./sfx";
import { SPECIES, pickSpecies, rollWeight, type SpeciesDef } from "./species";
import { makeDepthTexture, makeWaterNormal } from "./textures";
import { buildWaterGeometry, createWaterMaterial, L_NOREFL, L_UNDER, makeTint, WaterPasses } from "./water";
import { buildWorld, flattenModel, updateWorld, type WorldObjects } from "./world";
import { collectionRects, lobbyRects, optionRects } from "./layout";
import { drawOverlay } from "./overlay";
import { EYE, FOV, headTurn, lookPitch, ViewController, emptyHead } from "./view";
import { VoiceControl, type VoiceCtx, type VoiceEventKind } from "./voice";
import { loadVoicePref, saveVoicePref, VoiceInput } from "./voiceInput";

export type Phase = "options" | "lobby" | "play" | "collection" | "done";

/** where the ambient fish live: the shallows in front of the bridge (visible from the player's eyes) */
const HOME = { x: 0, z: -6, r: 12 };
const CONFETTI = ["#ff5a7a", "#ffd23f", "#34d399", "#4cc9ff", "#b388ff", "#ff9f43"];
const BLUE = 0x2fa8ff;
const YELLOW = 0xffc83d;
const SWING_KEYS = ["e", "ArrowUp"];
const REEL_KEYS = ["r", "l"];
const PUMP_KEYS = ["f", "j"];
const NET_KEYS = ["n", "u"];

function anyKey(keys: ReadonlySet<string>, arr: readonly string[], solo: boolean, ki: number): boolean {
  if (!solo) return keys.has(arr[ki]);
  for (let n = 0; n < arr.length; n++) if (keys.has(arr[n])) return true;
  return false;
}

export interface UiState {
  /** hand pointer (stage px) */
  px: number;
  py: number;
  pointer: boolean;
  /** lobby: hovered card 0/1 and dwell progress */
  hover: number;
  prog: number;
  /** collection */
  sel: number;
  btnProg: number;
  /** last frame values for drawing */
  w: number;
  h: number;
}

export class BaliqRig implements Host {
  /** the location (data): the lake now; Zarafshon / reservoir are added to LOCATIONS later and chosen with ?loc=<id> */
  readonly loc: LocationConfig;
  readonly weather: WeatherState;
  readonly preset: TimeOfDayPreset;
  readonly tuning: Tuning;
  readonly rng = Math.random;
  readonly assets = new AssetLib();
  readonly sfx: GameSfx;
  readonly sim: FishSim;
  readonly views: FishViews;
  readonly ripples: Ripples;
  readonly splashes: Splashes;
  readonly anglers: Angler[] = [];
  readonly collection: Collection;
  readonly world: WorldObjects;
  readonly passes: WaterPasses;
  readonly waterMat: THREE.ShaderMaterial;
  readonly waterMesh: THREE.Mesh;
  readonly rain: THREE.LineSegments | null;
  readonly waveAmp: number;
  readonly ui: UiState = { px: 0, py: 0, pointer: false, hover: -1, prog: 0, sel: 0, btnProg: 0, w: 1280, h: 720 };
  readonly particleScale: number;
  readonly force: string | null;
  readonly waitScale: number;
  readonly maxCast: number;
  /** first-person view (head turn / arrow keys) */
  readonly view = new ViewController();
  /** view direction (rad, + = right) read by the anglers */
  viewYaw = 0;
  pitchDeg = -6;
  /** voice play (kids): mixer + the microphone side */
  readonly voice = new VoiceControl();
  voiceIn: VoiceInput | null = null;
  /** the player wants the voice (pre-start option) */
  voiceWanted = false;
  /** the voice option is offered (one player only: one microphone cannot tell two players apart) */
  readonly voiceOffered: boolean;
  private head = emptyHead();
  private optLatch = false;
  private confettiCol = (): string => CONFETTI[(Math.random() * CONFETTI.length) | 0];

  mode: GameMode;
  phase: Phase = "play";
  t = 0;
  acceptInput = true;
  /** seconds of play left (counts only in phase "play") */
  timeLeft: number;
  readonly duration: number;
  readonly goalKg: number;
  graceUsed = 0;
  friendBonuses = 0;
  newSpecies = 0;
  endAt = 0;
  collectionAt = 0;
  finished = false;
  goalReached = false;
  private goalAt = 0;
  private bonusMsgT = 0;
  bonusText = "";
  private baits: Bait[] = [];
  private cam: THREE.PerspectiveCamera;
  private saved: { fov: number; near: number; far: number; pos: THREE.Vector3; exposure: number; layers: number };
  private hudAt = 0;
  private birdAt = 0;
  private sfxAt = 0;
  private sfxUpdAt = 0;
  private lastQuality: string;
  private ambientIdx: number[] = [];
  private disposables: { dispose(): void }[] = [];
  private tmp = new THREE.Vector3();
  private depthTex: THREE.Texture;
  private normalTex: THREE.Texture;
  private warnedAt = [0, 0];
  private lastCalls = 0;
  private lastTris = 0;
  warnCount = 0;
  private keyHeld = new Set<string>();
  private netHeld = [false, false];
  private disposedFlag = false;

  constructor(
    readonly engine: EngineApi,
    private group: THREE.Group,
    private three: { scene: THREE.Scene; camera: THREE.Camera; gl: THREE.WebGLRenderer },
  ) {
    const q = engine.query;
    this.loc = LOCATIONS[q.get("loc") ?? ""] ?? LAKE;
    const level = engine.quality.level;
    this.tuning = { kids: engine.kids, sensitivity: engine.sensitivity };
    this.weather = rollWeather(this.loc, Math.random, { tod: q.get("tod"), rain: q.get("rain"), wind: q.get("wind") });
    this.preset = TIMES_OF_DAY[this.weather.tod];
    this.waveAmp = 0.7 + this.weather.wind * 0.9;
    this.force = q.get("fish");
    this.waitScale = clamp(Number(q.get("wait") ?? 1) || 1, 0.05, 5);
    this.particleScale = engine.quality.particles;
    this.maxCast = Number(q.get("maxcast")) > 5 ? Number(q.get("maxcast")) : this.loc.maxCast;
    this.collection = loadCollection();

    // ---- mode
    const n = engine.playerCount;
    const qm = q.get("mode");
    this.mode = n === 1 ? "yolgiz" : qm === "musobaqa" ? "musobaqa" : "birgalikda";
    this.phase = n === 2 && qm !== "musobaqa" && qm !== "birgalikda" ? "lobby" : n === 1 && q.get("opts") !== "0" ? "options" : "play";
    this.voiceOffered = n === 1;
    this.voiceWanted = this.voiceOffered && (q.get("voice") === "1" ? true : q.get("voice") === "0" || this.phase !== "options" ? false : loadVoicePref(engine.kids));
    this.voice.lenient = engine.kids;
    this.acceptInput = this.phase === "play";
    this.duration = this.durationFor(this.mode);
    this.timeLeft = this.duration;
    this.goalKg = Number(q.get("goal")) > 0 ? Number(q.get("goal")) : TUNING.coopGoalKg;

    // ---- renderer state
    this.cam = three.camera as THREE.PerspectiveCamera;
    this.saved = { fov: this.cam.fov, near: this.cam.near, far: this.cam.far, pos: this.cam.position.clone(), exposure: three.gl.toneMappingExposure, layers: this.cam.layers.mask };
    this.cam.fov = FOV;
    this.cam.rotation.order = "YXZ";
    this.cam.near = 0.1;
    this.cam.far = 900 * (0.55 + 0.45 * engine.quality.viewDistance);
    this.cam.layers.enable(L_NOREFL);
    this.cam.updateProjectionMatrix();
    three.gl.toneMappingExposure = this.preset.exposure;

    // ---- world
    // underwater things fade to a clear teal (not to the near-black of the deep water) so fish stay readable in the shallows
    const tint = makeTint(new THREE.Color(this.loc.water.deep).lerp(new THREE.Color(this.loc.water.shallow), 0.55).getHex(), this.loc.water.clarity);
    this.world = buildWorld(this.loc, level, this.weather.tod, this.weather.rain, tint);
    group.add(this.world.group);
    three.scene.fog = this.world.fog;

    // ---- water
    this.normalTex = makeWaterNormal(level === "low" ? 128 : 256);
    this.depthTex = makeDepthTexture(this.loc, 128);
    this.disposables.push(this.normalTex, this.depthTex);
    const sunDir = new THREE.Vector3(...this.preset.sun).normalize();
    this.waterMat = createWaterMaterial({
      colors: { deep: this.loc.water.deep, shallow: this.loc.water.shallow, clarity: this.loc.water.clarity, skyTop: this.world.skyMat.uniforms.uTop.value.getHex(), skyHorizon: this.world.skyMat.uniforms.uHor.value.getHex(), fog: this.world.fog.color.getHex() },
      normal: this.normalTex,
      depthTex: this.depthTex,
      sun: sunDir,
      sunColor: new THREE.Color(this.preset.sunColor),
      dim: this.world.dim,
    });
    this.waterMat.uniforms.uAmp.value = this.waveAmp;
    this.waterMat.uniforms.uWind.value = this.weather.wind;
    this.waterMat.uniforms.uRain.value = this.weather.rain ? 1 : 0;
    this.waterMat.uniforms.uSkyTop.value.copy(this.world.skyMat.uniforms.uTop.value);
    this.waterMat.uniforms.uSkyHor.value.copy(this.world.skyMat.uniforms.uHor.value);
    this.waterMat.uniforms.uFog.value.copy(this.world.fog.color);
    const posts = this.world.posts.slice(0, 8);
    posts.forEach((p, i) => (this.waterMat.uniforms.uPosts.value[i] as THREE.Vector2).set(p[0], p[1]));
    this.waterMat.uniforms.uPostCount.value = posts.length;
    this.waterMesh = new THREE.Mesh(buildWaterGeometry(level === "high" ? 120 : level === "medium" ? 90 : 60), this.waterMat);
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 1;
    this.waterMesh.layers.set(0);
    this.waterMesh.name = "water";
    group.add(this.waterMesh);
    this.passes = new WaterPasses(this.waterMesh, this.waterMat, level, new THREE.Color(this.loc.water.deep).multiplyScalar(0.6));
    this.passes.setEnabled(level !== "low");
    this.lastQuality = level;
    // the (deprecated for low) transparent path needs the underwater layer in the main pass
    if (!this.passes.enabled) this.cam.layers.enable(L_UNDER);

    // ---- fish
    const ambient = level === "high" ? 12 : level === "medium" ? 9 : 6;
    const cap = ambient + 2;
    this.views = new FishViews(cap, 2, group, tint);
    this.views.prepareAll(SPECIES);
    this.sim = new FishSim(
      {
        depth: (x, z) => bedDepth(this.loc, x, z),
        minX: -42, maxX: 42, minZ: -62, maxZ: 6,
        rng: this.rng,
        activity: this.preset.activity * (this.weather.rain ? 1.2 : 1),
        home: HOME,
        speciesActivity: (si) => SPECIES[si].active[this.weather.tod],
      },
      cap,
      4,
    );
    const list: number[] = [];
    for (let i = 0; i < ambient; i++) list.push(SPECIES.indexOf(pickSpecies({ depth: 4, tod: this.weather.tod, weights: this.loc.speciesWeight, bigFishBoost: this.loc.bigFishBoost, rng: this.rng }) as SpeciesDef));
    this.ambientIdx = list.filter((i) => !SPECIES[i].junk);
    this.sim.populate(this.ambientIdx, HOME.x, HOME.z, HOME.r);
    this.sim.agents.forEach((a, i) => {
      if (a.active) this.views.setSpecies(i, SPECIES[a.species]);
    });
    this.sim.onEvent = (e, a) => {
      if (!a.visitor) return;
      const an = this.anglers[a.bait];
      if (!an) return;
      if (e === "nibble") an.onNibble();
      else if (e === "bite") an.onBite();
    };

    // ---- effects
    this.ripples = new Ripples((x, z) => this.water(x, z));
    this.splashes = new Splashes();
    group.add(this.ripples.mesh, this.splashes.points);
    this.rain = this.weather.rain ? makeRain(level === "low" ? 250 : 520) : null;
    if (this.rain) group.add(this.rain);
    this.disposables.push(this.splashes);
    this.sfx = new GameSfx(engine, this.assets);

    // ---- anglers
    const xs = n === 2 ? [-0.8, 0.8] : [0];
    const cols = [BLUE, YELLOW];
    for (let i = 0; i < n; i++) {
      const a = new Angler(i, cols[i], xs[i], this, group);
      a.body.material = a.body.material as THREE.Material;
      this.anglers.push(a);
      this.baits.push(a.bait);
    }
    this.loadModels();

    engine.hud.show(true);
    this.updateHud(true);
    this.applyCamera(0);
    // pre-warm one frame of everything so the first shown frame is correct
    this.syncFish(0);
    if (this.phase === "play") this.begin();
    this.sfx.ensure();
  }

  /**
   * Real models from assets.json replace the procedural geometry as soon as they are delivered (present: true). Every
   * entry is optional; a missing or broken file leaves the procedural version in place. Single-material models only.
   */
  private loadModels(): void {
    const lib = this.assets;
    const w = this.world;
    const swap = (key: string, targets: THREE.Mesh[]): void => {
      void lib.model(key).then((o) => {
        if (!o || this.disposedFlag) return;
        const f = flattenModel(o);
        if (!f) return;
        for (const t of targets) {
          t.geometry.dispose();
          t.geometry = f.geometry;
          if (f.material) t.material = f.material;
        }
      });
    };
    void lib.model("bridge").then((o) => o && !this.disposedFlag && w.setBridgeModel(o));
    swap("tree", [w.parts.crowns]);
    void lib.model("tree").then((o) => o && (w.parts.trunks.visible = false));
    swap("rock", [w.parts.shoreRocks, w.parts.bedRocks]);
    swap("weed", [w.parts.weeds]);
    swap("reed", [w.parts.reeds]);
    swap("boot", this.views.boots);
    swap("bottle", this.views.bottles);
    swap("float", this.anglers.map((a) => a.floatMesh));
    swap("angler", this.anglers.map((a) => a.body));
  }

  private durationFor(mode: GameMode): number {
    const q = Number(this.engine.query.get("duration"));
    if (q > 0) return q;
    return mode === "birgalikda" ? TUNING.coopSeconds : mode === "musobaqa" ? TUNING.duelSeconds : TUNING.soloSeconds;
  }

  /** The mode is chosen: reset the round and start the clock. */
  private begin(): void {
    this.phase = "play";
    this.acceptInput = true;
    this.timeLeft = this.durationFor(this.mode);
    for (const a of this.anglers) a.reset();
    this.sfx.ensure();
    this.sfx.startAmbience(this.weather.wind, this.weather.rain);
    this.engine.audio.ambStart("water");
    this.startVoice();
    const e = this.engine;
    if (this.mode === "birgalikda") e.say("Birgalikda", `Umumiy maqsad: ${this.goalKg} kg baliq`, 1800);
    else if (this.mode === "musobaqa") e.say("Musobaqa", `${Math.round(this.duration / 60 * 10) / 10} daqiqa — kim ko‘p tutadi`, 1800);
    this.updateHud(true);
  }

  // ------------------------------------------------------------------ Host
  get camera(): THREE.Camera {
    return this.cam;
  }
  water(x: number, z: number): number {
    return waveHeight(x, z, this.t, this.waveAmp, bedDepth(this.loc, x, z));
  }
  depthAt(x: number, z: number): number {
    return bedDepth(this.loc, x, z);
  }
  say(a: Angler, text: string, ms = 1600): void {
    a.say(text, ms);
  }
  pickFor(depth: number): SpeciesDef {
    return pickSpecies({ depth, tod: this.weather.tod, weights: this.loc.speciesWeight, bigFishBoost: this.loc.bigFishBoost, rng: this.rng, force: this.force ?? undefined });
  }
  rollW(sp: SpeciesDef): number {
    return rollWeight(sp, this.rng);
  }
  caught(a: Angler, sp: SpeciesDef, weight: number, friend: boolean): { pts: number; rec: { isNew: boolean; isRecord: boolean } } {
    let pts = addCatch(a.tally, sp, weight);
    if (friend) {
      const helper = this.anglers.find((x) => x !== a);
      if (helper) {
        helper.tally.score += TUNING.friendBonus;
        helper.say("Do‘stlik bonusi! +" + TUNING.friendBonus, 2400);
      }
      a.tally.score += TUNING.friendBonus;
      pts += TUNING.friendBonus;
      this.friendBonuses++;
      this.bonusText = "Do‘stlik bonusi!";
      this.bonusMsgT = 2.4;
      this.engine.say("Do‘stlik bonusi!", `+${TUNING.friendBonus} ochko`, 1800);
      this.engine.audio.combo(4);
    }
    const rec = recordCatch(this.collection, sp, weight);
    saveCollection(this.collection);
    if (rec.isNew && !sp.junk) this.newSpecies++;
    this.engine.fx.ring(a.slot === 0 ? this.ui.w * 0.25 : this.ui.w * 0.75, this.ui.h * 0.4, 80, a.slot === 0 ? "#2fa8ff" : "#ffc83d");
    if (this.engine.kids) this.celebrate(a);
    this.updateHud(true);
    if (this.mode === "birgalikda" && !this.goalReached && coopDone(this.teamKg(), this.goalKg)) {
      this.goalReached = true;
      this.goalAt = this.t;
      this.engine.say("Maqsadga erishdingiz!", `${this.goalKg} kg tayyor`, 2000);
    }
    return { pts, rec };
  }
  /** Kids: confetti and a cheer for every catch. */
  private celebrate(a: Angler): void {
    const e = this.engine;
    const { w, h } = this.ui;
    const cx = this.anglers.length === 2 ? w * (a.slot === 0 ? 0.25 : 0.75) : w * 0.5;
    for (let k = 0; k < 3; k++) e.fx.burst(cx + (k - 1) * w * 0.14, h * 0.32, 26, this.confettiCol, [4, 14], [3, 8], [0.7, 1.4], true, 0.35);
    e.fx.popup("Ura! 🎉", cx, h * 0.28, "#ffe66d", 56, 1.6);
    e.audio.combo(3);
  }

  recycle(agentIdx: number): void {
    const a = this.sim.agents[agentIdx];
    const m = this.views.meshes[agentIdx];
    const sp = pickSpecies({ depth: 4, tod: this.weather.tod, weights: this.loc.speciesWeight, rng: this.rng });
    const si = SPECIES.indexOf(sp.junk ? SPECIES[0] : sp);
    a.visitor = false;
    a.state = AState.Wander;
    this.sim.recycle(a, si, rollWeight(SPECIES[si], this.rng), HOME.x, HOME.z, HOME.r);
    this.views.setSpecies(agentIdx, SPECIES[si]);
    m.layers.set(L_UNDER);
    m.visible = a.active;
  }

  teamKg(): number {
    return this.anglers.reduce((s, a) => s + a.tally.kg, 0);
  }

  // ------------------------------------------------------------------ input
  private readInput(a: Angler): void {
    const pf: PlayerFrame | undefined = this.engine.players[a.slot];
    const i: AnglerInput = a.input;
    if (!pf) return;
    const dom = pf.dominant;
    const other = dom === "R" ? "L" : "R";
    const wi = dom === "R" ? 16 : 15;
    const si = dom === "R" ? 12 : 11;
    const ri = other === "L" ? 15 : 16;
    const lm = pf.lm;
    i.present = pf.present;
    i.scale = pf.scale;
    i.rodVisible = lm[wi].v > 0.35;
    i.rodX = lm[wi].x;
    i.rodY = lm[wi].y;
    i.shoulderX = lm[si].x;
    i.shoulderY = (lm[11].y + lm[12].y) / 2;
    i.handUp = pf.gestures.handUp[dom];
    i.vy = pf.gestures.wristVel[dom].y;
    i.crank = pf.gestures.crank[other];
    i.reelVisible = lm[ri].v > 0.35;
    i.leftY = lm[15].y;
    i.rightY = lm[16].y;
    i.leftVisible = lm[15].v > 0.35;
    i.rightVisible = lm[16].v > 0.35;
    i.hipY = lm[23].v > 0.4 && lm[24].v > 0.4 ? (lm[23].y + lm[24].y) / 2 : i.shoulderY + pf.scale * 1.55;
    const k = this.engine.keys;
    const ki = this.engine.playerCount === 1 ? 0 : a.slot;
    const solo = this.engine.playerCount === 1;
    i.keySwing = anyKey(k, SWING_KEYS, solo, ki);
    i.keyReel = anyKey(k, REEL_KEYS, solo, ki);
    i.keyPump = anyKey(k, PUMP_KEYS, solo, ki);
    const net = anyKey(k, NET_KEYS, solo, ki);
    i.keyNet = net && !this.netHeld[a.slot];
    this.netHeld[a.slot] = net;
    // one player: the arrows turn the view, A / D fine-tune the aim; two players share one fixed view: arrows = player 2's aim
    const left = solo ? k.has("a") : ki === 0 ? k.has("a") : k.has("ArrowLeft");
    const right = solo ? k.has("d") : ki === 0 ? k.has("d") : k.has("ArrowRight");
    i.keyAim = (right ? 1 : 0) - (left ? 1 : 0);
    const vo = this.voice.out;
    const mine = solo && a.slot === 0;
    i.voiceCast = mine && vo.cast;
    i.voicePower = vo.castPower;
    i.voiceStrike = mine && vo.strike;
    i.voiceCrank = mine ? vo.crank : 0;
  }

  /** Pointer (raised hand) of any present player for the lobby / collection menus. */
  private readPointer(dt: number): void {
    const u = this.ui;
    u.pointer = false;
    const reach = this.engine.config.cursor.reach;
    let best: { x: number; y: number } | null = null;
    let owner: PlayerFrame | null = null;
    for (const pf of this.engine.players) {
      if (!pf.present) continue;
      for (let sd = 0; sd < 2; sd++) {
        const idx = sd === 0 ? 19 : 20;
        const wi = sd === 0 ? 15 : 16;
        const p = pf.lm[idx];
        const vis = p.v > 0.4 || pf.lm[wi].v > 0.4;
        const limit = pf.lm[23].v > 0.4 ? pf.lm[23].y : pf.lm[11].y + pf.scale * 1.6;
        if (vis && p.y < limit - pf.scale * 0.2 && (!best || p.y < best.y)) {
          best = p;
          owner = pf;
        }
      }
    }
    if (!best || !owner) return;
    const c = owner.center;
    const gx = c.x + (best.x - c.x) * reach;
    const gy = c.y + (best.y - c.y) * reach - owner.scale * 0.2;
    const k = 1 - Math.exp(-dt * 18);
    u.px = u.pointer ? u.px : gx;
    u.py = gy;
    u.px += (gx - u.px) * k;
    u.py += (gy - u.py) * k;
    u.pointer = true;
  }

  // ------------------------------------------------------------------ per frame
  /** Called every rendered frame (also during the countdown / pause). */
  tick(delta: number): void {
    const dt = Math.min(0.05, Math.max(0.0005, delta));
    this.t += dt;
    const e = this.engine;
    const playing = e.state === "play";
    this.ui.w = e.stage.w;
    this.ui.h = e.stage.h;
    if (playing) this.logic(dt);
    this.visuals(dt);
  }

  private logic(dt: number): void {
    const e = this.engine;
    this.readPointer(dt);
    this.updateView(dt);
    if (this.phase === "options") {
      this.optionsScreen(dt);
    } else if (this.phase === "lobby") {
      this.lobby(dt);
    } else if (this.phase === "collection") {
      this.collectionScreen(dt);
    } else if (this.phase === "play") {
      this.playFrame(dt);
    }
    // bookkeeping that runs in every phase
    this.bonusMsgT = Math.max(0, this.bonusMsgT - dt);
    if (this.t - this.sfxAt > 0.5) {
      this.sfxAt = this.t;
      this.sfx.ensure();
    }
    void e;
  }

  private playFrame(dt: number): void {
    const e = this.engine;
    this.voiceFrame(dt);
    for (const a of this.anglers) this.readInput(a);
    this.sim.step(dt, this.baits);
    for (const a of this.anglers) a.update(dt);
    this.helpAndWarn(dt);
    // strain whine of the strongest fight
    let strain = 0;
    for (const a of this.anglers) strain = Math.max(strain, a.fighting ? a.strain : 0);
    this.sfx.setStrain(strain);
    if (strain > 0.85) e.audio.strain(clamp(strain - 0.8, 0, 1));
    // time
    let fighting = false;
    let showing = false;
    for (const a of this.anglers) {
      if (a.fighting) fighting = true;
      if (a.state === "show") showing = true;
    }
    if (this.timeLeft > 0) this.timeLeft = Math.max(0, this.timeLeft - dt);
    else if (fighting && this.graceUsed < 12) {
      this.graceUsed += dt;
      if (this.graceUsed - dt <= 0) e.say("Oxirgi baliq!", "Uni chiqarib oling", 1500);
    }
    const timeUp = this.timeLeft <= 0 && (!fighting || this.graceUsed >= 12);
    const goalDone = this.goalReached && this.t - this.goalAt > 2.2 && !fighting;
    if ((timeUp && !showing) || (goalDone && !showing)) this.endRound();
    // ambience
    this.birdAt -= dt;
    if (this.birdAt <= 0) {
      this.birdAt = (4 + Math.random() * 6) / Math.max(0.2, this.preset.birds * (this.weather.rain ? 0.3 : 1));
      e.audio.bird();
    }
    if (this.t - this.hudAt > 0.25) {
      this.hudAt = this.t;
      this.updateHud(false);
    }
  }

  /** Net help + the partner warning. */
  private helpAndWarn(dt: number): void {
    void dt;
    const as = this.anglers;
    if (as.length < 2) return;
    for (let i = 0; i < 2; i++) {
      const helper = as[i];
      const owner = as[1 - i];
      if (helper.sig.net) {
        const ok = netHelpApplies({ mode: this.mode, partnerFighting: owner.fighting, partnerD: owner.fight?.D ?? 99, helperPresent: true });
        if (ok) owner.finishCatch(true);
        else if (owner.fighting && this.mode === "birgalikda") helper.say("Baliq hali uzoqda — 5 m dan yaqin bo‘lsin", 1400);
      }
      // warn when the partner's line turns red
      if (this.mode === "birgalikda" && owner.fighting && lineInDanger(owner.strain)) {
        if (this.t - this.warnedAt[i] > 2.5) {
          this.warnedAt[i] = this.t;
          this.warnCount++;
          helper.say("Ehtiyot bo‘l! Do‘stingizning ipi qizarmoqda", 1800);
          this.sfx.warn("Ehtiyot bo‘l!");
        }
      }
    }
  }

  // ------------------------------------------------------------------ first-person view
  private updateView(dt: number): void {
    const solo = this.anglers.length === 1;
    const k = this.engine.keys;
    const pf = this.engine.players[0];
    let turn = NaN;
    if (solo && pf?.present && (this.phase === "play" || this.phase === "options")) {
      const lm = pf.lm;
      const hd = this.head;
      hd.noseX = lm[0].x;
      hd.noseV = lm[0].v;
      hd.earLX = lm[7].x;
      hd.earLV = lm[7].v;
      hd.earRX = lm[8].x;
      hd.earRV = lm[8].v;
      hd.shLX = lm[11].x;
      hd.shRX = lm[12].x;
      hd.shV = Math.min(lm[11].v, lm[12].v);
      turn = headTurn(hd);
    }
    let key = 0;
    if (solo && (this.phase === "play" || this.phase === "options")) key = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    if (solo && k.has("c") && !this.keyHeld.has("c")) this.view.center();
    this.setHeld("c", k.has("c"));
    if (!solo) this.view.reset();
    else this.view.update(dt, turn, key);
    this.viewYaw = (this.view.yawDeg * Math.PI) / 180;
  }

  // ------------------------------------------------------------------ voice
  private startVoice(): void {
    if (!this.voiceWanted || !this.voiceOffered || this.voiceIn) return;
    const v = new VoiceInput((kind, level) => this.onVoice(kind, level));
    this.voiceIn = v;
    void v.start();
  }

  private onVoice(kind: VoiceEventKind, level: number): void {
    this.voice.onEvent(kind, level);
    const e = this.engine;
    e.fx.popup(kind === "fish" ? "«fish»" : kind === "pull" ? "«pull»" : "🔊", this.ui.w * 0.5, this.ui.h * 0.62, kind === "pull" ? "#ff8a80" : "#9fe8ff", 34, 0.7);
  }

  private voiceFrame(dt: number): void {
    const a = this.anglers[0];
    const v = this.voice;
    if (!this.voiceIn) {
      v.ctx = "other";
      v.update(dt);
      return;
    }
    this.voiceIn.poll(dt);
    const st = a.state;
    const ctx: VoiceCtx = st === "ready" || st === "wait" || st === "nibble" || st === "bite" ? st : st === "fight" ? "fight" : "other";
    v.ctx = this.acceptInput ? ctx : "other";
    v.update(dt);
  }

  private optionsScreen(dt: number): void {
    const u = this.ui;
    const k = this.engine.keys;
    let toggle = k.has("v") && !this.keyHeld.has("v");
    this.setHeld("v", k.has("v"));
    let go = k.has("Enter") && !this.keyHeld.has("enter");
    this.setHeld("enter", k.has("Enter"));
    u.hover = -1;
    if (u.pointer) {
      const r = optionRects(u.w, u.h);
      const inside = (b: { x: number; y: number; w: number; h: number }): boolean => u.px >= b.x && u.px <= b.x + b.w && u.py >= b.y && u.py <= b.y + b.h;
      if (this.voiceOffered && inside(r.voice)) u.hover = 0;
      else if (inside(r.start)) u.hover = 1;
    }
    if (u.hover >= 0) {
      u.prog += dt / (this.engine.config.cursor.dwellMs / 1000);
      if (u.prog >= 1) {
        if (u.hover === 1) go = true;
        else if (!this.optLatch) {
          toggle = true;
          this.optLatch = true;
          u.prog = 0;
        }
      }
    } else {
      u.prog = Math.max(0, u.prog - dt * 2);
      this.optLatch = false;
    }
    if (toggle && this.voiceOffered) {
      this.voiceWanted = !this.voiceWanted;
      saveVoicePref(this.voiceWanted);
      this.engine.audio.click();
    }
    if (go) {
      this.engine.audio.good();
      this.begin();
    }
  }

  private lobby(dt: number): void {
    const u = this.ui;
    const k = this.engine.keys;
    let pick = -1;
    if (k.has("1")) pick = 0;
    else if (k.has("2")) pick = 1;
    // hover by the raised hand
    u.hover = -1;
    if (u.pointer) {
      const r = lobbyRects(u.w, u.h);
      for (let i = 0; i < 2; i++) if (u.px >= r[i].x && u.px <= r[i].x + r[i].w && u.py >= r[i].y && u.py <= r[i].y + r[i].h) u.hover = i;
    }
    if (u.hover >= 0) {
      u.prog += dt / (this.engine.config.cursor.dwellMs / 1000);
      if (u.prog >= 1) pick = u.hover;
    } else u.prog = Math.max(0, u.prog - dt * 2);
    if (pick >= 0) {
      this.mode = pick === 0 ? "birgalikda" : "musobaqa";
      this.engine.audio.good();
      this.begin();
    }
  }

  private collectionScreen(dt: number): void {
    const u = this.ui;
    const k = this.engine.keys;
    const n = SPECIES.length;
    if (k.has("ArrowRight") && !this.keyHeld.has("cr")) u.sel = (u.sel + 1) % n;
    if (k.has("ArrowLeft") && !this.keyHeld.has("cl")) u.sel = (u.sel + n - 1) % n;
    this.setHeld("cr", k.has("ArrowRight"));
    this.setHeld("cl", k.has("ArrowLeft"));
    let go = k.has("Enter");
    if (u.pointer) {
      const r = collectionRects(u.w, u.h);
      for (let i = 0; i < n; i++) if (u.px >= r.cards[i].x && u.px <= r.cards[i].x + r.cards[i].w && u.py >= r.cards[i].y && u.py <= r.cards[i].y + r.cards[i].h) u.sel = i;
      const b = r.button;
      if (u.px >= b.x && u.px <= b.x + b.w && u.py >= b.y && u.py <= b.y + b.h) {
        u.btnProg += dt / (this.engine.config.cursor.dwellMs / 1000);
        if (u.btnProg >= 1) go = true;
      } else u.btnProg = Math.max(0, u.btnProg - dt * 2);
    }
    if (go || this.t - this.collectionAt > 45) this.complete();
  }

  private setHeld(key: string, on: boolean): void {
    if (on) this.keyHeld.add(key);
    else this.keyHeld.delete(key);
  }

  // ------------------------------------------------------------------ end of the round
  /** The round is over: show the personal results + the encyclopedia, then hand over to the engine. */
  private endRound(): void {
    if (this.phase !== "play") return;
    this.acceptInput = false;
    for (const a of this.anglers) a.input.keySwing = false;
    this.sfx.setStrain(0);
    const skip = this.engine.query.get("collection") === "0";
    if (skip) {
      this.complete();
      return;
    }
    this.phase = "collection";
    this.collectionAt = this.t;
    this.ui.sel = this.bestSpeciesIndex();
    this.engine.say("Tugadi!", "Kolleksiyangizni ko‘ring", 1600);
  }

  private bestSpeciesIndex(): number {
    let best = 0;
    let bw = -1;
    SPECIES.forEach((s, i) => {
      const c = this.collection[s.id];
      if (c && c.record > bw && !s.junk) {
        bw = c.record;
        best = i;
      }
    });
    return best;
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = "done";
    const as = this.anglers;
    const totalKg = this.teamKg();
    const bestFish = as.reduce<{ name: string; w: number } | null>((b, a) => (a.tally.best > (b?.w ?? 0) ? { name: a.card?.name ?? "—", w: a.tally.best } : b), null);
    const count = as.reduce((s, a) => s + a.tally.count, 0);
    const lost = as.reduce((s, a) => s + a.tally.lost, 0);
    const lines: [string, string | number][] = [
      ["Tutilgan baliqlar", `${count} ta`],
      ["Jami og‘irlik", `${totalKg.toFixed(1)} kg`],
      ["Eng kattasi", bestFish ? `${this.bestName(as)} ${bestFish.w.toFixed(1)} kg` : "—"],
      ["Qochganlar", lost],
      ["Yangi turlar", this.newSpecies],
      ["Kolleksiya", `${collectionSize(this.collection)}/${SPECIES.length}`],
    ];
    let players: { score: number; label?: string }[] | undefined;
    let score = as.reduce((s, a) => s + a.tally.score, 0);
    if (this.mode === "birgalikda") {
      lines.unshift(["Birgalikda maqsad", `${totalKg.toFixed(1)} / ${this.goalKg} kg ${coopDone(totalKg, this.goalKg) ? "bajarildi" : "bajarilmadi"}`]);
      lines.push(["Do‘stlik bonuslari", this.friendBonuses]);
      players = as.map((a, i) => ({ score: a.tally.score, label: `${i + 1}-o‘yinchi · ${a.tally.kg.toFixed(1)} kg` }));
    } else if (this.mode === "musobaqa") {
      const w = duelWinner(as[0].tally, as[1].tally);
      lines.unshift(["G‘olib", w < 0 ? "Durang" : `${w + 1}-o‘yinchi`]);
      players = as.map((a, i) => ({ score: Math.round(a.tally.kg * 100), label: `${i + 1}-o‘yinchi · ${a.tally.kg.toFixed(1)} kg` }));
      score = Math.max(...as.map((a) => a.tally.score));
    }
    this.engine.finish({ score, lines, players, stats: { kg: Math.round(totalKg * 100) / 100, count, mode: this.mode } });
  }

  private bestName(as: Angler[]): string {
    let best: Angler | null = null;
    for (const a of as) if (!best || a.tally.best > best.tally.best) best = a;
    return best?.card?.name ?? "Baliq";
  }

  // ------------------------------------------------------------------ HUD
  private updateHud(force: boolean): void {
    const e = this.engine;
    const as = this.anglers;
    const secs = Math.ceil(this.timeLeft);
    const frac = this.duration > 0 ? clamp(this.timeLeft / this.duration, 0, 1) : 1;
    if (this.mode === "yolgiz") {
      const t = as[0].tally;
      e.hud.set({ title: "🎣 Baliq ovi · Tog‘ ko‘li", score: t.score, combo: `🐟 ${t.count} · ${t.kg.toFixed(1)} kg`, time: this.phase === "lobby" ? null : secs, timeLabel: "Vaqt", bar: frac });
    } else if (this.mode === "birgalikda") {
      const kg = this.teamKg();
      e.hud.set({ title: `🤝 Birgalikda: ${kg.toFixed(1)} / ${this.goalKg} kg`, time: secs, timeLabel: "Vaqt", combo: null, bar: clamp(kg / this.goalKg, 0, 1) });
    } else {
      e.hud.set({ title: "⚔ Musobaqa", time: secs, timeLabel: "Vaqt", combo: null, bar: frac });
    }
    if (as.length === 2 || force) {
      as.forEach((a, i) => {
        if (as.length === 2) e.hud.setPlayer(i, { score: a.tally.score, label: `${i + 1}-o‘yinchi`, extra: `🐟 ${a.tally.count} · ${a.tally.kg.toFixed(1)} kg` });
      });
    }
    void force;
  }

  // ------------------------------------------------------------------ visuals
  private visuals(dt: number): void {
    const e = this.engine;
    const t = this.t;
    this.applyCamera(dt);
    const u = this.waterMat.uniforms;
    u.uTime.value = t;
    // quality can drop while playing: switch the expensive water passes off
    if (e.quality.level !== this.lastQuality) {
      this.lastQuality = e.quality.level;
      const on = e.quality.level !== "low" && !!this.passes.refl;
      this.passes.setEnabled(on);
      if (on) this.cam.layers.disable(L_UNDER);
      else this.cam.layers.enable(L_UNDER);
    } else if (this.passes.enabled && u.uUseRefl.value === 0) {
      this.passes.setEnabled(true);
      this.cam.layers.disable(L_UNDER);
    }
    updateWorld(this.world, this.cam, t, dt, this.weather.wind);
    this.syncFish(dt);
    for (const a of this.anglers) a.render(dt);
    this.ripples.update(dt);
    this.splashes.update(dt);
    if (this.rain) {
      const m = this.rain.material as THREE.ShaderMaterial;
      m.uniforms.uTime.value = t;
      m.uniforms.uCenter.value.set(this.cam.position.x * 0.2, 0, 0);
    }
    if (t - this.sfxUpdAt > 0.2) {
      this.sfxUpdAt = t;
      this.sfx.update(t, this.weather.wind);
    }
    // refraction + reflection passes (before the engine renders the main view)
    this.passes.render(this.three.gl, this.three.scene, this.cam, true);
  }

  /** First person: the camera is the player's eye; it turns with the view yaw and eases its pitch towards the float / fish. */
  private applyCamera(dt: number): void {
    const t = this.t;
    const c = this.cam;
    const a = this.anglers[0];
    let target = -6;
    if (a && (a.state === "wait" || a.state === "nibble" || a.state === "bite" || a.state === "fight" || a.state === "fly")) {
      target = lookPitch(EYE.y, this.water(a.fx, a.fz), Math.hypot(a.fx - EYE.x, a.fz - EYE.z));
    }
    this.pitchDeg += (target - this.pitchDeg) * (1 - Math.exp(-Math.max(dt, 0.001) * 3));
    c.position.set(EYE.x + Math.sin(t * 0.6) * 0.01, EYE.y + Math.sin(t * 0.9) * 0.012, EYE.z);
    c.rotation.set((this.pitchDeg * Math.PI) / 180, -this.viewYaw, 0);
    c.updateMatrixWorld();
  }

  /** Bearing of a world point relative to where the player looks (rad, + = to the right of the view centre). */
  bearing(x: number, z: number): number {
    let d = Math.atan2(x - EYE.x, -(z - EYE.z)) - this.viewYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private syncFish(dt: number): void {
    void dt;
    const ag = this.sim.agents;
    for (let i = 0; i < ag.length; i++) {
      const a = ag[i];
      const m = this.views.meshes[i];
      if (a.state === AState.Hooked) continue;
      if (!a.active) {
        m.visible = false;
        continue;
      }
      const sp = SPECIES[a.species];
      m.visible = true;
      const wy = this.water(a.x, a.z);
      m.position.set(a.x, wy + a.y, a.z);
      m.rotation.set(0, Math.atan2(-a.hz, a.hx), clamp(a.vy * 0.5, -0.5, 0.5));
      m.scale.setScalar(clamp(Math.cbrt(a.weight / ((sp.w[0] + sp.w[1]) / 2)), 0.6, 1.8));
      this.views.animate(i, sp, a.phase, clamp(0.2 + a.speed * 0.45, 0.1, 1));
    }
  }

  // ------------------------------------------------------------------ overlay + tests
  draw(c: CanvasRenderingContext2D, e: EngineApi, now: number): void {
    drawOverlay(this, c, e, now);
  }

  /** 3D world point -> stage px (returns false when behind the camera). */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.tmp.set(x, y, z).project(this.cam);
    out.x = (this.tmp.x * 0.5 + 0.5) * this.ui.w;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.ui.h;
    return this.tmp.z < 1;
  }

  /** Plain snapshot for tests and the debug panel. */
  snapshot(): Record<string, unknown> {
    const gl = this.three.gl;
    this.lastCalls = gl.info.render.calls + this.passes.calls;
    this.lastTris = gl.info.render.triangles + this.passes.tris;
    return {
      phase: this.phase,
      mode: this.mode,
      timeLeft: this.timeLeft,
      goalKg: this.goalKg,
      teamKg: this.teamKg(),
      friendBonuses: this.friendBonuses,
      warnCount: this.warnCount,
      warnings: this.sfx.warnings,
      weather: this.weather,
      quality: this.engine.quality.level,
      view: { yawDeg: this.view.yawDeg, targetDeg: this.view.targetDeg, pitchDeg: this.pitchDeg, calibrated: this.view.calibrated, neutral: this.view.neutral, raw: this.view.raw },
      voice: { offered: this.voiceOffered, wanted: this.voiceWanted, status: this.voiceIn?.status ?? "off", events: this.voice.events, last: this.voice.lastEvent, ctx: this.voice.ctx, label: this.voiceIn?.label ?? "" },
      water: { passes: this.passes.enabled, reflection: this.waterMat.uniforms.uUseRefl.value, refraction: this.waterMat.uniforms.uUseRefr.value },
      render: { calls: this.lastCalls, triangles: this.lastTris, mainCalls: gl.info.render.calls, passCalls: this.passes.calls },
      anglers: this.anglers.map((a) => ({
        slot: a.slot,
        state: a.state,
        D: a.D,
        strain: a.strain,
        species: a.sp?.id ?? null,
        weight: a.weight,
        fightD: a.fight?.D ?? null,
        score: a.tally.score,
        kg: a.tally.kg,
        count: a.tally.count,
        lost: a.tally.lost,
        netOffer: a.netOffer,
        float: { x: a.fx, y: a.fy, z: a.fz },
        sig: { crank: a.sig.crank, armed: a.sig.armed, pitch: a.sig.pitch, yaw: a.sig.yawDeg },
        castDir: a.castDir,
        autoStruck: a.autoStruck,
        fightAng: a.fight?.ang ?? 0,
        fightRun: a.fight?.run ?? false,
      })),
      fish: this.sim.agents.filter((a) => a.active).length,
      collection: collectionSize(this.collection),
    };
  }

  /** Test helper: make a bite/fight happen without waiting (used by unit/e2e through window.__baliq). */
  debugAgent(i: number): Agent | undefined {
    return this.sim.agents[i];
  }

  dispose(): void {
    this.disposedFlag = true;
    const s = this.saved;
    this.cam.fov = s.fov;
    this.cam.near = s.near;
    this.cam.far = s.far;
    this.cam.position.copy(s.pos);
    this.cam.layers.mask = s.layers;
    this.voiceIn?.dispose();
    this.voiceIn = null;
    this.cam.up.set(0, 1, 0);
    this.cam.rotation.order = "XYZ";
    this.cam.lookAt(0, 0, 0);
    this.cam.updateProjectionMatrix();
    this.three.gl.toneMappingExposure = s.exposure;
    this.three.scene.fog = null;
    this.passes.dispose();
    this.views.dispose();
    for (const a of this.anglers) a.dispose();
    for (const d of this.disposables) d.dispose();
    for (const d of this.world.disposables) d.dispose();
    this.sfx.dispose();
    this.assets.dispose();
    this.engine.audio.ambStop();
    // React StrictMode mounts the scene twice in development: leave nothing of ours in the shared group
    for (const ch of [...this.group.children]) disposeTree(ch);
    this.group.clear();
  }
}
