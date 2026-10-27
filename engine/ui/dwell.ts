import type { EngineConfig } from "../config";
import { clamp } from "../math";
import { OneEuro } from "../tracking/oneEuro";
import type { PlayerFrame } from "../types";
import { drawRingProgress } from "../fx/fx2d";

/**
 * Hand cursor + dwell-select ("hold your hand over a button to press it").
 * The raised hand of any present player is the pointer; elements marked with `data-dwell` are targets.
 * Progress is exposed to CSS as the custom property `--p` (0..1); `.hover` is added while hovered.
 */
export class DwellController {
  x = 0;
  y = 0;
  on = false;
  el: HTMLElement | null = null;
  private t0 = 0;
  private cool = 0;
  private sx: OneEuro;
  private sy: OneEuro;

  constructor(
    private cfg: EngineConfig["cursor"] & { filter?: never },
    cursorFilter: EngineConfig["cursorFilter"],
    private onSelect: () => void,
    private onHover: () => void,
  ) {
    this.sx = new OneEuro(cursorFilter.minCutoff, cursorFilter.beta, cursorFilter.dCutoff);
    this.sy = new OneEuro(cursorFilter.minCutoff, cursorFilter.beta, cursorFilter.dCutoff);
  }

  /** Update the cursor from the raised hand of the given players. */
  updateCursor(players: PlayerFrame[], now: number, W: number, H: number): void {
    this.on = false;
    let best: { x: number; y: number } | null = null;
    let owner: PlayerFrame | null = null;
    for (const pf of players) {
      if (!pf.present) continue;
      const L = pf.lm;
      for (const side of ["L", "R"] as const) {
        const hand = pf.hands[side];
        const ix = side === "L" ? 19 : 20;
        const wi = side === "L" ? 15 : 16;
        const p = hand ? hand.pts[8] : L[ix];
        const vis = hand ? 1 : L[ix].v > 0.4 ? 1 : L[wi].v > 0.4 ? 1 : 0;
        const limit = L[23].v > 0.4 ? L[23].y : L[11].y + pf.scale * 1.6;
        if (vis && p.y < limit && (!best || p.y < best.y)) {
          best = p;
          owner = pf;
        }
      }
    }
    if (!best || !owner) return;
    const c = owner.center;
    const gx = c.x + (best.x - c.x) * this.cfg.reach;
    const gy = c.y + (best.y - c.y) * this.cfg.reach - owner.scale * 0.2;
    this.x = clamp(this.sx.filter(gx / H, now) * H, 0, W);
    this.y = clamp(this.sy.filter(gy / H, now) * H, 0, H);
    this.on = true;
  }

  /** Hover / progress / click for the targets below `root`. */
  tick(now: number, root: HTMLElement | null): void {
    const els = root ? Array.from(root.querySelectorAll<HTMLElement>("[data-dwell]")) : [];
    let hit: HTMLElement | null = null;
    if (this.on) {
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width && this.x >= r.left && this.x <= r.right && this.y >= r.top && this.y <= r.bottom) {
          hit = el;
          break;
        }
      }
    }
    if (hit !== this.el) {
      if (this.el) {
        this.el.classList.remove("hover");
        this.el.style.setProperty("--p", "0");
      }
      this.el = hit;
      this.t0 = now;
      if (hit) {
        hit.classList.add("hover");
        this.onHover();
      }
    }
    if (hit && now > this.cool) {
      const k = clamp((now - this.t0) / this.cfg.dwellMs, 0, 1);
      hit.style.setProperty("--p", String(k));
      if (k >= 1) {
        this.cool = now + this.cfg.cooldownMs;
        this.t0 = now + this.cfg.cooldownMs;
        hit.style.setProperty("--p", "0");
        this.onSelect();
        hit.click();
      }
    }
  }

  /** Forget the hovered element (overlay changed). */
  release(): void {
    if (this.el) {
      this.el.classList.remove("hover");
      this.el.style.setProperty("--p", "0");
    }
    this.el = null;
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    if (!this.on) return;
    c.save();
    c.fillStyle = "rgba(255,255,255,.95)";
    c.strokeStyle = "rgba(0,0,0,.5)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(this.x, this.y, 11, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (this.el) drawRingProgress(c, this.x, this.y, 24, clamp((now - this.t0) / this.cfg.dwellMs, 0, 1), "#22d3ee");
    c.restore();
  }
}
