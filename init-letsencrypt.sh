#!/usr/bin/env bash
# Birinchi SSL sertifikatni olish (Let's Encrypt, webroot).
#
# Ishlatish (serverda, /opt/harakat/game_next_git papkasida):
#   LETSENCRYPT_EMAIL=siz@example.com ./init-letsencrypt.sh
#   LETSENCRYPT_STAGING=1 LETSENCRYPT_EMAIL=... ./init-letsencrypt.sh   # avval sinov (limitga tushmaydi)
#
# Oldindan: DNS A yozuvlari (uzbekyoshlari.uz va www) shu serverga qarashi, `docker network create web`.
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="uzbekyoshlari.uz"
DOMAINS=("$DOMAIN" "www.$DOMAIN")
EMAIL="${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL ni bering (masalan: LETSENCRYPT_EMAIL=siz@example.com)}"
STAGING_ARG=()
[ "${LETSENCRYPT_STAGING:-0}" = "1" ] && STAGING_ARG=(--staging)

DATA=./data
LIVE="$DATA/letsencrypt/live/$DOMAIN"

command -v docker >/dev/null || { echo "docker topilmadi"; exit 1; }
command -v openssl >/dev/null || { echo "openssl topilmadi (apt install openssl)"; exit 1; }

if [ -f "$LIVE/fullchain.pem" ] && [ ! -f "$LIVE/.dummy" ]; then
  echo "Haqiqiy sertifikat allaqachon bor: $LIVE"
  echo "Majburan qayta olish uchun avval ./data/letsencrypt/{live,archive,renewal}/$DOMAIN* ni zaxiralab o'chiring."
  exit 0
fi

mkdir -p "$DATA/certbot-www" "$LIVE"

make_dummy() {
  mkdir -p "$LIVE"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" \
    -subj "/CN=$DOMAIN" 2>/dev/null
  chmod 600 "$LIVE/privkey.pem"
  echo dummy > "$LIVE/.dummy"
}

echo "### 1/4 Vaqtinchalik (self-signed) sertifikat — nginx ishga tushishi uchun"
make_dummy

echo "### 2/4 nginx ni ishga tushirish"
docker compose up -d --force-recreate nginx
# nginx haqiqatda ishlab, 80-portda javob berguncha kutamiz
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" "http://127.0.0.1/.well-known/acme-challenge/ping" || true)
  if [ "$code" = "404" ] || [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "XATO: nginx 80-portda javob bermayapti. Loglar:"
  docker compose logs nginx --tail 20
  exit 1
fi

echo "### 3/4 Vaqtinchalik sertifikatni o'chirib, haqiqiysini so'rash"
rm -rf "$DATA/letsencrypt/live/$DOMAIN" "$DATA/letsencrypt/archive/$DOMAIN" "$DATA/letsencrypt/renewal/$DOMAIN.conf"
DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do DOMAIN_ARGS+=(-d "$d"); done

if ! docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  "${STAGING_ARG[@]}" "${DOMAIN_ARGS[@]}" \
  --cert-name "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --rsa-key-size 4096; then
  echo "XATO: sertifikat olinmadi. nginx yiqilmasligi uchun vaqtinchalik sertifikat qaytarildi."
  make_dummy
  exit 1
fi

echo "### 4/4 nginx ni qayta yuklash va certbot siklini yoqish"
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
docker compose up -d certbot

if [ "${LETSENCRYPT_STAGING:-0}" = "1" ]; then
  echo "DIQQAT: bu SINOV sertifikati (brauzer ishonmaydi). Haqiqiysi uchun: rm -rf data/letsencrypt && LETSENCRYPT_STAGING=0 ./init-letsencrypt.sh"
fi
echo "Tayyor: https://$DOMAIN"
