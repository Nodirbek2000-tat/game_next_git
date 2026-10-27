// Single source of truth for the game catalogue, shared by the site pages and the engine.
// Texts are Uzbek (Latin) only. Star thresholds come from the prototype.

export type BodyPart = "qollar" | "oyoqlar" | "butun-tana";
export type Difficulty = "oson" | "orta" | "qiyin";

export interface GameInfo {
  slug: string;
  title: string;
  icon: string;
  short: string;
  description: string;
  tip: string;
  rules: string[];
  bodyParts: BodyPart[];
  difficulty: Difficulty;
  kidsFriendly: boolean;
  twoPlayers: boolean;
  /** Score thresholds for 1, 2 and 3 stars. */
  stars: [number, number, number];
  /** Accent colour for cards and HUD. */
  color: string;
}

/** Every game, including ones not released yet. */
export const ALL_GAMES: GameInfo[] = [
  {
    slug: "baliq-ovi",
    title: "Baliq ovi",
    icon: "🎣",
    short: "Tog‘ ko‘lida haqiqiy baliq ovi — yolg‘iz yoki do‘stingiz bilan.",
    description:
      "Qarmoqni siltab tashlang, poplavok cho‘kkanda keskin torting va chap qo‘l bilan g‘altakni aylantirib baliqni chiqaring.",
    tip: "O‘ng qo‘lda qarmoq, chap qo‘lda g‘altak",
    rules: [
      "O‘ng qo‘lni yelkadan yuqori ko‘tarib oldinga silting — qarmoq tashlanadi.",
      "Poplavok cho‘kkanda qo‘lni keskin tepaga torting — baliq ilinadi.",
      "Chap qo‘l bilan havoda doira chizing — g‘altak aylanadi.",
      "Ip qizarib ketsa, aylantirishni sekinlating — ip uzilmasin.",
    ],
    bodyParts: ["qollar"],
    difficulty: "orta",
    kidsFriendly: true,
    twoPlayers: true,
    stars: [600, 1500, 3000],
    color: "#28aadc",
  },
  {
    slug: "mashina",
    title: "Mashina haydash",
    icon: "🚗",
    short: "Shahar, trassa va drift — tizzalar pedal, qo‘llar rul.",
    description:
      "O‘ng tizzani ko‘tarsangiz — gaz, chap tizza — tormoz. Ikki qo‘l bilan xayoliy rulni buring va yo‘l qoidalariga rioya qiling.",
    tip: "Orqaroq turing — oyoqlaringiz ko‘rinsin",
    rules: [
      "O‘ng tizza — gaz, qanchalik baland bo‘lsa, shuncha tez.",
      "Chap tizza — tormoz.",
      "Ikki qo‘l bilan rulni buring.",
      "Svetofor, STOP belgisi va piyodalarga e’tibor bering.",
    ],
    bodyParts: ["oyoqlar", "qollar"],
    difficulty: "qiyin",
    kidsFriendly: true,
    twoPlayers: false,
    stars: [2500, 5000, 8000],
    color: "#ffaa28",
  },
  {
    slug: "meva-ninja",
    title: "Meva Ninja",
    icon: "🍉",
    short: "Qo‘llaringiz — qilich. Mevalarni kesing, bombaga tegmang!",
    description: "Uchib chiqqan mevalarni qo‘l harakati bilan kesing. Bombaga tegsangiz — jon ketadi. 60 soniya.",
    tip: "Qo‘llarni tez silkiting",
    rules: ["Mevani kesish uchun qo‘lni tez silting.", "Bombaga tegmang.", "Ketma-ket kesish kombo beradi."],
    bodyParts: ["qollar"],
    difficulty: "oson",
    kidsFriendly: true,
    twoPlayers: true,
    stars: [250, 600, 1100],
    color: "#ff3c5a",
  },
  {
    slug: "boks",
    title: "Boks",
    icon: "🥊",
    short: "Lapalarga uring, raqib zarbasidan qoching.",
    description:
      "Qizil lapaga chap, ko‘k lapaga o‘ng qo‘l bilan uring. Raqib zarbasidan bosh bilan qoching yoki blok qiling.",
    tip: "Mushtlarni tayyorlang",
    rules: ["Qizil lapa — chap qo‘l, ko‘k lapa — o‘ng qo‘l.", "Raqib zarbasidan boshni egib qoching.", "Ikki qo‘lni yuzga qo‘ysangiz — blok."],
    bodyParts: ["qollar", "butun-tana"],
    difficulty: "orta",
    kidsFriendly: true,
    twoPlayers: false,
    stars: [2500, 5500, 9000],
    color: "#ff5a3c",
  },
  {
    slug: "fitnes",
    title: "Fitnes",
    icon: "💪",
    short: "Mashqlarni kamera o‘zi sanaydi va tekshiradi.",
    description: "Mashqlar dasturi: takrorlarni kamera sanaydi va to‘g‘ri bajarilishini tekshiradi.",
    tip: "Orqaroq turing — butun tanangiz ko‘rinsin",
    rules: ["Ekrandagi mashqni takrorlang.", "Har bir to‘g‘ri takror ochko beradi.", "Noto‘g‘ri bajarilsa, maslahat chiqadi."],
    bodyParts: ["butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    twoPlayers: false,
    stars: [60, 110, 160],
    color: "#34d399",
  },
  {
    slug: "meteor",
    title: "Meteor yomg‘iri",
    icon: "☄️",
    short: "Meteorlardan butun tanangiz bilan qoching.",
    description: "Tepadan meteorlar tushadi — chapga-o‘ngga qoching, egiling. Tangalarni qo‘l bilan yig‘ing.",
    tip: "Chapga-o‘ngga qochishga tayyor turing",
    rules: ["Meteor tegsa — jon ketadi.", "Tangalarni qo‘l bilan yig‘ing.", "Bonuslar sizni himoya qiladi."],
    bodyParts: ["butun-tana"],
    difficulty: "orta",
    kidsFriendly: true,
    twoPlayers: false,
    stars: [1500, 3500, 6000],
    color: "#ff8c28",
  },
  {
    slug: "devor",
    title: "Devor",
    icon: "🧱",
    short: "Tanangizni devordagi teshik shakliga keltiring.",
    description: "Devor yaqinlashmoqda! Tanangizni devordagi teshik shakliga keltiring — aks holda devor uradi.",
    tip: "Kameradan uzoqroq turing — qo‘llar to‘liq ko‘rinsin",
    rules: ["Devordagi shaklni ko‘ring.", "Devor yetib kelguncha shu pozaga kiring.", "Poza qanchalik aniq bo‘lsa, ochko shuncha ko‘p."],
    bodyParts: ["butun-tana"],
    difficulty: "orta",
    kidsFriendly: true,
    twoPlayers: true,
    stars: [800, 1400, 2000],
    color: "#ffaa5a",
  },
];

/** Games released on the site right now; the rest come back in a later stage. */
export const ACTIVE_SLUGS = ["meva-ninja", "baliq-ovi", "mashina"] as const;

export const GAMES: GameInfo[] = ALL_GAMES.filter((g) => (ACTIVE_SLUGS as readonly string[]).includes(g.slug));

export const getGame = (slug: string): GameInfo | undefined => GAMES.find((g) => g.slug === slug);

export const BODY_PART_LABEL: Record<BodyPart, string> = {
  qollar: "Qo‘llar",
  oyoqlar: "Oyoqlar",
  "butun-tana": "Butun tana",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { oson: "Oson", orta: "O‘rta", qiyin: "Qiyin" };
