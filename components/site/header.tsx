import Link from "next/link";
import { AccountNav } from "@/components/account/account-nav";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  return (
    <header className="relative z-40">
      <div className="mx-auto flex max-w-[72rem] items-center gap-2 px-4 py-4 sm:gap-3 sm:px-8">
        <Logo />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <AccountNav />
          <Link
            href="/fitnes"
            data-testid="nav-fitnes"
            className="glass inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold sm:px-4 transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <span aria-hidden="true">💪</span>{" "}
            <span className="hidden sm:inline">Fitnes</span>
          </Link>
          <Link
            href="/bogcha"
            data-testid="nav-bogcha"
            className="glass inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold sm:px-4 transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <span aria-hidden="true">🐰</span>{" "}
            <span className="hidden sm:inline">Bog‘cha</span>
          </Link>
          {/* phones: settings and theme live on the profile page (the header has no room) */}
          <div className="hidden items-center gap-2 sm:flex">
            <Link
              href="/sozlamalar"
              aria-label="Sozlamalar"
              title="Sozlamalar"
              className="glass inline-flex size-12 items-center justify-center rounded-2xl transition-transform hover:-translate-y-0.5 active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2.5" />
                <circle cx="8" cy="17" r="2.5" />
              </svg>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
