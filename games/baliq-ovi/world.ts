// The static world of the mountain lake: sky, mountains, terrain (lake bed + shore), trees, rocks, reeds, lily pads, the
// bridge, weeds and clouds. Everything is instanced / merged so the whole world costs ~20 draw calls.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bedDepth, shoreDistance, TIMES_OF_DAY, type LocationConfig, type TimeOfDayPreset } from "./locations";
import { makeCloudTexture, makeWoodTexture, seededRng } from "./textures";
import { applyUnderwaterTint, L_UNDER, L_WORLD, type TintUniforms } from "./water";
import type { TimeOfDay } from "./species";

export const BRIDGE = { z0: 2.4, z1: 11, halfW: 2.1, deckY: 0.55 };
export const TILE = { x0: -90, x1: 90, z0: -130, z1: 30, cell: 3 };

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Terrain height: negative under the lake, small hills on the shore. */
export function terrainHeight(loc: LocationConfig, x: number, z: number): number {
  const d = shoreDistance(loc, x, z);
  if (d > 0) return -bedDepth(loc, x, z);
  const land = -d;
  const edge = Math.min(x - TILE.x0, TILE.x1 - x, z - TILE.z0, TILE.z1 - z);
  const taper = smooth(0, 25, edge);
  const hill = smooth(2, 45, land) * (2.2 + 1.8 * Math.sin(x * 0.05 + 1) * Math.cos(z * 0.04));
  return 0.18 + 0.12 * Math.min(1, land / 3) + hill * taper;
}

function groundColor(h: number, depth: number, out: THREE.Color): THREE.Color {
  if (depth > 0) {
    // lake bed: sand -> gravel -> mud
    const a = smooth(0.2, 1.2, depth);
    const b = smooth(1.5, 6, depth);
    out.setHex(0xc2b184).lerp(_c1.setHex(0x7d7664), a).lerp(_c1.setHex(0x3d4338), b);
  } else if (h < 0.5) out.setHex(0x9a8a60);
  else if (h < 2.2) out.setHex(0x6c9a45).lerp(_c1.setHex(0x557f38), smooth(0.6, 2.2, h));
  else out.setHex(0x557f38).lerp(_c1.setHex(0x80807a), smooth(2.2, 4.2, h));
  return out;
}
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function buildTerrain(loc: LocationConfig): { bed: THREE.BufferGeometry; land: THREE.BufferGeometry } {
  const nx = Math.round((TILE.x1 - TILE.x0) / TILE.cell);
  const nz = Math.round((TILE.z1 - TILE.z0) / TILE.cell);
  const H = new Float32Array((nx + 1) * (nz + 1));
  const D = new Float32Array((nx + 1) * (nz + 1));
  const idx = (i: number, j: number): number => j * (nx + 1) + i;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = TILE.x0 + i * TILE.cell;
    const z = TILE.z0 + j * TILE.cell;
    H[idx(i, j)] = terrainHeight(loc, x, z);
    D[idx(i, j)] = bedDepth(loc, x, z);
  }
  const make = (pick: (isLand: boolean) => boolean): THREE.BufferGeometry => {
    const pos: number[] = [];
    const col: number[] = [];
    const ind: number[] = [];
    const map = new Map<number, number>();
    const vert = (i: number, j: number): number => {
      const k = idx(i, j);
      let v = map.get(k);
      if (v === undefined) {
        v = pos.length / 3;
        map.set(k, v);
        const x = TILE.x0 + i * TILE.cell;
        const z = TILE.z0 + j * TILE.cell;
        pos.push(x, H[k], z);
        groundColor(H[k], D[k], _c2);
        // slight per-vertex variation
        const n = 0.92 + 0.16 * (Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.5 + 0.5);
        col.push(_c2.r * n, _c2.g * n, _c2.b * n);
      }
      return v;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const hs = [H[idx(i, j)], H[idx(i + 1, j)], H[idx(i, j + 1)], H[idx(i + 1, j + 1)]];
      const isLand = Math.max(...hs) > -0.15;
      if (!pick(isLand)) continue;
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i, j + 1);
      const d = vert(i + 1, j + 1);
      ind.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  };
  return { bed: make((l) => !l), land: make((l) => l) };
}

// ---------------------------------------------------------------- mountains

function peak(rng: () => number, cx: number, cz: number, r: number, h: number, snowLine: number, green: boolean): THREE.BufferGeometry {
  const seg = 9;
  const rings = 5;
  const pos: number[] = [];
  const col: number[] = [];
  const ind: number[] = [];
  const c = new THREE.Color();
  const jit = Array.from({ length: seg * rings }, () => 0.85 + rng() * 0.3);
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const rad = r * Math.pow(1 - t, 0.85);
    const y = h * t * (0.92 + 0.16 * rng());
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const j = k === rings ? 1 : jit[k * seg + s];
      pos.push(cx + Math.cos(a) * rad * j, y - 8, cz + Math.sin(a) * rad * j);
      if (t > snowLine) c.setHex(0xf2f6fb);
      else if (green && t < 0.45) c.setHex(0x4f7a3a).lerp(_c1.setHex(0x7a8a68), t * 1.5);
      else c.setHex(0x6f8aa6).lerp(_c1.setHex(0x8b95a0), t);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let k = 0; k < rings; k++) for (let s = 0; s < seg; s++) {
    const a = k * seg + s;
    const b = k * seg + ((s + 1) % seg);
    ind.push(a, a + seg, b, b, a + seg, b + seg);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

function buildMountains(): THREE.BufferGeometry {
  const rng = seededRng(33);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const x = -640 + i * 116 + (rng() - 0.5) * 40;
    parts.push(peak(rng, x, -470 - rng() * 60, 90 + rng() * 70, 100 + rng() * 90, 0.58, false));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(peak(rng, sx * (360 + rng() * 120), -120 - i * 110 - rng() * 40, 80 + rng() * 50, 70 + rng() * 60, 0.66, false));
  for (let i = 0; i < 14; i++) parts.push(peak(rng, -420 + i * 64 + (rng() - 0.5) * 25, -345 - rng() * 30, 45 + rng() * 40, 22 + rng() * 22, 2, true));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

// ---------------------------------------------------------------- helpers

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.frustumCulled = false;
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function setInst(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): void {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  m.setMatrixAt(i, _m);
}

function colorVertices(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}

export interface WorldQuality {
  trees: number;
  rocks: number;
  weeds: number;
  reeds: number;
  pads: number;
  clouds: number;
}
export const WORLD_COUNTS: Record<"high" | "medium" | "low", WorldQuality> = {
  high: { trees: 240, rocks: 40, weeds: 150, reeds: 90, pads: 26, clouds: 14 },
  medium: { trees: 150, rocks: 28, weeds: 90, reeds: 60, pads: 18, clouds: 10 },
  low: { trees: 70, rocks: 14, weeds: 40, reeds: 30, pads: 10, clouds: 6 },
};

const SKY_V = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const SKY_F = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDim;
varying vec3 vDir;
void main(){
  float y = vDir.y;
  vec3 col = mix(uHor, uTop, pow(clamp(y, 0., 1.), 0.55));
  float sd = max(dot(normalize(vDir), uSun), 0.);
  col += uSunCol*(pow(sd, 1100.)*2.2 + pow(sd, 14.)*0.32 + pow(sd, 3.)*0.07);
  col = mix(col, uHor*0.92, smoothstep(0., -0.12, y));
  col *= uDim;
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface WorldObjects {
  group: THREE.Group;
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  /** things that get an extra tint with the light */
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  bridge: THREE.Group;
  /** x, z of the bridge posts that stand in the water (for the foam) */
  posts: [number, number][];
  clouds: THREE.InstancedMesh;
  cloudBase: Float32Array;
  swayTime: { value: number };
  preset: TimeOfDayPreset;
  dim: number;
  disposables: { dispose(): void }[];
  /** replace the procedural bridge with a loaded model */
  setBridgeModel(o: THREE.Object3D): void;
  /** instanced parts that a loaded model can replace (see assets.json: tree, rock, weed, reed) */
  parts: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh; shoreRocks: THREE.InstancedMesh; bedRocks: THREE.InstancedMesh; weeds: THREE.InstancedMesh; reeds: THREE.InstancedMesh };
}

/** One geometry (world transforms baked in) and the first material of a loaded model. Single-material models only. */
export function flattenModel(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material | null } | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", src.getAttribute("position").clone());
    if (src.getAttribute("normal")) g.setAttribute("normal", src.getAttribute("normal").clone());
    if (src.getAttribute("uv")) g.setAttribute("uv", src.getAttribute("uv").clone());
    g.applyMatrix4(m.matrixWorld);
    parts.push(g);
    if (!material) material = Array.isArray(m.material) ? m.material[0] : m.material;
  });
  if (!parts.length) return null;
  const hasUv = parts.every((g) => g.getAttribute("uv"));
  const hasN = parts.every((g) => g.getAttribute("normal"));
  for (const g of parts) {
    if (!hasUv) g.deleteAttribute("uv");
    if (!hasN) g.deleteAttribute("normal");
  }
  const geometry = mergeGeometries(parts);
  if (!geometry) return null;
  if (!hasN) geometry.computeVertexNormals();
  return { geometry, material };
}

export function buildWorld(loc: LocationConfig, level: "high" | "medium" | "low", tod: TimeOfDay, rainy: boolean, tint: TintUniforms): WorldObjects {
  const preset = TIMES_OF_DAY[tod];
  const dim = rainy ? 0.72 : 1;
  const cnt = WORLD_COUNTS[level];
  const rng = seededRng(4242);
  const group = new THREE.Group();
  group.name = "baliq-world";
  const disposables: { dispose(): void }[] = [];
  const sunDir = new THREE.Vector3(...preset.sun).normalize();

  // ---- lights + fog
  const sun = new THREE.DirectionalLight(preset.sunColor, preset.sunIntensity * dim);
  sun.position.copy(sunDir).multiplyScalar(100);
  const hemi = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, preset.hemiIntensity * (rainy ? 0.9 : 1));
  group.add(sun, hemi);
  const fog = new THREE.Fog(preset.fog, 90, 520);
  if (rainy) fog.color.lerp(new THREE.Color(0x9aa5ad), 0.5);

  // ---- sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(preset.skyTop).lerp(new THREE.Color(0x7d8791), rainy ? 0.55 : 0) },
      uHor: { value: new THREE.Color(preset.skyHorizon).lerp(new THREE.Color(0xaab3ba), rainy ? 0.5 : 0) },
      uSun: { value: sunDir },
      uSunCol: { value: new THREE.Color(preset.sunColor).multiplyScalar(rainy ? 0.25 : 1) },
      uDim: { value: dim },
    },
    vertexShader: SKY_V,
    fragmentShader: SKY_F,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 14), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- clouds (instanced billboards, drift slowly)
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: rainy ? 0.95 : 0.8, depthWrite: false, fog: false, color: rainy ? 0x9aa0a8 : tod === "sunset" ? 0xffd2b4 : 0xffffff });
  const clouds = instanced(new THREE.PlaneGeometry(1, 0.5), cloudMat, cnt.clouds);
  const cloudBase = new Float32Array(cnt.clouds * 5);
  for (let i = 0; i < cnt.clouds; i++) {
    cloudBase.set([(rng() - 0.5) * 1000, 70 + rng() * 90, -280 - rng() * 370, 140 + rng() * 120, 50 + rng() * 40], i * 5);
  }
  group.add(clouds);

  // ---- mountains
  const mtn = new THREE.Mesh(buildMountains(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mtn.frustumCulled = false;
  group.add(mtn);

  // ---- terrain
  const { bed, land } = buildTerrain(loc);
  const landMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const landMesh = new THREE.Mesh(land, landMat);
  landMesh.name = "land";
  landMesh.layers.set(L_WORLD);
  const bedMat = landMat.clone();
  applyUnderwaterTint(bedMat, tint);
  const bedMesh = new THREE.Mesh(bed, bedMat);
  bedMesh.name = "bed";
  bedMesh.layers.set(L_UNDER);
  group.add(landMesh, bedMesh);
  // flat far land outside the tile (merged boxes)
  const farParts = [
    new THREE.BoxGeometry(400, 2, 300).translate(TILE.x1 + 200, -0.65, -150),
    new THREE.BoxGeometry(400, 2, 300).translate(TILE.x0 - 200, -0.65, -150),
    new THREE.BoxGeometry(1200, 2, 150).translate(0, -0.65, -365),
    new THREE.BoxGeometry(400, 2, 60).translate(TILE.x1 + 200, -0.65, 60),
    new THREE.BoxGeometry(400, 2, 60).translate(TILE.x0 - 200, -0.65, 60),
  ].map((g) => colorVertices(g, 0x5f8a3a));
  const farMesh = new THREE.Mesh(mergeGeometries(farParts)!, new THREE.MeshLambertMaterial({ vertexColors: true }));
  farMesh.frustumCulled = false;
  group.add(farMesh);

  // ---- trees (two instanced meshes)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 3.2, 6).translate(0, 1.6, 0);
  const crown = mergeGeometries([0, 1, 2].map((k) => colorVertices(new THREE.ConeGeometry(3 - k * 0.75, 4.2, 8).translate(0, 4 + k * 2, 0), [0x2f6b2a, 0x3d7d31, 0x275f26][k])))!;
  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b3b22 }), cnt.trees);
  const crowns = instanced(crown, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), cnt.trees);
  let ti = 0;
  let guard = 0;
  while (ti < cnt.trees && guard++ < cnt.trees * 40) {
    const far = rng() < 0.45;
    const x = far ? (rng() - 0.5) * 900 : TILE.x0 + 4 + rng() * (TILE.x1 - TILE.x0 - 8);
    const z = far ? -270 - rng() * 90 : 6 + rng() * 22 + (rng() < 0.5 ? 0 : -rng() * 120);
    const inTile = x > TILE.x0 && x < TILE.x1 && z > TILE.z0 && z < TILE.z1;
    const d = shoreDistance(loc, x, z);
    if (!far && (!inTile || d > -2.5)) continue;
    if (far && inTile) continue;
    // keep the bridge access clear
    if (Math.abs(x) < 6 && z > -4 && z < 24) continue;
    const y = inTile ? terrainHeight(loc, x, z) - 0.1 : 0.2;
    const sc = 0.9 + rng() * 1.0;
    setInst(trunks, ti, x, y, z, sc, sc, sc, rng() * 6);
    setInst(crowns, ti, x, y, z, sc, sc * (0.9 + rng() * 0.3), sc, rng() * 6);
    ti++;
  }
  trunks.count = crowns.count = ti;
  group.add(trunks, crowns);

  // ---- shore rocks + bed rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8b8b84, flatShading: true });
  const shoreRocks = instanced(rockGeo, rockMat, cnt.rocks);
  let ri = 0;
  guard = 0;
  while (ri < cnt.rocks && guard++ < 4000) {
    const x = -60 + rng() * 120;
    const z = -20 + rng() * 40;
    const d = shoreDistance(loc, x, z);
    if (d < -1.8 || d > -0.1) continue;
    const s = 0.25 + rng() * 0.7;
    setInst(shoreRocks, ri++, x, terrainHeight(loc, x, z) + s * 0.1, z, s * 1.3, s * 0.8, s, rng() * 6);
  }
  shoreRocks.count = ri;
  group.add(shoreRocks);
  const bedRockMat = new THREE.MeshLambertMaterial({ color: 0x77766a, flatShading: true });
  applyUnderwaterTint(bedRockMat, tint);
  const bedRocks = instanced(rockGeo, bedRockMat, cnt.rocks + 10);
  bedRocks.layers.set(L_UNDER);
  let bi = 0;
  guard = 0;
  while (bi < cnt.rocks + 10 && guard++ < 4000) {
    const x = -40 + rng() * 80;
    const z = -50 + rng() * 58;
    const dep = bedDepth(loc, x, z);
    if (dep < 0.3) continue;
    const s = 0.2 + rng() * 0.6;
    setInst(bedRocks, bi++, x, -dep + s * 0.15, z, s * 1.4, s * 0.7, s, rng() * 6);
  }
  bedRocks.count = bi;
  group.add(bedRocks);

  // ---- weeds (layer UNDER) and reeds (shore): both sway
  const swayTime = { value: 0 };
  const sway = (mat: THREE.Material, amp: number): void => {
    mat.customProgramCacheKey = () => "sway" + amp;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSwayTime = swayTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uSwayTime;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3].x*0.7 + instanceMatrix[3].z*0.5;\n#else\n float ph = 0.;\n#endif\n transformed.x += sin(uSwayTime*1.6 + ph)*${amp.toFixed(3)}*position.y*position.y;\n transformed.z += cos(uSwayTime*1.3 + ph*1.3)*${(amp * 0.7).toFixed(3)}*position.y*position.y;`);
    };
  };
  const blade = (h: number, w: number): THREE.BufferGeometry => {
    const g = new THREE.PlaneGeometry(w, h, 1, 3).translate(0, h / 2, 0);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h;
      p.setX(i, p.getX(i) * (1 - t * 0.85));
    }
    return g;
  };
  const weedGeo = mergeGeometries([0, 1, 2, 3, 4].map((k) => blade(0.7 + (k % 3) * 0.35, 0.09).rotateY((k / 5) * Math.PI).translate(Math.sin(k * 2.1) * 0.08, 0, Math.cos(k * 2.1) * 0.08)).map((g) => g.toNonIndexed()))!;
  const weedMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  sway(weedMat, 0.35);
  applyUnderwaterTint(weedMat, tint);
  const weeds = instanced(weedGeo, weedMat, cnt.weeds);
  weeds.layers.set(L_UNDER);
  let wi = 0;
  guard = 0;
  while (wi < cnt.weeds && guard++ < 6000) {
    const x = -34 + rng() * 68;
    const z = -34 + rng() * 40;
    const dep = bedDepth(loc, x, z);
    if (dep < 0.35 || dep > 3.2) continue;
    const s = 0.8 + rng() * 1.1;
    setInst(weeds, wi, x, -dep, z, s, s * (dep > 2 ? 1.6 : 1), s, rng() * 6);
    weeds.setColorAt(wi, _c1.setHSL(0.25 + rng() * 0.08, 0.6, 0.28 + rng() * 0.12));
    wi++;
  }
  weeds.count = wi;
  if (weeds.instanceColor) weeds.instanceColor.needsUpdate = true;
  group.add(weeds);

  const reedMat = new THREE.MeshLambertMaterial({ color: 0x6b8f3a, side: THREE.DoubleSide });
  sway(reedMat, 0.04);
  const reedGeo = mergeGeometries([0, 1, 2].map((k) => blade(1.6 + k * 0.4, 0.07).rotateY(k * 1.0).translate(k * 0.04, 0, 0)).map((g) => g.toNonIndexed()))!;
  const reeds = instanced(reedGeo, reedMat, cnt.reeds);
  let ei = 0;
  guard = 0;
  while (ei < cnt.reeds && guard++ < 6000) {
    const x = -66 + rng() * 132;
    const z = -30 + rng() * 45;
    const d = shoreDistance(loc, x, z);
    if (d < -0.4 || d > 1.2) continue;
    if (Math.abs(x) < 3.2 && z > -2) continue;
    const s = 0.7 + rng() * 0.9;
    setInst(reeds, ei++, x, Math.max(0.1, terrainHeight(loc, x, z)), z, s, s, s, rng() * 6, 0, (rng() - 0.5) * 0.2);
  }
  reeds.count = ei;
  group.add(reeds);

  // ---- lily pads (+ a few flowers)
  const padGeo = new THREE.CircleGeometry(0.5, 14, 0.3, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2);
  const pads = instanced(padGeo, new THREE.MeshLambertMaterial({ color: 0x2c6427, side: THREE.DoubleSide }), cnt.pads);
  const flowers = instanced(new THREE.ConeGeometry(0.12, 0.2, 7), new THREE.MeshLambertMaterial({ color: 0xff8fc4, emissive: 0x401020 }), Math.ceil(cnt.pads / 3));
  let pi = 0;
  let fi = 0;
  guard = 0;
  while (pi < cnt.pads && guard++ < 4000) {
    const x = -40 + rng() * 80;
    const z = -26 + rng() * 32;
    const dep = bedDepth(loc, x, z);
    if (dep < 0.5 || dep > 1.8) continue;
    if (Math.abs(x) < 4.5 && z > -2) continue;
    const s = 0.7 + rng() * 0.9;
    setInst(pads, pi++, x, 0.06, z, s, 1, s, rng() * 6);
    if (fi < flowers.count && rng() < 0.35) setInst(flowers, fi++, x, 0.16, z, 1, 1, 1);
  }
  pads.count = pi;
  flowers.count = fi;
  group.add(pads, flowers);

  // ---- bridge
  const wood = makeWoodTexture();
  const woodMat = new THREE.MeshLambertMaterial({ map: wood });
  const bridge = new THREE.Group();
  bridge.name = "bridge";
  const plankCount = Math.ceil((BRIDGE.z1 - BRIDGE.z0) / 0.27);
  const planks = instanced(new THREE.BoxGeometry(BRIDGE.halfW * 2, 0.07, 0.24), woodMat, plankCount);
  for (let i = 0; i < plankCount; i++) setInst(planks, i, (rng() - 0.5) * 0.03, BRIDGE.deckY, BRIDGE.z0 + 0.13 + i * 0.27, 1, 1, 1, (rng() - 0.5) * 0.015);
  const postZ = [BRIDGE.z0 + 0.3, BRIDGE.z0 + 2.7, BRIDGE.z0 + 5.1, BRIDGE.z1 - 0.4];
  const posts = instanced(new THREE.CylinderGeometry(0.11, 0.12, 4.4, 8), woodMat, postZ.length * 2);
  const postPos: [number, number][] = [];
  postZ.forEach((z, i) => {
    for (const [k, sx] of [-1, 1].entries()) {
      const x = sx * (BRIDGE.halfW - 0.1);
      setInst(posts, i * 2 + k, x, BRIDGE.deckY - 1.7, z, 1, 1, 1);
      if (z < 8.8) postPos.push([x, z]);
    }
  });
  posts.layers.enable(L_UNDER);
  const railParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (BRIDGE.halfW - 0.1);
    const len = BRIDGE.z1 - BRIDGE.z0;
    railParts.push(new THREE.BoxGeometry(0.08, 0.08, len).translate(x, BRIDGE.deckY + 1.05, BRIDGE.z0 + len / 2));
    railParts.push(new THREE.BoxGeometry(0.06, 0.06, len).translate(x, BRIDGE.deckY + 0.6, BRIDGE.z0 + len / 2));
    for (const z of postZ) railParts.push(new THREE.BoxGeometry(0.1, 1.1, 0.1).translate(x, BRIDGE.deckY + 0.55, z));
  }
  railParts.push(new THREE.BoxGeometry(BRIDGE.halfW * 2, 0.06, 0.06).translate(0, BRIDGE.deckY + 0.6, BRIDGE.z0 + 0.03));
  const rails = new THREE.Mesh(mergeGeometries(railParts.map((g) => g.toNonIndexed()))!, woodMat);
  bridge.add(planks, posts, rails);
  group.add(bridge);

  disposables.push(cloudTex, wood);

  const setBridgeModel = (o: THREE.Object3D): void => {
    planks.visible = posts.visible = rails.visible = false;
    bridge.add(o);
  };

  return {
    group, sky, skyMat, sun, hemi, fog, bridge, posts: postPos, clouds, cloudBase, swayTime, preset, dim, disposables, setBridgeModel,
    parts: { trunks, crowns, shoreRocks, bedRocks, weeds, reeds },
  };
}

/** Per-frame: sky follows the camera, clouds drift, weeds sway. */
export function updateWorld(w: WorldObjects, camera: THREE.Camera, t: number, dt: number, wind: number): void {
  w.sky.position.copy(camera.position);
  w.swayTime.value = t;
  const n = w.clouds.count;
  for (let i = 0; i < n; i++) {
    const b = w.cloudBase;
    b[i * 5] += dt * (2 + wind * 6);
    if (b[i * 5] > 520) b[i * 5] = -520;
    setInst(w.clouds, i, b[i * 5], b[i * 5 + 1], b[i * 5 + 2], b[i * 5 + 3], b[i * 5 + 4], 1);
  }
  w.clouds.instanceMatrix.needsUpdate = true;
}
