# TEXNIK TOPSHIRIQ (TZ) VA CLAUDE CODE UCHUN PROMPT
## Loyiha: «Harakat o'yinlari» — kamera bilan boshqariladigan 3D o'yinlar platformasi

---

## 0. CLAUDE CODE UCHUN KO'RSATMA (avval shuni o'qi)

Sen tajribali full-stack va 3D/WebGL o'yin dasturchisisan. Vazifang: brauzerda kamera orqali butun tana bilan boshqariladigan, real ko'rinishdagi, yengil va qotmaydigan 3D o'yinlar platformasini yaratish.

**Senga beriladigan materiallar:**
1. `harakat-oyinlari.html` — ishlaydigan **prototip**. Unda 7 ta o'yin bor: Meva Ninja, Baliq ovi, Mashina haydash, Boks, Fitnes, Meteor yomg'iri, Devor. Uni dvigatel bilan birga **mantiq manbai** sifatida ishlat: kamera, MediaPipe, o'yinchini qulflash, imo-ishoralar, o'yin qoidalari. Undagi sinovdan o'tgan yechimlarni saqlab qol, faqat sifatini oshir.
2. `game/` — Django backend papkasi.
3. `game_next/` — Next.js frontend papkasi (allaqachon o'rnatilgan).

**Ish tartibi (majburiy):**
1. Avval `harakat-oyinlari.html` ni to'liq o'qi. Undagi dvigatel (`core`), har bir o'yin klassi va ishga tushirish (`boot`) qismini tahlil qil.
2. `game/` va `game_next/` papkalarining hozirgi holatini ko'r: versiyalar, o'rnatilgan paketlar, tuzilma.
3. Menga **qisqa reja** yoz: nimani qayerga qo'yasan, qaysi paketlarni o'rnatasan. Mening tasdiqlashimni kut, keyin boshla.
4. Ishni **bosqichlarga** bo'lib bajar (11-bo'lim). Har bosqich oxirida:
   - ishga tushirib tekshir;
   - testlarni o'tkaz;
   - menga nima qilinganini, nima qolganini va qanday tekshirish mumkinligini qisqa yoz.
5. Har bosqichni alohida git commit qil.

**Qat'iy qoidalar:**
- Saytdagi va o'yindagi barcha matnlar **faqat o'zbek tilida, lotin alifbosida** bo'lsin. Kirill harflari umuman ishlatilmasin (keyinroq rus va ingliz tillari i18n orqali qo'shiladi).
- Kamera tasviri **hech qachon serverga yuborilmaydi**. Hamma tahlil foydalanuvchi qurilmasida bo'ladi. Serverga faqat natijalar (ochko, statistika) ketadi.
- Maxfiy kalitlar va parollar frontendga va gitga tushmasin, faqat `.env` da tursin.
- Biror narsa noaniq bo'lsa yoki katta qaror kerak bo'lsa (masalan, arxitekturani o'zgartirish), o'zing taxmin qilma, mendan so'ra.
- Ishlamaydigan yoki sinalmagan narsani «tayyor» dema. Nimani sinab ko'rganingni va nimani sinay olmaganingni aniq ayt.
- Kod tushunarli va modulli bo'lsin: har bir o'yin alohida modul, umumiy dvigatel alohida paket.

---

## 1. LOYIHA MAQSADI

Foydalanuvchi saytga kiradi, kamerasini yoqadi va **qo'shimcha qurilmasiz** (pult, joystik, sichqoncha kerak emas) tanasi bilan o'ynaydi. Platforma quyidagilarga mo'ljallangan:
- uyda: kompyuter yoki noutbuk;
- ta'lim markazlari va maktablar: sensorli doska (smart board) va katta ekranlar;
- bolalar ham, kattalar ham.

**Asosiy tamoyillar:**
1. **Boshqaruv oddiy, ko'rinish real.** O'yinni tushunish uchun 10 soniya yetsin, lekin grafika, fizika va ovoz iloji boricha real bo'lsin.
2. **Aniq va tez javob.** Qo'l yoki oyoq harakati ekranda darhol, kechikishsiz va titramasdan aks etsin.
3. **Yengil va qotmaydigan.** O'rtacha noutbukda 60 kadr/soniya, sensorli doskada kamida 30 kadr/soniya.
4. **Chiroyli kutib olish.** Saytga kirgan odam birinchi soniyadan «voy» desin.

---

## 2. TEXNOLOGIYALAR

### 2.1 Frontend (`game_next/`)
| Vazifa | Texnologiya |
|---|---|
| Framework | Next.js (App Router), TypeScript (strict) |
| 3D | three.js + React Three Fiber (`@react-three/fiber`) + `@react-three/drei` |
| Fizika | Rapier (`@react-three/rapier`, mashina uchun raycast vehicle controller) |
| Post-effektlar | `@react-three/postprocessing` (bloom, tone mapping, yengil SSAO — faqat kuchli qurilmalarda) |
| Tana va qo'l kuzatuvi | `@mediapipe/tasks-vision`: PoseLandmarker va HandLandmarker |
| Holat boshqaruvi | Zustand |
| Sayt UI | Tailwind CSS + shadcn/ui |
| Animatsiyalar | Framer Motion |
| Ovoz | Web Audio API (prototipdagi sintez) + qisqa real ovoz fayllari (`.ogg`/`.m4a`) |
| 3D modellar | glTF/GLB, Draco yoki Meshopt siqish, KTX2 teksturalar, `gltfjsx` |
| Qurilma kuchini aniqlash | `detect-gpu` |
| Offlayn va kesh | PWA (Serwist yoki shunga o'xshash) |
| Testlar | Vitest (unit) + Playwright (e2e) |

**Muhim texnik qarorlar:**
- O'yin sahifalari **faqat klient tomonda** ishlaydi (`"use client"`, `dynamic(..., { ssr: false })`). Sayt sahifalari (bosh sahifa, reyting, o'yin ma'lumotlari) esa SSR yoki SSG bo'lib, SEO uchun tez yuklansin.
- MediaPipe modellari va `wasm` fayllari **o'z serverimizda** (`/public/models`, `/public/mediapipe`) saqlansin. Google CDN'ga bog'liq bo'lmasin, chunki u O'zbekistonda sekin yoki bloklangan bo'lishi mumkin.
- Kuzatuvni **Web Worker**'da ishga tushirishni sinab ko'r. GPU delegate worker'da ishlamasa, main thread'da qoldir, lekin render tsiklini to'smasin.
- Har bir o'yin alohida yuklanadi (code splitting). Bosh sahifa o'yin kodini yuklamasin.

### 2.2 Backend (`game/`)
| Vazifa | Texnologiya |
|---|---|
| Framework | Django + Django REST Framework (yoki Django Ninja) |
| Ma'lumotlar bazasi | PostgreSQL |
| Kesh va navbat | Redis |
| Real vaqt (onlayn o'yin, jonli reyting) | Django Channels (WebSocket) |
| Autentifikatsiya | JWT (SimpleJWT) yoki xavfsiz cookie-session; mehmon (guest) rejimi |
| Fayllar (3D modellar, rasmlar) | S3-mos saqlash (MinIO) yoki serverdagi media + CDN |
| Fon vazifalar (ixtiyoriy) | Celery |
| Xatolarni kuzatish | Sentry |
| API hujjati | OpenAPI (drf-spectacular) |

### 2.3 Infratuzilma
- Docker + Docker Compose: `next`, `django`, `postgres`, `redis`, `nginx`.
- **HTTPS majburiy.** Kamera faqat HTTPS'da ishlaydi (Let's Encrypt).
- Nginx: statik fayllarga uzoq muddatli kesh, gzip/brotli, `.glb`, `.ktx2` va `.wasm` uchun to'g'ri MIME turlari.
- CI (GitHub Actions): lint, testlar, build.
- Analitika: Umami yoki Plausible (o'zimizda o'rnatilgan, shaxsiy ma'lumotsiz).

---

## 3. ARXITEKTURA

```
game_next/
  app/
    (site)/            → bosh sahifa, o'yinlar ro'yxati, reyting, profil, kirish
    play/[slug]/       → o'yin sahifasi (faqat klient)
  engine/              → umumiy dvigatel (prototipdagi core'dan)
    camera/            → kamera, ruxsat, qurilma tanlash, ruxsat yo'riqnomalari
    tracking/          → MediaPipe, filtrlar, o'yinchini qulflash, imo-ishoralar
    calibration/       → tana kalibrovkasi (oyoq, qo'l, masofa)
    audio/             → ovoz va musiqa
    quality/           → avtomatik grafik sifati (yuqori/o'rta/past)
    ui/                → HUD, menyu, qo'l bilan tanlash (dwell), natija oynasi
  games/
    fishing/  driving/  ninja/  boxing/  fitness/  meteor/  wall/
  public/
    models/ (glb), mediapipe/ (wasm + .task), audio/, textures/
game/
  accounts/  games/  scores/  fishing/  driving/  achievements/  realtime/
```

**Dvigatel prototipdagi quyidagi yechimlarni saqlab qolsin (ular sinovdan o'tgan):**
- **One Euro filtri**: kursor va nuqtalarni titratmasdan, kechiktirmasdan silliqlash.
- **O'yinchini qulflash**: skaner (ikki qo'lni boshdan yuqori ko'tarish), kiyim rangi gistogrammasi va harakat uzluksizligi. Sinovda ikki kishi joy almashganda ham, begona qo'l ko'targanda ham to'g'ri ishlagan.
- **Qisqa uzilishlar**: qo'l yo'qolganda tana nuqtasi orqali kuzatishni davom ettirish va 140 ms gacha harakat yo'nalishi bo'yicha bashorat.
- **Imo-ishoralar**: barqarorlik (3 kadr) va gisterezis.
- **Oyoq kalibrovkasi**: dam holati turgan oyoqdan olinadi, shunda o'yinni oyoq ko'tarilgan holda boshlash xato bermaydi.
- **Kamera ruxsati yo'riqnomasi**: Android, iPhone, Mac, Windows; fayl ko'ruvchi va Telegram ichida ochilganini aniqlash.
- **Bolalar rejimi**.
- **Sinov ilgagi** `window.__fake`: soxta skelet berib avtopilot bilan test qilish.

**Kuzatuv sifatini oshirish (yangi):**
- Kamerani 30 fps'da tahlil qilish, renderni 60 fps'da bajarish. Oraliq kadrlarda nuqtalarni interpolatsiya yoki ekstrapolatsiya qilish.
- Pose modeli avtomatik tanlansin: kuchli qurilmada `full`, kuchsizda `lite`. Qo'l modeli faqat kerak bo'lgan o'yinda yoqilsin.
- «Harakatdan ekrangacha» kechikish **80 ms dan kam** bo'lsin (o'lchab, debug panelda ko'rsatilsin).
- Boshlang'ich kalibrovka (10 soniya):
  1. butun tana kadrga sig'ishini tekshirish;
  2. yorug'likni baholash ("Xona qorong'i, chiroqni yoqing");
  3. o'yinchi masofasini aniqlash.
- Debug panel (`?debug=1`): fps, kechikish, aniqlangan odamlar soni, kim qulflangani, imo-ishora nomi.

---

## 4. SAYT (WEBSITE)

### 4.1 Kutib olish sahifasi (bosh sahifa)
- **Hero bo'limi**: jonli, yengil 3D sahna (masalan, suv ustida suzayotgan poplavok yoki aylanayotgan mashina), katta sarlavha va bitta asosiy tugma: **«Kamerani yoqing va o'ynang»**.
  - 3D sahna kuchsiz qurilmada video yoki rasm bilan almashtiriladi.
  - LCP 2 soniyadan oshmasin.
- **«Qanday ishlaydi»**: 3 qadam — kamerani yoqing, skanerdan o'ting, o'ynang. Qisqa animatsiyalar bilan.
- **O'yinlar kartochkalari**: hover'da qisqa video yoki animatsiya; har birida qiyinlik darajasi, «bolalar uchun ham» belgisi va qaysi tana qismlari ishlatilishi.
- **Maxfiylik bo'limi**: «Kamera tasviri hech qayerga yuborilmaydi».
- **Ta'lim markazlari va maktablar uchun**: sensorli doskada ishlatish, guruh reytingi.
- **Haftalik reyting** (top-10).
- Footer: aloqa va ijtimoiy tarmoqlar.

**Dizayn:** zamonaviy, yorqin, o'yin ruhidagi uslub; to'q va och mavzular. O'zbekona detallar kam va did bilan (masalan, Registon siluetidan ilhomlangan naqsh).

### 4.2 Boshqa sahifalar
| Sahifa | Mazmuni |
|---|---|
| `/oyinlar` | Barcha o'yinlar, filtrlar (bolalar uchun, butun tana, qo'llar) |
| `/oyin/[slug]` | O'yin haqida, qoidalar, imo-ishoralar rasmi, «O'ynash» tugmasi, shu o'yin reytingi |
| `/play/[slug]` | O'yinning o'zi (to'liq ekran) |
| `/reyting` | Umumiy va har bir o'yin bo'yicha: kunlik, haftalik, barcha vaqtlar |
| `/profil` | Nik, avatar, yutuqlar, tutilgan baliqlar kolleksiyasi, statistika |
| `/kirish` | Telefon yoki email orqali kirish; ro'yxatdan o'tmasdan mehmon sifatida o'ynash mumkin |
| `/sozlamalar` | Kamera tanlash, ovoz, grafik sifati, chapaqay rejimi, bolalar rejimi |

### 4.3 O'yin ichidagi oqim
1. Kamera ruxsati: ruxsat oynasi darhol chiqadi. Rad etilsa, qurilmaga mos yo'riqnoma ko'rsatiladi.
2. Modellar yuklanishi: chiroyli progress va yuklanish paytida qisqa maslahatlar.
3. Kalibrovka va o'yinchi skaneri: 1 yoki 2 o'yinchi.
4. Qo'l bilan tanlanadigan menyu.
5. O'yin.
6. Natija: yulduzlar, rekord, reytingga yuborish, «Qayta o'ynash».

---

## 5. O'YIN 1: BALIQ OVI 2.0 (asosiy e'tibor)

### 5.1 Realizm
- **Suv:**
  - aks ettirish (reflection) va sinish (refraction);
  - to'lqinlar uchun normal map;
  - qirg'oq yaqinida ko'pik;
  - quyosh yaltirashi.
  - Kuchsiz qurilmada soddalashtirilgan shader (prototipdagi).
- **Suv osti ko'rinadi:** sayoz joyda baliqlar, suv o'tlari va tosh ko'rinsin (shaffoflik chuqurlikka qarab kamaysin).
- **Ip fizikasi:** Verlet arqon (20–40 segment). Ip osilib turadi, taranglashadi va baliq tortganda tebranadi.
- **Qarmoq:** egilishi suyaklar (skinned mesh) yoki segmentlar orqali, taranglikka mos ravishda.
- **Poplavok:** suzish fizikasi (buoyancy). To'lqinda chayqaladi, baliq cho'qiganda tabiiy cho'kadi.
- **Baliq AI'si:**
  - har tur o'z chuqurligida yuradi, galalari bor;
  - xo'rakka qiziqib yaqinlashadi, ba'zan qo'rqib qochadi;
  - kurash paytida chapga-o'ngga qochadi va sakraydi.
- **Kun vaqti va ob-havo:** tong, kunduz, quyosh botishi; yengil shamol; ixtiyoriy yomg'ir. Baliq faolligi vaqtga bog'liq.
- **Joylar (lokatsiyalar):** Tog' ko'li (hozirgi), Zarafshon daryosi (oqim ipni suradi), Suv ombori (katta baliqlar). Keyinchalik qo'shiladi.
- **Ovozlar:** qushlar, suv, g'altak chiqillashi, ip zo'riqishi, chayqalish — real yozuvlar.

### 5.2 Boshqaruv
Prototipdagidek qoladi, sezgirliklar sozlanadi:

| Harakat | Imo-ishora |
|---|---|
| Qarmoqni tashlash | O'ng qo'lni yelkadan yuqori ko'tarib oldinga siltash. Kuch masofani, qo'l yo'nalishi tashlash tomonini belgilaydi |
| Ilintirish | Poplavok cho'kkanda qarmoqni keskin tepaga tortish |
| G'altakni aylantirish | Chap qo'l bilan havoda doira chizish (tezlik — aylanish tezligi) |
| Tortish (pumping) | O'ng qo'lni tepaga tortib, keyin tushirib aylantirish |

- **Chapaqay rejimi:** qo'llarning vazifasi almashadi.
- Har o'yinchi uchun sezgirlik sozlamasi bo'lsin.

### 5.3 IKKI O'YINCHI (yangi, majburiy)
Bitta kamera oldida **ikki kishi yonma-yon** o'ynaydi.
- **Skaner:** ikkalasi ham qo'l ko'taradi. Chapdagi odam — 1-o'yinchi (ko'k), o'ngdagi — 2-o'yinchi (sariq).
  - Ikkalasi kiyim rangi va joylashuvi bo'yicha qulflanadi.
  - Joy almashsa ham adashmasin (prototipdagi qulflash algoritmini ikki o'yinchiga kengaytir).
  - Uchinchi odam o'yinga ta'sir qilmasin.
- **Ekran:** bitta umumiy sahna, ko'prikda ikki qarmoq, har birining poplavogi o'z rangida. HUD ekranning chap va o'ng tomonida alohida.
- **«Birgalikda» rejimi (do'stni qo'llab-quvvatlash):**
  - Umumiy savat va umumiy maqsad, masalan «Birgalikda 15 kg baliq tuting».
  - **Sachok bilan yordam:** biri katta baliqni tortayotganda, baliq 5 m dan yaqin kelsa, do'sti sachok imo-ishorasini qiladi (ikki qo'lni pastga tushirib, tepaga ko'tarish). Baliq darhol chiqariladi va **«Do'stlik bonusi»** beriladi.
  - Do'stining ipi qizilga chiqqanda «Ehtiyot bo'l!» degan ovozli eslatma.
- **«Musobaqa» rejimi:** 3 daqiqada kim ko'p (og'irlik bo'yicha) tutadi. Oxirida g'olib e'lon qilinadi.
- Ikki o'yinchi rejimida ham 60 fps (kuchli) / 30 fps (kuchsiz) saqlansin.

### 5.4 Kontent
- **12+ baliq turi**, real nomlari va o'lcham diapazoni bilan: zog'ora, sazan, oq amur, do'ngpeshona, cho'rtan, laqqa, forel, sudak, ilonbosh, karas, oltin baliqcha (kamyob), hazil buyumlar (eski etik, shisha).
- **Baliq ensiklopediyasi:** tutilgan har bir tur kolleksiyaga qo'shiladi (rasm, qisqa ma'lumot, rekord og'irlik). Bolalar uchun ta'limiy qism.
- **Xo'rak turlari:** chuvalchang, makkajo'xori, blesna. Har biri boshqa baliqni tortadi (ixtiyoriy, 2-bosqich).

### 5.5 Qabul qilish mezonlari
- [ ] 1 va 2 o'yinchi rejimlari ishlaydi; uchinchi odam xalaqit bermaydi.
- [ ] Tashlash → kutish → cho'qish → ilintirish → kurash → chiqarish oqimi silliq ishlaydi.
- [ ] Sachok yordami ishlaydi.
- [ ] Ip va poplavok fizikasi tabiiy ko'rinadi.
- [ ] O'rta noutbukda 60 fps, sensorli doskada 30 fps dan kam emas.

---

## 6. O'YIN 2: MASHINA HAYDASH 2.0 — OCHIQ DUNYO VA DRIFT

### 6.1 Ochiq dunyo
- **Xarita:** kamida 4×4 km, bo'laklarga (tile/chunk) bo'lib oqim bilan yuklanadi (streaming). Quyidagi hududlar bo'lsin:
  - **Shahar:** Samarqanddan ilhomlangan; ko'chalar, chorrahalar, svetoforlar, Registonga o'xshash diqqatga sazovor joy (low-poly, uslublashtirilgan).
  - **Trassa:** ko'p polosali yo'l, ko'priklar.
  - **Qishloq va dala yo'llari.**
  - **Tog'dagi serpantin yo'l.**
  - **Drift maydoni:** bo'sh aerodrom yoki parkovka.
- **Uzoqqa borish:** xaritaning istalgan joyiga erkin haydash. Mini-xarita va GPS yo'nalishi bo'lsin.
- **Kun va tun almashinuvi, yomg'ir.** Yomg'irda yo'l sirpanchiq va suv aksi bo'ladi.
- **LOD va ko'rinish masofasi** qurilma kuchiga qarab moslashadi.

### 6.2 Fizika (Rapier raycast vehicle)
- Real osma (suspension), og'irlik ko'chishi, shinalar tutilishi (grip) modeli.
- **Drift:** orqa g'ildiraklar sirpanadi, burchak va tezlikka qarab drift ochkosi, kombo, shinalar tutuni, iz va g'ijirlash ovozi.
- Yengil zarar (ixtiyoriy): bamper egilishi, oyna yorilishi effekti.

### 6.3 Boshqaruv (sozlanadigan)
| Harakat | Imo-ishora |
|---|---|
| Gaz | O'ng tizzani ko'tarish (qanchalik baland — shuncha gaz) |
| Tormoz | Chap tizzani ko'tarish |
| Rul | Ikki qo'l bilan xayoliy rulni burash |
| Qo'l tormozi (drift uchun) | O'ng qo'lni rul'dan keskin pastga tortish. Muqobili sozlamada tanlanadi |
| Orqaga yurish | To'xtagan holda tormozni 1,5 soniya ushlash → R uzatma |
| Kamera ko'rinishini almashtirish | Ikki qo'lni boshdan yuqori ko'tarish (orqadan / kabinadan) |

- **O'tirib o'ynash rejimi:** stulda o'tirgan holda tizza ko'tarish pedal vazifasini bajaradi. Sensorli doska va bolalar uchun qulay.
- **Bolalar rejimi:** avtomatik gaz, yo'lda ushlab turish yordami, avariyada jon kamaymaydi.
- Klaviatura va geympad zaxira boshqaruv sifatida qolsin (test va qulaylik uchun).

### 6.4 Yo'l harakati qoidalari (O'zbekiston YHQ asosida)
- **Haqiqiy yo'l belgilari:** tezlik chegarasi, STOP, piyodalar o'tish joyi, aholi punkti kirish va chiqishi, yo'nalish ko'rsatkichlari, «Yo'l bering», bir tomonlama yo'l, to'xtash taqiqlangan.
- **Svetofor** real fazalar bilan.
- **Trafik AI:** polosalar bo'ylab harakat, svetoforga bo'ysunish, quvib o'tish. Piyodalar «zebra»dan o'tadi.
- **Rejimlar:**
  1. **Erkin haydash:** ochiq dunyo, missiyasiz.
  2. **Missiyalar:** «Registon maydoniga 3 daqiqada yetib boring», «Yo'lovchini manzilga eltib qo'ying».
  3. **YHQ imtihoni:** avtomaktab uslubida. Har qoidabuzarlik jarima ball, oxirida «O'tdi / O'tmadi». Ta'limiy qiymat.
  4. **Drift:** drift maydonida ochko yig'ish.
- Prototipdagi qoidalar mantig'i saqlansin: tezlik, STOP, piyoda, avariya.

### 6.5 Mashinalar
- Kamida 3 ta model: sedan, krossover, sport mashina. Har birining o'z xususiyatlari (tezlanish, tutilish, drift moyilligi).
- Rang tanlash.
- Modellar glTF formatida (6.6 ga qarang).

### 6.6 3D modellar (Higgsfield va boshqa manbalar)
- Mashinalar, baliqlar, piyodalar va binolar keyinchalik Higgsfield yoki boshqa vositada yaratilgan GLB fayllar bilan almashtiriladi.
- Kod **model almashtirishga tayyor** bo'lsin: har bir obyekt `assets.json` dagi yo'l orqali yuklanadi. Model bo'lmasa, prototipdagi protsedural shakl ishlatiladi (fallback).
- **Optimallash konveyeri** (skript bilan): `gltf-transform` orqali Draco/Meshopt siqish, KTX2 teksturalar, poligonlarni kamaytirish, LOD yaratish.
- **Limitlar:**

| Obyekt | Poligonlar | Teksturalar |
|---|---|---|
| Mashina | ≤ 40k | ≤ 2K |
| Baliq | ≤ 6k | — |
| Odam | ≤ 8k | — |

### 6.7 Qabul qilish mezonlari
- [ ] Xaritada 4 km uzoqlikka qotmasdan haydash mumkin; bo'laklar sezilmasdan yuklanadi.
- [ ] Drift ishlaydi va ochko beradi.
- [ ] Svetofor, STOP va piyoda qoidalari baholanadi.
- [ ] Oyoq va qo'l boshqaruvi oyoqni ko'tarib boshlaganda ham to'g'ri kalibrlanadi.
- [ ] O'rta noutbukda 60 fps, doskada 30 fps (past sifatda).

---

## 7. QOLGAN O'YINLAR (prototipdan ko'chirish va yaxshilash)

| O'yin | Yaxshilash |
|---|---|
| Meva Ninja | Real 3D mevalar (GLB), sharbat suyuqlik effekti, ko'p o'yinchi rejimi (xonadagi hammaning qo'llari) |
| Boks | 3D raqib (sparring partner) animatsiya bilan, raund tizimi, zarba tezligi o'lchovi |
| Fitnes | Mashqlar dasturi (5/10/20 daqiqa), to'g'ri bajarishni ovozli tuzatish, haftalik progress |
| Meteor yomg'iri | Real kosmik muhit, kuch-quvvat bonuslari |
| Devor | Ko'proq pozalar, 2 o'yinchi uchun juft pozalar |

Hammasida bolalar rejimi saqlanadi.

---

## 8. BACKEND: MODELLAR VA API

### 8.1 Asosiy modellar (Django)
- `User` (custom): telefon yoki email, `is_guest`.
- `Profile`: nik, avatar, yosh guruhi (bola/katta), til, chapaqaylik.
- `Game`: slug, nom, tavsif, faol/nofaol, `settings` (JSON).
- `GameRun`: o'yin boshlanishi (`run_id`, foydalanuvchi, o'yin, boshlanish vaqti, qurilma ma'lumoti). Firibgarlikka qarshi.
- `Score`: `run_id`, ochko, statistika (JSON), davomiylik, yaratilgan vaqt.
- `Achievement`, `UserAchievement`.
- `FishSpecies` (admin'dan tahrirlanadi): nom, og'irlik diapazoni, kuch, kamyoblik, joylar, model yo'li, ta'limiy matn.
- `FishCatch`: kim, qaysi tur, og'irlik, joy, vaqt.
- `CarModel`, `Mission`, `DrivingExamResult`.
- `Organization` (maktab yoki markaz) va `Group`: guruh reytingi uchun.

### 8.2 API (namuna)
```
POST /api/auth/guest/              → mehmon token
POST /api/auth/login/  /register/
GET  /api/games/                   → o'yinlar ro'yxati va sozlamalari
POST /api/runs/                    → {game} → run_id (server vaqti bilan)
POST /api/runs/{run_id}/finish/    → {score, stats} → tekshiruv va saqlash
GET  /api/leaderboard/{game}/?period=day|week|all
GET  /api/me/  /api/me/achievements/  /api/me/fish-collection/
GET  /api/fish-species/  /api/cars/  /api/missions/
WS   /ws/rooms/{code}/             → (keyingi bosqich) onlayn o'yin
```

### 8.3 Firibgarlikka qarshi
- Server `run_id` boshlangan vaqtni saqlaydi va davomiylikni tekshiradi.
- Har o'yin uchun mumkin bo'lgan maksimal ochko chegarasini tekshiradi.
- Rate limit qo'yiladi.
- Reytingga faqat tekshiruvdan o'tgan natijalar chiqadi.

### 8.4 Admin panel
Baliq turlari, mashinalar, missiyalar, o'yinlarni yoqish/o'chirish, reytingni moderatsiya qilish, statistika.

---

## 9. ISHLASH TEZLIGI VA SIFAT TALABLARI

| Ko'rsatkich | Talab |
|---|---|
| Bosh sahifa LCP (4G) | < 2,0 s |
| Bosh sahifa JS (gzip) | ≤ 200 KB |
| O'yinga tayyor bo'lish (20 Mbit/s) | < 8 s, keyingi kirishlarda keshdan < 3 s |
| FPS | 60 (o'rta noutbuk, Intel Iris Xe darajasi), 30+ (Android smart board) |
| Draw call'lar | ≤ 150 (yuqori), ≤ 80 (past) |
| Harakatdan ekrangacha kechikish | < 80 ms |
| Xotira | ≤ 600 MB |

**Qotmaslik uchun majburiy usullar:**
- Statik obyektlarni birlashtirish yoki instancing (prototipda 500+ draw call 60–76 ga tushirilgan).
- Render tsiklida yangi obyekt yaratmaslik: object pool, vektorlarni qayta ishlatish.
- O'yin boshlanishidan oldin shaderlarni oldindan kompilyatsiya qilish (`renderer.compile`).
- Ekrandan tashqari obyektlarni o'chirish (frustum culling), uzoqdagilar uchun LOD.
- **Avtomatik sifat:** `detect-gpu` va real fps o'lchovi asosida soyalar, post-effektlar, piksel zichligi va ko'rinish masofasini o'zgartirish (dynamic resolution).
- Tab yashirilganda o'yin pauza qilinsin.
- O'yindan chiqishda barcha resurslar tozalansin (dispose).

**Brauzerlar va qurilmalar:** Chrome, Edge, Safari (so'nggi 2 versiya), Android Chrome, Android'li smart board, iPad.

---

## 10. TESTLAR
- **Unit (Vitest):** imo-ishora klassifikatori, One Euro filtri, o'yinchini qulflash, oyoq kalibrovkasi, ochko hisoblash, YHQ qoidalari.
- **E2E (Playwright):** prototipdagidek soxta skelet (`window.__fake`) bilan har bir o'yin uchun avtopilot. Kamida quyidagilar tekshirilsin:
  - skaner va qulflash: 2 kishi joy almashadi, begona qo'l ko'taradi, o'yinchi chiqib qaytadi;
  - baliq ovida to'liq oqim va 2 o'yinchi;
  - mashinada STOP, piyoda va tezlik qoidalari («ehtiyotkor» va «qoidabuzar» haydovchi);
  - menyu va natija oynalari.
- **Ishlash testi:** sahna yuklanganda draw call va triangle sonini o'lchash, limitlardan oshsa test yiqilsin.
- **Backend:** API testlari (pytest), reyting va firibgarlik tekshiruvi.

---

## 11. BOSQICHLAR

| № | Bosqich | Natija |
|---|---|---|
| 0 | Sozlash | Docker Compose, `.env.example`, CI, lint, kod tuzilmasi, HTTPS bilan lokal ishga tushirish yo'riqnomasi |
| 1 | Dvigatel + sayt | `engine/` (prototipdan TypeScript'ga), kamera ruxsati, kalibrovka, qulflash, debug panel; bosh sahifa va o'yinlar sahifasi |
| 2 | Baliq ovi 2.0 | 5-bo'limdagi hamma narsa, jumladan 2 o'yinchi va sachok yordami |
| 3 | Mashina 2.0 | Ochiq dunyo, drift, YHQ, missiyalar |
| 4 | Qolgan 5 o'yin | Prototipdan ko'chirish va 7-bo'limdagi yaxshilashlar |
| 5 | Backend | Akkauntlar, reyting, yutuqlar, baliq kolleksiyasi, admin, firibgarlikka qarshi |
| 6 | Sayqal va joylashtirish | PWA, kesh, analitika, Sentry, server deploy, yuklanish va FPS o'lchovlari |
| 7 (keyin) | Onlayn | Django Channels orqali masofadan do'st bilan baliq ovi musobaqasi |

Har bosqich oxirida menga quyidagilarni ber:
- nima qilindi;
- qanday ishga tushiriladi;
- qaysi testlar o'tdi;
- nima sinalmagan;
- keyingi bosqich rejasi.

---

## 12. YAKUNIY ESLATMA
- Prototip HTML fayl — bu **sinovdan o'tgan mantiq**. Undagi raqamli chegaralar (ilintirish tezligi, taranglik chegarasi, oyoq ko'tarish, qulflash ostonalari) dastlabki qiymat sifatida olinsin, keyin sozlamalarda o'zgartiriladigan bo'lsin.
- Asosiy maqsad — **o'yin oddiy bo'lsin, lekin real tuyulsin**. Bola ham, katta ham 10 soniyada tushunsin, ekranda esa haqiqiy ko'l, haqiqiy yo'l va haqiqiy mashinani ko'rsin.
- Sifat birinchi o'rinda: kam, lekin mukammal ishlaydigan funksiya ko'p, lekin chala funksiyadan yaxshiroq.
