import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { telemetryPatchShell } from "./installerTelemetry";

const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";

function runPatch(trans: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "win11-telemetry-test-"));
  writeFileSync(path.join(dir, "trans.sh"), trans);
  const script = `#!/usr/bin/env bash
set -euo pipefail
WORK=${quote(dir)}
fail() { printf '%s\\n' "$*" >&2; exit 1; }
${telemetryPatchShell()}
`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  const output = readFileSync(path.join(dir, "trans.sh"), "utf8");
  return { dir, output, result };
}

describe("bounded ISO download telemetry source patch", () => {
  it("patches one exact final ISO marker and leaves the digest check after it", () => {
    const fixture = [
      "set -eE",
      ". /configs/report.sh",
      "    track_report downloading",
      "    download $iso /os/windows.iso",
      "    echo 'sha256  /os/windows.iso' | sha256sum -c - || error_and_exit ISO_SHA256_MISMATCH",
      "reboot",
      "",
    ].join("\n");
    const { dir, output, result } = runPatch(fixture);
    try {
      expect(result.status).toBe(0);
      expect(output).toContain(
        'win11desk_download_iso "$iso" "/os/windows.iso"'
      );
      expect(output).not.toContain("    download $iso /os/windows.iso");
      expect(output.indexOf("win11desk_download_iso")).toBeLessThan(
        output.indexOf("ISO_SHA256_MISMATCH")
      );
      expect(output).toContain("stat -c %s");
      expect(output).toContain('track_progress "$downloaded" "$total" payload');
      execFileSync("bash", ["-n", path.join(dir, "trans.sh")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the pinned marker is missing or duplicated", () => {
    for (const fixture of [
      "set -eE\n    echo untouched\n",
      "set -eE\n    download $iso /os/windows.iso\n    download $iso /os/windows.iso\n",
    ]) {
      const { dir, result } = runPatch(fixture);
      try {
        expect(result.status).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("keeps transport security, bounded attempts, and finite monitor lifetime", () => {
    const shell = telemetryPatchShell();
    expect(shell).toContain("--proto '=https'");
    expect(shell).toContain("--proto-redir '=https'");
    expect(shell).toContain("--tlsv1.2");
    expect(shell).toContain("--max-time 7200");
    expect(shell).toContain("max_attempts=5");
    expect(shell).toContain("attempt=1");
    expect(shell).toContain("attempt=$((attempt + 1))");
    expect(shell).toContain('tick" -lt 720');
    expect(shell).toContain("trap 'exit 143' INT TERM HUP");
    expect(shell).toContain("error_and_exit ISO_DOWNLOAD_FAILED");
    expect(shell).not.toContain("--insecure");
    expect(shell).not.toContain("aria2c");
  });
});
