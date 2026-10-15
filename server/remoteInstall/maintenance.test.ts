import { describe, it, expect, vi } from "vitest";
import { assertRemoteSecretsDrained } from "../../scripts/rotate-vault";
describe("Version 2 vault maintenance guard", () => {
  it("refuses rotation while any encrypted remote grant remains", async () => {
    const execute = vi.fn(async () => [[{ id: "synthetic" }]]);
    await expect(assertRemoteSecretsDrained({ execute })).rejects.toThrow(
      "Pending remote credentials"
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("permits the existing rotation workflow after transient grants are cleared", async () => {
    await expect(
      assertRemoteSecretsDrained({ execute: async () => [[]] })
    ).resolves.toBeUndefined();
  });
  it("preserves legacy installations without the optional remote table", async () => {
    await expect(
      assertRemoteSecretsDrained({
        execute: async () => {
          throw { code: "ER_NO_SUCH_TABLE" };
        },
      })
    ).resolves.toBeUndefined();
  });
  it("fails closed on an unreadable remote maintenance state without leaking DB messages", async () => {
    await expect(
      assertRemoteSecretsDrained({
        execute: async () => {
          throw new Error("synthetic-private-message");
        },
      })
    ).rejects.toThrow("Cannot verify remote credential maintenance state");
  });
});
