import type { EngineConfig } from "../config";
import { dist, lerp } from "../math";
import type { DetectionResult, Fit, HandInfo, Lm, Person, PlayerFrame, Pt } from "../types";
import { BladeTracker, newBlade } from "./blades";
import { GestureEngine, emptyGestures, handInfo } from "./gestures";
import { LegCalibrator } from "./legCalibration";
import { OneEuro } from "./oneEuro";
import { leadMs, predict, velAlpha } from "./prediction";
import { buildPeople, colorHist, toStage, type SmallFrame } from "./people";
import { PlayerLock } from "./playerLock";

export const PLAYER_COLORS = ["#2fa8ff", "#ffc83d"] as const;
const LM_COUNT = 33;

const mkLms = (): Lm[] => Array.from({ length: LM_COUNT }, () => ({ x: 0, y: 0, v: 0 }));

export function newPlayerFrame(slot: number): PlayerFrame {
  return {
    slot,
    color: PLAYER_COLORS[slot] ?? "#ffffff",
    present: false,
    lostFor: 0,
    lm: mkLms(),
    raw: mkLms(),
    center: { x: 0, y: 0 },
    scale: 1,
    headR: 20,
    hands: { L: null, R: null },
    blades: [newBlade("L"), newBlade("R")],
    legs: { gas: 0, brake: 0, ok: false, rest: 0.6 },
    gestures: emptyGestures(),
    world: null,
    dominant: "R",
    lockMode: "none",
  };
}

interface Internal {
  filt: Lm[];
  fx: OneEuro[];
  fy: OneEuro[];
  vel: Float32Array; // px/s per landmark (x,y interleaved)
  tDet: number;
  hasDet: boolean;
  legs: LegCalibrator;
  gestures: GestureEngine;
  blades: BladeTracker;
}

/**
 * Turns detection results into per-player frames:
 *   people -> player lock -> One Euro filtered landmarks -> hands / blades / legs / gestures,
 * and extrapolates the landmarks between detections so rendering can run at 60 fps while the camera
 * is analysed at ~30 fps.
 */
export class Tracker {
  players: PlayerFrame[] = [];
  people: Person[] = [];
  others: Person[] = [];
  readonly lock: PlayerLock;
  fit: Fit = { ox: 0, oy: 0, dw: 1, dh: 1, W: 1, H: 1 };
  small: SmallFrame | null = null;
  leftHanded = false;
  /** engine time (ms) at which the most recent detection was processed */
  lastDetectionAt = 0;
  /** camera capture time (ms) of the most recent detection: the moment the landmarks describe */
  lastCaptureAt = 0;
  private internals: Internal[] = [];
  private lastProcess = 0;

  constructor(
    private cfg: EngineConfig,
    playerCount: 1 | 2,
  ) {
    this.lock = new PlayerLock(playerCount, cfg.lock);
    this.setPlayerCount(playerCount);
  }

  setPlayerCount(n: 1 | 2): void {
    this.players = [];
    this.internals = [];
    for (let i = 0; i < n; i++) {
      this.players.push(newPlayerFrame(i));
      this.internals.push({
        filt: mkLms(),
        fx: Array.from({ length: LM_COUNT }, () => new OneEuro(this.cfg.filter.minCutoff, this.cfg.filter.beta, this.cfg.filter.dCutoff)),
        fy: Array.from({ length: LM_COUNT }, () => new OneEuro(this.cfg.filter.minCutoff, this.cfg.filter.beta, this.cfg.filter.dCutoff)),
        vel: new Float32Array(LM_COUNT * 2),
        tDet: 0,
        hasDet: false,
        legs: new LegCalibrator(this.cfg.legs),
        gestures: new GestureEngine(this.cfg.gestures),
        blades: new BladeTracker(this.cfg.blade),
      });
    }
    this.lock.reset(n);
  }

  /** Forget everything about the players (used when re-scanning). */
  resetPlayers(): void {
    this.setPlayerCount(this.players.length as 1 | 2);
  }

  setFit(fit: Fit): void {
    this.fit = fit;
  }

  getHist = (p: Person): Float32Array | null => colorHist(p.norm, this.small);

  /** Darkness 0..1 of the camera picture: the player lock leans on position, blades accept lower visibility. */
  setDarkness(d: number): void {
    this.lock.setDarkness(d);
    for (const it of this.internals) it.blades.setDarkness(d);
  }

  /**
   * Process one detection result (detection rate, 30-60 Hz).
   * @param now engine time (ms) when the result is processed (player lock timing)
   * @param capture camera capture time (ms) of the analysed frame; filters, velocities and the prediction run on it
   */
  process(det: DetectionResult, now: number, capture: number = now): void {
    const cap = this.lastProcess ? Math.max(capture, this.lastCaptureAt + 1) : capture;
    const dt = this.lastProcess ? Math.min(0.2, Math.max(0.001, (cap - this.lastCaptureAt) / 1000)) : 1 / 30;
    this.lastProcess = now;
    this.lastDetectionAt = now;
    this.lastCaptureAt = cap;
    const fit = this.fit;
    this.people = buildPeople(det.pose, fit);
    const assigned = this.lock.update(this.people, now, this.getHist);
    const hands: HandInfo[] = [];
    if (det.hand?.landmarks) {
      const tmp: Lm = { x: 0, y: 0, v: 1 };
      for (const norm of det.hand.landmarks) {
        const pts: Pt[] = norm.map((p) => {
          toStage(p, fit, tmp);
          return { x: tmp.x, y: tmp.y };
        });
        hands.push(handInfo(pts));
      }
    }
    const used = new Set<number>();
    this.players.forEach((pf, i) => this.updatePlayer(pf, this.internals[i], assigned[i], hands, used, now, cap, dt));
    this.others = this.people.filter((p) => !assigned.includes(p));
  }

  private updatePlayer(pf: PlayerFrame, it: Internal, person: Person | null, hands: HandInfo[], used: Set<number>, now: number, cap: number, dt: number): void {
    const slot = this.lock.slots[pf.slot];
    pf.lockMode = slot.mode;
    pf.dominant = this.leftHanded ? "L" : "R";
    pf.hands.L = pf.hands.R = null;
    if (!person) {
      pf.lostFor = Math.max(0.001, (now - slot.lastSeen) / 1000);
      pf.present = false;
      pf.blades[0].active = pf.blades[1].active = false;
      // bridge very short dropouts of the hand points
      it.blades.update(pf.blades, pf.raw, pf.hands, false, cap, this.fit.H);
      return;
    }
    pf.present = true;
    pf.lostFor = 0;
    pf.center.x = person.center.x;
    pf.center.y = person.center.y;
    pf.scale = lerp(pf.scale || person.scale, person.scale, 0.3);
    pf.world = person.world;
    const H = this.fit.H;
    const dtDet = Math.max(0.001, (cap - it.tDet) / 1000);
    const va = velAlpha(dtDet, 30);
    for (let i = 0; i < LM_COUNT; i++) {
      const p = person.lm[i];
      const r = pf.raw[i];
      r.x = p.x;
      r.y = p.y;
      r.v = p.v;
      const f = it.filt[i];
      const nx = it.fx[i].filter(p.x / H, cap) * H;
      const ny = it.fy[i].filter(p.y / H, cap) * H;
      if (it.hasDet && cap - it.tDet < 200) {
        it.vel[i * 2] = lerp(it.vel[i * 2], (nx - f.x) / dtDet, va);
        it.vel[i * 2 + 1] = lerp(it.vel[i * 2 + 1], (ny - f.y) / dtDet, va);
      } else {
        it.vel[i * 2] = it.vel[i * 2 + 1] = 0;
      }
      f.x = nx;
      f.y = ny;
      f.v = p.v;
      const l = pf.lm[i];
      l.x = nx;
      l.y = ny;
      l.v = p.v;
    }
    it.tDet = cap;
    it.hasDet = true;
    pf.headR = Math.max(pf.scale * 0.42, dist(pf.lm[7], pf.lm[8]) * 0.75);
    // hands of the model belong to the nearest wrist of this player
    for (const side of ["L", "R"] as const) {
      const w = pf.raw[side === "L" ? 15 : 16];
      let bi = -1;
      let bd = pf.scale * 0.95;
      hands.forEach((h, hi) => {
        if (used.has(hi)) return;
        const d = dist(h.pts[0], w);
        if (d < bd) {
          bd = d;
          bi = hi;
        }
      });
      if (bi >= 0) {
        used.add(bi);
        pf.hands[side] = hands[bi];
      }
    }
    it.legs.update(pf.lm, pf.scale, dt, pf.legs);
    it.blades.update(pf.blades, pf.raw, pf.hands, true, cap, H);
    it.gestures.update(pf, dt, now, H);
  }

  /**
   * Render-rate update (every frame, also on the frame a detection was processed). The landmarks and blades are
   * moved along their velocity from the capture time of the last detection to `now` (+ the display lead), so what
   * is drawn matches where the hand is now, not where it was when the camera took the picture.
   * @param lead display latency to add (ms); default from the config, 0 for synthetic input
   */
  extrapolate(now: number, lead: number = this.cfg.extrapolation.leadMs): void {
    const { maxMs, gain } = this.cfg.extrapolation;
    this.players.forEach((pf, i) => {
      const it = this.internals[i];
      it.blades.extrapolate(pf.blades, now, maxMs, gain, lead);
      if (!pf.present) return;
      const dtMs = leadMs(now, it.tDet, lead, maxMs);
      if (dtMs <= 0) return;
      for (let k = 0; k < LM_COUNT; k++) {
        const f = it.filt[k];
        const l = pf.lm[k];
        l.x = predict(f.x, it.vel[k * 2], dtMs, gain);
        l.y = predict(f.y, it.vel[k * 2 + 1], dtMs, gain);
      }
    });
  }
}
