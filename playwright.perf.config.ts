import { defineConfig } from "@playwright/test";

// Perf harness only: runs against an already running server (production build on :3300), see e2e/perf/perf.spec.ts
export default defineConfig({
  testDir: "./e2e/perf",
  timeout: 3_600_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: process.env.PERF_BASE ?? "http://localhost:3300" },
});
