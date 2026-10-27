import Link from "next/link";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 font-display font-extrabold ${className ?? ""}`} aria-label="Harakat o‘yinlari — bosh sahifa">
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#logo-g)" />
        <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="17" r="5" fill="#fff" />
          <path d="M32 24v16M32 29L18 20M32 29l14-9M32 40l-9 14M32 40l9 14" />
        </g>
      </svg>
      <span className="text-[0.95rem] leading-tight tracking-tight">
        Harakat <span className="text-gradient">o‘yinlari</span>
      </span>
    </Link>
  );
}
