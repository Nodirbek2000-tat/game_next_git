import { describe, expect, it } from "vitest";
import { resolveInitialLevel, resolvePoseModel, type DeviceProfile } from "./gpu";

const dev = (o: Partial<DeviceProfile> = {}): DeviceProfile => ({ tier: 3, isMobile: false, gpu: "x", detected: true, cores: 8, memory: 8, software: false, webgl: true, ...o });

describe("resolvePoseModel", () => {
  it("is lite by default, even on strong machines; full only when the user asks", () => {
    expect(resolvePoseModel("auto", dev())).toBe("lite");
    expect(resolvePoseModel("auto", dev({ tier: 3 }))).toBe("lite");
    expect(resolvePoseModel("lite", dev())).toBe("lite");
    expect(resolvePoseModel("full", dev())).toBe("full");
  });
});

describe("resolveInitialLevel", () => {
  it("follows the GPU tier on a normal machine", () => {
    expect(resolveInitialLevel("auto", dev()).level).toBe("high");
    expect(resolveInitialLevel("auto", dev({ tier: 2 })).level).toBe("medium");
    expect(resolveInitialLevel("auto", dev({ tier: 1 })).level).toBe("low");
  });
  it("integrated GPUs and phones never start on high", () => {
    expect(resolveInitialLevel("auto", dev({ gpu: "ANGLE (Intel, Intel(R) UHD Graphics)" })).level).toBe("medium");
    expect(resolveInitialLevel("auto", dev({ gpu: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)" })).level).toBe("medium");
    expect(resolveInitialLevel("auto", dev({ gpu: "AMD Radeon Vega 8 Graphics" })).level).toBe("medium");
    expect(resolveInitialLevel("auto", dev({ isMobile: true })).level).toBe("low");
  });
  it("starts lower on weak CPUs, little memory and software renderers", () => {
    expect(resolveInitialLevel("auto", dev({ cores: 4 })).level).toBe("medium");
    expect(resolveInitialLevel("auto", dev({ cores: 2 })).level).toBe("low");
    expect(resolveInitialLevel("auto", dev({ memory: 2 })).level).toBe("low");
    expect(resolveInitialLevel("auto", dev({ software: true, tier: 0 })).level).toBe("low");
  });
  it("a forced quality is not adaptive, auto is", () => {
    expect(resolveInitialLevel("medium", dev())).toEqual({ level: "medium", adaptive: false });
    expect(resolveInitialLevel("auto", dev()).adaptive).toBe(true);
  });
});
