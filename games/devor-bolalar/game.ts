// "Devordan o‘tamiz" (slug "devor-bolalar"), ages 3-6, 2-5 children at once. A friendly wall slides towards the children with
// a hole shaped like a simple pose (hands up, arms out, star, squat, one hand up); a countdown chime, and when the wall arrives
// every child who is in the pose goes through (star + happy sound), the others get a soft bump and try again with the next wall.
// If everybody passes: "Hammamiz o‘tdik!" and a group bonus. No losing. Built on the Bog‘cha kit (games/bogcha/README.md).

import { PROMPTS, type KidsGameDef, type KidsKit, type PromptId } from "../bogcha/common";
import { C_GOLD, C_GREEN, Painter } from "./paint";
import { registerPrompts } from "./poses";
import { Deck, Round, parseSeq, type RoundHooks } from "./round";
import { WallSounds, type Graph } from "./sounds";

/** bonus stars (for the group) when every child passes the same wall */
export const ALL_BONUS = 2;

export interface DevorDebug {
  pose: string;
  phase: string;
  t: number;
  index: number;
  /** per slot: 0 not judged, 1 passed, 2 bumped (result of the last wall) */
  results: number[];
  passed: number;
  participants: number;
  allPassed: boolean;
  passTotal: number;
  allCount: number;
  perKid: readonly number[];
  stars: number;
  poses: string[];
}

export const devorDef: KidsGameDef = {
  slug: "devor-bolalar",
  maxKids: 5,
  roundSec: 75,
  music: "calm",
  dim: 0.5,
  create(kit: KidsKit) {
    registerPrompts(PROMPTS as unknown as Record<string, { text: string; icon: string }>);
    const q = kit.engine.query;
    const sounds = new WallSounds(() => (kit.engine.audio.graph?.() as Graph | null | undefined) ?? null);
    const painter = new Painter();
    const deck = new Deck(Math.random, parseSeq(q.get("seq")));
    const dbg: DevorDebug | null = q.get("debug")
      ? { pose: "", phase: "", t: 0, index: -1, results: [0, 0, 0, 0, 0], passed: 0, participants: 0, allPassed: false, passTotal: 0, allCount: 0, perKid: kit.perKid, stars: 0, poses: [] }
      : null;
    if (dbg && typeof window !== "undefined") (window as unknown as { __devor?: DevorDebug }).__devor = dbg;

    const hooks: RoundHooks = {
      spawn(p) {
        sounds.whoosh();
        kit.voice.say(p.promptId as PromptId, 2200);
        dbg?.poses.push(p.id);
      },
      chime(n) {
        sounds.chime(n);
      },
      judge(slot, passed) {
        const k = kit.kids[slot];
        if (passed) {
          kit.award(k, 1, k.pts.head.x, k.pts.head.y - k.headR * 4.2);
          sounds.passed(slot);
          painter.burst(k.pts.head.x, k.pts.head.y, 12, slot, kit.stage.h * 0.45);
        } else {
          sounds.bump();
          painter.burst(k.pts.head.x, k.pts.head.y - k.headR, 5, C_GOLD, kit.stage.h * 0.2);
        }
      },
      result(passed, total, all) {
        sounds.arrive();
        if (all) {
          kit.award(null, ALL_BONUS, kit.stage.w / 2, kit.stage.h * 0.3);
          kit.voice.say("dv-all" as PromptId, 2200);
          sounds.fanfare();
          painter.confetti(kit.stage.w, kit.stage.h);
          painter.burst(kit.stage.w / 2, kit.stage.h * 0.4, 14, C_GREEN, kit.stage.h * 0.5);
        } else if (total > passed) kit.voice.say("dv-again" as PromptId, 1800);
        if (passed > 0 && !all) kit.sfx.yay();
      },
    };
    const round = new Round(deck, hooks);
    let started = false;

    return {
      onStart() {
        // called again after a pause: carry on with the same wall
        if (started) return;
        started = true;
        round.begin();
      },
      update(dt) {
        if (round.update(dt, kit.kids, kit.timeLeft) === "finish") kit.finish();
        if (dbg) {
          dbg.pose = round.pose.id;
          dbg.phase = round.phase;
          dbg.t = round.t;
          dbg.index = round.index;
          for (let i = 0; i < 5; i++) dbg.results[i] = round.results[i];
          dbg.passed = round.passed;
          dbg.participants = round.participants;
          dbg.allPassed = round.allPassed;
          dbg.passTotal = round.passTotal;
          dbg.allCount = round.allCount;
          dbg.stars = kit.stars;
        }
      },
      drawBack(ctx, now) {
        painter.drawBack(ctx, kit.stage.w, kit.stage.h, now, round);
      },
      drawFront(ctx, now) {
        painter.drawFront(ctx, kit.stage.w, kit.stage.h, now, round, kit.kids);
      },
      dispose() {
        if (dbg && typeof window !== "undefined") delete (window as unknown as { __devor?: DevorDebug }).__devor;
      },
    };
  },
};
