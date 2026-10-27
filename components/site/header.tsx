import Link from "next/link";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  return (
    <header className="relative z-40">
      <div className="mx-auto flex max-w-[72rem] items-center gap-3 px-5 py-4 sm:px-8">
        <Logo />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/bogcha"
            data-testid="nav-bogcha"
            className="glass inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <span aria-hidden="true">🐰</span> Bog‘cha
          </Link>
          <Link
            href="/sozlamalar"
            aria-label="Sozlamalar"
            title="Sozlamalar"
            className="glass inline-flex size-12 items-center justify-center rounded-2xl transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2.5" />
              <circle cx="8" cy="17" r="2.5" />
            </svg>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
