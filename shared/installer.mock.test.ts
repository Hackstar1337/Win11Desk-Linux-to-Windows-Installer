import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaults } from "./deployment";
import { linuxInstaller, targetDefaults, bashQuote } from "./installer";

// Test-only replacements. Production installer is never run against a real disk.
function fixture(dir: string, auto = false, ram = 8000000, crash = 0) {
  const sentinel = path.join(dir, "DOWNLOAD_ATTEMPTED");
  const crashFile = path.join(dir, "crash_size");
  writeFileSync(crashFile, String(crash) + "\n");
  let code = linuxInstaller(defaults, {
    ...targetDefaults,
    expectedHostname: auto ? "auto" : "mock-vps",
    targetDisk: auto ? "auto" : "/dev/vda",
    isoUrl: "https://example.com/win.iso",
    isoSha256: "a".repeat(64),
    backupReady: true,
    recoveryReady: true,
    unsupportedHardwareAccepted: true,
  });
  code = code
    .replace('[[ "$EUID" -eq 0 ]]', "[[ 1 -eq 1 ]]")
    .replace('[[ -b "$TARGET_DISK" ]]', "[[ 1 -eq 1 ]]")
    .replace(/RAM_KB=\$\(awk[^\n]+/, `RAM_KB=${ram}`)
    .replaceAll("/sys/kernel/kexec_crash_size", crashFile);
  const mocks = `
uname() { if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi; }
hostname() { echo mock-vps; }
systemd-detect-virt() { return 1; }
findmnt() { echo /dev/vda1; }
getconf() { echo 2; }
mokutil() { echo 'SecureBoot disabled'; }
lsblk() {
 case "$*" in
  '-dn -o TYPE /dev/vda') echo disk;;
  '-dn -o TYPE /dev/vda1') echo part;;
  '-s -nr -o PATH,TYPE /dev/vda1') printf '/dev/vda1 part\\n/dev/vda disk\\n';;
  '-rn -o TYPE /dev/vda') printf 'disk\\npart\\n';;
  '-rn -o MOUNTPOINT /dev/vda') printf '\\n/\\n';;
  '-s -nr -o PATH /dev/vda1') printf '/dev/vda1\\n/dev/vda\\n';;
  '-bdn -o SIZE /dev/vda') echo 80000000000;;
  *) echo 'mock disk metadata';;
 esac
}
curl() { touch ${bashQuote(sentinel)}; return 91; }
`;
  code = code.replace('MODE="', mocks + '\nMODE="');
  const file = path.join(dir, "fixture.sh");
  writeFileSync(file, code);
  return { file, sentinel };
}
describe("mocked installer guards", () => {
  it.each([
    { reserve: 536870912, pass: true },
    { reserve: 0, pass: false },
  ])(
    "counts verified Linux crash reservation: $reserve bytes",
    ({ reserve, pass }) => {
      const dir = mkdtempSync(path.join(tmpdir(), "win11-ram-mock-"));
      try {
        const { file, sentinel } = fixture(dir, false, 3474300, reserve);
        const run = spawnSync("bash", [file, "--preflight"], {
          encoding: "utf8",
        });
        if (pass) expect(run.status).toBe(0);
        else expect(run.status).not.toBe(0);
        expect(existsSync(sentinel)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it("auto-detects mock host and plain root disk before preflight without downloads", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "win11-auto-mock-"));
    try {
      const { file, sentinel } = fixture(dir, true);
      const run = spawnSync("bash", [file, "--preflight"], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("host=mock-vps disk=/dev/vda");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("passes preflight without any download or boot operation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "win11-mock-"));
    try {
      const { file, sentinel } = fixture(dir);
      const run = spawnSync("bash", [file, "--preflight"], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("Read-only preflight passed");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects wrong erase confirmation in an interactive PTY before downloads", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "win11-mock-"));
    try {
      const { file, sentinel } = fixture(dir);
      const run = spawnSync(
        "script",
        ["-q", "-e", "-c", `bash ${bashQuote(file)} --install`, "/dev/null"],
        {
          input: "YES\nNOT-THE-ERASE-PHRASE\n",
          encoding: "utf8",
          timeout: 4000,
        }
      );
      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("Disk erasure not confirmed");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each(["yes", "YeS", "  yes  ", "\tyes\t", "maybe\nyes"])(
    "accepts acknowledgement %j but still blocks wrong exact erase phrase",
    reply => {
      const dir = mkdtempSync(path.join(tmpdir(), "win11-confirm-mock-"));
      try {
        const { file, sentinel } = fixture(dir);
        const run = spawnSync(
          "script",
          ["-q", "-e", "-c", `bash ${bashQuote(file)} --install`, "/dev/null"],
          {
            input: reply + "\nNOT-THE-ERASE-PHRASE\n",
            encoding: "utf8",
            timeout: 4000,
          }
        );
        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain(
          "Type exactly: ERASE mock-vps /dev/vda WINDOWS11PRO"
        );
        expect(run.stdout).toContain("Disk erasure not confirmed");
        if (reply.startsWith("maybe"))
          expect(run.stdout).toContain("Not confirmed. Type yes");
        expect(existsSync(sentinel)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it.each(["no", "N", " NO "])(
    "cancels acknowledgement %j without reaching erase/download",
    reply => {
      const dir = mkdtempSync(path.join(tmpdir(), "win11-cancel-mock-"));
      try {
        const { file, sentinel } = fixture(dir);
        const run = spawnSync(
          "script",
          ["-q", "-e", "-c", `bash ${bashQuote(file)} --install`, "/dev/null"],
          { input: reply + "\n", encoding: "utf8", timeout: 4000 }
        );
        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain(
          "Cancelled by user before installation staging"
        );
        expect(run.stdout).not.toContain("Type exactly: ERASE");
        expect(existsSync(sentinel)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
