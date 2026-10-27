"use client";

import type { GameInfo } from "@/lib/games";
import { AudioEngine } from "../audio/audio";
import { CalibrationAnalyzer } from "../calibration/calibration";
import { CameraError, classifyCameraError, maxCameraFps, openCamera, setCameraRate, stopStream } from "../camera/camera";
import { detectEnv, type Env } from "../camera/env";
import { permissionGuide, problemStatus } from "../camera/guides";
import { makeConfig, type EngineConfig } from "../config";
import { Fx2D, drawSkeleton, drawText } from "../fx/fx2d";
import { clamp } from "../math";
import { QualityController } from "../quality/controller";
import { detectDevice, resolveInitialLevel, resolvePoseModel, type DeviceProfile } from "../quality/gpu";
import { readBest, snapshotSettings, useSettings, writeBest } from "../settings/store";
import { Detector, type DetectOptions } from "../tracking/detector";
import { LowLightController, applyLut, buildLut, confidenceFor, lightStats } from "../tracking/lowLight";
import { LatencyTracker, sanitizeCaptureTs } from "../tracking/prediction";
import { DetectionScheduler } from "../tracking/scheduler";
import { meanLuma, computeFit, SMALL_H, SMALL_W, type SmallFrame } from "../tracking/people";
import { ScanController } from "../tracking/scan";
import { Tracker, PLAYER_COLORS } from "../tracking/tracker";
import type {
  AudioApi,
  DetectionResult,
  DrawFn,
  EngineApi,
  FxApi,
  GameMeta,
  GameModule,
  GameResult,
  HudApi,
  HudValues,
  PlayerFrame,
  QualityParams,
  RunState,
  WorldPoint,
} from "../types";
import { DwellController } from "../ui/dwell";
import { resetRunUI, useRunUI } from "./runStore";

const TIPS = [
  "Kameradan 1,5–2 metr uzoqroq turing — butun tanangiz ko‘rinsin.",
  "Xona yorug‘ bo‘lsin: oynadan emas, oynaga teskari turing.",
  "Kamera tasviri hech qayerga yuborilmaydi — hamma narsa qurilmangizda hisoblanadi.",
  "Ikki qo‘lingizni boshingizdan yuqori ko‘tarsangiz — o‘yinchi skanerlanadi.",
  "Qo‘lingizni tugma ustida ushlab turing — tugma bosiladi.",
  "Klaviatura: P — pauza, M — ovoz, Esc — chiqish.",
];

const AR_FOV = 50;
const AR_Z = 10;
const TAN = Math.tan((AR_FOV * Math.PI) / 360);

export interface RuntimeInit {
  slug: string;
  info: GameInfo;
  load: () => Promise<{ default: GameModule }>;
  debug: boolean;
  /** preset from ?players=2 */
  players?: 1 | 2;
  /** disable the worker (?worker=0) */
  worker?: boolean;
  query?: URLSearchParams;
  onExit: () => void;
}

interface FakeWindow {
  __fake?: (now: number) => DetectionResult | null;
  __smallFixed?: Uint8ClampedArray;
  __noRender?: boolean;
}

type Pending = { res: DetectionResult; captureTs: number; startTs: number; doneTs: number };

const DARK_HINT = "Yorug‘lik kam — chiroqni yoqing yoki kameraga yorug‘lik tomon yuzlaning";

/**
 * One play session: camera -> models -> calibration/scan -> menu -> countdown -> game -> results.
 * Implements the `EngineApi` that games receive. Not a React component — React only renders its state
 * (zustand `useRunUI`) and hosts the R3F canvas that drives `step()` every frame.
 */
export class EngineRuntime implements EngineApi {
  readonly slug: string;
  readonly info: GameInfo;
  readonly keys = new Set<string>();
  readonly debugOn: boolean;
  readonly query: URLSearchParams;
  config: EngineConfig;
  module: GameModule | null = null;
  env: Env;
  tracker: Tracker;
  fx = new Fx2D();
  audioEngine: AudioEngine;
  detector: Detector | null = null;
  device: DeviceProfile = { tier: 2, isMobile: false, gpu: "—", detected: false, cores: 0, memory: 0, software: false, webgl: true };
  stream: MediaStream | null = null;
  video: HTMLVideoElement | null = null;
  fxCanvas: HTMLCanvasElement | null = null;
  bgCanvas: HTMLCanvasElement | null = null;
  overlayRoot: HTMLElement | null = null;
  sessionId = 0;
  stage = { w: 1280, h: 720, dpr: 1 };
  kids = false;
  leftHanded = false;
  sensitivity = 1;
  quality: QualityParams;
  time = 0;
  /** set by the EngineDriver inside the R3F canvas */
  gl: { compileAsync: (s: unknown, c: unknown) => Promise<void> } | null = null;
  setRenderer(gl: EngineRuntime["gl"]): void {
    this.gl = gl;
  }

  private _state: RunState = "camera";
  private _players: PlayerFrame[];
  private _playerCount: 1 | 2;
  private qc: QualityController;
  private scan: ScanController;
  private calib: CalibrationAnalyzer;
  private dwell: DwellController;
  private drawFns = new Set<DrawFn>();
  private destroyed = false;
  private busy = false;
  private lastVT = -1;
  /** number of detection frames processed (tests / debug) */
  detectFrame = 0;
  private lastStart = 0;
  private small: SmallFrame | null = null;
  private smallCanvas: HTMLCanvasElement | null = null;
  private smallCtx: CanvasRenderingContext2D | null = null;
  private lastDetectNow = 0;
  private fpsEma = 60;
  private detEma = 0;
  private lastDetStamp = 0;
  private lat = new LatencyTracker();
  private sched: DetectionScheduler;
  private light = new LowLightController();
  private lut = new Uint8Array(256);
  private lutKey = "";
  private lightAt = 0;
  private confKey = "";
  private rawLuma: number | null = null;
  private camFps = 0;
  private camBoost: "idle" | "up" | "down" = "idle";
  private camGoodFor = 0;
  private hintAt = -1e9;
  private debugAt = 0;
  private tipAt = 0;
  private tipIdx = 0;
  private scanDoneAt = 0;
  private scanStart = 0;
  private countT = 0;
  private lastCount = -1;
  private overAt = 0;
  private result: GameResult | null = null;
  private resumeAt = 0;
  private sayTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private lostFlag = false;
  private cleanup: (() => void)[] = [];
  private qualitySetting = "auto";
  private hudState = { score: -1 };

  constructor(private init: RuntimeInit) {
    this.slug = init.slug;
    this.debugOn = init.debug;
    this.query = init.query ?? new URLSearchParams();
    this.info = init.info;
    this.env = detectEnv();
    void useSettings.persist.rehydrate();
    const s = snapshotSettings();
    this.applySettings();
    this.config = makeConfig({}, s.sensitivity);
    this._playerCount = init.players === 2 && init.info.twoPlayers ? 2 : 1;
    this.tracker = new Tracker(this.config, this._playerCount);
    this.tracker.leftHanded = this.leftHanded;
    this._players = this.tracker.players;
    this.qc = new QualityController({ initial: "medium", adaptive: true, devicePixelRatio: 1 });
    this.quality = this.qc.params;
    this.sched = new DetectionScheduler({ cores: navigator.hardwareConcurrency || 4, level: "medium", mainThread: false });
    this.scan = new ScanController(this._playerCount, this.config.lock);
    this.calib = new CalibrationAnalyzer(this.config.calibration, false);
    this.audioEngine = new AudioEngine({ sound: () => useSettings.getState().sound, music: () => useSettings.getState().music });
    this.dwell = new DwellController(
      this.config.cursor,
      this.config.cursorFilter,
      () => this.audioEngine.good(),
      () => this.audioEngine.tone(880, 0, 0.04, "sine", 0.05),
    );
    resetRunUI();
    useRunUI.getState().patch({ scan: { ...useRunUI.getState().scan, players: this._playerCount, canPickPlayers: init.info.twoPlayers } });
  }

  // ---------------------------------------------------------------- EngineApi
  get meta(): GameMeta {
    if (!this.module) throw new Error("game module not loaded");
    return this.module.meta;
  }
  get state(): RunState {
    return this._state;
  }
  get players(): PlayerFrame[] {
    return this._players;
  }
  get playerCount(): 1 | 2 {
    return this._playerCount;
  }
  get audio(): AudioApi {
    return this.audioEngine;
  }
  readonly hud: HudApi = {
    set: (v: HudValues) => this.setHud(v),
    setPlayer: (slot, v) => {
      const ui = useRunUI.getState();
      const arr = ui.hud.players.slice();
      const cur = arr[slot] ?? { score: 0, label: "", extra: "" };
      const next = { score: v.score ?? cur.score, label: v.label ?? cur.label, extra: v.extra ?? cur.extra };
      if (next.score === cur.score && next.label === cur.label && next.extra === cur.extra) return;
      arr[slot] = next;
      ui.patch({ hud: { ...ui.hud, players: arr } });
    },
    show: (on) => {
      const ui = useRunUI.getState();
      if (ui.hud.on !== on) ui.patch({ hud: { ...ui.hud, on } });
    },
  };

  say(text: string, sub = "", ms = 900): void {
    const ui = useRunUI.getState();
    ui.patch({ center: { text, sub, show: true, seq: ui.center.seq + 1 } });
    if (this.sayTimer) clearTimeout(this.sayTimer);
    if (ms) this.sayTimer = setTimeout(() => useRunUI.getState().patch({ center: { ...useRunUI.getState().center, show: false } }), ms);
  }

  toast(text: string, ms = 2200): void {
    useRunUI.getState().patch({ toast: text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => useRunUI.getState().patch({ toast: "" }), ms);
  }

  onDraw(fn: DrawFn): () => void {
    this.drawFns.add(fn);
    return () => this.drawFns.delete(fn);
  }

  finish(result: GameResult): void {
    if (this.result || (this._state !== "play" && this._state !== "pause" && this._state !== "countdown")) return;
    this.result = result;
    this.overAt = performance.now();
    this.say(result.players ? "O‘yin tugadi!" : "Vaqt tugadi!", "", 1300);
  }

  screenToWorld(x: number, y: number, z: number, out: WorldPoint): void {
    const { w, h } = this.stage;
    const half = (AR_Z - z) * TAN;
    out.x = (x / w) * 2 * half * (w / h) - half * (w / h);
    out.y = half - (y / h) * 2 * half;
    out.z = z;
  }

  pxToWorld(z = 0): number {
    return (2 * (AR_Z - z) * TAN) / this.stage.h;
  }

  // ---------------------------------------------------------------- settings
  private applySettings(): void {
    const s = snapshotSettings();
    this.kids = s.kids;
    this.leftHanded = s.leftHanded;
    this.sensitivity = clamp(s.sensitivity, 0.5, 1.5);
    this.qualitySetting = s.quality;
    if (this.tracker) this.tracker.leftHanded = s.leftHanded;
    this.audioEngine?.refresh();
  }

  // ---------------------------------------------------------------- lifecycle
  attach(refs: { video: HTMLVideoElement; fx: HTMLCanvasElement; bg: HTMLCanvasElement; overlay: HTMLElement }): void {
    this.video = refs.video;
    this.fxCanvas = refs.fx;
    this.bgCanvas = refs.bg;
    this.overlayRoot = refs.overlay;
    this.smallCanvas = document.createElement("canvas");
    this.smallCanvas.width = SMALL_W;
    this.smallCanvas.height = SMALL_H;
    this.smallCtx = this.smallCanvas.getContext("2d", { willReadFrequently: true });
    const onKey = (e: KeyboardEvent): void => this.onKey(e, true);
    const onKeyUp = (e: KeyboardEvent): void => this.onKey(e, false);
    const onBlur = (): void => this.keys.clear();
    const onVis = (): void => {
      if (document.hidden) this.pause("hidden");
    };
    const unlock = (): void => {
      this.audioEngine.unlock();
      useRunUI.getState().patch({ audioReady: this.audioEngine.ready });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("touchstart", unlock);
    window.addEventListener("keydown", unlock);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    });
    (window as unknown as { __engine?: EngineRuntime }).__engine = this;
  }

  resize(w: number, h: number, dpr: number): void {
    this.stage = { w, h, dpr };
    this.fxDpr = -1;
    this.applyFxDpr();
    this.updateFit();
  }

  /** Pixel ratio of the 2D layers: the cheapest level draws them at 1x (a full screen 2x canvas is costly on weak GPUs). */
  private fxDpr = 1;
  private applyFxDpr(): void {
    const { w, h, dpr } = this.stage;
    const eff = this.quality.level === "low" ? Math.min(dpr, 1) : dpr;
    if (eff === this.fxDpr) return;
    this.fxDpr = eff;
    for (const c of [this.fxCanvas, this.bgCanvas]) {
      if (!c) continue;
      c.width = Math.round(w * eff);
      c.height = Math.round(h * eff);
    }
    const bg = this.bgCanvas?.getContext("2d") ?? null;
    if (bg) bg.setTransform(eff, 0, 0, eff, 0, 0);
    this.fx.setStainLayer(bg, w, h);
  }

  private updateFit(): void {
    const v = this.video;
    const camW = v?.videoWidth || 1280;
    const camH = v?.videoHeight || 720;
    this.tracker.setFit(computeFit(this.stage.w, this.stage.h, camW, camH));
  }

  private setState(s: RunState): void {
    this._state = s;
    this.dwell.release();
    useRunUI.getState().patch({ state: s });
    this.applyVideoLook();
  }

  private applyVideoLook(): void {
    const v = this.video;
    if (!v) return;
    const world = this.module?.meta.world ?? false;
    const playing = this._state === "play" || this._state === "countdown" || this._state === "preparing" || this._state === "pause";
    const b = this._state === "scan" ? 0.7 : playing ? (this.module?.meta.dim ?? 0.62) : 0.5;
    v.style.filter = `brightness(${b}) saturate(1.05)`;
    v.dataset.pip = world && playing ? "1" : "0";
  }

  /** Camera permission -> game module + models -> scan. */
  async start(): Promise<void> {
    const ui = useRunUI.getState();
    try {
      if (this.env.viewer) throw new CameraError("viewer");
      const fake = this.fakeWin().__fake;
      const cam = await openCamera(snapshotSettings().cameraId || undefined);
      if (this.destroyed) {
        stopStream(cam.stream);
        return;
      }
      this.stream = cam.stream;
      this.camFps = cam.fps;
      const v = this.video;
      if (v) {
        v.srcObject = cam.stream;
        await v.play().catch(() => undefined);
      }
      this.updateFit();
      this.setState("loading");
      ui.patch({ loading: { pct: 3, label: "Kamera tayyor", tip: TIPS[0] } });
      await this.loadAll(!!fake || !!this.fakeWin().__fake);
    } catch (e) {
      if (this.destroyed) return;
      this.onStartError(e);
      return;
    }
    if (this.destroyed) return;
    this.beginScan();
  }

  private onStartError(e: unknown): void {
    console.error(e);
    if (e instanceof Error && e.message === "nowebgl") {
      useRunUI.getState().patch({ state: "error", errorText: "Brauzeringiz yoki videokartangiz 3D (WebGL) ni qo‘llamaydi. Chrome yoki Edge ning yangi versiyasini sinab ko‘ring." });
      this._state = "error";
      return;
    }
    let kind = e instanceof CameraError ? e.kind : classifyCameraError(e, this.env);
    const isModel = !(e instanceof CameraError) && kind === "unknown" && this.stream !== null;
    if (isModel) {
      useRunUI.getState().patch({ state: "error", errorText: "Modellar yuklanmadi — internetni tekshirib, qayta urinib ko‘ring." });
      this._state = "error";
      return;
    }
    if (kind === "unknown" && !this.stream) kind = "unknown";
    this._state = "camera";
    useRunUI.getState().patch({ state: "camera", problem: kind, problemStatus: problemStatus(kind), guide: permissionGuide(kind, this.env) });
  }

  /** "Qayta urinish" on the camera guide. */
  async retryCamera(): Promise<void> {
    useRunUI.getState().patch({ problem: null, guide: null, problemStatus: "Kamera yoqilmoqda…" });
    this._state = "camera";
    await this.start();
  }

  private fakeWin(): FakeWindow {
    return window as unknown as FakeWindow;
  }

  private async loadAll(useFake: boolean): Promise<void> {
    const ui = useRunUI.getState();
    const prog = (pct: number, label: string): void => {
      const cur = useRunUI.getState().loading;
      useRunUI.getState().patch({ loading: { ...cur, pct: Math.max(cur.pct, Math.round(pct)), label } });
    };
    const [mod, device] = await Promise.all([this.init.load(), detectDevice()]);
    this.module = mod.default;
    this.device = device;
    if (!device.webgl) throw new Error("nowebgl");
    this.calib = new CalibrationAnalyzer(this.config.calibration, this.module.meta.needsLegs);
    useRunUI.getState().patch({ scan: { ...ui.scan, needsLegs: this.module.meta.needsLegs, canPickPlayers: this.info.twoPlayers && this.module.meta.maxPlayers === 2 } });
    if (this.module.meta.maxPlayers === 1 && this._playerCount === 2) this.setPlayerCount(1);
    // quality
    const s = snapshotSettings();
    const { level, adaptive } = resolveInitialLevel(s.quality, device);
    this.qc = new QualityController({ initial: level, adaptive, devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    this.quality = this.qc.params;
    this.applyFxDpr();
    this.qc.onChange = (p) => {
      this.quality = p;
      this.fx.density = p.particles;
      this.applyFxDpr();
    };
    this.sched = new DetectionScheduler({ cores: device.cores || 4, level, mainThread: false });
    this.fx.density = this.quality.particles;
    prog(12, "O‘yin moduli yuklandi");
    if (useFake) {
      prog(100, "Tayyor");
      return;
    }
    const poseModel = resolvePoseModel(s.poseModel, device);
    this.detector = await Detector.create({
      poseModel,
      hands: this.module.meta.needsHands,
      preferWorker: this.init.worker !== false,
      onProgress: (pct, label) => prog(12 + pct * 0.88, label),
    });
    if (this.destroyed) {
      this.detector.close();
      this.detector = null;
      return;
    }
    if (this.detector.info.where === "main") this.sched = new DetectionScheduler({ cores: device.cores || 4, level, mainThread: true });
    this.startDetectLoop();
  }

  private beginScan(): void {
    this.tracker.resetPlayers();
    this._players = this.tracker.players;
    this.scan = new ScanController(this._playerCount, this.config.lock);
    this.scanStart = performance.now();
    this.setState("scan");
    const n = this._playerCount;
    useRunUI.getState().patch({
      scan: {
        ...useRunUI.getState().scan,
        progress: 0,
        icon: "🙌",
        players: n,
        title: n === 2 ? "Ikkala o‘yinchi ikki qo‘lini boshidan yuqori ko‘tarsin" : "Ikki qo‘lingizni boshingizdan yuqori ko‘taring",
        info: "Kamera oldida turing",
        calib: null,
        secondsLeft: this.config.calibration.totalSec,
      },
    });
  }

  setPlayerCount(n: 1 | 2): void {
    if (n === this._playerCount || (n === 2 && !this.info.twoPlayers)) return;
    this._playerCount = n;
    this.tracker.setPlayerCount(n);
    this._players = this.tracker.players;
    this.tracker.leftHanded = this.leftHanded;
    useRunUI.getState().patch({ scan: { ...useRunUI.getState().scan, players: n } });
    if (this._state === "scan" || this._state === "ready") this.beginScan();
  }

  /** "Skansiz" — nearest person(s) play. */
  skipScan(): void {
    if (this._state !== "scan") return;
    for (let i = 0; i < this._playerCount; i++) this.tracker.lock.lockNearest(i);
    this.toast(this._playerCount === 2 ? "Eng yaqin ikki kishi o‘ynaydi" : "Eng yaqin odam o‘ynaydi");
    this.setState("ready");
    this.prepareReady();
  }

  private prepareReady(): void {
    this.audioEngine.win();
  }

  rescan(): void {
    this.beginScan();
  }

  // ---------------------------------------------------------------- detection loop
  private startDetectLoop(): void {
    const v = this.video;
    if (!v) return;
    // Newest frame only: a camera frame that arrives while the model is busy is simply dropped (never queued),
    // so every detection starts on the freshest picture, as early as the camera delivers it (rVFC = per new frame).
    const tick = (_now?: number, meta?: { captureTime?: number }): void => {
      if (this.destroyed) return;
      const now = performance.now();
      const det = this.detector;
      const minGap = Math.max(1000 / this.config.analysisFps, this.sched.minIntervalMs(this.lat.infer));
      if (det && !this.busy && v.readyState >= 2 && v.currentTime !== this.lastVT && now - this.lastStart >= minGap - 2) {
        this.lastVT = v.currentTime;
        this.lastStart = now;
        this.busy = true;
        const captureTs = sanitizeCaptureTs(meta?.captureTime, now, now);
        const wantHands = this.module?.meta.needsHands ?? false;
        const opts: DetectOptions = { maxSide: this.sched.maxSide, lut: this.light.state.active ? this.lut : null };
        det
          .detect(v, now, wantHands, opts)
          .then((res) => {
            // applied right away (not at the next render frame): the render loop extrapolates from the capture time anyway
            if (res && !this.destroyed) {
              const done = performance.now();
              this.onDetection({ res, captureTs, startTs: now, doneTs: done }, done, false);
            }
          })
          .catch((e) => console.warn(e))
          .finally(() => {
            this.busy = false;
          });
      }
      schedule();
    };
    const vfc = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number }) => void) => number };
    const schedule = (): void => {
      if (this.destroyed) return;
      if (vfc.requestVideoFrameCallback) vfc.requestVideoFrameCallback(tick);
      else requestAnimationFrame(() => tick());
    };
    schedule();
  }

  private grabSmall(): void {
    const fixed = this.fakeWin().__smallFixed;
    if (fixed) {
      this.small = { data: fixed };
      return;
    }
    const v = this.video;
    if (this.fakeWin().__fake || !v || v.readyState < 2 || !this.smallCtx) {
      this.small = null;
      return;
    }
    try {
      this.smallCtx.drawImage(v, 0, 0, SMALL_W, SMALL_H);
      const data = this.smallCtx.getImageData(0, 0, SMALL_W, SMALL_H).data;
      this.small = { data };
      this.updateLight(data);
    } catch {
      this.small = null;
    }
  }

  /**
   * Light check on the small snapshot (~10 Hz, ~0.1 ms): decides whether the frame for the model is brightened and
   * how dark the picture is (confidence thresholds, player lock and blade visibility adapt to it).
   */
  private updateLight(data: Uint8ClampedArray): void {
    const t = performance.now();
    const stats = lightStats(data);
    this.rawLuma = stats?.mean ?? null;
    if (t - this.lightAt >= 90) {
      this.lightAt = t;
      const e = this.light.update(stats, t);
      this.tracker.setDarkness(e.darkness);
      if (e.active) {
        const key = `${e.gamma.toFixed(2)}|${e.lo.toFixed(2)}|${e.hi.toFixed(2)}`;
        if (key !== this.lutKey) {
          this.lutKey = key;
          buildLut(e, this.lut);
        }
      }
      const conf = confidenceFor(e.darkness);
      const ck = `${conf.det}`;
      if (ck !== this.confKey) {
        this.confKey = ck;
        this.detector?.setConfidence(conf);
      }
    }
    // clothing colours are compared on the brightened picture too (same as the one the model sees)
    if (this.light.state.active) applyLut(data, this.lut);
  }

  /** Gentle hint when the room is really too dark (once a minute, never while scanning: the scan has its own message). */
  private lightHint(now: number): void {
    if (!this.light.tooDark || now - this.hintAt < 60000) return;
    const s = this._state;
    if (s !== "ready" && s !== "countdown" && s !== "play") return;
    this.hintAt = now;
    this.toast(DARK_HINT, 4500);
  }

  /**
   * 30 fps by default (longest exposure); once the light is good and the model is fast, ask the camera for 60 fps
   * (half the capture delay). In a dim room it goes back to 30. Each switch happens at most once per session.
   */
  private tuneCamera(dtSec: number): void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || this.fakeWin().__fake) return;
    const dark = this.light.state.active || this.light.mean < 0.3;
    if (this.camBoost === "up") {
      if (dark) {
        this.camGoodFor += dtSec;
        if (this.camGoodFor > 2) {
          this.camBoost = "down";
          void setCameraRate(track, 30).then((f) => (this.camFps = f || this.camFps));
        }
      } else this.camGoodFor = 0;
      return;
    }
    if (this.camBoost !== "idle") return;
    const good = !dark && this.lat.samples > 45 && this.lat.infer < 14 && this.detEma > 24 && this.sched.capFps >= 45 && this.camFps > 0 && this.camFps < 45;
    this.camGoodFor = good ? this.camGoodFor + dtSec : 0;
    if (this.camGoodFor > 3 && maxCameraFps(track) >= 50) {
      this.camBoost = "up";
      this.camGoodFor = 0;
      void setCameraRate(track, 60).then((f) => (this.camFps = f || this.camFps));
    }
  }

  // ---------------------------------------------------------------- per frame
  /** Called once per rendered frame by the EngineDriver (inside the R3F canvas). */
  step(now: number, delta: number): void {
    if (this.destroyed) return;
    const dt = clamp(delta, 0.001, 0.05);
    const realDt = Math.max(0.0005, delta);
    this.fpsEma += (1 / realDt - this.fpsEma) * 0.05;
    this.updateFit();
    // 1) detections: real ones are applied as they arrive (see startDetectLoop); synthetic ones here.
    const fake = this.fakeWin().__fake;
    if (typeof fake === "function") {
      const res = fake(now);
      if (res) this.onDetection({ res, captureTs: now, startTs: now, doneTs: now }, now, true);
    }
    // every frame (also the one with a new detection): hands/blades are drawn where the hand is NOW
    this.tracker.extrapolate(now, typeof fake === "function" ? 0 : undefined);

    // 2) state machine
    this.stepState(now, dt);

    // 3) quality (only while a game runs)
    if (this._state === "play" || this._state === "countdown") {
      if (this.qc.sample(this.fpsEma, now / 1000)) this.fx.density = this.quality.particles;
      // detection rate: lowered only when the graphics are already at their cheapest (tracking comes first)
      this.sched.sample(this.fpsEma, this.qc.atFloor, now / 1000);
    }
    this.lightHint(now);

    // 4) 2D layer
    this.fx.update(dt);
    this.drawFx(now);

    // 5) debug / loading tips
    if (now - this.debugAt > 250) {
      const gap = (now - this.debugAt) / 1000;
      this.debugAt = now;
      this.tuneCamera(Math.min(1, gap));
      this.publishDebug();
    }
    if (this._state === "loading" && now - this.tipAt > 3200) {
      this.tipAt = now;
      this.tipIdx = (this.tipIdx + 1) % TIPS.length;
      const ui = useRunUI.getState();
      ui.patch({ loading: { ...ui.loading, tip: TIPS[this.tipIdx] } });
    }
  }

  private onDetection(p: Pending, now: number, fake: boolean): void {
    this.detectFrame++;
    const scanning = this._state === "scan";
    const lockedAbsent = this.tracker.lock.slots.some((s) => s.mode === "locked") && this._players.some((pl) => !pl.present);
    if (scanning || lockedAbsent || this.detectFrame % 3 === 0) this.grabSmall();
    this.tracker.small = this.small;
    this.tracker.process(p.res, now, fake ? now : p.captureTs);
    // stats
    if (this.lastDetStamp) {
      const d = now - this.lastDetStamp;
      if (d > 0) this.detEma += (1000 / d - this.detEma) * 0.1;
    }
    this.lastDetStamp = now;
    if (!fake) this.lat.record(p.captureTs, p.startTs, p.doneTs, now);
    const dtDet = this.lastDetectNow ? clamp((now - this.lastDetectNow) / 1000, 0.001, 0.2) : 1 / 30;
    this.lastDetectNow = now;
    if (scanning) this.onScan(dtDet, now);
  }

  private onScan(dt: number, now: number): void {
    const t = this.tracker;
    const status = this.scan.update(t.people, dt, t.getHist);
    this.scanCands = status.candidates;
    const ui = useRunUI.getState();
    const main = status.candidates[0] ?? t.people.slice().sort((a, b) => b.scale - a.scale)[0] ?? null;
    const luma = this.rawLuma ?? meanLuma(this.small);
    const report = this.calib.analyze(main, luma);
    const elapsed = (now - this.scanStart) / 1000;
    const base = { ...ui.scan, progress: status.progress, info: report.message && !status.done ? `${status.info}` : status.info, calib: report, secondsLeft: Math.max(0, Math.ceil(this.config.calibration.totalSec - elapsed)) };
    if (status.done && status.result) {
      status.result.forEach((r, i) => t.lock.lock(i, r, now));
      this.scanDoneAt = now;
      this.audioEngine.win();
      useRunUI.getState().patch({ scan: { ...base, progress: 1, icon: "✅", title: this._playerCount === 2 ? "O‘yinchilar tanlandi!" : "O‘yinchi tanlandi!" } });
      this.setStateAfter(1100, "scanDone");
      this.scanDone = true;
    } else useRunUI.getState().patch({ scan: base });
  }

  private scanDone = false;
  private setStateAfter(ms: number, _tag: string): void {
    void _tag;
    setTimeout(() => {
      if (!this.destroyed && this._state === "scan" && this.scanDone) {
        this.scanDone = false;
        this.setState("ready");
        this.prepareReady();
      }
    }, ms);
  }

  private stepState(now: number, dt: number): void {
    const s = this._state;
    const ui = useRunUI.getState();
    if (s === "scan" || s === "ready" || s === "pause" || s === "results") {
      this.dwell.updateCursor(this._players, now, this.stage.w, this.stage.h);
      this.dwell.tick(now, this.overlayRoot);
    }
    if (s === "scan") {
      // when the camera does not see anyone the countdown still runs; refresh the seconds label
      const elapsed = (now - this.scanStart) / 1000;
      const left = Math.max(0, Math.ceil(this.config.calibration.totalSec - elapsed));
      if (left !== ui.scan.secondsLeft) ui.patch({ scan: { ...ui.scan, secondsLeft: left } });
    }
    if (s === "pause") {
      const reason = ui.pause.reason;
      if (reason === "lost") {
        const allBack = this._players.every((p) => p.present);
        if (allBack) {
          if (!this.resumeAt) this.resumeAt = now;
          if (now - this.resumeAt > this.config.lock.resumeSec * 1000) {
            this.resumeAt = 0;
            this.resume();
          }
        } else this.resumeAt = 0;
      }
    }
    if (s === "countdown") {
      const prev = this.countT;
      this.countT += dt;
      const n = 3 - Math.floor(this.countT / 0.8);
      const step = Math.floor(this.countT / 0.8);
      if (step !== this.lastCount || prev === 0) {
        this.lastCount = step;
        if (n > 0) {
          this.say(String(n), "", 700);
          this.audioEngine.beep(false);
        }
      }
      if (this.countT >= 2.4) {
        this.setState("play");
        this.say("Boshladik!", "", 650);
        this.audioEngine.beep(true);
      }
    }
    if (s === "play") {
      this.time += dt;
      // a locked player who has been gone too long pauses the game
      const gone = this._players.some((p) => !p.present && p.lockMode !== "none" && p.lostFor > this.config.lock.lostPauseSec);
      if (gone && !this.result) {
        this.pause("lost");
      }
      if (this.result && now - this.overAt > 1500) this.showResults();
    } else if ((s === "countdown" || s === "pause") && this.result && now - this.overAt > 1500) this.showResults();
  }

  // ---------------------------------------------------------------- flow actions
  /** "Boshlash" — mount the scene, compile, count down. */
  startGame(): void {
    if (this._state !== "ready" && this._state !== "results") return;
    this.audioEngine.unlock();
    this.fx.clear();
    this.result = null;
    this.time = 0;
    this.countT = 0;
    this.lastCount = -1;
    this.sessionId++;
    this.hudState.score = -1;
    this.drawFns.clear();
    useRunUI.getState().patch({
      results: null,
      hud: { on: true, title: `${this.info.icon} ${this.info.title}`, score: 0, combo: null, time: null, timeLabel: "Vaqt", lives: null, bar: 1, players: this._players.map(() => ({ score: 0, label: "", extra: "" })) },
    });
    this.setState("preparing");
  }

  /** Called by the SceneHost once the game scene is mounted and its shaders are compiled. */
  sceneReady(): void {
    if (this._state !== "preparing") return;
    this.qc.hold(performance.now() / 1000 + 2.5);
    this.setState("countdown");
  }

  pause(reason: "manual" | "lost" | "hidden"): void {
    if (this._state !== "play") return;
    const lost = reason === "lost";
    const locked = this.tracker.lock.slots.some((s) => s.mode === "locked");
    useRunUI.getState().patch({
      pause: {
        reason,
        title: lost ? (this._playerCount === 2 ? "O‘yinchi ko‘rinmayapti" : "O‘yinchi ko‘rinmayapti") : reason === "hidden" ? "Sahifa yashirildi" : "O‘yin to‘xtatildi",
        sub: lost
          ? locked
            ? "Kamera oldiga qayting — o‘yin o‘zi davom etadi. Boshqa odamlar o‘ynay olmaydi."
            : "Kamera oldiga qayting — o‘yin o‘zi davom etadi."
          : "Davom etish uchun qo‘lingizni tugma ustida ushlab turing",
      },
    });
    this.lostFlag = lost;
    this.setState("pause");
    this.audioEngine.humSet(0, 0);
    this.audioEngine.musicStop();
  }

  resume(): void {
    if (this._state !== "pause") return;
    this.resumeAt = 0;
    this.countT = 0;
    this.lastCount = -1;
    // short 1.2 s lead-in: skip "3" and "2"
    this.countT = 1.2;
    this.lastCount = Math.floor(this.countT / 0.8) - 1;
    this.setState("countdown");
    if (this.lostFlag) this.lostFlag = false;
  }

  private showResults(): void {
    const r = this.result;
    if (!r) return;
    this.result = null;
    const prevBest = readBest(this.slug);
    const isBest = r.score > prevBest;
    if (isBest) writeBest(this.slug, r.score);
    const st = this.info.stars;
    const stars = r.score >= st[2] ? 3 : r.score >= st[1] ? 2 : r.score >= st[0] ? 1 : 0;
    let winner: number | null = null;
    if (r.players && r.players.length === 2) winner = r.players[0].score === r.players[1].score ? -1 : r.players[0].score > r.players[1].score ? 0 : 1;
    this.endGameAudio();
    if (isBest || stars >= 2) this.audioEngine.win();
    else this.audioEngine.lose();
    useRunUI.getState().patch({
      results: {
        game: `${this.info.icon} ${this.info.title}`,
        score: Math.round(r.score),
        stars,
        best: isBest ? Math.round(r.score) : prevBest,
        isBest,
        lines: r.lines,
        winner,
        players: r.players ? r.players.map((p, i) => ({ score: Math.round(p.score), label: p.label ?? `${i + 1}-o‘yinchi` })) : null,
      },
      hud: { ...useRunUI.getState().hud, on: false },
    });
    this.setState("results");
  }

  private endGameAudio(): void {
    this.audioEngine.humStop();
    this.audioEngine.engineStop();
    this.audioEngine.ambStop();
    this.audioEngine.musicStop();
  }

  /** Leave the game (Esc / back button). */
  exit(): void {
    this.init.onExit();
  }

  toggleMute(): void {
    const st = useSettings.getState();
    st.set({ sound: !st.sound });
    this.audioEngine.refresh();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!down) {
      this.keys.delete(k);
      return;
    }
    this.keys.add(k);
    if (k === "Escape") this.exit();
    else if (k === "p" || k === " ") {
      if (this._state === "play") this.pause("manual");
      else if (this._state === "pause") this.resume();
      if (k === " " && this._state !== "ready") e.preventDefault();
    } else if (k === "m") this.toggleMute();
    else if (k === "Enter") {
      if (this._state === "ready") this.startGame();
      else if (this._state === "results") this.startGame();
    }
  }

  private setHud(v: HudValues): void {
    const ui = useRunUI.getState();
    const h = ui.hud;
    let changed = false;
    const next = { ...h };
    if (v.title !== undefined && v.title !== h.title) { next.title = v.title; changed = true; };
    if (v.score !== undefined) {
      const sc = Math.round(v.score);
      if (sc !== h.score) { next.score = sc; changed = true; };
    }
    if (v.combo !== undefined && v.combo !== h.combo) { next.combo = v.combo; changed = true; };
    if (v.time !== undefined && v.time !== h.time) { next.time = v.time; changed = true; };
    if (v.timeLabel !== undefined && v.timeLabel !== h.timeLabel) {
      next.timeLabel = v.timeLabel;
      changed = true;
    }
    if (v.lives !== undefined && v.lives !== h.lives) { next.lives = v.lives; changed = true; };
    if (v.bar !== undefined) {
      const b = Math.round(clamp(v.bar, 0, 1) * 100) / 100;
      if (b !== h.bar) { next.bar = b; changed = true; };
    }
    if (changed) ui.patch({ hud: next });
  }

  // ---------------------------------------------------------------- drawing
  private drawFx(now: number): void {
    const cv = this.fxCanvas;
    if (!cv) return;
    const c = cv.getContext("2d");
    if (!c) return;
    const { w, h } = this.stage;
    const dpr = this.fxDpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const fx = this.fx;
    if (fx.shakeA) c.setTransform(dpr, 0, 0, dpr, (Math.random() * 2 - 1) * fx.shakeA * dpr, (Math.random() * 2 - 1) * fx.shakeA * dpr);
    const s = this._state;
    const showSkel = snapshotSettings().skeleton;
    const world = this.module?.meta.world ?? false;
    if (s === "scan") {
      for (const p of this.tracker.people) {
        const idx = this.scanCands.indexOf(p);
        drawSkeleton(c, p.lm, idx >= 0 ? "rgba(52,211,153,.95)" : "rgba(255,255,255,.45)", idx >= 0 ? 4 : 2);
      }
    } else {
      for (const pf of this._players) {
        if (!pf.present) continue;
        if (s === "ready" || s === "pause" || s === "results") drawSkeleton(c, pf.lm, hexToRgba(pf.color, 0.55), 3);
        else if (showSkel && !world) drawSkeleton(c, pf.lm, hexToRgba(pf.color, 0.55), 3);
      }
      if ((s === "play" || s === "countdown") && !world) {
        for (const o of this.tracker.others) {
          drawSkeleton(c, o.lm, "rgba(255,90,106,.35)", 2, false);
          const hd = o.lm[0];
          if (hd.v >= 0.4) drawText(c, "✕ tomoshabin", hd.x, hd.y - o.scale * 0.7, 13, "rgba(255,120,130,.9)");
        }
      }
    }
    if (s === "play" || s === "countdown" || s === "pause" || s === "preparing") {
      for (const fn of this.drawFns) fn(c, this, now);
      if (world) this.drawPip(c);
    }
    fx.draw(c);
    if (fx.flashV > 0.01) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = `rgba(${fx.flashCol},${fx.flashV})`;
      c.fillRect(0, 0, w, h);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s === "scan" || s === "ready" || s === "pause" || s === "results") this.dwell.draw(c, now);
  }

  private scanCands: unknown[] = [];

  /** Skeleton over the small camera picture of "world" games. */
  private drawPip(c: CanvasRenderingContext2D): void {
    const v = this.video;
    if (!v) return;
    const r = v.getBoundingClientRect();
    if (!r.width) return;
    const { w, h } = this.stage;
    const k = r.width / w;
    c.save();
    c.beginPath();
    c.roundRect(r.left, r.top, r.width, r.height, 12);
    c.clip();
    const ox = r.left;
    const oy = r.top;
    for (const o of this.tracker.others) drawSkeleton(c, o.lm.map((p) => ({ x: ox + p.x * k, y: oy + p.y * k, v: p.v })), "rgba(255,90,106,.6)", 1.5, false);
    for (const pf of this._players) {
      if (!pf.present) continue;
      drawSkeleton(c, pf.lm.map((p) => ({ x: ox + p.x * k, y: oy + p.y * k, v: p.v })), hexToRgba(pf.color, 0.95), 2.2, true);
    }
    c.restore();
    void h;
  }

  private publishDebug(): void {
    if (!this.init.debug) return;
    const d = this.detector?.info;
    const lock = this.tracker.lock.slots.map((s, i) => `${i + 1}:${s.mode === "none" ? "—" : s.mode}${this._players[i]?.present ? "✔" : "✖"}`).join("  ");
    useRunUI.getState().patch({
      debug: {
        renderFps: Math.round(this.fpsEma),
        detectFps: Math.round(this.detEma * 10) / 10,
        latencyMs: Math.round(this.lat.total),
        inferMs: Math.round(this.lat.infer),
        latWait: Math.round(this.lat.wait),
        latApply: Math.round(this.lat.apply),
        latPeak: Math.round(this.lat.peak),
        detectCap: this.sched.capFps,
        light: `${Math.round(this.light.mean * 100)}%${this.light.state.active ? ` ↑γ${this.light.state.gamma.toFixed(2)}` : ""}${this.light.tooDark ? " QORONG‘I" : ""}`,
        camera: `${Math.round(this.camFps)} fps`,
        people: this.tracker.people.length,
        locked: lock,
        gesture: this._players.map((p) => p.gestures.name).join(" | "),
        backend: this.fakeWin().__fake ? "window.__fake" : d ? `${d.where} · ${d.delegate.pose}${d.delegate.hand ? "/" + d.delegate.hand : ""}` : "—",
        poseModel: d?.poseModel ?? "—",
        quality: `${this.quality.level} ×${this.quality.resolutionScale}`,
        gpu: `${this.device.gpu} (tier ${this.device.tier})`,
      },
      audioReady: this.audioEngine.ready,
    });
  }

  // ---------------------------------------------------------------- teardown
  destroy(): void {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    if (this.sayTimer) clearTimeout(this.sayTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.endGameAudio();
    this.audioEngine.dispose();
    this.detector?.close();
    this.detector = null;
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.drawFns.clear();
    const w = window as unknown as { __engine?: EngineRuntime };
    if (w.__engine === this) delete w.__engine;
  }
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export { PLAYER_COLORS };
export type { FxApi };
