// Procedural textures (no image files). Each one can be replaced by a file through assets.json later.

import * as THREE from "three";
import { bedDepth, type LocationConfig } from "./locations";
import type { SpeciesDef } from "./species";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const [cv, c] = canvas(w, h);
  draw(c, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function seededRng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Tileable normal map (RGB) with the height field in alpha. */
export function makeWaterNormal(size = 256, seed = 7): THREE.DataTexture {
  const rng = seededRng(seed);
  const terms: { fx: number; fy: number; a: number; ph: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const fx = Math.floor(rng() * 9) - 4;
    const fy = Math.floor(rng() * 9) - 4;
    if (!fx && !fy) continue;
    terms.push({ fx, fy, a: 1 / Math.hypot(fx, fy), ph: rng() * 6.28 });
  }
  const data = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  const hAt = (u: number, v: number): number => {
    let h = 0;
    for (const t of terms) h += t.a * Math.cos(TAU * (t.fx * u + t.fy * v) + t.ph);
    return h;
  };
  let hmax = 0;
  const hs = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = hAt(x / size, y / size);
    hs[y * size + x] = h;
    hmax = Math.max(hmax, Math.abs(h));
  }
  const k = 5.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (xx: number, yy: number) => hs[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * k;
    const dy = (h(x, y + 1) - h(x, y - 1)) * k;
    const il = 1 / Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    data[i] = Math.round((-dx * il * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((-dy * il * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((il * 0.5 + 0.5) * 255);
    data[i + 3] = Math.round((hs[y * size + x] / hmax * 0.5 + 0.5) * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export interface DepthRegion {
  x0: number;
  z0: number;
  w: number;
  h: number;
}
export const DEPTH_REGION: DepthRegion = { x0: -90, z0: -130, w: 180, h: 160 };
export const DEPTH_SCALE = 12;

/** Water depth (R, 0..12 m) over the region around the bridge; sampled by the water shader (foam, transparency, wave damping). */
export function makeDepthTexture(loc: LocationConfig, size = 128, r: DepthRegion = DEPTH_REGION): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = r.x0 + ((x + 0.5) / size) * r.w;
    const wz = r.z0 + ((y + 0.5) / size) * r.h;
    const d = Math.max(0, bedDepth(loc, wx, wz));
    const i = (y * size + x) * 4;
    data[i] = Math.round(Math.min(1, d / DEPTH_SCALE) * 255);
    data[i + 1] = data[i + 2] = 0;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export function makeWoodTexture(): THREE.CanvasTexture {
  const rng = seededRng(21);
  const t = canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = "#8b6136";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(60,35,15,.5)";
    for (let i = 0; i < 14; i++) {
      c.lineWidth = 1 + rng() * 2;
      c.beginPath();
      c.moveTo(0, rng() * h);
      c.bezierCurveTo(w * 0.3, rng() * h, w * 0.6, rng() * h, w, rng() * h);
      c.stroke();
    }
    c.fillStyle = "rgba(30,15,5,.25)";
    for (let i = 0; i < 6; i++) c.fillRect(rng() * w, rng() * h, 3, 3);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeCloudTexture(): THREE.CanvasTexture {
  const rng = seededRng(5);
  return canvasTex(256, 128, (c, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = (0.15 + rng() * 0.7) * w;
      const y = (0.4 + rng() * 0.35) * h;
      const r = 14 + rng() * 20;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  });
}

export function makeDotTexture(): THREE.CanvasTexture {
  return canvasTex(32, 32, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
  });
}

/**
 * Fish skin. u = along the body (0 tail .. 1 nose), v = around it (0 back, .25 side, .5 belly, .75 other side).
 * The bottom strip (v > 0.94) is plain fin colour — fins are UV-mapped there.
 */
export function makeFishSkin(sp: SpeciesDef): THREE.CanvasTexture {
  const rng = seededRng(sp.id.length * 977 + sp.id.charCodeAt(0));
  return canvasTex(256, 128, (c, w, h) => {
    const bodyH = h * 0.93;
    const g = c.createLinearGradient(0, 0, 0, bodyH);
    // v: back (0) -> side (.25) -> belly (.5) -> side (.75) -> back (1)
    g.addColorStop(0, sp.col);
    g.addColorStop(0.14, sp.col);
    g.addColorStop(0.3, sp.col);
    g.addColorStop(0.4, sp.belly);
    g.addColorStop(0.6, sp.belly);
    g.addColorStop(0.7, sp.col);
    g.addColorStop(0.86, sp.col);
    g.addColorStop(1, sp.col);
    c.fillStyle = g;
    c.fillRect(0, 0, w, bodyH);
    if (sp.stripe) {
      c.fillStyle = sp.stripe;
      c.globalAlpha = 0.55;
      c.fillRect(0, bodyH * 0.22, w, bodyH * 0.05);
      c.fillRect(0, bodyH * 0.73, w, bodyH * 0.05);
      c.globalAlpha = 1;
    }
    if (sp.spots) {
      c.fillStyle = sp.spots;
      for (let i = 0; i < 120; i++) {
        const y = rng() * bodyH;
        if (y > bodyH * 0.38 && y < bodyH * 0.62) continue;
        c.globalAlpha = 0.6;
        c.beginPath();
        c.arc(rng() * w, y, 1 + rng() * 2.2, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    // scales
    c.strokeStyle = "rgba(0,0,0,.12)";
    for (let x = 0; x < w; x += 7) for (let y = 3; y < bodyH * 0.38; y += 7) {
      c.beginPath();
      c.arc(x + (Math.floor(y / 7) % 2 ? 3 : 0), y, 4, 0, Math.PI);
      c.stroke();
    }
    for (let x = 0; x < w; x += 7) for (let y = bodyH * 0.62; y < bodyH; y += 7) {
      c.beginPath();
      c.arc(x + (Math.floor(y / 7) % 2 ? 3 : 0), y, 4, 0, Math.PI);
      c.stroke();
    }
    // eyes on both sides near the nose
    for (const v of [0.25, 0.75]) {
      const ex = w * 0.9;
      const ey = bodyH * v;
      c.fillStyle = "#f4f1e6";
      c.beginPath();
      c.ellipse(ex, ey, 6, 7, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#0a0a0a";
      c.beginPath();
      c.arc(ex + 1, ey, 3.6, 0, Math.PI * 2);
      c.fill();
    }
    // fin strip
    c.fillStyle = sp.fin;
    c.fillRect(0, bodyH, w, h - bodyH);
  });
}

/** Small picture of a species for the encyclopedia (2D canvas, not a texture). */
export function drawFishIcon(c: CanvasRenderingContext2D, sp: SpeciesDef, cx: number, cy: number, size: number, dim = false): void {
  c.save();
  c.translate(cx, cy);
  const L = size;
  const H = Math.max(size * 0.22, (sp.h / sp.len) * size * 0.9);
  if (sp.junk === "boot") {
    c.fillStyle = dim ? "#222" : "#5d3a1a";
    c.fillRect(-L * 0.12, -L * 0.34, L * 0.22, L * 0.5);
    c.fillRect(-L * 0.12, L * 0.04, L * 0.48, L * 0.16);
    c.fillStyle = dim ? "#111" : "#1a1a1a";
    c.fillRect(-L * 0.12, L * 0.2, L * 0.5, L * 0.05);
  } else if (sp.junk === "bottle") {
    c.rotate(-0.6);
    c.fillStyle = dim ? "#223" : "rgba(63,154,106,.9)";
    c.fillRect(-L * 0.28, -L * 0.1, L * 0.38, L * 0.2);
    c.fillRect(L * 0.1, -L * 0.05, L * 0.2, L * 0.1);
    c.fillStyle = dim ? "#111" : "#d9d3c0";
    c.fillRect(L * 0.3, -L * 0.04, L * 0.04, L * 0.08);
  } else {
    c.fillStyle = dim ? "#1b2a33" : sp.fin;
    c.beginPath();
    c.moveTo(-L * 0.36, 0);
    c.lineTo(-L * 0.52, -H * 0.55);
    c.lineTo(-L * 0.46, 0);
    c.lineTo(-L * 0.52, H * 0.55);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-L * 0.1, -H * 0.4);
    c.lineTo(L * 0.05, -H * 0.8);
    c.lineTo(L * 0.14, -H * 0.4);
    c.closePath();
    c.fill();
    const g = c.createLinearGradient(0, -H / 2, 0, H / 2);
    g.addColorStop(0, dim ? "#1b2a33" : sp.col);
    g.addColorStop(0.55, dim ? "#1b2a33" : sp.col);
    g.addColorStop(0.62, dim ? "#22343f" : sp.belly);
    g.addColorStop(1, dim ? "#22343f" : sp.belly);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, L * 0.4, H / 2, 0, 0, Math.PI * 2);
    c.fill();
    if (!dim) {
      if (sp.stripe) {
        c.fillStyle = sp.stripe;
        c.globalAlpha = 0.6;
        c.fillRect(-L * 0.3, -H * 0.05, L * 0.6, H * 0.1);
        c.globalAlpha = 1;
      }
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(L * 0.27, -H * 0.1, H * 0.1, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#000";
      c.beginPath();
      c.arc(L * 0.28, -H * 0.1, H * 0.05, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}
