import { clamp } from "@/engine/math";
import { ROAD, TILE, type Layout } from "../world/layout";

/**
 * Lane-keeping help for kids mode (TZ 6.3): a gentle steering correction towards the centre of the lane the car is
 * driving in, so a child steering with big arm movements stays on the road. Pure; returns a steering offset (-1..1).
 * It is off inside intersections and off the road.
 */
export function laneAssist(L: Layout, x: number, z: number, fx: number, fz: number, speed: number, strength = 1): number {
  if (speed < 3 || strength <= 0) return 0;
  const t = L.specAt(Math.floor(x / TILE), Math.floor(z / TILE));
  let rect = null as (typeof t.road)[number] | null;
  for (const r of t.road) if (r.surface === "asphalt" && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) rect = r;
  if (!rect) return 0;
  // inside the intersection square: no help
  if (t.kind === "city" && Math.abs(x - t.cx) < ROAD.cityHalf + 1.5 && Math.abs(z - t.cz) < ROAD.cityHalf + 1.5) return 0;
  const hw = t.kind === "highway" || t.kind === "bridge";
  // road direction: the axis of the rectangle, in the sense the car is travelling
  const alongX = rect.axis === "x";
  const s = alongX ? Math.sign(fx) : Math.sign(fz);
  if (s === 0) return 0;
  const centre = alongX ? (rect.z0 + rect.z1) / 2 : (rect.x0 + rect.x1) / 2;
  const pos = alongX ? z : x;
  // right-hand traffic: the lane of a car heading +x / +z lies on the +z / -x side of the centre line
  const side = alongX ? s : -s;
  let desired: number;
  if (hw) {
    const m = ROAD.hwMedian / 2;
    let best = Infinity;
    desired = centre + side * (m + ROAD.hwLane / 2);
    for (let i = 0; i < ROAD.hwLanes; i++) {
      const c = centre + side * (m + ROAD.hwLane * (i + 0.5));
      if (Math.abs(pos - c) < best) {
        best = Math.abs(pos - c);
        desired = c;
      }
    }
  } else desired = centre + side * (ROAD.lane / 2);
  // signed offset to the RIGHT of the driver, and heading error (sin of the angle to the right of the road direction)
  const right = alongX ? s : -s;
  const e = (pos - desired) * right;
  const h = alongX ? fz * s : -fx * s;
  const k = clamp(speed / 12, 0.4, 1);
  return clamp(-(0.12 * e + 1.1 * h) * strength * k, -0.55, 0.55);
}
