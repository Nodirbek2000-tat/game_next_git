import { describe, expect, it } from "vitest";
import { Guide, LEN_HIGH, LEN_LOW, ladderPos, MELODY, NotePicker, NOTES, Pinch, PINCH_CLOSE, PINCH_OPEN } from "./logic";
import { pluckSamples } from "./sound";

describe("pinch", () => {
  it("closes below CLOSE, stays closed until OPEN (no flicker), releases when the hand is lost", () => {
    const p = new Pinch();
    const at = { x: 10, y: 20 };
    expect(p.update(PINCH_CLOSE + 0.05, at, 1 / 30)).toBe(false);
    expect(p.update(PINCH_CLOSE - 0.05, at, 1 / 30)).toBe(true);
    expect(p.update((PINCH_CLOSE + PINCH_OPEN) / 2, at, 1 / 30)).toBe(true);
    expect(p.update(PINCH_OPEN + 0.05, at, 1 / 30)).toBe(false);
    p.update(0.1, at, 1 / 30);
    expect(p.update(null, null, 1 / 30)).toBe(false);
  });
  it("follows the fingers smoothly", () => {
    const p = new Pinch();
    p.update(0.1, { x: 0, y: 0 }, 1 / 30);
    p.update(0.1, { x: 100, y: 0 }, 1 / 30);
    expect(p.at.x).toBeGreaterThan(40);
    expect(p.at.x).toBeLessThan(100);
    for (let i = 0; i < 10; i++) p.update(0.1, { x: 100, y: 0 }, 1 / 30);
    expect(p.at.x).toBeGreaterThan(99);
  });
});

describe("notes", () => {
  it("a long string is low, a short one high; the ladder is pentatonic over two octaves", () => {
    expect(ladderPos(LEN_LOW + 3)).toBe(0);
    expect(ladderPos(LEN_HIGH - 1)).toBe(NOTES.length - 1);
    expect(ladderPos(5)).toBeGreaterThan(0);
    expect(NOTES[0].freq).toBeCloseTo(261.63, 1);
    expect(NOTES[NOTES.length - 1].freq).toBeCloseTo(261.63 * 4, 0);
    for (let i = 1; i < NOTES.length; i++) expect(NOTES[i].freq).toBeGreaterThan(NOTES[i - 1].freq);
    expect(NOTES.map((n) => n.name).slice(0, 5)).toEqual(["Do", "Re", "Mi", "Sol", "La"]);
  });
  it("the note changes only when the hands are clearly in the next band (shaking hands do not flicker)", () => {
    const k = new NotePicker();
    expect(k.pick(3.1)).toBe(3);
    expect(k.pick(3.55)).toBe(3);
    expect(k.pick(2.4)).toBe(3);
    expect(k.pick(3.75)).toBe(4);
    k.reset();
    expect(k.pick(0.2)).toBe(0);
  });
});

describe("melody guide", () => {
  it("holding the target note scores and moves on; another note does not", () => {
    const g = new Guide();
    expect(g.target).toBe(MELODY[0]);
    for (let i = 0; i < 10; i++) g.update(2, 1 / 30);
    expect(g.hits).toBe(0);
    let hit = false;
    for (let i = 0; i < 10; i++) hit = g.update(MELODY[0], 1 / 30) || hit;
    expect(hit).toBe(true);
    expect(g.hits).toBe(1);
    expect(g.step).toBe(1);
    // the same name an octave up counts
    const g2 = new Guide();
    for (let i = 0; i < 10; i++) g2.update(MELODY[0] + 5, 1 / 30);
    expect(g2.hits).toBe(1);
  });
});

describe("plucked string sound", () => {
  it("has the pitch of the note and dies away", () => {
    const rate = 44100;
    const s = pluckSamples(440, rate, 1.2);
    expect(s.length).toBe(Math.floor(rate * 1.2));
    const rms = (a: number, b: number) => Math.sqrt(s.slice(a, b).reduce((t, v) => t + v * v, 0) / (b - a));
    expect(rms(0, 4410)).toBeGreaterThan(rms(rate, rate + 4410) * 3);
    // the strongest repetition (autocorrelation) is one period of 440 Hz: ~100 samples
    let best = 0;
    let bestLag = 0;
    for (let lag = 40; lag < 300; lag++) {
      let acc = 0;
      for (let i = 8820; i < 17640; i++) acc += s[i] * s[i + lag];
      if (acc > best) {
        best = acc;
        bestLag = lag;
      }
    }
    expect(Math.abs(bestLag - rate / 440)).toBeLessThan(3);
  });
});
