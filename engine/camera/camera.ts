import type { Env } from "./env";
import type { CameraProblem } from "./guides";

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
 * Ask for the camera right away (the browser prompt appears instantly). Tries the saved device first,
 * then the front camera at 640x360@30, then anything.
 */
export async function openCamera(savedDeviceId?: string): Promise<OpenedCamera> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("noapi"), { name: "NoAPI" });
  }
  const ideal = CAMERA_IDEAL;
  const tries: (MediaTrackConstraints | boolean)[] = [];
  if (savedDeviceId) tries.push({ deviceId: { exact: savedDeviceId }, ...ideal });
  tries.push({ ...ideal, facingMode: "user" }, true);
  let last: unknown;
  for (const v of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      const track = stream.getVideoTracks()[0];
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
