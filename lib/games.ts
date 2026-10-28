// Single source of truth for the game catalogue, shared by the site pages and the engine.
// Texts are Uzbek (Latin) only. Star thresholds come from the prototype.

export type BodyPart = "qollar" | "oyoqlar" | "butun-tana";
export type Difficulty = "oson" | "orta" | "qiyin";
/** "bogcha" = kindergarten games (3–6 yosh, 2–5 bola birga, skanersiz); "umumiy" = the main catalogue. */
export type Audience = "bogcha" | "umumiy";

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
  audience: Audience;
  /** not listed anywhere (home, /oyinlar, /bogcha, sitemap); still playable by URL (demo / test games) */
  hidden?: boolean;
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
    audience: "umumiy",
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
    audience: "umumiy",
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
    audience: "umumiy",
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
    audience: "umumiy",
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
    audience: "umumiy",
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
    audience: "umumiy",
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
    audience: "umumiy",
    twoPlayers: true,
    stars: [800, 1400, 2000],
    color: "#ffaa5a",
  },
  // ---------------------------------------------------------------- Bog‘cha (3–6 yosh): 2–5 bola birga, skanersiz
  {
    slug: "pufakchalar",
    title: "Pufakchalar",
    icon: "🫧",
    short: "Pufakchalarni qo‘lingiz bilan yoring — yulduz yig‘iladi.",
    description: "Ekranda rangli pufakchalar uchadi. Bolalar qo‘llari bilan tegib yorishadi, yulduzlar hammaga birga yig‘iladi.",
    tip: "Qo‘llarni ko‘tarib pufakchalarga tegining",
    rules: ["Qo‘l bilan pufakchaga tegsangiz — yoriladi.", "Har bir pufakcha — bitta yulduz.", "Yutqazish yo‘q, hammaga yulduz!"],
    bodyParts: ["qollar"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [15, 35, 60],
    color: "#39c5ff",
  },
  {
    slug: "qotib-qol",
    title: "Qotib qol!",
    icon: "🎵",
    short: "Musiqa chalinsa — raqsga, to‘xtasa — qotib qoling!",
    description: "Musiqa chalinganda bolalar raqsga tushadi. Musiqa to‘xtaganda hamma qotib qoladi. Qimirlamaganlarga yulduz beriladi.",
    tip: "Musiqa to‘xtasa — qimirlamang",
    rules: ["Musiqa chalinsa — raqsga tushing.", "Musiqa to‘xtasa — qotib qoling.", "Qotib qolgan bola yulduz oladi."],
    bodyParts: ["butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [15, 35, 60],
    color: "#ff7ad9",
  },
  {
    slug: "hayvonlar",
    title: "Hayvonlar",
    icon: "🐸",
    short: "Baqa kabi sakrang, qush kabi qanot qoqing!",
    description: "Ekrandagi hayvon nima qilsa, bolalar ham shuni takrorlaydi: sakraydi, qarsak chaladi, qo‘l silkitadi, qanot qoqadi.",
    tip: "Hayvon nima qilsa, siz ham shuni qiling",
    rules: ["Rasmga qarang va takrorlang.", "Sakrang, qarsak chaling, qo‘l silkiting.", "To‘g‘ri qilsangiz — yulduz!"],
    bodyParts: ["butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [15, 35, 60],
    color: "#4fc464",
  },
  {
    slug: "baliqcha",
    title: "Baliqcha",
    icon: "🎣",
    short: "Qarmoq tashlang, baliqchani tortib oling!",
    description: "Ko‘lda rangli baliqchalar suzadi. Har bir bolaning o‘z qarmog‘i bor: qo‘lni ko‘tarib tushirsa — qarmoq tashlanadi, poplavok cho‘kkanda qo‘lni ko‘tarsa — baliqcha savatga tushadi.",
    tip: "Qo‘lni ko‘taring, tushiring!",
    rules: ["Qo‘lni ko‘tarib tushiring — qarmoq tashlanadi.", "Poplavok cho‘kkanda qo‘lni ko‘taring yoki «tort» deng.", "Hamma bolalar birga savatni to‘ldiradi. Yutqazish yo‘q!"],
    bodyParts: ["qollar"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [15, 35, 60],
    color: "#3b8bff",
  },
  {
    slug: "devor-bolalar",
    title: "Devordan o‘tamiz",
    icon: "🧱",
    short: "Devor keladi — teshikdagi shaklga kiring!",
    description: "Mehribon devor sizga qarab siljiydi. Unda rasmdagidek shakl: qo‘llar tepada, qo‘llar yonda, yulduz, o‘tirish. Shaklga kirgan bola devordan o‘tadi va yulduz oladi!",
    tip: "Rasmdagidek turing — hammamiz birga o‘tamiz",
    rules: ["Rasmdagi shaklga qarang.", "Devor kelguncha o‘sha shaklga keling.", "To‘g‘ri tursangiz — devordan o‘tasiz, yulduz olasiz. Yutqazish yo‘q!"],
    bodyParts: ["butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [10, 22, 40],
    color: "#e0703a",
  },
  {
    slug: "havoda-rasm",
    title: "Havoda rasm",
    icon: "🎨",
    short: "Qo‘llaringiz bilan havoda rasm chizing!",
    description: "Har bir bolaning qo‘llari o‘z rangida iz qoldiradi va hammasi bitta umumiy rasmga aylanadi. Ora-sira «Quyosh chizamiz!» deb so‘raladi — shaklga yaqin chizsangiz, yulduz va chaqnoqlar paydo bo‘ladi. Qarsak chalsangiz — salyut!",
    tip: "Qo‘lni ko‘tarib havoda chizing",
    rules: ["Qo‘lni ko‘tarsangiz — rangli iz qoladi.", "Quyosh, yomg‘ir, to‘lqin — birga chizamiz.", "Qarsak chalsangiz salyut otiladi. Oxirida umumiy rasm chiqadi!"],
    bodyParts: ["qollar"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [10, 22, 40],
    color: "#ff7ad9",
  },
  {
    slug: "sanaymiz",
    title: "Sanaymiz",
    icon: "🔢",
    short: "Sakrab, qarsak chalib sanaymiz, ranglarni topamiz!",
    description: "Katta raqam va shuncha rasm ko‘rinadi: «3 marta sakrang!», «2 marta qarsak!». Har bir bolaning sakrashi o‘z rasmida sanaladi. Yana rangli sharlar uchadi: «Qizil sharni ushlang!». Topshiriqni bajargan har bir bola yulduz oladi.",
    tip: "Raqamni ko‘ring, shuncha marta sakrang yoki qarsak chaling",
    rules: ["Raqamga qarang va shuncha marta sakrang yoki qarsak chaling.", "Aytilgan rangdagi sharga qo‘l tekkizing.", "Bajargan bola yulduz oladi. Yutqazish yo‘q!"],
    bodyParts: ["butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    twoPlayers: false,
    stars: [10, 22, 40],
    color: "#2fcf5a",
  },
  // demo / e2e game of the kids kit (games/bogcha/demo): playable at /play/bogcha-demo, not listed
  {
    slug: "bogcha-demo",
    title: "Yulduz tutish",
    icon: "⭐",
    short: "Yulduzlarni qo‘l bilan tuting.",
    description: "Tepadan yulduzlar tushadi. Bolalar qo‘llari bilan ularni tutishadi.",
    tip: "Qo‘lni yulduzga tekkizing",
    rules: ["Qo‘lni yulduzga tekkizing.", "Yutqazish yo‘q!"],
    bodyParts: ["qollar"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "bogcha",
    hidden: true,
    twoPlayers: false,
    stars: [15, 35, 60],
    color: "#ffd23d",
  },
];

/** Games released on the site right now; the rest come back in a later stage. */
export const ACTIVE_SLUGS = ["meva-ninja", "baliq-ovi", "mashina", "pufakchalar", "qotib-qol", "hayvonlar", "baliqcha", "devor-bolalar", "havoda-rasm", "sanaymiz", "bogcha-demo"] as const;

export const GAMES: GameInfo[] = ALL_GAMES.filter((g) => (ACTIVE_SLUGS as readonly string[]).includes(g.slug));

/** The main catalogue (home page, /oyinlar). */
export const MAIN_GAMES: GameInfo[] = GAMES.filter((g) => g.audience !== "bogcha" && !g.hidden);
/** Kindergarten games (/bogcha). */
export const KIDS_GAMES: GameInfo[] = GAMES.filter((g) => g.audience === "bogcha" && !g.hidden);

export const getGame = (slug: string): GameInfo | undefined => GAMES.find((g) => g.slug === slug);

export const BODY_PART_LABEL: Record<BodyPart, string> = {
  qollar: "Qo‘llar",
  oyoqlar: "Oyoqlar",
  "butun-tana": "Butun tana",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { oson: "Oson", orta: "O‘rta", qiyin: "Qiyin" };
