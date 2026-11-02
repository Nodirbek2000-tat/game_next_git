// Phone portrait: the engine's bottom row (back, pause, sound, fullscreen) sits over the bottom of the stage. Canvas HUDs of the games
// lift their bottom items by this much so nothing is covered. 0 on a landscape stage, so computers keep their layout.

const ROW = 76; // 48 px buttons + 12 px gap + margin (see PLAY_CSS)
let inset = -1;

/** safe-area-inset-bottom in px (read once from the CSS env()). */
function safeBottom(): number {
  if (inset >= 0) return inset;
  inset = 0;
  try {
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(p);
    inset = parseFloat(getComputedStyle(p).paddingBottom) || 0;
    p.remove();
  } catch {
    /* no DOM */
  }
  return inset;
}

/** px to keep free at the bottom of the stage (portrait only). */
export function bottomLift(w: number, h: number): number {
  return h > w ? ROW + safeBottom() : 0;
}
