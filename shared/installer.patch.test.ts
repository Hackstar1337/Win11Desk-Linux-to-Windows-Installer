import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaults } from "./deployment";
import {
  linuxInstaller,
  targetDefaults,
  installerVersion,
  bashQuote,
} from "./installer";

describe("pinned source integrity patches", () => {
  it("verifies both pinned sources and places ISO verification before mount", () => {
    const original = readFileSync("vendor/reinstall/reinstall.sh");
    const trans = readFileSync("vendor/reinstall/trans.sh");
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      installerVersion.sha256
    );
    expect(createHash("sha256").update(trans).digest("hex")).toBe(
      installerVersion.transSha256
    );
    const dir = mkdtempSync(path.join(tmpdir(), "win11-patch-test-"));
    try {
      copyFileSync(
        "vendor/reinstall/reinstall.sh",
        path.join(dir, "original.sh")
      );
      copyFileSync(
        "vendor/reinstall/trans.sh",
        path.join(dir, "trans.input.sh")
      );
      const code = linuxInstaller(defaults, {
        ...targetDefaults,
        expectedHostname: "fixture-only",
        isoUrl: "https://example.com/windows.iso",
        isoSha256: "a".repeat(64),
        backupReady: true,
        recoveryReady: true,
        unsupportedHardwareAccepted: true,
      });
      const patch = code.slice(
        code.indexOf("unset github_proxy"),
        code.indexOf('chmod 700 "$WORK/reinstall.sh"')
      );
      const test =
        `set -euo pipefail\nWORK=${bashQuote(dir)}\nDOWNLOAD="$WORK/original.sh"\nUPSTREAM_COMMIT=${installerVersion.commit}\nTRANS_SHA256=${installerVersion.transSha256}\nISO_SHA256=${"a".repeat(64)}\nRETRIES=3\nfail() { echo "$*"; exit 1; }\ncurl() { cp "$WORK/trans.input.sh" "$WORK/trans.original.sh"; }\n` +
        patch;
      writeFileSync(path.join(dir, "patch.sh"), test);
      execFileSync("bash", [path.join(dir, "patch.sh")]);
      for (const file of ["reinstall.sh", "trans.sh"])
        execFileSync("bash", ["-n", path.join(dir, file)]);
      const fixed = readFileSync(path.join(dir, "reinstall.sh"), "utf8");
      const stage = readFileSync(path.join(dir, "trans.sh"), "utf8");
      expect(stage).toContain(
        '[ "${part_size%MiB}" -ge 10440 ] || part_size=10440MiB'
      );
      const runtimeStage = stage.slice(stage.indexOf("trans() {"));
      expect(runtimeStage.indexOf('win11desk_media_probe "$iso"')).toBeLessThan(
        runtimeStage.indexOf("clear_previous")
      );
      expect(runtimeStage.indexOf("win11desk_media_prepare")).toBeLessThan(
        runtimeStage.indexOf('win11desk_media_probe "$iso"')
      );
      expect(runtimeStage).not.toContain(
        "apk add --no-cache curl ca-certificates pv"
      );
      const mediaHelper = readFileSync(
        path.join(dir, "media-guard.sh"),
        "utf8"
      );
      expect(mediaHelper.indexOf("if ! add_community_repo;")).toBeLessThan(
        mediaHelper.indexOf("if ! win11desk_media_apk_add pv;")
      );
      execFileSync("/bin/busybox", [
        "ash",
        "-n",
        path.join(dir, "media-guard.sh"),
      ]);
      expect(fixed).not.toContain("command curl --insecure");
      expect(fixed).not.toContain('echo "Password: $password"');
      expect(fixed).toContain("Password: [REDACTED");
      expect(fixed).toContain(
        `confhome=https://raw.githubusercontent.com/bin456789/reinstall/${installerVersion.commit}`
      );
      expect(fixed).toContain(
        "cp /root/win11desk/trans.sh $initrd_dir/trans.sh"
      );
      expect(stage).not.toContain("--no-check-certificate");
      const imageGuard = stage
        .split("\n")
        .find(
          line =>
            line.includes("grep -Fix --") &&
            line.includes("Required selected image missing")
        );
      expect(imageGuard).toBeTruthy();
      const prefix =
        "error_and_exit() { exit 41; }; image_name='Windows 11 Pro'; ";
      execFileSync("bash", [
        "-c",
        prefix + "all_image_names='Windows 11 Pro'; " + imageGuard,
      ]);
      expect(() =>
        execFileSync("bash", [
          "-c",
          prefix + "all_image_names='Windows 11 Home'; " + imageGuard,
        ])
      ).toThrow();
      expect(stage.indexOf(imageGuard!)).toBeLessThan(
        stage.indexOf('if [ "$image_count" = 1 ]; then')
      );
      const window = stage.slice(
        stage.indexOf("download $iso /os/windows.iso")
      );
      expect(window.indexOf("ISO_SHA256_MISMATCH")).toBeLessThan(
        window.indexOf("mount -o ro /os/windows.iso")
      );
      expect(window).toContain(
        'echo "' + "a".repeat(64) + '  /os/windows.iso" | sha256sum -c -'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
