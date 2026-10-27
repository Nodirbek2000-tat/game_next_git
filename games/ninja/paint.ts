import { TAU } from "@/engine/math";
import type { FruitId } from "./geometry";

// Procedural peel / flesh textures (canvas). Seeded, so every run looks the same. Only used at mount time.

export interface Painted {
  skin: HTMLCanvasElement;
  skinBump: HTMLCanvasElement;
  cap: HTMLCanvasElement;
  capBump: HTMLCanvasElement;
}

type Rnd = () => number;
type Ctx = CanvasRenderingContext2D;

export function seeded(seed: number): Rnd {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Value noise, tileable horizontally with period `px` lattice cells. */
function vnoise(x: number, y: number, px: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const xa = mod(x0, px);
  const xb = mod(x0 + 1, px);
  const a = hash(xa, y0, seed);
  const b = hash(xb, y0, seed);
  const c = hash(xa, y0 + 1, seed);
  const d = hash(xb, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u: number, v: number, freq: number, oct: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let f = freq;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * f, v * f * 0.5, f, seed + o * 17);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

function mk(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as Ctx;
  return { c, g };
}

/** Per-pixel colour field. fn writes r,g,b (0..255) into out. */
function shade(g: Ctx, w: number, h: number, fn: (u: number, v: number, out: Float32Array) => void): void {
  const img = g.createImageData(w, h);
  const d = img.data;
  const o = new Float32Array(3);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      fn(x / w, v, o);
      const k = (y * w + x) * 4;
      d[k] = o[0];
      d[k + 1] = o[1];
      d[k + 2] = o[2];
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixc(out: Float32Array, a: [number, number, number], b: [number, number, number], t: number): void {
  out[0] = mix(a[0], b[0], t);
  out[1] = mix(a[1], b[1], t);
  out[2] = mix(a[2], b[2], t);
}

/** Draw `fn` at x and at the wrapped copies so features never get cut at the texture seam. */
function wrapX(w: number, x: number, r: number, fn: (x: number) => void): void {
  fn(x);
  if (x < r) fn(x + w);
  if (x > w - r) fn(x - w);
}

function dots(g: Ctx, w: number, h: number, R: Rnd, n: number, r0: number, r1: number, fill: string, y0 = 0, y1 = 1): void {
  g.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const y = (y0 + R() * (y1 - y0)) * h;
    const r = r0 + R() * (r1 - r0);
    wrapX(w, x, r, (xx) => {
      g.beginPath();
      g.arc(xx, y, r, 0, TAU);
      g.fill();
    });
  }
}

function flat(g: Ctx, w: number, h: number, gray: number): void {
  g.fillStyle = `rgb(${gray},${gray},${gray})`;
  g.fillRect(0, 0, w, h);
}

// ------------------------------------------------------------------------------------------------------------------
// SKINS (canvas x = around the fruit, y = from the stem end (top) to the blossom end)
// ------------------------------------------------------------------------------------------------------------------
function skinTarvuz(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const light = hex("#a6e08f");
  const mid = hex("#58b663");
  const dark = hex("#1f7a3a");
  shade(s.g, w, h, (u, v, o) => {
    const warp = (fbm(u, v, 6, 3, 3) - 0.5) * 0.12 + Math.sin(v * TAU * 2 + u * 9) * 0.012;
    const st = Math.sin((u + warp) * TAU * 9);
    const t = sstep(-0.35, 0.45, st);
    mixc(o, dark, mid, t);
    const lt = sstep(0.55, 1, st) * 0.5 + (fbm(u, v, 24, 2, 9) - 0.5) * 0.3;
    mixc(o, [o[0], o[1], o[2]], light, Math.max(0, lt));
    const m = 0.92 + 0.16 * fbm(u, v, 40, 2, 5);
    o[0] *= m;
    o[1] *= m;
    o[2] *= m;
  });
  dots(s.g, w, h, R, 220, 0.6, 1.5, "rgba(190,235,160,.16)");
  flat(b.g, w, h, 128);
  shade(b.g, w, h, (u, v, o) => {
    const n = fbm(u, v, 30, 3, 21);
    o[0] = o[1] = o[2] = 112 + n * 40;
  });
}

function skinApelsin(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const a = hex("#ff8c12");
  const c = hex("#ffb02e");
  shade(s.g, w, h, (u, v, o) => {
    const n = fbm(u, v, 8, 3, 4);
    mixc(o, a, c, sstep(0.3, 0.75, n) * 0.8);
    const sh = 0.95 + 0.1 * fbm(u, v, 50, 2, 8);
    o[0] *= sh;
    o[1] *= sh;
    o[2] *= sh;
  });
  dots(s.g, w, h, R, 2600, 0.6, 1.5, "rgba(214,98,0,.42)");
  dots(s.g, w, h, R, 900, 0.4, 1.1, "rgba(255,222,150,.35)");
  // green tint at the stem end
  const gr = s.g.createLinearGradient(0, 0, 0, h * 0.12);
  gr.addColorStop(0, "rgba(90,160,40,.55)");
  gr.addColorStop(1, "rgba(90,160,40,0)");
  s.g.fillStyle = gr;
  s.g.fillRect(0, 0, w, h * 0.12);
  flat(b.g, w, h, 150);
  b.g.fillStyle = "rgb(60,60,60)";
  for (let i = 0; i < 3200; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = 0.7 + R() * 1.1;
    wrapX(w, x, r, (xx) => {
      b.g.beginPath();
      b.g.arc(xx, y, r, 0, TAU);
      b.g.fill();
    });
  }
}

function skinOlma(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const red = hex("#d1162b");
  const deep = hex("#7a0714");
  const gold = hex("#e8c93a");
  shade(s.g, w, h, (u, v, o) => {
    const streak = fbm(u * 1, v * 0.18, 26, 2, 12);
    const depth = sstep(0.2, 0.8, streak);
    mixc(o, red, deep, depth * 0.85);
    // sun side blush towards yellow-green
    const side = 0.5 + 0.5 * Math.cos((u - 0.12) * TAU);
    const blush = sstep(0.55, 1, side) * (0.35 + 0.65 * (1 - depth)) * (0.4 + 0.6 * sstep(0.0, 0.5, fbm(u, v, 5, 2, 31)));
    mixc(o, [o[0], o[1], o[2]], gold, blush * 0.9);
    const poles = Math.max(sstep(0.0, 0.14, 0.14 - v), 0);
    mixc(o, [o[0], o[1], o[2]], deep, poles * 0.5);
  });
  dots(s.g, w, h, R, 520, 0.5, 1.2, "rgba(255,236,170,.55)", 0.1, 0.9);
  flat(b.g, w, h, 128);
  shade(b.g, w, h, (u, v, o) => {
    o[0] = o[1] = o[2] = 120 + fbm(u, v, 16, 2, 2) * 24;
  });
}

function skinBanan(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const yel = hex("#f6d322");
  const yel2 = hex("#e2b812");
  const green = hex("#9ab32a");
  const brown = hex("#3a2610");
  shade(s.g, w, h, (u, v, o) => {
    const n = fbm(u, v, 6, 3, 15);
    mixc(o, yel, yel2, sstep(0.3, 0.8, n));
    // ridges: five darker edges
    const ridge = Math.pow(Math.abs(Math.cos(u * TAU * 2.5)), 24);
    mixc(o, [o[0], o[1], o[2]], [150, 140, 20], ridge * 0.55);
    // green towards the stalk (bottom of the texture = t -> 1) and the tip stays brown
    mixc(o, [o[0], o[1], o[2]], green, sstep(0.72, 0.97, v) * 0.85);
    mixc(o, [o[0], o[1], o[2]], brown, sstep(0.065, 0.0, v));
  });
  s.g.fillStyle = "rgba(96,62,16,.6)";
  for (let i = 0; i < 160; i++) {
    const x = R() * w;
    const y = (0.1 + R() * 0.8) * h;
    const rx = 0.7 + R() * 2;
    const ry = rx * (1.2 + R() * 2.5);
    wrapX(w, x, rx * 2, (xx) => {
      s.g.beginPath();
      s.g.ellipse(xx, y, rx, ry, 0, 0, TAU);
      s.g.fill();
    });
  }
  shade(b.g, w, h, (u, v, o) => {
    const ridge = Math.pow(Math.abs(Math.cos(u * TAU * 2.5)), 6);
    o[0] = o[1] = o[2] = 110 + 40 * (1 - ridge) + fbm(u, v, 22, 2, 6) * 20;
  });
}

function skinAnanas(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number): void {
  const cols = 18;
  const rows = 12;
  s.g.fillStyle = "#6d3f12";
  s.g.fillRect(0, 0, w, h);
  flat(b.g, w, h, 40);
  const cw = w / cols;
  const ch = h / rows;
  for (let j = -1; j <= rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = (i + ((j & 1) ? 0.5 : 0)) * cw + cw * 0.0;
      const cy = (j + 0.5) * ch;
      const v = cy / h;
      const green = sstep(0.18, 0.0, v) * 0.7;
      const base = v < 0.5 ? "#e6a523" : "#d9951c";
      for (const dx of [0, -w, w]) {
        const x = cx + dx;
        if (x < -cw || x > w + cw) continue;
        const gr = s.g.createRadialGradient(x, cy - ch * 0.1, 1, x, cy, cw * 0.62);
        gr.addColorStop(0, `rgba(255,222,110,1)`);
        gr.addColorStop(0.55, base);
        gr.addColorStop(1, "#b36a12");
        s.g.fillStyle = gr;
        s.g.beginPath();
        s.g.moveTo(x, cy - ch * 0.62);
        s.g.lineTo(x + cw * 0.5, cy);
        s.g.lineTo(x, cy + ch * 0.62);
        s.g.lineTo(x - cw * 0.5, cy);
        s.g.closePath();
        s.g.fill();
        if (green > 0.02) {
          s.g.fillStyle = `rgba(100,140,40,${green})`;
          s.g.fill();
        }
        s.g.strokeStyle = "rgba(70,38,8,.85)";
        s.g.lineWidth = Math.max(1.2, w / 260);
        s.g.stroke();
        // the dark "eye" with the little spikes
        s.g.fillStyle = "rgba(80,40,6,.75)";
        s.g.beginPath();
        s.g.ellipse(x, cy + ch * 0.04, cw * 0.07, ch * 0.11, 0, 0, TAU);
        s.g.fill();
        // dome in the bump map
        const bg = b.g.createRadialGradient(x, cy, 0, x, cy, cw * 0.55);
        bg.addColorStop(0, "rgb(235,235,235)");
        bg.addColorStop(0.7, "rgb(150,150,150)");
        bg.addColorStop(1, "rgb(30,30,30)");
        b.g.fillStyle = bg;
        b.g.beginPath();
        b.g.moveTo(x, cy - ch * 0.62);
        b.g.lineTo(x + cw * 0.5, cy);
        b.g.lineTo(x, cy + ch * 0.62);
        b.g.lineTo(x - cw * 0.5, cy);
        b.g.closePath();
        b.g.fill();
      }
    }
  }
}

function skinKivi(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const a = hex("#8a6a3a");
  const c = hex("#6a4b24");
  shade(s.g, w, h, (u, v, o) => {
    mixc(o, a, c, sstep(0.3, 0.8, fbm(u, v, 10, 3, 41)));
  });
  flat(b.g, w, h, 120);
  const hairs = Math.round((w * h) / 24);
  for (let i = 0; i < hairs; i++) {
    const x = R() * w;
    const y = R() * h;
    const len = 3 + R() * 6;
    const an = -Math.PI / 2 + (R() - 0.5) * 1.6;
    const dx = Math.cos(an) * len;
    const dy = Math.sin(an) * len;
    s.g.strokeStyle = R() < 0.5 ? "rgba(48,30,12,.4)" : "rgba(196,158,98,.35)";
    s.g.lineWidth = 0.8;
    s.g.beginPath();
    s.g.moveTo(x, y);
    s.g.lineTo(x + dx, y + dy);
    s.g.stroke();
    b.g.strokeStyle = R() < 0.5 ? "rgba(220,220,220,.5)" : "rgba(40,40,40,.5)";
    b.g.lineWidth = 0.9;
    b.g.beginPath();
    b.g.moveTo(x, y);
    b.g.lineTo(x + dx, y + dy);
    b.g.stroke();
  }
}

function skinAnor(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const red = hex("#b3113a");
  const deep = hex("#6e0a24");
  const orange = hex("#f0702e");
  shade(s.g, w, h, (u, v, o) => {
    const n = fbm(u, v, 7, 3, 51);
    mixc(o, deep, red, sstep(0.25, 0.7, n));
    const blush = sstep(0.55, 0.95, 0.5 + 0.5 * Math.cos((u - 0.3) * TAU)) * sstep(0.1, 0.5, 1 - Math.abs(v - 0.42) * 2.2);
    mixc(o, [o[0], o[1], o[2]], orange, blush * 0.6);
    const fine = 0.9 + 0.2 * fbm(u, v, 60, 2, 61);
    o[0] *= fine;
    o[1] *= fine;
    o[2] *= fine;
  });
  dots(s.g, w, h, R, 260, 0.8, 2.4, "rgba(60,5,18,.28)");
  dots(s.g, w, h, R, 160, 0.6, 1.6, "rgba(255,170,130,.18)");
  shade(b.g, w, h, (u, v, o) => {
    o[0] = o[1] = o[2] = 96 + fbm(u, v, 34, 4, 71) * 90;
  });
}

function skinQovun(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, w: number, h: number, R: Rnd): void {
  const cream = hex("#eadd9c");
  const green = hex("#bcc673");
  shade(s.g, w, h, (u, v, o) => {
    const rib = Math.pow(Math.abs(Math.cos(u * TAU * 5)), 10);
    mixc(o, cream, green, rib * 0.6 + sstep(0.4, 0.9, fbm(u, v, 5, 3, 81)) * 0.35);
  });
  flat(b.g, w, h, 100);
  // reticulate netting: two families of meandering lines
  const lines = Math.round((w * h) / 150);
  for (let i = 0; i < lines; i++) {
    const x0 = R() * w;
    const y0 = R() * h;
    const fam = R() < 0.5 ? 1 : -1;
    const an = fam * (0.5 + (R() - 0.5) * 0.7);
    const len = 18 + R() * 40;
    const steps = 5;
    const sx = len / steps;
    for (const [ctx, col, lw] of [
      [s.g, "rgba(236,226,186,.7)", 1.1],
      [b.g, "rgba(255,255,255,.85)", 1.5],
    ] as [Ctx, string, number][]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      let x = x0;
      let y = y0;
      let a2 = an;
      ctx.moveTo(x, y);
      const rr = seeded(i * 7919 + 13);
      for (let k = 0; k < steps; k++) {
        a2 += (rr() - 0.5) * 0.6;
        x += Math.cos(a2) * sx;
        y += Math.sin(a2) * sx;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (x0 < 80) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  dots(s.g, w, h, R, 120, 0.8, 2.2, "rgba(150,140,70,.2)");
}

// ------------------------------------------------------------------------------------------------------------------
// CUT FACES (square canvas, a disc inscribed)
// ------------------------------------------------------------------------------------------------------------------
function disc(g: Ctx, c: number, r: number, fill: string | CanvasGradient): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, r, 0, TAU);
  g.fill();
}
function radial(g: Ctx, c: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  return gr;
}
function fibres(g: Ctx, c: number, R: Rnd, n: number, r0: number, r1: number, col: string, lw = 1): void {
  g.strokeStyle = col;
  g.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    const a = R() * TAU;
    const a0 = r0 * c * (0.8 + R() * 0.4);
    const a1 = r1 * c * (0.85 + R() * 0.3);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * a0, c + Math.sin(a) * a0);
    g.lineTo(c + Math.cos(a + (R() - 0.5) * 0.05) * a1, c + Math.sin(a + (R() - 0.5) * 0.05) * a1);
    g.stroke();
  }
}
function seed(g: Ctx, x: number, y: number, rx: number, ry: number, rot: number, col: string, hi = true): void {
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
  if (hi) {
    g.fillStyle = "rgba(255,255,255,.35)";
    g.beginPath();
    g.ellipse(x - rx * 0.25, y - ry * 0.3, rx * 0.3, ry * 0.3, rot, 0, TAU);
    g.fill();
  }
}

function capTarvuz(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#1d6a2d");
  disc(s.g, c, c * 0.95, "#79c474");
  disc(s.g, c, c * 0.9, "#f1f8d8");
  disc(s.g, c, c * 0.86, radial(s.g, c, [[0, "#ff2a4a"], [0.55, "#ff4259"], [0.85, "#ff8a96"], [1, "#ffd0d0"]]));
  fibres(s.g, c, R, 260, 0.1, 0.84, "rgba(190,10,40,.16)", 1.2);
  fibres(s.g, c, R, 120, 0.2, 0.8, "rgba(255,200,205,.2)", 1);
  for (const [cnt, rr] of [[8, 0.3], [12, 0.52], [15, 0.7]] as [number, number][]) {
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * TAU + rr * 3 + (R() - 0.5) * 0.2;
      const x = c + Math.cos(a) * rr * c;
      const y = c + Math.sin(a) * rr * c;
      seed(s.g, x, y, c * 0.022, c * 0.055, a + Math.PI / 2, "#17110f");
    }
  }
  flat(b.g, n, n, 128);
  fibres(b.g, c, R, 160, 0.1, 0.84, "rgba(255,255,255,.18)", 1.5);
}

function capApelsin(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#ff8c14");
  disc(s.g, c, c * 0.94, "#fff1d4");
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU + 0.05;
    const a1 = ((i + 1) / segs) * TAU - 0.05;
    s.g.fillStyle = radial(s.g, c, [[0, "#ffc060"], [0.7, "#ffa326"], [1, "#ff9410"]]);
    s.g.beginPath();
    s.g.moveTo(c + Math.cos((a0 + a1) / 2) * c * 0.07, c + Math.sin((a0 + a1) / 2) * c * 0.07);
    s.g.arc(c, c, c * 0.88, a0, a1);
    s.g.closePath();
    s.g.fill();
    // juice vesicles: short bright strokes along the wedge
    const mid = (a0 + a1) / 2;
    for (let k = 0; k < 46; k++) {
      const a = a0 + (a1 - a0) * (0.1 + R() * 0.8);
      const r0 = c * (0.12 + R() * 0.65);
      s.g.strokeStyle = R() < 0.5 ? "rgba(255,225,140,.45)" : "rgba(220,110,0,.3)";
      s.g.lineWidth = 1.4;
      s.g.beginPath();
      s.g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      s.g.lineTo(c + Math.cos(a + (mid - a) * 0.08) * (r0 + c * 0.12), c + Math.sin(a + (mid - a) * 0.08) * (r0 + c * 0.12));
      s.g.stroke();
    }
  }
  disc(s.g, c, c * 0.07, "#fff6e0");
  flat(b.g, n, n, 128);
  for (let i = 0; i < 400; i++) {
    const a = R() * TAU;
    const r = c * (0.1 + R() * 0.75);
    b.g.fillStyle = "rgba(255,255,255,.35)";
    b.g.beginPath();
    b.g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.6, 0, TAU);
    b.g.fill();
  }
}

function capOlma(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#b81428");
  disc(s.g, c, c * 0.955, "#fff9dc");
  disc(s.g, c, c * 0.93, radial(s.g, c, [[0, "#f4ecb8"], [0.6, "#fbf5d0"], [1, "#fffbe6"]]));
  fibres(s.g, c, R, 160, 0.3, 0.9, "rgba(225,205,140,.25)", 1);
  // core
  s.g.fillStyle = "rgba(226,208,150,.8)";
  s.g.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    const rr = c * 0.2;
    s.g.ellipse(c + Math.cos(a) * rr * 0.9, c + Math.sin(a) * rr * 0.9, c * 0.09, c * 0.16, a + Math.PI / 2, 0, TAU);
  }
  s.g.fill();
  disc(s.g, c, c * 0.045, "#d8c682");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    seed(s.g, c + Math.cos(a) * c * 0.2, c + Math.sin(a) * c * 0.2, c * 0.035, c * 0.065, a + Math.PI / 2, "#4a2a14");
  }
  flat(b.g, n, n, 128);
}

function capBanan(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#e9c726");
  disc(s.g, c, c * 0.93, "#f6efc2");
  disc(s.g, c, c * 0.88, radial(s.g, c, [[0, "#f2e2a2"], [0.7, "#fbf0c6"], [1, "#fff6d6"]]));
  fibres(s.g, c, R, 120, 0.2, 0.85, "rgba(225,200,120,.3)", 1);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    seed(s.g, c + Math.cos(a) * c * 0.16, c + Math.sin(a) * c * 0.16, c * 0.035, c * 0.035, 0, "#6b5320", false);
  }
  flat(b.g, n, n, 128);
}

function capAnanas(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#a06a1a");
  disc(s.g, c, c * 0.95, radial(s.g, c, [[0, "#fff1a6"], [0.3, "#ffe36b"], [0.8, "#ffcf33"], [1, "#f2b414"]]));
  fibres(s.g, c, R, 320, 0.2, 0.92, "rgba(255,246,176,.38)", 1.3);
  fibres(s.g, c, R, 160, 0.3, 0.9, "rgba(214,150,0,.3)", 1.2);
  disc(s.g, c, c * 0.22, radial(s.g, c, [[0, "#fff6c6"], [0.8, "#fff0a0"], [1, "rgba(255,240,160,0)"]]));
  for (let i = 0; i < 60; i++) {
    const a = R() * TAU;
    const r = c * (0.25 + R() * 0.6);
    s.g.fillStyle = "rgba(255,255,220,.35)";
    s.g.beginPath();
    s.g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.8, 0, TAU);
    s.g.fill();
  }
  flat(b.g, n, n, 128);
  fibres(b.g, c, R, 200, 0.2, 0.9, "rgba(255,255,255,.2)", 1.6);
}

function capKivi(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#6b4a26");
  disc(s.g, c, c * 0.95, "#a4d65a");
  disc(s.g, c, c * 0.93, radial(s.g, c, [[0, "#d9f2a0"], [0.25, "#a8e060"], [0.75, "#76cf3a"], [1, "#58b82c"]]));
  fibres(s.g, c, R, 300, 0.22, 0.9, "rgba(222,248,170,.45)", 1.4);
  fibres(s.g, c, R, 120, 0.3, 0.92, "rgba(60,150,30,.3)", 1.2);
  s.g.fillStyle = radial(s.g, c, [[0, "#fbfdf0"], [0.6, "#f0f8d8"], [1, "rgba(240,248,216,0)"]]);
  s.g.beginPath();
  s.g.ellipse(c, c, c * 0.2, c * 0.14, 0, 0, TAU);
  s.g.fill();
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * TAU;
    const rr = c * (0.3 + 0.07 * Math.sin(i * 2.3));
    seed(s.g, c + Math.cos(a) * rr, c + Math.sin(a) * rr, c * 0.016, c * 0.032, a + Math.PI / 2, "#14150f", false);
  }
  flat(b.g, n, n, 128);
}

function capAnor(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#8f1230");
  disc(s.g, c, c * 0.93, "#f3d4cf");
  disc(s.g, c, c * 0.9, "#f7e1da");
  flat(b.g, n, n, 100);
  const placed: number[] = [];
  const rA = c * 0.095;
  let tries = 0;
  while (placed.length < 3 * 150 && tries < 4000) {
    tries++;
    const a = R() * TAU;
    const r = Math.sqrt(R()) * c * 0.8;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    let ok = true;
    for (let i = 0; i < placed.length; i += 3) {
      if ((placed[i] - x) ** 2 + (placed[i + 1] - y) ** 2 < rA * rA * 2.9) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    placed.push(x, y, rA * (0.9 + R() * 0.2));
  }
  for (let i = 0; i < placed.length; i += 3) {
    const x = placed[i];
    const y = placed[i + 1];
    const r = placed[i + 2];
    const gr = s.g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    gr.addColorStop(0, "#ff5a78");
    gr.addColorStop(0.55, "#d3153a");
    gr.addColorStop(1, "#8a0c26");
    s.g.fillStyle = gr;
    s.g.beginPath();
    s.g.arc(x, y, r, 0, TAU);
    s.g.fill();
    s.g.fillStyle = "rgba(255,255,255,.55)";
    s.g.beginPath();
    s.g.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.15, -0.6, 0, TAU);
    s.g.fill();
    const bg = b.g.createRadialGradient(x, y, 0, x, y, r);
    bg.addColorStop(0, "rgb(255,255,255)");
    bg.addColorStop(1, "rgb(40,40,40)");
    b.g.fillStyle = bg;
    b.g.beginPath();
    b.g.arc(x, y, r, 0, TAU);
    b.g.fill();
  }
  s.g.strokeStyle = "rgba(247,225,218,.95)";
  s.g.lineWidth = Math.max(2, n / 90);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    s.g.beginPath();
    s.g.moveTo(c, c);
    s.g.lineTo(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9);
    s.g.stroke();
  }
}

function capQovun(s: ReturnType<typeof mk>, b: ReturnType<typeof mk>, n: number, R: Rnd): void {
  const c = n / 2;
  disc(s.g, c, c, "#c9c07a");
  disc(s.g, c, c * 0.96, "#a9d18a");
  disc(s.g, c, c * 0.9, "#d6ecae");
  disc(s.g, c, c * 0.85, radial(s.g, c, [[0, "#ffb070"], [0.5, "#ffbf84"], [0.9, "#ffd6a2"], [1, "#e9e6b0"]]));
  fibres(s.g, c, R, 220, 0.4, 0.85, "rgba(255,230,190,.35)", 1.4);
  disc(s.g, c, c * 0.38, radial(s.g, c, [[0, "#fff1d6"], [0.8, "#ffe2b8"], [1, "#ffcf98"]]));
  fibres(s.g, c, R, 90, 0.05, 0.36, "rgba(240,180,120,.5)", 1.4);
  for (let i = 0; i < 26; i++) {
    const a = R() * TAU;
    const r = c * (0.04 + R() * 0.3);
    seed(s.g, c + Math.cos(a) * r, c + Math.sin(a) * r, c * 0.03, c * 0.06, a + 1, "#f2e4b8", true);
  }
  flat(b.g, n, n, 128);
  fibres(b.g, c, R, 120, 0.4, 0.85, "rgba(255,255,255,.2)", 1.5);
}

export function paintFruit(id: FruitId, skinW: number, capN: number): Painted {
  const w = skinW;
  const h = skinW / 2;
  const R = seeded(id.split("").reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const s = mk(w, h);
  const sb = mk(w, h);
  const c = mk(capN, capN);
  const cb = mk(capN, capN);
  switch (id) {
    case "tarvuz":
      skinTarvuz(s, sb, w, h, R);
      capTarvuz(c, cb, capN, R);
      break;
    case "apelsin":
      skinApelsin(s, sb, w, h, R);
      capApelsin(c, cb, capN, R);
      break;
    case "olma":
      skinOlma(s, sb, w, h, R);
      capOlma(c, cb, capN, R);
      break;
    case "banan":
      skinBanan(s, sb, w, h, R);
      capBanan(c, cb, capN, R);
      break;
    case "ananas":
      skinAnanas(s, sb, w, h);
      capAnanas(c, cb, capN, R);
      break;
    case "kivi":
      skinKivi(s, sb, w, h, R);
      capKivi(c, cb, capN, R);
      break;
    case "anor":
      skinAnor(s, sb, w, h, R);
      capAnor(c, cb, capN, R);
      break;
    case "qovun":
      skinQovun(s, sb, w, h, R);
      capQovun(c, cb, capN, R);
      break;
  }
  return { skin: s.c, skinBump: sb.c, cap: c.c, capBump: cb.c };
}

/** Cast-iron look for the bomb: speckled grey noise used as a bump / roughness detail map. */
export function paintIron(w: number): HTMLCanvasElement {
  const h = w / 2;
  const { c, g } = mk(w, h);
  shade(g, w, h, (u, v, o) => {
    const n = fbm(u, v, 14, 4, 91);
    o[0] = o[1] = o[2] = 100 + n * 110;
  });
  const R = seeded(77);
  dots(g, w, h, R, 300, 0.6, 1.8, "rgba(30,30,30,.7)");
  return c;
}

/** Soft white glow used for the fuse spark sprite and the trail head. */
export function paintGlow(n: number): HTMLCanvasElement {
  const { c, g } = mk(n, n);
  const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.18, "rgba(255,240,170,.95)");
  gr.addColorStop(0.45, "rgba(255,150,40,.45)");
  gr.addColorStop(1, "rgba(255,90,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, n, n);
  return c;
}
