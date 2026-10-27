// The demonstration animation of each move: the big animal and the little stick figure both do it, so a child who cannot
// read sees what to do. One pooled `Motion` object is filled per call (nothing allocated).

import type { Move } from "./animals";

export interface Motion {
  /** vertical shift of the animal in units of its size (negative = up) */
  dy: number;
  sx: number;
  sy: number;
  /** tilt in radians */
  rot: number;
  /** stick figure: arms 0 = down, 0.5 = out sideways, 1 = up */
  arm: number;
  /** stick figure: hands together (0) .. apart (1); -1 = not clapping */
  hands: number;
  /** stick figure: 0 standing .. 1 deep squat */
  crouch: number;
  /** stick figure: height of the hop 0..1 */
  lift: number;
  /** arrow hint: -1 up, 1 down, 0 none */
  arrow: -1 | 0 | 1;
}

export const newMotion = (): Motion => ({ dy: 0, sx: 1, sy: 1, rot: 0, arm: 0, hands: -1, crouch: 0, lift: 0, arrow: 0 });

export const MOVE_PERIOD: Record<Move, number> = { jump: 0.9, flap: 0.7, froghop: 2, handsUp: 2, clap: 0.55, slowSquat: 4 };

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fills `o` with the pose of `move` at time `t` seconds (loops). */
export function motionAt(move: Move, t: number, o: Motion): Motion {
  const period = MOVE_PERIOD[move];
  const p = (t / period) % 1;
  o.dy = 0;
  o.sx = 1;
  o.sy = 1;
  o.rot = 0;
  o.arm = 0;
  o.hands = -1;
  o.crouch = 0;
  o.lift = 0;
  o.arrow = 0;
  switch (move) {
    case "jump": {
      const h = Math.sin(Math.PI * p);
      o.lift = h;
      o.dy = -0.2 * h;
      o.sy = 1 + 0.06 * h - 0.08 * (1 - h);
      o.sx = 1 - 0.04 * h + 0.06 * (1 - h);
      o.arrow = -1;
      break;
    }
    case "flap": {
      const s = Math.sin(p * TAU);
      o.arm = 0.5 + 0.38 * s;
      o.rot = 0.2 * s;
      o.dy = -0.04 * Math.abs(s);
      break;
    }
    case "froghop": {
      let crouch = 0;
      let lift = 0;
      if (p < 0.5) crouch = p / 0.5;
      else if (p < 0.8) {
        const u = (p - 0.5) / 0.3;
        crouch = Math.max(0, 1 - u * 3);
        lift = Math.sin(Math.PI * u);
      }
      o.crouch = crouch;
      o.lift = lift;
      o.dy = -0.22 * lift + 0.08 * crouch;
      o.sy = 1 - 0.2 * crouch + 0.1 * lift;
      o.sx = 1 + 0.18 * crouch - 0.06 * lift;
      o.arrow = p < 0.5 ? 1 : -1;
      break;
    }
    case "handsUp": {
      const a = p < 0.25 ? p / 0.25 : p < 0.75 ? 1 : (1 - p) / 0.25;
      o.arm = clamp01(a);
      o.sy = 1 + 0.12 * o.arm;
      o.dy = -0.04 * o.arm;
      o.arrow = -1;
      break;
    }
    case "clap": {
      const h = 0.5 + 0.5 * Math.cos(p * TAU);
      o.hands = h;
      o.sx = 1 - 0.14 * (1 - h);
      o.sy = 1 + 0.06 * (1 - h);
      break;
    }
    case "slowSquat": {
      const c = p < 0.5 ? p / 0.5 : p < 0.75 ? 1 : (1 - p) / 0.25;
      o.crouch = clamp01(c);
      o.dy = 0.12 * o.crouch;
      o.sy = 1 - 0.2 * o.crouch;
      o.sx = 1 + 0.12 * o.crouch;
      o.arrow = 1;
      break;
    }
  }
  return o;
}
