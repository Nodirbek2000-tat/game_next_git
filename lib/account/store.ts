"use client";

// The signed-in account on this device: the token (localStorage), who it is (/api/me) and the public site config (free games,
// price, kindergarten phone). Every page reads it from this one store; it is loaded once and refreshed after sign-in / out.

import { create } from "zustand";

export interface Me {
  id: number;
  username: string;
  name: string;
  role: "user" | "bogcha" | "admin";
  isAdmin: boolean;
  premium: boolean;
  premiumUntil: string | null;
  telegram: boolean;
  devices: number;
  deviceLimit: number;
}

export interface SiteConfig {
  freeGames: string[];
  monthlyPrice: number;
  bogchaPhone: string;
  botUsername: string;
}

const TOKEN_KEY = "harakat.token";
const DEFAULT_CONFIG: SiteConfig = { freeGames: ["meva-ninja", "pufakchalar", "fitnes"], monthlyPrice: 0, bogchaPhone: "", botUsername: "moveandplay_bot" };

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON call to the backend (/api/..., same site); the token goes along when there is one */
export async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T & { ok?: boolean }> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
  } catch {
    throw new ApiError(0, "Internet bilan aloqa yo‘q");
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok && res.status !== 202) throw new ApiError(res.status, (data.error as string) || `Xatolik (${res.status})`);
  return data as T & { ok?: boolean };
}

interface AccountState {
  /** false until the first check finished (nothing account-specific is decided before) */
  ready: boolean;
  me: Me | null;
  config: SiteConfig;
  load: () => Promise<void>;
  signedIn: (token: string, me: Me) => void;
  logout: () => Promise<void>;
  /** may this visitor play `slug`? free games: everybody (also without signing in); the rest: a premium account */
  canPlay: (slug: string) => boolean;
}

let loading: Promise<void> | null = null;

export const useAccount = create<AccountState>((set, get) => ({
  ready: false,
  me: null,
  config: DEFAULT_CONFIG,
  load: () => {
    if (loading) return loading;
    loading = (async () => {
      const [meRes, cfg] = await Promise.allSettled([getToken() ? api<{ me: Me }>("me") : Promise.reject(new ApiError(401, "")), api<SiteConfig>("config")]);
      let me: Me | null = null;
      if (meRes.status === "fulfilled") me = meRes.value.me;
      else if (meRes.reason instanceof ApiError && meRes.reason.status === 401) setToken(null);
      else if (getToken()) me = get().me; // offline: keep what we had
      set({ ready: true, me, config: cfg.status === "fulfilled" ? { ...DEFAULT_CONFIG, ...cfg.value } : get().config });
    })().finally(() => {
      loading = null;
    });
    return loading;
  },
  signedIn: (token, me) => {
    setToken(token);
    set({ me, ready: true });
  },
  logout: async () => {
    try {
      await api("auth/logout", { body: {} });
    } catch {
      /* already gone */
    }
    setToken(null);
    set({ me: null });
  },
  canPlay: (slug) => {
    const { me, config } = get();
    return config.freeGames.includes(slug) || !!me?.premium;
  },
}));

export const isFree = (config: SiteConfig, slug: string): boolean => config.freeGames.includes(slug);

export const botLink = (config: SiteConfig, start?: string): string => `https://t.me/${config.botUsername}${start ? `?start=${start}` : ""}`;
