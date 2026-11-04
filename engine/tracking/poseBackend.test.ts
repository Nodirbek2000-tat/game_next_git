import { describe, expect, it } from "vitest";
import { POSE_KEY, resolvePoseBackend, type StorageLike } from "./poseBackend";

function mem(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}
const q = (s: string) => new URLSearchParams(s);

describe("resolvePoseBackend", () => {
  it("defaults to MediaPipe", () => {
    expect(resolvePoseBackend(q(""), mem())).toBe("mediapipe");
    expect(resolvePoseBackend(null, null)).toBe("mediapipe");
    expect(resolvePoseBackend(q("pose=banana"), mem())).toBe("mediapipe");
  });

  it("?pose=movenet selects MoveNet and remembers it", () => {
    const st = mem();
    expect(resolvePoseBackend(q("pose=movenet"), st)).toBe("movenet");
    expect(st.data[POSE_KEY]).toBe("movenet");
    // a later visit without the query keeps it
    expect(resolvePoseBackend(q("debug=1"), st)).toBe("movenet");
  });

  it("?pose=mediapipe switches back and forgets the choice", () => {
    const st = mem({ [POSE_KEY]: "movenet" });
    expect(resolvePoseBackend(q("pose=mediapipe"), st)).toBe("mediapipe");
    expect(POSE_KEY in st.data).toBe(false);
    expect(resolvePoseBackend(q(""), st)).toBe("mediapipe");
  });

  it("is case-insensitive and ignores a broken stored value", () => {
    expect(resolvePoseBackend(q("pose=MoveNet"), mem())).toBe("movenet");
    expect(resolvePoseBackend(q(""), mem({ [POSE_KEY]: "garbage" }))).toBe("mediapipe");
  });

  it("?pose=movenet-main is for one session only: not remembered, an earlier remembered choice stays, a stored value of it is ignored", () => {
    const st = mem({ [POSE_KEY]: "movenet" });
    expect(resolvePoseBackend(q("pose=movenet-main"), st)).toBe("movenet-main");
    expect(st.data[POSE_KEY]).toBe("movenet");
    expect(resolvePoseBackend(q(""), st)).toBe("movenet");
    expect(resolvePoseBackend(q(""), mem({ [POSE_KEY]: "movenet-main" }))).toBe("mediapipe");
    const empty = mem();
    resolvePoseBackend(q("pose=movenet-main"), empty);
    expect(POSE_KEY in empty.data).toBe(false);
  });

  it("with MoveNet as the default: it is used without a query, ?pose=mediapipe is the remembered exception, ?pose=movenet forgets it", () => {
    const st = mem();
    expect(resolvePoseBackend(q(""), st, "movenet")).toBe("movenet");
    expect(resolvePoseBackend(q("pose=mediapipe"), st, "movenet")).toBe("mediapipe");
    expect(st.data[POSE_KEY]).toBe("mediapipe");
    expect(resolvePoseBackend(q(""), st, "movenet")).toBe("mediapipe");
    expect(resolvePoseBackend(q("pose=movenet"), st, "movenet")).toBe("movenet");
    expect(POSE_KEY in st.data).toBe(false);
    expect(resolvePoseBackend(q("pose=movenet-main"), st, "movenet")).toBe("movenet-main");
    expect(resolvePoseBackend(q(""), mem({ [POSE_KEY]: "garbage" }), "movenet")).toBe("movenet");
  });

  it("works when the storage throws (private mode)", () => {
    const bad: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(resolvePoseBackend(q("pose=movenet"), bad)).toBe("movenet");
    expect(resolvePoseBackend(q(""), bad)).toBe("mediapipe");
    expect(resolvePoseBackend(q("pose=mediapipe"), bad)).toBe("mediapipe");
  });
});
