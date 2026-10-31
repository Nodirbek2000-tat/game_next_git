// 2D overlay of "Baliq ovi": float markers, tension / reel gauges, hints, the catch card, partner prompts, the mode lobby
// and the encyclopedia screen. Drawn on the engine's fx canvas (CSS px). No allocations except tiny strings.

import type { EngineApi } from "@/engine";
import { drawRingProgress, drawText } from "@/engine/fx/fx2d";
import type { Angler } from "./angler";
import type { BaliqRig } from "./game";
import { collectionRects, lobbyRects, optionRects } from "./layout";
import { FOV } from "./view";
import { VOICE_PLAY_AVAILABLE } from "./playMode";
import { clamp, TUNING } from "./rules";
import { SPECIES } from "./species";
import { drawFishIcon } from "./textures";

const TAU = Math.PI * 2;
const COL = ["#2fa8ff", "#ffc83d"];
const pt = { x: 0, y: 0 };

function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string): void {
  c.save();
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.stroke();
  }
  c.restore();
}

/** Wrap text into lines no wider than maxW. */
function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const t = line ? `${line} ${word}` : word;
    if (c.measureText(t).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** an arrow on the screen edge that points to something outside the view (the player turns the head to follow it) */
function drawEdgeArrow(rig: BaliqRig, c: CanvasRenderingContext2D, bearing: number, label: string, col: string, now: number): void {
  const { w, h } = rig.ui;
  const right = bearing > 0;
  const x = right ? w - 46 : 46;
  const pulse = 0.65 + 0.35 * Math.sin(now / 160);
  c.save();
  c.globalAlpha = pulse;
  c.fillStyle = col;
  c.strokeStyle = "rgba(0,0,0,.55)";
  c.lineWidth = 3;
  c.beginPath();
  const y = h * 0.5;
  const d = right ? 1 : -1;
  c.moveTo(x + d * 22, y);
  c.lineTo(x - d * 14, y - 24);
  c.lineTo(x - d * 14, y + 24);
  c.closePath();
  c.stroke();
  c.fill();
  c.restore();
  drawText(c, label, x - d * 4, y + 48, 15, col);
}

function halfFov(rig: BaliqRig): number {
  const aspect = rig.ui.w / Math.max(1, rig.ui.h);
  return Math.atan(Math.tan((FOV * Math.PI) / 360) * aspect);
}

function sideX(rig: BaliqRig, a: Angler): number {
  return rig.anglers.length === 2 ? rig.ui.w * (a.slot === 0 ? 0.25 : 0.75) : rig.ui.w * 0.5;
}

function hint(a: Angler, rig: BaliqRig): string {
  const pf = rig.engine.players[a.slot];
  const two = rig.anglers.length === 2;
  const hand = pf?.dominant === "L" ? "Chap" : "O‘ng";
  const reel = pf?.dominant === "L" ? "o‘ng" : "chap";
  switch (a.state) {
    case "ready":
      if (voiceOn(rig, a)) return rig.voiceIn?.status === "loudness" ? "Ketma-ket 2–3 marta baqiring — qarmoq uchadi!" : "«Fish! Fish! Fish!» deng — qarmoq uchadi";
      if (a.sig.armed) return "Endi oldinga kuchli siltang!";
      return two ? `${hand} qo‘lni ko‘tarib, oldinga siltang` : `${hand} qo‘lni yelkadan yuqori ko‘taring, keyin oldinga siltang — kuchli silkitsangiz uzoqqa uchadi`;
    case "wait":
      return two ? "Kuting… poplavokni kuzating" : `Kuting… poplavokni kuzating (qaytarish: ${reel} qo‘l bilan aylantiring)`;
    case "nibble":
      return "Cho‘qilayapti… hali emas!";
    case "bite":
      if (voiceOn(rig, a)) return "HOZIR! «Pull!» deng";
      return rig.engine.kids ? "HOZIR! Ilintiraman…" : "HOZIR! Qo‘lni keskin tepaga torting!";
    case "fight":
      if (a.fight && a.fight.pullDir !== 0 && !rig.engine.kids) {
        if (a.fight.counter > 0.5) return "Yaxshi! Qo‘lni shunday ushlab turing";
        return `Baliq ${a.fight.pullDir < 0 ? "chapga" : "o‘ngga"} tortyapti — qo‘lni ${a.fight.pullDir < 0 ? "o‘ngga" : "chapga"} suring!`;
      }
      if (voiceOn(rig, a)) return "«Pull! Pull!» deng — baliqni tortamiz";
      return two ? `${reel[0].toUpperCase()}${reel.slice(1)} qo‘l — doira, ${hand} qo‘l — torting` : `${reel[0].toUpperCase()}${reel.slice(1)} qo‘l bilan doira chizing · ${hand} qo‘l bilan torting · Qizilda to‘xtang!`;
    default:
      return "";
  }
}

function voiceOn(rig: BaliqRig, a: Angler): boolean {
  const st = rig.voiceIn?.status;
  return a.slot === 0 && rig.anglers.length === 1 && (st === "keywords" || st === "loudness");
}

const REACT: Record<string, string> = { wait: "", nibble: "👀", bite: "😮", fight: "😤", show: "😄" };

/**
 * Which way the fish pulls and how hard (red bar from the middle), and where the rod hand is (dot; green while it counters the
 * pull). To calm the fish the dot goes to the other side of the bar. Kids see only the fish's pull.
 */
function drawPullCue(c: CanvasRenderingContext2D, a: Angler, f: NonNullable<Angler["fight"]>, cx: number, y: number, two: boolean, kids: boolean): void {
  const hw = two ? 80 : 120;
  panel(c, cx - hw - 16, y - 16, hw * 2 + 32, 32, 16, "rgba(0,0,0,.4)");
  c.save();
  c.fillStyle = "rgba(255,255,255,.25)";
  c.fillRect(cx - hw, y - 2, hw * 2, 4);
  c.fillRect(cx - 1.5, y - 10, 3, 20);
  if (f.run && f.runDir !== 0 && f.surge > 0.03) {
    const len = hw * clamp(f.surge, 0, 1);
    const d = f.runDir;
    c.fillStyle = "#ff5a4a";
    c.fillRect(d > 0 ? cx : cx - len, y - 6, len, 12);
    c.beginPath();
    c.moveTo(cx + d * (len + 12), y);
    c.lineTo(cx + d * len, y - 11);
    c.lineTo(cx + d * len, y + 11);
    c.closePath();
    c.fill();
  }
  if (!kids) {
    c.fillStyle = f.counter > 0.5 ? "#34d399" : "#ffffff";
    c.strokeStyle = "rgba(0,0,0,.55)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx + clamp(a.steer, -1, 1) * hw, y, 8, 0, TAU);
    c.fill();
    c.stroke();
  }
  c.restore();
}

function drawAngler(rig: BaliqRig, c: CanvasRenderingContext2D, a: Angler, now: number): void {
  const { w, h } = rig.ui;
  const two = rig.anglers.length === 2;
  const cx = sideX(rig, a);
  const col = COL[a.slot];
  const st = a.state;

  // float marker (the float is small and far away); outside the view: an arrow on the edge
  if (st === "wait" || st === "nibble" || st === "bite" || st === "fight") {
    const b = rig.bearing(a.fx, a.fz);
    const kids = rig.engine.kids;
    if (Math.abs(b) > halfFov(rig) * 0.94) {
      drawEdgeArrow(rig, c, b, st === "fight" ? (kids ? "Baliq" : "Baliq!") : "Poplavok", st === "bite" ? "#ff5a5a" : col, now);
    } else if (rig.project(a.fx, a.fy + 0.1, a.fz, pt)) {
      const bite = st === "bite";
      const hot = st === "fight" && a.strain > 0.85;
      const rad = (kids ? 34 : 22) * (st === "fight" ? 1.2 : 1);
      c.save();
      c.strokeStyle = bite || hot ? "#ff3b3b" : col;
      c.lineWidth = kids ? 4 : 2.5;
      c.globalAlpha = bite ? 0.5 + Math.sin(now / 60) * 0.5 : 0.75;
      c.beginPath();
      c.arc(pt.x, pt.y, rad, 0, TAU);
      c.stroke();
      c.restore();
      if (bite) drawText(c, "!", pt.x, pt.y - rad - 18, 40, "#ff3b3b");
      if (kids) {
        const jump = a.fight && a.fight.jumpT > 0;
        const em = jump ? "🤩" : REACT[st];
        if (em) drawText(c, em, pt.x, pt.y - rad - (bite ? 56 : 20), 34, "#fff");
      }
    }
  }

  // hint
  const tip = hint(a, rig);
  if (tip) drawText(c, tip, cx, h - 96, st === "bite" ? 28 : two ? 17 : 21, st === "bite" ? "#ff5a6a" : "#fff");

  // message
  if (a.msgT > 0 && a.msg) {
    c.save();
    c.globalAlpha = Math.min(1, a.msgT * 2);
    drawText(c, a.msg, cx, h * 0.2, two ? 24 : 30, "#ffe66d");
    c.restore();
  }

  // fight gauges
  if (st === "fight" && a.fight) {
    const f = a.fight;
    const gx = two ? (a.slot === 0 ? 56 : w - 56) : w - 70;
    const y0 = h * 0.43;
    const hh = h * 0.33;
    const T = Math.min(1.15, f.T / f.limit);
    panel(c, gx - 22, y0 - 12, 44, hh + 24, 12, "rgba(0,0,0,.45)");
    const g = c.createLinearGradient(0, y0 + hh, 0, y0);
    g.addColorStop(0, "#34d399");
    g.addColorStop(0.6, "#ffd23f");
    g.addColorStop(0.85, "#ff5a3a");
    g.addColorStop(1, "#ff1a3a");
    c.fillStyle = "rgba(255,255,255,.12)";
    c.fillRect(gx - 10, y0, 20, hh);
    c.fillStyle = g;
    const fh = hh * Math.min(1, T);
    c.fillRect(gx - 10, y0 + hh - fh, 20, fh);
    if (T > 0.85 && Math.sin(now / 70) > 0) {
      c.strokeStyle = "#ff1a3a";
      c.lineWidth = 4;
      c.strokeRect(gx - 14, y0 - 4, 28, hh + 8);
    }
    drawText(c, "Taranglik", gx, y0 + hh + 28, 13, "#fff");
    drawText(c, `${f.D.toFixed(1)} m`, gx, y0 + hh + 52, 18, "#9fe8ff");
    // reel indicator
    const rx = two ? (a.slot === 0 ? 150 : w - 150) : 90;
    const ry = h * 0.56;
    const rr = 36;
    const k = Math.min(1, a.sig.crank / 2);
    c.save();
    c.strokeStyle = "rgba(255,255,255,.25)";
    c.lineWidth = 8;
    c.beginPath();
    c.arc(rx, ry, rr, 0, TAU);
    c.stroke();
    c.strokeStyle = a.sig.crank > 0.05 || !rig.engine.players[a.slot] ? "#22d3ee" : "#ff8a80";
    c.beginPath();
    c.arc(rx, ry, rr, a.reelAngle, a.reelAngle + TAU * Math.max(0.08, k));
    c.stroke();
    c.restore();
    drawText(c, "G‘altak", rx, ry + rr + 22, 13, "#fff");
    if (f.run) drawText(c, f.pullDir === 0 ? "Baliq tortyapti!" : f.pullDir < 0 ? "◀ Baliq chapga tortyapti!" : "Baliq o‘ngga tortyapti! ▶", cx, h * 0.3, two ? 20 : 26, "#ff8a80");
    if (f.run || !rig.engine.kids) drawPullCue(c, a, f, cx, h * 0.345, two, rig.engine.kids);
    if (f.jumpT > 0) drawText(c, "Sakradi!", cx, h * 0.41, 22, "#9fe8ff");
  }

  // caught card
  if (st === "show" && a.card) {
    const k = Math.min(1, a.stT / 0.4);
    const cw = two ? 330 : 400;
    const ch = 128;
    const x = cx - cw / 2;
    const y = h * 0.66;
    c.save();
    c.globalAlpha = k;
    panel(c, x, y, cw, ch, 18, "rgba(10,20,30,.8)", col);
    drawText(c, a.card.name + (a.card.isNew ? "  · Yangi tur!" : a.card.isRecord ? "  · Rekord!" : ""), cx, y + 30, 24, "#fff");
    drawText(c, `${a.card.weight.toFixed(2)} kg  ·  +${a.card.pts}`, cx, y + 66, 22, "#ffe66d");
    const m = a.card.friend ? "Do‘stlik bonusi!" : rig.engine.kids ? "😄 Rahmat! " + (a.card.msg || "Zo‘r ov!") : a.card.msg || "Zo‘r ov!";
    drawText(c, m, cx, y + 100, 16, "#9fe8ff");
    c.restore();
  }

  // partner prompts (co-op)
  const partner = rig.anglers[1 - a.slot];
  if (partner && rig.mode === "birgalikda" && partner.fighting) {
    if (partner.netOffer) {
      const pulse = 0.6 + 0.4 * Math.sin(now / 120);
      c.save();
      c.globalAlpha = pulse;
      panel(c, cx - 240, h * 0.34, 480, 74, 16, "rgba(20,60,40,.78)", "#34d399");
      drawText(c, "Sachok! Do‘stingizga yordam bering", cx, h * 0.34 + 26, 22, "#b8ffd8");
      drawText(c, "Ikki qo‘lni pastga tushirib, tepaga ko‘taring", cx, h * 0.34 + 54, 15, "#fff");
      c.restore();
    }
    if (partner.strain > 0.85) {
      c.save();
      c.globalAlpha = 0.22 + 0.18 * Math.sin(now / 80);
      const gx = a.slot === 0 ? 0 : w * 0.7;
      const g = c.createLinearGradient(gx, 0, gx + w * 0.3, 0);
      g.addColorStop(a.slot === 0 ? 0 : 1, "#ff2a2a");
      g.addColorStop(a.slot === 0 ? 1 : 0, "rgba(255,42,42,0)");
      c.fillStyle = g;
      c.fillRect(gx, 0, w * 0.3, h);
      c.restore();
      drawText(c, "Ehtiyot bo‘l!", cx, h * 0.47, 30, "#ff5a5a");
    }
  }
}

/** The two play modes: silent (selected, the only one that works now) and voice ("Tez orada", not selectable). */
function drawModeCards(rig: BaliqRig, c: CanvasRenderingContext2D): void {
  const [silent, voice] = optionRects(rig.ui.w, rig.ui.h).modes;
  panel(c, silent.x, silent.y, silent.w, silent.h, 18, "rgba(30,110,85,.55)", "#34d399");
  drawText(c, "✓ Ovozsiz o‘ynash", silent.x + silent.w / 2, silent.y + 28, 22, "#b8ffd8");
  c.save();
  c.font = "600 14px system-ui, sans-serif";
  c.fillStyle = "#dfeff6";
  c.textAlign = "center";
  wrap(c, "Qo‘l harakatlari bilan o‘ynaysiz: siltang, torting, aylantiring. Mikrofon kerak emas.", silent.w - 36).forEach((l, i) => c.fillText(l, silent.x + silent.w / 2, silent.y + 56 + i * 19));
  c.restore();
  panel(c, voice.x, voice.y, voice.w, voice.h, 18, "rgba(14,40,58,.6)", "rgba(255,255,255,.18)");
  c.save();
  c.globalAlpha = 0.6;
  drawText(c, "Ovoz bilan o‘ynash", voice.x + voice.w / 2, voice.y + 28, 22, "#fff");
  c.restore();
  panel(c, voice.x + voice.w / 2 - 50, voice.y + 48, 100, 28, 14, "rgba(255,200,60,.9)");
  drawText(c, "Tez orada", voice.x + voice.w / 2, voice.y + 62, 16, "#3a2a00");
  c.save();
  c.globalAlpha = 0.6;
  c.font = "600 14px system-ui, sans-serif";
  c.fillStyle = "#dfeff6";
  c.textAlign = "center";
  wrap(c, "Ovoz buyruqlari bilan o‘ynash keyinroq qo‘shiladi.", voice.w - 36).forEach((l, i) => c.fillText(l, voice.x + voice.w / 2, voice.y + 96 + i * 19));
  c.restore();
}

function drawOptions(rig: BaliqRig, c: CanvasRenderingContext2D, now: number): void {
  const { w, h } = rig.ui;
  const r = optionRects(w, h);
  c.save();
  c.fillStyle = "rgba(4,16,26,.62)";
  c.fillRect(0, 0, w, h);
  c.restore();
  panel(c, r.panel.x, r.panel.y, r.panel.w, r.panel.h, 26, "rgba(10,30,45,.9)", "rgba(255,255,255,.25)");
  drawText(c, "Baliq ovi", w / 2, h * 0.15, 38, "#fff");
  drawText(c, "Siz ko‘zingiz bilan ko‘ryapsiz: boshingizni burib atrofga qarang", w / 2, h * 0.215, 16, "#9fe8ff");
  c.save();
  c.font = "700 16px system-ui, sans-serif";
  c.fillStyle = "#dfeff6";
  c.textAlign = "center";
  const lines = ["O‘ng qo‘lni ko‘tarib, kuchli oldinga siltang — qarmoq uchadi (kuch = masofa)", "Poplavok cho‘ksa — qo‘lni tepaga torting · baliq yonga tortsa — qo‘lni qarshi tomonga suring", "Chap qo‘l bilan havoda doira chizing — g‘altak aylanadi", "Strelkalar ← → : qarash · A / D : nishon · E R F : klaviatura"];
  lines.forEach((l, i) => c.fillText(l, w / 2, h * 0.285 + i * 24));
  c.restore();
  if (!VOICE_PLAY_AVAILABLE) {
    drawModeCards(rig, c);
  } else if (rig.voiceOffered) {
    const on = rig.voiceWanted;
    const hov = rig.ui.hover === 0;
    panel(c, r.voice.x, r.voice.y, r.voice.w, r.voice.h, 18, hov ? "rgba(40,120,170,.85)" : "rgba(14,40,58,.9)", on ? "#34d399" : "rgba(255,255,255,.3)");
    drawText(c, `🎤 Ovoz bilan o‘ynash: ${on ? "YOQILGAN" : "o‘chiq"}  [V]`, w / 2, r.voice.y + 28, 24, on ? "#b8ffd8" : "#fff");
    c.save();
    c.font = "600 14px system-ui, sans-serif";
    c.fillStyle = "#dfeff6";
    c.textAlign = "center";
    const txt = "«fish fish fish» desangiz qarmoq uchadi, «pull pull» desangiz baliq tortiladi. Ovoz faqat shu qurilmaning o‘zida taniladi va hech qayerga yuborilmaydi. Mikrofon faqat shu tugma yoqilganda, o‘yin boshlanganda so‘raladi. Taniy olmasa — baland ovozda ketma-ket baqiring.";
    wrap(c, txt, r.voice.w - 40).forEach((l, i) => c.fillText(l, w / 2, r.voice.y + 56 + i * 19));
    c.restore();
    if (hov) drawRingProgress(c, r.voice.x + r.voice.w - 30, r.voice.y + 28, 16, rig.ui.prog, "#22d3ee");
  } else {
    drawText(c, "Ovoz bilan o‘ynash faqat bir o‘yinchi rejimida mavjud", w / 2, r.voice.y + 30, 17, "#9fe8ff");
  }
  const s = r.start;
  const sh = rig.ui.hover === 1;
  const pulse = 0.85 + 0.15 * Math.sin(now / 200);
  panel(c, s.x, s.y, s.w, s.h, 18, sh ? "rgba(40,150,110,.95)" : `rgba(30,120,90,${pulse})`, "#34d399");
  drawText(c, "Boshlash (Enter)", s.x + s.w / 2, s.y + s.h / 2, 26, "#fff");
  if (sh) drawRingProgress(c, s.x + s.w + 34, s.y + s.h / 2, 18, rig.ui.prog, "#34d399");
}

function drawVoiceBadge(rig: BaliqRig, c: CanvasRenderingContext2D): void {
  const v = rig.voiceIn;
  if (!v || !v.label) return;
  const { h } = rig.ui;
  const x = 18;
  const y = h - 150;
  panel(c, x, y, 330, 38, 12, "rgba(0,0,0,.45)");
  drawText(c, v.label, x + 165, y + 19, 13, v.status === "denied" || v.status === "unavailable" ? "#ff8a80" : "#b8ffd8");
  if (v.status === "loudness") {
    c.save();
    c.fillStyle = "rgba(255,255,255,.18)";
    c.fillRect(x + 12, y + 31, 306, 4);
    c.fillStyle = v.level > v.shouts.threshold * 3 ? "#ffd23f" : "#34d399";
    c.fillRect(x + 12, y + 31, 306 * Math.min(1, v.level), 4);
    c.restore();
  }
}

function drawLobby(rig: BaliqRig, c: CanvasRenderingContext2D): void {
  const { w, h } = rig.ui;
  c.save();
  c.fillStyle = "rgba(4,16,26,.55)";
  c.fillRect(0, 0, w, h);
  c.restore();
  drawText(c, "O‘yin rejimini tanlang", w / 2, h * 0.12, 38, "#fff");
  drawText(c, "Qo‘lingizni kartochka ustida ushlab turing yoki 1 / 2 tugmasini bosing", w / 2, h * 0.19, 17, "#9fe8ff");
  const r = lobbyRects(w, h);
  const items = [
    { t: "Birgalikda", sub: "Umumiy savat va umumiy maqsad", d: `Birgalikda ${rig.goalKg} kg baliq tuting. Do‘stingizning baliqqa sachok bilan yordam bering — Do‘stlik bonusi!`, key: "1" },
    { t: "Musobaqa", sub: `${Math.round((rig.duration || TUNING.duelSeconds) / 60 * 10) / 10} daqiqa`, d: "Kim og‘irroq baliq tutsa, o‘sha g‘olib. Oxirida g‘olib e‘lon qilinadi.", key: "2" },
  ];
  items.forEach((it, i) => {
    const hov = rig.ui.hover === i;
    panel(c, r[i].x, r[i].y, r[i].w, r[i].h, 22, hov ? "rgba(40,120,170,.85)" : "rgba(10,30,45,.82)", hov ? "#22d3ee" : "rgba(255,255,255,.25)");
    drawText(c, it.t, r[i].x + r[i].w / 2, r[i].y + 52, 36, "#fff");
    drawText(c, it.sub, r[i].x + r[i].w / 2, r[i].y + 92, 18, "#ffe66d");
    c.save();
    c.font = "700 17px system-ui, sans-serif";
    c.fillStyle = "#dfeff6";
    c.textAlign = "center";
    const lines = wrap(c, it.d, r[i].w - 50);
    lines.forEach((l, k) => c.fillText(l, r[i].x + r[i].w / 2, r[i].y + 140 + k * 24));
    c.restore();
    drawText(c, `[${it.key}]`, r[i].x + r[i].w - 30, r[i].y + r[i].h - 22, 16, "rgba(255,255,255,.5)");
    if (hov) drawRingProgress(c, r[i].x + r[i].w / 2, r[i].y + r[i].h - 34, 22, rig.ui.prog, "#22d3ee");
  });
}

function drawCollection(rig: BaliqRig, c: CanvasRenderingContext2D, now: number): void {
  void now;
  const { w, h } = rig.ui;
  c.save();
  c.fillStyle = "rgba(4,16,26,.78)";
  c.fillRect(0, 0, w, h);
  c.restore();
  const r = collectionRects(w, h);
  drawText(c, "Baliq ensiklopediyasi", w / 2, h * 0.07, 34, "#fff");
  drawText(c, `Kolleksiya: ${SPECIES.filter((s) => rig.collection[s.id]).length} / ${SPECIES.length} · Yangi turlar: ${rig.newSpecies}`, w / 2, h * 0.135, 16, "#9fe8ff");
  SPECIES.forEach((s, i) => {
    const e = rig.collection[s.id];
    const sel = rig.ui.sel === i;
    const rc = r.cards[i];
    panel(c, rc.x, rc.y, rc.w, rc.h, 14, sel ? "rgba(40,120,170,.85)" : "rgba(12,32,48,.85)", sel ? "#22d3ee" : "rgba(255,255,255,.18)");
    drawFishIcon(c, s, rc.x + rc.w / 2, rc.y + rc.h * 0.4, rc.w * 0.72, !e);
    drawText(c, e ? s.name : "???", rc.x + rc.w / 2, rc.y + rc.h * 0.78, 13, e ? "#fff" : "#7a8b96");
    if (e) drawText(c, `${e.record.toFixed(1)} kg`, rc.x + rc.w / 2, rc.y + rc.h * 0.92, 11, "#ffe66d");
  });
  // info panel
  const sp = SPECIES[rig.ui.sel];
  const e = rig.collection[sp.id];
  panel(c, r.info.x, r.info.y, r.info.w, r.info.h, 18, "rgba(12,32,48,.9)", "rgba(255,255,255,.2)");
  drawFishIcon(c, sp, r.info.x + r.info.w / 2, r.info.y + r.info.h * 0.2, Math.min(88, r.info.w * 0.28), !e);
  drawText(c, e ? sp.name : "Hali tutilmagan", r.info.x + r.info.w / 2, r.info.y + r.info.h * 0.37, 22, "#fff");
  drawText(c, e ? `Rekord: ${e.record.toFixed(2)} kg · Tutilgan: ${e.count} ta` : `Og‘irligi: ${sp.w[0]}–${sp.w[1]} kg`, r.info.x + r.info.w / 2, r.info.y + r.info.h * 0.5, 14, "#ffe66d");
  c.save();
  c.font = "600 14px system-ui, sans-serif";
  c.fillStyle = "#dfeff6";
  c.textAlign = "center";
  const text = e || rig.engine.kids ? (rig.engine.kids ? sp.kids : sp.info) : "Bu turni tutib, ensiklopediyaga qo‘shing!";
  wrap(c, text, r.info.w - 36).forEach((l, i) => c.fillText(l, r.info.x + r.info.w / 2, r.info.y + r.info.h * 0.62 + i * 20));
  c.restore();
  // continue button
  const b = r.button;
  const hov = rig.ui.btnProg > 0;
  panel(c, b.x, b.y, b.w, b.h, 16, hov ? "rgba(40,120,170,.9)" : "rgba(20,70,110,.85)", "#22d3ee");
  drawText(c, "Davom etish (Enter)", b.x + b.w / 2, b.y + b.h / 2, 20, "#fff");
  if (hov) drawRingProgress(c, b.x + b.w + 30, b.y + b.h / 2, 18, rig.ui.btnProg, "#22d3ee");
}

export function drawOverlay(rig: BaliqRig, c: CanvasRenderingContext2D, e: EngineApi, now: number): void {
  void e;
  const { w, h } = rig.ui;
  if (rig.phase === "play" || rig.phase === "lobby") {
    for (const a of rig.anglers) drawAngler(rig, c, a, now);
  }
  if (rig.phase === "play" && rig.bonusText && rig.anglers.some((a) => a.card?.friend && a.state === "show")) {
    drawText(c, rig.bonusText, w / 2, h * 0.14, 40, "#34d399");
  }
  if (rig.phase === "play") drawVoiceBadge(rig, c);
  if (rig.phase === "options") drawOptions(rig, c, now);
  if (rig.phase === "lobby") drawLobby(rig, c);
  if (rig.phase === "collection") drawCollection(rig, c, now);
  if ((rig.phase === "lobby" || rig.phase === "collection" || rig.phase === "options") && rig.ui.pointer) {
    c.save();
    c.fillStyle = "rgba(255,255,255,.95)";
    c.strokeStyle = "rgba(0,0,0,.5)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(rig.ui.px, rig.ui.py, 11, 0, TAU);
    c.fill();
    c.stroke();
    c.restore();
  }
}
