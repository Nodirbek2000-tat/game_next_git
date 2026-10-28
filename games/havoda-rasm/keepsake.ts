// The group picture outlives the game scene: the engine unmounts the scene when "Barakalla!" (the results screen) appears, so the
// picture and the teacher's "Rasmni saqlash" button live in a small DOM panel in the corner that is removed as soon as the results
// screen is gone (a new round, "Orqaga"). Plain DOM, one canvas copy of the picture, nothing per frame.

const PAPER = "#fff7e6";
let panel: HTMLElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;

export function removeKeepsake(): void {
  if (startTimer) clearTimeout(startTimer);
  if (timer) clearInterval(timer);
  startTimer = null;
  timer = null;
  panel?.remove();
  panel = null;
}

/** the picture on a sheet of paper (a new canvas; only called on demand) */
export function paperCopy(layer: HTMLCanvasElement): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = layer.width;
  c.height = layer.height;
  const x = c.getContext("2d");
  if (!x) return null;
  x.fillStyle = PAPER;
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(layer, 0, 0);
  return c;
}

/** downloads the picture as havoda-rasm.png */
export function downloadPicture(layer: HTMLCanvasElement, onSaved?: () => void): void {
  const c = paperCopy(layer);
  if (!c) return;
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "havoda-rasm.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    onSaved?.();
  }, "image/png");
}

export const SAVE_BTN_CSS =
  "padding:12px 20px;border:0;border-radius:999px;background:#ffd23d;color:#3a2a6b;font:800 18px system-ui,sans-serif;cursor:pointer";

export function makeSaveButton(onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "💾 Rasmni saqlash";
  b.setAttribute("data-testid", "save-btn");
  b.style.cssText = SAVE_BTN_CSS;
  b.addEventListener("click", onClick);
  return b;
}

/** shows the finished picture + the save button in the corner while the results screen is open */
export function showKeepsake(layer: HTMLCanvasElement, onSaved?: () => void): void {
  removeKeepsake();
  if (typeof document === "undefined") return;
  const copy = paperCopy(layer);
  if (!copy) return;
  const p = document.createElement("div");
  p.setAttribute("data-testid", "keepsake");
  p.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:9999;width:min(20vw,240px);background:#fff7e6;border:6px solid #c98a4b;border-radius:14px;overflow:hidden;text-align:center";
  copy.style.cssText = "display:block;width:100%;height:auto";
  const b = makeSaveButton(() => downloadPicture(layer, onSaved));
  b.style.cssText = SAVE_BTN_CSS + ";width:calc(100% - 16px);margin:8px;box-sizing:border-box";
  p.appendChild(copy);
  p.appendChild(b);
  document.body.appendChild(p);
  panel = p;
  // gone together with the results screen
  startTimer = setTimeout(() => {
    timer = setInterval(() => {
      if (!document.querySelector('[data-testid="results-overlay"]')) removeKeepsake();
    }, 500);
  }, 1500);
}
