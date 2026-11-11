// Anonymous usage counts for the owner's Telegram bot: a visit (once per browser session) and every started game round.
// What is sent: a random visitor id made here (localStorage "harakat.vid"), the event type and the game slug. Nothing else: no
// name, no account, never anything from the camera. Production builds only; a failed send is simply dropped.

const URL = "/api/stats/event";
const VID_KEY = "harakat.vid";
const VISIT_KEY = "harakat.visit";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** this browser's random id (null when storage is blocked: then nothing is counted) */
export function visitorId(): string | null {
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v || !/^[0-9a-f-]{36}$/.test(v)) {
      v = uuid();
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

export function track(type: "visit" | "play", slug?: string): void {
  if (process.env.NODE_ENV !== "production" || typeof window === "undefined") return;
  const vid = visitorId();
  if (!vid) return;
  const body = JSON.stringify(slug ? { vid, type, slug } : { vid, type });
  try {
    if (navigator.sendBeacon?.(URL, new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall back to fetch */
  }
  void fetch(URL, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => undefined);
}

/** one visit per browser session (a new tab or coming back later counts again, page changes do not) */
export function trackVisitOnce(): void {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return;
    sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    return;
  }
  track("visit");
}
