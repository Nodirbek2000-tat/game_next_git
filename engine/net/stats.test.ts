import { describe, expect, it } from "vitest";
import { visitorId } from "./stats";

describe("visitorId", () => {
  it("is a random uuid, made once and kept", () => {
    localStorage.clear();
    const a = visitorId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(visitorId()).toBe(a);
    localStorage.clear();
    expect(visitorId()).not.toBe(a);
  });
});
