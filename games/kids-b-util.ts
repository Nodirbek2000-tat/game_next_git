// Small helpers shared by the five "kids-b" lab games (olma-ter, kapalak, shar-pufla, harflar, soyabon).
import type { KidsKit } from "./bogcha/common";

/** Shows a prompt banner (big icon + Uzbek text) without a voice file; plays the attention jingle. */
export function showBanner(kit: KidsKit, text: string, icon: string, ms = 3200): void {
  const b = kit.voice.banner;
  b.text = text;
  b.icon = icon;
  b.until = performance.now() + ms;
  kit.sfx.attention();
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** distance test without a square root */
export const within = (ax: number, ay: number, bx: number, by: number, r: number): boolean => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < r * r;
};
