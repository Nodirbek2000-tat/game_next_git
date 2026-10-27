# Bog‘cha (3–6 yosh) — kids kit

Foundation for the kindergarten games: **2–5 children at once**, no scan, no player lock, no lives, no losing, **2D only**
(no three.js scene, no WebGL canvas), tiny and allocation-free per frame so it runs on the weakest PCs.
Games: `pufakchalar`, `qotib-qol`, `hayvonlar`, `baliqcha` (catalogue entries already exist in `lib/games.ts`, `audience: "bogcha"`).

```
games/bogcha/common/   kit.ts (defineKidsGame, KidsKit)  avatar.ts  music.ts  voice.ts  hud.ts  index.ts
games/bogcha/demo/     "Yulduz tutish" — the minimal example below, registered as hidden slug `bogcha-demo`
engine/tracking/kids.ts  KidTracker: kid slots + signals (engine level, used by the runtime when meta.crowd)
```

## How a game is built

1. Create `games/<slug>/index.ts` that default-exports `defineKidsGame({...})` (see the example).
2. Add ONE line to `engine/game/registry.ts`: `"<slug>": () => import("@/games/<slug>"),`.
3. The catalogue entry (`lib/games.ts`) and the `/bogcha` card already exist for the 4 games. "tez orada" is shown automatically
   until the registry line exists.

What the engine does for a crowd game (`meta.crowd = true`, set by `defineKidsGame`):

* the scan step is skipped (state goes `loading -> ready`), the menu has one big "Boshlash" button (hand over it, tap or Enter);
* nothing pauses when somebody is missing (only the pause button / hidden tab pause);
* MediaPipe runs with `numPoses = 5`, confidence 0.35 (small bodies), lite model; detection rate may drop on weak PCs
  (`DetectionScheduler` starts on the "low" ladder for crowd games);
* no WebGL canvas at all: a plain `requestAnimationFrame` loop drives the engine, your scene only registers a 2D painter;
  the 2D layers are drawn at 1x pixel ratio;
* the engine's own HUD is off, skeletons / "tomoshabin" marks are off; the end screen is "Barakalla!" with the stars of every child.

## Kid slots — `engine.kidSlots` (5 entries, stable)

`const kids = kit.kids` (= `engine.kidSlots`). Always 5 `KidSlot`s; use `k.active && k.present`.

| field | meaning |
|---|---|
| `slot`, `animal` (`emoji`, `name`, colours), `color` | 0 🐰 quyoncha, 1 🐻 ayiqcha, 2 🐱 mushukcha, 3 🐶 kuchukcha, 4 🐸 baqacha |
| `active` | slot belongs to a child (also during the 2 s grace period after the child left) |
| `present` | seen within the last 0.35 s |
| `lostFor`, `seenFor` | seconds since last seen / since the slot was taken |
| `joined`, `left` | true for exactly one render frame when a child takes / loses the slot |
| `scale` | shoulder width in px — the unit of all thresholds; `headR`, `center` |
| `pts` | `head ls rs le re lw rw lh rh lk rk la ra`, each `{x, y, v}` in **stage px** (mirrored, filtered, lightly predicted), `v` = visibility |
| `signals` | see below |

Slot rules: a new child takes the free slot that keeps the left-to-right order; a child keeps the slot while moving (position
continuity with velocity, also when two children cross); a child who disappears keeps the slot for **2 s** (a flicker or a
short step out does not change anything), after that the slot is freed and the next newcomer may take it. `kit.maxKids` /
`maxKids` in the definition limits the used slots.

`signals` (per child, tuned for small bodies, thresholds in body scales):

| signal | meaning |
|---|---|
| `handsUp`, `handUp.L/R` | both / each wrist above the head |
| `jump` (state), `jumpFired` (one frame), `jumps` (counter) | hips rise above a slow standing baseline; slow drift is ignored |
| `squat` | hips clearly below the baseline |
| `clap` (state), `clapFired` (one frame), `claps` | wrists meet after having been apart |
| `wave` | a raised hand swings left-right (≥ 3 reversals in ~1 s) |
| `armsOut` | both arms stretched sideways (aeroplane / wings) |
| `still`, `stillFor` (s), `energy` | whole-body movement energy over ~0.5 s (0 frozen, ~1 walking, 3+ dancing); `still` has hysteresis (< 0.3 / > 0.6) |

One-frame events (`jumpFired`, `clapFired`, `joined`, `left`) are cleared by the engine at the end of each render frame, after your
`update` ran — you see each event exactly once, even when the camera is slower than the display.

## `defineKidsGame` / `KidsKit`

```ts
defineKidsGame({
  slug: "pufakchalar",
  maxKids: 5,          // 1..5
  roundSec: 75,        // 20..90 (?duration=10 in the URL overrides, for tests)
  music: "march",      // "march" | "bouncy" | "calm" | null (you control the music yourself)
  dim: 0.5,            // camera brightness behind the game
  create(kit) { return { update, drawBack, drawFront, onStart, dispose }; },
});
```

Per frame the kit does: `update(dt, now)` (only while playing) -> `drawBack` -> avatars of all children -> `drawFront` -> HUD.
Draw in **stage px** on the 2D canvas (already scaled for the pixel ratio). `kit.stage.w/h` is the stage size.

| `kit.…` | |
|---|---|
| `kids`, `stage`, `engine` | slots, stage size, the raw `EngineApi` |
| `award(kid \| null, n = 1, x?, y?)` | stars to a child (or to the group when `null`), pop sound + ⭐ popup + HUD pulse |
| `stars`, `perKid[slot]`, `timeLeft`, `roundSec`, `playing` | state |
| `finish()` | end the round now ("Barakalla!"); called automatically when the time is up. Everybody who took part gets at least 1 star |
| `hud` | `KidsHud`: star badge, 10-star row, shrinking timer bar with a sun; `hud.addStars` is done by `award` |
| `music` | `play("march"\|"bouncy"\|"calm", tempo = 1)`, `stop()` (hard stop, also the notes already scheduled) |
| `sfx` | `pop() yay() star() drum() sting() attention()` |
| `voice` | `say(id)` — see below |

### Avatars
`drawKids(ctx, kids, now)` (done by the kit) draws each child as their animal: body blob, head with ears and face, arms and legs,
paws that follow the wrists. ~30 canvas calls per child, no gradients, no images. Open mouth on jump / clap / hands up.
`drawKid(ctx, slot, now)` draws one child (e.g. for a game that wants its own order).

### Music and sfx
Original melodies, Web Audio synthesis through the engine's audio graph (`engine.audio.graph()`), so the sound / music settings and the
"tap to enable sound" handling of the engine apply. One oscillator + one gain per note, look-ahead scheduling (state is O(1), tested
for 10 minutes of play). Starts by itself as soon as audio is unlocked. Songs live in `SONGS` (`lead` 8th-note steps, `bass` per
beat, `drums`); add a song by adding an entry.

### Voice prompts
`kit.voice.say("handsUp")`. Prompt ids: `handsUp jump freeze squat clap wave armsOut dance bravo again pop fish`
(`PROMPTS` has the Uzbek Latin text and the icon: "Qo‘llarni ko‘taring!", "Sakrang!", "Qotib qoling!", "Barakalla!" …).
With an Uzbek voice in the browser (`uz-UZ`) it is spoken (`voice.mode === "speech"`); otherwise a short attention jingle plays
(`"jingle"`). Always a big banner (icon + text) appears under the timer, so nobody needs to read. The same prompt is not repeated
within 1.2 s. Add prompts to `PROMPTS`.

## Minimal example (`games/bogcha/demo/index.ts`)

```ts
import { defineKidsGame } from "../common";

export default defineKidsGame({
  slug: "bogcha-demo",
  roundSec: 60,
  music: "march",
  create(kit) {
    const N = 7;
    const x = new Float32Array(N), y = new Float32Array(N), v = new Float32Array(N);   // pooled, no allocation per frame
    const respawn = (i: number) => { x[i] = Math.random() * kit.stage.w; y[i] = -Math.random() * kit.stage.h * 0.6; v[i] = kit.stage.h * 0.15; };
    for (let i = 0; i < N; i++) respawn(i);
    return {
      onStart: () => kit.voice.say("handsUp"),
      update(dt) {
        for (let i = 0; i < N; i++) {
          y[i] += v[i] * dt;
          if (y[i] > kit.stage.h) { respawn(i); continue; }
          for (const k of kit.kids) {
            if (!k.active || !k.present) continue;
            const w = k.pts.rw;
            if (w.v > 0.25 && Math.hypot(w.x - x[i], w.y - y[i]) < 60) { kit.award(k, 1, x[i], y[i]); respawn(i); break; }
          }
        }
      },
      drawFront(ctx) { ctx.font = "56px sans-serif"; for (let i = 0; i < N; i++) ctx.fillText("⭐", x[i], y[i]); },
    };
  },
});
```

Using signals instead of positions, e.g. "Qotib qol!": `if (musicStopped) for (const k of kit.kids) if (k.present && k.signals.stillFor > 0.8) kit.award(k)`;
"Hayvonlar": `k.signals.jumpFired`, `clapFired`, `wave`, `armsOut`.

## Rules for kids games

* 2D only, no allocation in `update` / `draw*` (pool arrays, precompute strings), no per-frame gradients / shadows / `getImageData`.
* No losing, no lives, no scores that need reading; stars only go up. Texts Uzbek Latin, no Cyrillic.
* Never rely on a single child: any number 1..5 may be present, they may come and go (`k.joined`, `k.left`).
* Expect a low detection rate on weak PCs (15–30/s): use `signals` and the predicted `pts`, do not detect "speed" yourself.
* Realistic load: 2–3 children are comfortable on an old dual-core laptop, 4–5 on anything from the last ~8 years
  (the model cost grows with the number of people; the scheduler lowers the detection rate before the game stutters).
* Tests: Vitest for logic (`games/bogcha/common/common.test.ts` shows the fake audio / fake engine helpers), Playwright with
  `window.__fake` for flows (`e2e/bogcha.spec.ts`; `/play/<slug>?duration=6&debug=1`).
