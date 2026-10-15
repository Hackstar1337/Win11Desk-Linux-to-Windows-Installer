import type { RemoteReceipt, TargetInventory } from "@shared/remoteInstall";
import {
  RemoteSshError,
  executeFixedCommand,
  type TargetSession,
} from "./sshClient.js";

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BOOTSTRAP = 2 * 1024 * 1024;
const RUNNER_TIMEOUT = 20_000;
const RUNNER_OUTPUT = 32 * 1024;

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function checkedJob(jobId: string): void {
  if (!JOB_ID.test(jobId)) throw new RemoteSshError("LAUNCH_FAILED");
}

function expectedValues(expected: TargetInventory): string[] {
  if (
    !/^[-A-Za-z0-9._]+$/.test(expected.hostname) ||
    !/^\/dev\/[A-Za-z0-9._/-]+$/.test(expected.disk) ||
    !/^\d+$/.test(String(expected.diskBytes))
  )
    throw new RemoteSshError("LAUNCH_FAILED");
  if (
    expected.diskSerial !== null &&
    !/^[\x20-\x7e]{1,256}$/.test(expected.diskSerial)
  )
    throw new RemoteSshError("LAUNCH_FAILED");
  if (expected.runner !== "systemd" && expected.runner !== "detached")
    throw new RemoteSshError("LAUNCH_FAILED");
  return [
    expected.hostname,
    expected.disk,
    String(expected.diskBytes),
    expected.diskSerial ?? "",
    expected.runner,
  ];
}

const LAUNCH_SCRIPT = String.raw`set -euo pipefail
b64() { printf '%s' "$1" | base64 -d; }
job=$(b64 "$1")
expected_host=$(b64 "$2")
expected_disk=$(b64 "$3")
expected_size=$(b64 "$4")
expected_serial=$(b64 "$5")
expected_runner=$(b64 "$6")
bootstrap_b64='__BOOTSTRAP_B64__'
case "$job" in [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;; *) exit 31;; esac
[ "$(id -u)" = 0 ] || exit 32
BASE=/root/win11desk-remote
JOB_DIR="$BASE/$job"
LOCK="$BASE/$job.lock"
RECEIPT="$JOB_DIR/receipt"
mkdir -p "$BASE"
chmod 700 "$BASE"
if [ -e "$LOCK" ]; then
  if [ -r "$RECEIPT" ]; then cat "$RECEIPT"; exit 0; fi
  printf 'state=unknown\n'
  exit 0
fi
mkdir "$LOCK" 2>/dev/null || { printf 'state=unknown\n'; exit 0; }
mkdir -p "$JOB_DIR"
chmod 700 "$JOB_DIR"
write_receipt() {
  state=$1
  code=$(if [ "$#" -ge 2 ]; then printf '%s' "$2"; fi)
  tmp="$JOB_DIR/receipt.tmp.$$"
  umask 077
  if [ -n "$code" ]; then printf 'state=%s\nerrorCode=%s\n' "$state" "$code" > "$tmp"; else printf 'state=%s\n' "$state" > "$tmp"; fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$RECEIPT"
}
# Identity and disk checks are deliberately before bootstrap decoding/execution.
[ "$(hostname)" = "$expected_host" ] || { write_receipt failed WRONG_HOST; cat "$RECEIPT"; exit 0; }
root_source=$(findmnt -n -o SOURCE / 2>/dev/null || true)
root_type=$(lsblk -dn -o TYPE "$root_source" 2>/dev/null || true)
case "$root_source" in /dev/*) ;; *) write_receipt failed AMBIGUOUS_ROOT; cat "$RECEIPT"; exit 0;; esac
[ "$root_type" = part ] || [ "$root_type" = disk ] || { write_receipt failed AMBIGUOUS_ROOT; cat "$RECEIPT"; exit 0; }
[ "$(lsblk -dn -o TYPE "$expected_disk" 2>/dev/null || true)" = disk ] || { write_receipt failed WRONG_DISK; cat "$RECEIPT"; exit 0; }
chain=$(lsblk -s -nr -o PATH "$root_source" 2>/dev/null || true)
printf '%s\n' "$chain" | grep -Fxq "$expected_disk" || { write_receipt failed WRONG_DISK; cat "$RECEIPT"; exit 0; }
actual_size=$(lsblk -bdn -o SIZE "$expected_disk" 2>/dev/null | tr -d ' ' || true)
[ "$actual_size" = "$expected_size" ] || { write_receipt failed DISK_SIZE_CHANGED; cat "$RECEIPT"; exit 0; }
if [ -n "$expected_serial" ]; then
  [ "$(lsblk -dn -o SERIAL "$expected_disk" 2>/dev/null | sed -n '1p')" = "$expected_serial" ] || { write_receipt failed DISK_SERIAL_CHANGED; cat "$RECEIPT"; exit 0; }
fi
actual_runner=none
if [ "$(cat /proc/1/comm 2>/dev/null || true)" = systemd ] && command -v systemd-run >/dev/null 2>&1; then actual_runner=systemd; fi
if [ "$actual_runner" = none ] && command -v setsid >/dev/null 2>&1 && command -v nohup >/dev/null 2>&1; then actual_runner=detached; fi
[ "$actual_runner" = "$expected_runner" ] || { write_receipt failed RUNNER_CHANGED; cat "$RECEIPT"; exit 0; }
# An additional host-wide marker blocks a second IP/SSH-port alias targeting the same disk.
if ! mkdir "$BASE/target-install.lock" 2>/dev/null; then
  write_receipt failed TARGET_ALREADY_DISPATCHED
  cat "$RECEIPT"
  exit 0
fi
write_receipt prepared
BOOTSTRAP="$JOB_DIR/bootstrap.sh"
LOG="$JOB_DIR/runner.log"
: > "$LOG"
chmod 600 "$LOG"
if ! printf '%s' "$bootstrap_b64" | base64 -d > "$BOOTSTRAP"; then write_receipt failed INVALID_BOOTSTRAP; cat "$RECEIPT"; exit 0; fi
chmod 700 "$BOOTSTRAP"
SUPERVISOR="$JOB_DIR/supervisor.sh"
cat > "$SUPERVISOR" <<'WIN11DESK_SUPERVISOR'
#!/usr/bin/env bash
set +x
umask 077
JOB_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
exec >>"$JOB_DIR/runner.log" 2>&1
BOOTSTRAP="$JOB_DIR/bootstrap.sh"
RECEIPT="$JOB_DIR/receipt"
printf 'state=launched\n' > "$JOB_DIR/receipt.next"
mv -f "$JOB_DIR/receipt.next" "$RECEIPT"
/bin/bash "$BOOTSTRAP"
code=$?
rm -f "$BOOTSTRAP"
if [ "$code" -ne 0 ]; then
  printf 'state=failed\nerrorCode=INSTALLER_EXITED\n' > "$JOB_DIR/receipt.next"
  mv -f "$JOB_DIR/receipt.next" "$RECEIPT"
fi
exit "$code"
WIN11DESK_SUPERVISOR
chmod 700 "$SUPERVISOR"
# Even the service journal receives only the protected log path, not installer output/capabilities.
if [ "$actual_runner" = systemd ]; then
  if ! systemd-run --unit="win11desk-$job" --service-type=simple /bin/bash "$SUPERVISOR" </dev/null >/dev/null 2>&1; then
    write_receipt failed DETACH_FAILED
  fi
else
  setsid nohup /bin/bash "$SUPERVISOR" </dev/null >"$LOG" 2>&1 &
fi
# Return actual supervisor acknowledgment rather than trusting that background spawning worked.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  grep -Eq '^state=(launched|failed)$' "$RECEIPT" && break
  sleep 0.1
done
cat "$RECEIPT"
`;

function parseReceipt(stdout: string): RemoteReceipt {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1));
  }
  const state = fields.get("state");
  if (
    state !== "absent" &&
    state !== "prepared" &&
    state !== "launched" &&
    state !== "failed" &&
    state !== "unknown"
  )
    return { state: "unknown" };
  const result: RemoteReceipt = { state };
  const code = fields.get("errorCode");
  if (code && /^[A-Z0-9_]{1,64}$/.test(code)) result.errorCode = code;
  return result;
}

export async function launchTarget(
  session: TargetSession,
  jobId: string,
  bootstrap: string,
  expected: TargetInventory
): Promise<RemoteReceipt> {
  checkedJob(jobId);
  if (
    typeof bootstrap !== "string" ||
    bootstrap.length === 0 ||
    bootstrap.length > MAX_BOOTSTRAP ||
    bootstrap.includes("\0")
  )
    throw new RemoteSshError("LAUNCH_FAILED");
  const values = expectedValues(expected);
  const bootstrapB64 = Buffer.from(bootstrap, "utf8").toString("base64");
  const input = LAUNCH_SCRIPT.replace("__BOOTSTRAP_B64__", bootstrapB64);
  // Base64 is shell-safe, but an empty optional serial must remain an argv slot.
  const args = [jobId, ...values].map(value => `'${encoded(value)}'`);
  const command = `bash -s -- ${args.join(" ")}`;
  try {
    const result = await executeFixedCommand(session, command, {
      input,
      timeoutMs: RUNNER_TIMEOUT,
      maxOutputBytes: RUNNER_OUTPUT,
    });
    const receipt = parseReceipt(result.stdout);
    if (receipt.state === "unknown") return receipt;
    return receipt;
  } catch (error) {
    if (
      error instanceof RemoteSshError &&
      (error.code === "TIMEOUT" || error.code === "CHANNEL_FAILED")
    )
      return { state: "unknown" };
    throw error instanceof RemoteSshError
      ? error
      : new RemoteSshError("LAUNCH_UNCERTAIN");
  }
}

const RECONCILE_SCRIPT = String.raw`set -euo pipefail
job=$(printf '%s' "$1" | base64 -d)
case "$job" in [0-9a-fA-F]*-[0-9a-fA-F]*) ;; *) printf 'state=unknown\n'; exit 0;; esac
case "$(id -u)" in 0) ;; *) printf 'state=unknown\n'; exit 0;; esac
base=/root/win11desk-remote
receipt="$base/$job/receipt"
if [ ! -f "$receipt" ]; then
  # Missing receipt alone is not permission to retry a possibly dispatched job.
  if [ -e "$base/$job" ] || [ -e "$base/$job.lock" ] || [ -e "$base/target-install.lock" ]; then
    printf 'state=unknown\n'
  else
    printf 'state=absent\n'
  fi
  exit 0
fi
awk -F= '$1 == "state" || $1 == "errorCode" { if ($0 !~ /[^A-Za-z0-9_=\n]/) print }' "$receipt"
`;

export async function reconcileTarget(
  session: TargetSession,
  jobId: string
): Promise<RemoteReceipt> {
  checkedJob(jobId);
  const command = `bash -s -- ${encoded(jobId)}`;
  try {
    const result = await executeFixedCommand(session, command, {
      input: RECONCILE_SCRIPT,
      timeoutMs: RUNNER_TIMEOUT,
      maxOutputBytes: RUNNER_OUTPUT,
    });
    return parseReceipt(result.stdout);
  } catch (error) {
    if (
      error instanceof RemoteSshError &&
      (error.code === "TIMEOUT" || error.code === "CHANNEL_FAILED")
    )
      return { state: "unknown" };
    throw error instanceof RemoteSshError
      ? error
      : new RemoteSshError("PROTOCOL_ERROR");
  }
}
