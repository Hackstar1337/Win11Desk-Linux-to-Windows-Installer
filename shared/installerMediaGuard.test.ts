import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { mediaProbeShell } from "./installerMediaGuard";
import { linuxInstaller, bashQuote, targetDefaults } from "./installer";
import { defaults } from "./deployment";
describe("real Drive quota ISO guard", () => {
  it.each(["quota", "html", "iso"])(
    "HTTP200/206 %s checked before destructive code",
    kind => {
      const dir = mkdtempSync(path.join(tmpdir(), "media-probe-"));
      try {
        const p = Buffer.alloc(65536);
        if (kind === "iso") p.write("CD001", 32769);
        else
          p.write(
            kind === "quota"
              ? "<title>Google Drive - Quota exceeded</title>"
              : "<html>Not an ISO</html>"
          );
        writeFileSync(dir + "/input", p);
        writeFileSync(
          dir + "/curl",
          `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) shift; output="$1";; esac; shift; done\ncp ${bashQuote(dir + "/input")} "$output"\nprintf ${kind === "iso" ? "206" : "200"}\n`,
          { mode: 0o700 }
        );
        const run = spawnSync(
          "/bin/busybox",
          [
            "ash",
            "-c",
            mediaProbeShell() +
              `\nwin11desk_media_probe https://example.com/media\n`,
          ],
          {
            env: { ...process.env, PATH: dir + ":" + process.env.PATH },
            encoding: "utf8",
          }
        );
        expect(run.status).toBe(kind === "iso" ? 0 : 1);
        if (kind === "quota")
          expect(run.stderr).toContain("MEDIA_QUOTA_EXCEEDED");
        if (kind === "html") expect(run.stderr).toContain("MEDIA_NOT_ISO");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it("generated source validates range bytes before staging and second-stage create_part", () => {
    const script = linuxInstaller(
      { ...defaults, password: "Synthetic-Test-Password1!" },
      {
        ...targetDefaults,
        isoUrl: "https://example.com/win.iso",
        isoSha256: "a".repeat(64),
        backupReady: true,
        recoveryReady: true,
        unsupportedHardwareAccepted: true,
      },
      true,
      { automatic: true }
    );
    expect(script.indexOf('win11desk_media_probe "$ISO_URL"')).toBeLessThan(
      script.indexOf('bash "$WORK/reinstall.sh" windows')
    );
    expect(script).toContain(
      'win11desk_media_probe \\"$iso\\" || error_and_exit MEDIA_PREFLIGHT_FAILED'
    );
    expect(script).toContain(
      "cp /root/win11desk/media-guard.sh $initrd_dir/configs/"
    );
  });
});
