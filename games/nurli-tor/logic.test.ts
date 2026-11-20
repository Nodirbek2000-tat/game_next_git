import { describe, expect, it } from "vitest";
import { INSTRUMENTS, noteOf } from "./instruments";
import { Board, crossAt, HandTracks, LEN_LONG, LEN_SHORT, noteForLength, Pinch, PINCH_CLOSE, PINCH_OPEN, segDist, type HandSample } from "./logic";
import { pluckSamples, voiceSamples } from "./sound";

const FREE = INSTRUMENTS[0];
const NOTES = FREE.scale;

/** a scripted hand: wrist at (x, y), size 60 px, pinched or open, the index tip optionally somewhere else */
function hand(x: number, y: number, pinched: boolean, tip?: { x: number; y: number }): HandSample {
  const pts = [];
  for (let i = 0; i < 21; i++) {
    const f = Math.floor((i - 1) / 4);
    const j = ((i - 1) % 4) + 1;
    pts.push(i === 0 ? { x, y } : { x: x + (f - 2) * 12, y: y - j * 18 });
  }
  pts[9] = { x, y: y - 60 };
  pts[4] = { x: x + 3, y: y - 72 };
  pts[8] = pinched ? { x: x + 6, y: y - 74 } : { x: x + 40, y: y - 80 };
  if (tip) for (const i of [4, 8, 12, 16, 20]) pts[i] = { ...tip };
  return { pts, size: 60, pinchD: pinched ? 0.1 : 0.8 };
}

describe("pinch", () => {
  it("closes below CLOSE, stays closed until OPEN (no flicker), releases when the hand is lost", () => {
    const p = new Pinch();
    expect(p.update(PINCH_CLOSE + 0.05)).toBe(false);
    expect(p.update(PINCH_CLOSE - 0.05)).toBe(true);
    expect(p.update((PINCH_CLOSE + PINCH_OPEN) / 2)).toBe(true);
    expect(p.update(PINCH_OPEN + 0.05)).toBe(false);
    p.update(0.1);
    expect(p.update(null)).toBe(false);
  });
});

describe("notes", () => {
  it("a long string is low, a short one high (minor pentatonic on E, two octaves)", () => {
    const ref = 1000;
    expect(noteForLength(ref * LEN_LONG * 1.2, ref, NOTES.length)).toBe(0);
    expect(noteForLength(ref * LEN_SHORT * 0.8, ref, NOTES.length)).toBe(NOTES.length - 1);
    const mid = noteForLength(ref * 0.35, ref, NOTES.length);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(NOTES.length - 1);
    expect(NOTES[0].freq).toBeCloseTo(164.81, 1);
    expect(noteOf(0).name).toBe("La");
    expect(noteOf(-9).name).toBe("Do");
    expect(NOTES[NOTES.length - 1].freq).toBeCloseTo(164.81 * 4, 0);
    for (let i = 1; i < NOTES.length; i++) expect(NOTES[i].freq).toBeGreaterThan(NOTES[i - 1].freq);
  });
});

describe("crossing", () => {
  it("a finger move across the string is a hit, along it or past its end is not", () => {
    const a = { x: 0, y: 100 };
    const b = { x: 200, y: 100 };
    expect(crossAt({ x: 100, y: 80 }, { x: 100, y: 120 }, a, b)).toBeCloseTo(0.5, 3);
    expect(crossAt({ x: 100, y: 80 }, { x: 100, y: 95 }, a, b)).toBe(-1);
    expect(crossAt({ x: 250, y: 80 }, { x: 250, y: 120 }, a, b)).toBe(-1);
    expect(crossAt({ x: 20, y: 90 }, { x: 180, y: 90 }, a, b)).toBe(-1);
  });
});

describe("hand tracks", () => {
  it("keeps the identity of a hand and moves it forward by its speed", () => {
    const t = new HandTracks();
    t.update([hand(100, 300, false)], 0, 10);
    const id = t.hands[0].id;
    t.update([hand(130, 300, false)], 33, 43);
    expect(t.hands).toHaveLength(1);
    expect(t.hands[0].id).toBe(id);
    // moving right at ~900 px/s: 30 ms after the picture it is drawn further right than the picture
    t.update([hand(130, 300, false)], 33, 63);
    expect(t.hands[0].pts[0].x).toBeGreaterThan(140);
    // gone after a while
    t.update([], 400, 410);
    expect(t.hands).toHaveLength(0);
  });
});

describe("board", () => {
  const W = 1000;
  const H = 600;
  const ref = 600;
  /** feed one detection per call (30 fps) */
  function run(): { t: HandTracks; b: Board; step: (s: HandSample[]) => ReturnType<Board["update"]> } {
    const t = new HandTracks();
    const b = new Board();
    let ms = 0;
    return {
      t,
      b,
      step: (s) => {
        ms += 33;
        t.update(s, ms, ms);
        return b.update(t.hands, ref, W, H, ms, FREE);
      },
    };
  }

  it("two pinches pull out a string; opening the fingers leaves it in place", () => {
    const { b, step } = run();
    step([hand(300, 400, true), hand(700, 400, true)]);
    expect(b.draft).not.toBeNull();
    step([hand(250, 400, true), hand(750, 400, true)]);
    const ev = step([hand(250, 400, false), hand(750, 400, false)]);
    expect(ev.some((e) => e.type === "place")).toBe(true);
    expect(b.draft).toBeNull();
    expect(b.strings).toHaveLength(1);
    const s = b.strings[0];
    expect(s.a.x).toBeLessThan(270);
    expect(s.b.x).toBeGreaterThan(730);
    // the hands leave: the string stays
    step([]);
    for (let i = 0; i < 10; i++) step([]);
    expect(b.strings).toHaveLength(1);
  });

  it("a fingertip crossing the string plucks it (once per crossing)", () => {
    const { b, step } = run();
    step([hand(300, 400, true), hand(700, 400, true)]);
    step([hand(300, 400, false), hand(700, 400, false)]);
    const line = b.strings[0].a.y;
    const plucks: number[] = [];
    // an open hand, fingertips moving down through the string
    for (let k = 0; k < 8; k++) {
      const y = line - 60 + k * 20;
      const ev = step([hand(500, y + 80, false, { x: 500, y })]);
      plucks.push(ev.filter((e) => e.type === "pluck").length);
    }
    expect(plucks.reduce((a, c) => a + c, 0)).toBe(1);
    expect(b.plucks).toBe(1);
  });

  it("a fingertip resting on a string plays once; it plays again only after it left", () => {
    const { b, step } = run();
    step([hand(300, 400, true), hand(700, 400, true)]);
    step([hand(300, 400, false), hand(700, 400, false)]);
    const line = b.strings[0].a.y;
    let n = 0;
    // slowly down onto the string (no crossing), stay there, leave, come back
    for (const y of [line - 40, line - 20, line - 5, line - 4, line - 5, line - 4, line - 60, line - 6])
      n += step([hand(500, y + 80, false, { x: 500, y })]).filter((e) => e.type === "pluck").length;
    expect(n).toBe(2);
  });

  it("ready instruments: the guitar has six strings E A D G B E, the notes stay when a string is moved", () => {
    const b = new Board();
    const g = INSTRUMENTS.find((i) => i.id === "gitara")!;
    const strs = b.placeLayout(g, 1000, 600, noteOf);
    expect(strs.map((s) => s.note.name)).toEqual(["Mi", "La", "Re", "Sol", "Si", "Mi"]);
    expect(strs[0].note.freq).toBeCloseTo(82.41, 1);
    expect(strs.every((s) => s.fixed)).toBe(true);
    expect(b.clear()).toHaveLength(6);
    expect(b.strings).toHaveLength(0);
  });

  it("pinching the middle of a string moves the whole string", () => {
    const { b, step } = run();
    step([hand(300, 400, true), hand(700, 400, true)]);
    step([hand(300, 400, false), hand(700, 400, false)]);
    const s = b.strings[0];
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const mx = (s.a.x + s.b.x) / 2 - 4.5;
    const my = s.a.y + 73;
    step([hand(mx, my, true)]);
    expect(b.held(s)).toBe(true);
    for (let k = 1; k <= 4; k++) step([hand(mx, my - k * 25, true)]);
    expect(s.a.y).toBeLessThan(240);
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(len, 0);
  });

  it("the ends can be grabbed again: moved, and brought together = removed", () => {
    const { b, step } = run();
    step([hand(300, 400, true), hand(700, 400, true)]);
    step([hand(300, 400, false), hand(700, 400, false)]);
    const s = b.strings[0];
    // the pinch point sits ~73 px above the wrist: put it on the ends
    const ax = s.a.x - 4.5;
    const ay = s.a.y + 73;
    const bx = s.b.x - 4.5;
    const by = s.b.y + 73;
    const ev = step([hand(ax, ay, true), hand(bx, by, true)]);
    expect(ev.filter((e) => e.type === "grab")).toHaveLength(2);
    expect(b.draft).toBeNull();
    expect(b.held(s)).toBe(true);
    // move it up
    step([hand(ax, ay - 100, true), hand(bx, by - 100, true)]);
    expect(s.a.y).toBeLessThan(330);
    // ends together, let go = gone
    for (let k = 1; k <= 4; k++) step([hand(ax + ((480 - ax) * k) / 4, ay - 100, true), hand(bx + ((500 - bx) * k) / 4, by - 100, true)]);
    const ev2 = step([hand(480, ay - 100, false), hand(500, by - 100, false)]);
    expect(ev2.some((e) => e.type === "remove")).toBe(true);
    expect(b.strings).toHaveLength(0);
  });
});

describe("instrument sounds", () => {
  it("every instrument rings at its pitch (a double course too) and fades", () => {
    const rate = 44100;
    for (const inst of INSTRUMENTS) {
      const s = voiceSamples(220, rate, inst.voice);
      const seg = (a: number) => Math.sqrt(s.slice(a, a + 2205).reduce((t, v) => t + v * v, 0) / 2205);
      expect(seg(0)).toBeGreaterThan(seg(s.length - 3000) * 2);
      let best = 0;
      let lag0 = 0;
      for (let lag = 120; lag < 300; lag++) {
        let acc = 0;
        for (let i = 4410; i < 8820; i++) acc += s[i] * s[i + lag];
        if (acc > best) {
          best = acc;
          lag0 = lag;
        }
      }
      expect(Math.abs(lag0 - rate / 220)).toBeLessThan(3);
    }
    expect(segDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }).d).toBeCloseTo(3, 5);
  });
});

describe("plucked string sound", () => {
  it("has the pitch of the note and dies away", () => {
    const rate = 44100;
    const s = pluckSamples(440, rate, 1.6);
    expect(s.length).toBe(Math.floor(rate * 1.6));
    const rms = (a: number, b: number) => Math.sqrt(s.slice(a, b).reduce((t, v) => t + v * v, 0) / (b - a));
    expect(rms(0, 4410)).toBeGreaterThan(rms(rate, rate + 4410) * 2);
    // the strongest repetition (autocorrelation) is one period of 440 Hz: ~100 samples
    let best = 0;
    let bestLag = 0;
    for (let lag = 60; lag < 300; lag++) {
      let acc = 0;
      for (let i = 8820; i < 17640; i++) acc += s[i] * s[i + lag];
      if (acc > best) {
        best = acc;
        bestLag = lag;
      }
    }
    expect(Math.abs(bestLag - rate / 440)).toBeLessThan(2);
  });
});
