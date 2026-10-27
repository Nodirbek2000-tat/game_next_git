# syntax=docker/dockerfile:1
# Next.js 16 (output: "standalone"). Build kontekst: game_next/
# Port 3000, non-root (node, uid 1000).

ARG NODE_IMAGE=node:24-alpine

# ---- 1) bog'liqliklar ----
FROM ${NODE_IMAGE} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
# Build uchun devDependencies ham kerak (@tailwindcss/turbopack, typescript)
RUN npm ci --no-audit --no-fund

# ---- 2) build ----
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* qiymatlari build vaqtida kodga yoziladi — o'zgarsa qayta build kerak.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3) ishga tushirish ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Next keshi (.next/cache) uchun yozish huquqi
RUN mkdir -p .next/cache && chown -R node:node .next

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
