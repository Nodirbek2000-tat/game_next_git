// "Hayvonlardek harakat" (slug "hayvonlar"), ages 3-6, 2-5 children at once. A big animal appears with its own sound and a
// spoken prompt; every child who copies its movement gets a star (and a check above the head). Cooperative group stars,
// no losing. Built on the Bog‘cha kit (games/bogcha/README.md).

import type { KidsGameDef, KidsKit, PromptId } from "../bogcha/common";
import { registerPrompts } from "./animals";
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
}

export const hayvonlarDef: KidsGameDef = {
  slug: "hayvonlar",
  maxKids: 5,
  roundSec: 84,
  music: "bouncy",
  dim: 0.5,
  create(kit: KidsKit) {
    registerPrompts();
    const q = kit.engine.query;
    const deck = new Deck(Math.random, parseSeq(q.get("seq")));
    const painter = new Painter();
    const dbg: HayvonlarDebug | null = q.get("debug")
      ? { animal: "", move: "", phase: "", t: 0, index: -1, doneCount: 0, done: [false, false, false, false, false], perKid: kit.perKid, stars: 0, order: [] }
      : null;
    if (dbg) (window as unknown as { __hayvonlar?: HayvonlarDebug }).__hayvonlar = dbg;

    const hooks: RoundHooks = {
      start(a) {
        playAnimal(kit.engine.audio.graph?.() ?? null, a.id);
        dbg?.order.push(a.id);
      },
      prompt(a) {
        kit.voice.say(a.promptId as PromptId, 2800);
      },
      done(k, _a, first) {
        kit.award(kit.kids[k.slot], 1);
        if (first) kit.voice.say("bravo", 1600);
      },
      end(_a, any) {
        if (any) kit.sfx.yay();
      },
    };
    const round = new Round(deck, hooks);

    return {
      onStart() {
        round.begin();
      },
      update(dt) {
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
        }
      },
      drawFront(ctx, now) {
        painter.draw(ctx, kit.stage.w, kit.stage.h, now, round, kit.kids);
      },
      dispose() {
        if (dbg) delete (window as unknown as { __hayvonlar?: HayvonlarDebug }).__hayvonlar;
      },
    };
  },
};
