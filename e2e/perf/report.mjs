// Markdown before/after table from two perf runs:  node e2e/perf/report.mjs e2e/perf/out/before.jsonl e2e/perf/out/after.jsonl
import { readFileSync } from "node:fs";

const load = (f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const [a, b] = process.argv.slice(2).map(load);
const key = (r) => `${r.game}|${r.throttle}`;
const idx = new Map(b.map((r) => [key(r), r]));
const rows = [];
rows.push("| game | CPU x | fps | frame p95 ms | long tasks (n / ms) | main busy % | renderer CPU % | GPU proc CPU % | menu fps / p95 | load s | detect/s | infer ms | backend | draw calls | quality |");
rows.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const cell = (x, y) => (x === y ? `${x}` : `${x} -> **${y}**`);
for (const r of a) {
  const n = idx.get(key(r));
  if (!n) continue;
  rows.push(
    `| ${r.game} | ${r.throttle} | ${cell(r.fps, n.fps)} | ${cell(r.frameP95, n.frameP95)} | ${r.longTasks} / ${r.longTaskMs} -> **${n.longTasks} / ${n.longTaskMs}** | ${cell(r.mainBusyPct, n.mainBusyPct)} | ${cell(r.rendererCpuPct, n.rendererCpuPct)} | ${cell(r.gpuCpuPct, n.gpuCpuPct)} | ${r.menuFps}/${r.menuP95} -> **${n.menuFps}/${n.menuP95}** | ${cell(r.loadSec, n.loadSec)} | ${cell(r.detectFps, n.detectFps)} | ${cell(r.inferMs, n.inferMs)} | ${r.backend}/${r.poseModel} -> ${n.backend}/${n.poseModel} | ${cell(r.calls, n.calls)} | ${r.level}x${r.pixelRatio} -> ${n.level}x${n.pixelRatio} |`,
  );
}
console.log(rows.join("\n"));
