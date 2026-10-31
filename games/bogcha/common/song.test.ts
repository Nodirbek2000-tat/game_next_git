import { afterEach, describe, expect, it, vi } from "vitest";
import { SongPlayer, type SongGraph } from "./song";

class FakeAudio {
  static made: FakeAudio[] = [];
  preload = "";
  loop = false;
  muted = false;
  currentTime = 7;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
}

const graph = (enabled = true): SongGraph => {
  const node = { connect: vi.fn((n: unknown) => n) };
  return {
    ac: { createGain: () => ({ gain: { value: 0 }, connect: vi.fn((n: unknown) => n) }), createMediaElementSource: vi.fn(() => node) } as unknown as AudioContext,
    music: {} as AudioNode,
    musicEnabled: () => enabled,
  };
};

describe("SongPlayer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudio.made = [];
  });

  it("streams one looping element into the music bus, wired once", () => {
    vi.stubGlobal("Audio", FakeAudio);
    const g = graph();
    const s = new SongPlayer("/a.mp3", () => g);
    s.preload();
    s.play(() => undefined);
    s.play(() => undefined);
    expect(FakeAudio.made).toHaveLength(1);
    expect(FakeAudio.made[0].loop).toBe(true);
    expect(g.ac.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(FakeAudio.made[0].play).toHaveBeenCalledTimes(2);
  });

  it("falls back when the song cannot play or Audio is missing", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const s = new SongPlayer("/a.mp3", () => null);
    s.preload();
    FakeAudio.made[0].play = vi.fn(() => Promise.reject(new Error("blocked")));
    const fail = vi.fn();
    s.play(fail);
    await Promise.resolve();
    await Promise.resolve();
    expect(fail).toHaveBeenCalledTimes(1);
    vi.stubGlobal("Audio", undefined);
    const none = vi.fn();
    new SongPlayer("/b.mp3", () => null).play(none);
    expect(none).toHaveBeenCalledTimes(1);
  });

  it("follows the music setting, and stop rewinds", () => {
    vi.stubGlobal("Audio", FakeAudio);
    const s = new SongPlayer("/a.mp3", () => graph(false));
    s.play(() => undefined);
    s.tick();
    expect(FakeAudio.made[0].muted).toBe(true);
    s.stop();
    expect(FakeAudio.made[0].currentTime).toBe(0);
  });
});
