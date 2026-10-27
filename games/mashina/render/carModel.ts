import * as THREE from "three";
import { CARS, type CarSpec } from "../config";
import { GeoBuilder } from "./geo";

// Procedural car bodies (the fallback for the missing GLB files, TZ 6.6). Everything faces +z; y = 0 is the ground.
// Each car is a handful of merged geometries: paint (tinted by the material colour), trim (glass, bumpers, vertex
// colours), lamps (head/tail lights, own material so they can light up) and one wheel. A car is well below 2k triangles.

export type CarKind = "sedan" | "krossover" | "sport" | "truck" | "van";

export interface CarParts {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  /** wheel centres [x, y, z] (FL, FR, RL, RR) */
  wheelPos: [number, number, number][];
  wheelR: number;
  length: number;
  width: number;
}

const GLASS = 0x1b2733;
const DARK = 0x16181b;
const CHROME = 0xc3c9d0;
const HEAD = 0xfff0c0;
const TAIL = 0xc41414;

/** Distance (m) from the chassis body origin to the ground when the suspension is at rest. */
export const rideHeight = (s: CarSpec): number => s.wheelR + 0.24 + s.half[1] * 0.4;

const geoCache = new Map<string, CarParts>();

export function carParts(kind: CarKind): CarParts {
  const hit = geoCache.get(kind);
  if (hit) return hit;
  const parts = build(kind);
  geoCache.set(kind, parts);
  return parts;
}

/** Free the cached geometries (call when the scene is torn down). */
export function disposeCarParts(): void {
  for (const p of geoCache.values()) {
    p.paint.dispose();
    p.trim.dispose();
    p.lamps.dispose();
    p.wheel.dispose();
  }
  geoCache.clear();
}

function build(kind: CarKind): CarParts {
  const paint = new GeoBuilder();
  const trim = new GeoBuilder();
  const lamps = new GeoBuilder();
  const wheel = new GeoBuilder();
  let len = 4.3;
  let wid = 1.8;
  let wr = 0.33;
  let track = 0.78;
  let wb = 2.7;

  if (kind === "sedan") {
    const s = CARS.sedan;
    wr = s.wheelR; track = s.trackHalf; wb = s.wheelBase;
    const hw = 0.9;
    // lower body: hood, trunk, flanks
    paint.profile([[-2.15, 0.38], [-2.15, 0.88], [-1.5, 0.96], [-0.9, 0.98], [1.0, 0.98], [1.7, 0.9], [2.15, 0.78], [2.15, 0.38]], hw, 0xffffff, 0.1);
    // greenhouse: glass profile, roof on top
    trim.profile([[-1.45, 0.96], [-0.85, 1.43], [0.5, 1.43], [1.05, 0.96]], 0.76, GLASS, 0.08);
    paint.box(-0.18, 1.43, 0, 1.45, 0.05, 1.4, 0xffffff);
    trim.box(0, 0.32, 2.12, 1.76, 0.2, 0.18, DARK);
    trim.box(0, 0.32, -2.12, 1.76, 0.2, 0.18, DARK);
    trim.box(0, 0.62, 2.16, 1.0, 0.1, 0.04, CHROME);
    lamps.box(0.62, 0.72, 2.14, 0.42, 0.14, 0.06, HEAD);
    lamps.box(-0.62, 0.72, 2.14, 0.42, 0.14, 0.06, HEAD);
    lamps.box(0.64, 0.8, -2.15, 0.4, 0.14, 0.06, TAIL);
    lamps.box(-0.64, 0.8, -2.15, 0.4, 0.14, 0.06, TAIL);
    len = 4.35; wid = 1.84;
  } else if (kind === "krossover") {
    const s = CARS.krossover;
    wr = s.wheelR; track = s.trackHalf; wb = s.wheelBase;
    paint.profile([[-2.25, 0.5], [-2.25, 1.1], [-1.9, 1.15], [1.2, 1.15], [2.0, 1.02], [2.25, 0.9], [2.25, 0.5]], 0.95, 0xffffff, 0.06);
    trim.profile([[-2.0, 1.15], [-1.75, 1.78], [0.75, 1.78], [1.25, 1.15]], 0.84, GLASS, 0.07);
    paint.box(-0.5, 1.78, 0, 1.6, 0.06, 2.3, 0xffffff);
    trim.box(0.78, 1.86, -0.5, 0.05, 0.05, 2.1, DARK);
    trim.box(-0.78, 1.86, -0.5, 0.05, 0.05, 2.1, DARK);
    trim.box(0, 0.42, 2.25, 1.9, 0.22, 0.2, DARK);
    trim.box(0, 0.42, -2.25, 1.9, 0.22, 0.2, DARK);
    trim.box(0, 0.62, 2.28, 1.1, 0.12, 0.04, CHROME);
    lamps.box(0.7, 0.95, 2.26, 0.4, 0.16, 0.06, HEAD);
    lamps.box(-0.7, 0.95, 2.26, 0.4, 0.16, 0.06, HEAD);
    lamps.box(0.72, 1.0, -2.27, 0.36, 0.2, 0.06, TAIL);
    lamps.box(-0.72, 1.0, -2.27, 0.36, 0.2, 0.06, TAIL);
    len = 4.55; wid = 1.94;
  } else if (kind === "sport") {
    const s = CARS.sport;
    wr = s.wheelR; track = s.trackHalf; wb = s.wheelBase;
    paint.profile([[-2.2, 0.32], [-2.2, 0.82], [-1.2, 0.92], [-0.6, 1.0], [0.9, 1.0], [1.5, 0.86], [2.2, 0.6], [2.2, 0.32]], 0.95, 0xffffff, 0.12);
    trim.profile([[-1.0, 0.98], [-0.45, 1.3], [0.35, 1.3], [0.95, 0.98]], 0.74, GLASS, 0.1);
    paint.box(-0.05, 1.3, 0, 1.3, 0.04, 0.8, 0xffffff);
    // spoiler
    trim.box(0, 1.12, -2.05, 1.7, 0.05, 0.4, DARK);
    trim.box(0.7, 0.98, -2.0, 0.06, 0.28, 0.1, DARK);
    trim.box(-0.7, 0.98, -2.0, 0.06, 0.28, 0.1, DARK);
    // splitter, skirts, hood stripe
    trim.box(0, 0.28, 2.18, 1.9, 0.1, 0.25, DARK);
    trim.box(0.93, 0.36, 0, 0.06, 0.12, 2.6, DARK);
    trim.box(-0.93, 0.36, 0, 0.06, 0.12, 2.6, DARK);
    trim.box(0, 0.79, 1.1, 0.26, 0.012, 2.3, 0xf2f2f2);
    lamps.box(0.68, 0.7, 2.18, 0.4, 0.09, 0.06, HEAD);
    lamps.box(-0.68, 0.7, 2.18, 0.4, 0.09, 0.06, HEAD);
    lamps.box(0.0, 0.86, -2.21, 1.5, 0.08, 0.06, TAIL);
    len = 4.4; wid = 1.9;
  } else if (kind === "van") {
    track = 0.85; wb = 3.2; wr = 0.36;
    paint.box(0, 0.45, -0.3, 1.9, 1.5, 4.4, 0xffffff);
    paint.box(0, 0.45, 2.1, 1.9, 0.75, 0.9, 0xffffff);
    trim.box(0, 1.15, 2.52, 1.7, 0.55, 0.05, GLASS);
    trim.box(0, 0.4, 2.52, 1.95, 0.22, 0.1, DARK);
    lamps.box(0.7, 0.78, 2.55, 0.36, 0.14, 0.06, HEAD);
    lamps.box(-0.7, 0.78, 2.55, 0.36, 0.14, 0.06, HEAD);
    lamps.box(0.7, 0.9, -2.52, 0.3, 0.2, 0.06, TAIL);
    lamps.box(-0.7, 0.9, -2.52, 0.3, 0.2, 0.06, TAIL);
    len = 5.1; wid = 1.95;
  } else {
    // truck: cab + box
    track = 1.0; wb = 5.2; wr = 0.5;
    paint.box(0, 0.65, 3.0, 2.3, 1.9, 2.1, 0xffffff);
    trim.box(0, 2.0, 4.06, 2.0, 0.8, 0.05, GLASS);
    trim.box(0, 0.5, 4.1, 2.4, 0.3, 0.12, DARK);
    trim.box(0, 0.45, -0.5, 2.0, 0.4, 7.0, DARK);
    trim.box(0, 1.0, -1.3, 2.45, 2.7, 6.1, 0xe6e6e6);
    lamps.box(0.8, 1.0, 4.12, 0.34, 0.16, 0.06, HEAD);
    lamps.box(-0.8, 1.0, 4.12, 0.34, 0.16, 0.06, HEAD);
    lamps.box(0.85, 0.9, -4.38, 0.3, 0.2, 0.06, TAIL);
    lamps.box(-0.85, 0.9, -4.38, 0.3, 0.2, 0.06, TAIL);
    len = 8.8; wid = 2.5;
  }

  // wheel: tyre + hub, lying on x, centred at the origin
  wheel.cylX(0, 0, 0, wr, 0.26, 0x141414, 14);
  wheel.cylX(0, 0, 0, wr * 0.58, 0.28, 0xc7ccd2, 8);
  const wheelPos: [number, number, number][] =
    kind === "truck"
      ? [[track, wr, 2.9], [-track, wr, 2.9], [track, wr, -2.3], [-track, wr, -2.3]]
      : [[track, wr, wb / 2], [-track, wr, wb / 2], [track, wr, -wb / 2], [-track, wr, -wb / 2]];
  return { paint: paint.build(), trim: trim.build(), lamps: lamps.build(), wheel: wheel.build(), wheelPos, wheelR: wr, length: len, width: wid };
}
