import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPreflightProbe, parsePreflightInventory } from "./preflight";
function fixture(
  options: {
    memory?: number;
    crash?: string;
    container?: boolean;
    mount?: string;
    rootType?: string;
    virt?: string;
    curl?: number;
    runner?: boolean;
    secureBoot?: boolean;
    missingCurl?: boolean;
    unsafeType?: boolean;
    bulkMounts?: boolean;
    lsblkFails?: boolean;
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), "read-only-preflight-")),
    bin = join(dir, "bin");
  mkdirSync(bin);
  const executable = (name: string, text: string) =>
    writeFileSync(join(bin, name), "#!/bin/bash\n" + text + "\n", {
      mode: 0o755,
    });
  for (const x of [
    "bash",
    "awk",
    "sed",
    "wc",
    "tr",
    "cat",
    "grep",
    "sha256sum",
  ])
    symlinkSync("/usr/bin/" + x, join(bin, x));
  executable("hostname", 'printf "fixture-linux\\n"');
  executable("id", 'printf "0\\n"');
  executable("uname", 'printf "x86_64\\n"');
  executable("getconf", 'printf "2\\n"');
  executable("findmnt", 'printf "/dev/vda1\\n"');
  executable(
    "systemd-detect-virt",
    `printf '%s\\n' '${options.virt || "kvm"}'`
  );
  executable(
    "lsblk",
    `case "$*" in
 *'PATH,TYPE'*) printf '/dev/vda1 part\\n/dev/vda disk\\n';;
 *'MOUNTPOINT'*) ${options.lsblkFails ? "exit 1" : options.bulkMounts ? "printf '/home\\n'; i=0; while [ \"$i\" -lt 10000 ]; do printf '/\\n'; i=$((i+1)); done" : "printf '%s\\n' '" + (options.mount || "/") + "'"};;
 *'SERIAL'*) printf 'fixture-serial\\n';;
 *'SIZE'*) printf '85899345920\\n';;
 '-rn -o TYPE /dev/vda') ${options.lsblkFails ? "exit 1" : options.unsafeType ? "printf 'lvm\\n'; i=0; while [ \"$i\" -lt 10000 ]; do printf 'part\\n'; i=$((i+1)); done" : "printf 'disk\\npart\\n'"};;
 *'TYPE /dev/vda1') printf '%s\\n' '${options.rootType || "part"}';;
 *'TYPE /dev/vda') printf 'disk\\n';;
 *) exit 2;; esac`
  );
  if (!options.missingCurl) executable("curl", `exit ${options.curl || 0}`);
  if (options.runner !== false) {
    executable("setsid", "exit 0");
    executable("nohup", "exit 0");
  }
  if (options.secureBoot)
    executable("mokutil", 'printf "SecureBoot enabled\\n"');
  const mem = join(dir, "meminfo"),
    crash = join(dir, "crash"),
    pid = join(dir, "pid1");
  writeFileSync(mem, `MemTotal: ${options.memory ?? 3_700_000} kB\n`);
  writeFileSync(crash, (options.crash ?? "268435456") + "\n");
  writeFileSync(pid, "fixture-init\n");
  if (options.container) writeFileSync(join(dir, "container"), "");
  let probe = buildPreflightProbe("https://fixture.example.com");
  for (const [a, b] of [
    ["/proc/meminfo", mem],
    ["/sys/kernel/kexec_crash_size", crash],
    ["/proc/1/comm", pid],
    ["/.dockerenv", join(dir, "container")],
    ["/run/.containerenv", join(dir, "not-container")],
    ["/proc/vz", join(dir, "no-vz")],
    ["/sys/firmware/efi", join(dir, "no-efi")],
  ])
    probe = probe.replaceAll(a, b);
  const result = spawnSync("/bin/sh", ["-c", "exec bash -s"], {
    input: probe,
    encoding: "utf8",
    env: { PATH: bin, LANG: "C" },
  });
  rmSync(dir, { recursive: true, force: true });
  return result;
}
describe("Actual fixed read-only preflight shell execution", () => {
  it("executes Bash stdin correctly even when the SSH login shell is POSIX sh", () => {
    const r = fixture();
    expect(r.status, r.stderr).toBe(0);
    expect(parsePreflightInventory(r.stdout)).toMatchObject({
      disk: "/dev/vda",
      runner: "detached",
      root: true,
    });
  });
  it("accepts invalid crash reservation as zero exactly like the retained installer", () => {
    const r = fixture({ memory: 3_900_000, crash: "not-a-number" });
    expect(r.status, r.stderr).toBe(0);
    expect(parsePreflightInventory(r.stdout).crashReservedBytes).toBe(0);
  });
  it("rejects an actual low-memory fixture with specific measured diagnostics", () => {
    const r = fixture({ memory: 3_000_000, crash: "0" });
    expect(() => parsePreflightInventory(r.stdout)).toThrow(
      "3000000 KiB usable"
    );
  });
  it.each([
    [{ rootType: "lvm" }, "PREFLIGHT_DISK_UNSUPPORTED"],
    [{ container: true }, "PREFLIGHT_VIRTUALIZATION_UNSUPPORTED"],
    [{ virt: "lxc" }, "PREFLIGHT_VIRTUALIZATION_UNSUPPORTED"],
    [{ mount: "/home" }, "PREFLIGHT_DATA_MOUNTS"],
    [{ secureBoot: true }, "PREFLIGHT_SECURE_BOOT_ENABLED"],
    [{ missingCurl: true }, "PREFLIGHT_TOOL_MISSING"],
    [{ curl: 60 }, "PREFLIGHT_HTTPS_UNREACHABLE"],
    [{ runner: false }, "PREFLIGHT_RUNNER_UNAVAILABLE"],
  ] as const)("fails safely for actual fixture %s", (o, c) => {
    const r = fixture(o);
    expect(r.status, r.stderr).toBe(0);
    try {
      parsePreflightInventory(r.stdout);
      throw new Error("Unexpected pass");
    } catch (e) {
      expect(e).toMatchObject({ code: c });
    }
  });
  it.each([
    [{ unsafeType: true }, "PREFLIGHT_DISK_UNSUPPORTED"],
    [{ bulkMounts: true }, "PREFLIGHT_DATA_MOUNTS"],
    [{ lsblkFails: true }, "PREFLIGHT_DISK_UNSUPPORTED"],
  ] as const)(
    "large or failed disk read stays blocked: %s",
    (options, code) => {
      const result = fixture(options);
      expect(result.status, result.stderr).toBe(0);
      try {
        parsePreflightInventory(result.stdout);
        throw new Error("Unexpected pass");
      } catch (error) {
        expect(error).toMatchObject({ code });
      }
    }
  );
});
