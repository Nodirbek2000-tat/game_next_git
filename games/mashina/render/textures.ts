import * as THREE from "three";

// Small procedural canvas textures: window grid (diffuse + night emissive), asphalt grain, the road-sign atlas,
// a soft round sprite for smoke/rain. Everything is generated on the client at mount (no files needed).

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** One window bay (3.2 m x 3.4 m): light wall with a dark window; the margin at the top-left stays plain wall colour (roofs sample it). */
export function windowTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 64;
  const [c, x] = canvas(S, S);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, S, S);
  x.fillStyle = "#d9d9d9";
  x.fillRect(0, S - 6, S, 6); // floor slab line
  x.fillStyle = "#3b4b61";
  x.fillRect(16, 14, 32, 30);
  x.fillStyle = "#6f86a3";
  x.fillRect(16, 14, 32, 8);
  x.fillStyle = "#eef2f6";
  x.fillRect(30, 14, 4, 30);
  x.fillRect(16, 27, 32, 3);
  const [e, y] = canvas(S, S);
  y.fillStyle = "#000";
  y.fillRect(0, 0, S, S);
  y.fillStyle = "#ffc46b";
  y.fillRect(17, 15, 13, 12);
  y.fillRect(35, 31, 12, 12);
  y.fillStyle = "#b8864a";
  y.fillRect(35, 15, 12, 12);
  const map = tex(c, true, true);
  const emissive = tex(e, true, true);
  return { map, emissive };
}

/** Fine grain for asphalt / grass so big flat areas do not look like plastic. The (0.03, 0.03) corner stays white. */
export function grainTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, x] = canvas(S, S);
  const img = x.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const n = 232 + Math.floor(Math.random() * 24);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = n;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = "#fff";
  x.fillRect(0, 0, 8, 8);
  return tex(c, true, true);
}

/** Soft round dot (smoke, rain, headlight glow). */
export function dotTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return tex(c);
}

/** Tiny sky cube for glossy wet-road reflections (6 faces of a vertical gradient). */
export function skyCube(top: string, bottom: string): THREE.CubeTexture {
  const faces: HTMLCanvasElement[] = [];
  for (let i = 0; i < 6; i++) {
    const [c, x] = canvas(32, 32);
    const g = x.createLinearGradient(0, 0, 0, 32);
    if (i === 2) {
      g.addColorStop(0, top);
      g.addColorStop(1, top);
    } else if (i === 3) {
      g.addColorStop(0, bottom);
      g.addColorStop(1, bottom);
    } else {
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
    }
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    faces.push(c);
  }
  const t = new THREE.CubeTexture(faces);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------------- signs

export interface SignCell {
  /** [u0, v0, u1, v1] (bottom-left origin, as GeoBuilder.sign expects) */
  uv: [number, number, number, number];
  /** world size in metres of the sign face */
  w: number;
  h: number;
}

export interface BoardSpec {
  key: string;
  kind: string;
  text: string;
  sub?: string;
}

export const ATLAS_W = 1024;
export const ATLAS_H = 512;

const SMALL = ["limit:60", "limit:90", "limit:40", "stop", "giveWay", "zebra", "oneWay", "noEntry", "noStop"];

export const signKey = (kind: string, text?: string, sub?: string): string =>
  kind === "limit" ? `limit:${text}` : ["cityIn", "cityOut", "dir", "airfield", "bridge"].includes(kind) ? `board:${kind}:${text}|${sub ?? ""}` : kind;

export class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly cells = new Map<string, SignCell>();

  constructor(boards: BoardSpec[]) {
    const [c, x] = canvas(ATLAS_W, ATLAS_H);
    x.clearRect(0, 0, ATLAS_W, ATLAS_H);
    const reg = (key: string, px: number, py: number, pw: number, ph: number, w: number, h: number): void => {
      this.cells.set(key, { uv: [px / ATLAS_W, 1 - (py + ph) / ATLAS_H, (px + pw) / ATLAS_W, 1 - py / ATLAS_H], w, h });
    };
    SMALL.forEach((k, i) => {
      const px = (i % 8) * 128;
      const py = Math.floor(i / 8) * 128;
      x.save();
      x.translate(px, py);
      drawSmall(x, k);
      x.restore();
      reg(k, px, py, 128, 128, k === "stop" ? 0.9 : 0.85, k === "stop" ? 0.9 : 0.85);
    });
    boards.slice(0, 8).forEach((b, i) => {
      const px = (i % 4) * 256;
      const py = 256 + Math.floor(i / 4) * 128;
      x.save();
      x.translate(px, py);
      drawBoard(x, b);
      x.restore();
      reg(b.key, px, py, 256, 128, 3.4, 1.7);
    });
    this.texture = tex(c);
  }
}

function drawSmall(x: CanvasRenderingContext2D, k: string): void {
  const C = 64;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const circle = (fill: string, ring: string, w: number): void => {
    x.fillStyle = ring;
    x.beginPath();
    x.arc(C, C, 62, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = fill;
    x.beginPath();
    x.arc(C, C, 62 - w, 0, Math.PI * 2);
    x.fill();
  };
  if (k.startsWith("limit:")) {
    circle("#ffffff", "#d11a1a", 13);
    x.fillStyle = "#111";
    x.font = "bold 58px Arial, sans-serif";
    x.fillText(k.slice(6), C, C + 3);
  } else if (k === "stop") {
    x.fillStyle = "#fff";
    octagon(x, C, C, 62);
    x.fillStyle = "#c8141c";
    octagon(x, C, C, 56);
    x.fillStyle = "#fff";
    x.font = "bold 40px Arial, sans-serif";
    x.fillText("STOP", C, C + 2);
  } else if (k === "giveWay") {
    x.fillStyle = "#fff";
    tri(x, C, C, 62, true);
    x.fillStyle = "#d11a1a";
    tri(x, C, C, 62, true, 0);
    x.fillStyle = "#fff";
    tri(x, C, C - 6, 40, true, 0);
  } else if (k === "zebra") {
    x.fillStyle = "#fff";
    x.fillRect(4, 4, 120, 120);
    x.fillStyle = "#1565c0";
    x.fillRect(9, 9, 110, 110);
    x.fillStyle = "#fff";
    x.beginPath();
    x.moveTo(64, 16);
    x.lineTo(112, 100);
    x.lineTo(16, 100);
    x.closePath();
    x.fill();
    x.fillStyle = "#111";
    x.beginPath();
    x.arc(64, 44, 6, 0, Math.PI * 2);
    x.fill();
    x.fillRect(60, 50, 8, 22);
    x.fillRect(52, 72, 8, 18);
    x.fillRect(68, 72, 8, 18);
    x.fillStyle = "#111";
    x.fillRect(16, 92, 96, 5);
  } else if (k === "oneWay") {
    x.fillStyle = "#fff";
    x.fillRect(4, 4, 120, 120);
    x.fillStyle = "#1565c0";
    x.fillRect(9, 9, 110, 110);
    x.fillStyle = "#fff";
    x.fillRect(24, 54, 52, 20);
    x.beginPath();
    x.moveTo(74, 34);
    x.lineTo(106, 64);
    x.lineTo(74, 94);
    x.closePath();
    x.fill();
  } else if (k === "noEntry") {
    circle("#d11a1a", "#ffffff", 4);
    x.fillStyle = "#fff";
    x.fillRect(22, 54, 84, 20);
  } else if (k === "noStop") {
    circle("#1565c0", "#d11a1a", 10);
    x.strokeStyle = "#d11a1a";
    x.lineWidth = 12;
    x.beginPath();
    x.moveTo(30, 30);
    x.lineTo(98, 98);
    x.moveTo(98, 30);
    x.lineTo(30, 98);
    x.stroke();
  }
}

function octagon(x: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i) x.lineTo(px, py);
    else x.moveTo(px, py);
  }
  x.closePath();
  x.fill();
}
function tri(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, down: boolean, round = 0): void {
  void round;
  x.beginPath();
  const s = down ? 1 : -1;
  x.moveTo(cx, cy + s * r * 0.9);
  x.lineTo(cx - r, cy - s * r * 0.8);
  x.lineTo(cx + r, cy - s * r * 0.8);
  x.closePath();
  x.fill();
}

function drawBoard(x: CanvasRenderingContext2D, b: BoardSpec): void {
  const W = 256;
  const H = 128;
  x.textAlign = "center";
  x.textBaseline = "middle";
  if (b.kind === "cityIn" || b.kind === "cityOut") {
    x.fillStyle = "#111";
    x.fillRect(0, 0, W, H);
    x.fillStyle = "#fff";
    x.fillRect(5, 5, W - 10, H - 10);
    x.fillStyle = "#111";
    x.font = "bold 44px Arial, sans-serif";
    x.fillText(b.text, W / 2, H / 2 - (b.kind === "cityIn" ? 2 : 0));
    if (b.kind === "cityOut") {
      x.strokeStyle = "#d11a1a";
      x.lineWidth = 8;
      x.beginPath();
      x.moveTo(24, H - 20);
      x.lineTo(W - 24, 20);
      x.stroke();
    }
  } else {
    x.fillStyle = "#fff";
    x.fillRect(0, 0, W, H);
    x.fillStyle = b.kind === "airfield" ? "#2e7d32" : "#1565c0";
    x.fillRect(5, 5, W - 10, H - 10);
    x.fillStyle = "#fff";
    x.font = "bold 40px Arial, sans-serif";
    x.fillText(b.text, W / 2, b.sub ? 44 : H / 2);
    if (b.sub) {
      x.font = "bold 34px Arial, sans-serif";
      x.fillText("→  " + b.sub, W / 2, 92);
    }
  }
}
