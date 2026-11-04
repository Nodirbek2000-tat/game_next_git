import type { GameInfo } from "../games";

/** Sinov o'yinlari (adult-b): har biri lab: true, audience to'g'ri belgilangan. */
export const GAMES: GameInfo[] = [
  {
    slug: "tez-teg",
    title: "Tez teg",
    icon: "🎯",
    short: "Atrofingizda chiqqan nishonlarga tez teging.",
    description:
      "Boshingiz tepasida, yonlaringizda va tizza yaqinida yonib turgan nishonlar paydo bo‘ladi. Ular yo‘qolmasidan oldin qo‘l bilan (pastdagilarini tizza bilan) teging — qanchalik tez tegsangiz, shunchalik ko‘p ball.",
    tip: "Oyoqlaringiz ham ko‘rinsin — tizza nishonlari uchun",
    rules: [
      "Sariq nishon — qo‘l bilan teging, ko‘k nishon — tizzangizni ko‘tarib teging.",
      "Nishon aylanasi kamayib tugaydi — tugamasdan oldin ulguring.",
      "Tez tegsangiz 100 ballgacha, sekin tegsangiz 50 ball.",
      "Ketma-ket tegsangiz kombo qo‘shimcha ball beradi, o‘tkazsangiz kombo uziladi.",
    ],
    bodyParts: ["qollar", "oyoqlar", "butun-tana"],
    difficulty: "oson",
    kidsFriendly: true,
    audience: "umumiy",
    twoPlayers: false,
    stars: [1000, 2200, 3300],
    lab: true,
    color: "#ffb02e",
  },
  {
    slug: "basketbol",
    title: "Basketbol",
    icon: "🏀",
    short: "Qo‘ldagi to‘pni tepaga itarib, halqaga tushiring.",
    description:
      "To‘p qo‘lingizda turadi. Qo‘lni tez tepaga va oldinga itaring — to‘p halqaga uchadi. Halqa tepada, keyinroq yon tomonga suriladi. 60 soniyada ko‘proq gol uring.",
    tip: "Bitta qo‘lni yelka oldida tayyor ushlang",
    rules: [
      "To‘p qo‘lingizda — qo‘lni biroz tinch ushlab turing, to‘p tayyor bo‘ladi.",
      "Qo‘lni tez tepaga va oldinga itaring — to‘p shu yo‘nalishda uchadi.",
      "Halqaga tushsa 20 ball, ketma-ket gollar uchun qo‘shimcha ball.",
      "O‘yin o‘rtasidan boshlab halqa yonga surila boshlaydi.",
    ],
    bodyParts: ["qollar"],
    difficulty: "orta",
    kidsFriendly: true,
    audience: "umumiy",
    twoPlayers: false,
    stars: [150, 400, 700],
    lab: true,
    color: "#ff8a2a",
  },
  {
    slug: "raqs",
    title: "Raqs",
    icon: "💃",
    short: "Kartochkadagi pozani o‘z vaqtida takrorlang.",
    description:
      "Ritm bilan pozalar kartochkasi chiziq tomon suriladi: qo‘llar tepada, T harfi, bir qo‘l tepada, qo‘llar belda, cho‘kkalash va boshqalar. Kartochka chiziqqa yetganda pozani oling — A’lo, Yaxshi yoki Xato.",
    tip: "Qo‘llaringiz va tizzalaringiz ko‘rinadigan masofada turing",
    rules: [
      "Kartochka chiziqqa yetganda unga mos pozani oling va biroz ushlang.",
      "Aniq vaqtida olsangiz — A’lo (100), sal erta yoki kech bo‘lsa — Yaxshi (50).",
      "Ketma-ket to‘g‘ri pozalar kombo beradi, har bir kombo ballni oshiradi.",
      "Tizza ko‘rinmasa, cho‘kkalash va tizza ko‘tarish kartochkalari chiqmaydi.",
    ],
    bodyParts: ["qollar", "butun-tana"],
    difficulty: "orta",
    kidsFriendly: true,
    audience: "umumiy",
    twoPlayers: false,
    stars: [1500, 3500, 5500],
    lab: true,
    color: "#b46cff",
  },
];
