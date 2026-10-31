// "Hayvonlardek harakat" (slug "hayvonlar"), ages 3-6, 2-5 children at once. A big cartoon animal comes out, calls its own
// name ("Quyoncha!"), makes its sound and does the move itself; then a spoken prompt. Every child who copies the movement
// gets a star (and a check above the head). Cooperative group stars, no losing. Built on the Bog‘cha kit
// (games/bogcha/README.md).

import type { KidsGameDef, KidsKit, PromptId } from "../bogcha/common";
import { registerPrompts } from "./animals";
import { Announcer, NameVoice } from "./announce";
import { Painter } from "./paint";
import { Round, type RoundHooks } from "./round";
import { Deck, parseSeq } from "./sequence";
import { playAnimal } from "./sounds";

export interface HayvonlarDebug {
  animal: string;
  move: string;
  phase: string;
  t: number;
  index: number;
  doneCount: number;
  /** slots that completed the current challenge */
  done: boolean[];
  /** stars per kid slot (live reference) */
  perKid: readonly number[];
  stars: number;
  /** animals shown so far */
  order: string[];
  /** how the current animal was announced: "file" (recorded child voice), "speech" or "plain" */
  voice: string;
}

export const hayvonlarDef: KidsGameDef = {
  slug: "hayvonlar",
  maxKids: 5,
  roundSec: 84,
  music: "bouncy",
  song: "/audio/bogcha/hayvonlar.mp3",
  dim: 0.5,
  create(kit: KidsKit) {
    registerPrompts();
    const q = kit.engine.query;
    const deck = new Deck(Math.random, parseSeq(q.get("seq")));
    const painter = new Painter();
    const dbg: HayvonlarDebug | null = q.get("debug")
      ? { animal: "", move: "", phase: "", t: 0, index: -1, doneCount: 0, done: [false, false, false, false, false], perKid: kit.perKid, stars: 0, order: [], voice: "" }
      : null;
    if (dbg) (window as unknown as { __hayvonlar?: HayvonlarDebug }).__hayvonlar = dbg;

    const graph = () => kit.engine.audio.graph?.() ?? null;
    const names = new NameVoice(graph);
    const announcer = new Announcer({
      names,
      canSpeak: () => kit.voice.mode === "speech",
      speakName: (a) => kit.voice.say(a.nameId as PromptId, 1100),
      playSound: (a) => playAnimal(graph(), a.id),
    });

    const hooks: RoundHooks = {
      start(a) {
        announcer.begin(a);
        dbg?.order.push(a.id);
      },
      promptAt: (a) => announcer.promptAt(a),
      prompt(a) {
        kit.voice.say(a.promptId as PromptId, 2800);
      },
      done(k, _a, first) {
        kit.award(kit.kids[k.slot], 1);
        if (first) kit.voice.say("bravo", 1600);
      },
      end(_a, any) {
        if (any) kit.sfx.yay();
        // nobody is left out: a child who did not manage it this time gets a warm heart, not a blank
        for (let i = 0; i < kit.kids.length; i++) {
          const k = kit.kids[i];
          if (!k.active || round.progress[k.slot].done) continue;
          kit.engine.fx.popup("💛", k.pts.head.x, Math.max(kit.stage.h * 0.2, k.pts.head.y - k.headR * 2.6), k.color, 46, 1);
        }
      },
    };
    const round = new Round(deck, hooks);

    return {
      onStart() {
        round.begin();
      },
      update(dt) {
        if (round.phase === "act") announcer.tick(round.animal, round.t);
        if (round.update(dt, kit.kids, kit.timeLeft) === "finish") kit.finish();
        if (dbg) {
          dbg.animal = round.animal.id;
          dbg.move = round.animal.move;
          dbg.phase = round.phase;
          dbg.t = round.t;
          dbg.index = round.index;
          dbg.doneCount = round.doneCount;
          for (let i = 0; i < 5; i++) dbg.done[i] = round.progress[i].done;
          dbg.stars = kit.stars;
          dbg.voice = announcer.mode;
        }
      },
      drawFront(ctx, now) {
        painter.draw(ctx, kit.stage.w, kit.stage.h, now, round, kit.kids);
      },
      dispose() {
        names.dispose();
        if (dbg) delete (window as unknown as { __hayvonlar?: HayvonlarDebug }).__hayvonlar;
      },
    };
  },
};
