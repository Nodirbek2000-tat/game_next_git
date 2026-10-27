import { expect, test, type Page } from "@playwright/test";
import { installFake } from "./fixtures";

const waitState = (page: Page, s: string, timeout = 90_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });

// Real MediaPipe (no window.__fake): the camera is a coloured canvas, so no person is found, but the whole
// loading pipeline (wasm, models, worker / main thread, GPU -> CPU fallback) must work and stay local.
for (const worker of ["1", "0"]) {
  test(`real models load from our own server (${worker === "1" ? "web worker" : "main thread"})`, async ({ page }) => {
    test.setTimeout(150_000);
    const hosts = new Set<string>();
    page.on("request", (r) => {
      try {
        hosts.add(new URL(r.url()).host);
      } catch {
        /* data: urls */
      }
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await installFake(page, { mode: "none" });
    await page.goto(`/play/meva-ninja?debug=1&worker=${worker}`);
    await waitState(page, "scan");
    // a few real frames must go through the detector (software GL in CI is slow, so wait for the count)
    await page.waitForFunction(() => ((window as unknown as { __engine?: { detectFrame: number } }).__engine?.detectFrame ?? 0) >= 3, undefined, { timeout: 90_000 });
    const panel = await page.getByTestId("debug-panel").innerText();
    expect(panel).toMatch(worker === "1" ? /worker · (GPU|CPU)/ : /main · (GPU|CPU)/);
    expect(panel).toMatch(/lite|full/);
    test.info().annotations.push({ type: "tracking", description: panel.split(String.fromCharCode(10)).filter((l) => /tracking|GPU/.test(l)).join(" / ") });
    await expect(page.getByTestId("scan-info")).toContainText("Hech kim ko‘rinmayapti");
    // nothing may be fetched from a CDN
    const foreign = [...hosts].filter((h) => !/^localhost(:\d+)?$/.test(h));
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });
}
