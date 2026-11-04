// Pure helpers of "Rangni top" (the screen is split into coloured zones, children run to the called colour).

export interface ZoneColor {
  name: string;
  fill: string;
  emoji: string;
}

export const COLORS: readonly ZoneColor[] = [
  { name: "Qizil", fill: "#ff4d4d", emoji: "🍎" },
  { name: "Ko‘k", fill: "#3d8bff", emoji: "🫐" },
  { name: "Sariq", fill: "#ffd23d", emoji: "🍋" },
  { name: "Yashil", fill: "#4fc464", emoji: "🍏" },
];

/** 2 zones for one or two children, 3 for a bigger group */
export const zoneCount = (kids: number): number => (kids >= 3 ? 3 : 2);

/** which vertical zone (0..zones-1, left to right) an x position is in */
export function zoneOf(x: number, stageW: number, zones: number): number {
  const z = Math.floor((x / stageW) * zones);
  return z < 0 ? 0 : z >= zones ? zones - 1 : z;
}

/** fills `out[0..zones-1]` with distinct colour indices in random order (Fisher-Yates on a small pool) */
export function shuffleColors(out: number[], zones: number, rnd: () => number): void {
  const pool = [0, 1, 2, 3];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  for (let i = 0; i < zones; i++) out[i] = pool[i];
}

/** the zone that is called; never the same one twice in a row when there is a choice */
export function pickTarget(zones: number, prev: number, rnd: () => number): number {
  let z = Math.floor(rnd() * zones);
  if (zones > 1 && z === prev) z = (z + 1 + Math.floor(rnd() * (zones - 1))) % zones;
  return z;
}
