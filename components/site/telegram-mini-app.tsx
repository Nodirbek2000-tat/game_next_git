"use client";

import { useEffect } from "react";
import { api, getToken, useAccount, type Me } from "@/lib/account/store";

// The site opened as a Telegram Mini App (the bot's "🎮 O‘ynash" button): Telegram's script makes it full screen on phones and
// computers, keeps a swipe from closing it in the middle of a game, and the user is signed in by Telegram's signed initData
// without pressing anything. Outside Telegram nothing is loaded.

interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  isVersionAtLeast?: (v: string) => boolean;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
}

const SCRIPT = "https://telegram.org/js/telegram-web-app.js?59";
const FLAG = "harakat.tg";

/** opened by Telegram? (it adds #tgWebAppData=... to the first address; remembered for the rest of the visit) */
function inTelegram(): boolean {
  try {
    if (location.hash.includes("tgWebAppData") || new URLSearchParams(location.search).get("tg") === "1") {
      sessionStorage.setItem(FLAG, "1");
      return true;
    }
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function loadScript(): Promise<TgWebApp | null> {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  if (w.Telegram?.WebApp) return Promise.resolve(w.Telegram.WebApp);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(w.Telegram?.WebApp ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

export function TelegramMiniApp() {
  const signedIn = useAccount((s) => s.signedIn);
  useEffect(() => {
    if (!inTelegram()) return;
    document.documentElement.dataset.tg = "1";
    let cancelled = false;
    void loadScript().then(async (wa) => {
      if (!wa || cancelled) return;
      wa.ready();
      wa.expand();
      try {
        if (wa.isVersionAtLeast?.("8.0")) wa.requestFullscreen?.();
        if (wa.isVersionAtLeast?.("7.7")) wa.disableVerticalSwipes?.();
        wa.setHeaderColor?.("#0a0817");
        wa.setBackgroundColor?.("#0a0817");
      } catch {
        /* an older Telegram: it simply stays expanded */
      }
      // sign in with Telegram's signature (no token yet, or the old one was signed out)
      if (!getToken() && wa.initData) {
        try {
          const r = await api<{ token: string; me: Me }>("auth/webapp", { body: { initData: wa.initData } });
          if (!cancelled) signedIn(r.token, r.me);
        } catch {
          /* the /kirish page still works */
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return null;
}
