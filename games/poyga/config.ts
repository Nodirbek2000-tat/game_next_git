import type { Phys } from "./carSim";
import type { WheelLayout } from "./views";

export type CarId = "boron" | "chaqmoq" | "sport";

export interface SuperCar {
  id: CarId;
  name: string;
  /** top speed for the garage card (m/s) */
  top: number;
  len: number;
  width: number;
  phys: Phys;
  glb: string;
  wheels: WheelLayout;
  /** exhaust outlets (model space) for the nitro flames */
  exhaust: [number, number, number][];
  colors: string[];
  /** 0..1 bars in the garage */
  stats: { tezlik: number; tezlanish: number; boshqaruv: number };
}

// Wheel positions follow tools/blender/cars.py: x = track + 0.03, y = wheel radius, z = +-wheelbase / 2.
export const CARS: Record<CarId, SuperCar> = {
  boron: {
    id: "boron", name: "Bo‘ron", glb: "/models/poyga/boron.glb", top: 98, len: 4.6, width: 1.98,
    phys: { mass: 1550, a: 1.45, b: 1.21, cgH: 0.45, width: 1.98, len: 4.6, wheelR: 0.35, mu: 1.25, cf: 95000, cr: 112000, torque: 720, maxRpm: 8200, idleRpm: 900, gears: [3.1, 2.2, 1.68, 1.33, 1.08, 0.9, 0.76], final: 3.7, rearDrive: 1, drag: 0.42, roll: 0.013, brake: 19000, steer: 0.62 },
    wheels: { x: 0.87, r: 0.35, zf: 1.33, zr: -1.33 }, exhaust: [[0.12, 0.33, -2.27], [-0.12, 0.33, -2.27]],
    colors: ["#c1121f", "#f5f5f2", "#111214", "#ffcc00", "#1d4f91"], stats: { tezlik: 0.85, tezlanish: 0.82, boshqaruv: 0.8 },
  },
  chaqmoq: {
    id: "chaqmoq", name: "Chaqmoq", glb: "/models/poyga/chaqmoq.glb", top: 103, len: 4.7, width: 2.04,
    phys: { mass: 1600, a: 1.48, b: 1.22, cgH: 0.42, width: 2.04, len: 4.7, wheelR: 0.35, mu: 1.3, cf: 100000, cr: 118000, torque: 780, maxRpm: 8500, idleRpm: 950, gears: [3.2, 2.25, 1.7, 1.35, 1.1, 0.92, 0.78], final: 3.6, rearDrive: 0.7, drag: 0.4, roll: 0.013, brake: 20000, steer: 0.6 },
    wheels: { x: 0.89, r: 0.35, zf: 1.35, zr: -1.35 }, exhaust: [[0.05, 0.4, -2.36], [-0.05, 0.4, -2.36]],
    colors: ["#e8b400", "#2fbf71", "#ff6a00", "#7c3aed", "#111214"], stats: { tezlik: 1, tezlanish: 0.95, boshqaruv: 0.7 },
  },
  sport: {
    id: "sport", name: "Sport GT", glb: "/models/poyga/sport.glb", top: 84, len: 4.4, width: 1.9,
    phys: { mass: 1450, a: 1.25, b: 1.35, cgH: 0.48, width: 1.9, len: 4.4, wheelR: 0.34, mu: 1.15, cf: 88000, cr: 98000, torque: 560, maxRpm: 7500, idleRpm: 850, gears: [3.3, 2.3, 1.7, 1.32, 1.05, 0.86, 0.72], final: 3.9, rearDrive: 1, drag: 0.45, roll: 0.014, brake: 17000, steer: 0.64 },
    wheels: { x: 0.85, r: 0.34, zf: 1.3, zr: -1.3 }, exhaust: [[0.49, 0.3, -2.18], [-0.49, 0.3, -2.18]],
    colors: ["#1565c0", "#e53935", "#eeeeee", "#212121", "#00bcd4"], stats: { tezlik: 0.7, tezlanish: 0.7, boshqaruv: 1 },
  },
};
export const CAR_IDS: CarId[] = ["boron", "chaqmoq", "sport"];

export const TRAFFIC_GLB: Record<"sedan" | "krossover" | "van" | "truck", string> = {
  sedan: "/models/poyga/traffic/sedan.glb",
  krossover: "/models/poyga/traffic/krossover.glb",
  van: "/models/poyga/traffic/van.glb",
  truck: "/models/poyga/traffic/truck.glb",
};

export const SKY_HDR = "/textures/poyga/osmon.hdr";
