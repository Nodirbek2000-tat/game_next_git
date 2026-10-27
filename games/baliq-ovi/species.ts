// Fish species of "Baliq ovi" (data only). Weights in kg, depth as a fraction of the local water depth (0 = surface, 1 = bottom).
// Texts are Uzbek (Latin). The short educational notes are meant for the encyclopedia; have a specialist review them before release.

export type TimeOfDay = "dawn" | "day" | "sunset";
export type JunkKind = "boot" | "bottle";

export interface SpeciesDef {
  id: string;
  name: string;
  icon: string;
  /** weight range, kg */
  w: [number, number];
  /** fight strength 0..1 (prototype `power`) */
  power: number;
  /** spawn weight (higher = more common) */
  rare: number;
  /** preferred depth band (fraction of local depth) */
  depth: [number, number];
  /** the fish only appears where the water is at least this deep (m) */
  minWater: number;
  /** activity multipliers by time of day (1 = normal) */
  active: Record<TimeOfDay, number>;
  /** typical school size (1 = loner) */
  school: number;
  /** body colours: back, belly, fin */
  col: string;
  belly: string;
  fin: string;
  stripe?: string;
  spots?: string;
  /** body proportions (metres at scale 1): length, height */
  len: number;
  h: number;
  /** shape hints for the procedural body */
  shape?: { tail?: number; head?: number; flatHead?: boolean; whiskers?: boolean; thick?: number; dorsalLong?: boolean };
  /** point multiplier */
  bonus?: number;
  junk?: JunkKind;
  /** shown when caught */
  msg?: string;
  /** encyclopedia text */
  info: string;
  /** kid friendly one-liner */
  kids: string;
}

const A = (dawn: number, day: number, sunset: number): Record<TimeOfDay, number> => ({ dawn, day, sunset });

export const SPECIES: SpeciesDef[] = [
  {
    id: "zogora", name: "Zog‘ora", icon: "🐟", w: [0.8, 4], power: 0.55, rare: 16, depth: [0.3, 0.8], minWater: 1.2, active: A(1.2, 1, 1.1), school: 3,
    col: "#b8902a", belly: "#f4e2a6", fin: "#a0522d", len: 0.42, h: 0.3,
    info: "Zog‘ora daryo va ko‘llarda yashaydigan kuchli, tez suzuvchi baliq. Qarmoqqa ilinganda qattiq tortadi.",
    kids: "Zog‘ora juda kuchli — qarmoqni tortib ketadi!",
  },
  {
    id: "sazan", name: "Sazan", icon: "🐠", w: [1, 7], power: 0.65, rare: 14, depth: [0.6, 1], minWater: 1.2, active: A(1.1, 1, 1.15), school: 2,
    col: "#7d6b30", belly: "#e8d9a0", fin: "#7a4a20", len: 0.5, h: 0.29, shape: { thick: 1.1, dorsalLong: true },
    info: "Sazan hamma narsani yeydi va 20 yildan ortiq yashashi mumkin. Odatda suv tubiga yaqin yuradi.",
    kids: "Sazan suv tubida sayr qilishni yaxshi ko‘radi.",
  },
  {
    id: "amur", name: "Oq amur", icon: "🐟", w: [2, 10], power: 0.72, rare: 9, depth: [0.2, 0.7], minWater: 1.5, active: A(1, 1.1, 1), school: 2,
    col: "#6f7f78", belly: "#e6ece8", fin: "#5f6f68", len: 0.62, h: 0.21,
    info: "Oq amur asosan suv o‘simliklari bilan oziqlanadi, shuning uchun ko‘l va kanallarni o‘tdan tozalaydi.",
    kids: "Oq amur o‘t yeydi — suvning bog‘boni!",
  },
  {
    id: "dongpeshona", name: "Do‘ngpeshona", icon: "🐟", w: [2, 12], power: 0.7, rare: 8, depth: [0.05, 0.4], minWater: 1.5, active: A(1.1, 1.1, 0.9), school: 4,
    col: "#8c969c", belly: "#eef2f2", fin: "#78858c", len: 0.6, h: 0.23, shape: { head: 1.25 },
    info: "Do‘ngpeshona suvdagi mayda plankton bilan oziqlanadi va ko‘pincha suv yuziga yaqin galalar bilan yuradi.",
    kids: "Do‘ngpeshona yuzaga yaqin galalar bilan suzadi.",
  },
  {
    id: "chortan", name: "Cho‘rtan", icon: "🐊", w: [1, 6], power: 0.75, rare: 9, depth: [0.1, 0.5], minWater: 1, active: A(1.3, 0.9, 1.3), school: 1,
    col: "#56732c", belly: "#e4ecc0", fin: "#8a5a2a", len: 0.72, h: 0.15, spots: "#d8e6a0", shape: { flatHead: true, head: 1.2, dorsalLong: true },
    info: "Cho‘rtan — o‘tkir tishli yirtqich. O‘t-o‘lanlar orasida poylab turib, mayda baliqqa to‘satdan tashlanadi.",
    kids: "Cho‘rtan o‘tlar orasida poylab yotadi.",
  },
  {
    id: "laqqa", name: "Laqqa", icon: "🐋", w: [4, 18], power: 0.95, rare: 5, depth: [0.7, 1], minWater: 3, active: A(1.3, 0.7, 1.4), school: 1,
    col: "#3a372f", belly: "#a39b8a", fin: "#2a2822", len: 0.86, h: 0.2, shape: { whiskers: true, flatHead: true, head: 1.3, thick: 1.15 },
    info: "Laqqa — chuchuk suvdagi eng yirik baliqlardan. Mo‘ylovlari bor, kunduzi chuqurda, kechqurun faolroq.",
    kids: "Laqqaning mo‘ylovlari bor va u juda katta o‘sadi!",
  },
  {
    id: "forel", name: "Forel", icon: "🐟", w: [0.5, 2.5], power: 0.5, rare: 10, depth: [0.2, 0.6], minWater: 1.5, active: A(1.4, 0.8, 1.3), school: 2,
    col: "#7f97aa", belly: "#f3ecec", fin: "#6a7a8a", len: 0.46, h: 0.2, stripe: "#ff7aa0", spots: "#2b2b2b",
    info: "Forel toza, sovuq va kislorodga boy tog‘ suvida yashaydi. Suv ifloslansa, birinchi bo‘lib yo‘qoladi.",
    kids: "Forel faqat toza suvda yashaydi.",
  },
  {
    id: "sudak", name: "Sudak", icon: "🐟", w: [1, 6], power: 0.78, rare: 7, depth: [0.5, 0.95], minWater: 3, active: A(1.4, 0.7, 1.4), school: 1,
    col: "#8a8c6a", belly: "#e8e6cc", fin: "#6a6f4a", len: 0.64, h: 0.18, spots: "#4a4c36", shape: { head: 1.15, dorsalLong: true },
    info: "Sudak — toza, chuqur suvni yoqtiradigan yirtqich. Tong va shom payti faol ovlaydi.",
    kids: "Sudak chuqur va toza suvni yaxshi ko‘radi.",
  },
  {
    id: "ilonbosh", name: "Ilonbosh", icon: "🐍", w: [1, 5], power: 0.8, rare: 5, depth: [0.3, 0.8], minWater: 0.8, active: A(1, 1, 1.1), school: 1,
    col: "#5a5b32", belly: "#cfc99a", fin: "#4a4a28", len: 0.7, h: 0.13, spots: "#2f301c", shape: { flatHead: true, head: 1.1, dorsalLong: true },
    info: "Ilonbosh boshi ilonnikiga o‘xshaydi. U havodan ham nafas ola oladi, shuning uchun kam kislorodli suvda ham yashaydi.",
    kids: "Ilonbosh havodan nafas ola oladi!",
  },
  {
    id: "karas", name: "Karas", icon: "🐟", w: [0.2, 1.5], power: 0.4, rare: 14, depth: [0.4, 0.9], minWater: 0.8, active: A(1, 1.1, 1), school: 4,
    col: "#a08a4a", belly: "#ece0a8", fin: "#8a6a30", len: 0.3, h: 0.24, shape: { thick: 1.05 },
    info: "Karas juda chidamli: kislorodi kam, loyqa suvda ham yashay oladi. Kichik ko‘l va hovuzlarda ko‘p uchraydi.",
    kids: "Karas har qanday suvga ko‘nika oladi.",
  },
  {
    id: "oltin", name: "Oltin baliqcha", icon: "✨", w: [0.1, 0.3], power: 0.25, rare: 2, depth: [0.2, 0.6], minWater: 0.8, active: A(1, 1.1, 1), school: 1,
    col: "#ff9800", belly: "#ffe082", fin: "#ff6f00", len: 0.22, h: 0.15, bonus: 12, shape: { tail: 1.7, thick: 1.1 },
    msg: "Kamyob oltin baliqcha! Katta bonus!",
    info: "Oltin baliqcha — karasga yaqin baliqdan odamlar chiqargan zot. Tabiiy suvlarda juda kam uchraydi.",
    kids: "Oltin baliqcha juda kamyob — omadingiz kelibdi!",
  },
  {
    id: "etik", name: "Eski etik", icon: "👢", w: [0.6, 1.1], power: 0.2, rare: 4, depth: [0.9, 1], minWater: 0.8, active: A(1, 1, 1), school: 1,
    col: "#5d3a1a", belly: "#3a2410", fin: "#1a1a1a", len: 0.34, h: 0.3, bonus: 0.1, junk: "boot",
    msg: "Hazil! Kimdir etigini yo‘qotibdi 😄",
    info: "Eski etik baliq emas, albatta! Suvga tashlangan chiqindi suv hayvonlariga zarar keltiradi — tabiatni asraymiz.",
    kids: "Bu baliq emas, etik! Suvga axlat tashlamaymiz.",
  },
  {
    id: "shisha", name: "Shisha", icon: "🍾", w: [0.2, 0.4], power: 0.15, rare: 3, depth: [0.9, 1], minWater: 0.8, active: A(1, 1, 1), school: 1,
    col: "#3f9a6a", belly: "#2f7a52", fin: "#1a1a1a", len: 0.3, h: 0.1, bonus: 0.1, junk: "bottle",
    msg: "Shisha! Ko‘lni toza saqlaymiz 🌿",
    info: "Suvdagi shisha va boshqa chiqindilar baliqlarga xavfli. Ko‘l bo‘yida axlatni o‘zingiz bilan olib keting.",
    kids: "Shisha — chiqindi. Tabiatni toza saqlaymiz!",
  },
];

export const SPECIES_BY_ID: Record<string, SpeciesDef> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
export const speciesIndex = (id: string): number => SPECIES.findIndex((s) => s.id === id);
export const isJunk = (s: SpeciesDef): boolean => !!s.junk;
/** Real fish (not boots or bottles). */
export const FISH_SPECIES = SPECIES.filter((s) => !s.junk);

export type Rng = () => number;

export interface PickContext {
  /** local water depth at the bait (m) */
  depth: number;
  tod: TimeOfDay;
  /** multiplier per species id from the location config */
  weights?: Record<string, number>;
  /** location bonus for large fish (1 = lake) */
  bigFishBoost?: number;
  rng: Rng;
  /** debugging / tests: force a species */
  force?: string;
}

/** Weighted species choice for a bite: respects local depth, time of day and the location. */
export function pickSpecies(ctx: PickContext): SpeciesDef {
  if (ctx.force && SPECIES_BY_ID[ctx.force]) return SPECIES_BY_ID[ctx.force];
  let total = 0;
  const w = SPECIES.map((s) => {
    if (ctx.depth < s.minWater) return 0;
    const v = s.rare * s.active[ctx.tod] * (ctx.weights?.[s.id] ?? 1) * (s.w[1] > 8 ? (ctx.bigFishBoost ?? 1) : 1);
    total += v;
    return v;
  });
  if (total <= 0) return SPECIES_BY_ID.karas;
  let r = ctx.rng() * total;
  for (let i = 0; i < SPECIES.length; i++) {
    r -= w[i];
    if (r <= 0) return SPECIES[i];
  }
  return SPECIES[0];
}

/** Random weight inside the species range (skewed to the small side). */
export function rollWeight(s: SpeciesDef, rng: Rng): number {
  const k = rng() * rng() * 0.6 + rng() * 0.4;
  const w = s.w[0] + (s.w[1] - s.w[0]) * k;
  return Math.round(w * 100) / 100;
}
