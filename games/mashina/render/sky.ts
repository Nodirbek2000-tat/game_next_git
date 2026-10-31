import * as THREE from "three";
import { clamp, lerp } from "@/engine/math";
import { texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { GeoBuilder } from "./geo";
import type { Lod } from "./lod";
import type { Mats } from "./materials";

const C = {
  nightH: new THREE.Color(0x0b1224), glowH: new THREE.Color(0xff9a55),
  nightT: new THREE.Color(0x04070f), dayT: new THREE.Color(0x4b8fd6), glowT: new THREE.Color(0x6a6f9a),
  grey: new THREE.Color(0x8e9aa5), white: new THREE.Color(0xffffff), grass: new THREE.Color(0x5f8b3b),
  sunDay: new THREE.Color(0xfff2dc), sunDusk: new THREE.Color(0xffb070), moon: new THREE.Color(0x8fa8ff),
  hemiSky: new THREE.Color(0xd8ecff), hemiNight: new THREE.Color(0x2a3a66), hemiGround: new THREE.Color(0x4a5a30), hemiGroundNight: new THREE.Color(0x0a0f14),
};
const DAY_HORIZON = 0xdfeaf2;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface SkyState {
  /** 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset */
  time: number;
  /** 0 day .. 1 night */
  night: number;
  /** sun altitude -1 .. 1 */
  altitude: number;
}

const DOME_VERT = "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }";
// the daytime sky is the photo of Shahar simulyatori (/textures/poyga/osmon_4k, equirectangular), the gradient is the dusk, the night and the storm
const DOME_FRAG = `uniform vec3 uTop; uniform vec3 uBottom; uniform sampler2D uPhoto; uniform float uMix; uniform vec3 uTint; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = mix(uBottom, uTop, pow(clamp(d.y, 0.0, 1.0), 0.55));
  if (uMix > 0.001) {
    vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    col = mix(col, texture2D(uPhoto, uv).rgb * uTint, uMix * smoothstep(0.0, 0.14, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Day/night cycle (TZ 6.1): sun and moon light, sky, fog colour, stars, a backdrop of low-poly mountains and the huge ground plane
 * that follows the car. Dome, stars and mountains are one backdrop that is scaled to the camera far plane (it is not part of the
 * depth: drawn first, the world draws over it); one draw call each for dome, stars, mountains and ground. There are no real-time
 * shadows (the cars have contact shadows).
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xfff2dc, 1.3);
  readonly hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a5a30, 0.75);
  readonly state: SkyState = { time: 0.3, night: 0, altitude: 0.5 };
  /** the camera far plane that goes with the current haze (m) */
  far = 400;
  private backdrop = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private mountains: THREE.Mesh;
  private ground: THREE.Mesh;
  private fog: THREE.Fog;
  private tmp = new THREE.Color();
  private horizon = new THREE.Color();
  private top = new THREE.Color();
  private dayH = new THREE.Color(DAY_HORIZON);
  private fogNear = 0.35;
  private fogFarK = 0.97;
  private fogFar = 330;
  private sunOffset = new THREE.Vector3(30, 100, -40);
  private photo: THREE.Texture | null = null;
  private alive = true;
  private lastT = -1;
  private lastRain = -1;

  constructor(
    private scene: THREE.Scene,
    private mats: Mats,
    gl: THREE.WebGLRenderer,
    level: QualityLevel,
  ) {
    this.fog = new THREE.Fog(0xe3eef5, 120, 330);
    scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xe3eef5);

    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4b8fd6) },
        uBottom: { value: new THREE.Color(0xe3eef5) },
        uPhoto: { value: null },
        uMix: { value: 0 },
        uTint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    // (unit sphere: the backdrop group is scaled to the far plane)
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.backdrop.add(this.dome);

    // stars
    const sp: number[] = [];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 0.92, y * 0.92, Math.sin(a) * r * 0.92);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.backdrop.add(this.stars);

    // mountains (merged cones with snow caps), a ring at 0.8 of the backdrop radius; painted behind the world (no depth)
    const gb = new GeoBuilder();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const r = 0.8;
      const h = 0.11 + Math.random() * 0.125;
      const w = 0.125 + Math.random() * 0.09;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      gb.cone(x, -0.017, z, w, h, 0x8fa5b8, 6);
      gb.cone(x, h * 0.72 - 0.017, z, w * 0.28, h * 0.28, 0xf2f6fa, 6);
    }
    this.mountains = new THREE.Mesh(gb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, depthTest: false }));
    this.mountains.renderOrder = -8;
    this.mountains.frustumCulled = false;
    this.backdrop.add(this.mountains);
    this.group.add(this.backdrop);

    // ground plane far below the tile ground (river bed is at -3): it only shows beyond the streamed tiles / in the river gap.
    // Unlit (its colour follows the daylight below): no light maths on the biggest surface of the picture.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5f8b3b }));
    this.ground.position.y = -3.4;
    this.ground.frustumCulled = false;
    this.group.add(this.ground);

    this.group.add(this.sun, this.sun.target, this.hemi);
    this.set(0.3, 0);
    this.loadPhoto(gl, level);
  }

  /** the photo sky: the daytime dome and the colour of the haze (taken from just above the photo's horizon) */
  private loadPhoto(gl: THREE.WebGLRenderer, level: QualityLevel): void {
    const t = new THREE.TextureLoader().load(texUrl("/textures/poyga/osmon_4k", level), (tex) => {
      if (!this.alive) return;
      gl.initTexture(tex);
      this.domeMat.uniforms.uPhoto.value = tex;
      try {
        const img = tex.image as HTMLImageElement;
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 128;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, 256, 128);
        const row = g.getImageData(0, 60, 256, 2).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let i = 0; i < row.length; i += 4) {
          r += row[i];
          gg += row[i + 1];
          b += row[i + 2];
        }
        const n = row.length / 4;
        this.dayH.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
      } catch {
        /* keep the default haze */
      }
      this.photoReady = true;
      this.lastT = -1;
      this.set(this.state.time, this.lastRain < 0 ? 0 : this.lastRain);
    });
    t.colorSpace = THREE.SRGBColorSpace;
    // (the seam of the equirectangular lookup must not pick a mip level: no mipmaps, a sky needs no anisotropy)
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.anisotropy = 1;
    this.photo = t;
  }
  private photoReady = false;
  /** the hemisphere light is turned down while an image light (the HDR sky) shares the ambient work */
  private ambient = 1;
  private sunK = 1;
  private hemiK = 1;
  /** daylight strength of the sun and the hemisphere light for the level (render/lod.ts); dusk and night keep their own values */
  setLights(sun: number, hemi: number): void {
    if (sun === this.sunK && hemi === this.hemiK) return;
    this.sunK = sun;
    this.hemiK = hemi;
    this.lastT = -1;
    this.set(this.state.time, Math.max(0, this.lastRain));
  }
  setAmbientScale(k: number): void {
    this.ambient = k;
    this.lastT = -1;
    this.set(this.state.time, Math.max(0, this.lastRain));
  }

  /**
   * The streamed world radius (m) and the level's haze: sets the fog, the camera far plane (`far`) and the size of the backdrop.
   * The far plane is the haze end plus a little, so nothing beyond what is fogged away is drawn.
   */
  setView(radius: number, lod: Lod): void {
    const far = radius * 1.05;
    this.fogNear = lod.fogNear;
    this.fogFarK = lod.fogFar;
    this.fogFar = far;
    this.far = far * lod.fogFar * 1.04;
    this.backdrop.scale.setScalar(this.far * 0.9);
    this.lastT = -1;
    this.set(this.state.time, Math.max(0, this.lastRain));
  }

  /** @param t time of day 0..1, @param rain 0..1 */
  set(t: number, rain: number): void {
    if (Math.abs(t - this.lastT) < 0.0003 && Math.abs(rain - this.lastRain) < 0.003) return;
    this.lastT = t;
    this.lastRain = rain;
    const alt = Math.sin((t - 0.25) * Math.PI * 2);
    const day = smooth(-0.08, 0.28, alt);
    const night = 1 - day;
    const glow = Math.exp(-((alt / 0.22) ** 2)) * (1 - rain * 0.6);
    this.state.time = t;
    this.state.night = night;
    this.state.altitude = alt;

    this.horizon.copy(C.nightH).lerp(this.dayH, day);
    this.horizon.lerp(C.glowH, glow * 0.55);
    this.top.copy(C.nightT).lerp(C.dayT, day).lerp(C.glowT, glow * 0.25);
    if (rain > 0) {
      this.tmp.copy(C.grey).multiplyScalar(0.35 + 0.65 * day);
      this.horizon.lerp(this.tmp, rain * 0.7);
      this.top.lerp(this.tmp, rain * 0.75);
    }
    (this.scene.background as THREE.Color).copy(this.horizon);
    this.fog.color.copy(this.horizon);
    const u = this.domeMat.uniforms;
    u.uTop.value.copy(this.top);
    u.uBottom.value.copy(this.horizon);
    // the photo by day (warm at dusk, absent in a storm and at night)
    u.uMix.value = this.photoReady ? day * (1 - rain * 0.85) : 0;
    (u.uTint.value as THREE.Color).copy(C.white).lerp(C.sunDusk, glow * 0.5).multiplyScalar(0.5 + 0.5 * day);
    (this.mountains.material as THREE.MeshBasicMaterial).color.copy(this.horizon).lerp(C.white, 0.12).multiplyScalar(0.75 + 0.25 * day);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(night * 1.3 - 0.3, 0, 1) * (1 - rain);
    (this.ground.material as THREE.MeshBasicMaterial).color.copy(C.grass).multiplyScalar(0.25 + 0.75 * day);

    // lights: sun by day, moon by night
    const az = (t - 0.25) * Math.PI * 2;
    const ex = Math.cos(az) * 0.8;
    const ey = Math.max(0.18, Math.abs(alt));
    this.sunOffset.set(ex * 100, ey * 100, -40);
    this.sun.position.copy(this.sunOffset).add(this.sun.target.position);
    this.sun.color.copy(C.sunDay).lerp(C.sunDusk, glow).lerp(C.moon, night);
    this.sun.intensity = (0.25 * night + 1.35 * day * this.sunK) * (1 - rain * 0.55);
    this.hemi.color.copy(C.hemiSky).lerp(C.hemiNight, night);
    this.hemi.groundColor.copy(C.hemiGround).lerp(C.hemiGroundNight, night);
    this.hemi.intensity = (0.8 * day * this.hemiK + 0.42 * night) * (1 - rain * 0.25) * this.ambient;
    this.mats.setNight(night);
    this.fog.near = this.fogFar * this.fogNear * lerp(1, 0.5, rain);
    this.fog.far = this.fogFar * this.fogFarK * lerp(1, 0.75, rain);
  }

  /** Follow the car: the backdrop and the ground move with it; so does the sun. */
  follow(x: number, z: number): void {
    this.backdrop.position.set(x, 0, z);
    this.ground.position.x = x;
    this.ground.position.z = z;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  dispose(): void {
    this.alive = false;
    this.scene.background = null;
    this.scene.fog = null;
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.photo?.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.mountains.geometry.dispose();
    (this.mountains.material as THREE.Material).dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
  }
}
