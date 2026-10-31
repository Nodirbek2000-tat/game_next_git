// The static world of the mountain lake: sky, mountains, terrain (lake bed + shore), trees, rocks, reeds, lily pads, the
// bridge, weeds and clouds. Everything is instanced / merged so the whole world costs ~20 draw calls.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { bedDepth, shoreDistance, TIMES_OF_DAY, type LocationConfig, type TimeOfDayPreset } from "./locations";
import { LOD, liveShare, type Lod } from "./lod";
import { makeCloudTexture, makeWoodTexture, seededRng } from "./textures";
import { applyUnderwaterTint, L_NOREFL, L_UNDER, L_WORLD, type TintUniforms } from "./water";
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

const _c1 = new THREE.Color();

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
    const spl: number[] = [];
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
        // the photo textures carry the colour; the vertex colour only varies it (patches, wet shore, rocky hill tops)
        const n = 0.86 + 0.22 * (Math.sin(x * 0.37 + Math.cos(z * 0.21) * 2) * Math.cos(z * 0.29) * 0.5 + 0.5);
        const d = shoreDistance(loc, x, z);
        const wet = d > -1.2 ? 0.78 : 1;
        col.push(n * wet, n * wet * (H[k] > 2.4 ? 0.95 : 1), n * wet * 0.97);
        // splat: grass / pebbles / mud
        const land = -d;
        const peb = d > 0 ? 1 - smooth(0.8, 2.6, D[k]) : 1 - smooth(0.6, 3.2 + 1.5 * Math.sin(x * 0.3), land);
        const rocky = smooth(3.0, 4.6, H[k]) * 0.6;
        spl.push(d > 0 ? 0 : (1 - peb) * (1 - rocky), Math.max(peb, rocky), d > 0 ? 1 - peb : 0);
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
    g.setAttribute("splat", new THREE.Float32BufferAttribute(spl, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  };
  return { bed: make((l) => !l), land: make((l) => l) };
}

// ---------------------------------------------------------------- ground material

/**
 * Poly Haven CC0 photo textures (leafy_grass, river_small_rocks, brown_mud_02) blended by the "splat" attribute.
 * `lite` (low level): the three colour maps only, one grass tile, no normal maps (7 texture reads -> 3).
 */
function groundMaterial(tex: { [k: string]: THREE.Texture }, lite: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.45 });
  m.onBeforeCompile = (sh) => {
    for (const k in tex) sh.uniforms[k] = { value: tex[k] };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 splat; varying vec3 vSplat; varying vec3 vGp; varying vec3 vGn;")
      .replace("#include <defaultnormal_vertex>", "#include <defaultnormal_vertex>\nvGn = normalize(mat3(modelMatrix)*objectNormal);")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGp = (modelMatrix*vec4(transformed,1.)).xyz; vSplat = splat;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vSplat; varying vec3 vGp; varying vec3 vGn;\nuniform sampler2D tGrass, tPeb, tMud${lite ? ";" : ", nGrass, nPeb, nMud;"}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 tp = vGp.xz;
  vec3 gw = vSplat/max(1e-3, vSplat.x + vSplat.y + vSplat.z);
  vec3 cG = ${lite ? "texture2D(tGrass, tp/3.1).rgb" : "mix(texture2D(tGrass, tp/3.1).rgb, texture2D(tGrass, tp/11.7 + 0.37).rgb, 0.45)"};
  vec3 cP = texture2D(tPeb, tp/2.3).rgb;
  vec3 cM = texture2D(tMud, tp/3.6).rgb;
  diffuseColor.rgb *= cG*gw.x + cP*gw.y + cM*gw.z;`,
      );
    if (lite) return;
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `vec3 nb = (texture2D(nGrass, tp/3.1).xyz*gw.x + texture2D(nPeb, tp/2.3).xyz*gw.y + texture2D(nMud, tp/3.6).xyz*gw.z)*2. - 1.;
  vec3 gwn = normalize(vGn*max(nb.z, 0.2) + vec3(nb.x, 0., -nb.y)*0.85);
  normal = normalize((viewMatrix*vec4(gwn, 0.)).xyz);`,
    );
  };
  m.customProgramCacheKey = () => (lite ? "baliq-ground-lite" : "baliq-ground");
  return m;
}

function loadGroundTextures(lod: Lod, level: QualityLevel): { [k: string]: THREE.Texture } {
  const L = new THREE.TextureLoader();
  const t = (f: string, srgb: boolean): THREE.Texture => {
    const x = L.load(texUrl(`/textures/baliq-ovi/ground/${f}`, level));
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.anisotropy = lod.aniso;
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    return x;
  };
  const diff = { tGrass: t("leafy_grass_diff", true), tPeb: t("river_small_rocks_diff", true), tMud: t("brown_mud_02_diff", true) };
  if (lod.lite) return diff;
  return { ...diff, nGrass: t("leafy_grass_nor_gl", false), nPeb: t("river_small_rocks_nor_gl", false), nMud: t("brown_mud_02_nor_gl", false) };
}

// ---------------------------------------------------------------- mountains

const hash2 = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** ridged multifractal: sharp crests and valleys like real eroded ranges */
function ridged(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let prev = 1;
  for (let o = 0; o < 6; o++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    n *= n;
    sum += n * amp * prev;
    prev = Math.min(1, n * 1.6);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** The far ranges: a ridged-noise heightfield in a fan around the lake (polar grid, ~16k triangles), coloured by
 * height and slope (forest, bare rock, snow); the haze is done in its material. */
export function mountainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z + 30);
  const ramp = smooth(420, 760, r);
  const az = Math.atan2(x, -(z + 30));
  // a saddle where the evening sun goes down (sunset light dir ~ +27 deg), so it can still glint on the water
  const saddle = 1 - 0.75 * Math.exp(-(((az - 0.47) / 0.2) ** 2)) * (1 - smooth(700, 1100, r));
  const big = ridged(x * 0.0021 + 3.1, z * 0.0021 + 7.7);
  const hills = vnoise(x * 0.012, z * 0.012);
  return (14 + 22 * hills) * smooth(380, 470, r) + ramp * saddle * (30 + 300 * big * big);
}

function buildMountains({ na: NA, nr: NR, rMax }: Lod["mtn"]): THREE.BufferGeometry {
  const pos: number[] = [];
  const ind: number[] = [];
  const A0 = -2.1;
  const A1 = 2.1;
  for (let j = 0; j <= NR; j++) {
    const t = j / NR;
    const r = 430 + (rMax - 430) * t * t;
    for (let i = 0; i <= NA; i++) {
      const az = A0 + ((A1 - A0) * i) / NA;
      const x = Math.sin(az) * r;
      const z = -30 - Math.cos(az) * r;
      pos.push(x, mountainHeight(x, z) - 9, z);
    }
  }
  for (let j = 0; j < NR; j++)
    for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i;
      const b = a + NA + 1;
      ind.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  // what covers the ground (forest, rock, snow, alpine meadow): by height, slope and a little noise
  const n = g.getAttribute("normal");
  const w = new Float32Array((pos.length / 3) * 4);
  for (let k = 0; k < pos.length / 3; k++) {
    const x = pos[k * 3];
    const h = pos[k * 3 + 1] + 9;
    const z = pos[k * 3 + 2];
    const up = n.getY(k);
    const jit = vnoise(x * 0.012, z * 0.012);
    const tree = 1 - smooth(110 + 50 * jit, 185 + 50 * jit, h);
    const steep = smooth(0.5, 0.32, up);
    const snow = smooth(185 + 60 * jit, 245, h) * smooth(0.5, 0.75, up);
    const meadow = (1 - tree) * (1 - snow) * smooth(0.62, 0.8, up) + tree * smooth(0.62, 0.78, vnoise(x * 0.02 + 9, z * 0.02)) * 0.6;
    const forest = tree * (1 - steep * 0.8) * 1.6;
    const rock = Math.max(steep * (1 - snow * 0.6), (1 - tree) * (1 - snow) * 0.5) + 0.02;
    const sum = forest + rock + snow + meadow;
    w.set([forest / sum, rock / sum, snow / sum, meadow / sum], k * 4);
  }
  g.setAttribute("cover", new THREE.BufferAttribute(w, 4));
  return g;
}

/** Far ranges: CC0 photo textures (Blender-rendered fir canopy, Poly Haven cliff_side / aerial_rocks_02 /
 * snow_field_aerial / aerial_grass_rock) blended by the "cover" attribute; rock is projected triplanar.
 * `lite` (low level): rock from two planar reads, no ragged forest edge, no macro variation, no normal maps (11 reads -> 5). */
function mountainMaterial(lod: Lod, haze: { value: THREE.Color }, disposables: { dispose(): void }[], level: QualityLevel): THREE.MeshStandardMaterial {
  const lite = lod.lite;
  const L = new THREE.TextureLoader();
  const t = (f: string, srgb = true): THREE.Texture => {
    const x = L.load(texUrl(`/textures/baliq-ovi/mtn/${f}`, level));
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.anisotropy = lod.aniso;
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    disposables.push(x);
    return x;
  };
  const diff = { tForest: t("forest_canopy"), tCliff: t("cliff_side_diff"), tRocks: t("aerial_rocks_02_diff"), tSnow: t("snow_field_aerial_diff"), tMeadow: t("aerial_grass_rock_diff") };
  const tex: { [k: string]: THREE.Texture } = lite ? diff : { ...diff, nCliff: t("cliff_side_nor_gl", false), nRocks: t("aerial_rocks_02_nor_gl", false) };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, envMapIntensity: 0.6, fog: false });
  m.onBeforeCompile = (sh) => {
    for (const k in tex) sh.uniforms[k] = { value: tex[k] };
    sh.uniforms.uHaze = haze;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 cover; varying vec4 vCover; varying vec3 vWp; varying vec3 vMn;")
      .replace("#include <defaultnormal_vertex>", "#include <defaultnormal_vertex>\nvMn = normalize(mat3(modelMatrix)*objectNormal);")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWp = (modelMatrix*vec4(transformed,1.)).xyz; vCover = cover;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec4 vCover; varying vec3 vWp; varying vec3 vMn; uniform vec3 uHaze;\nuniform sampler2D tForest, tCliff, tRocks, tSnow, tMeadow${lite ? ";" : ", nCliff, nRocks;"}`,
      )
      .replace(
        "#include <map_fragment>",
        lite
          ? `vec3 mn = normalize(vMn);
  vec3 cRock = mix(texture2D(tCliff, vWp.xz/34.).rgb, texture2D(tRocks, vWp.xz/26.).rgb, smoothstep(0.55, 0.9, abs(mn.y)));
  vec3 cForest = texture2D(tForest, vWp.xz/46.).rgb*1.15;
  vec3 cSnow = texture2D(tSnow, vWp.xz/40.).rgb;
  vec3 cMeadow = texture2D(tMeadow, vWp.xz/55.).rgb;
  vec4 cw = vCover;
  cw /= max(1e-3, cw.x + cw.y + cw.z + cw.w);
  diffuseColor.rgb = cForest*cw.x + cRock*cw.y + cSnow*cw.z + cMeadow*cw.w;`
          : `vec3 mn = normalize(vMn);
  vec3 bw = pow(abs(mn), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
  // large-scale variation hides the tiling
  float macro = 0.75 + 0.5*texture2D(tMeadow, vWp.xz/1900.).g;
  vec3 cRock = texture2D(tCliff, vWp.zy/34.).rgb*bw.x + texture2D(tCliff, vWp.xy/34.).rgb*bw.z + texture2D(tRocks, vWp.xz/26.).rgb*bw.y;
  vec3 cForest = texture2D(tForest, vWp.xz/46.).rgb*1.15;
  vec3 cSnow = texture2D(tSnow, vWp.xz/40.).rgb;
  vec3 cMeadow = texture2D(tMeadow, vWp.xz/55.).rgb;
  vec4 cw = vCover;
  // the forest edge is ragged, not a line
  float fe = texture2D(tForest, vWp.xz/9.).g;
  cw.x *= smoothstep(0.05, 0.35, cw.x + (fe - 0.5)*0.5);
  cw /= max(1e-3, cw.x + cw.y + cw.z + cw.w);
  diffuseColor.rgb = (cForest*cw.x + cRock*macro*cw.y + cSnow*cw.z + cMeadow*macro*cw.w);`,
      )
      .replace(
        "#include <tonemapping_fragment>",
        `float hd = length(vWp.xz - cameraPosition.xz);
  float hz = (1. - exp(-hd/1700.))*mix(1., 0.8, smoothstep(40., 320., vWp.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(hz, 0., 0.72));
#include <tonemapping_fragment>`,
      );
    if (lite) return;
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `vec3 nr = (texture2D(nCliff, vWp.zy/34.).xyz*bw.x + texture2D(nCliff, vWp.xy/34.).xyz*bw.z + texture2D(nRocks, vWp.xz/26.).xyz*bw.y)*2. - 1.;
  vec3 mwn = normalize(mn + (vec3(nr.x, 0., -nr.y)*bw.y + vec3(0., nr.y, nr.x)*bw.x + vec3(nr.x, nr.y, 0.)*bw.z)*(0.55*cw.y + 0.25));
  normal = normalize((viewMatrix*vec4(mwn, 0.)).xyz);`,
    );
  };
  m.customProgramCacheKey = () => (lite ? "baliq-mountains-lite" : "baliq-mountains");
  return m;
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

/** the sky dome radius as a share of the camera far plane */
const SKY_OF_FAR = 0.92;

const SKY_V = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const SKY_F = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDim;
uniform sampler2D uTex; uniform float uHas; uniform float uRot; uniform vec3 uGrey;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col;
  if (uHas > 0.5) {
    // the photo sky, turned about y so its sun sits where the light comes from
    float c = cos(uRot), s = sin(uRot);
    vec3 q = vec3(c*d.x - s*d.z, d.y, s*d.x + c*d.z);
    vec2 uv = vec2(atan(q.z, q.x)*0.15915494 + 0.5, asin(clamp(q.y, -1., 1.))*0.31830989 + 0.5);
    col = texture2D(uTex, uv).rgb;
    col = mix(col, uGrey*dot(col, vec3(0.3, 0.55, 0.15))*1.25, uGrey.r > 0. ? 0.6 : 0.);
    col = mix(col, uHor, smoothstep(0.01, -0.03, y));
  } else {
    col = mix(uHor, uTop, pow(clamp(y, 0., 1.), 0.55));
    float sd = max(dot(d, uSun), 0.);
    col += uSunCol*(pow(sd, 1100.)*2.2 + pow(sd, 14.)*0.32 + pow(sd, 3.)*0.07);
    col = mix(col, uHor*0.92, smoothstep(0., -0.12, y));
  }
  col *= uDim;
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** yaw that turns the photo's sun direction onto the light direction (rotation about +y, three.js convention) */
export function photoYaw(photoSun: readonly number[], sun: readonly number[]): number {
  return Math.atan2(sun[0], sun[2]) - Math.atan2(photoSun[0], photoSun[2]);
}

/** where a tree / grass patch stands (the real models are placed by scenery.ts once loaded) */
export interface Spot {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  /** variant pick 0..1 */
  k: number;
  /** forest on the plain behind the far shore (billboards only) */
  hill?: boolean;
}

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
  treeSpots: Spot[];
  grassSpots: Spot[];
  /** wind sway for a material (instanced foliage) */
  sway(mat: THREE.Material, amp: number): void;
  /** the photo sky (loaded asynchronously; the gradient sky shows until then) */
  loadSky(onFog: (c: THREE.Color) => void): void;
  /** the photo as image light (HDR -> PMREM); null when it cannot be loaded. Nothing is applied yet. */
  loadEnv(gl: THREE.WebGLRenderer): Promise<THREE.Texture | null>;
  /** make `env` the scene's image light (the hemisphere light gives way to it) */
  applyEnv(scene: THREE.Scene, env: THREE.Texture): void;
  /** the level changed while playing: cheaper / richer counts of what was built, sky dome for the new far plane */
  setLevel(now: QualityLevel): void;
  /** the procedural cone trees, for when the fir models cannot be loaded */
  showFallbackTrees(): void;
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

export function buildWorld(loc: LocationConfig, level: QualityLevel, tod: TimeOfDay, rainy: boolean, tint: TintUniforms): WorldObjects {
  const preset = TIMES_OF_DAY[tod];
  const dim = rainy ? 0.72 : 1;
  const lod = LOD[level];
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
  const fog = new THREE.Fog(preset.fog, 160, 1500);
  if (rainy) fog.color.lerp(new THREE.Color(0x9aa5ad), 0.5);

  // ---- sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(preset.skyTop).lerp(new THREE.Color(0x7d8791), rainy ? 0.55 : 0) },
      uHor: { value: new THREE.Color(preset.skyHorizon).lerp(new THREE.Color(0xaab3ba), rainy ? 0.5 : 0) },
      uSun: { value: sunDir },
      uSunCol: { value: new THREE.Color(preset.sunColor).multiplyScalar(rainy ? 0.25 : 1) },
      uDim: { value: dim },
      uTex: { value: null },
      uHas: { value: 0 },
      uRot: { value: photoYaw(preset.photoSun, preset.sun) },
      uGrey: { value: rainy ? new THREE.Color(0x9aa3ab) : new THREE.Color(0, 0, 0) },
    },
    vertexShader: SKY_V,
    fragmentShader: SKY_F,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  // scaled to the far plane (setLevel keeps it inside)
  sky.scale.setScalar(lod.far * SKY_OF_FAR);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- clouds (instanced billboards, drift slowly)
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: rainy ? 0.95 : 0.8, depthWrite: false, fog: false, color: rainy ? 0x9aa0a8 : tod === "sunset" ? 0xffd2b4 : 0xffffff });
  const clouds = instanced(new THREE.PlaneGeometry(1, 0.5), cloudMat, lod.clouds);
  const cloudBase = new Float32Array(lod.clouds * 5);
  for (let i = 0; i < lod.clouds; i++) {
    cloudBase.set([(rng() - 0.5) * 1000, 70 + rng() * 90, -280 - rng() * 370, 140 + rng() * 120, 50 + rng() * 40], i * 5);
  }
  group.add(clouds);

  // ---- mountains
  // aerial perspective: distant ranges fade into the sky colour, their peaks a little less than their feet
  const mtnHaze = { value: new THREE.Color(preset.fog) };
  const mtnMat = mountainMaterial(lod, mtnHaze, disposables, level);
  const mtn = new THREE.Mesh(buildMountains(lod.mtn), mtnMat);
  mtn.frustumCulled = false;
  group.add(mtn);

  // ---- terrain
  const { bed, land } = buildTerrain(loc);
  const groundTex = loadGroundTextures(lod, level);
  for (const k in groundTex) disposables.push(groundTex[k]);
  const landMat = groundMaterial(groundTex, lod.lite);
  const landMesh = new THREE.Mesh(land, landMat);
  landMesh.name = "land";
  landMesh.layers.set(L_WORLD);
  const bedMat = groundMaterial(groundTex, lod.lite);
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
  ].map((g) => {
    const h = colorVertices(g, 0xb8b8b0);
    const n = h.getAttribute("position").count;
    h.setAttribute("splat", new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? 1 : 0)), 3));
    return h;
  });
  const farMesh = new THREE.Mesh(mergeGeometries(farParts)!, groundMaterial(groundTex, lod.lite));
  farMesh.frustumCulled = false;
  group.add(farMesh);

  // ---- trees (two instanced meshes)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 3.2, 6).translate(0, 1.6, 0);
  const crown = mergeGeometries([0, 1, 2].map((k) => colorVertices(new THREE.ConeGeometry(3 - k * 0.75, 4.2, 8).translate(0, 4 + k * 2, 0), [0x2f6b2a, 0x3d7d31, 0x275f26][k])))!;
  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b3b22 }), lod.trees);
  const crowns = instanced(crown, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), lod.trees);
  const treeSpots: Spot[] = [];
  let ti = 0;
  let guard = 0;
  // a dense belt on the far shore (z ~ -290 .. -370), forests on both side shores, and trees on the near land
  const nFar = Math.round(lod.trees * 0.55);
  const nSide = Math.round(lod.trees * 0.22);
  while (ti < lod.trees && guard++ < lod.trees * 60) {
    let x: number;
    let z: number;
    if (ti < nFar) {
      x = (rng() - 0.5) * 600;
      z = -293 - Math.pow(rng(), 1.4) * 70;
    } else if (ti < nFar + nSide) {
      x = (rng() < 0.5 ? -1 : 1) * (78 + Math.pow(rng(), 0.8) * 120);
      z = -290 + rng() * 310;
    } else {
      x = TILE.x0 + 4 + rng() * (TILE.x1 - TILE.x0 - 8);
      z = 6 + rng() * 22 + (rng() < 0.5 ? 0 : -rng() * 120);
    }
    const inTile = x > TILE.x0 && x < TILE.x1 && z > TILE.z0 && z < TILE.z1;
    if (inTile && shoreDistance(loc, x, z) > -2.5) continue;
    if (!inTile && z > -290 && Math.abs(x) < 92) continue;
    // keep the bridge access clear
    if (Math.abs(x) < 6 && z > -4 && z < 24) continue;
    const y = inTile ? terrainHeight(loc, x, z) - 0.1 : 0.3;
    const sc = 0.9 + rng() * 1.0;
    const rot = rng() * 6;
    setInst(trunks, ti, x, y, z, sc, sc, sc, rot);
    setInst(crowns, ti, x, y, z, sc, sc * (0.9 + rng() * 0.3), sc, rot);
    treeSpots.push({ x, y, z, s: (inTile ? 0.62 : 0.7) + Math.pow(rng(), 1.5) * (inTile ? 0.6 : 0.9), rot, k: rng() });
    ti++;
  }
  trunks.count = crowns.count = ti;
  // forest on the plain behind the far shore and up the lower slopes of the ranges (billboards only: all far away)
  const nHill = lod.hillTrees;
  guard = 0;
  let hill = 0;
  while (hill < nHill && guard++ < nHill * 30) {
    const az = (rng() - 0.5) * 3.6;
    const r = 300 + Math.pow(rng(), 1.3) * 210;
    const x = Math.sin(az) * r;
    const z = -30 - Math.cos(az) * r;
    if (z > -300 && Math.abs(x) < 95) continue;
    const h = Math.max(0.3, mountainHeight(x, z) - 9);
    if (h > 30 + rng() * 20) continue;
    treeSpots.push({ x, y: h, z, s: 0.7 + Math.pow(rng(), 1.5) * 1.0, rot: 0, k: rng(), hill: true });
    hill++;
  }
  trunks.visible = crowns.visible = false;

  // ---- shore rocks + bed rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8b8b84, flatShading: true });
  const shoreRocks = instanced(rockGeo, rockMat, lod.rocks);
  let ri = 0;
  guard = 0;
  while (ri < lod.rocks && guard++ < 4000) {
    const x = -60 + rng() * 120;
    const z = -20 + rng() * 40;
    const d = shoreDistance(loc, x, z);
    if (d < -1.8 || d > -0.1) continue;
    const s = 0.25 + rng() * 0.7;
    setInst(shoreRocks, ri++, x, terrainHeight(loc, x, z) + s * 0.1, z, s * 1.3, s * 0.8, s, rng() * 6);
  }
  shoreRocks.count = ri;
  // not mirrored in the water: skipped by the reflection pass
  shoreRocks.layers.set(L_NOREFL);
  group.add(shoreRocks);
  const bedRockMat = new THREE.MeshLambertMaterial({ color: 0x77766a, flatShading: true });
  applyUnderwaterTint(bedRockMat, tint);
  const bedRocks = instanced(rockGeo, bedRockMat, lod.rocks + 10);
  bedRocks.layers.set(L_UNDER);
  let bi = 0;
  guard = 0;
  while (bi < lod.rocks + 10 && guard++ < 4000) {
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
  const weeds = instanced(weedGeo, weedMat, lod.weeds);
  weeds.layers.set(L_UNDER);
  let wi = 0;
  guard = 0;
  while (wi < lod.weeds && guard++ < 6000) {
    const x = -34 + rng() * 68;
    const z = -34 + rng() * 40;
    const dep = bedDepth(loc, x, z);
    if (dep < 0.35 || dep > 3.2) continue;
    const s = 0.8 + rng() * 1.1;
    setInst(weeds, wi, x, -dep, z, s, s * (dep > 2 ? 1.6 : 1), s, rng() * 6);
    weeds.setColorAt(wi, _c1.setHSL(0.2 + rng() * 0.08, 0.35, 0.14 + rng() * 0.08));
    wi++;
  }
  weeds.count = wi;
  if (weeds.instanceColor) weeds.instanceColor.needsUpdate = true;
  group.add(weeds);

  const reedMat = new THREE.MeshLambertMaterial({ color: 0x6b8f3a, side: THREE.DoubleSide });
  sway(reedMat, 0.04);
  const reedGeo = mergeGeometries([0, 1, 2].map((k) => blade(1.6 + k * 0.4, 0.07).rotateY(k * 1.0).translate(k * 0.04, 0, 0)).map((g) => g.toNonIndexed()))!;
  const reeds = instanced(reedGeo, reedMat, lod.reeds);
  let ei = 0;
  guard = 0;
  while (ei < lod.reeds && guard++ < 6000) {
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

  // grass patches on the shore (the model comes from scenery.ts)
  const grassSpots: Spot[] = [];
  guard = 0;
  while (grassSpots.length < lod.grass && guard++ < lod.grass * 60) {
    const x = -70 + rng() * 140;
    const z = -60 + rng() * 90;
    const d = shoreDistance(loc, x, z);
    const band = d < -0.25 && d > -9 - rng() * 14;
    if (!band) continue;
    if (Math.abs(x) < 3 && z > 0 && z < 13) continue;
    grassSpots.push({ x, y: terrainHeight(loc, x, z) - 0.02, z, s: 0.8 + rng() * 0.8, rot: rng() * 6, k: rng() });
  }

  // ---- lily pads (+ a few flowers)
  const padGeo = new THREE.CircleGeometry(0.5, 14, 0.3, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2);
  const pads = instanced(padGeo, new THREE.MeshLambertMaterial({ color: 0x2c6427, side: THREE.DoubleSide }), lod.pads);
  const flowers = instanced(new THREE.ConeGeometry(0.12, 0.2, 7), new THREE.MeshLambertMaterial({ color: 0xff8fc4, emissive: 0x401020 }), Math.ceil(lod.pads / 3));
  let pi = 0;
  let fi = 0;
  guard = 0;
  while (pi < lod.pads && guard++ < 4000) {
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

  let alive = true;
  disposables.push({ dispose: () => (alive = false) });
  const yaw = skyMat.uniforms.uRot.value as number;
  const loadSky = (onFog: (c: THREE.Color) => void): void => {
    new THREE.TextureLoader().load(texUrl(`/textures/baliq-ovi/osmon_${preset.photo}`, level), (t) => {
      if (!alive) return t.dispose();
      t.colorSpace = THREE.SRGBColorSpace;
      // no mipmaps: the atan() seam would pick the smallest level
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = THREE.RepeatWrapping;
      disposables.push(t);
      skyMat.uniforms.uTex.value = t;
      skyMat.uniforms.uHas.value = 1;
      clouds.visible = false;
      // the haze takes the colour of the photo just above the horizon (towards the lake), so the far shore melts into it
      try {
        const img = t.image as HTMLImageElement;
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 128;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, 256, 128);
        const row = g.getImageData(0, 60, 256, 3).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let i = 0; i < row.length; i += 4) {
          r += row[i];
          gg += row[i + 1];
          b += row[i + 2];
        }
        const n = row.length / 4;
        const col = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
        if (rainy) col.lerp(new THREE.Color(0x9aa5ad), 0.5);
        fog.color.copy(col);
        (skyMat.uniforms.uHor.value as THREE.Color).copy(col);
        mtnHaze.value.copy(col);
        onFog(col);
      } catch {
        /* keep the preset haze */
      }
    });
  };

  const loadEnv = async (gl: THREE.WebGLRenderer): Promise<THREE.Texture | null> => {
    try {
      const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js");
      const tex = await new HDRLoader().loadAsync(`/textures/baliq-ovi/osmon_${preset.photo}.hdr`);
      if (!alive) {
        tex.dispose();
        return null;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(gl);
      const env = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      tex.dispose();
      disposables.push(env);
      return env;
    } catch {
      /* no image lighting: the sun and the hemisphere light still work */
      return null;
    }
  };
  const applyEnv = (scene: THREE.Scene, env: THREE.Texture): void => {
    scene.environment = env;
    scene.environmentIntensity = 0.55 * dim;
    scene.environmentRotation.set(0, yaw, 0);
    hemi.intensity *= 0.55;
  };

  const setBridgeModel = (o: THREE.Object3D): void => {
    planks.visible = posts.visible = rails.visible = false;
    bridge.add(o);
  };

  const showFallbackTrees = (): void => {
    trunks.visible = crowns.visible = true;
    group.add(trunks, crowns);
  };

  // live: a share of what was built stays visible when the level drops (and comes back when it rises)
  const shares: [THREE.InstancedMesh, number, Parameters<typeof liveShare>[0]][] = [
    [shoreRocks, shoreRocks.count, "rocks"], [bedRocks, bedRocks.count, "rocks"], [weeds, weeds.count, "weeds"], [reeds, reeds.count, "reeds"],
    [pads, pads.count, "pads"], [flowers, flowers.count, "pads"], [clouds, clouds.count, "clouds"],
  ];
  const setLevel = (now: QualityLevel): void => {
    for (const [m, n, key] of shares) {
      m.count = Math.ceil(n * liveShare(key, level, now));
      // hidden clouds (the photo sky is in) stay hidden
      if (m !== clouds || skyMat.uniforms.uHas.value === 0) m.visible = m.count > 0;
    }
    sky.scale.setScalar(LOD[now].far * SKY_OF_FAR);
  };

  return {
    group, sky, skyMat, sun, hemi, fog, bridge, posts: postPos, clouds, cloudBase, swayTime, preset, dim, disposables, setBridgeModel, loadSky, loadEnv, applyEnv, setLevel, showFallbackTrees, treeSpots, grassSpots, sway,
    parts: { trunks, crowns, shoreRocks, bedRocks, weeds, reeds },
  };
}

/** Per-frame: sky follows the camera, clouds drift, weeds sway. */
export function updateWorld(w: WorldObjects, camera: THREE.Camera, t: number, dt: number, wind: number): void {
  w.sky.position.copy(camera.position);
  w.swayTime.value = t;
  // the clouds hide when the photo sky comes in: no need to move them then
  if (!w.clouds.visible) return;
  const n = w.clouds.count;
  for (let i = 0; i < n; i++) {
    const b = w.cloudBase;
    b[i * 5] += dt * (2 + wind * 6);
    if (b[i * 5] > 520) b[i * 5] = -520;
    setInst(w.clouds, i, b[i * 5], b[i * 5 + 1], b[i * 5 + 2], b[i * 5 + 3], b[i * 5 + 4], 1);
  }
  w.clouds.instanceMatrix.needsUpdate = true;
}
