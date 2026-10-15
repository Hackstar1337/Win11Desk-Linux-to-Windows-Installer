import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  defaultIsoUrl,
  defaultIsoSha256,
  downloadIsoUrl,
  automaticTarget,
} from "./media";
import { defaults } from "./deployment";
import { linuxInstaller, installerIssues } from "./installer";
import { pageScript, sealPageSettings } from "../server/pageInstallerDelivery";

describe("user-supplied direct media setup", () => {
  it("ships without a default ISO source or pinned checksum", () => {
    expect(defaultIsoUrl).toBe("");
    expect(downloadIsoUrl(defaultIsoUrl)).toBe(defaultIsoUrl);
    expect(automaticTarget(defaultIsoUrl).isoSha256).toBe(defaultIsoSha256);
    expect(automaticTarget("  " + defaultIsoUrl + "  ").isoUrl).toBe(
      defaultIsoUrl
    );
  });
  it("delivers that exact URL without alternate sources or media endpoints", () => {
    const { envelope } = sealPageSettings({
      settings: {
        username: "Administrator",
        remotePort: 22,
        retries: 3,
        target: automaticTarget(defaultIsoUrl),
      },
      password: "Test-Only-Password!",
      automatic: true,
    });
    const script = pageScript(envelope);
    expect(script).toContain("ISO_URL='" + defaultIsoUrl + "'");
    expect(script).not.toContain("/api/installer/media/");
    expect(script).not.toContain("drive.usercontent.google.com");
    expect(script).toContain("AUTOMATIC='1'");
    execFileSync("bash", ["-n"], { input: script });
  });
  it("keeps auto disk/hostname and valid invisible defaults", () => {
    const target = automaticTarget(defaultIsoUrl);
    expect(target.targetDisk).toBe("auto");
    expect(target.expectedHostname).toBe("auto");
    expect(installerIssues(defaults, target).length).toBeGreaterThan(0);
    const supplied = automaticTarget("https://example.com/windows11.iso");
    expect(installerIssues(defaults, supplied)).toEqual([]);
    execFileSync("bash", ["-n"], { input: linuxInstaller(defaults, supplied) });
  });
  it("keeps edited sources unchanged and fingerprints before boot staging", () => {
    const target = automaticTarget("https://example.com/custom.iso");
    expect(target.isoSha256).toBe("auto");
    expect(target.isoUrl).toBe("https://example.com/custom.iso");
    const script = linuxInstaller(defaults, target);
    expect(script.indexOf("ISO_SHA256=$(sha256sum")).toBeLessThan(
      script.indexOf('bash "$WORK/reinstall.sh" windows')
    );
    expect(script).toContain("ISO_SHA256_MISMATCH");
    execFileSync("bash", ["-n"], { input: script });
  });
  it("does not redirect old Drive or mirror selections and rejects invalid inputs", () => {
    const old =
      "https://drive.google.com/file/d/1XAAbBua_igNtiZTfWgZwl3w7EVSEyZHB/view";
    expect(downloadIsoUrl(old)).toBe(old);
    expect(automaticTarget(old).isoSha256).toBe("auto");
    for (const value of [
      "javascript:alert(1)",
      "http://example.com/a.iso",
      "https://user:password@example.com/a.iso",
    ])
      expect(
        installerIssues(defaults, automaticTarget(value)).length
      ).toBeGreaterThan(0);
  });
});
