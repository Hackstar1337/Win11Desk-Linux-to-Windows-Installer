import type { TargetInventory } from "@shared/remoteInstall";
import {
  RemoteSshError,
  executeFixedCommand,
  type TargetSession,
  type RemoteSshErrorCode,
} from "./sshClient.js";

const PREFLIGHT_TIMEOUT = 20_000;
const PREFLIGHT_OUTPUT = 128 * 1024;
function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function safeOrigin(value: string): string {
  try {
    const p = new URL(value);
    if (
      p.protocol !== "https:" ||
      p.username ||
      p.password ||
      p.hash ||
      p.search ||
      p.pathname !== "/" ||
      !p.hostname ||
      /[\0\r\n\x20'"`$;|&<>\\]/.test(value)
    )
      throw new Error();
    return p.origin;
  } catch {
    throw new RemoteSshError("PREFLIGHT_ORIGIN_INVALID");
  }
}

/** Fixed read-only source, transmitted to bash stdin, never an arbitrary user command. */
export function buildPreflightProbe(origin: string): string {
  const safe = safeOrigin(origin);
  return String.raw`set -euo pipefail
emit() { printf '%s=%s\n' "$1" "$2"; }
reject() { emit preflightError "$1"; exit 0; }
for c in hostname id uname awk getconf findmnt lsblk sed wc tr cat grep sha256sum curl; do command -v "$c" >/dev/null 2>&1 || { emit missing "$c"; reject PREFLIGHT_TOOL_MISSING; }; done
HOST=$(hostname)
ROOT_UID=$(id -u)
ARCH=$(uname -m)
VIRT=none
if command -v systemd-detect-virt >/dev/null 2>&1; then VIRT=$(systemd-detect-virt 2>/dev/null || true); fi
if [ -z "$VIRT" ]; then VIRT=none; fi
if [ -e /.dockerenv ] || [ -e /run/.containerenv ] || [ -d /proc/vz ]; then VIRT=container; fi
case "$VIRT" in none|kvm|qemu|vmware|microsoft|oracle|xen) ;; *) reject PREFLIGHT_VIRTUALIZATION_UNSUPPORTED;; esac
RAM_KIB=$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo)
CRASH_BYTES=0
if [ -r /sys/kernel/kexec_crash_size ]; then read -r CRASH_BYTES < /sys/kernel/kexec_crash_size || true; fi
case "$CRASH_BYTES" in ''|*[!0-9]*) CRASH_BYTES=0;; esac
NOMINAL_KIB=$((RAM_KIB + CRASH_BYTES / 1024))
CORES=$(getconf _NPROCESSORS_ONLN)
ROOT_SOURCE=$(findmnt -n -o SOURCE /)
case "$ROOT_SOURCE" in /dev/*) ;; *) reject PREFLIGHT_DISK_UNSUPPORTED;; esac
ROOT_TYPE=$(lsblk -dn -o TYPE "$ROOT_SOURCE" 2>/dev/null || true)
[ "$ROOT_TYPE" = part ] || [ "$ROOT_TYPE" = disk ] || reject PREFLIGHT_DISK_UNSUPPORTED
DISKS=$(lsblk -s -nr -o PATH,TYPE "$ROOT_SOURCE" | awk '$2 == "disk" {print $1}')
[ "$(printf '%s\n' "$DISKS" | sed '/^$/d' | wc -l)" = 1 ] || reject PREFLIGHT_DISK_AMBIGUOUS
DISK=$(printf '%s\n' "$DISKS" | sed -n '1p')
[ "$(lsblk -dn -o TYPE "$DISK")" = disk ] || reject PREFLIGHT_DISK_UNSUPPORTED
DISK_TYPES=$(lsblk -rn -o TYPE "$DISK") || reject PREFLIGHT_DISK_UNSUPPORTED
if printf '%s\n' "$DISK_TYPES" | grep -E '^(crypt|lvm|raid.*)$' >/dev/null; then reject PREFLIGHT_DISK_UNSUPPORTED; fi
DISK_MOUNTS=$(lsblk -rn -o MOUNTPOINT "$DISK") || reject PREFLIGHT_DISK_UNSUPPORTED
if printf '%s\n' "$DISK_MOUNTS" | grep -E '^/' | grep -vE '^(/|/boot|/boot/efi)$' >/dev/null; then reject PREFLIGHT_DATA_MOUNTS; fi
DISK_BYTES=$(lsblk -bdn -o SIZE "$DISK" | tr -d ' ')
DISK_SERIAL=$(lsblk -dn -o SERIAL "$DISK" | sed -n '1p')
[ -n "$DISK_BYTES" ] || reject PREFLIGHT_DISK_UNSUPPORTED
if [ -d /sys/firmware/efi ]; then BOOT=uefi; else BOOT=bios-or-unknown; fi
if command -v mokutil >/dev/null 2>&1; then
  SECURE_BOOT=$(mokutil --sb-state 2>/dev/null || true)
  case "$SECURE_BOOT" in *'SecureBoot enabled'*) reject PREFLIGHT_SECURE_BOOT_ENABLED;; esac
fi
SYSTEMD=0
if command -v systemd-run >/dev/null 2>&1; then [ "$(cat /proc/1/comm 2>/dev/null || true)" = systemd ] && SYSTEMD=1; fi
DETACHED=0
(command -v setsid >/dev/null 2>&1 && command -v nohup >/dev/null 2>&1) && DETACHED=1
emit hostname "$HOST"
emit root "$ROOT_UID"
emit architecture "$ARCH"
emit virtualization "$VIRT"
emit memoryKiB "$RAM_KIB"
emit nominalMemoryKiB "$NOMINAL_KIB"
emit crashReservedBytes "$CRASH_BYTES"
emit cpuCount "$CORES"
emit disk "$DISK"
emit diskBytes "$DISK_BYTES"
emit diskSerial "$DISK_SERIAL"
emit bootMode "$BOOT"
if [ "$SYSTEMD" = 1 ]; then emit runner systemd; elif [ "$DETACHED" = 1 ]; then emit runner detached; else emit runner none; fi
HTTPS=0
curl --proto '=https' --tlsv1.2 --fail --silent --head --connect-timeout 5 --max-time 12 ${bashQuote(safe)} -o /dev/null && HTTPS=1 || true
emit httpsReachable "$HTTPS"
`;
}
const probeCodes = new Set<RemoteSshErrorCode>([
  "PREFLIGHT_TOOL_MISSING",
  "PREFLIGHT_VIRTUALIZATION_UNSUPPORTED",
  "PREFLIGHT_DISK_UNSUPPORTED",
  "PREFLIGHT_DISK_AMBIGUOUS",
  "PREFLIGHT_DATA_MOUNTS",
  "PREFLIGHT_SECURE_BOOT_ENABLED",
]);
function parseFields(stdout: string): Map<string, string> {
  const f = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at),
      value = line.slice(at + 1);
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
      value.includes("\0") ||
      f.has(key)
    )
      throw new RemoteSshError("PROTOCOL_ERROR");
    f.set(key, value);
  }
  return f;
}
function required(f: Map<string, string>, k: string): string {
  const v = f.get(k);
  if (v === undefined || v === "")
    throw new RemoteSshError("PREFLIGHT_OUTPUT_INVALID");
  return v;
}
function integer(f: Map<string, string>, k: string): number {
  const v = required(f, k);
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n))
    throw new RemoteSshError("PROTOCOL_ERROR");
  return n;
}
/** Allows only measured, validated evidence into errors; never raw remote stderr. */
export function parsePreflightInventory(stdout: string): TargetInventory {
  const f = parseFields(stdout);
  if (f.has("preflightError")) {
    const code = f.get("preflightError") as RemoteSshErrorCode;
    if (!probeCodes.has(code))
      throw new RemoteSshError("PREFLIGHT_OUTPUT_INVALID");
    if (code === "PREFLIGHT_TOOL_MISSING") {
      const missing = f.get("missing");
      const tools = [
        "hostname",
        "id",
        "uname",
        "awk",
        "getconf",
        "findmnt",
        "lsblk",
        "sed",
        "wc",
        "tr",
        "cat",
        "grep",
        "sha256sum",
        "curl",
      ];
      if (missing && tools.includes(missing))
        throw new RemoteSshError(
          code,
          `Required Linux tool is missing: ${missing}. Install it through the Linux package manager, then check the target again. No installation started.`
        );
    }
    throw new RemoteSshError(code);
  }
  const root = integer(f, "root"),
    architecture = required(f, "architecture"),
    virtualization = required(f, "virtualization");
  if (root !== 0) throw new RemoteSshError("PREFLIGHT_ROOT_REQUIRED");
  if (architecture !== "x86_64")
    throw new RemoteSshError("PREFLIGHT_ARCH_UNSUPPORTED");
  if (
    !["none", "kvm", "qemu", "vmware", "microsoft", "oracle", "xen"].includes(
      virtualization
    )
  )
    throw new RemoteSshError("PREFLIGHT_VIRTUALIZATION_UNSUPPORTED");
  const usable = integer(f, "memoryKiB"),
    nominal = integer(f, "nominalMemoryKiB"),
    reserved = integer(f, "crashReservedBytes");
  if (nominal !== usable + Math.floor(reserved / 1024))
    throw new RemoteSshError("PROTOCOL_ERROR");
  if (usable < 1_000_000 || nominal < 3_900_000)
    throw new RemoteSshError(
      "PREFLIGHT_MEMORY_INSUFFICIENT",
      `Insufficient memory: ${usable} KiB usable, ${nominal} KiB nominal including crash reservation. The installer requires at least 1000000 KiB usable and 3900000 KiB nominal (approximately 4 GB). No installation started.`
    );
  const cpuCount = integer(f, "cpuCount"),
    diskBytes = integer(f, "diskBytes");
  if (cpuCount < 2)
    throw new RemoteSshError(
      "PREFLIGHT_CPU_INSUFFICIENT",
      `The VPS reports ${cpuCount} CPU core(s); at least 2 are required. No installation started.`
    );
  if (diskBytes < 64_000_000_000)
    throw new RemoteSshError(
      "PREFLIGHT_DISK_TOO_SMALL",
      `The selected system disk is ${diskBytes} bytes; at least 64000000000 bytes (64 GB) are required. No installation started.`
    );
  const disk = required(f, "disk"),
    hostname = required(f, "hostname");
  if (!/^\/dev\/(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme[0-9]+n[0-9]+)$/.test(disk))
    throw new RemoteSshError("PREFLIGHT_DISK_UNSUPPORTED");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/.test(hostname))
    throw new RemoteSshError("PREFLIGHT_HOSTNAME_INVALID");
  const runner = required(f, "runner");
  if (runner !== "systemd" && runner !== "detached")
    throw new RemoteSshError("PREFLIGHT_RUNNER_UNAVAILABLE");
  if (f.get("httpsReachable") !== "1")
    throw new RemoteSshError("PREFLIGHT_HTTPS_UNREACHABLE");
  const diskSerial = f.get("diskSerial") || null;
  if (diskSerial && !/^[\x20-\x7e]{1,256}$/.test(diskSerial))
    throw new RemoteSshError("PROTOCOL_ERROR");
  const bootMode = required(f, "bootMode");
  if (!["uefi", "bios-or-unknown"].includes(bootMode))
    throw new RemoteSshError("PROTOCOL_ERROR");
  return {
    hostname,
    architecture,
    root: true,
    virtualization,
    memoryMiB: Math.floor(usable / 1024),
    nominalMemoryMiB: Math.floor(nominal / 1024),
    crashReservedBytes: reserved,
    cpuCount,
    disk,
    diskBytes,
    diskSerial,
    bootMode,
    runner,
    httpsReachable: true,
    checkedAt: new Date().toISOString(),
  };
}
export async function preflightTarget(
  session: TargetSession,
  origin: string
): Promise<TargetInventory> {
  const probe = buildPreflightProbe(origin);
  let result;
  try {
    result = await executeFixedCommand(session, "bash -s", {
      input: probe,
      timeoutMs: PREFLIGHT_TIMEOUT,
      maxOutputBytes: PREFLIGHT_OUTPUT,
    });
  } catch (error) {
    if (
      error instanceof RemoteSshError &&
      ["TIMEOUT", "OUTPUT_LIMIT"].includes(error.code)
    )
      throw error;
    throw new RemoteSshError("PREFLIGHT_EXECUTION_FAILED");
  }
  return parsePreflightInventory(result.stdout);
}
