// Lake water. One draw call. High/medium: planar reflection + refraction (the submerged layer is rendered into a texture and
// distorted by the normal map), normal-mapped ripples, shore foam, sun glitter. Low: the simplified prototype-like shader
// (sky reflection by fresnel, no render targets) with depth based transparency so the shallows stay visible.

import * as THREE from "three";
import { WAVES } from "./locations";
import { DEPTH_REGION, DEPTH_SCALE } from "./textures";

/** Layers: 0 = world (reflected), 2 = underwater (refraction pass), 3 = not reflected (rods, line, floats, effects). */
export const L_WORLD = 0;
export const L_UNDER = 2;
export const L_NOREFL = 3;

export interface WaterColors {
  deep: number;
  shallow: number;
  clarity: number;
  skyTop: number;
  skyHorizon: number;
  fog: number;
}

const f = (n: number): string => n.toFixed(5);

export function buildWaterGeometry(segments: number): THREE.BufferGeometry {
  // non-uniform grid: fine cells around the casting area, coarse towards the horizon
  const cx = 0;
  const cz = -30;
  const R = 330;
  const n = segments;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const warp = (s: number): number => Math.sign(s) * Math.pow(Math.abs(s), 2.2) * R;
  let o = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    pos[o++] = cx + warp((j / n) * 2 - 1);
    pos[o++] = 0;
    pos[o++] = cz + warp((i / n) * 2 - 1);
  }
  const idx = new Uint32Array(n * n * 6);
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = i * (n + 1) + j;
    const b = a + n + 1;
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = a + 1;
    idx[k++] = a + 1;
    idx[k++] = b;
    idx[k++] = b + 1;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const waveTerms = WAVES.map(([dx, dz, a, k, w]) => `{ float ph = (${f(dx)}*w0.x + ${f(dz)}*w0.z)*${f(k)} + uTime*${f(w)}; h += ${f(a)}*sin(ph); g += vec2(${f(dx)}, ${f(dz)})*${f(a * k)}*cos(ph); }`).join("\n");

const VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform sampler2D uDepthTex; uniform vec4 uRegion; uniform float uDepthScale;
varying vec3 vW; varying vec3 vN; varying float vH;
float depthAt(vec2 xz){ vec2 uv = (xz - uRegion.xy)/uRegion.zw; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return 10.; return texture2D(uDepthTex, uv).r*uDepthScale; }
void main(){
  vec4 w0 = modelMatrix*vec4(position,1.);
  float d = depthAt(w0.xz);
  float damp = 0.25 + 0.75*smoothstep(0.1, 2.5, d);
  float h = 0.; vec2 g = vec2(0.);
  ${waveTerms}
  h *= uAmp*damp; g *= uAmp*damp;
  w0.y += h; vH = h;
  vN = normalize(vec3(-g.x, 1., -g.y));
  vW = w0.xyz;
  gl_Position = projectionMatrix*viewMatrix*w0;
}`;

const FRAG = /* glsl */ `
uniform float uTime; uniform float uWind; uniform float uRain; uniform float uUseRefl; uniform float uUseRefr; uniform float uClarity; uniform float uDepthScale;
uniform sampler2D uNormal; uniform sampler2D uRefl; uniform sampler2D uRefr; uniform sampler2D uDepthTex; uniform vec4 uRegion;
uniform mat4 uTexMat; uniform vec2 uRes;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uFog;
uniform vec2 uPosts[8]; uniform float uPostCount; uniform float uDim;
varying vec3 vW; varying vec3 vN; varying float vH;
float depthAt(vec2 xz){ vec2 uv = (xz - uRegion.xy)/uRegion.zw; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return 10.; return texture2D(uDepthTex, uv).r*uDepthScale; }
vec3 skyAt(vec3 r){ float t = clamp(r.y*1.6, 0., 1.); return mix(uSkyHor, uSkyTop, t); }
void main(){
  vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam/dist;
  float fade = clamp(1. - dist/140., 0.25, 1.);
  vec4 s1 = texture2D(uNormal, vW.xz*0.06 + vec2(uTime*0.018, uTime*0.012));
  vec4 s2 = texture2D(uNormal, vW.xz*0.21 + vec2(-uTime*0.03, uTime*0.026));
  vec4 s3 = texture2D(uNormal, vW.xz*1.1 + vec2(uTime*0.11, -uTime*0.09));
  vec2 nm = ((s1.xy*2.-1.) + (s2.xy*2.-1.)*0.7)*(0.16 + uWind*0.3) + (s3.xy*2.-1.)*uRain*0.3;
  vec3 N = normalize(vN + vec3(nm.x, 0., nm.y)*fade);
  float depth = depthAt(vW.xz);
  float tint = 1. - exp(-depth*1.6/uClarity);
  vec3 body = mix(uShallow, uDeep, smoothstep(0., 6., depth));
  float fr = 0.02 + 0.98*pow(1. - max(dot(N, V), 0.), 4.);
  vec3 col; float alpha = 1.;
  vec3 R = reflect(-V, N);
  vec3 refl = skyAt(R);
  if (uUseRefl > 0.5) {
    vec4 rp = uTexMat*vec4(vW, 1.);
    vec2 ruv = rp.xy/rp.w + N.xz*0.035;
    refl = texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
  }
  vec3 under = body;
  if (uUseRefr > 0.5) {
    vec2 suv = gl_FragCoord.xy/uRes + N.xz*0.045*fade;
    vec3 r = texture2D(uRefr, clamp(suv, 0.001, 0.999)).rgb;
    under = mix(r, body, 0.12);
  } else {
    alpha = clamp(0.08 + 0.7*tint, 0., 1.);
  }
  float nearK = mix(0.5, 1.0, smoothstep(6., 32., dist));
  col = mix(under, refl, clamp(fr*(uUseRefl>0.5 ? 0.75 : 0.7)*nearK + 0.02, 0., 1.));
  // sun glitter
  vec3 H = normalize(uSun + V); float d1 = max(dot(N, H), 0.);
  col += (pow(d1, 500.)*1.4 + pow(d1, 70.)*0.07)*uSunCol*uDim;
  // shore foam + foam around the posts
  float hn = s2.a;
  float foam = smoothstep(0.55, 0.0, depth + (hn - 0.5)*0.5 + sin(uTime*1.3 + depth*9.)*0.07) * step(0.001, depth + 0.5);
  for (int i = 0; i < 8; i++) {
    if (float(i) < uPostCount) {
      float dp = length(vW.xz - uPosts[i]);
      foam += smoothstep(0.5, 0.18, dp + (hn - 0.5)*0.25);
    }
  }
  foam = clamp(foam, 0., 1.);
  col = mix(col, vec3(0.92, 0.96, 0.98)*uDim, foam*0.65);
  alpha = max(alpha, foam*0.8);
  col = mix(col, uFog, smoothstep(150., 900., dist)*0.85);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface TintUniforms {
  uDeepCol: THREE.IUniform<THREE.Color>;
  uClar: THREE.IUniform<number>;
}
export const makeTint = (deep: number, clarity: number): TintUniforms => ({ uDeepCol: { value: new THREE.Color(deep) }, uClar: { value: clarity } });

/**
 * Underwater objects fade into the deep water colour with THEIR OWN depth below the surface (a fish 0.3 m down stays clear,
 * the bed 6 m down is dark). Works on built-in materials; chains with an existing onBeforeCompile.
 */
export function applyUnderwaterTint(mat: THREE.Material, u: TintUniforms): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uDeepCol = u.uDeepCol;
    sh.uniforms.uClar = u.uClar;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
varying float vUy;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
#ifdef USE_INSTANCING
  vUy = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
#else
  vUy = (modelMatrix * vec4(transformed, 1.0)).y;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vUy; uniform vec3 uDeepCol; uniform float uClar;`)
      .replace(
        "#include <tonemapping_fragment>",
        `float uwT = clamp(1. - exp(-max(0., -vUy)*1.0/uClar), 0., 0.9); gl_FragColor.rgb = mix(gl_FragColor.rgb, uDeepCol, uwT);
#include <tonemapping_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => prevKey() + "|uw";
  mat.needsUpdate = true;
}

export interface WaterUniforms {
  [k: string]: THREE.IUniform;
}

export function createWaterMaterial(o: {
  colors: WaterColors;
  normal: THREE.Texture;
  depthTex: THREE.Texture;
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  dim: number;
}): THREE.ShaderMaterial {
  const c = o.colors;
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 1 },
    uWind: { value: 0.5 },
    uRain: { value: 0 },
    uUseRefl: { value: 0 },
    uUseRefr: { value: 0 },
    uClarity: { value: c.clarity },
    uDepthScale: { value: DEPTH_SCALE },
    uNormal: { value: o.normal },
    uRefl: { value: null },
    uRefr: { value: null },
    uDepthTex: { value: o.depthTex },
    uRegion: { value: new THREE.Vector4(DEPTH_REGION.x0, DEPTH_REGION.z0, DEPTH_REGION.w, DEPTH_REGION.h) },
    uTexMat: { value: new THREE.Matrix4() },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uSun: { value: o.sun },
    uSunCol: { value: o.sunColor },
    uDeep: { value: new THREE.Color(c.deep) },
    uShallow: { value: new THREE.Color(c.shallow) },
    uSkyTop: { value: new THREE.Color(c.skyTop) },
    uSkyHor: { value: new THREE.Color(c.skyHorizon) },
    uFog: { value: new THREE.Color(c.fog) },
    uPosts: { value: Array.from({ length: 8 }, () => new THREE.Vector2(1e5, 1e5)) },
    uPostCount: { value: 0 },
    uDim: { value: o.dim },
  };
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
}

/** Renders the planar reflection and the refraction (underwater layer) textures for the water mesh. */
export class WaterPasses {
  readonly refl: THREE.WebGLRenderTarget | null;
  readonly refr: THREE.WebGLRenderTarget | null;
  enabled = true;
  private cam = new THREE.PerspectiveCamera();
  private view = new THREE.Vector3();
  private target = new THREE.Vector3();
  private look = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private prevColor = new THREE.Color();
  private frame = 0;
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  /** draw calls / triangles spent in the extra passes during the last frame */
  calls = 0;
  tris = 0;

  constructor(
    private water: THREE.Mesh,
    private mat: THREE.ShaderMaterial,
    level: "high" | "medium" | "low",
    private deep: THREE.Color,
  ) {
    if (level === "low") {
      this.refl = this.refr = null;
      this.enabled = false;
      return;
    }
    // perf: small reflection / refraction targets on every level (the water is blurry anyway; no 1024x512 half-float targets on "high")
    const hi = false;
    const mk = (w: number, h: number): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.refl = mk(hi ? 1024 : 512, hi ? 512 : 256);
    this.refr = mk(hi ? 768 : 384, hi ? 432 : 216);
    this.cam.layers.set(L_WORLD);
    mat.uniforms.uRefl.value = this.refl.texture;
    mat.uniforms.uRefr.value = this.refr.texture;
  }

  /** Switch the passes on/off at run time (quality changed). Material uniforms select the cheap look. */
  setEnabled(on: boolean): void {
    this.enabled = on && !!this.refl;
    this.mat.uniforms.uUseRefl.value = this.enabled ? 1 : 0;
    this.mat.uniforms.uUseRefr.value = this.enabled ? 1 : 0;
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, everyOther: boolean): void {
    this.calls = 0;
    this.tris = 0;
    if (!this.enabled || !this.refl || !this.refr) return;
    this.frame++;
    const u = this.mat.uniforms;
    gl.getDrawingBufferSize(u.uRes.value as THREE.Vector2);
    camera.updateMatrixWorld();
    const prevRT = gl.getRenderTarget();
    const prevAuto = gl.shadowMap.autoUpdate;
    const prevXr = gl.xr.enabled;
    gl.shadowMap.autoUpdate = false;
    gl.xr.enabled = false;
    this.water.visible = false;
    gl.getClearColor(this.prevColor);
    const prevAlpha = gl.getClearAlpha();
    const prevMask = camera.layers.mask;

    if (!everyOther || this.frame % 2 === 0) {
      // mirrored camera (water plane y = 0, normal +y)
      const cam = this.cam;
      const cp = camera.position;
      this.view.set(cp.x, -cp.y, cp.z);
      this.rot.extractRotation(camera.matrixWorld);
      this.look.set(0, 0, -1).applyMatrix4(this.rot).add(cp);
      this.target.set(this.look.x, -this.look.y, this.look.z);
      cam.position.copy(this.view);
      cam.up.set(0, 1, 0).applyMatrix4(this.rot);
      cam.up.y *= -1;
      cam.lookAt(this.target);
      cam.fov = camera.fov;
      cam.aspect = camera.aspect;
      cam.near = camera.near;
      cam.far = camera.far;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const tm = u.uTexMat.value as THREE.Matrix4;
      tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      tm.multiply(cam.projectionMatrix);
      tm.multiply(cam.matrixWorldInverse);
      // oblique near plane (Lengyel): nothing below the water plane (e.g. the underwater halves of the posts) is reflected
      this.plane.set(this.plane.normal.set(0, 1, 0), 0);
      this.plane.applyMatrix4(cam.matrixWorldInverse);
      const clip = this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
      const pm = cam.projectionMatrix.elements;
      const q = this.q;
      q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
      q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
      q.z = -1;
      q.w = (1 + pm[10]) / pm[14];
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1 - 0.003;
      pm[14] = clip.w;
      gl.setRenderTarget(this.refl);
      gl.setClearColor(this.deep, 1);
      gl.clear();
      gl.render(scene, cam);
      this.calls += gl.info.render.calls;
      this.tris += gl.info.render.triangles;
    }

    // refraction: everything below the surface, seen from the player camera
    camera.layers.set(L_UNDER);
    gl.setRenderTarget(this.refr);
    gl.setClearColor(this.deep, 1);
    gl.clear();
    gl.render(scene, camera);
    this.calls += gl.info.render.calls;
    this.tris += gl.info.render.triangles;
    camera.layers.mask = prevMask;

    gl.setRenderTarget(prevRT);
    gl.setClearColor(this.prevColor, prevAlpha);
    gl.shadowMap.autoUpdate = prevAuto;
    gl.xr.enabled = prevXr;
    this.water.visible = true;
  }

  dispose(): void {
    this.refl?.dispose();
    this.refr?.dispose();
  }
}
