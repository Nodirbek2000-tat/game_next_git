import * as THREE from "three";
import { drawText } from "@/engine/fx/fx2d";
import { clamp, lerp } from "@/engine/math";
import { texUrl } from "@/engine/quality/assetUrl";
import { readBest, writeBest } from "@/engine/settings/store";
import type { EngineApi, QualityLevel } from "@/engine/types";
import { CONTROL_DEFAULTS } from "@/games/mashina/config";
import { InputMapper, newControls, type PadState } from "@/games/mashina/logic/input";
import { disposeCarParts } from "@/games/mashina/render/carModel";
import { SkidMarks, Smoke } from "@/games/mashina/render/fx3d";
import { DwellController } from "@/engine/ui/dwell";
import { type Box, DOWNTOWN, type Post, HW, LANE, PITCH, blockKind, forgetFar, groundYWorld, plan, unwarp, unwarpDir, warpDir, warpX, warpZ } from "./city";
import { CityView } from "./cityView";
import { Car, type Hit, gearLabel } from "./carSim";
import { CAR_IDS, CARS, type CarId, LOD, type Lod, SKY_HDR, TRAFFIC_GLB, effectiveLevel, squeeze } from "./config";
import { CarMats, type Precompile, disposeModels, loadCar } from "./models";
import { PropField } from "./props3d";
import { Skyline } from "./skyline";
import { City, type TCar, carCircles } from "./traffic";
import { TreeField } from "./trees3d";
import { PedView, PlayerView, TrafficView } from "./views";

const SLUG = "poyga";
const KIND_NAME = { markaz: "Shahar markazi", yangi: "Yangi shahar", mahalla: "Mahalla", bog: "Bog‘", dala: "Ochiq dala" } as const;
const MAP_COL = { markaz: "#cdbf9f", yangi: "#8ea2b8", mahalla: "#c9a77a", bog: "#5d8c3a", dala: "#7fae4a" } as const;

export interface PoygaProbe {
  snapshot(): {
    phase: string;
    state: string;
    car: CarId;
    x: number;
    z: number;
    h: number;
    kmh: number;
    gear: string;
    rpm: number;
    odo: number;
    shadow: { on: boolean; sun: boolean; map: boolean; mine: boolean };
    tiles: number;
    traffic: number;
    peds: number;
    models: number;
    hits: number;
    input: { gas: number; brake: number; steer: number; source: string };
  };
}

/**
 * Shahar simulyatori (slug "poyga"): an open, endless city grid (streamed block tiles: flats with shops, glass towers,
 * mahalla, parks, mosques), a planar vehicle simulation (tyres, load transfer, gearbox, brakes, handbrake) with
 * collisions, calm traffic that keeps lanes and stops at red lights, pedestrians. Controls as in Mashina haydash:
 * knees = pedals, hands = wheel (keys WASD / arrows, Shift = handbrake, C = camera, R = reverse).
 */
export class PoygaGame {
  private scene: THREE.Scene;
  private saved: { bg: THREE.Scene["background"]; fog: THREE.Scene["fog"]; env: THREE.Texture | null; fov: number; near: number; far: number; pos: THREE.Vector3; quat: THREE.Quaternion };
  private view: CityView;
  /** these three stream in after the first picture (see `stream`) */
  private trees: TreeField | null = null;
  private skyline: Skyline | null = null;
  private props: PropField | null = null;
  private mats: CarMats;
  private warmCars: THREE.Group;
  private player: PlayerView;
  private trafficV: TrafficView;
  private pedV: PedView;
  private city: City;
  /** the quality level the scene was built for, and the numbers it follows now (the controller never goes above the built level) */
  private built: QualityLevel;
  private lod: Lod;
  private lodLevel: QualityLevel | null = null;
  private lodSqueeze = 0;
  /** seconds of streaming time (loading screen + play) and how many of the loading stages have started */
  private clock = 0;
  private stage = 0;
  private car: Car;
  private input = new InputMapper(CONTROL_DEFAULTS, { seated: false, kids: false, handbrakeSide: "R" });
  private controls = newControls();
  private sun = new THREE.DirectionalLight(0xfff0dc, 3.6);
  private hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6b604c, 0.32);
  private envTex: THREE.Texture | null = null;
  private bgTex: THREE.Texture | null = null;
  private phase: "garage" | "drive" = "garage";
  private carId: CarId;
  private colorIdx = 0;
  private garageT = 0;
  private steerArmed = true;
  private keyPrev = { enter: false, c: false };
  private cam: "chase" | "cockpit" = "chase";
  private wheelT = 0;
  /** tyre marks and tyre smoke (braking hard, drifting, spinning the wheels) */
  private skid = new SkidMarks();
  private smoke = new Smoke();
  /** pedestrian poses, reused every frame */
  private pedW = Array.from({ length: 30 }, () => ({ x: 0, z: 0, h: 0, color: 0, phase: 0 }));
  /** seconds the tyre smoke may still be alive (the points are hidden and not updated after that) */
  private smokeT = 0;
  /** garage menu: a hand cursor (camera); holding still over a button presses it */
  private cursor: DwellController | null = null;
  private buttons: { id: "prev" | "next" | "color" | "go"; label: string; x: number; y: number; w: number; h: number }[] = [];
  private hover: string | null = null;
  private hoverT = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camH = 0;
  private camInit = false;
  private blend = 0;
  private roll = 0;
  private t = 0;
  private best = 0;
  private audioOn = false;
  private hitCd = 0;
  private hits = 0;
  private msgs: { text: string; col: string; t: number }[] = [];
  private lastKind = "";
  private modelsLoaded = 0;
  private alive = true;
  private shadows: boolean;
  private probe: PoygaProbe;
  private boxes: Box[] = [];
  private posts: Post[] = [];
  /** `posts` + the circles of the traffic near the car; the first postBase entries are the static ones */
  private postBuf: Post[] = [];
  private postBase = 0;
  /** the block the collision lists were made for */
  private nearI = NaN;
  private nearJ = NaN;
  private gl: THREE.WebGLRenderer;
  private savedShadow = false;
  private tA = new THREE.Vector3();
  private tB = new THREE.Vector3();
  private tC = new THREE.Vector3();
  private tD = new THREE.Vector3();
  private tw: [number, number] = [0, 0];
  private probeRT: THREE.WebGLRenderTarget | null = null;
  /** compile the shaders of an object that is not in the scene yet, against the real lights and haze (no stall when it is shown) */
  private precompile: Precompile = (o) => this.compileFor(o, this.scene);

  constructor(
    private engine: EngineApi,
    private root: THREE.Group,
    private camera: THREE.PerspectiveCamera,
    gl: THREE.WebGLRenderer,
  ) {
    const e = engine;
    let p: THREE.Object3D | null = root;
    while (p && !(p as THREE.Scene).isScene) p = p.parent;
    this.scene = (p as THREE.Scene) ?? new THREE.Scene();
    this.saved = {
      bg: this.scene.background, fog: this.scene.fog, env: this.scene.environment, fov: camera.fov, near: camera.near, far: camera.far,
      pos: camera.position.clone(), quat: camera.quaternion.clone(),
    };
    // no real-time shadows (the cars keep their soft contact shadows; ambient occlusion grounds the rest)
    this.shadows = false;
    this.gl = gl;
    this.savedShadow = gl.shadowMap.enabled;
    gl.shadowMap.enabled = this.shadows;
    const q = e.query.get("car") as CarId | null;
    let stored: CarId | null = null;
    try {
      stored = localStorage.getItem("harakat.poyga.car") as CarId | null;
    } catch {
      /* private mode */
    }
    this.carId = q && q in CARS ? q : stored && stored in CARS ? stored : "boron";
    if (e.query.get("start") === "1") this.phase = "drive";
    this.best = readBest(SLUG) / 1000;
    this.built = e.quality.level;
    this.lod = LOD[this.built];
    this.city = new City(this.lod.cars, this.lod.peds);

    // ---- light: warm sun with soft shadows, sky fill, haze
    this.scene.background = new THREE.Color(0xd5dde4);
    this.scene.fog = new THREE.Fog(0xd8dfe4, this.lod.fogNear, this.lod.fogFar);
    camera.near = 0.25;
    camera.far = this.lod.fogFar * 1.04;
    camera.updateProjectionMatrix();
    if (this.shadows) {
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = sc.bottom = -60;
      sc.right = sc.top = 60;
      sc.near = 5;
      sc.far = 320;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.06;
      this.sun.shadow.radius = 3;
      // (without this the shadow camera keeps its default 10 m box: shadows only right under the car)
      sc.updateProjectionMatrix();
    }
    root.add(this.sun, this.sun.target, this.hemi);
    this.loadSky(gl);

    // ---- the essentials, built now: the road around the car, the car, the sky. Traffic models, the image light, the far
    // city, trees and street furniture stream in afterwards (see `stream`), so the game opens fast.
    this.view = new CityView(gl, this.built, this.shadows);
    root.add(this.view.group);
    this.mats = new CarMats(this.lod.clearcoat);
    this.warmCars = this.mats.warm();
    this.player = new PlayerView(this.mats, this.shadows);
    this.trafficV = new TrafficView(this.mats, 12, this.shadows);
    this.pedV = new PedView(30, this.shadows);
    root.add(this.player.group, this.trafficV.group, this.pedV.group, this.skid.mesh, this.smoke.points, this.warmCars);
    this.car = new Car(CARS[this.carId].phys);
    this.car.ground = groundYWorld;
    // spawn: the inner northbound lane of the street x = 0 (right-hand traffic: heading +z drives at x < 0)
    this.placePlan(-LANE / 2, 46, 0);
    // ?at=downtown starts among the towers (handy for screenshots / tests)
    const at = e.query.get("at");
    if (at === "downtown") this.placePlan(DOWNTOWN[0] * PITCH - LANE / 2, DOWNTOWN[1] * PITCH - 60, 0);
    else if (at && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?(,-?\d+(\.\d+)?)?$/.test(at)) {
      const [ax, az, ah] = at.split(",").map(Number);
      this.placePlan(ax, az, ah ?? 0);
    }
    this.setCar(this.carId);
    // only the tiles under the car now; the rest of the ring is built a few per frame
    this.view.update(this.car.x, this.car.z, 0);
    this.view.work(0);
    this.applyLod();
    // (the engine's own start-up precompile builds the screen variants; with the post pipeline the game is drawn into a render target)
    if (this.lod.post) void this.precompile(this.root);

    this.probe = { snapshot: () => this.snapshot() };
    (window as unknown as { __poyga?: PoygaProbe }).__poyga = this.probe;
    e.hud.set({ title: "🏎️ Shahar simulyatori", score: 0, combo: null, time: null, lives: null });
  }

  /** place the car at a PLAN position / heading (the world is the warped plan) */
  private placePlan(x: number, z: number, h: number): void {
    const [dx, dz] = warpDir(x, z, Math.sin(h), Math.cos(h));
    this.car.place(warpX(x, z), warpZ(x, z), Math.atan2(dx, dz));
  }

  /** the car's plan position (for the city plan, the traffic and the map) */
  private planPos: [number, number] = [0, 0];

  /**
   * Collide in PLAN space (the buildings are axis-aligned boxes there): move the car into the plan, push it out,
   * map the result back into the world. Untouched when nothing is hit (no drift from the round trip).
   */
  private collidePlan(boxes: readonly Box[], posts: readonly Post[]): Hit | null {
    const car = this.car;
    const [px, pz] = unwarp(car.x, car.z);
    const wx = car.x;
    const wz = car.z;
    const wvx = car.vx;
    const wvz = car.vz;
    const wh = car.h;
    const [hx, hz] = unwarpDir(px, pz, Math.sin(car.h), Math.cos(car.h));
    const [vx, vz] = unwarpDir(px, pz, car.vx, car.vz);
    car.x = px;
    car.z = pz;
    car.h = Math.atan2(hx, hz);
    car.vx = vx;
    car.vz = vz;
    const hit = car.collide(boxes, posts);
    if (!hit) {
      car.x = wx;
      car.z = wz;
      car.vx = wvx;
      car.vz = wvz;
      car.h = wh;
      return null;
    }
    const [dx, dz] = warpDir(car.x, car.z, Math.sin(car.h), Math.cos(car.h));
    const [nvx, nvz] = warpDir(car.x, car.z, car.vx, car.vz);
    const nx = warpX(car.x, car.z);
    const nz = warpZ(car.x, car.z);
    car.x = nx;
    car.z = nz;
    car.vx = nvx;
    car.vz = nvz;
    car.h = Math.atan2(dx, dz);
    return hit;
  }

  private loadSky(gl: THREE.WebGLRenderer): void {
    // the background: a photo sky (Poly Haven kloofendal_48d_partly_cloudy_puresky, CC0) converted in Blender, shipped as a
    // 2048 x 1024 WebP (1024 x 512 on "low") for ~50 kB; lighting / reflections: the 1k HDR of the same sky (see `loadEnv`)
    const bg = new THREE.TextureLoader().load(texUrl("/textures/poyga/osmon_4k", this.built), (t) => {
      if (!this.alive) return;
      gl.initTexture(t);
      this.scene.background = t;
      this.scene.backgroundIntensity = 1;
      // the haze takes the colour of the sky just above the horizon, so the city melts into it without a seam
      try {
        const img = t.image as HTMLImageElement;
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 128;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, 256, 128);
        const row = g.getImageData(0, 60, 256, 2).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let i = 0; i < row.length; i += 4) {
          r += row[i];
          gg += row[i + 1];
          b += row[i + 2];
        }
        const n = row.length / 4;
        (this.scene.fog as THREE.Fog).color.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
      } catch {
        /* keep the default haze */
      }
    });
    bg.mapping = THREE.EquirectangularReflectionMapping;
    bg.colorSpace = THREE.SRGBColorSpace;
    // (a sky needs no anisotropic filtering)
    bg.anisotropy = 1;
    this.bgTex = bg;
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
      if (this.lod.post) gl.setRenderTarget((this.probeRT ??= new THREE.WebGLRenderTarget(1, 1)));
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
      // switch when they are ready, so no frame waits for a whole city of shaders
      const probe = new THREE.Scene();
      probe.environment = this.envTex;
      probe.fog = this.scene.fog;
      await this.compileFor(this.root, probe);
      if (!this.alive) return;
      this.scene.environment = this.envTex;
    } catch {
      /* no image lighting: the sun and the hemisphere light still work */
    }
  }

  /** the four traffic models (the stand-in bodies are shown until each has arrived) */
  private loadTraffic(): void {
    for (const [kind, url] of Object.entries(TRAFFIC_GLB) as [keyof typeof TRAFFIC_GLB, string][]) {
      void loadCar(url).then((m) => {
        if (!this.alive || !m) return;
        this.trafficV.setModel(kind, m);
        this.modelsLoaded++;
      });
    }
  }

  // ------------------------------------------------------------------------------------------ quality and streaming

  /**
   * Follow the quality level. Cheap and live: tile / far-city / tree / prop radius, haze and far plane, traffic and people
   * counts, image light, tyre marks. What was decided when the scene was built (maps, clear coat, which models were fetched)
   * stays; the controller never goes above the level the game started on.
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
    const fog = this.scene.fog as THREE.Fog;
    fog.near = lod.fogNear * sq;
    fog.far = lod.fogFar * sq;
    this.camera.far = fog.far * 1.04;
    this.camera.updateProjectionMatrix();
    this.scene.environmentIntensity = lod.env;
    this.view.setRadius(lod.tileR);
    this.skyline?.setLod(Math.max(1, Math.round(lod.farR * sq)), lod.towerR);
    this.trees?.setLevel(lvl);
    this.city.setCounts(Math.max(2, Math.round(lod.cars * sq)), Math.max(2, Math.round(lod.peds * sq)));
  }

  /**
   * What the first picture does not need arrives afterwards, one step per frame at most: image light and traffic models, the
   * far city and towers, trees, street furniture. Then the city around the car is queued and built a little per frame
   * (`boost` stretches the time allowed per frame: on the loading screen nobody sees a slow frame).
   */
  private stream(dt: number, boost: number): void {
    this.clock += dt;
    if (this.stage === 0 && this.clock > 0.15) {
      this.stage = 1;
      void this.loadEnv();
      this.loadTraffic();
    } else if (this.stage === 1 && this.clock > 0.6) {
      this.stage = 2;
      this.skyline = new Skyline(this.gl, this.built, this.precompile);
      this.root.add(this.skyline.group);
      this.lodLevel = null;
      this.applyLod();
    } else if (this.stage === 2 && this.clock > 1.4) {
      this.stage = 3;
      this.trees = new TreeField(this.gl, this.built, this.shadows, this.precompile);
      this.root.add(this.trees.group);
      this.lodLevel = null;
      this.applyLod();
    } else if (this.stage === 3 && this.clock > 2.2) {
      this.stage = 4;
      if (LOD[this.built].propR > 0) {
        this.props = new PropField(this.shadows, this.precompile);
        this.root.add(this.props.group);
      }
    }
    const x = this.car.x;
    const z = this.car.z;
    this.view.update(x, z, this.city.t);
    this.skyline?.update(x, z);
    this.props?.update(x, z, this.lod.propR);
    // the time is shared nearest-first: tiles, then trees, props and the far city (each gets a little even when the tiles used it up)
    const now = performance.now();
    const until = now + this.lod.workMs * boost;
    this.view.work(until);
    this.trees?.update(dt, this.camera.position.x, this.camera.position.z, Math.max(until, now + 1));
    this.props?.work(Math.max(until, now + 1));
    this.skyline?.work(Math.max(until, now + 1.5));
  }

  /** Called while the engine shows its loading screen (the game frame does not run yet): builds the city meanwhile. */
  preload(dt: number): void {
    if (!this.alive) return;
    this.applyLod();
    this.stream(dt, 2.5);
  }

  private setCar(id: CarId): void {
    this.carId = id;
    const spec = CARS[id];
    this.car.p = spec.phys;
    this.colorIdx = this.colorIdx % spec.colors.length;
    this.player.set(null, spec.wheels, spec.exhaust, spec.colors[this.colorIdx]);
    void loadCar(spec.glb).then((m) => {
      if (!this.alive || this.carId !== id || !m) return;
      this.player.set(m, spec.wheels, spec.exhaust, spec.colors[this.colorIdx]);
      this.modelsLoaded++;
    });
    try {
      localStorage.setItem("harakat.poyga.car", id);
    } catch {
      /* private mode */
    }
  }

  // ------------------------------------------------------------------------------------------ frame

  frame(dtIn: number): void {
    if (!this.alive) return;
    const e = this.engine;
    const dt = Math.min(0.05, dtIn);
    this.t += dt;
    // the engine's Canvas re-applies its own shadow setting when it reconfigures (e.g. a resolution change): keep ours
    if (this.gl.shadowMap.enabled !== this.shadows) {
      this.gl.shadowMap.enabled = this.shadows;
      this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
      this.gl.shadowMap.needsUpdate = true;
    }
    const playing = e.state === "play";
    if (playing && e.audio.ready && !this.audioOn) {
      e.audio.engineStart();
      this.audioOn = true;
    }
    let pad: PadState | null = null;
    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      const g = navigator.getGamepads()[0];
      if (g) pad = g as unknown as PadState;
    }
    const c = this.input.update(dt, e.players[0] ?? null, e.keys, pad, this.car.vLong, e.stage.h, this.controls);
    // the body wheel counts only while both hands are held up in front of the chest (between the head and the hips);
    // with the arms hanging down the wrists' line must not steer the car. Small angles are a dead zone.
    if (c.source === "body") {
      const p = e.players[0];
      const L = p?.lm;
      let wheel = false;
      if (p?.present && L) {
        const lw = L[15];
        const rw = L[16];
        const hipY = Math.min(L[23].y, L[24].y);
        const noseY = L[0].y;
        const sc = Math.max(1, p.scale);
        wheel = lw.v > 0.45 && rw.v > 0.45 && lw.y < hipY - sc * 0.08 && rw.y < hipY - sc * 0.08 && lw.y > noseY - sc * 0.15 && rw.y > noseY - sc * 0.15;
      }
      this.wheelT = wheel ? Math.min(1, this.wheelT + dt * 4) : Math.max(0, this.wheelT - dt * 6);
      c.steer *= this.wheelT;
    }
    if (Math.abs(c.steer) < 0.07) c.steer = 0;
    if (this.phase === "garage") this.garage(dt, playing);
    else if (playing) this.drive(dt);
    this.applyLod();
    this.stream(dt, this.t < 3 ? 1.5 : 1);
    this.place(dt, c.steer);
    for (const m of this.msgs) m.t -= dt;
    while (this.msgs.length && this.msgs[0].t <= 0) this.msgs.shift();
  }

  private press(id: string): void {
    const e = this.engine;
    if (id === "prev" || id === "next") {
      const i = CAR_IDS.indexOf(this.carId);
      this.setCar(CAR_IDS[(i + (id === "next" ? 1 : CAR_IDS.length - 1)) % CAR_IDS.length]);
      e.audio.click();
    } else if (id === "color") {
      const spec = CARS[this.carId];
      this.colorIdx = (this.colorIdx + 1) % spec.colors.length;
      this.mats.paint.color.set(spec.colors[this.colorIdx]);
      e.audio.click();
    } else if (id === "go" && e.state === "play") {
      this.phase = "drive";
      e.audio.good();
      e.audio.musicStart(96, "drive");
      this.msg("Shahar ochiq — istalgan tomonga haydang", "#ffd23f", 3);
    }
  }

  private garage(dt: number, playing: boolean): void {
    const e = this.engine;
    const c = this.controls;
    if (playing) this.garageT += dt;
    // buttons (stage px)
    const W = e.stage.w;
    const H = e.stage.h;
    const u = Math.min(W, H) / 720;
    const bw = 150 * u;
    const bh = 64 * u;
    const y = H * 0.62;
    this.buttons = [
      { id: "prev", label: "◀", x: W * 0.12, y: H * 0.45, w: 90 * u, h: 90 * u },
      { id: "next", label: "▶", x: W * 0.88 - 90 * u, y: H * 0.45, w: 90 * u, h: 90 * u },
      { id: "color", label: "Rang", x: W / 2 - bw - 20 * u, y, w: bw, h: bh },
      { id: "go", label: "BOSHLASH", x: W / 2 + 20 * u, y, w: bw * 1.3, h: bh },
    ];
    // the hand cursor
    this.cursor ??= new DwellController(e.config.cursor, e.config.cursorFilter, () => {}, () => e.audio.click());
    const cur = this.cursor;
    cur.updateCursor(e.players, performance.now(), W, H);
    let over: string | null = null;
    if (cur.on) for (const b of this.buttons) if (cur.x >= b.x && cur.x <= b.x + b.w && cur.y >= b.y && cur.y <= b.y + b.h) over = b.id;
    if (over !== this.hover) {
      this.hover = over;
      this.hoverT = 0;
    } else if (over) this.hoverT += dt;
    if (over && this.hoverT > 1.3) {
      this.press(over);
      this.hoverT = -0.6;
    }
    // keys still work: arrows / Enter / C
    const k = e.keys;
    const enter = k.has("Enter");
    if (enter && !this.keyPrev.enter) this.press("go");
    this.keyPrev.enter = enter;
    const ck = k.has("c");
    if (ck && !this.keyPrev.c) this.press("color");
    this.keyPrev.c = ck;
    const left = k.has("ArrowLeft") || k.has("a");
    const right = k.has("ArrowRight") || k.has("d");
    if ((left || right) && this.steerArmed) {
      this.press(right ? "next" : "prev");
      this.steerArmed = false;
    } else if (!left && !right) this.steerArmed = true;
    if (this.garageT > 40 && playing) this.press("go");
    void c;
  }

  private drive(dt: number): void {
    const e = this.engine;
    const c = this.controls;
    const car = this.car;
    if (c.camToggle) this.cam = this.cam === "chase" ? "cockpit" : "chase";
    // obstacles of the blocks around the car (plan space); nearby traffic as circles
    const [cpx, cpz] = unwarp(car.x, car.z, this.planPos);
    const bi = Math.floor(cpx / PITCH);
    const bj = Math.floor(cpz / PITCH);
    if (bi !== this.nearI || bj !== this.nearJ) {
      this.nearI = bi;
      this.nearJ = bj;
      this.boxes = [];
      this.posts = [];
      for (let i = bi - 1; i <= bi + 1; i++)
        for (let j = bj - 1; j <= bj + 1; j++) {
          const pl = plan(i, j);
          for (const b of pl.buildings) if (b.solid) this.boxes.push(b);
          for (const p of pl.posts) if (p.r > 0) this.posts.push(p);
        }
      forgetFar(bi, bj, PLAN_KEEP);
      this.postBuf = this.posts.slice();
      this.postBase = this.postBuf.length;
    }
    // the static posts plus the circles of the traffic cars near the car
    const posts = this.postBuf;
    posts.length = this.postBase;
    for (const t of this.city.cars) if (Math.hypot(t.x - cpx, t.z - cpz) < 12) for (const [x, z, r] of carCircles(t)) posts.push({ x, z, r, kind: "tree", seed: t.id });
    const ctl = { gas: c.gas, brake: c.brake, steer: c.steer, handbrake: c.handbrake, reverse: c.reverse };
    const N = 4;
    let hit: Hit | null = null;
    for (let k = 0; k < N; k++) {
      car.step(dt / N, ctl);
      const h1 = this.collidePlan(this.boxes, posts);
      if (h1 && (!hit || h1.speed > hit.speed)) hit = h1;
    }
    if (hit && hit.speed > 2.5 && this.hitCd <= 0) {
      this.hits++;
      this.hitCd = 0.5;
      e.audio.crash();
      e.fx.shake(Math.min(14, hit.speed * 0.8), 0.3);
      this.sparks(hit.speed);
      for (const t of this.city.cars) if (Math.hypot(t.x - hit.x, t.z - hit.z) < 3.5) this.city.bump(t);
    }
    this.hitCd -= dt;
    this.tyres(dt);
    {
      const [px, pz] = unwarp(car.x, car.z, this.planPos);
      const [vx, vz] = unwarpDir(px, pz, car.vx, car.vz);
      this.city.step(dt, px, pz, { x: vx, z: vz });
    }
    const rpm01 = clamp((car.rpm - car.p.idleRpm) / (car.p.maxRpm - car.p.idleRpm), 0, 1);
    e.audio.engineSet(0.2 + 0.8 * rpm01, c.gas);
    if (car.speed > 8 && (car.slipR > 0.17 || (c.brake > 0.8 && car.aLong < -6) || c.handbrake)) e.audio.screech(Math.min(1, car.slip + 0.3));
    const kind = KIND_NAME[blockKind(Math.floor(this.planPos[0] / PITCH), Math.floor(this.planPos[1] / PITCH))];
    if (kind !== this.lastKind) {
      if (this.lastKind) this.msg(kind, "#ffffff", 1.8);
      this.lastKind = kind;
    }
    const km = car.odo / 1000;
    if (km > this.best + 0.25) {
      this.best = km;
      writeBest(SLUG, Math.round(km * 1000));
    }
    e.hud.set({ score: Math.round(car.odo) });
  }

  /** marks on the ground and smoke where a tyre slides: drifting / spinning (rear), locking up (all four) */
  private tyres(dt: number): void {
    const car = this.car;
    const c = this.controls;
    const sp = car.speed;
    const W = CARS[this.carId].wheels;
    // only real sliding: the rear tyres beyond ~10 degrees in a hard turn / slide, a handbrake turn, a burnout,
    // or braking hard enough to make the tyres scrub (normal driving leaves nothing)
    const rearSlide = sp > 8 && (car.slipR > 0.17 || (c.handbrake && sp > 5) || car.wheelspin > 0.3);
    const frontSlide = sp > 8 && car.slipF > 0.2;
    const braking = sp > 10 && c.brake > 0.8 && car.aLong < -6;
    const lx = Math.cos(car.h);
    const lz = -Math.sin(car.h);
    const fx = Math.sin(car.h);
    const fz = Math.cos(car.h);
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const front = i < 2;
      const ox = left ? W.x : -W.x;
      const oz = front ? W.zf : W.zr;
      const wx = car.x + lx * ox + fx * oz;
      const wz = car.z + lz * ox + fz * oz;
      const slide = braking || (front ? frontSlide : rearSlide);
      this.skid.wheel(i, wx, car.y + 0.012, wz, fx, fz, slide && this.lod.skid);
      // smoke: thick from the rear in a drift / burnout, thin from all wheels when locking up
      const rate = rearSlide && !front ? 30 * Math.min(1, 0.3 + car.slipR * 2 + car.wheelspin) : frontSlide && front ? 10 : braking ? 5 : 0;
      if (rate > 0) {
        this.smokeT = 1.8;
        if (Math.random() < dt * rate) this.smoke.emit(wx, car.y, wz, car.vx, car.vz);
      }
    }
  }

  private sparks(speed: number): void {
    const e = this.engine;
    const v = this.tA.set(this.car.x, this.car.y + 0.6, this.car.z).project(this.camera);
    e.fx.burst((v.x * 0.5 + 0.5) * e.stage.w, (-v.y * 0.5 + 0.5) * e.stage.h, Math.round(8 + speed * 2), () => (Math.random() < 0.5 ? "#ffd27a" : "#ff9a3c"), [150, 600], [1.5, 3], [0.2, 0.5], true, 900);
  }

  private msg(text: string, col: string, t: number): void {
    this.msgs.push({ text, col, t });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  /** world pose of one traffic car (false: too far to draw) */
  private poseCar = (t: TCar, o: THREE.Object3D): boolean => {
    const wx = warpX(t.x, t.z);
    const wz = warpZ(t.x, t.z);
    if (Math.hypot(wx - this.car.x, wz - this.car.z) > 330) return false;
    warpDir(t.x, t.z, Math.sin(t.h), Math.cos(t.h), this.tw);
    o.position.set(wx, 0, wz);
    o.rotation.set(0, Math.atan2(this.tw[0], this.tw[1]), 0);
    return true;
  };

  /** world poses of the player, traffic, people, the camera and the sun */
  private place(dt: number, steer: number): void {
    const car = this.car;
    const g = this.player.group;
    g.position.set(car.x, car.y, car.z);
    // body pitch under braking / acceleration, roll in turns
    g.rotation.set(clamp(car.aLong * 0.006, -0.05, 0.05), car.h, clamp(car.aLat * 0.007, -0.06, 0.06), "YXZ");
    this.player.update(car.vLong, steer, dt, false, this.t);
    this.trafficV.update(this.city.cars, this.poseCar);
    const tw = this.tw;
    let n = 0;
    for (const p of this.city.peds) {
      if (n >= this.pedW.length) break;
      warpDir(p.x, p.z, Math.sin(p.h), Math.cos(p.h), tw);
      const o = this.pedW[n++];
      o.x = warpX(p.x, p.z);
      o.z = warpZ(p.x, p.z);
      o.h = Math.atan2(tw[0], tw[1]);
      o.color = p.color;
      o.phase = p.phase;
    }
    this.pedV.update(this.pedW, 0.15, n);
    // the tyre smoke is a draw call and two buffer uploads a frame: only while there is some
    this.smoke.density = Math.max(0.25, this.engine.quality.particles);
    this.smokeT = Math.max(0, this.smokeT - dt);
    this.smoke.points.visible = this.smokeT > 0;
    if (this.smokeT > 0) this.smoke.update(dt, this.engine.stage.h);
    // ---- camera: orbit in the garage, smooth chase / cockpit when driving
    const cam = this.camera;
    const driving = this.phase === "drive";
    this.blend = clamp(this.blend + (driving ? dt / 1.5 : -dt), 0, 1);
    const bl = this.blend * this.blend * (3 - 2 * this.blend);
    const sp = clamp(car.speed / 60, 0, 1);
    // the chase camera follows half way between where the car points and where it goes (slides look like slides)
    const vh = car.speed > 3 && car.vLong > 0 ? Math.atan2(car.vx, car.vz) : car.h;
    const want = car.h + Math.atan2(Math.sin(vh - car.h), Math.cos(vh - car.h)) * 0.5;
    if (!this.camInit) this.camH = want;
    const dh = Math.atan2(Math.sin(want - this.camH), Math.cos(want - this.camH));
    this.camH += dh * (1 - Math.exp(-5 * dt));
    const fx = Math.sin(this.camH);
    const fz = Math.cos(this.camH);
    const back = 6.2 + sp * 0.6;
    const chase = this.tA.set(car.x - fx * back, car.y + 1.9 - sp * 0.2, car.z - fz * back);
    const chaseLook = this.tB.set(car.x + fx * 4, car.y + 0.9, car.z + fz * 4);
    if (this.cam === "cockpit" && driving) {
      const hx = Math.sin(car.h);
      const hz = Math.cos(car.h);
      // driver's head, left-hand drive: +x of the car frame is its left = -right = (cos h, -sin h)
      chase.set(car.x + hz * 0.36 - hx * 0.15, car.y + 1.02, car.z - hx * 0.36 - hz * 0.15);
      chaseLook.set(chase.x + hx * 10, chase.y - 0.25, chase.z + hz * 10);
    }
    const a = this.t * 0.2 + 0.8;
    const R = 6.8 + Math.sin(this.t * 0.35) * 0.4;
    const orbit = this.tC.set(car.x + Math.sin(car.h + a) * R, car.y + 1.3 + Math.sin(this.t * 0.3) * 0.3, car.z + Math.cos(car.h + a) * R);
    const orbitLook = this.tD.set(car.x, car.y + 0.55, car.z);
    this.camPos.copy(orbit).lerp(chase, bl);
    this.camLook.copy(orbitLook).lerp(chaseLook, bl);
    this.camInit = true;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    this.roll = lerp(this.roll, driving && this.cam === "chase" ? clamp(car.aLat * -0.004, -0.04, 0.04) : 0, 1 - Math.exp(-4 * dt));
    cam.rotateZ(this.roll);
    const fov = lerp(42, (this.cam === "cockpit" ? 68 : 60) + 10 * sp, bl);
    if (Math.abs(cam.fov - fov) > 0.02) {
      cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-3 * dt));
      cam.updateProjectionMatrix();
    }
    this.sun.position.set(car.x + 80, 95, car.z - 55);
    this.sun.target.position.set(car.x, 0, car.z);
  }

  // ------------------------------------------------------------------------------------------ 2D overlay

  draw(c: CanvasRenderingContext2D): void {
    const e = this.engine;
    const W = e.stage.w;
    const H = e.stage.h;
    const u = Math.min(W, H) / 720;
    const car = this.car;
    if (this.phase === "garage") {
      const spec = CARS[this.carId];
      drawText(c, spec.name, W / 2, H * 0.2, 54 * u, "#fff");
      drawText(c, `${spec.phys.torque} N·m · ${Math.round(spec.top * 3.6)} km/soat`, W / 2, H * 0.2 + 46 * u, 20 * u, "#ffd23f");
      const bars: [string, number][] = [["Tezlik", spec.stats.tezlik], ["Tezlanish", spec.stats.tezlanish], ["Boshqaruv", spec.stats.boshqaruv]];
      bars.forEach(([name, v], i) => {
        const y = H * 0.74 + i * 30 * u;
        drawText(c, name, W / 2 - 130 * u, y, 17 * u, "#fff", "right", 700);
        c.fillStyle = "rgba(0,0,0,.45)";
        c.fillRect(W / 2 - 115 * u, y - 7 * u, 230 * u, 14 * u);
        c.fillStyle = "#ffd23f";
        c.fillRect(W / 2 - 115 * u, y - 7 * u, 230 * u * v, 14 * u);
      });
      for (const b of this.buttons) {
        const hot = this.hover === b.id;
        c.save();
        c.fillStyle = b.id === "go" ? (hot ? "#ffd23f" : "rgba(255,210,63,.85)") : hot ? "rgba(255,255,255,.95)" : "rgba(20,22,28,.6)";
        c.strokeStyle = "rgba(255,255,255,.7)";
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(b.x, b.y, b.w, b.h, 16 * u);
        c.fill();
        c.stroke();
        c.restore();
        drawText(c, b.label, b.x + b.w / 2, b.y + b.h / 2, (b.id === "prev" || b.id === "next" ? 40 : 24) * u, b.id === "go" || hot ? "#111" : "#fff");
        if (hot && this.hoverT > 0) {
          c.save();
          c.strokeStyle = "#22d3ee";
          c.lineWidth = 5 * u;
          c.beginPath();
          c.arc(b.x + b.w / 2, b.y - 16 * u, 12 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.hoverT / 1.3));
          c.stroke();
          c.restore();
        }
      }
      const cur = this.cursor;
      if (cur?.on) {
        c.save();
        c.fillStyle = "rgba(255,255,255,.95)";
        c.strokeStyle = "rgba(0,0,0,.55)";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cur.x, cur.y, 13 * u, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.restore();
      }
      drawText(c, "Qo‘lni tugmaga olib boring va bir soniya ushlab turing · klaviatura: ← → C Enter", W / 2, H * 0.93, 17 * u, "#fff", "center", 700);
      return;
    }
    const kmh = Math.round(car.speed * 3.6);
    const sx = W - 130 * u;
    const sy = H - 120 * u;
    const rpm01 = clamp(car.rpm / car.p.maxRpm, 0, 1);
    c.save();
    c.lineCap = "round";
    c.lineWidth = 12 * u;
    c.strokeStyle = "rgba(0,0,0,.45)";
    c.beginPath();
    c.arc(sx, sy, 86 * u, Math.PI * 0.75, Math.PI * 2.25);
    c.stroke();
    c.strokeStyle = rpm01 > 0.9 ? "#ff4d4d" : "#ffd23f";
    c.beginPath();
    c.arc(sx, sy, 86 * u, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * rpm01));
    c.stroke();
    c.restore();
    drawText(c, String(kmh), sx, sy - 8 * u, 46 * u, "#fff");
    drawText(c, "km/soat", sx, sy + 26 * u, 15 * u, "#ddd", "center", 700);
    drawText(c, gearLabel(car), sx, sy + 58 * u, 24 * u, car.gear < 0 ? "#ff6b6b" : "#93c5fd", "center", 900);
    drawText(c, `${(car.odo / 1000).toFixed(2)} km`, 24 * u, H - 250 * u, 22 * u, "#fff", "left");
    drawText(c, this.cam === "cockpit" ? "Kamera: salon (C)" : "Kamera: orqadan (C)", 24 * u, H - 224 * u, 14 * u, "#ddd", "left", 700);
    if (this.controls.source === "body" && !this.controls.legsReady) drawText(c, "Ikkala oyoqda tik turing — pedallar sozlanmoqda", W / 2, H - 40 * u, 18 * u, "#fff", "center", 700);
    this.minimap(c, 24 * u + 95 * u, H - 120 * u, 95 * u);
    this.msgs.forEach((m, i) => {
      c.globalAlpha = clamp(m.t * 2, 0, 1);
      drawText(c, m.text, W / 2, H * 0.2 + i * 40 * u, 28 * u, m.col);
      c.globalAlpha = 1;
    });
  }

  /** heading-up map: blocks coloured by kind, streets between them, traffic, the car */
  private minimap(c: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
    const car = this.car;
    const scale = R / 230;
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = "rgba(40,42,46,0.85)";
    c.fill();
    c.clip();
    c.translate(cx, cy);
    // map coordinates: screen x = -(world x) (x is the car's left at h = 0), screen y = -(world z) (forward is up);
    // rotating by +h keeps the car's heading up
    // the map is the (unbent) plan: the car's plan position and plan heading
    const [mx, mz] = unwarp(car.x, car.z);
    const [hx, hz] = unwarpDir(mx, mz, Math.sin(car.h), Math.cos(car.h));
    c.rotate(Math.atan2(hx, hz));
    const bi = Math.floor(mx / PITCH);
    const bj = Math.floor(mz / PITCH);
    for (let i = bi - 3; i <= bi + 3; i++)
      for (let j = bj - 3; j <= bj + 3; j++) {
        // a field is one meadow: no streets drawn through it
        const fe = blockKind(i, j) === "dala" ? HW + 0.5 : 0;
        const x0 = (i * PITCH + HW - fe - mx) * scale;
        const z0 = (j * PITCH + HW - fe - mz) * scale;
        const s = (PITCH - 2 * HW + 2 * fe) * scale;
        c.fillStyle = MAP_COL[blockKind(i, j)];
        c.fillRect(-x0 - s, -z0 - s, s, s);
      }
    c.fillStyle = "#ffffff";
    for (const t of this.city.cars) c.fillRect(-(t.x - mx) * scale - 2, -(t.z - mz) * scale - 2, 4, 4);
    c.restore();
    c.save();
    c.translate(cx, cy);
    c.fillStyle = "#ff3b30";
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 7);
    c.lineTo(0, 3);
    c.lineTo(-6, 7);
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(255,255,255,.5)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  private snapshot(): ReturnType<PoygaProbe["snapshot"]> {
    const car = this.car;
    const c = this.controls;
    return {
      phase: this.phase, state: this.engine.state, car: this.carId, x: car.x, z: car.z, h: car.h, kmh: car.speed * 3.6, gear: gearLabel(car), rpm: car.rpm, odo: car.odo,
      shadow: { on: this.gl.shadowMap.enabled, sun: this.sun.castShadow, map: !!this.sun.shadow.map, mine: this.shadows },
      tiles: this.view.count, traffic: this.city.cars.length, peds: this.city.peds.length, models: this.modelsLoaded, hits: this.hits,
      input: { gas: c.gas, brake: c.brake, steer: c.steer, source: c.source },
    };
  }

  dispose(): void {
    this.alive = false;
    writeBest(SLUG, Math.round(this.best * 1000));
    const w = window as unknown as { __poyga?: PoygaProbe };
    if (w.__poyga === this.probe) delete w.__poyga;
    this.engine.audio.engineStop();
    this.view.dispose();
    this.trees?.dispose();
    this.skyline?.dispose();
    this.props?.dispose();
    this.player.dispose();
    this.trafficV.dispose();
    this.pedV.dispose();
    this.skid.dispose();
    this.smoke.dispose();
    this.warmCars.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.mats.dispose();
    disposeCarParts();
    disposeModels();
    this.envTex?.dispose();
    this.bgTex?.dispose();
    this.probeRT?.dispose();
    this.root.clear();
    this.gl.shadowMap.enabled = this.savedShadow;
    const s = this.scene;
    s.background = this.saved.bg;
    s.fog = this.saved.fog;
    s.environment = this.saved.env;
    const cam = this.camera;
    cam.fov = this.saved.fov;
    cam.near = this.saved.near;
    cam.far = this.saved.far;
    cam.position.copy(this.saved.pos);
    cam.quaternion.copy(this.saved.quat);
    cam.updateProjectionMatrix();
  }
}

/** blocks of city plan kept around the car: the skyline reads up to 11 blocks out, a plan dropped and read again costs a hitch */
const PLAN_KEEP = 12;
