import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaults } from "./deployment";
import {
  bashQuote,
  installTargetSchema,
  installerIssues,
  installerVersion,
  linuxInstaller,
  postInstallScript,
  targetDefaults,
} from "./installer";

const target = {
  ...targetDefaults,
  expectedHostname: "test-vps",
  targetDisk: "/dev/vda",
  isoUrl: "https://example.com/windows11.iso?token=abc",
  isoSha256: "a".repeat(64),
  backupReady: true,
  recoveryReady: true,
  unsupportedHardwareAccepted: true,
};
describe("real Linux VPS installer", () => {
  it("blocks missing targets and partition/container-style device names", () => {
    expect(installTargetSchema.safeParse(targetDefaults).success).toBe(false);
    for (const targetDisk of [
      "/dev/vda1",
      "/dev/sda1",
      "/dev/nvme0n1p1",
      "/dev/mapper/root",
      "/dev/vda;reboot",
    ])
      expect(
        installTargetSchema.safeParse({ ...target, targetDisk }).success
      ).toBe(false);
    for (const isoUrl of [
      "https://",
      "http://example.com/a.iso",
      "https://user:pass@example.com/a.iso",
      "https://example.com/a\nreboot",
    ])
      expect(installTargetSchema.safeParse({ ...target, isoUrl }).success).toBe(
        false
      );
    expect(installTargetSchema.safeParse(target).success).toBe(true);
  });
  it("uses real upstream arguments and gates optional reboot after typed approval", () => {
    const code = linuxInstaller(
      { ...defaults, username: "VpsUser", remotePort: 3399 },
      target
    );
    expect(code).toContain("--image-name 'Windows 11 Pro'");
    expect(code).toContain('--username "$WIN_USER" --rdp-port "$RDP_PORT"');
    expect(code).toContain('--target-disk "$TARGET_DISK"');
    expect(code).toContain(installerVersion.commit);
    expect(code).toContain(installerVersion.sha256);
    expect(code).toContain("sha256sum --check --status");
    expect(code).toContain("AUTO_REBOOT='0'");
    expect(code.indexOf("reboot_reply")).toBeLessThan(
      code.lastIndexOf("\n  reboot")
    );
    expect(code).toContain("REBOOT $EXPECTED_HOST $TARGET_DISK WINDOWS11PRO");
    expect(code.indexOf('if [[ "$MODE" == --preflight ]]')).toBeLessThan(
      code.indexOf("curl --proto")
    );
    expect(code.indexOf("Disk erasure not confirmed")).toBeLessThan(
      code.indexOf("curl --proto")
    );
    expect(code).toContain("ERASE $EXPECTED_HOST $TARGET_DISK WINDOWS11PRO");
  });
  it("keeps default password out of installer and embeds only explicitly", () => {
    const config = {
      ...defaults,
      password: "SyntheticSecret12!'$(touch /tmp/nope)",
    };
    expect(linuxInstaller(config, target)).not.toContain(config.password);
    expect(linuxInstaller(config, target, true)).toContain(
      "EMBEDDED_PASSWORD="
    );
    expect(linuxInstaller(config, target)).not.toContain(
      '--password "$password"'
    );
    expect(linuxInstaller(config, target)).toContain("export password");
  });
  it("rejects invalid usernames but allows sequential SSH and RDP port 22", () => {
    expect(
      installerIssues({ ...defaults, username: "bad@user" }, target).length
    ).toBeGreaterThan(0);
    expect(
      installerIssues({ ...defaults, remotePort: 22 }, target).length
    ).toBe(0);
  });
  it("produces syntactically valid Bash and stops on the wrong host without downloads", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "win11-installer-test-"));
    try {
      const file = path.join(dir, "installer.sh");
      writeFileSync(
        file,
        linuxInstaller(defaults, {
          ...target,
          expectedHostname: "never-this-development-host",
        })
      );
      execFileSync("bash", ["-n", file]);
      const run = spawnSync("sudo", ["-n", "bash", file, "--preflight"], {
        encoding: "utf8",
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("Wrong host");
      expect(run.stdout).not.toContain("STAGED");
      const malicious = path.join(dir, "quoted.sh");
      writeFileSync(
        malicious,
        `printf '%s' ${bashQuote("'$(echo INJECTED)\nunsafe")}`
      );
      expect(execFileSync("bash", [malicious], { encoding: "utf8" })).toBe(
        "'$(echo INJECTED)\nunsafe"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("generates independent post-install settings without credential leakage", () => {
    const code = postInstallScript({
      ...defaults,
      password: "NeverInPostSettings",
      apps: ["chrome", "7zip"],
      hostname: "WINPRO",
    });
    expect(code).not.toContain("NeverInPostSettings");
    expect(code).toContain("Google.Chrome");
    expect(code).toContain("7zip.7zip");
    expect(code).toContain("Rename-Computer");
    expect(code).toContain("#Requires -RunAsAdministrator");
  });
});
