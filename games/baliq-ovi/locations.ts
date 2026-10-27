// Locations are data. Only the mountain lake exists now; "Zarafshon daryosi" (a current that drifts the line) and
// "Suv ombori" (bigger fish) are added later by adding an entry to LOCATIONS — no code changes needed in the game.

import type { TimeOfDay } from "./species";

export type V3 = [number, number, number];

export interface TimeOfDayPreset {
  /** direction TO the sun (normalised in code) */
  sun: V3;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  /** multiplier for the whole fish activity (waiting time is divided by it) */
  activity: number;
  exposure: number;
  /** how many birds sing (0..1) */
  birds: number;
}

export const TIMES_OF_DAY: Record<TimeOfDay, TimeOfDayPreset> = {
  dawn: {
    sun: [-0.5, 0.16, -0.85], sunColor: 0xffc79a, sunIntensity: 1.1, hemiSky: 0xb9c8e8, hemiGround: 0x4a5a48, hemiIntensity: 0.62,
    skyTop: 0x5f7fb8, skyHorizon: 0xf2bfa0, fog: 0xe3c8b8, activity: 1.35, exposure: 1.0, birds: 1,
  },
  day: {
    sun: [-0.35, 0.5, -0.8], sunColor: 0xfff1d6, sunIntensity: 1.5, hemiSky: 0xcfe8ff, hemiGround: 0x3b5a2a, hemiIntensity: 0.7,
    skyTop: 0x3f86cf, skyHorizon: 0xd4e9f4, fog: 0xd4e9f4, activity: 0.9, exposure: 1.05, birds: 0.5,
  },
  sunset: {
    sun: [0.45, 0.12, -0.88], sunColor: 0xff9a55, sunIntensity: 1.25, hemiSky: 0xc4a8b8, hemiGround: 0x4a4030, hemiIntensity: 0.55,
    skyTop: 0x45558f, skyHorizon: 0xf2985a, fog: 0xe0a888, activity: 1.2, exposure: 1.0, birds: 0.7,
  },
};

export interface LocationConfig {
  id: string;
  name: string;
  /** water colours */
  water: { deep: number; shallow: number; /** metres of depth at which the bed is fully hidden */ clarity: number };
  /** surface current (m/s) in world x / z; pushes the float and the line (0 on a lake) */
  current: { x: number; z: number };
  /** multiplies the chance of big fish (reservoir > 1) */
  bigFishBoost: number;
  /** per species id weight multiplier */
  speciesWeight: Record<string, number>;
  /** typical wind strength 0..1 */
  wind: number;
  /** longest cast in metres at full power */
  maxCast: number;
  /** water depth profile: depth(d) = maxDepth * (1 - exp(-d / lengthScale)) (d = distance from the shore, m) */
  profile: { maxDepth: number; lengthScale: number };
  /** world layout */
  shore: { nearZ: number; sideX: number };
  /** probability of rain for a new game (0..1) */
  rain: number;
  /** default time of day, otherwise chosen from the clock */
  tod?: TimeOfDay;
}

export const LAKE: LocationConfig = {
  id: "tog-koli",
  name: "Tog‘ ko‘li",
  water: { deep: 0x0d3b4f, shallow: 0x2a8c96, clarity: 4.2 },
  current: { x: 0, z: 0 },
  bigFishBoost: 1,
  speciesWeight: { forel: 1.3, laqqa: 0.8, ilonbosh: 0.8 },
  wind: 0.45,
  maxCast: 36,
  profile: { maxDepth: 10, lengthScale: 30 },
  shore: { nearZ: 9, sideX: 70 },
  rain: 0.15,
};

export const LOCATIONS: Record<string, LocationConfig> = { [LAKE.id]: LAKE };

// ---------------------------------------------------------------- water surface (shared by the shader, the float and the AI)

/** [dirX, dirZ, amplitude, wavenumber, angular speed] (the prototype's four waves) */
export const WAVES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 0.3, 0.1, 0.32, 1.1],
  [-0.4, 1, 0.065, 0.55, 1.7],
  [0.7, -0.7, 0.04, 0.95, 2.2],
  [0.2, 0.9, 0.022, 1.7, 2.9],
].map(([x, z, a, k, w]) => {
  const l = Math.hypot(x, z);
  return [x / l, z / l, a, k, w] as const;
});

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Waves get calmer near the shore (shader uses the same formula with the depth texture). */
export const shoreDamp = (depth: number): number => 0.25 + 0.75 * smooth(0.1, 2.5, depth);

/** Water surface height at (x, z); `amp` scales the waves with the wind (1 = normal), `depth` is the local depth. */
export function waveHeight(x: number, z: number, t: number, amp = 1, depth = 10): number {
  let h = 0;
  for (const [dx, dz, a, k, w] of WAVES) h += a * Math.sin((dx * x + dz * z) * k + t * w);
  return h * amp * shoreDamp(depth);
}

// ---------------------------------------------------------------- lake bed

/** Signed distance (m) from the shore: > 0 in the water. */
export function shoreDistance(loc: LocationConfig, x: number, z: number): number {
  const nearZ = loc.shore.nearZ + 1.4 * Math.sin(x * 0.12) + 0.8 * Math.sin(x * 0.31 + 1);
  const sideX = loc.shore.sideX + 6 * Math.sin(z * 0.09 + 1);
  return Math.min(nearZ - z, sideX - Math.abs(x));
}

/** Water depth (m) at (x, z); <= 0 on land. */
export function bedDepth(loc: LocationConfig, x: number, z: number): number {
  const d = shoreDistance(loc, x, z);
  if (d <= 0) return d * 0.35;
  const base = loc.profile.maxDepth * (1 - Math.exp(-d / loc.profile.lengthScale));
  const bumps = 0.22 * Math.sin(x * 0.4 + z * 0.3) * Math.sin(z * 0.23 - x * 0.11) * Math.min(1, d / 6);
  return Math.max(0.05, base + bumps);
}

// ---------------------------------------------------------------- time of day / weather

export function todFromClock(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9) return "dawn";
  if (hour >= 17 && hour < 21) return "sunset";
  return "day";
}

export interface WeatherState {
  tod: TimeOfDay;
  /** 0..1 */
  wind: number;
  rain: boolean;
}

export function rollWeather(loc: LocationConfig, rng: () => number, query: { tod?: string | null; rain?: string | null; wind?: string | null }, hour = new Date().getHours()): WeatherState {
  const t = query.tod === "dawn" || query.tod === "day" || query.tod === "sunset" ? query.tod : (loc.tod ?? (rng() < 0.5 ? todFromClock(hour) : (["dawn", "day", "sunset"] as const)[Math.floor(rng() * 3)]));
  const rain = query.rain != null ? query.rain === "1" : rng() < loc.rain;
  const wind = query.wind != null && !Number.isNaN(Number(query.wind)) ? Math.min(1, Math.max(0, Number(query.wind))) : Math.min(1, Math.max(0, loc.wind + (rng() - 0.5) * 0.3 + (rain ? 0.2 : 0)));
  return { tod: t, wind, rain };
}
