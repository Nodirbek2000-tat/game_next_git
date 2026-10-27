// Copies the third-party runtime files the engine serves itself (no CDN) from node_modules into /public.
// Run after `npm install` / dependency updates:  node scripts/sync-engine-assets.mjs
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const nm = join(root, "node_modules");
const pub = join(root, "public");

const vision = join(nm, "@mediapipe", "tasks-vision");
mkdirSync(join(pub, "mediapipe"), { recursive: true });
cpSync(join(vision, "vision_bundle.js"), join(pub, "mediapipe", "vision_bundle.js"));
if (existsSync(join(vision, "wasm"))) {
  for (const f of readdirSync(join(vision, "wasm"))) cpSync(join(vision, "wasm", f), join(pub, "mediapipe", f));
}

const bench = join(nm, "detect-gpu", "dist", "benchmarks");
mkdirSync(join(pub, "detect-gpu"), { recursive: true });
for (const f of readdirSync(bench)) cpSync(join(bench, f), join(pub, "detect-gpu", f));

console.log("engine assets synced (mediapipe wasm + vision_bundle.js, detect-gpu benchmarks)");
