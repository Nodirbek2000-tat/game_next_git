// Fitnes: the animated coach. A clean stick person shows every exercise in a loop (keyframes of 13 joints, eased in between),
// so nobody has to read how it is done. Pure drawing, no engine imports.
//
// Joint positions live in a unit box: x = -0.5..0.5 (0 = middle), y = 0 (top of the head) .. 1 (the floor). The figure faces the
// viewer (its right hand is on the screen's left, like a mirror); plank is drawn from the side.

import type { ExerciseId } from "@/lib/fitness/exercises";

type J = "h" | "sl" | "sr" | "el" | "er" | "wl" | "wr" | "hl" | "hr" | "kl" | "kr" | "al" | "ar";
type Pose = Record<J, [number, number]>;
type Key = Partial<Pose>;

const BASE: Pose = {
  h: [0, 0.09],
  sl: [-0.11, 0.21],
  sr: [0.11, 0.21],
  el: [-0.14, 0.36],
  er: [0.14, 0.36],
  wl: [-0.15, 0.5],
  wr: [0.15, 0.5],
  hl: [-0.075, 0.53],
  hr: [0.075, 0.53],
  kl: [-0.08, 0.76],
  kr: [0.08, 0.76],
  al: [-0.08, 0.98],
  ar: [0.08, 0.98],
};

const ARMS_UP: Key = { el: [-0.15, 0.07], er: [0.15, 0.07], wl: [-0.13, -0.06], wr: [0.13, -0.06] };
const HANDS_HEAD: Key = { el: [-0.2, 0.1], er: [0.2, 0.1], wl: [-0.06, 0.03], wr: [0.06, 0.03] };
const GUARD: Key = { el: [-0.12, 0.34], er: [0.12, 0.34], wl: [-0.06, 0.2], wr: [0.06, 0.2] };

/** shift the whole upper body (head, shoulders, arms) */
function upper(k: Key, dx: number, dy: number): Key {
  const out: Key = { ...k };
  for (const j of ["h", "sl", "sr", "el", "er", "wl", "wr"] as J[]) {
    const p = k[j] ?? BASE[j];
    out[j] = [p[0] + dx, p[1] + dy];
  }
  return out;
}

/** shift every joint */
function all(k: Key, dx: number, dy: number): Key {
  const out: Key = {};
  for (const j of Object.keys(BASE) as J[]) {
    const p = k[j] ?? BASE[j];
    out[j] = [p[0] + dx, p[1] + dy];
  }
  return out;
}

interface Anim {
  keys: Key[];
  /** seconds per key (move + short hold) */
  sec: number;
}

const SQUAT_LOW: Key = {
  ...upper({ el: [-0.13, 0.45], er: [0.13, 0.45], wl: [-0.07, 0.43], wr: [0.07, 0.43] }, 0, 0.15),
  hl: [-0.1, 0.69],
  hr: [0.1, 0.69],
  kl: [-0.19, 0.77],
  kr: [0.19, 0.77],
};

const PLANK: Key = {
  h: [-0.4, 0.58],
  sl: [-0.29, 0.64],
  sr: [-0.29, 0.64],
  el: [-0.29, 0.86],
  er: [-0.27, 0.86],
  wl: [-0.16, 0.88],
  wr: [-0.14, 0.88],
  hl: [0.03, 0.67],
  hr: [0.03, 0.67],
  kl: [0.22, 0.71],
  kr: [0.22, 0.71],
  al: [0.42, 0.76],
  ar: [0.42, 0.76],
};

const ANIM: Record<ExerciseId, Anim> = {
  squat: { keys: [{}, SQUAT_LOW], sec: 1.1 },
  lunge: {
    keys: [
      {},
      { ...upper({}, 0, 0.13), hl: [-0.07, 0.66], hr: [0.07, 0.66], kl: [-0.16, 0.8], al: [-0.13, 0.98], kr: [0.09, 0.9], ar: [0.12, 0.99] },
      {},
      { ...upper({}, 0, 0.13), hl: [-0.07, 0.66], hr: [0.07, 0.66], kr: [0.16, 0.8], ar: [0.13, 0.98], kl: [-0.09, 0.9], al: [-0.12, 0.99] },
    ],
    sec: 1.1,
  },
  jack: { keys: [{}, { ...ARMS_UP, kl: [-0.16, 0.76], kr: [0.16, 0.76], al: [-0.25, 0.98], ar: [0.25, 0.98] }], sec: 0.55 },
  knees: {
    keys: [
      { kl: [-0.09, 0.5], al: [-0.09, 0.72], el: [-0.17, 0.33], wl: [-0.12, 0.2], er: [0.16, 0.38], wr: [0.17, 0.52] },
      {},
      { kr: [0.09, 0.5], ar: [0.09, 0.72], er: [0.17, 0.33], wr: [0.12, 0.2], el: [-0.16, 0.38], wl: [-0.17, 0.52] },
      {},
    ],
    sec: 0.3,
  },
  boks: { keys: [GUARD, { ...GUARD, el: [-0.02, 0.25], wl: [0.12, 0.19] }, GUARD, { ...GUARD, er: [0.02, 0.25], wr: [-0.12, 0.19] }], sec: 0.4 },
  tepaga: { keys: [{ el: [-0.21, 0.31], er: [0.21, 0.31], wl: [-0.17, 0.18], wr: [0.17, 0.18] }, { el: [-0.14, 0.06], er: [0.14, 0.06], wl: [-0.1, -0.08], wr: [0.1, -0.08] }], sec: 0.9 },
  tirsak: {
    keys: [
      HANDS_HEAD,
      { ...upper({ ...HANDS_HEAD, er: [0.03, 0.42] }, 0.02, 0.05), kl: [0.0, 0.5], al: [-0.07, 0.72] },
      HANDS_HEAD,
      { ...upper({ ...HANDS_HEAD, el: [-0.03, 0.42] }, -0.02, 0.05), kr: [0.0, 0.5], ar: [0.07, 0.72] },
    ],
    sec: 0.55,
  },
  yonqadam: {
    keys: [
      all({ ...upper({}, 0, 0.06), hl: [-0.08, 0.58], hr: [0.08, 0.58], kl: [-0.16, 0.78], kr: [0.12, 0.78], al: [-0.2, 0.98], ar: [0.12, 0.98] }, -0.14, 0),
      all({ ...upper({}, 0, 0.06), hl: [-0.08, 0.58], hr: [0.08, 0.58], kl: [-0.12, 0.78], kr: [0.16, 0.78], al: [-0.12, 0.98], ar: [0.2, 0.98] }, 0.14, 0),
    ],
    sec: 0.7,
  },
  yonoyoq: {
    keys: [{}, { ...upper({}, 0.03, 0), kl: [-0.17, 0.74], al: [-0.29, 0.92], wl: [-0.2, 0.48] }, {}, { ...upper({}, -0.03, 0), kr: [0.17, 0.74], ar: [0.29, 0.92], wr: [0.2, 0.48] }],
    sec: 0.75,
  },
  plank: { keys: [PLANK, all(PLANK, 0, 0.008)], sec: 1.4 },
  daraxt: {
    keys: [
      { el: [-0.13, 0.33], er: [0.13, 0.33], wl: [-0.02, 0.33], wr: [0.02, 0.33], kr: [0.18, 0.66], ar: [0.01, 0.7] },
      { el: [-0.12, 0.05], er: [0.12, 0.05], wl: [-0.02, -0.07], wr: [0.02, -0.07], kr: [0.18, 0.66], ar: [0.01, 0.7] },
    ],
    sec: 1.6,
  },
  jangchi: {
    keys: [
      { al: [-0.3, 0.98], ar: [0.3, 0.98], kl: [-0.2, 0.77], kr: [0.2, 0.77] },
      {
        ...upper({ el: [-0.27, 0.22], er: [0.27, 0.22], wl: [-0.43, 0.22], wr: [0.43, 0.22] }, 0, 0.07),
        hl: [-0.07, 0.61],
        hr: [0.07, 0.61],
        kl: [-0.27, 0.74],
        kr: [0.19, 0.8],
        al: [-0.3, 0.98],
        ar: [0.31, 0.98],
      },
    ],
    sec: 1.6,
  },
  egilish: {
    keys: [
      ARMS_UP,
      { h: [-0.09, 0.11], sl: [-0.17, 0.25], sr: [0.05, 0.19], el: [-0.25, 0.13], er: [-0.04, 0.06], wl: [-0.28, 0.0], wr: [-0.13, -0.05] },
      ARMS_UP,
      { h: [0.09, 0.11], sr: [0.17, 0.25], sl: [-0.05, 0.19], er: [0.25, 0.13], el: [0.04, 0.06], wr: [0.28, 0.0], wl: [0.13, -0.05] },
    ],
    sec: 1.1,
  },
};

const ease = (t: number): number => t * t * (3 - 2 * t);

/** The coach's pose at time `t` (s): each key is reached in 60% of its slot, then held. */
export function demoPose(id: ExerciseId, t: number): Pose {
  const a = ANIM[id];
  const n = a.keys.length;
  const f = t / a.sec;
  const i = Math.floor(f) % n;
  const k = ease(Math.min(1, (f - Math.floor(f)) / 0.6));
  const from = a.keys[i];
  const to = a.keys[(i + 1) % n];
  const out = {} as Pose;
  for (const j of Object.keys(BASE) as J[]) {
    const p = from[j] ?? BASE[j];
    const q = to[j] ?? BASE[j];
    out[j] = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  }
  return out;
}

const LIMBS: [J, J][] = [
  ["sl", "el"],
  ["el", "wl"],
  ["sr", "er"],
  ["er", "wr"],
  ["hl", "kl"],
  ["kl", "al"],
  ["hr", "kr"],
  ["kr", "ar"],
];

/**
 * Draws the coach doing `id` in a rounded panel of `size` px (square) with its top-left at (x, y). `label` goes on top
 * of the panel (null = none).
 */
export function drawCoach(c: CanvasRenderingContext2D, id: ExerciseId, t: number, x: number, y: number, size: number, label: string | null, color = "#5eead4"): void {
  const p = demoPose(id, t);
  // the figure is 0.7 of the panel tall; room above it for the label and for hands raised over the head
  const s = size * 0.7;
  const X = (v: number): number => x + size / 2 + v * s * 1.05;
  const Y = (v: number): number => y + size * (label ? 0.2 : 0.16) + v * s;
  c.save();
  // panel
  c.fillStyle = "rgba(8,10,22,.62)";
  c.strokeStyle = "rgba(255,255,255,.16)";
  c.lineWidth = Math.max(1, size * 0.006);
  c.beginPath();
  c.roundRect(x, y, size, size, size * 0.08);
  c.fill();
  c.stroke();
  // floor
  c.strokeStyle = "rgba(255,255,255,.18)";
  c.lineWidth = Math.max(1, size * 0.008);
  c.beginPath();
  c.moveTo(X(-0.45), Y(1.005));
  c.lineTo(X(0.45), Y(1.005));
  c.stroke();
  const w = s * 0.055;
  // torso
  c.fillStyle = color;
  c.globalAlpha = 0.9;
  c.beginPath();
  c.moveTo(X(p.sl[0]), Y(p.sl[1]));
  c.lineTo(X(p.sr[0]), Y(p.sr[1]));
  c.lineTo(X(p.hr[0]), Y(p.hr[1]));
  c.lineTo(X(p.hl[0]), Y(p.hl[1]));
  c.closePath();
  c.lineJoin = "round";
  c.lineWidth = w;
  c.strokeStyle = color;
  c.fill();
  c.stroke();
  // limbs
  c.globalAlpha = 1;
  c.lineCap = "round";
  c.lineWidth = w;
  c.beginPath();
  for (const [a, b] of LIMBS) {
    c.moveTo(X(p[a][0]), Y(p[a][1]));
    c.lineTo(X(p[b][0]), Y(p[b][1]));
  }
  c.stroke();
  // neck + head
  const nx = (p.sl[0] + p.sr[0]) / 2;
  const ny = (p.sl[1] + p.sr[1]) / 2;
  c.beginPath();
  c.moveTo(X(nx), Y(ny));
  c.lineTo(X(p.h[0] + (nx - p.h[0]) * 0.4), Y(p.h[1] + (ny - p.h[1]) * 0.4));
  c.stroke();
  c.fillStyle = color;
  c.beginPath();
  c.arc(X(p.h[0]), Y(p.h[1]), s * 0.068, 0, Math.PI * 2);
  c.fill();
  if (label) {
    c.font = `800 ${Math.round(size * 0.075)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.fillStyle = "rgba(255,255,255,.85)";
    c.fillText(label, x + size / 2, y + size * 0.03);
  }
  c.restore();
}
