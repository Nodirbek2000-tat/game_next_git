// Game mode of Meva Ninja, chosen before the start (panel in the "Tayyormisiz?" menu) and remembered.

export type NinjaMode = "oddiy" | "xona";

export const MODE_KEY = "harakat.ninja.mode";
const PICKED_KEY = "harakat.ninja.mode.picked";

export const MODE_LABEL: Record<NinjaMode, string> = {
  oddiy: "👤 Oddiy (1–2 o‘yinchi)",
  xona: "🏠 Xona: hammaning qo‘llari",
};
export const MODE_HINT: Record<NinjaMode, string> = {
  oddiy: "Har bir o‘yinchi o‘z ochkosini yig‘adi.",
  xona: "Kamera ko‘rgan hamma odamning qo‘li kesadi. Ochko umumiy!",
};

export function parseMode(raw: string | null | undefined): NinjaMode | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "xona" || v === "party") return "xona";
  if (v === "oddiy" || v === "normal") return "oddiy";
  return null;
}

function stored(): NinjaMode | null {
  try {
    return parseMode(localStorage.getItem(MODE_KEY));
  } catch {
    return null;
  }
}
function pickedThisSession(): boolean {
  try {
    return sessionStorage.getItem(PICKED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Pick made in the menu during this session > `?mode=xona|oddiy` preset of the link > remembered choice > oddiy.
 */
export function readMode(query?: URLSearchParams): NinjaMode {
  if (pickedThisSession()) return stored() ?? "oddiy";
  return parseMode(query?.get("mode")) ?? stored() ?? "oddiy";
}

export function writeMode(m: NinjaMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
    sessionStorage.setItem(PICKED_KEY, "1");
  } catch {
    /* private mode: the choice just is not remembered */
  }
}
