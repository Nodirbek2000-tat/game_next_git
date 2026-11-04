// Voleybol: static art, drawn ONCE into offscreen canvases (ball, gloss, shadow, hand markers, net, court floor, texts).
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

/** volleyball of radius r with blue / yellow panels (the sprite is 2r + 4 px wide; it is rotated by the game) */
export function ball(r: number, k: number): Sprite {
  const s = r * 2 + 4;
  const { sp, c } = make(s, s, k);
  const cx = s / 2;
  c.translate(cx, cx);
  c.fillStyle = "#fff6d8";
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.clip();
  c.lineCap = "butt";
  for (let i = 0; i < 3; i++) {
    c.save();
    c.rotate((i * TAU) / 3);
    c.lineWidth = r * 0.34;
    c.strokeStyle = i % 2 === 0 ? "#2f6fe0" : "#ffc933";
    c.beginPath();
    c.arc(-r * 1.0, 0, r * 0.95, -0.95, 0.95);
    c.stroke();
    c.lineWidth = Math.max(1, r * 0.04);
    c.strokeStyle = "rgba(60,40,10,.55)";
    for (const d of [-0.17, 0.17]) {
      c.beginPath();
      c.arc(-r * 1.0, 0, r * (0.95 + d), -0.95, 0.95);
      c.stroke();
    }
    c.restore();
  }
  c.restore();
  c.strokeStyle = "rgba(60,40,10,.8)";
  c.lineWidth = Math.max(1.5, r * 0.07);
  c.beginPath();
  c.arc(0, 0, r - c.lineWidth / 2, 0, TAU);
  c.stroke();
  return sp;
}

/** light and shade of the ball, drawn on top without rotation (the light stays on the upper left while the ball spins) */
export function gloss(r: number, k: number): Sprite {
  const s = r * 2 + 4;
  const { sp, c } = make(s, s, k);
  const cx = s / 2;
  const g = c.createRadialGradient(cx - r * 0.35, cx - r * 0.4, r * 0.05, cx, cx, r);
  g.addColorStop(0, "rgba(255,255,255,.55)");
  g.addColorStop(0.35, "rgba(255,255,255,0)");
  g.addColorStop(0.75, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(30,20,0,.38)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cx, r, 0, TAU);
  c.fill();
  return sp;
}

/** soft dark ellipse (shadow on the floor), 2:1 */
export function shadow(w: number, k: number): Sprite {
  const h = w * 0.5;
  const { sp, c } = make(w, h, k);
  c.translate(w / 2, h / 2);
  c.scale(1, 0.5);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
  g.addColorStop(0, "rgba(0,0,0,.6)");
  g.addColorStop(0.6, "rgba(0,0,0,.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, w / 2, 0, TAU);
  c.fill();
  return sp;
}

/** small hand marker: a glowing dot with a white rim (hot = the warm flash on a touch) */
export function marker(r: number, hot: boolean, k: number): Sprite {
  const s = r * 2 + 10;
  const { sp, c } = make(s, s, k);
  const cx = s / 2;
  const glow = c.createRadialGradient(cx, cx, r * 0.6, cx, cx, r + 5);
  glow.addColorStop(0, hot ? "rgba(255,230,120,.55)" : "rgba(120,230,255,.45)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(cx, cx, r + 5, 0, TAU);
  c.fill();
  const g = c.createRadialGradient(cx - r * 0.3, cx - r * 0.3, r * 0.1, cx, cx, r);
  g.addColorStop(0, hot ? "#fff6c2" : "#d5f8ff");
  g.addColorStop(1, hot ? "#ffb21f" : "#27b7e0");
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cx, r, 0, TAU);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.95)";
  c.lineWidth = Math.max(1.5, r * 0.18);
  c.stroke();
  return sp;
}

/** the net: mesh between a thick white top tape and a thin bottom tape, w x h */
export function net(w: number, h: number, k: number): Sprite {
  const { sp, c } = make(w, h, k);
  c.strokeStyle = "rgba(255,255,255,.4)";
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= w; x += 14) {
    c.moveTo(x + 0.5, 5);
    c.lineTo(x + 0.5, h - 2);
  }
  for (let y = 5 + 12; y < h - 2; y += 12) {
    c.moveTo(0, y + 0.5);
    c.lineTo(w, y + 0.5);
  }
  c.stroke();
  c.fillStyle = "rgba(255,255,255,.92)";
  c.fillRect(0, 0, w, 5);
  c.fillStyle = "rgba(255,255,255,.6)";
  c.fillRect(0, h - 2, w, 2);
  return sp;
}

/** vertical post, w x h */
export function post(w: number, h: number, k: number): Sprite {
  const { sp, c } = make(w, h, k);
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255,255,255,.85)");
  g.addColorStop(1, "rgba(200,210,225,.6)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  return sp;
}

/** the floor: a darkening strip with a bright line at its top, w x h */
export function court(w: number, h: number, k: number): Sprite {
  const { sp, c } = make(w, h, k);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(0,0,0,.05)");
  g.addColorStop(1, "rgba(0,0,0,.38)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,.55)";
  c.fillRect(0, 0, w, 3);
  return sp;
}

/** small up triangle (the ball is above the screen) */
export function arrow(r: number, k: number): Sprite {
  const s = r * 2 + 6;
  const { sp, c } = make(s, s, k);
  c.translate(s / 2, s / 2);
  c.fillStyle = "#fff6d8";
  c.strokeStyle = "rgba(60,40,10,.8)";
  c.lineWidth = Math.max(1.5, r * 0.12);
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(0, -r);
  c.lineTo(r * 0.9, r * 0.7);
  c.lineTo(-r * 0.9, r * 0.7);
  c.closePath();
  c.fill();
  c.stroke();
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
