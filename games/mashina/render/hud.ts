import { drawText, TAU } from "@/engine";
import type { ModeId } from "../config";
import type { AiCar } from "../traffic/sim";
import type { Layout } from "../world/layout";
import { STEP_TITLE, type PickerStep } from "../logic/picker";

export interface Msg {
  text: string;
  col: string;
  t: number;
  max: number;
}

export interface HudModel {
  mode: ModeId;
  kmh: number;
  limit: number;
  reverse: boolean;
  gas: number;
  brake: number;
  steer: number;
  handsOk: boolean;
  legsOk: boolean;
  /** what the camera reads from the legs (HUD bars + calibration banner) */
  legs: { ready: boolean; calib: number; sitting: boolean; gasRaw: number; brakeRaw: number; gasThr: number; brakeThr: number; okGas: boolean; okBrake: boolean; keys: boolean };
  kids: boolean;
  seated: boolean;
  handbrake: boolean;
  msgs: Msg[];
  px: number;
  pz: number;
  fx: number;
  fz: number;
  /** relative angle (rad) of the GPS target to the heading, + = to the right */
  gpsAngle: number;
  gpsDist: number;
  gpsName: string;
  route: { x: number; z: number }[];
  target: { x: number; z: number; r: number } | null;
  cars: AiCar[];
  mission: { title: string; timeLeft: number; sub: string } | null;
  exam: { penalty: number; limit: number; last: string } | null;
  drift: { chain: number; combo: number; total: number; angle: number; drifting: boolean } | null;
  picker: { step: PickerStep; options: string[]; subs: string[]; selected: number; index: number; count: number } | null;
  hint: string;
  night: number;
  raining: boolean;
  cockpit: boolean;
  clock: number;
  warnZone: string;
}

export const newHudModel = (): HudModel => ({
  mode: "erkin", kmh: 0, limit: 60, reverse: false, gas: 0, brake: 0, steer: 0, handsOk: false, legsOk: false, legs: { ready: false, calib: 0, sitting: false, gasRaw: 0, brakeRaw: 0, gasThr: 0.14, brakeThr: 0.14, okGas: false, okBrake: false, keys: false }, kids: false, seated: false, handbrake: false,
  msgs: [], px: 0, pz: 0, fx: 0, fz: 1, gpsAngle: 0, gpsDist: 0, gpsName: "", route: [], target: null, cars: [], mission: null, exam: null, drift: null, picker: null, hint: "",
  night: 0, raining: false, cockpit: false, clock: 0, warnZone: "",
});

const panel = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.62): void => {
  c.save();
  c.fillStyle = `rgba(10,12,20,${a})`;
  c.beginPath();
  c.roundRect(x, y, w, h, 12);
  c.fill();
  c.restore();
};

export function drawHud(c: CanvasRenderingContext2D, W: number, H: number, m: HudModel, L: Layout, now: number): void {
  const u = Math.max(0.7, Math.min(1.25, Math.min(W / 1280, H / 720)));
  if (m.picker) {
    drawPicker(c, W, H, m);
    drawLegBanner(c, W, H * 0.9, m, u);
    drawPedals(c, W - 130 * u, H - 34 * u, 140 * u, m, u);
    return;
  }
  drawSpeedo(c, 112 * u + 14, H - 112 * u - 14, 80 * u, m, u);
  drawPedals(c, W - 130 * u, H - 34 * u, 140 * u, m, u);
  drawWheel(c, W / 2, H - 64 * u, 54 * u, m);
  drawMiniMap(c, 14 + 86 * u, 108 + 86 * u, 86 * u, m, L, now);
  drawGps(c, W / 2, 96 + 30 * u, m, u);
  drawPanels(c, 14, 108 + 186 * u, m, u);
  // messages
  m.msgs.forEach((g, i) => {
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, g.t * 2));
    drawText(c, g.text, W / 2, H * 0.24 + i * 38 * u, 24 * u, g.col);
    c.restore();
  });
  drawLegBanner(c, W, H * 0.6, m, u);
  if (!m.handsOk && m.hint === "") drawText(c, "Ikki qo‘lni oldinga cho‘zib, rulni ushlagandek turing", W / 2, H * 0.65, 19 * u, "#ffd23f");
  if (m.hint) drawText(c, m.hint, W / 2, H * 0.34, 21 * u, "#fff");
  if (m.raining) drawText(c, "Yomg‘ir — yo‘l sirpanchiq", W - 130 * u, H * 0.18, 14 * u, "#9fd4ff");
  if (m.night > 0.5) drawText(c, "Tun", W - 60 * u, H * 0.18 + 22 * u, 13 * u, "#aab6ff");
  if (m.handbrake) drawText(c, "QO‘L TORMOZI", W / 2, H - 150 * u, 20 * u, "#ff9f43");
}

/**
 * Pedal calibration / leg visibility notice: "Ikkala oyoqda turing" with a progress bar while the camera learns the rest
 * height of both legs; a warning when the legs are not seen or the player sits in the standing mode. Nothing when all is well.
 */
function drawLegBanner(c: CanvasRenderingContext2D, W: number, y: number, m: HudModel, u: number): void {
  const g = m.legs;
  if (g.keys) return;
  if (g.ready) {
    if (!m.legsOk && m.hint === "") drawText(c, "Oyoqlaringiz ko‘rinmayapti — orqaroq turing (yoki ↑/↓ tugmalari)", W / 2, y, 19 * u, "#ffd23f");
    return;
  }
  const bw = 300 * u;
  panel(c, W / 2 - bw / 2 - 16 * u, y - 36 * u, bw + 32 * u, 92 * u, 0.74);
  if (g.sitting) {
    drawText(c, "Tik turing", W / 2, y - 8 * u, 24 * u, "#ffd23f");
    drawText(c, "yoki boshqaruvda “O‘tirib” ni tanlang", W / 2, y + 22 * u, 14 * u, "rgba(255,255,255,.85)", "center", 600);
    return;
  }
  if (!m.legsOk && g.calib <= 0) {
    drawText(c, "Oyoqlaringiz ko‘rinmayapti", W / 2, y - 8 * u, 22 * u, "#ffd23f");
    drawText(c, "Kameradan orqaroq turing: tizzalar kadrda bo‘lsin", W / 2, y + 22 * u, 14 * u, "rgba(255,255,255,.85)", "center", 600);
    return;
  }
  drawText(c, "Ikkala oyoqda turing", W / 2, y - 8 * u, 24 * u, "#fff");
  c.save();
  c.fillStyle = "rgba(255,255,255,.18)";
  c.beginPath();
  c.roundRect(W / 2 - bw / 2, y + 16 * u, bw, 10 * u, 5 * u);
  c.fill();
  c.fillStyle = "#34d399";
  c.beginPath();
  c.roundRect(W / 2 - bw / 2, y + 16 * u, Math.max(10 * u, bw * Math.min(1, g.calib)), 10 * u, 5 * u);
  c.fill();
  c.restore();
  drawText(c, "Kamera oyoqlaringizni o‘lchayapti — qimirlamang", W / 2, y + 42 * u, 12 * u, "rgba(255,255,255,.75)", "center", 600);
}

function drawSpeedo(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, m: HudModel, u: number): void {
  const kmh = m.kmh;
  c.save();
  c.fillStyle = "rgba(10,12,20,.62)";
  c.beginPath();
  c.arc(cx, cy, r + 12 * u, 0, TAU);
  c.fill();
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const ang = (k: number): number => a0 + (a1 - a0) * k;
  c.lineWidth = 8 * u;
  c.strokeStyle = "rgba(255,255,255,.15)";
  c.beginPath();
  c.arc(cx, cy, r, a0, a1);
  c.stroke();
  const over = isFinite(m.limit) && kmh > m.limit + 10;
  c.strokeStyle = over ? "#ff3b3b" : "#22d3ee";
  c.beginPath();
  c.arc(cx, cy, r, a0, ang(Math.min(1, kmh / 160)));
  c.stroke();
  if (isFinite(m.limit)) {
    const la = ang(m.limit / 160);
    c.strokeStyle = "#ff3b3b";
    c.lineWidth = 3 * u;
    c.beginPath();
    c.moveTo(cx + Math.cos(la) * (r - 12 * u), cy + Math.sin(la) * (r - 12 * u));
    c.lineTo(cx + Math.cos(la) * (r + 8 * u), cy + Math.sin(la) * (r + 8 * u));
    c.stroke();
  }
  c.restore();
  for (let v = 0; v <= 160; v += 40) {
    const aa = ang(v / 160);
    drawText(c, String(v), cx + Math.cos(aa) * (r - 22 * u), cy + Math.sin(aa) * (r - 22 * u), 10 * u, "rgba(255,255,255,.65)", "center", 600);
  }
  drawText(c, String(Math.round(Math.abs(kmh))), cx, cy + 8 * u, 38 * u, over ? "#ff6b6b" : "#fff");
  drawText(c, "km/soat", cx, cy + 34 * u, 11 * u, "rgba(255,255,255,.7)");
  // gear badge: D (forward) green, R (reverse) orange
  c.save();
  c.fillStyle = m.reverse ? "#ff9f43" : "#34d399";
  c.beginPath();
  c.roundRect(cx - 17 * u, cy - 44 * u, 34 * u, 24 * u, 7 * u);
  c.fill();
  c.restore();
  drawText(c, m.reverse ? "R" : "D", cx, cy - 31 * u, 19 * u, "#0b1220");
  // current limit sign
  if (isFinite(m.limit)) {
    const lx = cx + r + 50 * u;
    const ly = cy - 36 * u;
    c.save();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(lx, ly, 26 * u, 0, TAU);
    c.fill();
    c.strokeStyle = "#d11";
    c.lineWidth = 6 * u;
    c.beginPath();
    c.arc(lx, ly, 22 * u, 0, TAU);
    c.stroke();
    c.restore();
    drawText(c, String(m.limit), lx, ly + 2 * u, 17 * u, "#111");
  }
}

/**
 * Two pedal bars, T (brake, left knee) and G (gas, right knee). The pale fill is what the CAMERA reads (knee lift), the
 * coloured fill is the pedal value the car gets, the tick is the dead zone a lift must pass to count. A grey bar with a
 * cross means that leg is not seen (the pedal is 0 then).
 */
function drawPedals(c: CanvasRenderingContext2D, px: number, py: number, ph: number, m: HudModel, u: number): void {
  const g = m.legs;
  const bars: { lbl: string; sub: string; raw: number; thr: number; out: number; ok: boolean; col: string }[] = [
    { lbl: "T", sub: "chap tizza", raw: g.brakeRaw, thr: g.brakeThr, out: m.brake, ok: g.keys || (g.ready && g.okBrake), col: "#ff4d4d" },
    { lbl: "G", sub: "o‘ng tizza", raw: g.gasRaw, thr: g.gasThr, out: m.gas, ok: g.keys || m.kids || (g.ready && g.okGas), col: "#34d399" },
  ];
  bars.forEach((b, i) => {
    const x = px + i * 64 * u;
    const hh = ph * 0.9;
    const top = py - hh;
    panel(c, x - 24 * u, top - 10 * u, 48 * u, hh + 20 * u);
    c.save();
    c.fillStyle = "rgba(255,255,255,.08)";
    c.fillRect(x - 15 * u, top, 30 * u, hh);
    if (b.ok) {
      c.fillStyle = "rgba(255,255,255,.28)";
      c.fillRect(x - 15 * u, py - hh * b.raw, 30 * u, hh * b.raw);
      c.fillStyle = b.col;
      c.fillRect(x - 11 * u, py - hh * b.out, 22 * u, hh * b.out);
      c.fillStyle = "rgba(255,255,255,.9)";
      c.fillRect(x - 18 * u, py - hh * b.thr - 1, 36 * u, 2);
    } else {
      c.strokeStyle = "rgba(255,255,255,.35)";
      c.lineWidth = 3 * u;
      c.beginPath();
      c.moveTo(x - 9 * u, top + hh / 2 - 9 * u);
      c.lineTo(x + 9 * u, top + hh / 2 + 9 * u);
      c.moveTo(x + 9 * u, top + hh / 2 - 9 * u);
      c.lineTo(x - 9 * u, top + hh / 2 + 9 * u);
      c.stroke();
    }
    c.restore();
    drawText(c, b.lbl, x, top - 24 * u, 16 * u, b.ok ? b.col : "rgba(255,255,255,.45)");
    drawText(c, b.sub, x, py + 20 * u, 10 * u, "rgba(255,255,255,.7)", "center", 600);
  });
}

function drawWheel(c: CanvasRenderingContext2D, wx: number, wy: number, wr: number, m: HudModel): void {
  c.save();
  c.translate(wx, wy);
  c.rotate(m.steer * (Math.PI / 2));
  c.strokeStyle = "rgba(20,20,26,.85)";
  c.lineWidth = wr * 0.24;
  c.beginPath();
  c.arc(0, 0, wr, 0, TAU);
  c.stroke();
  c.strokeStyle = m.handsOk ? "rgba(200,210,230,.9)" : "rgba(255,120,120,.9)";
  c.lineWidth = wr * 0.09;
  c.beginPath();
  c.arc(0, 0, wr, 0, TAU);
  c.stroke();
  c.lineWidth = wr * 0.16;
  c.strokeStyle = "rgba(20,20,26,.85)";
  c.beginPath();
  c.moveTo(-wr, 0);
  c.lineTo(wr, 0);
  c.moveTo(0, 0);
  c.lineTo(0, wr);
  c.stroke();
  c.fillStyle = "#c8102e";
  c.beginPath();
  c.arc(0, 0, wr * 0.22, 0, TAU);
  c.fill();
  c.fillStyle = "#ffd7b0";
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.arc(sx * wr, 0, wr * 0.17, 0, TAU);
    c.fill();
  }
  c.restore();
}

function drawMiniMap(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, m: HudModel, L: Layout, now: number): void {
  const k = 0.4 * (r / 86); // px per metre
  const ang = Math.atan2(m.fx, -m.fz); // heading from north
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  // world -> screen (forward up)
  const sx = (x: number, z: number): number => cx + ((x - m.px) * ca + (z - m.pz) * sa) * k;
  const sy = (x: number, z: number): number => cy + (-(x - m.px) * sa + (z - m.pz) * ca) * k;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.clip();
  c.fillStyle = "rgba(24,36,28,.82)";
  c.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  const range = r / k + 90;
  for (const t of L.tileList) {
    if (Math.abs(t.cx - m.px) > range + 60 || Math.abs(t.cz - m.pz) > range + 60) continue;
    for (const rr of t.road) {
      c.fillStyle = rr.surface === "concrete" ? (t.kind === "plaza" ? "#c9b98a" : "#8f918c") : t.kind === "highway" || t.kind === "bridge" ? "#7d8696" : "#6c7178";
      c.beginPath();
      c.moveTo(sx(rr.x0, rr.z0), sy(rr.x0, rr.z0));
      c.lineTo(sx(rr.x1, rr.z0), sy(rr.x1, rr.z0));
      c.lineTo(sx(rr.x1, rr.z1), sy(rr.x1, rr.z1));
      c.lineTo(sx(rr.x0, rr.z1), sy(rr.x0, rr.z1));
      c.closePath();
      c.fill();
    }
  }
  // route
  if (m.route.length > 1) {
    c.strokeStyle = "#22d3ee";
    c.lineWidth = 3;
    c.lineJoin = "round";
    c.beginPath();
    m.route.forEach((p, i) => (i ? c.lineTo(sx(p.x, p.z), sy(p.x, p.z)) : c.moveTo(sx(p.x, p.z), sy(p.x, p.z))));
    c.stroke();
  }
  // landmarks
  for (const lm of L.landmarks) {
    const x = sx(lm.x, lm.z);
    const y = sy(lm.x, lm.z);
    if (Math.hypot(x - cx, y - cy) > r + 4) continue;
    c.fillStyle = lm.id === "registon" ? "#ffd23f" : "#ffffff";
    c.beginPath();
    c.arc(x, y, 4, 0, TAU);
    c.fill();
  }
  // other cars
  c.fillStyle = "rgba(255,255,255,.55)";
  for (const a of m.cars) {
    const x = sx(a.x, a.z);
    const y = sy(a.x, a.z);
    if (Math.hypot(x - cx, y - cy) > r) continue;
    c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  // target
  if (m.target) {
    let x = sx(m.target.x, m.target.z);
    let y = sy(m.target.x, m.target.z);
    const d = Math.hypot(x - cx, y - cy);
    if (d > r - 8) {
      x = cx + ((x - cx) / d) * (r - 8);
      y = cy + ((y - cy) / d) * (r - 8);
    }
    const pulse = 1 + 0.25 * Math.sin(now / 160);
    c.strokeStyle = "#ffd23f";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, 7 * pulse, 0, TAU);
    c.stroke();
  }
  // player arrow
  c.fillStyle = "#ff5a6a";
  c.beginPath();
  c.moveTo(cx, cy - 9);
  c.lineTo(cx + 6, cy + 7);
  c.lineTo(cx, cy + 3);
  c.lineTo(cx - 6, cy + 7);
  c.closePath();
  c.fill();
  c.restore();
  c.strokeStyle = "rgba(255,255,255,.75)";
  c.lineWidth = 3;
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.stroke();
  // north marker
  const nx = cx + Math.sin(-ang) * (r - 8) * 1;
  const ny = cy - Math.cos(-ang) * (r - 8);
  drawText(c, "Sh", nx, ny, 11, "#ffd23f");
}

function drawGps(c: CanvasRenderingContext2D, x: number, y: number, m: HudModel, u: number): void {
  if (!m.target && m.route.length < 2) return;
  panel(c, x - 120 * u, y - 24 * u, 240 * u, 48 * u);
  c.save();
  c.translate(x - 84 * u, y);
  c.rotate(m.gpsAngle);
  c.fillStyle = "#22d3ee";
  c.beginPath();
  c.moveTo(0, -17 * u);
  c.lineTo(14 * u, 12 * u);
  c.lineTo(0, 5 * u);
  c.lineTo(-14 * u, 12 * u);
  c.closePath();
  c.fill();
  c.restore();
  const d = m.gpsDist;
  drawText(c, d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`, x - 20 * u, y - 7 * u, 19 * u, "#fff", "left");
  drawText(c, m.gpsName, x - 20 * u, y + 13 * u, 12 * u, "rgba(255,255,255,.75)", "left", 600);
}

function drawPanels(c: CanvasRenderingContext2D, x: number, y: number, m: HudModel, u: number): void {
  let yy = y;
  const w = 250 * u;
  if (m.mission) {
    panel(c, x, yy, w, 74 * u);
    drawText(c, m.mission.title, x + 10, yy + 18 * u, 13 * u, "#fff", "left", 700);
    drawText(c, m.mission.sub, x + 10, yy + 40 * u, 12 * u, "rgba(255,255,255,.8)", "left", 600);
    const t = Math.max(0, m.mission.timeLeft);
    drawText(c, `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`, x + 10, yy + 60 * u, 18 * u, t < 20 ? "#ff6b6b" : "#ffd23f", "left");
    yy += 82 * u;
  }
  if (m.exam) {
    panel(c, x, yy, w, 56 * u);
    drawText(c, "YHQ imtihoni", x + 10, yy + 16 * u, 13 * u, "#fff", "left", 700);
    const bad = m.exam.penalty > m.exam.limit;
    drawText(c, `Jarima ball: ${m.exam.penalty} / ${m.exam.limit}`, x + 10, yy + 38 * u, 16 * u, bad ? "#ff6b6b" : m.exam.penalty > 0 ? "#ffd23f" : "#34d399", "left");
    yy += 64 * u;
  }
  if (m.drift) {
    panel(c, x, yy, w, 86 * u);
    drawText(c, "DRIFT", x + 10, yy + 16 * u, 13 * u, "#ff9f43", "left", 800);
    drawText(c, `Jami: ${m.drift.total}`, x + 10, yy + 38 * u, 18 * u, "#fff", "left");
    const live = m.drift.drifting || m.drift.chain > 0;
    drawText(c, live ? `+${Math.round(m.drift.chain)}  ×${m.drift.combo}  ${Math.round(m.drift.angle)}°` : "Qo‘l tormozini torting", x + 10, yy + 62 * u, 15 * u, live ? "#34d399" : "rgba(255,255,255,.65)", "left");
    yy += 94 * u;
  }
}

function drawPicker(c: CanvasRenderingContext2D, W: number, H: number, m: HudModel): void {
  const p = m.picker!;
  const u = Math.max(0.7, Math.min(1.2, Math.min(W / 1280, H / 720)));
  const pw = Math.min(W - 40, 640 * u);
  const ph = (170 + p.options.length * 52) * u;
  const x = W / 2 - pw / 2;
  const y = H / 2 - ph / 2 - 20 * u;
  panel(c, x, y, pw, ph, 0.78);
  drawText(c, `Mashina haydash — ${p.index + 1}/${p.count}`, W / 2, y + 26 * u, 14 * u, "#ffd23f");
  drawText(c, STEP_TITLE[p.step], W / 2, y + 60 * u, 28 * u, "#fff");
  p.options.forEach((o, i) => {
    const oy = y + 100 * u + i * 52 * u;
    const sel = i === p.selected;
    c.save();
    c.fillStyle = sel ? "rgba(34,211,238,.28)" : "rgba(255,255,255,.06)";
    c.beginPath();
    c.roundRect(x + 24 * u, oy - 20 * u, pw - 48 * u, 44 * u, 10);
    c.fill();
    if (sel) {
      c.strokeStyle = "#22d3ee";
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    if (p.step === "color") {
      c.fillStyle = o;
      c.beginPath();
      c.arc(x + 56 * u, oy + 2 * u, 14 * u, 0, TAU);
      c.fill();
      drawText(c, `${i + 1}-rang`, x + 84 * u, oy + 2 * u, 18 * u, "#fff", "left", 700);
    } else {
      drawText(c, o, x + 44 * u, oy + 2 * u, 20 * u, "#fff", "left", 700);
      if (p.subs[i]) drawText(c, p.subs[i], x + pw - 40 * u, oy + 2 * u, 12 * u, "rgba(255,255,255,.7)", "right", 600);
    }
  });
  drawText(c, "Chap tizza — keyingisi   ·   O‘ng tizza (ushlab turing) — tasdiqlash", W / 2, y + ph - 40 * u, 13 * u, "rgba(255,255,255,.85)", "center", 600);
  drawText(c, "Klaviatura: ←/→ yoki Tab — keyingisi, Enter yoki ↑ — tasdiqlash, 1–4 — rejim", W / 2, y + ph - 18 * u, 12 * u, "rgba(255,255,255,.6)", "center", 600);
}
