"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError, useAccount, type Me } from "@/lib/account/store";

type Tab = "telegram" | "login";

/** where to go after signing in: only paths of this site */
function nextPath(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/** /kirish: Telegram (one tap in the bot; a new account is made there), or login + password (from the bot, or from the admin for a kindergarten). */
export function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = nextPath(params.get("next"));
  const { me, ready, load, signedIn } = useAccount();
  const [tab, setTab] = useState<Tab>("telegram");

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (ready && me) router.replace(next);
  }, [ready, me, next, router]);

  const done = (token: string, m: Me): void => {
    signedIn(token, m);
    router.replace(next);
  };

  return (
    <div className="mx-auto max-w-md px-5 pb-14 pt-8 sm:pt-12">
      <h1 className="text-center font-display text-[clamp(2.2rem,7vw,3.2rem)] font-extrabold leading-tight">Kirish</h1>
      <p className="mt-2 text-center text-base font-medium text-muted">O‘ynash uchun akkauntga kiring — bir marta, keyin eslab qolinadi. Yangi akkaunt Telegram orqali o‘zi ochiladi.</p>
      <div className="glass mt-6 grid grid-cols-2 gap-1 rounded-2xl p-1" role="tablist">
        {(
          [
            ["telegram", "Telegram"],
            ["login", "Login va parol"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="min-h-11 rounded-xl px-2 text-sm font-bold transition-colors"
            style={tab === t ? { background: "var(--brand)", color: "var(--brand-fg)" } : undefined}
            data-testid={`signin-tab-${t}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="glass mt-4 rounded-[1.75rem] p-5 sm:p-6">
        {tab === "telegram" && <TelegramSignIn onDone={done} />}
        {tab === "login" && <PasswordForm onDone={done} />}
      </div>
    </div>
  );
}

function TelegramSignIn({ onDone }: { onDone: (token: string, me: Me) => void }) {
  const [state, setState] = useState<"idle" | "waiting" | "error">("idle");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const start = async (): Promise<void> => {
    setError("");
    // the tab must be opened inside the click (pop-up blockers), its address set once the code is there
    const win = window.open("", "_blank");
    try {
      const r = await api<{ code: string; url: string }>("auth/telegram", { body: {} });
      if (win) win.location.href = r.url;
      else window.location.href = r.url;
      setState("waiting");
      const poll = async (): Promise<void> => {
        try {
          const res = await api<{ token?: string; me?: Me; pending?: boolean }>(`auth/telegram?code=${encodeURIComponent(r.code)}`);
          if (res.token && res.me) return onDone(res.token, res.me);
          timer.current = setTimeout(poll, 1500);
        } catch (e) {
          setState("error");
          setError(e instanceof ApiError ? e.message : "Xatolik");
        }
      };
      timer.current = setTimeout(poll, 1500);
    } catch (e) {
      win?.close();
      setState("error");
      setError(e instanceof ApiError ? e.message : "Xatolik");
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-20 items-center justify-center rounded-[1.5rem] text-5xl" style={{ background: "#229ED91f" }} aria-hidden="true">
        ✈️
      </div>
      {state !== "waiting" ? (
        <>
          <p className="text-base font-medium text-muted">Telegram botimiz ochiladi — «Start» ni bossangiz, shu yerda avtomatik kirasiz.</p>
          <Button size="lg" className="w-full" onClick={start} data-testid="signin-telegram" style={{ background: "#229ED9" }}>
            Telegram orqali kirish
          </Button>
        </>
      ) : (
        <>
          <p className="text-lg font-bold">Telegramda «Start» ni bosing…</p>
          <p className="text-sm font-medium text-muted">Tasdiqlangach, bu sahifa o‘zi ochiladi.</p>
          <div className="size-8 animate-spin rounded-full border-4 border-current border-t-transparent opacity-50" aria-hidden="true" />
        </>
      )}
      {error && <p className="text-sm font-bold text-red-500">{error}</p>}
    </div>
  );
}

function PasswordForm({ onDone }: { onDone: (token: string, me: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string; me: Me }>("auth/login", { body: { username, password } });
      onDone(r.token, r.me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik");
    } finally {
      setBusy(false);
    }
  };
  const field = "glass h-12 w-full rounded-2xl px-4 text-base font-semibold";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input className={field} placeholder="Login" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={30} data-testid="signin-username" />
      <input className={field} type="password" placeholder="Parol" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required data-testid="signin-password" />
      {error && <p className="text-sm font-bold text-red-500">{error}</p>}
      <Button size="lg" type="submit" disabled={busy} data-testid="signin-submit">
        {busy ? "…" : "Kirish"}
      </Button>
      <p className="text-center text-sm font-medium text-muted">Login va parolni Telegram botimizdagi «🔑 Login va parol» tugmasi beradi. Bog‘chalarga — admin.</p>
    </form>
  );
}
