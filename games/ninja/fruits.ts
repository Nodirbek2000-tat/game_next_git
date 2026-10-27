import * as THREE from "three";
import { accessoryGeometry, bodyGeometry, bombGeometry, capGeometry, FRUIT_IDS, freezeGeometry, frenzyGeometry, halfGeometry, type Segs } from "./geometry";
import { paintFruit, paintGlow, paintIron } from "./paint";

/** Everything the rig renders with: shared geometries, materials and textures. Built once at mount, `dispose()`d on exit. */
export interface FruitKit {
  body: THREE.BufferGeometry[];
  acc: (THREE.BufferGeometry | null)[];
  half: THREE.BufferGeometry[];
  cap: THREE.BufferGeometry[];
  skin: THREE.MeshStandardMaterial[];
  capMat: THREE.MeshStandardMaterial[];
  accMat: THREE.MeshStandardMaterial;
  bombGeo: THREE.BufferGeometry;
  bombMat: THREE.MeshStandardMaterial;
  freezeGeo: THREE.BufferGeometry;
  freezeMat: THREE.MeshStandardMaterial;
  frenzyGeo: THREE.BufferGeometry;
  frenzyMat: THREE.MeshStandardMaterial;
  /** soft glow image used by the 2D overlay (trail heads, bomb fuses) */
  glow: HTMLCanvasElement;
  dispose(): void;
}

interface SkinLook {
  rough: number;
  bump: number;
  capBump: number;
}
const LOOK: Record<string, SkinLook> = {
  tarvuz: { rough: 0.32, bump: 0.5, capBump: 1 },
  apelsin: { rough: 0.5, bump: 1.4, capBump: 1 },
  olma: { rough: 0.26, bump: 0.4, capBump: 1 },
  banan: { rough: 0.45, bump: 0.9, capBump: 1 },
  ananas: { rough: 0.55, bump: 2.6, capBump: 1 },
  kivi: { rough: 0.92, bump: 2.2, capBump: 1 },
  anor: { rough: 0.36, bump: 1.1, capBump: 2.5 },
  qovun: { rough: 0.55, bump: 2.0, capBump: 1 },
};

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** detail 1 = high quality, ~0.8 = medium, ~0.55 = low. */
export function buildKit(detail: number): FruitKit {
  const seg: Segs = { nu: Math.max(16, Math.round(40 * detail)), nv: Math.max(8, Math.round(18 * detail)) };
  const skinW = detail >= 0.95 ? 512 : detail >= 0.7 ? 384 : 256;
  const capN = detail >= 0.95 ? 256 : detail >= 0.7 ? 192 : 128;
  const textures: THREE.Texture[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const t = (c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const x = tex(c, srgb);
    textures.push(x);
    return x;
  };
  const g = <T extends THREE.BufferGeometry | null>(x: T): T => {
    if (x) geos.push(x);
    return x;
  };

  const kit: Partial<FruitKit> = { body: [], acc: [], half: [], cap: [], skin: [], capMat: [] };
  for (const id of FRUIT_IDS) {
    const look = LOOK[id];
    const p = paintFruit(id, skinW, capN);
    const skinMap = t(p.skin, true);
    const capMap = t(p.cap, true);
    kit.skin!.push(
      new THREE.MeshStandardMaterial({ map: skinMap, bumpMap: t(p.skinBump, false), bumpScale: look.bump, roughness: look.rough, metalness: 0 }),
    );
    kit.capMat!.push(
      new THREE.MeshStandardMaterial({
        map: capMap,
        bumpMap: t(p.capBump, false),
        bumpScale: look.capBump,
        roughness: 0.3,
        metalness: 0,
        emissive: 0xffffff,
        emissiveMap: capMap,
        emissiveIntensity: 0.28,
      }),
    );
    kit.body!.push(g(bodyGeometry(id, seg)));
    kit.acc!.push(g(accessoryGeometry(id)));
    kit.half!.push(g(halfGeometry(id, seg)));
    kit.cap!.push(g(capGeometry(id, Math.max(16, seg.nu))));
  }
  kit.accMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  kit.bombGeo = g(bombGeometry(seg));
  kit.bombMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.7,
    roughness: 0.38,
    emissive: 0x0b0b12,
    bumpMap: t(paintIron(detail >= 0.95 ? 512 : 256), false),
    bumpScale: 1.4,
  });
  kit.freezeGeo = g(freezeGeometry());
  kit.freezeMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x1b6f9a, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.93 });
  kit.frenzyGeo = g(frenzyGeometry());
  kit.frenzyMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x9a6a00, emissiveIntensity: 0.9, roughness: 0.22, metalness: 0.6, flatShading: true });
  const glow = paintGlow(64);
  kit.glow = glow;
  mats.push(...kit.skin!, ...kit.capMat!, kit.accMat, kit.bombMat, kit.freezeMat, kit.frenzyMat);

  return {
    ...(kit as Omit<FruitKit, "dispose">),
    dispose() {
      for (const x of geos) x.dispose();
      for (const x of textures) x.dispose();
      for (const x of mats) x.dispose();
    },
  };
}
