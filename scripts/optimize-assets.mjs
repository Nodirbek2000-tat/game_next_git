// Shrinks the downloaded assets of the games that ship heavy art (Shahar simulyatori = poyga, Baliq ovi = baliq-ovi).
//
//   npm run assets:optimize                 everything
//   npm run assets:optimize -- textures     only textures   (also: models, hdr)
//   npm run assets:optimize -- poyga        only one game   (combinable: `-- models baliq-ovi`)
//
// SOURCES live in assets-src/ (mirrors public/: assets-src/textures/<game>/..., assets-src/models/<game>/...). They are the
// untouched originals (JPG / PNG / HDR / plain GLB, what Blender and the tools/blender scripts produce). OUTPUTS go to public/
// and are overwritten on every run, so the script is idempotent. assets-src/ is not shipped (.dockerignore, never in public/).
//
//   textures  JPG/PNG -> <name>.webp (max 1024, skies 2048) + <name>.lo.webp (max 512, skies 1024; used on the "low" quality level)
//   models    GLB (+ the trees.json manifests, copied) -> dedup, prune, weld (bitwise-identical vertices only), resample (if animated), vertex-cache reorder,
//             EXT_meshopt_compression (float attributes stay float: the games read / transform raw arrays; only the cars' normals
//             and vertex colours are quantised, see QUANTIZE_NORMAL_COLOR), embedded
//             images -> WebP (EXT_texture_webp, max 1024)
//   hdr       .hdr environment maps: box-filtered down in linear light, re-encoded as RLE RGBE
//
// Not touched on purpose: geometry is never simplified; node / mesh / material names, extras and morphs are kept.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MeshoptEncoder } from "meshoptimizer";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, listTextureSlots, prune, quantize, reorder, resample, weld } from "@gltf-transform/functions";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets-src");
const PUB = join(ROOT, "public");
const GAMES = ["poyga", "baliq-ovi"];

// ---------------------------------------------------------------- settings

const MAX_TEX = 1024;
const MAX_SKY = 2048;
const LO_TEX = 512;
const LO_SKY = 1024;
/** WebP quality per kind of map (normal maps stay high: blocky lighting is the first thing the eye sees) */
const Q = { color: 80, colorAlpha: 85, data: 85, normal: 90, sky: 85 };
/** Source files that are Blender build inputs only (not loaded by any game): not published */
const NOT_SHIPPED = [/^poyga[\\/]asfalt\.jpg$/, /^baliq-ovi[\\/]rod[\\/]/];
/**
 * GLBs whose NORMAL and COLOR_0 are quantised (int16 / uint16 normalised, KHR_mesh_quantization): the car models, which
 * games/poyga/models.ts reads through getX() into plain floats. POSITION always stays float32 (the wheel meshes are root
 * nodes, so a dequantisation transform on them would be dropped; trees / props / fish copy raw arrays or bake matrices).
 */
const QUANTIZE_NORMAL_COLOR = /^poyga[\\/](boron|chaqmoq|sport|traffic[\\/])/;
/** Environment-map width after the reduction, per file (relative to assets-src/textures); unlisted = keep the size */
const HDR_WIDTH = { "poyga/osmon.hdr": 1024, "baliq-ovi/osmon_kun.hdr": 512, "baliq-ovi/osmon_shom.hdr": 512, "baliq-ovi/osmon_tong.hdr": 512 };

// ---------------------------------------------------------------- args / helpers

const args = process.argv.slice(2);
const kinds = args.filter((a) => ["textures", "models", "hdr"].includes(a));
const games = args.filter((a) => GAMES.includes(a));
const wantKind = (k) => kinds.length === 0 || kinds.includes(k);
const wantGame = (rel) => games.length === 0 || games.includes(rel.split(sep)[0]);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
function write(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

const totals = new Map();
function tally(group, before, after) {
  const t = totals.get(group) ?? { n: 0, before: 0, after: 0 };
  t.n++;
  t.before += before;
  t.after += after;
  totals.set(group, t);
}
const kb = (n) => (n / 1024).toFixed(0).padStart(6) + " kB";

// ---------------------------------------------------------------- images

/**
 * `input` (Buffer or path) -> lossy WebP. Images that really use their alpha are processed as colour + alpha apart, so the
 * resize cannot blacken the colour under transparent pixels (leaf / impostor edges would get a dark fringe), and the colour
 * under alpha 0 is kept (`exact`) for the same reason.
 */
async function toWebp(input, { max, quality }) {
  const img = sharp(input, { limitInputPixels: false });
  const meta = await img.metadata();
  const needsAlpha = meta.hasAlpha && !(await sharp(input).stats()).isOpaque;
  const scale = (p) => (Math.max(meta.width, meta.height) > max ? p.resize({ width: max, height: max, fit: "inside", kernel: "lanczos3" }) : p);
  const opts = { quality, effort: 5, smartSubsample: true };
  if (!needsAlpha) return scale(sharp(input).removeAlpha()).webp(opts).toBuffer();
  const rgb = await scale(sharp(input).removeAlpha()).raw().toBuffer({ resolveWithObject: true });
  const a = await scale(sharp(input).extractChannel(3)).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = rgb.info;
  return sharp(rgb.data, { raw: { width, height, channels: 3 } })
    .joinChannel(a.data, { raw: { width, height, channels: 1 } })
    .webp({ ...opts, alphaQuality: 100, exact: true })
    .toBuffer();
}

const isSky = (rel) => /(^|[\\/])osmon[^\\/]*\.(jpe?g|png)$/i.test(rel);
const isNormal = (rel) => /_nor(_gl)?\.|_normal\./i.test(rel);
const isData = (rel) => /_rough\./i.test(rel);

async function textures() {
  const base = join(SRC, "textures");
  for (const file of walk(base).sort()) {
    const rel = relative(base, file);
    if (!/\.(jpe?g|png)$/i.test(file) || !wantGame(rel) || NOT_SHIPPED.some((r) => r.test(rel))) continue;
    const sky = isSky(rel);
    const src = readFileSync(file);
    const alpha = (await sharp(src).metadata()).hasAlpha && !(await sharp(src).stats()).isOpaque;
    const quality = sky ? Q.sky : isNormal(rel) ? Q.normal : isData(rel) ? Q.data : alpha ? Q.colorAlpha : Q.color;
    const stem = join(PUB, "textures", rel.replace(/\.[^.]+$/, ""));
    const hi = await toWebp(src, { max: sky ? MAX_SKY : MAX_TEX, quality });
    const lo = await toWebp(src, { max: sky ? LO_SKY : LO_TEX, quality });
    write(stem + ".webp", hi);
    write(stem + ".lo.webp", lo);
    tally("textures " + rel.split(sep)[0], src.length, hi.length);
    tally("textures(.lo) " + rel.split(sep)[0], src.length, lo.length);
    console.log(`tex  ${rel.padEnd(52)} ${kb(src.length)} -> ${kb(hi.length)} / lo ${kb(lo.length)}${alpha ? "  (alpha)" : ""}`);
  }
}

// ---------------------------------------------------------------- HDR (Radiance RGBE)

function readHdr(buf) {
  let p = 0;
  const line = () => {
    let s = "";
    while (buf[p] !== 10) s += String.fromCharCode(buf[p++]);
    p++;
    return s;
  };
  if (!line().startsWith("#?")) throw new Error("not a Radiance HDR file");
  while (line() !== "") { /* header variables (FORMAT, EXPOSURE ...) */ }
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!m) throw new Error("unsupported HDR orientation");
  const h = +m[1];
  const w = +m[2];
  const rgbe = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = rgbe.subarray(y * w * 4, (y + 1) * w * 4);
    if (w >= 8 && w < 32768 && buf[p] === 2 && buf[p + 1] === 2 && !(buf[p + 2] & 128)) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) {
            n -= 128;
            const v = buf[p++];
            while (n--) row[x++ * 4 + c] = v;
          } else while (n--) row[x++ * 4 + c] = buf[p++];
        }
      }
    } else {
      row.set(buf.subarray(p, p + w * 4));
      p += w * 4;
    }
  }
  return { w, h, rgbe };
}

function rgbeToFloat({ w, h, rgbe }) {
  const f = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const e = rgbe[i * 4 + 3];
    const k = e ? Math.pow(2, e - 136) : 0;
    f[i * 3] = rgbe[i * 4] * k;
    f[i * 3 + 1] = rgbe[i * 4 + 1] * k;
    f[i * 3 + 2] = rgbe[i * 4 + 2] * k;
  }
  return f;
}

/** box filter by an integer factor, in linear light (the sun keeps its energy) */
function downscale(f, w, h, k) {
  if (k <= 1) return { f, w, h };
  const nw = Math.floor(w / k);
  const nh = Math.floor(h / k);
  const o = new Float32Array(nw * nh * 3);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += f[((y * k + j) * w + x * k + i) * 3 + c];
        o[(y * nw + x) * 3 + c] = s / (k * k);
      }
  return { f: o, w: nw, h: nh };
}

function writeHdr({ f, w, h }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, "latin1");
  const parts = [head];
  const ch = [new Uint8Array(w), new Uint8Array(w), new Uint8Array(w), new Uint8Array(w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = f[i];
      const g = f[i + 1];
      const b = f[i + 2];
      const m = Math.max(r, g, b);
      if (m < 1e-32) {
        ch[0][x] = ch[1][x] = ch[2][x] = ch[3][x] = 0;
        continue;
      }
      const e = Math.floor(Math.log2(m)) + 1; // m = frac * 2^e, frac in [0.5, 1)
      const s = 256 / Math.pow(2, e);
      ch[0][x] = Math.min(255, Math.floor(r * s));
      ch[1][x] = Math.min(255, Math.floor(g * s));
      ch[2][x] = Math.min(255, Math.floor(b * s));
      ch[3][x] = e + 128;
    }
    const out = [2, 2, w >> 8, w & 255];
    for (let c = 0; c < 4; c++) {
      const a = ch[c];
      let i = 0;
      while (i < w) {
        let run = 1;
        while (i + run < w && run < 127 && a[i + run] === a[i]) run++;
        if (run >= 3) {
          out.push(128 + run, a[i]);
          i += run;
          continue;
        }
        let j = i;
        while (j < w && j - i < 128) {
          let r = 1;
          while (j + r < w && r < 3 && a[j + r] === a[j]) r++;
          if (r >= 3) break;
          j++;
        }
        out.push(j - i);
        for (let q = i; q < j; q++) out.push(a[q]);
        i = j;
      }
    }
    parts.push(Buffer.from(out));
  }
  return Buffer.concat(parts);
}

async function hdr() {
  const base = join(SRC, "textures");
  for (const file of walk(base).sort()) {
    const rel = relative(base, file);
    if (!/\.hdr$/i.test(file) || !wantGame(rel)) continue;
    const src = readFileSync(file);
    const img = readHdr(src);
    const target = HDR_WIDTH[rel.split(sep).join("/")] ?? img.w;
    const out = writeHdr(downscale(rgbeToFloat(img), img.w, img.h, Math.max(1, Math.round(img.w / target))));
    write(join(PUB, "textures", rel), out);
    tally("hdr " + rel.split(sep)[0], src.length, out.length);
    console.log(`hdr  ${rel.padEnd(52)} ${img.w}x${img.h} ${kb(src.length)} -> ${kb(out.length)}`);
  }
}

// ---------------------------------------------------------------- GLB

/** distinct names of a property list, as one comparable string */
const names = (list) => [...new Set(list.map((x) => x.getName()))].sort().join("|");

let io;
async function modelIo() {
  if (io) return io;
  await MeshoptEncoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  io.setLogger(new Logger(Logger.Verbosity.WARN));
  return io;
}

/** every embedded image -> WebP, quality by the slot it is used in */
async function glbTextures(doc) {
  const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const slots = listTextureSlots(tex);
    const quality = slots.some((s) => /normal/i.test(s))
      ? Q.normal
      : slots.some((s) => /occlusion|metallicRoughness/i.test(s))
        ? Q.data
        : Q.color;
    const img = Buffer.from(tex.getImage());
    const alpha = (await sharp(img).metadata()).hasAlpha && !(await sharp(img).stats()).isOpaque;
    const out = await toWebp(img, { max: MAX_TEX, quality: alpha && quality === Q.color ? Q.colorAlpha : quality });
    tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  }
  if (doc.getRoot().listTextures().length === 0) webp.dispose();
}

async function models() {
  const base = join(SRC, "models");
  const nio = await modelIo();
  for (const file of walk(base).sort()) {
    const rel = relative(base, file);
    if (!/\.glb$/i.test(file) || !wantGame(rel)) continue;
    const src = readFileSync(file);
    const doc = await nio.readBinary(new Uint8Array(src));
    const root = doc.getRoot();
    const tris = () => root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
    const trisBefore = tris();
    const nodesBefore = names(root.listNodes());
    const matsBefore = names(root.listMaterials());
    await doc.transform(
      // names are an API (cars: material = role, wheel* nodes; rod: handle / reel / ...): never merge differently named things
      dedup({ keepUniqueNames: true }),
      prune({ keepLeaves: true, keepExtras: true, keepSolidTextures: true }),
      weld(),
    );
    if (root.listAnimations().length) await doc.transform(resample());
    await glbTextures(doc);
    if (QUANTIZE_NORMAL_COLOR.test(rel)) await doc.transform(quantize({ pattern: /^(NORMAL|COLOR_0)$/, patternTargets: /^$/, quantizeNormal: 10, quantizeColor: 16 }));
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: "size" }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
        const out = Buffer.from(await nio.writeBinary(doc));
    if (tris() !== trisBefore) throw new Error(`${rel}: triangle count changed`);
    if (names(root.listNodes()) !== nodesBefore) throw new Error(`${rel}: node names changed`);
    if (names(root.listMaterials()) !== matsBefore) throw new Error(`${rel}: material names changed`);
    write(join(PUB, "models", rel), out);
    tally("models " + rel.split(sep)[0], src.length, out.length);
    console.log(`glb  ${rel.padEnd(52)} ${kb(src.length)} -> ${kb(out.length)}  ${Math.round(trisBefore)} tris`);
  }
  // manifests the games fetch next to the models (trees.json: size + leaf texture per variant) are copied as they are
  for (const file of walk(base).sort()) {
    const rel = relative(base, file);
    if (!/\.json$/i.test(file) || !wantGame(rel)) continue;
    write(join(PUB, "models", rel), readFileSync(file));
    console.log(`json ${rel}`);
  }
}

// ---------------------------------------------------------------- run

if (wantKind("textures")) await textures();
if (wantKind("hdr")) await hdr();
if (wantKind("models")) await models();
console.log("\ngroup".padEnd(28) + "files        before         after");
for (const [g, t] of [...totals].sort()) console.log(g.padEnd(27) + String(t.n).padStart(5) + String(t.before).padStart(14) + String(t.after).padStart(14));
