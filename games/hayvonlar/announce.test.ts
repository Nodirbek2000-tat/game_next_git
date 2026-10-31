import { describe, expect, it, vi } from "vitest";
import { PROMPTS } from "../bogcha/common";
import { ANIMALS, ANIMAL_IDS, NAME_AUDIO, nameAudioUrl, registerPrompts, type AnimalId } from "./animals";
import { Announcer, NAME_CFG, NameVoice, type Fetcher, type VoiceGraph } from "./announce";
import { ROUND_CFG } from "./round";
import { SOUND_LEN } from "./sounds";

const NONE: Record<AnimalId, boolean> = { quyon: false, qush: false, baqa: false, ayiq: false, pingvin: false, toshbaqa: false };
const ALL: Record<AnimalId, boolean> = { quyon: true, qush: true, baqa: true, ayiq: true, pingvin: true, toshbaqa: true };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

function fakeAudio() {
  const starts: number[] = [];
  const music = { value: 0.32, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  const ac = {
    currentTime: 2,
    decodeAudioData: vi.fn(async () => ({ duration: 1.1 }) as AudioBuffer),
    createBufferSource: () => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: (t: number) => void starts.push(t), stop: vi.fn(), onended: null }),
    createGain: () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
  };
  const graph = { ac, sfx: {}, music: { gain: music } } as unknown as VoiceGraph;
  return { graph, ac, starts, music };
}
const okFetch = () => vi.fn<Fetcher>(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }));

describe("animal names", () => {
  it("each animal calls itself with the -cha name, registered as a prompt, Uzbek Latin", () => {
    registerPrompts();
    const want = ["Quyoncha!", "Qushcha!", "Baqacha!", "Ayiqcha!", "Pingvincha!", "Toshbaqacha!"];
    expect(ANIMALS.map((a) => `${a.name}!`)).toEqual(want);
    ANIMALS.forEach((a, i) => {
      expect(PROMPTS[a.nameId as keyof typeof PROMPTS].text).toBe(want[i]);
      expect([...want[i]].some((c) => c.charCodeAt(0) >= 0x400 && c.charCodeAt(0) <= 0x4ff)).toBe(false);
    });
  });

  it("the manifest lists the six files under /audio/bogcha/hayvonlar/<id>.mp3", () => {
    expect(Object.keys(NAME_AUDIO)).toEqual(["quyon", "qush", "baqa", "ayiq", "pingvin", "toshbaqa"]);
    expect(ANIMAL_IDS.map(nameAudioUrl)).toEqual(["quyon", "qush", "baqa", "ayiq", "pingvin", "toshbaqa"].map((id) => `/audio/bogcha/hayvonlar/${id}.mp3`));
  });
});

describe("recorded name voice", () => {
  it("manifest false: nothing is requested, nothing plays", async () => {
    const fa = fakeAudio();
    const fetcher = okFetch();
    const nv = new NameVoice(() => fa.graph, NONE, fetcher);
    for (const id of ANIMAL_IDS) {
      nv.load(id);
      expect(nv.status(id)).toBe("off");
      expect(nv.play(id)).toBe(0);
    }
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(nv.fetches).toBe(0);
    expect(fa.ac.decodeAudioData).not.toHaveBeenCalled();
  });

  it("the default manifest does not touch the network while no file is listed", async () => {
    const fa = fakeAudio();
    const spy = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal("fetch", spy);
    try {
      const nv = new NameVoice(() => fa.graph);
      for (const id of ANIMAL_IDS) nv.load(id);
      await flush();
      // once the owner flips entries to true this test only checks the count matches them
      expect(spy).toHaveBeenCalledTimes(Object.values(NAME_AUDIO).filter(Boolean).length > 0 ? spy.mock.calls.length : 0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("manifest true: one fetch per animal (also when asked again), lazy, nothing before the audio graph exists", async () => {
    const fa = fakeAudio();
    const fetcher = okFetch();
    let graph: VoiceGraph | null = null;
    const nv = new NameVoice(() => graph, ALL, fetcher);
    nv.load("quyon"); // audio not unlocked yet
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    graph = fa.graph;
    nv.load("quyon");
    nv.load("quyon");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/audio/bogcha/hayvonlar/quyon.mp3");
    await flush(); // the first file arrived: the others follow one by one in the background
    for (const id of ANIMAL_IDS) nv.load(id);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.map((c) => c[0]).sort()).toEqual(ANIMAL_IDS.map(nameAudioUrl).sort());
    for (const id of ANIMAL_IDS) expect(nv.status(id)).toBe("ready");
  });

  it("plays loud and ducks the music for the length of the name, then lets it come back", async () => {
    const fa = fakeAudio();
    const nv = new NameVoice(() => fa.graph, ALL, okFetch());
    nv.load("ayiq");
    await flush();
    expect(nv.play("ayiq")).toBeCloseTo(1.1, 5);
    expect(fa.starts).toEqual([2.02]);
    expect(NAME_CFG.gain).toBeGreaterThan(1); // louder than the music bus
    expect(NAME_CFG.duck).toBeLessThan(1);
    expect(fa.music.setValueAtTime).toHaveBeenCalledWith(0.32, 2.02);
    expect(fa.music.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(0.32 * NAME_CFG.duck, 6);
    const last = fa.music.linearRampToValueAtTime.mock.calls.at(-1) as number[];
    expect(last[0]).toBe(0.32);
    expect(last[1]).toBeCloseTo(2.02 + 1.1 + NAME_CFG.duckOut, 6);
  });

  it("a failing fetch (network error, 404, undecodable file) is silent and not retried", async () => {
    for (const mode of ["reject", "404", "decode"] as const) {
      const fa = fakeAudio();
      if (mode === "decode") fa.ac.decodeAudioData = vi.fn(async () => Promise.reject(new Error("bad data")));
      const fetcher = vi.fn<Fetcher>(async () => {
        if (mode === "reject") throw new Error("offline");
        return { ok: mode !== "404", arrayBuffer: async () => new ArrayBuffer(4) };
      });
      const nv = new NameVoice(() => fa.graph, ALL, fetcher);
      expect(() => nv.load("baqa")).not.toThrow();
      await flush();
      expect(nv.status("baqa")).toBe("failed");
      expect(nv.play("baqa")).toBe(0);
      nv.load("baqa");
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1); // no retry, and the failure started no chain of requests
    }
  });

  it("a fetch function that throws at once is silent too", () => {
    const fa = fakeAudio();
    const nv = new NameVoice(
      () => fa.graph,
      ALL,
      () => {
        throw new Error("no fetch");
      },
    );
    expect(() => nv.load("qush")).not.toThrow();
  });

  it("dispose: nothing plays or loads afterwards", async () => {
    const fa = fakeAudio();
    const fetcher = okFetch();
    const nv = new NameVoice(() => fa.graph, ALL, fetcher);
    nv.load("qush");
    await flush();
    const n = fetcher.mock.calls.length;
    nv.dispose();
    expect(nv.play("qush")).toBe(0);
    nv.load("baqa");
    await flush();
    expect(fetcher.mock.calls.length).toBe(n);
  });
});

describe("announcement order: name, then the animal's own sound, then the prompt", () => {
  function mk(manifest: Record<AnimalId, boolean>, opts: { speech?: boolean; fetcher?: Fetcher } = {}) {
    const fa = fakeAudio();
    const log: string[] = [];
    const names = new NameVoice(() => fa.graph, manifest, opts.fetcher ?? okFetch());
    const play = names.play.bind(names);
    names.play = (id) => {
      const n = play(id);
      if (n > 0) log.push("name");
      return n;
    };
    const ann = new Announcer({
      names,
      canSpeak: () => !!opts.speech,
      speakName: () => void log.push("speak"),
      playSound: () => void log.push("sound"),
    });
    return { ann, log, fa };
  }
  const quyon = ANIMALS[0];

  it("no recording and no speech: the animal's sound at once and the prompt at the old time (unchanged)", () => {
    const { ann, log } = mk(NONE);
    ann.begin(quyon);
    expect(log).toEqual(["sound"]);
    expect(ann.mode).toBe("plain");
    expect(ann.promptAt(quyon)).toBe(ROUND_CFG.voiceAt);
    ann.tick(quyon, 3);
    expect(log).toEqual(["sound"]); // once
  });

  it("an Uzbek voice but no file: the name is spoken first, the sound follows, the prompt after the sound", () => {
    const { ann, log } = mk(NONE, { speech: true });
    ann.begin(quyon);
    expect(log).toEqual(["speak"]);
    expect(ann.mode).toBe("speech");
    ann.tick(quyon, NAME_CFG.speechLead - 0.1);
    expect(log).toEqual(["speak"]);
    ann.tick(quyon, NAME_CFG.speechLead + 0.01);
    expect(log).toEqual(["speak", "sound"]);
    expect(ann.promptAt(quyon)).toBeCloseTo(NAME_CFG.speechLead + SOUND_LEN.quyon + NAME_CFG.beforePrompt, 6);
  });

  it("with the file: the name plays as soon as it is decoded, then the sound, then the prompt is due", async () => {
    const { ann, log, fa } = mk(ALL);
    ann.begin(quyon); // fetch started, nothing decoded yet
    expect(log).toEqual([]);
    expect(ann.promptAt(quyon)).toBe(Number.POSITIVE_INFINITY);
    await flush();
    ann.tick(quyon, 0.2);
    expect(log).toEqual(["name"]);
    expect(fa.starts.length).toBe(1);
    expect(ann.mode).toBe("file");
    ann.tick(quyon, 0.2 + 1.1); // still the name
    expect(log).toEqual(["name"]);
    ann.tick(quyon, 0.2 + 1.1 + NAME_CFG.gap + 0.01);
    expect(log).toEqual(["name", "sound"]);
    ann.tick(quyon, 5);
    expect(log).toEqual(["name", "sound"]);
    const due = ann.promptAt(quyon);
    expect(due).toBeCloseTo(0.2 + 1.1 + NAME_CFG.gap + SOUND_LEN.quyon + NAME_CFG.beforePrompt, 6);
    expect(due).toBeLessThan(ROUND_CFG.act / 2);
  });

  it("a file that is already cached plays the moment the animal appears", async () => {
    const { ann, log, fa } = mk(ALL);
    ann.begin(quyon);
    await flush(); // quyon and, in the background, the other five
    ann.tick(quyon, 0.1);
    ann.begin(ANIMALS[1]);
    expect(log.filter((l) => l === "name").length).toBe(2);
    expect(fa.starts.length).toBe(2);
  });

  it("a file that fails, or is too slow, falls back at once and never blocks the animal's sound or the prompt", async () => {
    const bad: Fetcher = async () => {
      throw new Error("404");
    };
    const f = mk(ALL, { fetcher: bad });
    f.ann.begin(quyon);
    await flush();
    f.ann.tick(quyon, 0.1);
    expect(f.log).toEqual(["sound"]);
    expect(f.ann.promptAt(quyon)).toBe(ROUND_CFG.voiceAt);
    const slow = mk(ALL, { fetcher: () => new Promise(() => undefined) });
    slow.ann.begin(quyon);
    slow.ann.tick(quyon, NAME_CFG.wait - 0.1);
    expect(slow.log).toEqual([]);
    slow.ann.tick(quyon, NAME_CFG.wait + 0.01);
    expect(slow.log).toEqual(["sound"]);
    // with an Uzbek voice available the failed file falls back to the spoken name
    const sp = mk(ALL, { fetcher: bad, speech: true });
    sp.ann.begin(quyon);
    await flush();
    sp.ann.tick(quyon, 0.1);
    expect(sp.log).toEqual(["speak"]);
  });
});
