# Harakat o‘yinlari — frontend (Next.js)

Kamera bilan butun tana orqali boshqariladigan 3D o‘yinlar: Meva Ninja, Baliq ovi, Mashina haydash.
Kamera tasviri qurilmadan chiqmaydi — hamma tahlil brauzerda (MediaPipe).

```bash
npm ci
npm run dev          # http://localhost:3000
npm test             # unit testlar (Vitest)
npm run test:e2e     # e2e (Playwright)
```

O‘yin dvigateli: [engine/README.md](engine/README.md). TZ va prototip: `docs/`.
Serverga joylash (Next + nginx + SSL): [DEPLOY.md](DEPLOY.md). Backend: `game_git` repo.
