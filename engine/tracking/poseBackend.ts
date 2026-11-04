// Which pose detector the crowd (Bog‘cha) games use: MediaPipe (default), MoveNet MultiPose in a worker (?pose=movenet) or MoveNet on
// the main thread (?pose=movenet-main, a debug path that blocks rendering). Pure: the query and the storage are passed in. Adult games
// never ask.

export type PoseBackend = "mediapipe" | "movenet" | "movenet-main";

/** localStorage key of the choice a teacher keeps on a computer */
export const POSE_KEY = "harakat.pose";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const norm = (v: string | null | undefined): PoseBackend | null => {
  const s = (v ?? "").trim().toLowerCase();
  return s === "movenet" || s === "mediapipe" || s === "movenet-main" ? s : null;
};

/**
 * ?pose=movenet / ?pose=mediapipe win and are remembered (the default one just forgets the choice); without the query
 * the remembered choice is used; anything else is the default (`dflt`, CROWD_CFG.movenet.defaultBackend). ?pose=movenet-main is for one session only (never remembered, and it
 * leaves an earlier remembered choice alone), and a remembered value of it is ignored. A storage that throws (private mode) only costs
 * the memory.
 */
export function resolvePoseBackend(
  query: URLSearchParams | null | undefined,
  storage: StorageLike | null | undefined,
  dflt: "mediapipe" | "movenet" = "mediapipe",
): PoseBackend {
  const q = norm(query?.get("pose"));
  if (q === "movenet-main") return q;
  if (q) {
    try {
      if (q !== dflt) storage?.setItem(POSE_KEY, q);
      else storage?.removeItem(POSE_KEY);
    } catch {
      /* no storage */
    }
    return q;
  }
  try {
    const kept = norm(storage?.getItem(POSE_KEY));
    return kept === "movenet" || kept === "mediapipe" ? kept : dflt;
  } catch {
    return dflt;
  }
}
