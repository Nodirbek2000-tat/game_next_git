import type { Env } from "./env";
import type { CameraProblem } from "./guides";
import { CROWD_CFG } from "../tracking/crowdConfig";

export class CameraError extends Error {
  constructor(
    public kind: CameraProblem,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "CameraError";
  }
}

/** Map a getUserMedia failure to one of our guide kinds. */
export function classifyCameraError(e: unknown, env: Env): CameraProblem {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    if (env.viewer) return "viewer";
    if (env.inApp) return "inapp";
    return "denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nocam";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  if (name === "NoAPI") return env.viewer ? "viewer" : typeof isSecureContext !== "undefined" && !isSecureContext ? "insecure" : "inapp";
  return "unknown";
}

export interface OpenedCamera {
  stream: MediaStream;
  deviceId: string;
  label: string;
  width: number;
  height: number;
  /** frame rate the camera reports (0 = unknown) */
  fps: number;
}

/**
 * Tracking wants a SMALL, FAST picture: the pose models look at 256 px anyway, a 640x360 frame at 30 fps is
 * cheap to decode (no heavy MJPEG 720p path, less driver buffering = less latency) and gives the webcam the
 * longest exposure it can use, which matters in the evening. 60 fps is only requested later, when the light is good
 * (see `setCameraRate`). `max: 60` keeps a camera from going beyond what we can analyse.
 */
export const CAMERA_IDEAL = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 60 } } as const;
/**
 * Phones / tablets: a small picture (less decoding, less copying, cooler device; the models look at 256 px anyway) in 4:3, the shape
 * of a phone camera's sensor: a 16:9 request makes the phone cut the top and bottom (or the sides) off its sensor, which looks like
 * a zoomed-in camera. 4:3 is the widest view the camera has.
 */
export const CAMERA_IDEAL_MOBILE = { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } } as const;

/**
 * Crowd (Bog‘cha) games: children stand 3-4 m away in a room, so the picture gets more pixels: 720p. The tiled detection cuts crops out
 * of it (see tracking/tiles.ts). `ideal` lets the browser pick the nearest mode the camera has; a camera with only 640x360 still works.
 */
export const CAMERA_IDEAL_CROWD = {
  width: { ideal: CROWD_CFG.camera.width },
  height: { ideal: CROWD_CFG.camera.height },
  frameRate: { ideal: CROWD_CFG.camera.fps, max: CROWD_CFG.camera.fps },
} as const;
export const CAMERA_IDEAL_CROWD_MOBILE = {
  width: { ideal: CROWD_CFG.camera.mobileWidth },
  height: { ideal: CROWD_CFG.camera.mobileHeight },
  frameRate: { ideal: 30, max: 30 },
} as const;

/** A phone held upright: the browser then delivers (and we should ask for) a portrait picture. */
function isPortraitScreen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(orientation: portrait)").matches;
}

/** The same ideal size with width and height swapped (portrait pictures); the rest is unchanged. */
export function swapIdealSize<T extends { width: unknown; height: unknown }>(ideal: T): T {
  return { ...ideal, width: ideal.height, height: ideal.width };
}

function isPhone(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
}

/**
 * Ask for the camera right away (the browser prompt appears instantly). Tries the saved device first,
 * then the front camera at 640x360@30, then anything. Crowd games ask for 1280x720@30 first (960x540 on phones) and fall back to that.
 */
export async function openCamera(savedDeviceId?: string, opts?: { crowd?: boolean }): Promise<OpenedCamera> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("noapi"), { name: "NoAPI" });
  }
  const phone = isPhone();
  const crowd = opts?.crowd === true;
  const upright = phone && isPortraitScreen();
  const sized = <T extends { width: unknown; height: unknown }>(i: T): T => (upright ? swapIdealSize(i) : i);
  const ideal = sized(crowd ? (phone ? CAMERA_IDEAL_CROWD_MOBILE : CAMERA_IDEAL_CROWD) : phone ? CAMERA_IDEAL_MOBILE : CAMERA_IDEAL);
  const tries: (MediaTrackConstraints | boolean)[] = [];
  if (savedDeviceId) tries.push({ deviceId: { exact: savedDeviceId }, ...ideal });
  tries.push({ ...ideal, facingMode: "user" });
  // crowd: a camera that refuses the big picture still gets the normal small one before "anything"
  if (crowd) tries.push({ ...sized(phone ? CAMERA_IDEAL_MOBILE : CAMERA_IDEAL), facingMode: "user" });
  tries.push(true);
  let last: unknown;
  for (const v of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      const track = stream.getVideoTracks()[0];
      if (track) await widestZoom(track);
      const s = track?.getSettings?.() ?? {};
      return { stream, deviceId: s.deviceId ?? "", label: track?.label ?? "", width: s.width ?? 640, height: s.height ?? 360, fps: s.frameRate ?? 0 };
    } catch (e) {
      last = e;
      const n = (e as { name?: string }).name;
      if (n === "NotAllowedError" || n === "SecurityError") throw e;
    }
  }
  throw last;
}

/**
 * A camera that can zoom (some phones, iOS 17+) is set to its smallest zoom: the widest view, so the whole body fits from closer.
 * Best effort: browsers without zoom control, or that only allow it after an extra permission, keep their default.
 */
export async function widestZoom(track: MediaStreamTrack): Promise<void> {
  try {
    const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min?: number } };
    const min = caps.zoom?.min;
    const cur = (track.getSettings?.() as { zoom?: number }).zoom;
    if (typeof min !== "number" || typeof cur !== "number" || cur <= min + 1e-3) return;
    await track.applyConstraints({ advanced: [{ zoom: min } as MediaTrackConstraintSet] });
  } catch {
    /* not supported: keep the default */
  }
}

/** Highest frame rate the camera can deliver (0 when the browser does not tell). */
export function maxCameraFps(track: MediaStreamTrack | undefined): number {
  try {
    const cap = track?.getCapabilities?.() as { frameRate?: { max?: number } } | undefined;
    return cap?.frameRate?.max ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Switch the camera between 30 fps (dim rooms: longest exposure) and 60 fps (good light: half the capture delay).
 * Resolves to the rate the camera really runs at afterwards; never throws.
 */
export async function setCameraRate(track: MediaStreamTrack | undefined, fps: 30 | 60): Promise<number> {
  if (!track) return 0;
  try {
    await track.applyConstraints({ frameRate: { ideal: fps, max: 60 } });
  } catch {
    /* not supported by this camera: keep running as before */
  }
  return track.getSettings?.().frameRate ?? 0;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/** Labels are only available after the permission was granted. */
export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}
