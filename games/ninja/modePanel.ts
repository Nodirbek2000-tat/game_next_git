import { useRunUI } from "@/engine/runtime/runStore";
import { MODE_HINT, MODE_LABEL, readMode, writeMode, type NinjaMode } from "./mode";

// Pre-start option of Meva Ninja. The engine's "ready" menu has no slot for game options, so the game adds a small
// mode picker to it itself (plain DOM, `data-dwell` makes the buttons selectable with a held hand, like every menu button).

const FLAG = "__ninjaModePanel";

// The panel floats at the top of the menu (out of the flow, so the menu buttons never move under the hand cursor).
const CSS = `.nj-modes{position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:11;width:min(94vw,640px);padding:10px 12px 8px;border-radius:18px;text-align:center}
.nj-modes .hk-modes{margin-bottom:4px}.nj-modes .hk-muted{margin:0;font-size:12.5px}
@media (max-height:680px){.nj-modes{position:static;transform:none;margin:0 auto 10px}}`;

function ensureStyle(): void {
  if (document.getElementById("nj-style")) return;
  const st = document.createElement("style");
  st.id = "nj-style";
  st.textContent = CSS;
  document.head.appendChild(st);
}

function build(): HTMLElement {
  const query = new URLSearchParams(window.location.search);
  let current: NinjaMode = readMode(query);
  const wrap = document.createElement("div");
  wrap.className = "nj-modes hk-glass";
  wrap.setAttribute("data-testid", "ninja-modes");
  const row = document.createElement("div");
  row.className = "hk-modes";
  const hint = document.createElement("p");
  hint.className = "hk-muted";
  hint.setAttribute("data-testid", "ninja-mode-hint");
  const buttons: HTMLButtonElement[] = [];
  const paint = (): void => {
    for (const b of buttons) b.classList.toggle("on", b.dataset.mode === current);
    hint.textContent = MODE_HINT[current];
  };
  (["oddiy", "xona"] as NinjaMode[]).forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = m;
    b.setAttribute("data-dwell", "");
    b.setAttribute("data-testid", `ninja-mode-${m}`);
    b.textContent = MODE_LABEL[m];
    b.addEventListener("click", () => {
      current = m;
      writeMode(m);
      paint();
    });
    buttons.push(b);
    row.appendChild(b);
  });
  wrap.append(row, hint);
  paint();
  return wrap;
}

function inject(attempt: number): void {
  const rt = (window as unknown as { __engine?: { slug?: string } }).__engine;
  if (rt && rt.slug && rt.slug !== "meva-ninja") return;
  if (useRunUI.getState().state !== "ready") return;
  const overlay = document.querySelector('[data-testid="ready-overlay"]');
  if (!overlay) {
    if (attempt < 30) requestAnimationFrame(() => inject(attempt + 1));
    return;
  }
  if (overlay.querySelector('[data-testid="ninja-modes"]')) return;
  ensureStyle();
  overlay.appendChild(build());
}

/** Idempotent; call once when the game module loads. */
export function installModePanel(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, (() => void) | undefined>;
  w[FLAG]?.();
  w[FLAG] = useRunUI.subscribe((s, prev) => {
    if (s.state === "ready" && prev.state !== "ready") inject(0);
  });
  inject(0);
}
