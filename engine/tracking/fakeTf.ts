import { MN_STRIDE } from "./moveNetCore";

// A stand-in for TensorFlow.js used by the MoveNet tests: just enough of tfjs-core / tfjs-converter to follow the tensors. Every tensor
// is counted while alive; tidy() disposes what was made inside it except the returned tensor, like the real one.

export interface FakeTensor {
  shape: number[];
  dtype: string;
  dispose: () => void;
  data: () => Promise<Float32Array>;
}

export function makeFakeTf() {
  const st = {
    live: 0,
    made: 0,
    /** model output served by every execute() */
    output: new Float32Array(6 * MN_STRIDE),
    failData: false,
    holdData: false,
    release: null as (() => void) | null,
    webgl: true,
    scopes: [] as FakeTensor[][],
    ops: [] as string[],
    envSet: [] as [string, unknown][],
    modelDisposed: 0,
    loadedUrl: "",
    executed: [] as number[][],
    lutValues: [] as number[][],
    flags: {} as Record<string, unknown>,
    /** the value of ENGINE_COMPILE_ONLY at every execute() */
    compileOnlyAtExecute: [] as unknown[],
    /** the compile-only pass throws (a driver that cannot do it) */
    compileFails: false,
  };

  function mk(shape: number[], dtype = "int32", data?: () => Promise<Float32Array>): FakeTensor {
    st.live++;
    st.made++;
    let gone = false;
    const t: FakeTensor = {
      shape,
      dtype,
      dispose: () => {
        if (!gone) {
          gone = true;
          st.live--;
        }
      },
      data: data ?? (async () => new Float32Array(shape.reduce((a, b) => a * b, 1))),
    };
    st.scopes[st.scopes.length - 1]?.push(t);
    return t;
  }

  const tf = {
    setBackend: async () => st.webgl,
    ready: async () => undefined,
    getBackend: () => "webgl",
    backend: () => ({
      checkCompileCompletionAsync: async () => {
        st.ops.push("compile-wait");
        if (st.compileFails) throw new Error("compile failed");
        return [true];
      },
      getUniformLocations: () => void st.ops.push("uniforms"),
    }),
    env: () => ({
      set: (k: string, v: unknown) => {
        st.envSet.push([k, v]);
        st.flags[k] = v;
      },
    }),
    memory: () => ({ numTensors: st.live, numBytes: st.live * 100 }),
    tidy: (fn: () => FakeTensor) => {
      st.scopes.push([]);
      let r: FakeTensor;
      try {
        r = fn();
      } finally {
        const made = st.scopes.pop()!;
        for (const t of made) if (t !== r!) t.dispose();
      }
      // the result belongs to the outer scope
      st.scopes[st.scopes.length - 1]?.push(r!);
      return r!;
    },
    zeros: (shape: number[], dtype?: string) => mk(shape, dtype),
    tensor1d: (v: ArrayLike<number>, dtype?: string) => {
      st.lutValues.push(Array.from(v));
      return mk([v.length], dtype);
    },
    cast: (t: FakeTensor, dtype: string) => mk(t.shape, dtype),
    round: (t: FakeTensor) => mk(t.shape, t.dtype),
    gather: (_table: FakeTensor, idx: FakeTensor) => {
      st.ops.push("gather");
      return mk(idx.shape);
    },
    pad: (t: FakeTensor, p: number[][]) => {
      st.ops.push("pad");
      return mk(t.shape.map((n, i) => n + p[i][0] + p[i][1]));
    },
    expandDims: (t: FakeTensor) => mk([1, ...t.shape]),
    image: {
      resizeBilinear: (t: FakeTensor, size: [number, number]) => {
        st.ops.push(`resize ${size[1]}x${size[0]}`);
        return mk([size[0], size[1], t.shape[2]], "float32");
      },
    },
    browser: {
      fromPixels: (src: { videoWidth?: number; videoHeight?: number; width?: number; height?: number }) => {
        const w = src.videoWidth ?? src.width ?? 0;
        const h = src.videoHeight ?? src.height ?? 0;
        st.ops.push(`fromPixels ${w}x${h}`);
        return mk([h, w, 3]);
      },
    },
  };

  const model = {
    execute: (x: FakeTensor) => {
      st.executed.push(x.shape);
      st.compileOnlyAtExecute.push(st.flags.ENGINE_COMPILE_ONLY);
      return mk([1, 6, MN_STRIDE], "float32", async () => {
        if (st.failData) throw new Error("context lost");
        if (st.holdData) await new Promise<void>((r) => (st.release = r));
        return st.output;
      });
    },
    dispose: () => void st.modelDisposed++,
  };

  const conv = {
    loadGraphModel: async (url: string, o?: { onProgress?: (f: number) => void }) => {
      st.loadedUrl = url;
      o?.onProgress?.(0.5);
      o?.onProgress?.(1);
      return model;
    },
  };

  /** the model output for `people` (each: score + nose position), the rest zeros */
  function setOutput(...people: { score: number; nose?: [number, number]; kp?: number }[]): void {
    st.output = new Float32Array(6 * MN_STRIDE);
    people.forEach((p, i) => {
      const b = i * MN_STRIDE;
      for (let k = 0; k < 17; k++) {
        st.output[b + k * 3] = k === 0 && p.nose ? p.nose[1] : 0.5; // y
        st.output[b + k * 3 + 1] = k === 0 && p.nose ? p.nose[0] : 0.5; // x
        st.output[b + k * 3 + 2] = p.kp ?? 0.9;
      }
      st.output[b + 55] = p.score;
    });
  }

  return { st, tf, conv, model, setOutput };
}

export type FakeTf = ReturnType<typeof makeFakeTf>;
