import { describe, expect, it, afterEach } from "vitest";
import { can, canAlterTarget, canGrantRole, normalizeEmail, parseCookies, removesActiveOwner } from "./auth";
import { config, isLoopbackHost, resetConfigForTests } from "./config";
import { base32Decode, base32Encode, digest, generateTotpSecret, totpCode, verifyTotpCode } from "./crypto";

describe("custom admin authorization", () => {
  it("enforces capability separation by role", () => {
    expect(can("owner", "users:manage")).toBe(true);
    expect(can("admin", "credentials:reveal")).toBe(true);
    expect(can("operator", "commands:write")).toBe(true);
    expect(can("operator", "users:manage")).toBe(false);
    expect(can("viewer", "commands:write")).toBe(false);
    expect(can("viewer", "credentials:reveal")).toBe(false);
  });

  it("keeps owner and admin grants owner-only", () => {
    expect(canGrantRole("admin", "viewer")).toBe(true);
    expect(canGrantRole("admin", "operator")).toBe(true);
    expect(canGrantRole("admin", "admin")).toBe(false);
    expect(canGrantRole("admin", "owner")).toBe(false);
    expect(canAlterTarget("admin", "viewer")).toBe(true);
    expect(canAlterTarget("admin", "owner")).toBe(false);
  });

  it("protects the final active owner transition", () => {
    expect(removesActiveOwner("owner", true, "admin", true)).toBe(true);
    expect(removesActiveOwner("owner", true, "owner", false)).toBe(true);
    expect(removesActiveOwner("owner", true, "owner", true)).toBe(false);
    expect(removesActiveOwner("admin", true, "viewer", true)).toBe(false);
  });

  it("normalizes identifiers without changing password semantics", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(() => normalizeEmail("not-an-email")).toThrow();
    expect(() => normalizeEmail("x".repeat(321) + "@example.com")).toThrow();
  });
});

describe("authentication hardening primitives", () => {
  it("treats malformed cookies as absent rather than throwing", () => {
    const req = { headers: { cookie: "win11desk_admin_session=%E0%A4%A; safe=ok" } } as any;
    expect(parseCookies(req)).toEqual({ safe: "ok" });
  });

  it("recognizes bracketed IPv6 loopback hosts", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[2001:db8::1]")).toBe(false);
  });

  it("rejects public URL credentials", () => {
    const old = { url: process.env.APP_PUBLIC_URL, key: process.env.VAULT_KEY, boot: process.env.BOOTSTRAP_SECRET };
    process.env.APP_PUBLIC_URL = "https://user:pass@example.test";
    process.env.VAULT_KEY = "0".repeat(64);
    process.env.BOOTSTRAP_SECRET = "b".repeat(32);
    resetConfigForTests();
    expect(() => config()).toThrow(/credentials/);
    if (old.url === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = old.url;
    if (old.key === undefined) delete process.env.VAULT_KEY; else process.env.VAULT_KEY = old.key;
    if (old.boot === undefined) delete process.env.BOOTSTRAP_SECRET; else process.env.BOOTSTRAP_SECRET = old.boot;
    resetConfigForTests();
  });

  afterEach(() => resetConfigForTests());
});

describe("authentication crypto primitives", () => {
  it("produces stable digests and reversible base32 values", () => {
    expect(digest("sample")).toBe("af2bdbe1aa9b6ec1e2ade1d694f41fc71a831d0268e9891562113d8a62add1bf");
    const bytes = Uint8Array.from([0, 1, 2, 31, 32, 254, 255]);
    expect(Buffer.from(base32Decode(base32Encode(bytes)))).toEqual(Buffer.from(bytes));
  });

  it("accepts the current TOTP step and rejects malformed or distant codes", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const code = totpCode(secret, Math.floor(at / 30_000));
    expect(verifyTotpCode(secret, code, at, 0)).toBe(true);
    expect(verifyTotpCode(secret, "123", at, 0)).toBe(false);
    expect(verifyTotpCode(secret, code, at + 120_000, 0)).toBe(false);
  });
});
