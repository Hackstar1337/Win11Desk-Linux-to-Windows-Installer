import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { defaults } from "../shared/deployment";
import { targetDefaults } from "../shared/installer";
import { reusableSettings, testedMedia } from "../shared/reusableInstaller";
import {
  sealPageSettings,
  pageScript,
  pageCommand,
  deliveryMs,
} from "./pageInstallerDelivery";
import { sha256 } from "./installerTicketCrypto";
const input = {
  settings: reusableSettings(defaults, {
    ...targetDefaults,
    isoUrl: "https://example.com/windows.iso",
    isoSha256: testedMedia.sha256,
    backupReady: true,
    recoveryReady: true,
    unsupportedHardwareAccepted: true,
  }),
  password: "OnlySyntheticSecret!12",
};
describe("page settings delivery", () => {
  it("uses requested page password inside exact installer, not visible command", () => {
    const s = sealPageSettings(input),
      script = pageScript(s.envelope),
      cmd = pageCommand(
        "https://dashboard.example.com",
        s.envelope,
        sha256(script),
        10
      );
    expect(script).toContain("EMBEDDED_PASSWORD='OnlySyntheticSecret!12'");
    expect(script).toContain("RDP_PORT='22'");
    expect(cmd).not.toContain(input.password);
    expect(cmd).not.toContain("settings=");
    expect(cmd).toContain("--data-binary @-");
    expect(cmd).toContain("tries=10");
    expect(cmd).not.toContain("resolv.conf");
    expect(cmd).toContain(sha256(script));
    execFileSync("bash", ["-n"], { input: cmd });
  });
  it("rejects corruption and expires retrieval after 30 minutes", () => {
    const s = sealPageSettings(input);
    const tampered = Buffer.from(s.envelope.data, "base64url");
    tampered[0] ^= 1;
    expect(() =>
      pageScript({ ...s.envelope, data: tampered.toString("base64url") })
    ).toThrow();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + deliveryMs + 1000);
    try {
      expect(() => pageScript(s.envelope)).toThrow("expired");
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("creates unlimited independent stateless deliveries with no server ticket identity", () => {
    const a = sealPageSettings(input),
      b = sealPageSettings(input);
    expect(a.envelope.key).not.toBe(b.envelope.key);
    expect(pageScript(a.envelope)).toBe(pageScript(b.envelope));
    expect(a.envelope).not.toHaveProperty("id");
  });
  it("rejects multiline password, weak password and invalid origin", () => {
    expect(() => sealPageSettings({ ...input, password: "short" })).toThrow();
    expect(() =>
      sealPageSettings({ ...input, password: "Long\nPassword123" })
    ).toThrow();
    const s = sealPageSettings(input);
    expect(() =>
      pageCommand(
        "http://x.com",
        s.envelope,
        sha256(pageScript(s.envelope)),
        10
      )
    ).toThrow();
  });
});
