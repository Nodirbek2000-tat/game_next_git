import * as THREE from "three";
import { grainTexture, skyCube, windowTextures, type SignAtlas } from "./textures";

/**
 * The few shared materials of the whole world (this is what keeps the draw calls and the shader count small):
 * flat = ground + roads, flatDetail = props/markings (polygon offset against z-fighting), bldg = windows (emissive at night),
 * signs = sign atlas, glow = lamps, water, car paint / trim / lamps and the instanced traffic materials.
 */
export class Mats {
  readonly flat: THREE.MeshStandardMaterial;
  readonly flatDetail: THREE.MeshStandardMaterial;
  readonly bldg: THREE.MeshStandardMaterial;
  readonly signs: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  readonly water: THREE.MeshStandardMaterial;
  readonly paint: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly lamps: THREE.MeshBasicMaterial;
  readonly trafficPaint: THREE.MeshStandardMaterial;
  readonly lampOn = new THREE.Color();
  private readonly env: THREE.CubeTexture;
  private wetNow = 0;

  constructor(atlas: SignAtlas) {
    const grain = grainTexture();
    const win = windowTextures();
    this.env = skyCube("#9fc3e8", "#e8eef2");
    this.flat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 0.95, metalness: 0, envMap: this.env, envMapIntensity: 0 });
    this.flatDetail = new THREE.MeshStandardMaterial({
      vertexColors: true, map: grain, roughness: 0.9, metalness: 0, envMap: this.env, envMapIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.bldg = new THREE.MeshStandardMaterial({
      vertexColors: true, map: win.map, roughness: 0.85, metalness: 0, emissive: new THREE.Color(0xffffff), emissiveMap: win.emissive, emissiveIntensity: 0,
    });
    this.signs = new THREE.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, emissive: new THREE.Color(0x222222) });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.water = new THREE.MeshStandardMaterial({ color: 0x2a6f97, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2, envMap: this.env, envMapIntensity: 0.8, depthWrite: false });
    this.paint = new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.55, roughness: 0.32, envMap: this.env, envMapIntensity: 0.5 });
    this.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    this.lamps = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.trafficPaint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38 });
    for (const m of [grain, win.map, win.emissive, atlas.texture]) m.userData.keep = false;
  }

  get wet(): number {
    return this.wetNow;
  }

  /** 0 dry .. 1 pouring: darker, glossier asphalt with sky reflections. */
  setWet(w: number): void {
    this.wetNow = w;
    for (const m of [this.flat, this.flatDetail]) {
      m.roughness = 0.95 - 0.68 * w;
      m.metalness = 0.28 * w;
      m.envMapIntensity = 1.1 * w;
      m.color.setScalar(1 - 0.28 * w);
    }
    this.paint.envMapIntensity = 0.5 + 0.4 * w;
  }

  /** 0 day .. 1 night */
  setNight(n: number): void {
    this.bldg.emissiveIntensity = 0.95 * n;
    this.glow.color.setScalar(0.55 + 0.45 * n);
    this.signs.emissive.setScalar(0.1 + 0.1 * n);
  }

  dispose(): void {
    for (const m of [this.flat, this.flatDetail, this.bldg, this.signs, this.glow, this.water, this.paint, this.trim, this.lamps, this.trafficPaint]) {
      const mm = m as unknown as Record<string, unknown>;
      for (const k of Object.keys(mm)) if (mm[k] instanceof THREE.Texture) (mm[k] as THREE.Texture).dispose();
      m.dispose();
    }
    this.env.dispose();
  }
}
