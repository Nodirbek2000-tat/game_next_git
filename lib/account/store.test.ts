import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, botLink, getToken, useAccount, type Me } from "./store";

const me = (premium: boolean): Me => ({ id: 1, username: "a", name: "A", role: "user", isAdmin: false, premium, premiumUntil: null, telegram: false, devices: 1, deviceLimit: 3 });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useAccount.setState({ me: null, ready: false });
});

describe("account store", () => {
  it("free games for everybody (signed in or not), the rest only with premium", () => {
    useAccount.setState({ config: { freeGames: ["meva-ninja"], monthlyPrice: 0, bogchaPhone: "", botUsername: "b" } });
    const { canPlay } = useAccount.getState();
    // free games: also without signing in
    expect(canPlay("meva-ninja")).toBe(true);
    expect(canPlay("boks")).toBe(false);
    useAccount.getState().signedIn("tok", me(false));
    expect(getToken()).toBe("tok");
    expect(canPlay("meva-ninja")).toBe(true);
    expect(canPlay("boks")).toBe(false);
    useAccount.setState({ me: me(true) });
    expect(canPlay("boks")).toBe(true);
  });

  it("api sends the token and turns errors into ApiError with the server's message", async () => {
    localStorage.setItem("harakat.token", "T1");
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Login yoki parol noto‘g‘ri" }), { status: 401 }));
    vi.stubGlobal("fetch", f);
    await expect(api("auth/login", { body: {} })).rejects.toMatchObject({ status: 401, message: "Login yoki parol noto‘g‘ri" });
    const call = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/auth/login");
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer T1");
    expect(new ApiError(1, "x")).toBeInstanceOf(Error);
  });

  it("a rejected token signs out on load", async () => {
    localStorage.setItem("harakat.token", "old");
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.endsWith("/me") ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ freeGames: ["x"], monthlyPrice: 5, bogchaPhone: "", botUsername: "b" })))));
    await useAccount.getState().load();
    expect(useAccount.getState().me).toBeNull();
    expect(getToken()).toBeNull();
    expect(useAccount.getState().config.monthlyPrice).toBe(5);
  });

  it("bot links", () => {
    expect(botLink({ freeGames: [], monthlyPrice: 0, bogchaPhone: "", botUsername: "moveandplay_bot" }, "premium")).toBe("https://t.me/moveandplay_bot?start=premium");
  });
});
