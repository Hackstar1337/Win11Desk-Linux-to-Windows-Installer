import {
  postInstallStartupScript,
  postInstallRegistrationScript,
} from "./postInstallStartup";
import type { PostInstallPlan, PostInstallPayload } from "./postInstall";
import { postInstallWorker } from "./postInstallWorker";
import { z } from "zod";
import { getOs, osCatalog, type OsDefinition } from "./deploymentProfiles";

export const trackingConfigSchema = z
  .object({
    origin: z
      .string()
      .url()
      .refine(v => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          u.origin === v &&
          !u.username &&
          !u.password
        );
      }),
    groupId: z.string().uuid(),
    writeToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type InstallerTrackingConfig = z.infer<typeof trackingConfigSchema>;
const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";

export function trackingShell(config: InstallerTrackingConfig) {
  const t = trackingConfigSchema.parse(config);
  return `TRACK_ORIGIN=${quote(t.origin)}
TRACK_GROUP=${quote(t.groupId)}
TRACK_GROUP_TOKEN=${quote(t.writeToken)}
TRACK_RUN=''
TRACK_TOKEN=''
TRACK_EXECUTION=$(cat /proc/sys/kernel/random/uuid)
track_report() {
  [[ -n "$TRACK_RUN" && -n "$TRACK_TOKEN" ]] || return 0
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 5 --max-time 12 --retry 1 -H "Authorization: Bearer $TRACK_TOKEN" -H 'Content-Type: application/json' --data "{\\"stage\\":\\"$1\\"}" "$TRACK_ORIGIN/api/installer/tracking/runs/$TRACK_RUN/events" -o /dev/null 2>/dev/null || true
}
track_start() {
  local response address
  address=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p' | head -1) || true
  [[ "$ACTUAL_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$ ]] || fail 'Hostname cannot be represented safely for tracking.'
  response=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 10 --max-time 30 --retry 2 -H "Authorization: Bearer $TRACK_GROUP_TOKEN" -H 'Content-Type: application/json' --data "{\\"executionId\\":\\"$TRACK_EXECUTION\\",\\"hostname\\":\\"$ACTUAL_HOST\\",\\"disk\\":\\"$TARGET_DISK\\",\\"rdpPort\\":$RDP_PORT,\\"publicIP\\":\\"$address\\"}" "$TRACK_ORIGIN/api/installer/tracking/$TRACK_GROUP/runs") || fail 'Tracker unavailable; installation has not started. Try a fresh script when the website is online.'
  TRACK_RUN=$(printf '%s' "$response" | sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\\([a-f0-9-]*\\)".*/\\1/p')
  TRACK_TOKEN=$(printf '%s' "$response" | sed -n 's/.*"reportToken"[[:space:]]*:[[:space:]]*"\\([a-f0-9]*\\)".*/\\1/p')
  [[ "$TRACK_RUN" =~ ^[a-f0-9-]{36}$ && "$TRACK_TOKEN" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid tracker registration; no boot settings changed.'
  unset TRACK_GROUP_TOKEN response
  track_report preflight
  printf 'Tracking registered: run %s. Open the private tracker link from the dashboard.\\n' "$TRACK_RUN"
  trap 'track_report failed' ERR
}
`;
}

function resolveTrackingOs(value?: string | OsDefinition): OsDefinition {
  if (!value) return getOs("windows-11-pro");
  if (typeof value !== "string") return value;
  const os = osCatalog.find(
    candidate =>
      candidate.id === value ||
      candidate.name === value ||
      candidate.imageName === value
  );
  if (!os) throw new Error("Unsupported operating system.");
  return os;
}

function psLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function windowsReporter(
  origin: string,
  run: string,
  token: string,
  port: string,
  selectedOs?: string | OsDefinition,
  postInstall?: PostInstallPlan,
  retryStartup = false
) {
  const os = resolveTrackingOs(selectedOs);
  const editions = os.editions.map(psLiteral).join(", ");
  const installationType = psLiteral(os.installationType);
  // Values supplied at runtime are canonical HTTPS origin / UUID / hex token / numeric port.
  return `$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$uri = '${origin}/api/installer/tracking/runs/${run}/events'
$headers = @{ Authorization = 'Bearer ${token}' }
$expectedEditions = @(${editions})
$expectedMinBuild = ${os.minBuild}
$expectedMaxBuild = ${os.maxBuild}
$expectedInstallationType = ${installationType}
${
  retryStartup
    ? `$postRegistration = Join-Path $env:SystemDrive 'win11desk-post-register.ps1'
$postStateDir = Join-Path $env:ProgramData 'Win11Desk\\PostInstall\\${run}'
$postRegisteredMarker = Join-Path $postStateDir 'task-registered.marker'
`
    : ""
}${postInstall ? "$postReadyReported = $false\n" : ""}for ($attempt=0; $attempt -lt 60; $attempt++) {
${
  retryStartup
    ? `  if (-not (Test-Path -LiteralPath $postRegisteredMarker)) {
    try { & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $postRegistration *> $null } catch { }
  }
`
    : ""
}  try {
    $v = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
    $build = [int]$v.CurrentBuildNumber
    $installation = [string]$v.InstallationType
    $editionOk = $expectedEditions -contains [string]$v.EditionID
    $buildOk = $build -ge $expectedMinBuild -and $build -le $expectedMaxBuild
    $installationOk = $installation -eq $expectedInstallationType
    $proofOk = $editionOk -and $buildOk -and $installationOk
    $ready = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).Count -gt 0
    # For the default profile this remains equivalent to $v.EditionID -ne 'Professional'.
    $stage = if (-not $proofOk) { 'failed' } elseif ($ready) { 'windows_ready' } else { 'windows_booted' }
    $body = @{ stage=$stage; windowsEdition=[string]$v.EditionID; windowsBuild=$build; windowsInstallationType=$installation; rdpListening=$ready } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 12 | Out-Null
${postInstall ? "    if ($stage -eq 'windows_ready') { $postReadyReported = $true }\n" : ""}    if ($stage -eq 'windows_ready' -or $stage -eq 'failed') { break }
  } catch { }
  Start-Sleep -Seconds 15
}
${
  postInstall
    ? `if ($postReadyReported) {
 $origin = '${origin}'
 $run = '${run}'
 try {
${postInstallWorker(postInstall)}
 } catch { Write-Warning 'Post-install worker could not finish; Windows-ready result is unchanged.' }
}
`
    : ""
}${
    retryStartup
      ? `if (-not (Test-Path -LiteralPath $postRegisteredMarker)) {
  try {
    $deadline = Get-Content -LiteralPath (Join-Path $postStateDir 'deadline.json') -Raw | ConvertFrom-Json
    if ([DateTime]::UtcNow -ge [DateTime]::Parse([string]$deadline.deadlineUtc).ToUniversalTime()) {
      Disable-ScheduledTask -TaskName 'Win11DeskReport' -ErrorAction SilentlyContinue | Out-Null
    } else {
      # Native fallback survives registration/CIM startup failure; next invocation retries.
      $taskCommand = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
      & "$env:SystemRoot\\System32\\schtasks.exe" /Create /TN Win11DeskReport /SC MINUTE /MO 2 /RU SYSTEM /RL HIGHEST /TR $taskCommand /F *> $null
    }
  } catch { }
  return
}
`
      : ""
  }Unregister-ScheduledTask -TaskName 'Win11DeskReport' -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`;
}

export function alpineReporter(origin: string, run: string, token: string) {
  return `#!/bin/ash
# Only safe HTTP status diagnostics; no settings, tokens or raw logs printed.
TRACK_EVENT_URL='${origin}/api/installer/tracking/runs/${run}/events'
TRACK_HEARTBEAT_URL='${origin}/api/installer/tracking/runs/${run}/heartbeat'
TRACK_AUTH='Bearer ${token}'
TRACK_HEARTBEAT_PID=''
track_send() {
  local url="$1" body="$2" attempt status
  for attempt in 1 2 3; do
    if command -v curl >/dev/null 2>&1; then
      if status=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --connect-timeout 5 --max-time 12 -H "Authorization: $TRACK_AUTH" -H 'Content-Type: application/json' --data "$body" "$url" -o /dev/null -w '%{http_code}' 2>/dev/null); then
        case "$status" in 200|201|204) return 0;; 400|401|403|404|410) break;; esac
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q -T 12 --header="Authorization: $TRACK_AUTH" --header='Content-Type: application/json' --post-data="$body" -O /dev/null "$url" 2>/dev/null; then return 0; fi
      status='wget-failed'
    else
      status='no-HTTPS-client'; break
    fi
    [ "$attempt" = 3 ] || sleep 2
  done
  printf 'TRACKING: HTTPS callback unavailable (%s); installer status has not been confirmed by dashboard.\\n' "$status" >&2
  return 1
}
track_stop() {
  if [ -n "$TRACK_HEARTBEAT_PID" ]; then kill "$TRACK_HEARTBEAT_PID" 2>/dev/null || true; TRACK_HEARTBEAT_PID=''; fi
}
track_report() {
  local terminal_attempt
  case "$1" in failed|windows_setup)
    # Keep liveness while the final report retries; no silent stop before delivery.
    for terminal_attempt in 1 2 3 4 5 6; do
      if track_send "$TRACK_EVENT_URL" "{\\"stage\\":\\"$1\\"}"; then track_stop; return 0; fi
      [ "$terminal_attempt" = 6 ] || sleep 5
    done
    track_stop
    echo 'TRACKING: final handoff/error report could not be delivered after bounded retries; dashboard outcome remains unknown.' >&2
    return 0;;
  esac
  track_send "$TRACK_EVENT_URL" "{\\"stage\\":\\"$1\\"}" || true
}
track_prepare() {
  # Network and upstream time synchronization have already run at this hook.
  if ! command -v curl >/dev/null 2>&1 || [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
    if ! apk add --no-cache curl ca-certificates >/dev/null 2>&1; then
      echo 'TRACKING: curl/CA preparation failed; trying available HTTPS wget without weakening certificate checks.' >&2
    fi
  fi
  command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates >/dev/null 2>&1 || true
}
track_progress() {
  local downloaded="$1" total="$2" phase="$3"
  case "$downloaded" in ''|*[!0-9]*) return 0;; esac
  # Zero is the explicit indeterminate-size representation; never invent a denominator.
  case "$total" in ''|*[!0-9]*) total=0;; esac
  if [ "$total" -eq 0 ]; then
    track_send "$TRACK_EVENT_URL" "{\\"stage\\":\\"downloading\\",\\"phase\\":\\"$phase\\",\\"downloadedBytes\\":$downloaded}" || true
  else
    track_send "$TRACK_EVENT_URL" "{\\"stage\\":\\"downloading\\",\\"phase\\":\\"$phase\\",\\"downloadedBytes\\":$downloaded,\\"totalBytes\\":$total}" || true
  fi
}
track_start_heartbeat() {
  [ -z "$TRACK_HEARTBEAT_PID" ] || return 0
  # Bounded per-execution process, not a recurring external scheduler. Stops at handoff/failure.
  (
    index=0
    while [ "$index" -lt 720 ]; do
      sleep 15
      track_send "$TRACK_HEARTBEAT_URL" '{}' || true
      index=$((index + 1))
    done
  ) &
  TRACK_HEARTBEAT_PID=$!
}
`;
}

export function trackingPatchShell(
  selectedOs?: string | OsDefinition,
  selectedImageName?: string,
  payload?: PostInstallPayload
) {
  const os = resolveTrackingOs(selectedOs);
  const imageName = selectedImageName ?? os.imageName;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .()_-]{0,159}$/.test(imageName))
    throw new Error("Selected image name is invalid.");
  // Runs only against already SHA-verified local copies, before initramfs boot staging.
  return `# Persist reporter files into verified temporary installer and Windows setup hooks.
TRACK_FILES="$WORK/tracking"
mkdir -p "$TRACK_FILES"; chmod 700 "$TRACK_FILES"
cat > "$TRACK_FILES/report.sh" <<TRACKSH
${alpineReporter("$TRACK_ORIGIN", "$TRACK_RUN", "$TRACK_TOKEN").replaceAll("$", "\\$").replaceAll("\\$TRACK_ORIGIN", "$TRACK_ORIGIN").replaceAll("\\$TRACK_RUN", "$TRACK_RUN").replaceAll("\\$TRACK_TOKEN", "$TRACK_TOKEN")}
TRACKSH
cat > "$TRACK_FILES/windows-report.ps1" <<WINPS
${windowsReporter("$TRACK_ORIGIN", "$TRACK_RUN", "$TRACK_TOKEN", "$RDP_PORT", os, undefined, !!payload).replaceAll("$", "\\$").replaceAll("\\$TRACK_ORIGIN", "$TRACK_ORIGIN").replaceAll("\\$TRACK_RUN", "$TRACK_RUN").replaceAll("\\$TRACK_TOKEN", "$TRACK_TOKEN").replaceAll("\\$RDP_PORT", "$RDP_PORT")}
WINPS
${
  payload
    ? `cat > "$TRACK_FILES/win11desk-post.ps1" <<WINPOST
${postInstallStartupScript("$TRACK_ORIGIN", "$TRACK_RUN", "$TRACK_TOKEN", "$RDP_PORT", os, payload.plan).replaceAll("$", "\\$").replaceAll("\\$TRACK_ORIGIN", "$TRACK_ORIGIN").replaceAll("\\$TRACK_RUN", "$TRACK_RUN").replaceAll("\\$TRACK_TOKEN", "$TRACK_TOKEN").replaceAll("\\$RDP_PORT", "$RDP_PORT")}
WINPOST
cat > "$TRACK_FILES/win11desk-post-register.ps1" <<WINREG
${postInstallRegistrationScript("$TRACK_RUN").replaceAll("$", "\\$").replaceAll("\\$TRACK_RUN", "$TRACK_RUN")}
WINREG
`
    : ""
}# Bounded SYSTEM task survives SetupComplete/GPO teardown; removes itself after reporting retries.
cat > "$TRACK_FILES/windows-report.bat" <<'WINBAT'
@echo off
${
  payload
    ? `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SystemDrive%\\win11desk-post-register.ps1"
if errorlevel 1 echo Win11Desk: optional startup registration failed; inspect protected local bootstrap status.
`
    : ""
}schtasks /Create /TN "Win11DeskReport" /SC ONSTART /RU SYSTEM /TR "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File %SystemDrive%\\win11desk-report.ps1" /F
if errorlevel 1 (
  powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SystemDrive%\\win11desk-report.ps1"
) else (
  schtasks /Run /TN "Win11DeskReport"
)
del "%~f0"
WINBAT
${
  payload?.scriptBase64
    ? `command -v base64 >/dev/null || fail 'Attached script staging requires base64.'
base64 -d > "$TRACK_FILES/win11desk-attached.bat" <<'ATTACHED_BYTES'
${payload.scriptBase64.match(/.{1,76}/g)!.join("\n")}
ATTACHED_BYTES
printf '%s  %s\\n' '${payload.plan.script!.sha256}' "$TRACK_FILES/win11desk-attached.bat" | sha256sum --check --status || fail 'Attached script integrity failed.'
`
    : ""
}chmod 600 "$TRACK_FILES/"*
CONFIG_LINE='    mkdir -p $initrd_dir/configs'
grep -Fxq "$CONFIG_LINE" "$WORK/reinstall.sh" || fail 'Pinned initramfs configuration hook changed.'
awk '{ print } $0 == "    mkdir -p $initrd_dir/configs" { print "    cp /root/win11desk/tracking/* $initrd_dir/configs/" }' "$WORK/reinstall.sh" > "$WORK/reinstall.tracked.sh"
mv "$WORK/reinstall.tracked.sh" "$WORK/reinstall.sh"
# Prefix helper before error function definitions, using marker checks instead of approximate offsets.
grep -Fxq 'error_and_exit() {' "$WORK/trans.sh" || fail 'Pinned error hook changed.'
grep -Fq 'trap_err $LINENO $?' "$WORK/trans.sh" || fail 'Pinned terminal-error trap changed.'
grep -Fxq 'sync_time || true' "$WORK/trans.sh" || fail 'Pinned network/time tracking hook changed.'
grep -Fxq 'trans() {' "$WORK/trans.sh" || fail 'Pinned stage hook changed.'
grep -Fxq '    download $iso /os/windows.iso' "$WORK/trans.sh" || fail 'Pinned ISO hook changed.'
grep -Fxq '    # 5. 设置用户密码永不过期（仅限 iso 安装）' "$WORK/trans.sh" || fail 'Pinned Windows startup hook changed.'
awk '
index($0, "trap_err $LINENO $?") && index($0, "trap ") == 1 { printf "trap %cret=$?; track_report failed; trap_err $LINENO $ret%c ERR\\n", 39, 39; next }
$0 == "    download $iso /os/windows.iso" { print "    track_report downloading" }
$0 == "            file=/image-name" { print "            error_and_exit \\"${os.id === "windows-11-pro" ? "Required Windows 11 Pro image missing; use correct media." : "Required selected Windows image missing; use correct media."}\\"" }
$0 == "reboot" { print "track_report windows_setup" }
{ print }
$0 == "set -eE" { print ". /configs/report.sh"; print "trap \\"track_report failed\\" ERR" }
$0 == "error_and_exit() {" { print "    track_report failed" }
$0 == "sync_time || true" { print "track_prepare" }
$0 == "trans() {" { print "    track_report installer_booted"; print "    track_start_heartbeat" }
index($0, "sha256sum -c - || error_and_exit ISO_SHA256_MISMATCH") { print "    track_report media_verified"; print "    track_report preparing" }
$0 == "    # 5. 设置用户密码永不过期（仅限 iso 安装）" {
 print "    cp /configs/windows-report.ps1 \\"$os_dir/win11desk-report.ps1\\""
 print "    cp /configs/windows-report.bat \\"$os_dir/windows-report.bat\\""
${payload ? ` print ${JSON.stringify('    cp /configs/win11desk-post.ps1 "$os_dir/win11desk-post.ps1"')}\n print ${JSON.stringify('    cp /configs/win11desk-post-register.ps1 "$os_dir/win11desk-post-register.ps1"')}\n` : ""}${payload?.scriptBase64 ? ` print ${JSON.stringify('    cp /configs/win11desk-attached.bat "$os_dir/win11desk-attached.bat"')}\n` : ""} print "    bats=\\"$bats windows-report.bat\\""
}
' "$WORK/trans.sh" > "$WORK/trans.tracked.sh"
mv "$WORK/trans.tracked.sh" "$WORK/trans.sh"

`;
}
