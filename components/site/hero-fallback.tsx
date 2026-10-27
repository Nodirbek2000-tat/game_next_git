/** Static/CSS-animated hero art. Renders instantly (it is the LCP element) and is the permanent fallback on weak devices. */
export function HeroFallback() {
  return (
    <svg viewBox="0 0 400 400" className="size-full" role="img" aria-label="Suvda suzib turgan poplavok">
      <defs>
        <radialGradient id="hf-water" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#22d3ee" stopOpacity=".55" />
          <stop offset=".6" stopColor="#7c3aed" stopOpacity=".3" />
          <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hf-bob" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff4d6d" />
          <stop offset=".5" stopColor="#ff4d6d" />
          <stop offset=".5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6e1ff" />
        </linearGradient>
      </defs>
      <ellipse cx="200" cy="262" rx="190" ry="78" fill="url(#hf-water)" />
      <g fill="none" stroke="#67e8f9" strokeWidth="2.5">
        <ellipse className="anim-ripple" cx="200" cy="262" rx="120" ry="40" />
        <ellipse className="anim-ripple" style={{ animationDelay: "0.9s" }} cx="200" cy="262" rx="120" ry="40" />
        <ellipse className="anim-ripple" style={{ animationDelay: "1.8s" }} cx="200" cy="262" rx="120" ry="40" />
      </g>
      <g className="anim-bob">
        <path d="M200 40v100" stroke="#a78bfa" strokeWidth="2" strokeDasharray="3 5" />
        <rect x="196" y="140" width="8" height="46" rx="4" fill="#fbbf24" />
        <ellipse cx="200" cy="222" rx="38" ry="46" fill="url(#hf-bob)" stroke="#19133a" strokeOpacity=".25" strokeWidth="2" />
        <ellipse cx="186" cy="204" rx="8" ry="14" fill="#fff" opacity=".55" />
        <path d="M168 262q32 12 64 0" fill="none" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g fill="#fbbf24" opacity=".9">
        <circle cx="70" cy="110" r="3" className="anim-bob" />
        <circle cx="338" cy="150" r="2.5" className="anim-bob" style={{ animationDelay: ".7s" }} />
        <circle cx="300" cy="64" r="3.5" className="anim-bob" style={{ animationDelay: "1.2s" }} />
      </g>
    </svg>
  );
}
