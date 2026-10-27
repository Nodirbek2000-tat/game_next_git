import { describe, expect, it } from "vitest";
import { CFG, FIT, histFrom, mkPeople, mkSmall, type Spec } from "../testing/helpers";
import type { Person } from "../types";
import { PlayerLock } from "./playerLock";
import { ScanController } from "./scan";

const RED: [number, number, number] = [210, 40, 40];
const BLUE: [number, number, number] = [40, 80, 220];
const GREEN: [number, number, number] = [40, 190, 80];
const spec = (cx: number, rgb: [number, number, number], o: Partial<Spec> = {}): Spec => ({ cx, rgb, ...o });

/** Scan `specs` (hands up) and return a lock whose slots belong to the first `n` of them (left to right). */
function scanned(specs: Spec[], n: 1 | 2) {
  const small = mkSmall(specs);
  const people = mkPeople(specs.map((s) => ({ ...s, armL: "up", armR: "up" })));
  const sc = new ScanController(n, CFG.lock);
  let status = sc.update(people, 0.033, histFrom(small));
  for (let i = 0; i < 80 && !status.done; i++) status = sc.update(mkPeople(specs.map((s) => ({ ...s, armL: "up", armR: "up" }))), 0.033, histFrom(small));
  expect(status.done).toBe(true);
  const lock = new PlayerLock(n, CFG.lock);
  status.result!.forEach((r, i) => lock.lock(i, r, 0));
  return { lock, status, small };
}

const frame = (lock: PlayerLock, specs: Spec[], now: number): (Person | null)[] => {
  const small = mkSmall(specs);
  return lock.update(mkPeople(specs), now, histFrom(small));
};
// x of a person's centre, so assertions can say "slot follows the red person"
const cxOf = (p: Person | null) => (p ? p.center.x : NaN);
const screenX = (cam: number) => FIT.W - cam * FIT.dw; // mirrored

describe("ScanController", () => {
  it("one player: the person with both hands above the head is locked after 1.4 s", () => {
    const { status } = scanned([spec(0.5, RED)], 1);
    expect(status.result).toHaveLength(1);
    expect(status.result![0].hist).not.toBeNull();
  });

  it("does not lock while nobody raises both hands", () => {
    const specs = [spec(0.5, RED)];
    const sc = new ScanController(1, CFG.lock);
    const small = mkSmall(specs);
    let st = sc.update(mkPeople(specs), 0.033, histFrom(small));
    for (let i = 0; i < 100; i++) st = sc.update(mkPeople([{ ...specs[0], armL: "up", armR: "down" }]), 0.033, histFrom(small));
    expect(st.done).toBe(false);
    expect(st.progress).toBe(0);
  });

  it("two players: left person on screen is slot 1, right person is slot 2", () => {
    // camera x .7 is the LEFT of the mirrored screen
    const { lock } = scanned([spec(0.3, BLUE), spec(0.7, RED)], 2);
    expect(lock.slots[0].center!.x).toBeLessThan(FIT.W / 2);
    expect(lock.slots[1].center!.x).toBeGreaterThan(FIT.W / 2);
  });

  it("two players: waits until BOTH raise their hands; a third person does not matter", () => {
    const specs = [spec(0.2, BLUE), spec(0.5, RED), spec(0.8, GREEN, { h: 0.5, top: 0.3 })];
    const small = mkSmall(specs);
    const sc = new ScanController(2, CFG.lock);
    let st = sc.update([], 0.033, histFrom(small));
    for (let i = 0; i < 60; i++) {
      st = sc.update(mkPeople([{ ...specs[0], armL: "up", armR: "up" }, specs[1], specs[2]]), 0.033, histFrom(small));
    }
    expect(st.done).toBe(false);
    expect(st.info).toContain("Yana bir kishi");
    for (let i = 0; i < 60 && !st.done; i++) {
      st = sc.update(mkPeople([{ ...specs[0], armL: "up", armR: "up" }, { ...specs[1], armL: "up", armR: "up" }, { ...specs[2], armL: "up", armR: "up" }]), 0.033, histFrom(small));
    }
    expect(st.done).toBe(true);
    expect(st.result).toHaveLength(2);
  });
});

describe("PlayerLock", () => {
  it("1 player: keeps following the locked person among strangers", () => {
    const { lock } = scanned([spec(0.5, RED)], 1);
    const specs = [spec(0.5, RED), spec(0.2, BLUE), spec(0.8, GREEN)];
    const a = frame(lock, specs, 100);
    expect(cxOf(a[0])).toBeCloseTo(screenX(0.5), -1);
    // a stranger raises both hands: still the same player
    const b = frame(lock, [spec(0.5, RED), spec(0.2, BLUE, { armL: "up", armR: "up" }), spec(0.8, GREEN, { armL: "up", armR: "up" })], 133);
    expect(cxOf(b[0])).toBeCloseTo(screenX(0.5), -1);
  });

  it("1 player: a stranger standing where the player was does not take over once the player is away", () => {
    const { lock } = scanned([spec(0.5, RED)], 1);
    frame(lock, [spec(0.5, RED)], 100);
    // player leaves, a stranger in different clothes steps into the same spot
    let r: (Person | null)[] = [];
    for (let t = 1000; t < 3000; t += 100) r = frame(lock, [spec(0.5, BLUE)], t);
    expect(r[0]).toBeNull();
  });

  it("1 player leaves and returns somewhere else: re-acquired by clothing colour", () => {
    const { lock } = scanned([spec(0.5, RED)], 1);
    frame(lock, [spec(0.5, RED)], 100);
    for (let t = 200; t < 4000; t += 100) expect(frame(lock, [spec(0.2, GREEN)], t)[0]).toBeNull();
    const r = frame(lock, [spec(0.2, GREEN), spec(0.8, RED)], 4100);
    expect(cxOf(r[0])).toBeCloseTo(screenX(0.8), -1);
  });

  it("2 players swap places: slots keep their clothing, not their position", () => {
    const { lock } = scanned([spec(0.3, BLUE), spec(0.7, RED)], 2);
    // slot 0 = left on screen = camera x .7 = RED, slot 1 = BLUE
    let t = 100;
    for (let i = 0; i <= 30; i++, t += 33) {
      const k = i / 30;
      const r = frame(lock, [spec(0.3 + 0.4 * k, BLUE), spec(0.7 - 0.4 * k, RED)], t);
      expect(r[0]).not.toBeNull();
      expect(r[1]).not.toBeNull();
      if (i === 30) {
        // after the swap RED stands at camera .3 (screen right) and is still slot 0
        expect(cxOf(r[0])).toBeCloseTo(screenX(0.3), -1);
        expect(cxOf(r[1])).toBeCloseTo(screenX(0.7), -1);
      }
    }
  });

  it("2 players + a third person: the third person never gets a slot, even when raising hands", () => {
    const { lock } = scanned([spec(0.3, BLUE), spec(0.7, RED)], 2);
    const specs = [spec(0.3, BLUE), spec(0.7, RED), spec(0.5, GREEN, { armL: "up", armR: "up" })];
    for (let t = 100; t < 1500; t += 33) {
      const r = frame(lock, specs, t);
      expect(cxOf(r[0])).toBeCloseTo(screenX(0.7), -1);
      expect(cxOf(r[1])).toBeCloseTo(screenX(0.3), -1);
    }
  });

  it("2 players: when one leaves only that slot goes absent, and the same person is re-acquired", () => {
    const { lock } = scanned([spec(0.3, BLUE), spec(0.7, RED)], 2);
    frame(lock, [spec(0.3, BLUE), spec(0.7, RED)], 100);
    let r: (Person | null)[] = [];
    for (let t = 200; t < 3000; t += 100) r = frame(lock, [spec(0.3, BLUE), spec(0.5, GREEN)], t); // red left, a stranger arrives
    expect(r[0]).toBeNull(); // red is slot 0 (screen left)
    expect(cxOf(r[1])).toBeCloseTo(screenX(0.3), -1);
    r = frame(lock, [spec(0.3, BLUE), spec(0.5, GREEN), spec(0.85, RED)], 3100);
    expect(cxOf(r[0])).toBeCloseTo(screenX(0.85), -1);
  });
});

describe("PlayerLock in the dark (position over colour)", () => {
  it("a person whose colours no longer match, standing where the player was, is rejected in good light but accepted when the picture is dark", () => {
    const run = (dark: number): Person | null => {
      const { lock } = scanned([spec(0.5, RED)], 1);
      // what the lock remembers: mostly blue clothing (similarity to a red torso ~0.3 = between the dark and light thresholds)
      const blue = histFrom(mkSmall([spec(0.5, BLUE)]))(mkPeople([spec(0.5, BLUE)])[0])!;
      const red = lock.slots[0].hist!;
      for (let i = 0; i < red.length; i++) red[i] = 0.1 * red[i] + 0.9 * blue[i];
      lock.setDarkness(dark);
      return frame(lock, [spec(0.5, RED)], 100)[0];
    };
    expect(run(0)).toBeNull();
    expect(run(1)).not.toBeNull();
  });

  it("darkness never lets a person far from the player's position take over while the player is recently seen", () => {
    const { lock } = scanned([spec(0.5, RED)], 1);
    lock.setDarkness(1);
    const p = frame(lock, [spec(0.5, RED), spec(0.9, GREEN)], 100)[0];
    expect(cxOf(p)).toBeCloseTo(screenX(0.5), -1);
  });
});
