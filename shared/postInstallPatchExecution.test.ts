import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { trackingPatchShell } from "./installerTrackingHooks";
import { buildPostInstallPayload } from "../server/control/postInstallAssets";
import { defaultPostInstallOptions, attachedScript } from "./postInstall";
const implementations = [
  { name: "GNU awk", command: "gawk", args: [] },
  { name: "mawk", command: "mawk", args: [] },
  { name: "BusyBox awk", command: "busybox", args: ["awk"] },
];
const modes = [
  { name: "Off", getFiles: false, runAttachedScript: false },
  { name: "files only", getFiles: true, runAttachedScript: false },
  { name: "script only", getFiles: false, runAttachedScript: true },
  { name: "files and script", getFiles: true, runAttachedScript: true },
];
const quote = (x: string) => "'" + x.replaceAll("'", "'\"'\"'") + "'";
for (const impl of implementations) {
  let available = true;
  try {
    execFileSync(impl.command, [...impl.args, "BEGIN { exit 0 }"], {
      stdio: "ignore",
    });
  } catch {
    available = false;
  }
  describe(`${impl.name} actual generated staging`, () => {
    for (const mode of modes)
      it.skipIf(!available)(mode.name, () => {
        const dir = mkdtempSync(join(tmpdir(), "post-awk-execution-"));
        try {
          const bin = join(dir, "bin");
          mkdirSync(bin);
          const binary = execFileSync(
            "sh",
            ["-c", `command -v ${impl.command}`],
            { encoding: "utf8" }
          ).trim();
          writeFileSync(
            join(bin, "awk"),
            `#!/bin/sh\nexec ${quote(binary)} ${impl.args.map(quote).join(" ")} "$@"\n`,
            { mode: 0o700 }
          );
          copyFileSync(
            "vendor/reinstall/reinstall.sh",
            join(dir, "reinstall.sh")
          );
          copyFileSync("vendor/reinstall/trans.sh", join(dir, "trans.sh"));
          const payload = buildPostInstallPayload(
            {
              ...defaultPostInstallOptions,
              getFiles: mode.getFiles,
              runAttachedScript: mode.runAttachedScript,
              apps: mode.getFiles ? ["firefox"] : [],
            },
            "windows-11-pro"
          );
          const patch = trackingPatchShell(
            "windows-11-pro",
            "Windows 11 Pro",
            payload
          );
          const harness =
            `set -euo pipefail\nWORK=${quote(dir)}\nTRACK_ORIGIN=https://fixture.example.com\nTRACK_RUN=11111111-1111-4111-8111-111111111111\nTRACK_TOKEN=${"a".repeat(64)}\nRDP_PORT=22\nfail() { echo 'Fixture marker check failed' >&2; exit 41; }\n` +
            patch;
          const file = join(dir, "patch.sh");
          writeFileSync(file, harness);
          execFileSync("bash", [file], {
            env: { ...process.env, PATH: bin + ":" + process.env.PATH },
            maxBuffer: 1_000_000,
          });
          for (const target of ["reinstall.sh", "trans.sh"])
            execFileSync("bash", ["-n", join(dir, target)]);
          const stage = readFileSync(join(dir, "trans.sh"), "utf8");
          const cp =
            '    cp /configs/win11desk-attached.bat "$os_dir/win11desk-attached.bat"';
          expect(stage.split("\n").filter(l => l === cp)).toHaveLength(
            mode.runAttachedScript ? 1 : 0
          );
          expect(stage).toContain(
            '    cp /configs/windows-report.ps1 "$os_dir/win11desk-report.ps1"'
          );
          expect(stage).toContain('    bats="$bats windows-report.bat"');
          if (payload) {
            const postSource = readFileSync(
              join(dir, "tracking/win11desk-post.ps1"),
              "utf8"
            );
            expect(postSource).toContain(
              "$origin = 'https://fixture.example.com'"
            );
            expect(postSource).toContain(
              "$run = '11111111-1111-4111-8111-111111111111'"
            );
            expect(postSource).toContain("$rdpPortText = '22'");
            let havePS = true;
            try {
              execFileSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
                stdio: "ignore",
              });
            } catch {
              havePS = false;
            }
            if (havePS)
              for (const name of [
                "win11desk-post.ps1",
                "win11desk-post-register.ps1",
              ]) {
                const source = readFileSync(join(dir, "tracking", name));
                execFileSync(
                  "pwsh",
                  [
                    "-NoProfile",
                    "-Command",
                    `$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source.toString("base64")}'));$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e);if($e.Count){$e|% Message;exit 1}`,
                  ],
                  { maxBuffer: 1_000_000 }
                );
              }
          }
          if (mode.runAttachedScript)
            expect(
              createHash("sha256")
                .update(
                  readFileSync(join(dir, "tracking/win11desk-attached.bat"))
                )
                .digest("hex")
            ).toBe(attachedScript.sha256);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
  });
}
