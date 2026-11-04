// Darvozabon: static art, drawn ONCE into offscreen canvases (ball, glove, boot, striker, goal net, shadow, texts).
// Per frame the game only calls drawImage with these. Nothing here runs in the frame loop.

const TAU = Math.PI * 2;

export interface Sprite {
  cv: HTMLCanvasElement;
  /** size of the sprite in CSS px (the canvas is `k` times bigger) */
  w: number;
  h: number;
}

function make(w: number, h: number, k: number): { sp: Sprite; c: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(w * k));
  cv.height = Math.max(1, Math.ceil(h * k));
  const c = cv.getContext("2d");
  if (!c) throw new Error("2d context");
  c.scale(k, k);
  return { sp: { cv, w, h }, c };
}

function pentagon(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * TAU;
    if (i === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
}

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/** football of radius r (the sprite is 2r + 4 px wide) */
export function soccerBall(r: number, k: number): Sprite {
  const s = r * 2 + 4;
  const { sp, c } = make(s, s, k);
  const cx = s / 2;
  const g = c.createRadialGradient(cx - r * 0.35, cx - r * 0.4, r * 0.1, cx, cx, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.65, "#eceff4");
  g.addColorStop(1, "#aab3c0");
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cx, r, 0, TAU);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(cx, cx, r, 0, TAU);
  c.clip();
  c.fillStyle = "#1c212b";
  c.strokeStyle = "#1c212b";
  c.lineWidth = Math.max(1, r * 0.05);
  c.lineJoin = "round";
  pentagon(c, cx, cx, r * 0.34, -Math.PI / 2);
  c.fill();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * TAU;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r * 0.34, cx + Math.sin(a) * r * 0.34);
    c.lineTo(cx + Math.cos(a) * r * 0.62, cx + Math.sin(a) * r * 0.62);
    c.stroke();
    pentagon(c, cx + Math.cos(a) * r * 0.95, cx + Math.sin(a) * r * 0.95, r * 0.3, a);
    c.fill();
  }
  c.restore();
  c.strokeStyle = "rgba(20,24,32,.85)";
  c.lineWidth = Math.max(1.5, r * 0.06);
  c.beginPath();
  c.arc(cx, cx, r - c.lineWidth / 2, 0, TAU);
  c.stroke();
  return sp;
}

/** goalkeeper glove of radius r (palm, four fingers, thumb, cuff) */
export function glove(r: number, k: number): Sprite {
  const s = r * 2 + 6;
  const { sp, c } = make(s, s, k);
  c.translate(s / 2, s / 2 + r * 0.04);
  c.lineJoin = "round";
  c.lineWidth = Math.max(1.5, r * 0.07);
  c.strokeStyle = "#7a2b00";
  // cuff
  c.fillStyle = "#f4f6fb";
  rrect(c, -r * 0.52, r * 0.52, r * 1.04, r * 0.42, r * 0.1);
  c.fill();
  c.stroke();
  c.fillStyle = "#2f7bff";
  c.fillRect(-r * 0.5, r * 0.66, r * 1.0, r * 0.1);
  // fingers
  const og = c.createLinearGradient(0, -r, 0, r * 0.6);
  og.addColorStop(0, "#ffc247");
  og.addColorStop(1, "#ff7a00");
  c.fillStyle = og;
  for (let i = 0; i < 4; i++) {
    const fx = (i - 1.5) * r * 0.36;
    const fy = -r * 0.62 - (i === 1 || i === 2 ? r * 0.08 : 0) + Math.abs(i - 1.5) * r * 0.04;
    rrect(c, fx - r * 0.17, fy - r * 0.3, r * 0.34, r * 0.8, r * 0.17);
    c.fill();
    c.stroke();
  }
  // thumb
  c.beginPath();
  c.ellipse(-r * 0.74, r * 0.02, r * 0.2, r * 0.3, -0.5, 0, TAU);
  c.fill();
  c.stroke();
  // palm
  rrect(c, -r * 0.66, -r * 0.4, r * 1.32, r * 1.0, r * 0.3);
  c.fill();
  c.stroke();
  // highlight
  c.fillStyle = "rgba(255,255,255,.35)";
  c.beginPath();
  c.ellipse(-r * 0.2, -r * 0.1, r * 0.3, r * 0.18, -0.4, 0, TAU);
  c.fill();
  return sp;
}

/** small boot marker for the feet */
export function boot(r: number, k: number): Sprite {
  const s = r * 2 + 6;
  const { sp, c } = make(s, s, k);
  const cx = s / 2;
  const g = c.createRadialGradient(cx - r * 0.3, cx - r * 0.3, r * 0.1, cx, cx, r);
  g.addColorStop(0, "#9ff3ff");
  g.addColorStop(1, "#1aa6c9");
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cx, r, 0, TAU);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.9)";
  c.lineWidth = Math.max(1.5, r * 0.14);
  c.stroke();
  return sp;
}

/** soft golden ellipse (the target marker on the goal line), 2:1 */
export function marker(w: number, k: number): Sprite {
  const h = w * 0.5;
  const { sp, c } = make(w, h, k);
  c.translate(w / 2, h / 2);
  c.scale(1, 0.5);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
  g.addColorStop(0, "rgba(255,210,61,.95)");
  g.addColorStop(0.5, "rgba(255,210,61,.45)");
  g.addColorStop(1, "rgba(255,210,61,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, w / 2, 0, TAU);
  c.fill();
  return sp;
}

/** the far striker, two poses (0 = ready, 1 = kicking). Height h; the feet are at the bottom, x = 0.45 w. */
export function striker(h: number, pose: 0 | 1, k: number): Sprite {
  const w = h * 1.1;
  const { sp, c } = make(w, h, k);
  c.translate(w * 0.45, h - 1);
  c.lineCap = "round";
  c.lineJoin = "round";
  const u = h / 10;
  c.strokeStyle = "#f2c6a0";
  c.lineWidth = u * 0.9;
  c.beginPath();
  if (pose === 0) {
    c.moveTo(-u * 0.4, -u * 4.6);
    c.lineTo(-u * 0.9, 0);
    c.moveTo(u * 0.4, -u * 4.6);
    c.lineTo(u * 1.4, 0);
  } else {
    c.moveTo(-u * 0.4, -u * 4.6);
    c.lineTo(-u * 0.7, 0);
    c.moveTo(u * 0.4, -u * 4.6);
    c.lineTo(u * 2.3, -u * 2.6);
  }
  c.stroke();
  c.strokeStyle = "#1c2230";
  c.lineWidth = u * 1.0;
  c.beginPath();
  if (pose === 0) {
    c.moveTo(-u * 0.9, -u * 0.8);
    c.lineTo(-u * 0.9, 0);
    c.moveTo(u * 1.4, -u * 0.8);
    c.lineTo(u * 1.4, 0);
  } else {
    c.moveTo(-u * 0.7, -u * 0.8);
    c.lineTo(-u * 0.7, 0);
    c.moveTo(u * 1.9, -u * 2.9);
    c.lineTo(u * 2.4, -u * 2.5);
  }
  c.stroke();
  c.fillStyle = "#f4f6fb";
  c.fillRect(-u * 1.1, -u * 5.4, u * 2.2, u * 1.2);
  c.fillStyle = "#e63946";
  rrect(c, -u * 1.3, -u * 8.2, u * 2.6, u * 3.0, u * 0.6);
  c.fill();
  c.strokeStyle = "#f2c6a0";
  c.lineWidth = u * 0.7;
  c.beginPath();
  if (pose === 0) {
    c.moveTo(-u * 1.3, -u * 7.8);
    c.lineTo(-u * 2.2, -u * 5.6);
    c.moveTo(u * 1.3, -u * 7.8);
    c.lineTo(u * 2.2, -u * 5.6);
  } else {
    c.moveTo(-u * 1.3, -u * 7.8);
    c.lineTo(-u * 2.6, -u * 7.2);
    c.moveTo(u * 1.3, -u * 7.8);
    c.lineTo(u * 2.6, -u * 8.4);
  }
  c.stroke();
  c.fillStyle = "#f2c6a0";
  c.beginPath();
  c.arc(0, -u * 9.1, u * 1.0, 0, TAU);
  c.fill();
  c.fillStyle = "#3a2a1c";
  c.beginPath();
  c.arc(0, -u * 9.4, u * 1.0, Math.PI, TAU);
  c.fill();
  return sp;
}

function hatch(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.beginPath();
  for (let d = -h; d < w + h; d += step) {
    c.moveTo(x + d, y);
    c.lineTo(x + d + h, y + h);
    c.moveTo(x + d + h, y);
    c.lineTo(x + d, y + h);
  }
  c.stroke();
  c.restore();
}

/** crossbar with the net hanging behind it: w x (bar + netH) */
export function crossbar(w: number, bar: number, netH: number, k: number): Sprite {
  const { sp, c } = make(w, bar + netH, k);
  c.strokeStyle = "rgba(255,255,255,.3)";
  c.lineWidth = 1;
  hatch(c, 0, bar, w, netH, 16);
  const g = c.createLinearGradient(0, 0, 0, bar);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#bcc7d6");
  c.fillStyle = g;
  c.fillRect(0, 0, w, bar);
  return sp;
}

/** left post with a strip of net on its inner side (mirror it for the right one): sideW x h */
export function post(sideW: number, h: number, bar: number, k: number): Sprite {
  const { sp, c } = make(sideW, h, k);
  c.strokeStyle = "rgba(255,255,255,.28)";
  c.lineWidth = 1;
  hatch(c, bar, 0, sideW - bar, h, 16);
  const g = c.createLinearGradient(0, 0, bar, 0);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#bcc7d6");
  c.fillStyle = g;
  c.fillRect(0, 0, bar, h);
  return sp;
}

/** outlined text, several lines, centred; the font shrinks until the widest line fits maxW */
export function textSprite(lines: readonly string[], size: number, col: string, maxW: number, k: number): Sprite {
  const font = (px: number): string => `800 ${px}px -apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  let px = size;
  let widest = 0;
  if (probe) {
    probe.font = font(px);
    for (const l of lines) widest = Math.max(widest, probe.measureText(l).width);
    if (widest > maxW) {
      px = Math.max(11, (size * maxW) / widest);
      probe.font = font(px);
      widest = 0;
      for (const l of lines) widest = Math.max(widest, probe.measureText(l).width);
    }
  } else {
    widest = maxW;
  }
  const lh = px * 1.3;
  const w = Math.ceil(widest + px * 1.2);
  const { sp, c } = make(w, Math.ceil(lh * lines.length + px * 0.6), k);
  c.font = font(px);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = px * 0.2;
  c.strokeStyle = "rgba(0,0,0,.65)";
  c.fillStyle = col;
  for (let i = 0; i < lines.length; i++) {
    const y = px * 0.3 + lh * (i + 0.5);
    c.strokeText(lines[i], w / 2, y);
    c.fillText(lines[i], w / 2, y);
  }
  return sp;
}
