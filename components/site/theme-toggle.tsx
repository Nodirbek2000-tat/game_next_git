"use client";

type Pref = "system" | "light" | "dark";
const ORDER: Pref[] = ["system", "light", "dark"];
const LABEL: Record<Pref, string> = { system: "tizim", light: "yorug‘", dark: "qorong‘i" };

function apply(pref: Pref) {
  const root = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePref = pref;
  try {
    if (pref === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", pref);
  } catch {
    /* storage blocked: theme just won't persist */
  }
}

/** Cycles system -> light -> dark. Icon state is driven by CSS from html[data-theme-pref], so there is no hydration flicker. */
export function ThemeToggle() {
  const next = () => {
    const cur = (document.documentElement.dataset.themePref as Pref) || "system";
    apply(ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]);
  };
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <button
      type="button"
      onClick={next}
      className="glass inline-flex size-12 items-center justify-center rounded-2xl transition-transform hover:-translate-y-0.5 active:scale-95"
      aria-label={`Mavzuni almashtirish (${ORDER.map((p) => LABEL[p]).join(" / ")})`}
      title="Mavzu: tizim / yorug‘ / qorong‘i"
    >
      <svg viewBox="0 0 24 24" className="theme-icon theme-icon-system size-6" {...stroke} aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
      <svg viewBox="0 0 24 24" className="theme-icon theme-icon-light size-6" {...stroke} aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg viewBox="0 0 24 24" className="theme-icon theme-icon-dark size-6" {...stroke} aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
