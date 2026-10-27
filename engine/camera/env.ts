// Platform / browser detection used for the camera permission guides.

export interface Env {
  ios: boolean;
  android: boolean;
  mac: boolean;
  win: boolean;
  /** opened inside Telegram / Instagram / Facebook / a generic WebView */
  inApp: boolean;
  /** opened from a file manager / downloads (content: or file: on a phone) — the camera is unavailable */
  viewer: boolean;
  /** friendly browser name for the texts */
  browser: string;
}

interface EnvInput {
  ua: string;
  platform?: string;
  maxTouchPoints?: number;
  protocol?: string;
  hasTelegramProxy?: boolean;
}

export function detectEnvFrom(i: EnvInput): Env {
  const ua = i.ua;
  const ios = /iPhone|iPad|iPod/.test(ua) || (i.platform === "MacIntel" && (i.maxTouchPoints ?? 0) > 1);
  const android = /Android/.test(ua);
  const mac = !ios && /Macintosh/.test(ua);
  const win = /Windows/.test(ua);
  const inApp = /Telegram|Instagram|FBAN|FBAV|Line\/|; wv\)/.test(ua) || !!i.hasTelegramProxy;
  const browser = /YaBrowser/.test(ua)
    ? "Yandex Browser"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /CriOS|Chrome/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "brauzer";
  const viewer = i.protocol === "content:" || (i.protocol === "file:" && (android || ios));
  return { ios, android, mac, win, inApp, viewer, browser };
}

export function detectEnv(): Env {
  if (typeof navigator === "undefined") return detectEnvFrom({ ua: "" });
  return detectEnvFrom({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    protocol: typeof location !== "undefined" ? location.protocol : "",
    hasTelegramProxy: typeof (globalThis as Record<string, unknown>).TelegramWebviewProxy !== "undefined",
  });
}
