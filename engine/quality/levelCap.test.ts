import { beforeEach, describe, expect, it } from "vitest";
import { lowerLevel, readLevelCap, writeLevelCap } from "./levelCap";

const DAY = 24 * 3600 * 1000;

describe("levelCap", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the level per game and GPU", () => {
    writeLevelCap("poyga", "uhd", "low", 0);
    expect(readLevelCap("poyga", "uhd", 1000)).toBe("low");
    expect(readLevelCap("baliq-ovi", "uhd", 1000)).toBeNull();
    expect(readLevelCap("poyga", "rtx", 1000)).toBeNull();
  });

  it("expires after a week", () => {
    writeLevelCap("poyga", "uhd", "low", 0);
    expect(readLevelCap("poyga", "uhd", 6 * DAY)).toBe("low");
    expect(readLevelCap("poyga", "uhd", 8 * DAY)).toBeNull();
  });

  it("ignores broken data", () => {
    localStorage.setItem("harakat.levelCap.poyga", "{not json");
    expect(readLevelCap("poyga", "uhd", 0)).toBeNull();
    localStorage.setItem("harakat.levelCap.poyga", JSON.stringify({ gpu: "uhd", level: "ultra", at: 0 }));
    expect(readLevelCap("poyga", "uhd", 0)).toBeNull();
  });

  it("only ever lowers the start level", () => {
    expect(lowerLevel("high", "low")).toBe("low");
    expect(lowerLevel("low", "high")).toBe("low");
    expect(lowerLevel("medium", null)).toBe("medium");
  });
});
