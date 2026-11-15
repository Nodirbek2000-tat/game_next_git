"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError, useAccount } from "@/lib/account/store";
import { GAMES } from "@/lib/games";

type Tab = "stats" | "users" | "bogcha" | "payments" | "settings";
const TABS: [Tab, string][] = [
  ["stats", "📊 Statistika"],
  ["users", "👤 Foydalanuvchilar"],
  ["bogcha", "🐰 Bog‘cha"],
  ["payments", "🧾 To‘lovlar"],
  ["settings", "⚙️ Sozlamalar"],
];

const card = "glass rounded-[1.5rem] p-4 sm:p-5";
const field = "glass h-11 w-full rounded-xl px-3 text-base font-semibold";
const fmt = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");
const date = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("uz-UZ") : "—");

/** an error line; the setters are stable (they are effect dependencies) */
function useError(): [string, (e: unknown) => void, () => void] {
  const [error, setError] = useState("");
  const onError = useCallback((e: unknown) => setError(e instanceof ApiError ? e.message : "Xatolik"), []);
  const clear = useCallback(() => setError(""), []);
  return [error, onError, clear];
}

/** /boshqaruv: only for admins. Statistics, users (roles, premium, devices, passwords), kindergarten accounts, payments, settings. */
export function AdminPanel() {
  const router = useRouter();
  const { ready, me, load } = useAccount();
  const [tab, setTab] = useState<Tab>("stats");
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (ready && !me) router.replace("/kirish?next=/boshqaruv");
  }, [ready, me, router]);
  if (!ready || !me) return <div className="min-h-[60dvh]" />;
  if (!me.isAdmin) return <p className="py-20 text-center text-xl font-bold">Bu sahifa faqat adminlar uchun.</p>;
  return (
    <div className="mx-auto max-w-[72rem] px-4 pb-14 pt-6 sm:px-8">
      <h1 className="font-display text-[clamp(2rem,6vw,3rem)] font-extrabold">🛠 Admin panel</h1>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="glass min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold"
            style={tab === t ? { background: "var(--brand)", color: "var(--brand-fg)" } : undefined}
            data-testid={`admin-tab-${t}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === "stats" && <Stats />}
        {tab === "users" && <Users />}
        {tab === "bogcha" && <Bogcha />}
        {tab === "payments" && <Payments />}
        {tab === "settings" && <Settings />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- statistics

interface StatsData {
  users: Record<string, number>;
  visits: Record<string, number>;
  plays: { total: number; today: number; players: number; playersToday: number; games: { slug: string; title: string; plays: number; people: number; today: number }[] };
  payments: { pending: number };
  days: { day: string; people: number; visits: number; plays: number; newUsers: number }[];
}

function Num({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className={card}>
      <div className="text-xs font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="font-display text-3xl font-extrabold">{typeof value === "number" ? fmt(value) : value}</div>
      {sub && <div className="text-xs font-semibold text-muted">{sub}</div>}
    </div>
  );
}

function Stats() {
  const [s, setS] = useState<StatsData | null>(null);
  const [error, onError] = useError();
  const refresh = useCallback(() => {
    api<StatsData>("admin/stats").then(setS, onError);
  }, [onError]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);
  if (error) return <p className="font-bold text-red-500">{error}</p>;
  if (!s) return <p className="text-muted">Yuklanmoqda…</p>;
  const max = Math.max(1, ...s.days.map((d) => d.people));
  return (
    <div className="grid gap-4" data-testid="admin-stats">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Num label="Foydalanuvchilar" value={s.users.total} sub={`bugun yangi: ${s.users.newToday}`} />
        <Num label="Bugun faol" value={s.users.activeToday} sub={`botda: ${s.users.botActive}`} />
        <Num label="Premium" value={s.users.premium} sub={`bog‘cha: ${s.users.bogcha} · admin: ${s.users.admins}`} />
        <Num label="Tasdiq kutmoqda" value={s.payments.pending} sub="to‘lov cheklari" />
        <Num label="Bugun kirdi" value={s.visits.peopleToday} sub={`${fmt(s.visits.today)} marta`} />
        <Num label="Jami kirgan" value={s.visits.people} sub={`${fmt(s.visits.total)} marta`} />
        <Num label="Bugun o‘ynaldi" value={s.plays.today} sub={`${s.plays.playersToday} kishi`} />
        <Num label="Jami o‘ynaldi" value={s.plays.total} sub={`${s.plays.players} kishi`} />
      </div>
      <div className={card}>
        <div className="font-bold">Oxirgi 7 kun — kirgan odamlar</div>
        <div className="mt-3 flex h-36 items-end justify-between gap-2">
          {s.days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs font-bold">{d.people}</span>
              <div className="w-full max-w-10 rounded-lg" style={{ height: `${Math.max(4, (d.people / max) * 100)}px`, background: "var(--brand)" }} title={`${d.visits} marta, ${d.plays} o‘yin, ${d.newUsers} yangi`} />
              <span className="text-[11px] font-semibold text-muted">{d.day.slice(5).replace("-", ".")}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={card}>
        <div className="font-bold">Necha marta kirgan</div>
        <div className="mt-2 flex flex-wrap gap-4 text-base font-semibold">
          <span>1 marta: {s.visits.once}</span>
          <span>2 marta: {s.visits.twice}</span>
          <span>3+ marta: {s.visits.threePlus}</span>
          <span>7 kunda: {s.visits.peopleWeek} kishi</span>
        </div>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <div className="font-bold">O‘yinlar</div>
        <table className="mt-2 w-full min-w-[28rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1.5">O‘yin</th>
              <th>Jami</th>
              <th>Kishi</th>
              <th>Bugun</th>
            </tr>
          </thead>
          <tbody>
            {s.plays.games.map((g) => (
              <tr key={g.slug} className="border-t border-current/10 font-semibold">
                <td className="py-1.5">{g.title}</td>
                <td>{fmt(g.plays)}</td>
                <td>{fmt(g.people)}</td>
                <td>{fmt(g.today)}</td>
              </tr>
            ))}
            {s.plays.games.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-muted">
                  Hali o‘ynalmagan
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- users

interface Row {
  id: number;
  username: string;
  name: string;
  role: string;
  isAdmin: boolean;
  premium: boolean;
  premiumUntil: string | null;
  telegram: boolean;
  telegramUsername: string;
  devices: number;
  deviceLimit: number;
  created: string;
  lastSeen: string | null;
}

function Users() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: Row[]; total: number; pages: number } | null>(null);
  const [error, onError, clear] = useError();
  const [notice, setNotice] = useState("");
  const loadUsers = useCallback(() => {
    api<{ users: Row[]; total: number; pages: number }>(`admin/users?q=${encodeURIComponent(q)}&role=${role}&page=${page}`).then(setData, onError);
  }, [q, role, page, onError]);
  useEffect(() => {
    const t = setTimeout(loadUsers, 250);
    return () => clearTimeout(t);
  }, [loadUsers]);
  const change = async (u: Row, body: Record<string, unknown>, label: string): Promise<void> => {
    clear();
    setNotice("");
    try {
      const r = await api<{ user: Row; password?: string }>(`admin/users/${u.id}`, { body });
      setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? r.user : x)) } : d));
      setNotice(r.password ? `${u.username}: yangi parol — ${r.password}` : `${u.username}: ${label}`);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className="grid gap-3" data-testid="admin-users">
      <div className="flex flex-wrap gap-2">
        <input className={`${field} max-w-xs`} placeholder="Qidirish: login, ism, @telegram" value={q} onChange={(e) => (setPage(1), setQ(e.target.value))} />
        <select className={`${field} w-auto`} value={role} onChange={(e) => (setPage(1), setRole(e.target.value))}>
          <option value="">Hammasi</option>
          <option value="user">Oddiy</option>
          <option value="bogcha">Bog‘cha</option>
          <option value="admin">Admin</option>
        </select>
        {data && <span className="self-center text-sm font-semibold text-muted">Jami: {data.total}</span>}
      </div>
      {notice && <p className="rounded-xl bg-green-500/15 px-4 py-2 font-bold">{notice}</p>}
      {error && <p className="font-bold text-red-500">{error}</p>}
      <div className="grid gap-2">
        {data?.users.map((u) => (
          <div key={u.id} className={`${card} flex flex-col gap-2 sm:flex-row sm:items-center`}>
            <div className="min-w-0 flex-1">
              <div className="font-bold">
                {u.premium ? "💎 " : ""}
                {u.name} <span className="font-semibold text-muted">· {u.username}</span>
                {u.telegramUsername && <span className="font-semibold text-muted"> · @{u.telegramUsername}</span>}
              </div>
              <div className="text-xs font-semibold text-muted">
                {u.role === "admin" ? "Admin" : u.role === "bogcha" ? "Bog‘cha" : "Oddiy"} · premium: {u.premium ? (u.premiumUntil ? date(u.premiumUntil) + " gacha" : "bor") : "yo‘q"} · qurilma {u.devices}/{u.deviceLimit} · oxirgi: {date(u.lastSeen)}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <select className="glass h-9 rounded-lg px-2 text-sm font-bold" value={u.role} onChange={(e) => change(u, { role: e.target.value }, "rol o‘zgardi")}>
                <option value="user">Oddiy</option>
                <option value="bogcha">Bog‘cha</option>
                <option value="admin">Admin</option>
              </select>
              <button className="glass h-9 rounded-lg px-2.5 text-sm font-bold" onClick={() => change(u, { premiumDays: 30 }, "+30 kun premium")}>
                +30 kun
              </button>
              <button className="glass h-9 rounded-lg px-2.5 text-sm font-bold" onClick={() => change(u, { premiumClear: true }, "premium olib tashlandi")}>
                Premium ✕
              </button>
              <button className="glass h-9 rounded-lg px-2.5 text-sm font-bold" onClick={() => change(u, { resetDevices: true }, "qurilmalar tozalandi")}>
                Qurilmalar ✕
              </button>
              <button className="glass h-9 rounded-lg px-2.5 text-sm font-bold" onClick={() => change(u, { newPassword: true }, "")}>
                Yangi parol
              </button>
            </div>
          </div>
        ))}
      </div>
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ←
          </Button>
          <span className="font-bold">
            {page} / {data.pages}
          </span>
          <Button variant="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            →
          </Button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- kindergartens

function Bogcha() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [days, setDays] = useState(365);
  const [made, setMade] = useState<{ username: string; password: string } | null>(null);
  const [error, onError, clear] = useError();
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    clear();
    try {
      const r = await api<{ username: string; password: string }>("admin/bogcha", { body: { name, username, premiumDays: days } });
      setMade(r);
      setName("");
      setUsername("");
    } catch (err) {
      onError(err);
    }
  };
  return (
    <div className="grid max-w-xl gap-4">
      <form onSubmit={submit} className={`${card} grid gap-3`} data-testid="admin-bogcha">
        <div className="font-bold">Bog‘cha uchun akkaunt (10 ta qurilmagacha)</div>
        <input className={field} placeholder="Bog‘cha nomi, masalan: 12-son bog‘cha" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={field} placeholder="Login (ixtiyoriy, bo‘lmasa o‘zi tuziladi)" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="flex items-center gap-2 font-semibold">
          Premium:
          <input className={`${field} w-28`} type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} /> kun
        </label>
        {error && <p className="font-bold text-red-500">{error}</p>}
        <Button type="submit">Yaratish</Button>
      </form>
      {made && (
        <div className={card} style={{ borderColor: "#22c55e88" }}>
          <div className="font-bold">✅ Yaratildi — bog‘chaga shu ma’lumotni bering:</div>
          <div className="mt-2 font-mono text-lg">
            Login: <b>{made.username}</b>
            <br />
            Parol: <b>{made.password}</b>
          </div>
          <p className="mt-2 text-sm font-semibold text-muted">Parol faqat hozir ko‘rinadi. Yo‘qolsa, «Foydalanuvchilar» bo‘limida «Yangi parol» bosing.</p>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- payments

interface Pay {
  id: number;
  user: string;
  userId: number;
  amount: number;
  days: number;
  status: string;
  created: string;
  decidedBy: string;
}

function Payments() {
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState<Pay[] | null>(null);
  const [error, onError, clear] = useError();
  const loadPays = useCallback(() => {
    api<{ payments: Pay[] }>(`admin/payments?status=${status}`).then((r) => setList(r.payments), onError);
  }, [status, onError]);
  useEffect(() => {
    loadPays();
  }, [loadPays]);
  const decide = async (p: Pay, approve: boolean): Promise<void> => {
    clear();
    try {
      await api(`admin/payments/${p.id}`, { body: { approve } });
      loadPays();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        {[
          ["pending", "Kutilmoqda"],
          ["approved", "Tasdiqlangan"],
          ["rejected", "Rad etilgan"],
        ].map(([s, label]) => (
          <button key={s} className="glass min-h-10 rounded-xl px-3 text-sm font-bold" style={status === s ? { background: "var(--brand)", color: "var(--brand-fg)" } : undefined} onClick={() => setStatus(s)}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm font-semibold text-muted">Chek rasmlari Telegram botda adminlarga keladi; u yerda yoki shu yerda tasdiqlash mumkin.</p>
      {error && <p className="font-bold text-red-500">{error}</p>}
      {list?.length === 0 && <p className="text-muted">Bo‘sh</p>}
      {list?.map((p) => (
        <div key={p.id} className={`${card} flex flex-wrap items-center gap-3`}>
          <div className="min-w-0 flex-1">
            <div className="font-bold">
              #{p.id} · {p.user}
            </div>
            <div className="text-xs font-semibold text-muted">
              {fmt(p.amount)} so‘m · {p.days} kun · {new Date(p.created).toLocaleString("uz-UZ")}
              {p.decidedBy && ` · ${p.decidedBy}`}
            </div>
          </div>
          {p.status === "pending" && (
            <div className="flex gap-2">
              <Button onClick={() => decide(p, true)}>✅ Tasdiqlash</Button>
              <Button variant="secondary" onClick={() => decide(p, false)}>
                ❌ Rad etish
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- settings

interface SettingsData {
  monthlyPrice: number;
  cardNumber: string;
  cardHolder: string;
  bogchaPhone: string;
  freeGames: string[];
}

function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, onError, clear] = useError();
  const reloadAccount = useAccount((st) => st.load);
  useEffect(() => {
    api<SettingsData>("admin/settings").then(setS, onError);
  }, [onError]);
  if (!s) return error ? <p className="font-bold text-red-500">{error}</p> : <p className="text-muted">Yuklanmoqda…</p>;
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    clear();
    setSaved(false);
    try {
      setS(await api<SettingsData>("admin/settings", { body: s }));
      setSaved(true);
      void reloadAccount();
    } catch (err) {
      onError(err);
    }
  };
  const games = GAMES.filter((g) => !g.hidden || g.slug === "fitnes");
  return (
    <form onSubmit={save} className="grid max-w-3xl gap-4" data-testid="admin-settings">
      <div className={`${card} grid gap-3 sm:grid-cols-2`}>
        <label className="grid gap-1 font-semibold">
          Oylik premium narxi (so‘m)
          <input className={field} type="number" min={0} value={s.monthlyPrice} onChange={(e) => setS({ ...s, monthlyPrice: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="grid gap-1 font-semibold">
          Bog‘chalar uchun telefon (footerda)
          <input className={field} value={s.bogchaPhone} placeholder="+998 90 123 45 67" onChange={(e) => setS({ ...s, bogchaPhone: e.target.value })} />
        </label>
        <label className="grid gap-1 font-semibold">
          Karta raqami (botda chiqadi)
          <input className={field} value={s.cardNumber} placeholder="8600 0000 0000 0000" onChange={(e) => setS({ ...s, cardNumber: e.target.value })} />
        </label>
        <label className="grid gap-1 font-semibold">
          Karta egasi
          <input className={field} value={s.cardHolder} onChange={(e) => setS({ ...s, cardHolder: e.target.value })} />
        </label>
      </div>
      <div className={card}>
        <div className="font-bold">Bepul o‘yinlar (qolganlari premium)</div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {games.map((g) => {
            const on = s.freeGames.includes(g.slug);
            return (
              <label key={g.slug} className="glass flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold">
                <input type="checkbox" checked={on} onChange={() => setS({ ...s, freeGames: on ? s.freeGames.filter((x) => x !== g.slug) : [...s.freeGames, g.slug] })} />
                <span aria-hidden="true">{g.icon}</span> {g.title}
              </label>
            );
          })}
        </div>
      </div>
      {error && <p className="font-bold text-red-500">{error}</p>}
      {saved && <p className="font-bold text-green-600">✅ Saqlandi</p>}
      <Button type="submit" size="lg">
        Saqlash
      </Button>
    </form>
  );
}
