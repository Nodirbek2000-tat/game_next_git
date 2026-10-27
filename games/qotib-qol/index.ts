// "Qotib qol!" (musical statues) for the Bog‘cha (3-6 yosh) section, built on the kids kit (games/bogcha/README.md).
// Music plays -> children dance (movement energy fills a meter -> stars, notes fly); the music stops suddenly with a
// "freeze" sting + a big snowflake -> everybody who stays calm for ~2 s becomes an ice figure with a star; the ones who still
// moved only get a friendly wobble and "Yana urinib ko‘ramiz!". No losing, no reading needed, 2D only, nothing allocated per frame.
import { defineKidsGame, starPath, type KidSlot } from "@/games/bogcha/common";
import { DEFAULT_CFG, FreezeRound, PLAYLIST, SLOTS, hasBit } from "./rules";

const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const TAU = Math.PI * 2;
const NP = 22;
const DISCO = ["#ff6ec7", "#ffd23d", "#5ad1ff", "#7dff8a", "#b184ff", "#ff9f5a"] as const;
const TRY_AGAIN = "Yana urinib ko‘ramiz!";

/** scratch rectangle of a child's body (reused, no allocation) */
const box = { cx: 0, cy: 0, rx: 0, ry: 0, top: 0, headY: 0, R: 0 };

function bodyBox(k: KidSlot): void {
  const P = k.pts;
  const sc = Math.max(24, k.scale);
  const R = Math.max(14, k.headR * 1.35);
  const headOk = P.head.v >= 0.25;
  const hy = headOk ? P.head.y : k.center.y - sc * 2;
  const top = hy - R * 1.7;
  let bot: number;
  if (P.la.v >= 0.25 || P.ra.v >= 0.25) bot = Math.max(P.la.v >= 0.25 ? P.la.y : 0, P.ra.v >= 0.25 ? P.ra.y : 0) + sc * 0.35;
  else if (P.lh.v >= 0.25 && P.rh.v >= 0.25) bot = (P.lh.y + P.rh.y) / 2 + sc * 1.8;
  else bot = hy + sc * 4;
  box.cx = headOk ? (P.head.x + k.center.x) / 2 : k.center.x;
  box.cy = (top + bot) / 2;
  box.ry = Math.max(sc, (bot - top) / 2);
  box.rx = sc * 1.3;
  box.top = top;
  box.headY = hy;
  box.R = R;
}

export default defineKidsGame({
  slug: "qotib-qol",
  roundSec: 75,
  maxKids: 5,
  music: null, // this game starts / stops the music itself
  dim: 0.45,
  create(kit) {
    const q = kit.engine.query;
    // ?dance=<seconds> fixes the dance length (tests); ?debug=1 exposes window.__qotib
    const fix = Number(q.get("dance"));
    const round = new FreezeRound(fix > 0 ? { ...DEFAULT_CFG, danceMin: fix, danceMax: fix, firstDanceMin: fix } : DEFAULT_CFG);
    const present = new Uint8Array(SLOTS);
    const energy = new Float32Array(SLOTS);
    let started = false;
    let songIdx = 0;
    let cur = PLAYLIST[0];
    let sayT = 0;
    let tries = 0;

    // pooled music notes
    const px = new Float32Array(NP);
    const py = new Float32Array(NP);
    const pvx = new Float32Array(NP);
    const pvy = new Float32Array(NP);
    const pl = new Float32Array(NP); // life 1 -> 0
    const pc = new Uint8Array(NP);
    const pg = new Uint8Array(NP);
    const spawnAcc = new Float32Array(SLOTS);
    let pn = 0;

    const spawn = (k: KidSlot): void => {
      const i = pn++ % NP;
      px[i] = k.pts.head.x + (Math.random() - 0.5) * k.scale * 1.6;
      py[i] = k.pts.head.y - k.headR * 1.6;
      pvx[i] = (Math.random() - 0.5) * 70;
      pvy[i] = -(70 + Math.random() * 70);
      pl[i] = 1;
      pc[i] = k.slot;
      pg[i] = Math.random() < 0.5 ? 0 : 1;
    };

    const playSong = (): void => {
      cur = PLAYLIST[songIdx++ % PLAYLIST.length];
      kit.music.play(cur.song, cur.tempo);
    };

    const banner = (text: string, icon: string, ms: number): void => {
      const b = kit.voice.banner;
      b.text = text;
      b.icon = icon;
      b.until = performance.now() + ms;
      kit.sfx.attention();
    };

    // layout-dependent fonts (rebuilt only when the stage size changes)
    let lw = 0;
    let lh = 0;
    let fBig = "";
    let fNote = "";
    let fSnow = "";
    const layout = (w: number, h: number): void => {
      lw = w;
      lh = h;
      fBig = `${Math.round(h * 0.34)}px ${EMOJI}`;
      fNote = `800 ${Math.round(Math.max(22, h * 0.055))}px system-ui, sans-serif`;
      fSnow = `${Math.round(Math.max(18, h * 0.045))}px ${EMOJI}`;
    };

    if (typeof window !== "undefined" && q.get("debug")) {
      (window as unknown as { __qotib?: unknown }).__qotib = {
        get phase() {
          return round.phase;
        },
        get cycle() {
          return round.cycle;
        },
        get doneMask() {
          return round.doneMask;
        },
        get triedMask() {
          return round.triedMask;
        },
        get tries() {
          return tries;
        },
        perKid: () => Array.from(kit.perKid),
      };
    }

    return {
      onStart() {
        // also called when the game resumes after a pause: do not restart the schedule then
        if (!started) {
          started = true;
          playSong();
          kit.voice.say("dance", 2400);
        } else if (round.phase === "dance") kit.music.play(cur.song, cur.tempo);
      },

      update(dt) {
        const kids = kit.kids;
        for (let i = 0; i < SLOTS; i++) {
          const k = kids[i];
          const here = k.active && k.present;
          present[i] = here ? 1 : 0;
          energy[i] = k.signals.energy;
        }
        round.update(dt, kit.timeLeft, present, energy);
        const ev = round.ev;

        if (ev.froze) {
          kit.music.stop(); // suddenly
          kit.sfx.sting();
          sayT = 0.45; // the voice / banner follows right after the sting
        }
        if (sayT > 0) {
          sayT -= dt;
          if (sayT <= 0) kit.voice.say("freeze", 3200);
        }
        if (ev.starMask) for (let i = 0; i < SLOTS; i++) if (hasBit(ev.starMask, i)) kit.award(kids[i], 1);
        if (ev.danceMask) for (let i = 0; i < SLOTS; i++) if (hasBit(ev.danceMask, i)) kit.award(kids[i], 1);
        if (ev.thawed) {
          if (round.triedMask) {
            tries++;
            banner(TRY_AGAIN, "💪", 2400);
          } else if (round.doneMask) kit.voice.say("bravo", 2200);
        }
        if (ev.danced) {
          playSong();
          kit.voice.say("dance", 2200);
        }

        // music notes: lively dancers throw them
        if (round.phase === "dance") {
          for (let i = 0; i < SLOTS; i++) {
            if (!present[i]) continue;
            spawnAcc[i] += Math.min(3, energy[i]) * dt * 1.6;
            if (spawnAcc[i] >= 1) {
              spawnAcc[i] = 0;
              spawn(kids[i]);
            }
          }
        }
        for (let i = 0; i < NP; i++) {
          if (pl[i] <= 0) continue;
          pl[i] -= dt * 0.85;
          px[i] += pvx[i] * dt;
          py[i] += pvy[i] * dt;
        }
      },

      drawBack(ctx, now) {
        const { w, h } = kit.stage;
        if (w !== lw || h !== lh) layout(w, h);
        const ph = round.phase;
        const ice = ph === "freeze" ? Math.min(1, round.t / 0.4) : ph === "result" ? Math.max(0, 1 - round.t / round.cfg.resultSec) : 0;
        // disco circles (sunny, bobbing) fade out while the ice tint fades in
        if (ice < 1) {
          const beat = 0.5 + 0.5 * Math.sin(now * 0.011);
          ctx.globalAlpha = 0.17 * (1 - ice);
          for (let i = 0; i < DISCO.length; i++) {
            const r = h * (0.13 + 0.015 * i) * (1 + 0.1 * beat);
            ctx.fillStyle = DISCO[i];
            ctx.beginPath();
            ctx.arc(w * (0.1 + 0.16 * i) + Math.sin(now * 0.0007 + i * 1.7) * w * 0.04, h * (0.3 + 0.4 * ((i * 0.37) % 1)) + Math.cos(now * 0.0009 + i) * h * 0.04, r, 0, TAU);
            ctx.fill();
          }
        }
        if (ice > 0) {
          ctx.globalAlpha = 0.3 * ice;
          ctx.fillStyle = "#9bdcff";
          ctx.fillRect(0, 0, w, h);
        }
        // pulsing aura behind every dancing child
        if (ph === "dance") {
          for (let i = 0; i < SLOTS; i++) {
            const k = kit.kids[i];
            if (!present[i]) continue;
            const e = Math.min(3, k.signals.energy);
            const a = Math.min(0.4, 0.08 + e * 0.1);
            ctx.globalAlpha = a;
            ctx.fillStyle = k.color;
            ctx.beginPath();
            ctx.arc(k.center.x, k.center.y, k.scale * (2.1 + e * 0.12 + 0.2 * Math.sin(now * 0.013 + i * 2)), 0, TAU);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      },

      drawFront(ctx, now) {
        const { w, h } = kit.stage;
        if (w !== lw || h !== lh) layout(w, h);
        const ph = round.phase;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // music notes
        ctx.font = fNote;
        for (let i = 0; i < NP; i++) {
          if (pl[i] <= 0) continue;
          ctx.globalAlpha = Math.min(1, pl[i] * 1.6);
          ctx.fillStyle = kit.kids[pc[i]].color;
          ctx.fillText(pg[i] ? "♫" : "♪", px[i], py[i]);
        }
        ctx.globalAlpha = 1;

        // per child: progress ring, ice figure + star, wobble
        for (let i = 0; i < SLOTS; i++) {
          if (!present[i] || ph === "dance") continue;
          const k = kit.kids[i];
          bodyBox(k);
          if (hasBit(round.doneMask, i)) {
            const age = ph === "freeze" ? round.t - round.doneAt[i] : 9;
            const pop = Math.min(1, age / 0.35);
            const melt = ph === "result" ? 1 - (round.t / round.cfg.resultSec) * 0.75 : 1;
            ctx.globalAlpha = pop * melt;
            ctx.fillStyle = "rgba(200,238,255,.42)";
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.ellipse(box.cx, box.cy, box.rx * (0.8 + 0.2 * pop), box.ry * (0.8 + 0.2 * pop), 0, 0, TAU);
            ctx.fill();
            ctx.stroke();
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(box.cx, box.cy, box.rx * 0.82, Math.PI * 1.05, Math.PI * 1.4);
            ctx.stroke();
            ctx.font = fSnow;
            ctx.fillStyle = "#000";
            ctx.fillText("❄️", box.cx - box.rx * 0.95, box.cy - box.ry * 0.35 + Math.sin(now * 0.006 + i) * 5);
            ctx.fillText("❄️", box.cx + box.rx * 0.9, box.cy + box.ry * 0.2 + Math.cos(now * 0.005 + i) * 5);
            // the star spins above the head
            const sr = box.R * 0.95 * (0.4 + 0.6 * pop);
            ctx.save();
            ctx.translate(box.cx, Math.max(h * 0.15 + sr, box.headY - box.R * 2.3) + Math.sin(now * 0.007 + i) * 4);
            ctx.rotate(Math.sin(now * 0.004 + i) * 0.25);
            starPath(ctx, 0, 0, sr);
            ctx.fillStyle = "#ffd23d";
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#ff9f1c";
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 1;
          } else if (ph === "freeze") {
            const g = round.gates[i];
            if (g.progress > 0.03) {
              // a ring fills while the child stays calm
              ctx.lineWidth = 8;
              ctx.lineCap = "round";
              ctx.strokeStyle = "rgba(255,255,255,.55)";
              ctx.beginPath();
              ctx.arc(box.cx, box.headY, box.R * 1.7, 0, TAU);
              ctx.stroke();
              ctx.strokeStyle = k.color;
              ctx.beginPath();
              ctx.arc(box.cx, box.headY, box.R * 1.7, -Math.PI / 2, -Math.PI / 2 + TAU * g.progress);
              ctx.stroke();
            }
          } else if (ph === "result" && hasBit(round.triedMask, i)) {
            // friendly wobble: a jelly ring around the child
            const fade = 1 - (round.t / round.cfg.resultSec) * 0.6;
            ctx.globalAlpha = 0.85 * fade;
            ctx.strokeStyle = k.color;
            ctx.lineWidth = 7;
            ctx.beginPath();
            for (let s = 0; s <= 24; s++) {
              const a = (s / 24) * TAU;
              const m = 1.1 + 0.08 * Math.sin(a * 3 + now * 0.016) + 0.04 * Math.sin(a * 5 - now * 0.011);
              const x = box.cx + Math.cos(a) * box.rx * m;
              const y = box.cy + Math.sin(a) * box.ry * m;
              if (s === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        // the big snowflake when the music stops
        if (ph === "freeze" && round.t < 2) {
          const t = round.t;
          const pop = t < 0.25 ? t / 0.25 : 1;
          const s = 0.5 + 0.5 * pop + 0.06 * Math.sin(t * 9);
          ctx.globalAlpha = t < 1.4 ? 1 : Math.max(0, 1 - (t - 1.4) / 0.6);
          ctx.save();
          ctx.translate(w / 2, h * 0.56);
          ctx.scale(s, s);
          ctx.rotate(Math.sin(t * 5) * 0.08);
          ctx.font = fBig;
          ctx.fillStyle = "#000";
          ctx.fillText("❄️", 0, 0);
          ctx.restore();
          ctx.globalAlpha = 1;
        } else if (ph === "dance") {
          // a small bouncing note: "the music is on"
          ctx.font = fSnow;
          ctx.fillStyle = "#000";
          ctx.fillText("🎵", w / 2, h * 0.93 - Math.abs(Math.sin(now * 0.008)) * h * 0.03);
        }
      },

      dispose() {
        if (typeof window !== "undefined") delete (window as unknown as { __qotib?: unknown }).__qotib;
      },
    };
  },
});
