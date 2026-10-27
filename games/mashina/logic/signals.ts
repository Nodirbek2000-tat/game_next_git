/**
 * Traffic lights with real phases (Uzbekistan YHQ): green -> flashing green is not used, but every change from
 * green to red goes through yellow, and both directions are red for a clearance interval before the other turns green.
 *
 *   cycle:  [axis A green][A yellow][all red][axis B green][B yellow][all red]
 */
export type LightColor = "green" | "yellow" | "red";
export type Axis = "x" | "z";

export interface Phases {
  green: number;
  yellow: number;
  allRed: number;
}
export const DEFAULT_PHASES: Phases = { green: 14, yellow: 3, allRed: 1.5 };

export const cycleLength = (p: Phases = DEFAULT_PHASES): number => 2 * (p.green + p.yellow + p.allRed);

/** Colour seen by traffic travelling along `axis` ("x" = east-west, "z" = north-south) at time `t` (s) with the intersection's `offset`. */
export function lightColor(t: number, axis: Axis, offset = 0, p: Phases = DEFAULT_PHASES): LightColor {
  const len = cycleLength(p);
  let k = (((t + offset) % len) + len) % len;
  const half = p.green + p.yellow + p.allRed;
  if (axis === "z") k = (k + half) % len;
  // now the axis is "A" in the first half
  if (k < p.green) return "green";
  if (k < p.green + p.yellow) return "yellow";
  return "red";
}

/** Seconds until the colour for `axis` changes the next time. */
export function timeToChange(t: number, axis: Axis, offset = 0, p: Phases = DEFAULT_PHASES): number {
  const len = cycleLength(p);
  let k = (((t + offset) % len) + len) % len;
  const half = p.green + p.yellow + p.allRed;
  if (axis === "z") k = (k + half) % len;
  if (k < p.green) return p.green - k;
  if (k < p.green + p.yellow) return p.green + p.yellow - k;
  return len - k;
}
