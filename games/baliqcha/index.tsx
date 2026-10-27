"use client";

// "Baliqcha" (3–6 yosh): a simple 2D pond, cute fish, every child fishes with their own rod, all catches go into ONE basket.
// Cast: raise a hand and bring it down (or shout "baliq"). Pull: raise hands (or shout "tort"). No losing, no reading.
// Built on the Bog‘cha kit (games/bogcha/README.md); 2D only, nothing allocated per frame.

import { useEffect, useState, type ReactElement } from "react";
import type { GameModule, SceneProps } from "@/engine";
import type { VoiceEventKind } from "../baliq-ovi/voice";
import { VoiceInput } from "../baliq-ovi/voiceInput";
import { defineKidsGame } from "../bogcha/common";
import { Painter } from "./draw";
import { Baliqcha } from "./game";
import { BASKET } from "./pond";
import { FishSfx } from "./sfx";
import { loadVoicePref, setVoiceWanted, voiceUi } from "./voicePref";

const base = defineKidsGame({
  slug: "baliqcha",
  maxKids: 5,
  roundSec: 90,
  music: null, // the game starts its own, a little slower, tune
  dim: 0.45,
  create(kit) {
    const sfx = new FishSfx(() => kit.engine.audio.graph?.() ?? null);
    const say = (text: string, icon: string, ms = 3600): void => {
      const b = kit.voice.banner;
      b.text = text;
      b.icon = icon;
      b.until = performance.now() + ms;
      kit.sfx.attention();
    };
    let pullHinted = false;
    let started = false;
    const game = new Baliqcha(kit.kids, {
      cast: () => sfx.cast(),
      land: () => sfx.splash(),
      bite: () => {
        sfx.bite();
        if (!pullHinted) {
          pullHinted = true;
          say("Tortamiz! Qo‘llarni ko‘taring!", "🙌", 3000);
        }
      },
      pull: () => sfx.pull(),
      caught: (slot, golden, stars) => {
        const w = kit.stage.w;
        const h = kit.stage.h;
        const bx = BASKET.x * w;
        const by = BASKET.y * h;
        if (golden) sfx.gold();
        else sfx.hooray();
        kit.engine.fx.popup(golden ? "Ura! 🌟" : "Ura!", bx, by - h * 0.15, golden ? "#ffe066" : "#fff3b0", golden ? 76 : 60, 1.1);
        kit.award(kit.kids[slot], stars, bx + w * 0.07, by - h * 0.24);
      },
    });
    const painter = new Painter(game);
    // tests (?debug=1): the game state can be read from the page
    if (kit.engine.query.get("debug")) (window as unknown as { __baliqcha?: Baliqcha }).__baliqcha = game;

    // ---- voice (optional, on-device only: on-device keywords or a loudness detector; audio is never sent anywhere)
    voiceUi.on = loadVoicePref();
    let input: VoiceInput | null = null;
    let voiceHinted = false;
    const onVoice = (kind: VoiceEventKind): void => {
      game.voice.onEvent(kind);
      kit.engine.fx.popup(kind === "fish" ? "🐟" : kind === "pull" ? "💪" : "🔊", kit.stage.w * 0.5, kit.stage.h * 0.34, "#ffffff", 46, 0.7);
    };
    const startVoice = (): void => {
      if (input) return;
      input = new VoiceInput(onVoice);
      void input.start();
    };
    const stopVoice = (): void => {
      input?.dispose();
      input = null;
      voiceUi.label = "";
    };
    voiceUi.onChange = (on) => (on ? startVoice() : stopVoice());

    return {
      onStart() {
        kit.music.play("bouncy", 0.9);
        if (voiceUi.on) startVoice();
        if (!started) {
          started = true;
          say("Qo‘lni ko‘taring, tushiring!", "🎣", 4200);
        }
      },
      update(dt) {
        if (input) {
          input.poll(dt);
          voiceUi.label = input.label;
          if (!voiceHinted && kit.roundSec - kit.timeLeft > 7 && (input.status === "keywords" || input.status === "loudness")) {
            voiceHinted = true;
            say(input.status === "keywords" ? "«Baliq!» deb baqiring!" : "Baqiring: baliq!", "📣", 3200);
          }
        }
        game.update(dt, kit.stage.w);
      },
      drawBack(ctx, now) {
        painter.drawBack(ctx, now, kit.stage.w, kit.stage.h);
      },
      drawFront(ctx, now) {
        painter.drawFront(ctx, now, kit.kids, kit.stage.w, kit.stage.h);
      },
      dispose() {
        const w = window as unknown as { __baliqcha?: Baliqcha };
        if (w.__baliqcha === game) delete w.__baliqcha;
        voiceUi.onChange = null;
        stopVoice();
      },
    };
  },
});

/** The microphone switch (for the teacher): the voice is optional, default on, remembered on this device. */
function MicButton(): ReactElement {
  const [on, setOn] = useState(() => loadVoicePref());
  const [label, setLabel] = useState("");
  // the status text of the microphone changes by itself: look at it twice a second
  useEffect(() => {
    const id = setInterval(() => setLabel(voiceUi.label), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ position: "absolute", right: 14, bottom: 72, zIndex: 8, display: "flex", alignItems: "center", gap: 10, pointerEvents: "none" }}>
      {on && label ? (
        <span style={{ background: "rgba(16,14,30,.72)", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 700 }} data-testid="voice-status">
          {label}
        </span>
      ) : null}
      <button
        type="button"
        data-testid="voice-toggle"
        aria-pressed={on}
        aria-label={on ? "Ovoz bilan o‘ynash: yoqilgan" : "Ovoz bilan o‘ynash: o‘chiq"}
        title={on ? "Ovoz yoqilgan (bosing — o‘chirish)" : "Ovoz o‘chiq (bosing — yoqish)"}
        onClick={() => {
          const n = !on;
          setOn(n);
          setVoiceWanted(n);
        }}
        style={{
          pointerEvents: "auto",
          width: 54,
          height: 54,
          borderRadius: 999,
          border: `3px solid ${on ? "#34d399" : "rgba(255,255,255,.4)"}`,
          background: on ? "rgba(20,90,70,.85)" : "rgba(16,14,30,.78)",
          fontSize: 26,
          lineHeight: 1,
          opacity: on ? 1 : 0.75,
        }}
      >
        {on ? "🎤" : "🔇"}
      </button>
    </div>
  );
}

function Scene({ engine }: SceneProps): ReactElement {
  const Base = base.Scene;
  return (
    <>
      <Base engine={engine} />
      <MicButton />
    </>
  );
}

const baliqcha: GameModule = { meta: base.meta, Scene };
export default baliqcha;
