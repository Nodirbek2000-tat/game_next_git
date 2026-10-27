# Deploy — uzbekyoshlari.uz

Ikkita alohida repo, ikkita mustaqil Docker stack. Har biri alohida quriladi va alohida yangilanadi.

| Repo | Serverdagi papka | Ichida | Tashqariga ochiq |
|---|---|---|---|
| `game_next_git` (frontend) | `/opt/harakat/game_next_git` | Next.js + nginx + certbot | **faqat nginx: 80 va 443** |
| `game_git` (backend) | `/opt/harakat/game_git` | Django + PostgreSQL + Redis | yo'q (db/redis `internal` tarmoqda) |

Ulanish: tashqi docker tarmog'i `web`. nginx `harakat-next:3000` va `harakat-django:8000` ga shu tarmoq orqali boradi.
Yo'nalish: `/api/`, `/admin/`, `/static/` -> Django; qolgani -> Next. `www` -> `uzbekyoshlari.uz` ga yo'naltiriladi.

> Hamma buyruq serverda, ikkala repo `/opt/harakat/` ichida turibdi deb yozilgan.

---

## 1. Yangi server — birinchi kun (Ubuntu 24.04)

Avval `~/.claude/SECURITY_PLAYBOOK.md` 3-bo'limni ko'ring. Qisqasi:

- [ ] Provider paneliga kuchli parol + **2FA**.
- [ ] O'z kompyuteringizda: `ssh-keygen -t ed25519 -f ~/.ssh/harakat_ed25519`, ochiq kalitni serverga qo'ying (`~/.ssh/authorized_keys`).
- [ ] Kalit bilan kirishni **sinab ko'ring**, KEYIN parolni o'chiring. `/etc/ssh/sshd_config.d/00-hardening.conf`:
  ```
  PermitRootLogin prohibit-password
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  MaxAuthTries 3
  X11Forwarding no
  AllowTcpForwarding no
  ```
  `sshd -t && systemctl reload ssh`
- [ ] Firewall (SSH porti 22 deb olindi; o'zgartirgan bo'lsangiz, shuni yozing):
  ```
  ufw default deny incoming
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw limit 22/tcp
  ufw enable
  ```
  Eslatma: Docker `ports:` orqali ochgan portni ufw to'smaydi. Shuning uchun faqat proxy stack `80/443` ni ochadi; boshqa hech qaysi compose faylga `ports:` qo'shmang.
- [ ] fail2ban: `apt install fail2ban`, so'ng `/etc/fail2ban/jail.d/sshd.local`:
  ```
  [sshd]
  enabled = true
  port = 22
  backend = systemd
  journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
  maxretry = 4
  bantime = 24h
  ```
  `systemctl enable --now fail2ban`
- [ ] `apt install unattended-upgrades` (avtomatik xavfsizlik yangilanishlari).
- [ ] Docker: rasmiy hujjat bo'yicha o'rnating (`curl | sh` emas): https://docs.docker.com/engine/install/ubuntu/
- [ ] Qo'shimcha paketlar: `apt install git openssl rclone`
- [ ] Tushunarsiz port tekshiruvi: `ss -tulpn` — tashqariga faqat SSH, 80, 443 qarashi kerak.

## 2. DNS

Domen registratorida ikkita A yozuv (server IP'si):

| Host | Tur | Qiymat |
|---|---|---|
| `uzbekyoshlari.uz` (`@`) | A | SERVER_IP |
| `www` | A | SERVER_IP |

`dig +short uzbekyoshlari.uz` va `dig +short www.uzbekyoshlari.uz` server IP'sini qaytarmaguncha sertifikat olmang.

## 3. Kodni serverga olish (bir marta)

```bash
mkdir -p /opt/harakat && cd /opt/harakat
# private repolar: faqat o'qiydigan deploy key bilan
git clone git@github.com:Nodirbek2000-tat/game_git.git
git clone git@github.com:Nodirbek2000-tat/game_next_git.git
docker network create web
```

## 4. Backend (birinchi marta)

```bash
cd /opt/harakat/game_git
cp .env.example .env && chmod 600 .env
nano .env     # DJANGO_SECRET_KEY, POSTGRES_PASSWORD va DATABASE_URL ichidagi parolni to'ldiring
docker compose up -d --build
docker compose logs -f django          # "[entrypoint] start" chiqquncha kuting (Ctrl+C)
docker compose exec django python manage.py createsuperuser    # parolni o'zingiz yozasiz
```

Tekshirish: `docker compose ps` — `django`, `db` (healthy), `redis` ishlayapti; `ss -tulpn | grep -E '5432|6379|8000'` — hech narsa chiqmasligi kerak.

## 5. Frontend (birinchi marta)

```bash
cd /opt/harakat/game_next_git
cp .env.example .env
docker compose up -d --build next     # avval faqat Next (nginx sertifikatdan keyin ishga tushadi)
docker compose logs -f next
```

## 6. Proxy + birinchi SSL sertifikat

```bash
cd /opt/harakat/game_next_git
# Avval sinov sertifikati (Let's Encrypt limitiga tushmaydi):
LETSENCRYPT_STAGING=1 LETSENCRYPT_EMAIL=siz@example.com bash ./init-letsencrypt.sh
# Hammasi yaxshi bo'lsa — haqiqiysi:
rm -rf data/letsencrypt && LETSENCRYPT_EMAIL=siz@example.com bash ./init-letsencrypt.sh
```

Skript: vaqtinchalik sertifikat -> nginx -> haqiqiy sertifikat (webroot) -> nginx reload -> avtomatik yangilash sikli (`certbot` konteyneri).

Tekshirish:
```bash
curl -sI http://uzbekyoshlari.uz | head -3           # 301 -> https
curl -sI https://uzbekyoshlari.uz | head -15         # 200, Strict-Transport-Security, Permissions-Policy
curl -sI https://www.uzbekyoshlari.uz | head -3      # 301 -> https://uzbekyoshlari.uz
curl -sI https://uzbekyoshlari.uz/mediapipe/vision_wasm_internal.wasm | grep -i -E 'content-type|cache-control'
```
Brauzerda kamera ishlashini ham tekshiring (faqat HTTPS'da ishlaydi).

HTTPS to'liq ishlashiga ishonch hosil qilgach: `game_git/.env` da `DJANGO_HSTS_SECONDS=31536000` qiling, so'ng backend papkasida `docker compose up -d`.

### Yangilanishni tekshirish
```bash
cd /opt/harakat/game_next_git
docker compose run --rm --entrypoint certbot certbot renew --dry-run     # "all simulated renewals succeeded"
docker compose run --rm --entrypoint certbot certbot certificates        # muddati ko'rinadi
docker compose logs --tail 20 certbot
```
certbot har 12 soatda tekshiradi (muddati 30 kundan kam qolsa yangilaydi), nginx har 6 soatda config va sertifikatni qayta o'qiydi. Oyiga bir marta muddatni ko'zdan kechiring.

---

## 7. Yangilash (deploy)

Har repo alohida: o'z papkasida `git pull`, keyin quyidagilar.

**Faqat frontend:**
```bash
cd /opt/harakat/game_next_git && git pull
docker tag harakat/next:latest harakat/next:prev 2>/dev/null || true     # orqaga qaytish uchun
docker compose up -d --build next
```

**Faqat backend:**
```bash
cd /opt/harakat/game_git
bash ./backup.sh                                                            # migratsiya oldidan zaxira
docker tag harakat/django:latest harakat/django:prev 2>/dev/null || true
docker compose up -d --build      # entrypoint: migrate -> collectstatic -> gunicorn
```

**Proxy** (nginx config o'zgarganda):
```bash
cd /opt/harakat/game_next_git
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

Deploydan oldin tekshiruv: `SECURITY_PLAYBOOK.md` 7-bo'lim (diff'da sir yo'q, DEBUG=False, yangi port ochilmayapti, testlar o'tdi).

## 8. Zaxira (backup)

Har kuni, serverdan **tashqariga** (rclone: S3 / Cloudflare R2 / Backblaze / SFTP):

```bash
rclone config                                         # remote yarating (iloji bo'lsa faqat yozish huquqli kalit + crypt)
cd /opt/harakat/game_git
cp .env.backup.example .env.backup && chmod 600 .env.backup && nano .env.backup
bash ./backup.sh                                        # qo'lda bir marta sinab ko'ring
crontab -e                                            # root:
# 15 3 * * * bash /opt/harakat/game_git/backup.sh >> /var/log/harakat-backup.log 2>&1
```
Skript: `pg_dump | gzip` + media; `gzip -t` bilan tekshiradi; lokalda 7 kunlik + 4 haftalik saqlaydi; tashqi omborga `rclone copy` qiladi (o'chirmaydi — eski nusxalarni ombor lifecycle qoidasi tozalasin, shunda server buzilsa ham zaxira o'chib ketmaydi).

### Zaxiradan tiklash (oyiga bir marta sinab ko'ring!)
```bash
cd /opt/harakat/game_git
docker compose stop django
gunzip -c /var/backups/harakat/daily/db_YYYY-MM-DD_HHMM.sql.gz | \
  docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose start django
```
Ishlayotgan bazaning ustiga emas, toza bazaga tiklang: avval bugungi zaxirani oling va egasidan so'rang, so'ng psql'da `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` bajarib, yuqoridagini ishga tushiring. `docker compose down -v` ni **ishlatmang** — u bazani o'chiradi.

## 9. Orqaga qaytarish (rollback)

**Kod xatosi (frontend yoki backend):**
```bash
cd /opt/harakat/game_next_git        # yoki /opt/harakat/game_git
docker tag harakat/next:prev harakat/next:latest        # backend uchun: harakat/django:prev -> :latest
docker compose up -d --no-build --force-recreate
```
Yoki kodni eski commit'ga qaytarib qayta quring: `git checkout <eski_commit> && docker compose up -d --build`.

**Migratsiya buzgan bo'lsa:** backend'ni to'xtating (`docker compose stop django`), zaxiradan tiklang (8-bo'lim), keyin eski kodni ishga tushiring. Migratsiyani orqaga qaytarish (`migrate app NNNN`) ma'lumot yo'qotishi mumkin — oldin zaxira oling va egasidan so'rang.

**nginx config buzilgan bo'lsa:** `git checkout nginx`, so'ng `docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload`. (`nginx -t` xato bersa, ishlayotgan nginx eski config bilan davom etadi.)

## 10. Foydali buyruqlar

```bash
docker compose ps                                     # holat (har stack papkasida)
docker compose logs -f --tail 100 <xizmat>
docker ps --format 'table {{.Names}}\t{{.Ports}}'     # faqat harakat-nginx 80/443 ko'rsatishi kerak
```

## Eslatmalar

- `.env`, `.env.backup`, `game_next_git/data/` (sertifikat kalitlari) git'ga tushmaydi. Hech qachon chatga yoki loglarga yozmang.
- Kalit/parol chatga yoki kodga tushsa — darhol almashtiring (`DJANGO_SECRET_KEY` o'zgarsa, sessiyalar bekor bo'ladi).
- Shubhali narsa (begona cron, SSH kalit, port, konteyner) ko'rsangiz — to'xtang va playbook 6-bo'limiga qarang.
- Keyingi qadamlar: Content-Security-Policy (MediaPipe wasm/worker bilan sinab), CORS (`django-cors-headers` ulanganda `CORS_ALLOWED_ORIGINS`), Sentry, GitHub Actions.
