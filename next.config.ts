import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Docker uchun minimal server (.next/standalone). Qarang: Dockerfile.
  output: "standalone",
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Fayl nomida hash yo'q statik resurslar uchun uzoq kesh (/_next/static ni Next o'zi immutable qiladi).
  // 30 kun + stale-while-revalidate: model almashsa, eskisi ko'pi bilan 30 kun turadi.
  async headers() {
    const longCache = "public, max-age=2592000, stale-while-revalidate=86400";
    return [
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: longCache }] },
      { source: "/textures/:path*", headers: [{ key: "Cache-Control", value: longCache }] },
      { source: "/audio/:path*", headers: [{ key: "Cache-Control", value: longCache }] },
      { source: "/detect-gpu/:path*", headers: [{ key: "Cache-Control", value: longCache }] },
      { source: "/mediapipe/:path*", headers: [{ key: "Cache-Control", value: longCache }] },
      {
        source: "/mediapipe/:file(.*\\.wasm)",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
