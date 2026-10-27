import * as THREE from "three";
import { clamp, lerp } from "@/engine/math";
import { GeoBuilder } from "./geo";
import type { Mats } from "./materials";

const C = {
  nightH: new THREE.Color(0x0b1224), dayH: new THREE.Color(0xdfeaf2), glowH: new THREE.Color(0xff9a55),
  nightT: new THREE.Color(0x04070f), dayT: new THREE.Color(0x4b8fd6), glowT: new THREE.Color(0x6a6f9a),
  grey: new THREE.Color(0x8e9aa5), white: new THREE.Color(0xffffff), grass: new THREE.Color(0x5f8b3b),
  sunDay: new THREE.Color(0xfff2dc), sunDusk: new THREE.Color(0xffb070), moon: new THREE.Color(0x8fa8ff),
  hemiSky: new THREE.Color(0xd8ecff), hemiNight: new THREE.Color(0x2a3a66), hemiGround: new THREE.Color(0x4a5a30), hemiGroundNight: new THREE.Color(0x0a0f14),
};
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

/**
 * Day/night cycle (TZ 6.1): sun and moon light, sky gradient, fog colour, stars, a backdrop of low-poly mountains
 * and the huge ground plane that follows the car. One draw call each for dome, stars, mountains and ground.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xfff2dc, 1.3);
  readonly hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a5a30, 0.75);
  readonly state: SkyState = { time: 0.3, night: 0, altitude: 0.5 };
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private mountains: THREE.Mesh;
  private ground: THREE.Mesh;
  private fog: THREE.Fog;
  private tmp = new THREE.Color();
  private horizon = new THREE.Color();
  private top = new THREE.Color();
  private fogFar = 330;
  private sunOffset = new THREE.Vector3(30, 100, -40);

  constructor(
    private scene: THREE.Scene,
    private mats: Mats,
  ) {
    this.fog = new THREE.Fog(0xe3eef5, 120, 330);
    scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xe3eef5);

    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(0x4b8fd6) }, uBottom: { value: new THREE.Color(0xe3eef5) } },
      vertexShader: "varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uTop; uniform vec3 uBottom; varying float vY; void main(){ float k = pow(clamp(vY,0.0,1.0), 0.55); gl_FragColor = vec4(mix(uBottom, uTop, k), 1.0); }",
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 16, 8), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // stars
    const sp: number[] = [];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 1100, y * 1100, Math.sin(a) * r * 1100);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // mountains (merged cones with snow caps)
    const gb = new GeoBuilder();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const r = 950;
      const h = 130 + Math.random() * 150;
      const w = 150 + Math.random() * 110;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      gb.cone(x, -20, z, w, h, 0x8fa5b8, 6);
      gb.cone(x, h * 0.72 - 20, z, w * 0.28, h * 0.28, 0xf2f6fa, 6);
    }
    this.mountains = new THREE.Mesh(
      gb.build(),
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: true }),
    );
    this.mountains.frustumCulled = false;
    this.group.add(this.mountains);

    // ground plane far below the tile ground (river bed is at -3): it only shows beyond the streamed tiles / in the river gap
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5f8b3b, roughness: 1 }));
    this.ground.position.y = -3.4;
    this.ground.frustumCulled = false;
    this.group.add(this.ground);

    this.group.add(this.sun, this.sun.target, this.hemi);
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.set(0.3, 0);
  }

  setViewDistance(far: number): void {
    this.fogFar = far;
    this.fog.near = far * 0.35;
    this.fog.far = far * 0.97;
  }

  /** @param t time of day 0..1, @param rain 0..1 */
  set(t: number, rain: number): void {
    const alt = Math.sin((t - 0.25) * Math.PI * 2);
    const day = smooth(-0.08, 0.28, alt);
    const night = 1 - day;
    const glow = Math.exp(-((alt / 0.22) ** 2)) * (1 - rain * 0.6);
    this.state.time = t;
    this.state.night = night;
    this.state.altitude = alt;

    this.horizon.copy(C.nightH).lerp(C.dayH, day);
    this.horizon.lerp(C.glowH, glow * 0.55);
    this.top.copy(C.nightT).lerp(C.dayT, day).lerp(C.glowT, glow * 0.25);
    if (rain > 0) {
      this.tmp.copy(C.grey).multiplyScalar(0.35 + 0.65 * day);
      this.horizon.lerp(this.tmp, rain * 0.7);
      this.top.lerp(this.tmp, rain * 0.75);
    }
    (this.scene.background as THREE.Color).copy(this.horizon);
    this.fog.color.copy(this.horizon);
    this.domeMat.uniforms.uTop.value.copy(this.top);
    this.domeMat.uniforms.uBottom.value.copy(this.horizon);
    (this.mountains.material as THREE.MeshBasicMaterial).color.copy(this.horizon).lerp(C.white, 0.35).multiplyScalar(0.55 + 0.45 * day);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(night * 1.3 - 0.3, 0, 1) * (1 - rain);
    (this.ground.material as THREE.MeshStandardMaterial).color.copy(C.grass).multiplyScalar(0.25 + 0.75 * day);

    // lights: sun by day, moon by night
    const az = (t - 0.25) * Math.PI * 2;
    const ex = Math.cos(az) * 0.8;
    const ey = Math.max(0.18, Math.abs(alt));
    this.sunOffset.set(ex * 100, ey * 100, -40);
    this.sun.position.copy(this.sunOffset).add(this.sun.target.position);
    this.sun.color.copy(C.sunDay).lerp(C.sunDusk, glow).lerp(C.moon, night);
    this.sun.intensity = (0.25 * night + 1.35 * day) * (1 - rain * 0.55);
    this.hemi.color.copy(C.hemiSky).lerp(C.hemiNight, night);
    this.hemi.groundColor.copy(C.hemiGround).lerp(C.hemiGroundNight, night);
    this.hemi.intensity = (0.8 * day + 0.42 * night) * (1 - rain * 0.25);
    this.mats.setNight(night);
    this.fog.near = this.fogFar * lerp(0.35, 0.18, rain);
    this.fog.far = this.fogFar * lerp(0.97, 0.72, rain);
  }

  /** Follow the car: dome, stars, mountains and ground move with it; the sun's shadow box too. */
  follow(x: number, z: number): void {
    this.dome.position.set(x, 0, z);
    this.stars.position.set(x, 0, z);
    this.mountains.position.set(x, 0, z);
    this.ground.position.x = x;
    this.ground.position.z = z;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  dispose(): void {
    this.scene.background = null;
    this.scene.fog = null;
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.mountains.geometry.dispose();
    (this.mountains.material as THREE.Material).dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
  }
}
