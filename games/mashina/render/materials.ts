import * as THREE from "three";
import { texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { warmTriangle } from "@/games/poyga/models";
import type { Lod } from "./lod";
import { windowGlowTexture, type SignAtlas } from "./textures";

/**
 * The few shared materials of the whole world (this is what keeps the draw calls and the shader count small). The ground
 * materials use the same CC0 PBR texture files as Shahar simulyatori (/textures/poyga/pbr, /facades; `.lo.webp` on low), so the
 * browser cache is shared between the two games:
 *   road / walk / ground = asphalt, pavement, grass (the tile's flat ground is split into these three meshes), detail = markings,
 *   props, parapets; bldg = facade tile with windows (emissive at night), signs = sign atlas, glow = lamps, water, trim = people.
 * The lite level skips the normal and roughness maps (two more texture reads and the bump maths per pixel).
 */
export class Mats {
  readonly road: THREE.MeshStandardMaterial;
  readonly walk: THREE.MeshStandardMaterial;
  readonly ground: THREE.MeshStandardMaterial;
  readonly detail: THREE.MeshStandardMaterial;
  readonly bldg: THREE.MeshStandardMaterial;
  readonly signs: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  readonly water: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  private readonly owned: THREE.Texture[] = [];
  private readonly roadBase = new THREE.Color(0.62, 0.62, 0.64);
  private readonly wetMats: THREE.MeshStandardMaterial[];
  private wetNow = 0;
  private disposed = false;

  constructor(
    atlas: SignAtlas,
    private gl: THREE.WebGLRenderer,
    level: QualityLevel,
    lod: Lod,
  ) {
    const aniso = Math.min(gl.capabilities.getMaxAnisotropy(), lod.aniso);
    // a big texture goes to the GPU when it arrives, not all at once in the first frame that draws it
    const upload = (t: THREE.Texture): void => {
      if (!this.disposed) gl.initTexture(t);
    };
    const load = (stem: string, srgb: boolean): THREE.Texture => {
      const t = new THREE.TextureLoader().load(texUrl(stem, level), upload);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.owned.push(t);
      return t;
    };
    const pbr = (name: string): Pick<THREE.MeshStandardMaterialParameters, "map" | "normalMap" | "roughnessMap"> => ({
      map: load(`/textures/poyga/pbr/${name}_color`, true),
      normalMap: lod.pbrMaps ? load(`/textures/poyga/pbr/${name}_normal`, false) : undefined,
      roughnessMap: lod.pbrMaps ? load(`/textures/poyga/pbr/${name}_rough`, false) : undefined,
    });
    // vertex colours carry the tint (asphalt white, concrete lighter, fields yellow / brown): see tileBuilder `surface`
    this.road = new THREE.MeshStandardMaterial({ ...pbr("road"), vertexColors: true, color: this.roadBase, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
    this.walk = new THREE.MeshStandardMaterial({ ...pbr("paving"), vertexColors: true, roughness: 1 });
    this.ground = new THREE.MeshStandardMaterial({ ...pbr("grass"), vertexColors: true, roughness: 1 });
    this.detail = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // facade tile from Blender (one bay x two floors) and its night windows
    const facade = load("/textures/poyga/facades/facade_flats", true);
    facade.anisotropy = Math.min(aniso, 4);
    const glowMap = windowGlowTexture();
    this.owned.push(glowMap);
    this.bldg = new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.78, metalness: 0, emissive: new THREE.Color(0xffffff), emissiveMap: glowMap, emissiveIntensity: 0 });
    this.signs = new THREE.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, emissive: new THREE.Color(0x222222) });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.water = new THREE.MeshStandardMaterial({ color: 0x2a6f97, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2, depthWrite: false });
    this.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    this.wetMats = [this.road, this.walk, this.ground, this.detail];
  }

  get wet(): number {
    return this.wetNow;
  }

  /** 0 dry .. 1 pouring: darker, glossier asphalt (the sky reflection comes from the scene's image light where there is one). */
  setWet(w: number): void {
    if (Math.abs(w - this.wetNow) < 0.004) return;
    this.wetNow = w;
    for (const m of this.wetMats) {
      m.roughness = 1 - 0.55 * w;
      m.metalness = 0.22 * w;
    }
    this.road.color.copy(this.roadBase).multiplyScalar(1 - 0.28 * w);
    this.walk.color.setScalar(1 - 0.25 * w);
    this.ground.color.setScalar(1 - 0.2 * w);
  }

  /** 0 day .. 1 night */
  setNight(n: number): void {
    this.bldg.emissiveIntensity = 0.95 * n;
    this.glow.color.setScalar(0.55 + 0.45 * n);
    this.signs.emissive.setScalar(0.1 + 0.1 * n);
  }

  private warmGeo: THREE.BufferGeometry | null = null;

  /** One hidden triangle per material, so the engine's start-up shader precompile sees every tile material (also those no tile uses yet, like the water). */
  warm(): THREE.Group {
    const g = new THREE.Group();
    const geo = (this.warmGeo ??= warmTriangle());
    for (const m of [this.road, this.walk, this.ground, this.detail, this.bldg, this.signs, this.glow, this.water, this.trim]) g.add(new THREE.Mesh(geo, m));
    g.visible = false;
    return g;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.owned) t.dispose();
    this.warmGeo?.dispose();
    for (const m of [this.road, this.walk, this.ground, this.detail, this.bldg, this.signs, this.glow, this.water, this.trim]) m.dispose();
  }
}
