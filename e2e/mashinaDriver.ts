/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import { makeSkeleton } from "../engine/testing/skeleton";

export interface DriverOptions {
  /** "careful" obeys the oracle (stop lines, lights, pedestrians, cars ahead); "violator" ignores everything and speeds */
  profile: "careful" | "violator" | "cruise" | "drift" | "idle";
  /** cruise speed in m/s (straights) */
  speed?: number;
  /** follow the exam route (node ids) or just keep the current lane direction */
  route?: string[];
  /** drift: radius (m) of the circle driven around `center` */
  center?: [number, number];
  radius?: number;
  /** control latency to compensate (simulated seconds): about 3 rendered frames x timescale / 20 */
  lag?: number;
}

/**
 * Installs a window.__fake autopilot: every detection frame it reads the game (window.__mashina) and returns a synthetic
 * body skeleton: knee lift = pedals, the line between the wrists = steering wheel, right wrist pulled down = handbrake.
 * It never touches the car directly, so the whole chain skeleton -> tracker -> input mapping -> physics is exercised.
 * The function body is self-contained on purpose (it is serialised into the page).
 */
function driverInit(args: { mk: string; opts: DriverOptions }): void {
  const w = window as any;
  const mk = new Function(`return (${args.mk})`)() as (o: unknown) => unknown;
  const o = args.opts;
  const st: any = { stopHold: 0, released: false, lastType: "", pullAt: -1e9, path: null, seg: 0, last: 0, steer: 0, phase: 0 };
  const steerLimit = (v: number): number => 0.5 / (1 + (v / 16) * (v / 16) * 1.5);

  const buildPath = (G: any, snap: any): void => {
    if (!o.route) return;
    const pts: { x: number; z: number }[] = [];
    const nodes = o.route.map((id: string) => G.L.nodes.get(id));
    let d0 = { x: snap.car.fx, z: snap.car.fz };
    pts.push({ x: snap.car.x, z: snap.car.z });
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const next = nodes[i + 1];
      const din = d0;
      const dout = next ? { x: Math.sign(next.x - n.x), z: Math.sign(next.z - n.z) } : din;
      const rin = { x: -din.z, z: din.x };
      const rout = { x: -dout.z, z: dout.x };
      const straight = din.x === dout.x && din.z === dout.z;
      if (!next) {
        pts.push({ x: n.x + rin.x * 1.8, z: n.z + rin.z * 1.8 });
      } else if (straight) {
        pts.push({ x: n.x + rin.x * 1.8, z: n.z + rin.z * 1.8 });
      } else {
        pts.push({ x: n.x + rin.x * 1.8 + rout.x * 1.8, z: n.z + rin.z * 1.8 + rout.z * 1.8 });
      }
      d0 = dout;
    }
    st.path = pts;
  };

  w.__fake = (now: number) => {
    const G = w.__mashina?.game;
    const snap = G && G.alive ? w.__mashina.snapshot() : null;
    const E = w.__engine;
    const W = E?.stage?.w ?? 960;
    const H = E?.stage?.h ?? 540;
    let gas = 0;
    let brake = 0;
    let steer = 0;
    let pull = false;
    // game time in ms (the autopilot runs once per RENDERED frame; timers in game time are independent of the frame rate)
    const tSim = snap ? snap.clock * 1000 : now;
    if (snap && snap.ready && snap.phase === "driving" && o.profile !== "idle") {
      const car = snap.car;
      const v = car.speed;
      if (o.route && !st.path) buildPath(G, snap);
      // ---- steering target
      let tx = 0;
      let tz = 0;
      let haveT = false;
      let cornerDist = 99;
      if (st.path) {
        const P = st.path as { x: number; z: number }[];
        // progress: advance while we are past the end of the segment
        while (st.seg < P.length - 2) {
          const a = P[st.seg];
          const b = P[st.seg + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const L2 = dx * dx + dz * dz || 1;
          const t = ((car.x - a.x) * dx + (car.z - a.z) * dz) / L2;
          if (t > 1) st.seg++;
          else break;
        }
        const look = 5 + 0.6 * Math.abs(v);
        let s = st.seg;
        let a = P[s];
        let b = P[s + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        let along = ((car.x - a.x) * dx + (car.z - a.z) * dz) / len + look;
        // distance to the end of this segment (the next corner)
        cornerDist = len - (((car.x - a.x) * dx + (car.z - a.z) * dz) / len);
        while (along > len && s < P.length - 2) {
          along -= len;
          s++;
          a = P[s];
          b = P[s + 1];
          const l2 = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          tx = a.x + ((b.x - a.x) / l2) * Math.min(along, l2);
          tz = a.z + ((b.z - a.z) / l2) * Math.min(along, l2);
          haveT = true;
          if (along <= l2) break;
        }
        if (!haveT) {
          tx = a.x + (dx / len) * Math.min(along, len);
          tz = a.z + (dz / len) * Math.min(along, len);
          haveT = true;
        }
        if (s === P.length - 2 && cornerDist < 3) cornerDist = 99; // last segment: no corner after it
      } else if (o.profile === "drift" && o.center) {
        // circle around the centre, counter-clockwise seen from above, with the car pointing a bit outwards
        const R = o.radius ?? 22;
        const ang = Math.atan2(car.z - o.center[1], car.x - o.center[0]);
        const la = ang + 0.5;
        tx = o.center[0] + Math.cos(la) * R;
        tz = o.center[1] + Math.sin(la) * R;
        haveT = true;
      } else {
        // keep the heading
        tx = car.x + car.fx * 20;
        tz = car.z + car.fz * 20;
        haveT = true;
      }
      if (haveT) {
        const vx = tx - car.x;
        const vz = tz - car.z;
        const lat = vx * -car.fz + vz * car.fx;
        const ahead = vx * car.fx + vz * car.fz;
        const alpha = Math.atan2(lat, ahead);
        const Ld = Math.hypot(vx, vz) || 1;
        const delta = Math.atan((2 * 2.7 * Math.sin(alpha)) / Ld);
        steer = Math.max(-1, Math.min(1, delta / steerLimit(Math.abs(v))));
        if (o.profile === "drift") steer = Math.max(-1, Math.min(1, steer * 1.6));
      }
      // ---- speed
      const cruise = o.speed ?? (o.profile === "violator" ? 21 : 7.5);
      let vt = Math.min(cruise, 3.2 + Math.max(0, cornerDist - 4) * 0.35);
      if (!st.path) vt = cruise;
      if (o.profile === "careful") {
        const orc = G.oracle();
        let must = false;
        let dist = 99;
        st.aReq = 0;
        const sp = orc.stop;
        if (sp) {
          dist = sp.dist;
          if (sp.type !== st.lastType) {
            st.lastType = sp.type;
            st.stopHold = 0;
            st.released = false;
          }
          if (sp.type === "stop" || sp.type === "giveWay") {
            if (!st.released) {
              must = true;
              if (v < 0.3 && dist < 3.5) {
                st.stopHold += 1 / 30;
                if (st.stopHold > 1.8 && !sp.cross && !orc.boxBusy) st.released = true;
              }
            }
          } else if (sp.type === "light") {
            must = sp.color === "red" || (sp.color === "yellow" && dist > (v * v) / 8 + 2);
          } else if (sp.type === "zebra") {
            must = !!sp.peds;
          }
        } else {
          st.lastType = "";
          st.released = false;
        }
        if (must) {
          dist -= Math.abs(v) * (o.lag ?? 0.4);
          vt = Math.min(vt, dist - 1.6 <= 0.2 ? 0 : Math.sqrt(2 * 1.6 * (dist - 1.6)));
          // feed-forward braking: the deceleration needed to stop 1.6 m before the line
          st.aReq = (v * v) / (2 * Math.max(0.4, dist - 1.6));
        }
        if (orc.leader) vt = Math.min(vt, orc.leader.v + Math.sqrt(2 * 2.8 * Math.max(0, orc.leader.gap - 3 - Math.abs(v) * (o.lag ?? 0.4))));
      }
      w.__drvDbg = { vt, v, cornerDist, seg: st.seg, steer, t: o.profile === 'careful' ? G.oracle().stop : null };
      const err = vt - v;
      if (err > 0) gas = Math.min(o.profile === "violator" ? 1 : 0.75, err * 0.6);
      else if (v > 0.5) brake = Math.min(1, -err * 0.45);
      if (st.aReq > 1.0 && v > 0.5) {
        gas = 0;
        brake = Math.max(brake, Math.min(1, st.aReq / 8));
      }
      if (vt === 0 && v < 0.4) {
        gas = 0;
        brake = 0; // parking brake holds the car; holding the brake pedal 1.5 s would select reverse
      }
      if (o.profile === "drift") {
        // hold ~16 m/s on the circle (gas below, a little brake above: a constant half gas runs away to 35 m/s and the
        // steering loop, which only runs once per rendered frame, cannot follow), handbrake pulse every ~2.5 s of GAME time
        // to throw the tail out (game time, not wall time: the frame rate of a busy machine must not change the manoeuvre)
        gas = v < 14 ? 1 : v < 16.5 ? 0.3 : 0;
        brake = v > 19 ? Math.min(0.5, (v - 19) * 0.15) : 0;
        if (tSim - st.pullAt > 2600 && v > 9) {
          st.pullAt = tSim;
          st.sign = -(st.sign || 1);
        }
        if (tSim - st.pullAt < 1200) steer = (st.sign || 1) * 0.75;
      }
      pull = tSim - st.pullAt < 700;
    }
    // ---- body: pedals
    const kneeR = gas > 0.02 ? 0.88 * (0.12 + 0.88 * gas) : 0;
    const kneeL = brake > 0.02 ? 0.88 * (0.12 + 0.88 * brake) : 0;
    // ---- body: hands on a wheel
    const sgn = steer < 0 ? -1 : 1;
    const deg = Math.abs(steer) < 0.01 ? 0 : 5 + 55 * Math.abs(steer);
    const ang = (sgn * deg * Math.PI) / 180;
    const R = 0.1 * W;
    const cx = 0.5 * W;
    const cy = 0.5 * H;
    const dx = 2 * R * Math.cos(ang);
    const dy = 2 * R * Math.sin(ang);
    let pullOff = 0;
    const pt = tSim - st.pullAt;
    if (pt >= 0 && pt < 2500) pullOff = pt < 130 ? (0.2 * H * pt) / 130 : pt < 600 ? 0.2 * H : Math.max(0, 0.2 * H * (1 - (pt - 600) / 1900));
    const Lp = { x: cx - dx / 2, y: cy - dy / 2 };
    const Rp = { x: cx + dx / 2, y: cy + dy / 2 + pullOff };
    // the handbrake gesture itself is covered by the controls test; the drift test also holds Shift so a lost frame cannot spoil it
    if (o.profile === "drift" && E?.keys) {
      if (pull) E.keys.add("Shift");
      else E.keys.delete("Shift");
    }
    const person = {
      cx: 0.5,
      armL: [1 - Lp.x / W, Lp.y / H],
      armR: [1 - Rp.x / W, Rp.y / H],
      kneeL,
      kneeR,
    };
    return { pose: { landmarks: [mk(person)] }, hand: null };
  };
}

/** Install the autopilot (call after the game reached "play"; it replaces the fake skeleton source). */
export async function installDriver(page: Page, opts: DriverOptions): Promise<void> {
  await page.evaluate(driverInit, { mk: makeSkeleton.toString(), opts });
}
