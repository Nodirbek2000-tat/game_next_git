import * as THREE from "three";
import { pick, TAU } from "@/engine/math";
import type { EngineApi, WorldPoint } from "@/engine/types";
import { buildKit, type FruitKit } from "./fruits";
import { BOMB_TIP_Y } from "./geometry";
import { Juice } from "./juice";
import { FRUIT_DEFS, NinjaLogic, type BladeLike, type Item, type NinjaEvents } from "./logic";
import { disposeObject, hasModels, loadGlb, loadManifest, type Manifest } from "./models";
import { getCaptureAt, getPeople, HandCollector } from "./party";
import { readMode, type NinjaMode } from "./mode";

const FRUIT_POOL = 5;
const BOMB_POOL = 5;
const POWER_POOL = 3;
const TRAIL_CAP = 20;
const TRAIL_MS = 170;

/** Fixed-size ring buffer of recent blade positions (no allocation while playing). */
class Trail {
  xs = new Float32Array(TRAIL_CAP);
  ys = new Float32Array(TRAIL_CAP);
  ts = new Float64Array(TRAIL_CAP);
  start = 0;
  n = 0;
  push(x: number, y: number, t: number): void {
    const i = (this.start + this.n) % TRAIL_CAP;
    this.xs[i] = x;
    this.ys[i] = y;
    this.ts[i] = t;
    if (this.n < TRAIL_CAP) this.n++;
    else this.start = (this.start + 1) % TRAIL_CAP;
    while (this.n > 0 && t - this.ts[this.start] > TRAIL_MS) {
      this.start = (this.start + 1) % TRAIL_CAP;
      this.n--;
    }
  }
  clear(): void {
    this.n = 0;
  }
}

interface FruitObj {
  group: THREE.Group;
  body: THREE.Mesh;
  acc: THREE.Mesh | null;
  model: THREE.Object3D | null;
}
interface HalfObj {
  outer: THREE.Group;
  inner: THREE.Group;
  hemi: THREE.Mesh;
  cap: THREE.Mesh;
  /** optional GLB halves per fruit def (index = def) */
  models: (THREE.Object3D | null)[];
}
interface BombObj {
  group: THREE.Group;
  body: THREE.Mesh;
  model: THREE.Object3D | null;
}

/** Debug / test handle: `window.__ninja` (read only snapshot, updated every frame). */
export interface NinjaDebug {
  mode: NinjaMode;
  partyLive: boolean;
  hands: number;
  peakHands: number;
  score: number;
  sliced: number;
  /** bit i set = hand track i has cut something */
  cutMask: number;
  drops: number;
  stains: number;
  models: number;
}

const tmp: WorldPoint = { x: 0, y: 0, z: 0 };
const GLOW_SIZE = 46;

/**
 * Everything imperative about Meva Ninja: pooled three.js objects, the rules (NinjaLogic), the juice and trail overlay.
 * Created once when the scene mounts, `dispose()`d when it unmounts. Nothing is allocated per frame.
 */
export class NinjaRig {
  readonly logic: NinjaLogic;
  readonly juice = new Juice(7);
  readonly mode: NinjaMode;
  readonly collector: HandCollector | null = null;
  private kit: FruitKit;
  private fruit: FruitObj[][] = [];
  /** every pooled fruit / bomb object (the lists above shrink while items are in flight) */
  private fruitAll: FruitObj[][] = [];
  private bombAll: BombObj[] = [];
  private bomb: BombObj[] = [];
  private freeze: THREE.Mesh[] = [];
  private frenzy: THREE.Mesh[] = [];
  private halves: HalfObj[] = [];
  private blades: BladeLike[] = [];
  private owners: number[] = [];
  private trails: Trail[] = [];
  private glowCol: string[] = [];
  private finished = false;
  private all: THREE.Object3D[] = [];
  private loaded: THREE.Object3D[] = [];
  private disposed = false;
  private comboText = "×0";
  private comboN = -1;
  private cutMask = 0;
  private showcase: { o: THREE.Object3D; x: number; y: number; r: number; spin: number }[] | null = null;
  private dbg: NinjaDebug;
  private lastSplash = 0;
  private splashN = 0;

  constructor(
    private engine: EngineApi,
    private group: THREE.Group,
  ) {
    const lvl = engine.quality.level;
    const detail = lvl === "high" ? 1 : lvl === "medium" ? 0.8 : 0.55;
    const halfPool = lvl === "high" ? 24 : lvl === "medium" ? 18 : 12;
    // React strict mode (dev) mounts, disposes and mounts again on the same group: dispose() hides it, so show it again
    group.visible = true;
    const kit = (this.kit = buildKit(detail));

    for (let d = 0; d < FRUIT_DEFS.length; d++) {
      const list: FruitObj[] = [];
      for (let k = 0; k < FRUIT_POOL; k++) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(kit.body[d], kit.skin[d]);
        g.add(body);
        let acc: THREE.Mesh | null = null;
        if (kit.acc[d]) {
          acc = new THREE.Mesh(kit.acc[d]!, kit.accMat);
          g.add(acc);
        }
        g.visible = false;
        this.add(g);
        const rec: FruitObj = { group: g, body, acc, model: null };
        g.userData.rec = rec;
        list.push(rec);
      }
      this.fruitAll.push(list.slice());
      this.fruit.push(list);
    }
    for (let k = 0; k < BOMB_POOL; k++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(kit.bombGeo, kit.bombMat);
      g.add(body);
      g.visible = false;
      this.add(g);
      const rec: BombObj = { group: g, body, model: null };
      g.userData.rec = rec;
      this.bomb.push(rec);
      this.bombAll.push(rec);
    }
    for (let k = 0; k < POWER_POOL; k++) {
      const a = new THREE.Mesh(kit.freezeGeo, kit.freezeMat);
      const c = new THREE.Mesh(kit.frenzyGeo, kit.frenzyMat);
      a.visible = c.visible = false;
      this.add(a, c);
      this.freeze.push(a);
      this.frenzy.push(c);
    }
    for (let k = 0; k < halfPool; k++) {
      const outer = new THREE.Group();
      const inner = new THREE.Group();
      const hemi = new THREE.Mesh(kit.half[0], kit.skin[0]);
      const cap = new THREE.Mesh(kit.cap[0], kit.capMat[0]);
      inner.add(hemi, cap);
      outer.add(inner);
      outer.visible = false;
      this.add(outer);
      this.halves.push({ outer, inner, hemi, cap, models: FRUIT_DEFS.map(() => null) });
    }

    // ---- who cuts: the locked players' hands, or (party mode) every hand in the room
    this.mode = readMode(engine.query);
    const people = this.mode === "xona" ? getPeople() : null;
    if (people) {
      const b = engine.config.blade;
      const e = engine.config.extrapolation;
      this.collector = new HandCollector({ minVis: b.minVis, velSmooth: b.velSmooth, dropoutMs: b.dropoutMs, extrapMs: e.maxMs, gain: e.gain, leadMs: e.leadMs, velTauMs: b.velTauMs });
      for (const t of this.collector.tracks) {
        this.blades.push(t);
        this.owners.push(0);
        this.glowCol.push(`hsl(${(t.id * 47 + 190) % 360} 95% 62%)`);
      }
    } else {
      const two = engine.players.length > 1;
      engine.players.forEach((p, i) => {
        this.blades.push(p.blades[0], p.blades[1]);
        this.owners.push(i, i);
        this.glowCol.push(two ? (i === 0 ? "rgb(70,160,255)" : "rgb(255,190,60)") : "rgb(90,220,255)", two ? (i === 0 ? "rgb(70,160,255)" : "rgb(255,190,60)") : "rgb(255,150,235)");
      });
    }
    this.trails = this.blades.map(() => new Trail());

    this.logic = new NinjaLogic(
      {
        w: engine.stage.w,
        h: engine.stage.h,
        kids: engine.kids,
        players: this.collector ? 1 : engine.players.length,
        minSpeed: engine.config.gestures.swipeSpeed,
        // ?duration=10 shortens the round (tests); the default is the prototype's 60 s
        duration: Math.min(60, Math.max(5, Number(engine.query.get("duration")) || 60)),
      },
      this.events(),
    );
    engine.hud.set({ time: this.logic.duration, combo: "×0", lives: null, score: 0, bar: 1 });
    this.hudPlayers();

    this.dbg = { mode: this.mode, partyLive: !!this.collector, hands: 0, peakHands: 0, score: 0, sliced: 0, cutMask: 0, drops: 0, stains: 0, models: 0 };
    (window as unknown as { __ninja?: NinjaDebug }).__ninja = this.dbg;

    if (engine.query.get("showcase") === "1") this.buildShowcase();
    void this.attachModels();
  }

  private add(...objs: THREE.Object3D[]): void {
    this.group.add(...objs);
    this.all.push(...objs);
  }

  private hudPlayers(): void {
    const { engine, logic } = this;
    if (engine.players.length < 2) return;
    if (this.collector) {
      engine.hud.setPlayer(0, { score: logic.total, label: "Xona" });
      engine.hud.setPlayer(1, { score: this.collector.active, label: "Qo‘llar" });
    } else logic.scores.forEach((s, i) => engine.hud.setPlayer(i, { score: s }));
  }

  // ------------------------------------------------------------------------------------------ events
  private events(): NinjaEvents {
    const { fx, audio } = this.engine;
    const juice = this.juice;
    return {
      score(_player, n, x, y, col, size) {
        fx.popup((n > 0 ? "+" : "") + n, x, y, n > 0 ? col : "#ff6b6b", size);
      },
      popup: (text, x, y, col, size, life) => fx.popup(text, x, y, col, size, life),
      bomb(x, y, rpx) {
        audio.boom(true);
        fx.shake(18, 0.45);
        fx.flash("255,255,255", 0.8);
        fx.burst(x, y, 80, () => pick(["#ffd54f", "#ff7043", "#fff"]), [4, 18], [2, 7], [0.4, 1]);
        fx.ring(x, y, rpx * 2, "255,180,80", 0.6, 10);
        fx.popup("BOMBA!", x, y - 70, "#ff5a6a", 46);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * TAU;
          const sp = 300 + (i % 5) * 160;
          juice.spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp);
        }
      },
      freeze(x, y) {
        audio.zap();
        fx.popup("❄️ MUZLATISH", x, y, "#9fe8ff", 38);
        fx.flash("150,220,255", 0.35);
        fx.burst(x, y, 40, "#bff4ff");
      },
      frenzy(x, y) {
        audio.combo(5);
        fx.popup("🔥 ×2 OCHKO!", x, y, "#ffd54f", 38);
        fx.burst(x, y, 40, "#ffe082");
      },
      slice: (x, y, col, crit, rpx, ang, blade) => {
        audio.slice();
        audio.splat();
        juice.splash(x, y, col, rpx, ang, crit);
        if (blade.id !== undefined && blade.id < 31) this.cutMask |= 1 << blade.id;
      },
      combo: (n) => audio.combo(n),
      spawnItem: (it) => {
        const o = this.acquire(it);
        it.obj = o;
        if (!o) return;
        o.visible = true;
        if (it.kind === "bomb") o.rotation.set(0, Math.random() * TAU, 0);
        else o.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
      },
      spawnHalf: (h, src) => {
        const idx = this.halves.findIndex((g) => !g.outer.visible);
        if (idx < 0) {
          h.active = false;
          return;
        }
        const hf = this.halves[idx];
        const kit = this.kit;
        const model = hf.models[h.def];
        hf.hemi.geometry = kit.half[h.def];
        hf.hemi.material = kit.skin[h.def];
        hf.cap.geometry = kit.cap[h.def];
        hf.cap.material = kit.capMat[h.def];
        hf.hemi.visible = hf.cap.visible = !model;
        for (const m of hf.models) if (m) m.visible = m === model;
        // the second half is the mirror image of the first (cut face looks the other way)
        hf.inner.scale.set(1, h.side, 1);
        const so = src.obj as THREE.Object3D | null;
        if (so) hf.outer.rotation.copy(so.rotation);
        hf.outer.rotation.z = -h.ang;
        hf.outer.visible = true;
        h.obj = hf;
      },
    };
  }

  private acquire(it: Item): THREE.Object3D | null {
    if (it.kind === "bomb") return this.bomb.pop()?.group ?? null;
    if (it.kind === "freeze") return this.freeze.pop() ?? null;
    if (it.kind === "frenzy") return this.frenzy.pop() ?? null;
    return this.fruit[it.def].pop()?.group ?? null;
  }

  private release(it: Item, o: THREE.Object3D): void {
    o.visible = false;
    if (it.kind === "bomb") this.bomb.push(o.userData.rec as BombObj);
    else if (it.kind === "freeze") this.freeze.push(o as THREE.Mesh);
    else if (it.kind === "frenzy") this.frenzy.push(o as THREE.Mesh);
    else this.fruit[it.def].push(o.userData.rec as FruitObj);
    it.obj = null;
  }

  // ------------------------------------------------------------------------------------------ frame
  /** Per game frame (only while playing). */
  frame(dt: number, now: number): void {
    const { engine, logic, juice } = this;
    if (this.showcase) {
      this.frameShowcase(dt, now);
      return;
    }
    logic.w = engine.stage.w;
    logic.h = engine.stage.h;
    juice.scale = engine.quality.particles;
    if (!engine.audio.musicOn && !logic.over) engine.audio.musicStart(118, "drive");
    if (this.collector) this.collector.update(getPeople(), now, engine.stage.h, getCaptureAt());
    logic.update(dt, this.blades, this.owners, now);

    const ppw = engine.pxToWorld(0);
    const pdt = dt * (logic.freezeT > 0 ? 0.35 : 1);
    const items = logic.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const o = it.obj as THREE.Object3D | null;
      if (it.active) {
        if (!o) continue;
        engine.screenToWorld(it.x, it.y, 0, tmp);
        o.position.set(tmp.x, tmp.y, 0);
        if (it.kind === "bomb") {
          o.scale.setScalar(it.rpx * ppw);
          o.rotation.z = 0.34 * Math.sin(now / 240 + it.rv0 * 3);
          o.rotation.y += 0.7 * pdt;
          // fuse sparks fly off the (projected) tip
          if (juice.chance(dt * 28)) {
            const a = o.rotation.z;
            juice.fuseSpark(it.x - Math.sin(a) * BOMB_TIP_Y * it.rpx, it.y - Math.cos(a) * BOMB_TIP_Y * it.rpx);
          }
        } else if (it.kind === "fruit") {
          o.scale.setScalar(it.rpx * ppw);
          o.rotation.x += it.rv0 * pdt;
          o.rotation.y += it.rv1 * pdt;
        } else {
          o.scale.setScalar(it.rpx * ppw * (1 + 0.06 * Math.sin(now / 160 + it.rv0)));
          o.rotation.x += it.rv0 * 0.5 * pdt;
          o.rotation.y += it.rv1 * 0.5 * pdt;
        }
      } else if (o) this.release(it, o);
    }
    const halves = logic.halves;
    for (let i = 0; i < halves.length; i++) {
      const h = halves[i];
      const rec = h.obj as HalfObj | null;
      if (!rec) continue;
      const o = rec.outer;
      if (h.active) {
        engine.screenToWorld(h.x, h.y, 0, tmp);
        o.position.set(tmp.x, tmp.y, 0);
        o.scale.setScalar(h.rpx * ppw);
        o.rotateX(h.spin * pdt);
        o.rotation.z += h.rz * pdt;
        // the cut face keeps dripping for a moment
        if (h.life > 1.25 && juice.chance(dt * 12)) juice.drip(h.x, h.y, FRUIT_DEFS[h.def].juice);
      } else {
        o.visible = false;
        h.obj = null;
      }
    }
    juice.update(dt);

    const two = engine.players.length > 1;
    if (logic.maxCombo !== this.comboN) {
      this.comboN = logic.maxCombo;
      this.comboText = `×${logic.maxCombo}`;
    }
    engine.hud.set({
      time: Math.max(0, Math.ceil(logic.duration - logic.time)),
      bar: 1 - logic.time / logic.duration,
      score: logic.total,
      combo: logic.freezeT > 0 ? "❄️ muz" : logic.frenzyT > 0 ? "🔥 ×2" : this.comboText,
    });
    if (two) this.hudPlayers();
    const d = this.dbg;
    d.hands = this.collector ? this.collector.active : 0;
    d.peakHands = this.collector ? this.collector.peak : 0;
    d.score = logic.total;
    d.sliced = logic.sliced;
    d.cutMask = this.cutMask;
    d.drops = juice.n;
    d.stains = juice.stains;

    if (logic.over && !this.finished) {
      this.finished = true;
      engine.audio.musicStop();
      const lines: [string, string | number][] = [
        ["Kesilgan mevalar", logic.sliced],
        ["Eng katta kombo", logic.maxCombo],
        ["Bombalar", logic.bombs],
        ["Aniqlik", `${logic.accuracy}%`],
      ];
      if (this.collector) lines.push(["Qo‘llar (eng ko‘pi)", this.collector.peak]);
      engine.finish({
        score: logic.total,
        players: two && !this.collector ? logic.scores.map((s, i) => ({ score: s, label: `${i + 1}-o‘yinchi` })) : undefined,
        lines,
        stats: { sliced: logic.sliced, maxCombo: logic.maxCombo, bombs: logic.bombs, mode: this.mode, ...(this.collector ? { hands: this.collector.peak } : {}) },
      });
    }
  }

  // ------------------------------------------------------------------------------------------ 2D overlay
  /** 2D overlay: blade trails, juice, freeze tint. */
  draw(c: CanvasRenderingContext2D, e: EngineApi, now: number): void {
    const many = this.blades.length > 4;
    const minSpeed = this.logic.minSpeed;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    for (let i = 0; i < this.blades.length; i++) {
      const b = this.blades[i];
      const tr = this.trails[i];
      // the head is the engine's predicted hand position of THIS frame (capture time + velocity, see tracker.extrapolate):
      // no smoothing on top, so the blade is on the hand, not behind it
      if (b.active) tr.push(b.x, b.y, now);
      else tr.clear();
      if (tr.n < 2) continue;
      // fast enough to cut: a wide bright blade; slower: a thin hint
      const hot = b.speed >= minSpeed;
      const w = hot ? 1 : 0.45;
      const gc = this.glowCol[i];
      for (let pass = many ? 1 : 0; pass < 2; pass++) {
        c.strokeStyle = pass === 0 ? gc : "#ffffff";
        for (let j = 1; j < tr.n; j++) {
          const a = (tr.start + j - 1) % TRAIL_CAP;
          const z = (tr.start + j) % TRAIL_CAP;
          const k = j / tr.n;
          if (pass === 0) {
            c.globalAlpha = k * 0.42 * (hot ? 1 : 0.6);
            c.lineWidth = (8 + 26 * k) * w;
          } else {
            c.globalAlpha = k * (hot ? 0.95 : 0.55);
            c.lineWidth = (1.5 + 7 * k) * w;
          }
          c.beginPath();
          c.moveTo(tr.xs[a], tr.ys[a]);
          c.lineTo(tr.xs[z], tr.ys[z]);
          c.stroke();
        }
      }
      if (b.active) {
        c.globalAlpha = hot ? 0.95 : 0.55;
        c.drawImage(this.kit.glow, b.x - GLOW_SIZE / 2, b.y - GLOW_SIZE / 2, GLOW_SIZE, GLOW_SIZE);
      }
    }
    // burning fuse: a flickering glow at the projected tip of every bomb
    const items = this.logic.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.active || it.kind !== "bomb" || !it.obj) continue;
      const a = (it.obj as THREE.Object3D).rotation.z;
      const size = 44 + 16 * Math.sin(now / 38 + it.rv1 * 9) + 6 * Math.sin(now / 17);
      c.globalAlpha = 0.95;
      c.drawImage(this.kit.glow, it.x - Math.sin(a) * BOMB_TIP_Y * it.rpx - size / 2, it.y - Math.cos(a) * BOMB_TIP_Y * it.rpx - size / 2, size, size);
    }
    if (this.showcase) {
      for (const sc of this.showcase) {
        if (!sc.o.userData.rec || "acc" in (sc.o.userData.rec as object)) continue;
        const a = sc.o.rotation.z;
        const size = 44 + 16 * Math.sin(now / 38);
        c.globalAlpha = 0.95;
        c.drawImage(this.kit.glow, sc.x * e.stage.w - Math.sin(a) * BOMB_TIP_Y * sc.r * e.stage.h - size / 2, sc.y * e.stage.h - Math.cos(a) * BOMB_TIP_Y * sc.r * e.stage.h - size / 2, size, size);
      }
    }
    c.restore();
    this.juice.draw(c);
    if (this.logic.freezeT > 0) {
      c.save();
      c.fillStyle = `rgba(140,210,255,${0.12 + Math.sin(now / 200) * 0.03})`;
      c.fillRect(0, 0, e.stage.w, e.stage.h);
      c.restore();
    }
  }

  // ------------------------------------------------------------------------------------------ optional GLB models
  private async attachModels(): Promise<void> {
    let manifest: Manifest;
    try {
      manifest = await loadManifest(this.engine.query);
    } catch {
      return;
    }
    if (this.disposed || !hasModels(manifest)) return;
    const jobs: Promise<void>[] = [];
    FRUIT_DEFS.forEach((d, def) => {
      const m = manifest.fruits[d.id];
      if (!m) return;
      if (m.whole) {
        jobs.push(
          loadGlb(m.whole, m.scale).then((root) => {
            if (!root || this.disposed) return;
            this.loaded.push(root);
            for (const f of this.fruitAll[def]) {
              const clone = root.clone(true);
              f.body.visible = false;
              if (f.acc) f.acc.visible = false;
              f.group.add(clone);
              f.model = clone;
            }
            this.dbg.models++;
          }),
        );
      }
      if (m.half) {
        jobs.push(
          loadGlb(m.half, m.scale).then((root) => {
            if (!root || this.disposed) return;
            this.loaded.push(root);
            for (const h of this.halves) {
              const clone = root.clone(true);
              clone.visible = false;
              h.inner.add(clone);
              h.models[def] = clone;
            }
            this.dbg.models++;
          }),
        );
      }
    });
    if (manifest.bomb.whole) {
      jobs.push(
        loadGlb(manifest.bomb.whole, manifest.bomb.scale).then((root) => {
          if (!root || this.disposed) return;
          this.loaded.push(root);
          for (const b of this.bombAll) {
            const clone = root.clone(true);
            b.body.visible = false;
            b.group.add(clone);
            b.model = clone;
          }
          this.dbg.models++;
        }),
      );
    }
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------------------------------------ showcase (?showcase=1)
  /** Static display of every object for visual checks: fruits, cut halves, bomb and power-ups. */
  private buildShowcase(): void {
    const list: { o: THREE.Object3D; x: number; y: number; r: number; spin: number }[] = [];
    this.showcase = list;
    const n = FRUIT_DEFS.length;
    FRUIT_DEFS.forEach((d, def) => {
      const f = this.fruit[def].pop();
      if (f) {
        f.group.visible = true;
        list.push({ o: f.group, x: (def + 0.5) / n, y: 0.2, r: 0.058 * d.r * 1.25, spin: 0.35 });
      }
      for (const s of [1, -1] as const) {
        const hf = this.halves.find((h) => !h.outer.visible);
        if (!hf) break;
        hf.hemi.geometry = this.kit.half[def];
        hf.hemi.material = this.kit.skin[def];
        hf.cap.geometry = this.kit.cap[def];
        hf.cap.material = this.kit.capMat[def];
        hf.inner.scale.set(1, s, 1);
        hf.outer.visible = true;
        list.push({ o: hf.outer, x: (def + 0.5) / n + s * 0.012, y: 0.5 + s * 0.0, r: 0.058 * d.r * 1.15, spin: s === 1 ? -1.25 : -1.45 });
      }
    });
    const b = this.bomb.pop();
    if (b) {
      b.group.visible = true;
      list.push({ o: b.group, x: 0.25, y: 0.8, r: 0.07, spin: 0 });
    }
    const a = this.freeze.pop();
    if (a) {
      a.visible = true;
      list.push({ o: a, x: 0.5, y: 0.8, r: 0.06, spin: 0.2 });
    }
    const c = this.frenzy.pop();
    if (c) {
      c.visible = true;
      list.push({ o: c, x: 0.75, y: 0.8, r: 0.06, spin: 0.2 });
    }
  }

  private frameShowcase(dt: number, now: number): void {
    const { engine } = this;
    const ppw = engine.pxToWorld(0);
    const { w, h } = engine.stage;
    for (const s of this.showcase!) {
      engine.screenToWorld(s.x * w, s.y * h, 0, tmp);
      s.o.position.set(tmp.x, tmp.y, 0);
      s.o.scale.setScalar(s.r * h * ppw);
      if (s.o.userData.rec && !("acc" in (s.o.userData.rec as object))) {
        s.o.rotation.z = 0.25 * Math.sin(now / 400);
      } else if (s.spin < -1) {
        s.o.rotation.set(s.spin, 0, 0.4);
      } else {
        s.o.rotation.y += s.spin * dt;
        s.o.rotation.x = 0.35;
      }
    }
    this.juice.scale = engine.quality.particles;
    // showcase: keep splashing so the juice can be checked by eye
    if (now - this.lastSplash > 1500) {
      this.lastSplash = now;
      const d = FRUIT_DEFS[this.splashN++ % FRUIT_DEFS.length];
      this.juice.splash(w * 0.5, h * 0.64, d.juice, 0.058 * h * d.r, -0.6, this.splashN % 3 === 0);
      this.juice.splash(w * 0.62, h * 0.66, d.juice, 0.058 * h * d.r, 0.5, false);
    }
    this.juice.update(dt);
    this.dbg.drops = this.juice.n;
    this.dbg.stains = this.juice.stains;
  }

  dispose(): void {
    this.disposed = true;
    this.engine.audio.musicStop();
    // the scene graph may be rendered once more before React detaches it: make sure nothing re-uploads a disposed texture
    this.group.visible = false;
    for (const o of this.all) o.visible = false;
    this.kit.dispose();
    for (const m of this.loaded) disposeObject(m);
    this.group.remove(...this.all);
    this.juice.clear();
    const w = window as unknown as { __ninja?: NinjaDebug };
    if (w.__ninja === this.dbg) delete w.__ninja;
  }
}
