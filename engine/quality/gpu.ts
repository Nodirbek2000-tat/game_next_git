import type { QualitySetting } from "../settings/store";
import type { QualityLevel } from "../types";
import { levelFromTier } from "./controller";

export interface DeviceProfile {
  tier: number;
  isMobile: boolean;
  gpu: string;
  /** whether detect-gpu produced a real answer (false = fallback guess) */
  detected: boolean;
  /** logical CPU cores (0 = unknown) */
  cores: number;
  /** device memory in GB (0 = unknown, Chrome only) */
  memory: number;
  /** WebGL runs in software (SwiftShader, llvmpipe, "Basic Render Driver") */
  software: boolean;
  /** a WebGL context can be created at all */
  webgl: boolean;
}

/** integrated GPUs share memory bandwidth with the camera, the models and the compositor: "high" is never a good start there */
const INTEGRATED_GPU = /intel|uhd|iris|radeon(tm) graphics|vega d+ graphics|adreno|mali|powervr|apple gpu/i;
const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render|softpipe/i;

/** Phone / tablet (also iPadOS that pretends to be a Mac). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** Can a WebGL context be created here? (the 3D layer cannot start without one) */
export function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl") ?? c.getContext("experimental-webgl");
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function hardware(): { cores: number; memory: number } {
  const n = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
  return { cores: n?.hardwareConcurrency ?? 0, memory: n?.deviceMemory ?? 0 };
}

/** Self-hosted detect-gpu benchmark files live in /public/detect-gpu (never fetched from a CDN). */
export async function detectDevice(timeoutMs = 3500): Promise<DeviceProfile> {
  const hw = hardware();
  const webgl = webglSupported();
  const fallback: DeviceProfile = { tier: webgl ? 2 : 0, isMobile: isMobileDevice(), gpu: "noma’lum", detected: false, ...hw, software: !webgl, webgl };
  if (!webgl) return fallback;
  try {
    const { getGPUTier } = await import("detect-gpu");
    const res = await Promise.race([
      getGPUTier({ benchmarksURL: "/detect-gpu" }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!res) return fallback;
    const gpu = res.gpu ?? "noma’lum";
    const software = SOFTWARE_GPU.test(gpu);
    return { tier: software ? 0 : res.tier, isMobile: !!res.isMobile || isMobileDevice(), gpu, detected: res.type !== "FALLBACK", ...hw, software, webgl };
  } catch {
    return fallback;
  }
}

/**
 * Start level. detect-gpu says how strong the GPU is; a weak CPU, little memory or a software renderer lower it
 * further (the controller then corrects within seconds from the real fps, in both directions up to this level).
 */
export function resolveInitialLevel(setting: QualitySetting, device: DeviceProfile): { level: QualityLevel; adaptive: boolean } {
  if (setting !== "auto") return { level: setting, adaptive: false };
  let level = levelFromTier(device.tier, device.isMobile);
  const weakCpu = device.cores > 0 && device.cores <= 4;
  const tiny = device.cores > 0 && device.cores <= 2;
  const lowMem = device.memory > 0 && device.memory <= 2;
  if (device.software || tiny || lowMem) level = "low";
  else if ((weakCpu || INTEGRATED_GPU.test(device.gpu)) && level === "high") level = "medium";
  return { level, adaptive: true };
}

/**
 * Pose model. The "lite" model is the default everywhere: it is ~2x faster than "full" and, with the filtering of
 * the engine, accurate enough for games; speed and low latency matter more than a few pixels of landmark precision.
 * "full" is only used when the user picks it in the settings.
 */
export function resolvePoseModel(setting: "auto" | "lite" | "full", _device?: DeviceProfile): "lite" | "full" {
  void _device;
  return setting === "full" ? "full" : "lite";
}
