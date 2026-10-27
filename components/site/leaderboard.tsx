import { cn } from "@/lib/utils";

export interface LeaderboardEntry {
  rank: number;
  nick: string;
  score: number;
  gameTitle?: string;
}

const MEDAL = ["🥇", "🥈", "🥉"];

/**
 * Ranking list. There is no backend yet, so callers pass nothing and the empty state is shown.
 * When the API exists, pass `entries` (already sorted) - no other change needed.
 */
export function Leaderboard({
  entries,
  title = "Haftalik reyting",
  limit = 10,
  className,
}: {
  entries?: LeaderboardEntry[];
  title?: string;
  limit?: number;
  className?: string;
}) {
  const rows = (entries ?? []).slice(0, limit);
  return (
    <div className={cn("glass rounded-3xl p-5 sm:p-7", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-bold">{title}</h3>
        <span className="text-sm font-bold text-muted">Top {limit}</span>
      </div>
      {rows.length === 0 ? (
        <div className="mt-5 flex flex-col items-center px-4 py-12 text-center">
          <svg viewBox="0 0 64 64" className="size-20 text-brand" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 8h24v16a12 12 0 0 1-24 0zM20 14H9c0 10 4 15 11 16M44 14h11c0 10-4 15-11 16M32 36v10M22 56h20M26 46h12" />
          </svg>
          <p className="mt-4 text-xl font-extrabold">Tez orada</p>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {rows.map((r) => (
            <li key={`${r.rank}-${r.nick}`} className="flex min-h-12 items-center gap-3 py-2">
              <span className="w-8 text-center font-display font-bold">{MEDAL[r.rank - 1] ?? r.rank}</span>
              <span className="flex-1 truncate font-bold">{r.nick}</span>
              {r.gameTitle && <span className="hidden text-sm text-muted sm:inline">{r.gameTitle}</span>}
              <span className="font-display font-bold tabular-nums">{r.score.toLocaleString("uz-UZ")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
