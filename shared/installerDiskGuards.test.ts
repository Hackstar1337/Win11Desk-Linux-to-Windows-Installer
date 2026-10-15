import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { linuxInstaller, targetDefaults } from "./installer";
import { defaults } from "./deployment";
const code = linuxInstaller(defaults, {
  ...targetDefaults,
  isoUrl: "https://fixture.example.com/windows.iso",
  isoSha256: "a".repeat(64),
  expectedHostname: "fixture",
  backupReady: true,
  recoveryReady: true,
  unsupportedHardwareAccepted: true,
});
const guard = code.slice(
  code.indexOf("DISK_TYPES=$(lsblk"),
  code.indexOf("ROOT_DEVICE=$(findmnt")
);
function execute(which: "types" | "mounts" | "readError" | "valid") {
  const source = `set -euo pipefail
TARGET_DISK=/dev/vda
fail() { echo "$*"; exit 41; }
lsblk() {
 if [ '${which}' = readError ]; then return 1; fi
 case "$*" in
 *TYPE*) if [ '${which}' = types ]; then printf 'crypt\\n'; i=0; while [ "$i" -lt 10000 ]; do printf 'part\\n'; i=$((i+1)); done; else printf 'disk\\npart\\n'; fi;;
 *MOUNTPOINT*) if [ '${which}' = mounts ]; then printf '/home\\n'; i=0; while [ "$i" -lt 10000 ]; do printf '/\\n'; i=$((i+1)); done; else printf '/\\n/boot\\n/boot/efi\\n'; fi;;
 esac
}
${guard}
printf 'SAFE_PASS\\n'
`;
  return spawnSync("bash", ["-s"], { input: source, encoding: "utf8" });
}
describe("Future generated installer disk guards consume complete read-only probes", () => {
  it("accepts normal root/boot mounts", () =>
    expect(execute("valid").stdout).toContain("SAFE_PASS"));
  it.each(["types", "mounts", "readError"] as const)(
    "fails closed for %s",
    which => {
      const result = execute(which);
      expect(result.status, result.stderr).toBe(41);
      expect(result.stdout).not.toContain("SAFE_PASS");
    }
  );
});
