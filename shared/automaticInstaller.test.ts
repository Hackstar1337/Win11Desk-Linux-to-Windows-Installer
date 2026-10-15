import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaults } from "./deployment";
import {
  linuxInstaller,
  targetDefaults,
  bashQuote,
  installerVersion,
} from "./installer";
const target = {
  ...targetDefaults,
  expectedHostname: "mock-vps",
  targetDisk: "/dev/vda",
  isoUrl: "https://example.com/x.iso",
  isoSha256: "a".repeat(64),
  backupReady: true,
  recoveryReady: true,
  unsupportedHardwareAccepted: true,
};
const config = { ...defaults, password: "SyntheticPassword!12" };
const tracking = {
  origin: "https://example.com",
  groupId: "11111111-1111-4111-8111-111111111111",
  writeToken: "b".repeat(64),
};
describe("automatic installer and tracking patches", () => {
  it("requires embedded page password and retains legacy manual behavior", () => {
    expect(() =>
      linuxInstaller(config, target, false, { automatic: true })
    ).toThrow("page password");
    expect(linuxInstaller(config, target)).toContain("AUTOMATIC='0'");
    const s = linuxInstaller(config, target, true, {
      automatic: true,
      tracking,
    });
    expect(s).toContain("AUTOMATIC='1'");
    expect(s).toContain("</dev/null");
    execFileSync("bash", ["-n"], { input: s });
  });
  it("passes install prompts without stdin then stops at mocked media request before boot operations", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-prompt-"));
    try {
      const sentinel = path.join(dir, "media-attempt");
      let s = linuxInstaller(config, target, true, { automatic: true });
      s = s
        .replace('[[ "$EUID" -eq 0 ]]', "[[ 1 -eq 1 ]]")
        .replace('[[ -b "$TARGET_DISK" ]]', "[[ 1 -eq 1 ]]")
        .replace(/RAM_KB=\$\(awk[^\n]+/, "RAM_KB=8000000");
      const mocks = `\nuname(){ [[ "$1" == -s ]] && echo Linux || echo x86_64; }\nhostname(){ echo mock-vps; }\nsystemd-detect-virt(){ return 1; }\nfindmnt(){ echo /dev/vda1; }\ngetconf(){ echo 2; }\nmokutil(){ echo 'SecureBoot disabled'; }\nlsblk(){ case "$*" in '-dn -o TYPE /dev/vda') echo disk;; '-s -nr -o PATH /dev/vda1') printf '/dev/vda1\\n/dev/vda\\n';; '-rn -o TYPE /dev/vda') printf 'disk\\npart\\n';; '-rn -o MOUNTPOINT /dev/vda') printf '\\n/\\n';; '-bdn -o SIZE /dev/vda') echo 80000000000;; *) echo mock;; esac; }\ncurl(){ touch ${bashQuote(sentinel)}; return 91; }\n`;
      s = s.replace('MODE="', mocks + 'MODE="');
      const file = path.join(dir, "run.sh");
      writeFileSync(file, s);
      const run = spawnSync("bash", [file, "--install"], {
        input: "",
        encoding: "utf8",
        timeout: 3000,
      });
      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("AUTOMATIC INSTALL");
      expect(run.stderr).toContain("ISO URL unavailable");
      expect(existsSync(sentinel)).toBe(true);
      expect(run.stdout).not.toContain("Type exactly: ERASE");
      expect(run.stdout).not.toContain("Type yes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("patches fixed upstream sources and creates expanded reporters without executing any installer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-track-patch-"));
    try {
      copyFileSync(
        "vendor/reinstall/reinstall.sh",
        path.join(dir, "original.sh")
      );
      copyFileSync(
        "vendor/reinstall/trans.sh",
        path.join(dir, "trans.input.sh")
      );
      const code = linuxInstaller(config, target, true, {
        automatic: true,
        tracking,
      });
      const patch = code.slice(
        code.indexOf("unset github_proxy"),
        code.indexOf('chmod 700 "$WORK/reinstall.sh"')
      );
      const test =
        `set -euo pipefail\nWORK=${bashQuote(dir)}\nDOWNLOAD="$WORK/original.sh"\nUPSTREAM_COMMIT=${installerVersion.commit}\nTRANS_SHA256=${installerVersion.transSha256}\nISO_SHA256=${"a".repeat(64)}\nRETRIES=3\nTRACK_ORIGIN=https://example.com\nTRACK_RUN=11111111-1111-4111-8111-111111111111\nTRACK_TOKEN=${"b".repeat(64)}\nRDP_PORT=22\nfail(){ echo "$*"; exit 1; }\ncurl(){ cp "$WORK/trans.input.sh" "$WORK/trans.original.sh"; }\n` +
        patch;
      writeFileSync(path.join(dir, "patch.sh"), test);
      execFileSync("bash", [path.join(dir, "patch.sh")]);
      for (const f of ["trans.sh", "reinstall.sh", "tracking/report.sh"])
        execFileSync("bash", ["-n", path.join(dir, f)]);
      const trans = readFileSync(path.join(dir, "trans.sh"), "utf8");
      expect(trans).toContain('trap "track_report failed" ERR');
      expect(trans).toContain("track_report downloading");
      expect(trans).toContain("sync_time || true\ntrack_prepare");
      expect(trans).toContain("track_start_heartbeat");
      expect(trans).toContain("track_report media_verified");
      expect(trans).toContain("track_report windows_setup");
      expect(trans).toContain('bats="$bats windows-report.bat"');
      expect(trans).toContain("Required Windows 11 Pro image missing");
      expect(trans).not.toContain("trap 'trap_err $LINENO $?' ERR");
      expect(trans).toContain(
        "trap 'ret=$?; track_report failed; trap_err $LINENO $ret' ERR"
      );
      expect(trans.lastIndexOf("trap 'ret=$?;")).toBeGreaterThan(
        trans.indexOf('trap "track_report failed" ERR')
      );
      const bat = readFileSync(
        path.join(dir, "tracking/windows-report.bat"),
        "utf8"
      );
      expect(bat).toContain(
        'schtasks /Create /TN "Win11DeskReport" /SC ONSTART /RU SYSTEM'
      );
      expect(bat).toContain('schtasks /Run /TN "Win11DeskReport"');
      expect(bat).not.toContain('start "" /b powershell');
      const ps = readFileSync(
        path.join(dir, "tracking/windows-report.ps1"),
        "utf8"
      );
      expect(ps).toContain(
        "$uri = 'https://example.com/api/installer/tracking/runs/11111111-1111-4111-8111-111111111111/events'"
      );
      expect(ps).toContain("$v.EditionID -ne 'Professional'");
      expect(ps).toContain("Get-NetTCPConnection");
      expect(ps).toContain(
        "Unregister-ScheduledTask -TaskName 'Win11DeskReport'"
      );
      expect(ps).toContain("Bearer " + "b".repeat(64));
      expect(ps).toContain("-LocalPort 22");
      expect(ps).not.toContain("SyntheticPassword");
      expect(ps).not.toContain("$TRACK_ORIGIN");
      const report = execFileSync(
        "bash",
        [
          "-c",
          `curl(){ while [[ $# -gt 0 ]]; do if [[ "$1" == --data ]]; then printf '%s' "$2" > ${bashQuote(path.join(dir, "report-body.json"))}; fi; shift; done; printf 204; }; source ${bashQuote(path.join(dir, "tracking/report.sh"))}; track_report media_verified; cat ${bashQuote(path.join(dir, "report-body.json"))}`,
        ],
        { encoding: "utf8" }
      );
      expect(JSON.parse(report)).toEqual({ stage: "media_verified" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
