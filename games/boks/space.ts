// Screen <-> world conversions of the first-person camera (it never rotates, so this is plain arithmetic) and the mapping of
// the player's hand to the on-screen glove. Pure.

import { CAM, GLOVE_S, GLOVE_Y0 } from "./config";

export interface View {
  /** stage size, CSS px */
  w: number;
  h: number;
  /** camera position (world) */
  x: number;
  y: number;
  z: number;
  /** tan of half the vertical field of view */
  th: number;
}

export const newView = (): View => ({ w: 960, h: 540, x: CAM.x, y: CAM.y, z: CAM.z, th: Math.tan((CAM.fov * Math.PI) / 360) });

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** stage px -> the point of the plane `depth` metres in front of the camera */
export function pxToWorld(v: View, px: number, py: number, depth: number, out: P3): P3 {
  const hh = depth * v.th;
  const hw = (hh * v.w) / v.h;
  out.x = v.x + ((px / v.w) * 2 - 1) * hw;
  out.y = v.y - ((py / v.h) * 2 - 1) * hh;
  out.z = v.z - depth;
  return out;
}

export interface Px {
  x: number;
  y: number;
  /** pixels per metre at that depth */
  s: number;
}

/** a world point -> stage px (and the pixel size of a metre there) */
export function worldToPx(v: View, x: number, y: number, z: number, out: Px): Px {
  const depth = Math.max(0.05, v.z - z);
  const hh = depth * v.th;
  const hw = (hh * v.w) / v.h;
  out.x = ((x - v.x) / hw) * 0.5 * v.w + v.w * 0.5;
  out.y = (0.5 - (y - v.y) / (2 * hh)) * v.h;
  out.s = v.h / (2 * hh);
  return out;
}

/**
 * The player's hand (relative to the centre of their shoulders, in shoulder widths) -> where the glove is drawn on the stage.
 * First person: the glove depends on how the hand moves relative to the BODY, not on where the player stands in the picture.
 */
export function gloveToPx(v: View, rx: number, ry: number, out: { x: number; y: number }): { x: number; y: number } {
  const S = GLOVE_S * v.h;
  out.x = v.w * 0.5 + rx * S;
  out.y = v.h * GLOVE_Y0 + ry * S;
  return out;
}

/** how far the head has to lean (shoulder widths) to move the camera by one metre sideways (the view follows the head a little) */
export const LEAN_M_PER_SW = 0.35;
