import type { PostInstallPlan } from "./postInstall";
import { getOs, osCatalog, type OsDefinition } from "./deploymentProfiles";
import { postInstallWorker } from "./postInstallWorker";

// Tracker IDs can be UUID-shaped SHA256 fragments, without RFC version bits.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACEHOLDERS = new Set([
  "$TRACK_ORIGIN",
  "$TRACK_RUN",
  "$TRACK_TOKEN",
  "$RDP_PORT",
]);

function psLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function runtimeValue(
  value: string,
  kind: "origin" | "run" | "token" | "port"
) {
  if (PLACEHOLDERS.has(value)) return psLiteral(value);
  if (kind === "run" && !UUID_RE.test(value))
    throw new Error("Post-install run must match the tracker run-ID shape.");
  if (kind === "token" && !/^[a-f0-9]{64}$/.test(value))
    throw new Error(
      "Post-install token must be a lowercase hexadecimal capability."
    );
  if (kind === "port" && !/^(?:[1-9][0-9]{0,4})$/.test(value))
    throw new Error("Post-install RDP port must be numeric.");
  if (kind === "origin") {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Post-install origin must be an HTTPS origin.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== value ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Post-install origin must be an HTTPS origin.");
  }
  return psLiteral(value);
}

function resolveStartupOs(value?: string | OsDefinition): OsDefinition {
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

function validatePort(value: string) {
  if (value === "$RDP_PORT") return;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Post-install RDP port must be between 1 and 65535.");
}

/**
 * Generates the executable SYSTEM scheduled-task body. Registration is kept in
 * a separate script so this file never has a registration switch or an action
 * that can be accidentally invoked while staging the script.
 */
export function postInstallStartupScript(
  origin: string,
  run: string,
  token: string,
  port: string,
  selectedOs?: string | OsDefinition,
  plan?: PostInstallPlan
): string {
  if (!plan || (!plan.options.getFiles && !plan.options.runAttachedScript))
    return "";
  const os = resolveStartupOs(selectedOs);
  const psOrigin = runtimeValue(origin, "origin");
  const psRun = runtimeValue(run, "run");
  const psToken = runtimeValue(token, "token");
  const psPort = runtimeValue(port, "port");
  validatePort(port);
  const editions = os.editions.map(psLiteral).join(", ");
  const installationType = psLiteral(os.installationType);
  const worker = postInstallWorker(plan);

  return String.raw`# Win11Desk post-install startup orchestrator (PowerShell 5.1).
# This is the executable task body; registration is intentionally a separate script.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Test-StartupCanonicalRun([string]$value) {
  return $value -cmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
}
function Test-StartupPort([string]$value) {
  $number = 0
  if (-not [int]::TryParse($value, [ref]$number)) { return $false }
  return $number -ge 1 -and $number -le 65535
}
function Write-StartupStatus([string]$stateDir, [string]$status, [string]$reason) {
  $payload = [ordered]@{
    status = $status
    reason = $reason
    updatedUtc = (Get-Date).ToUniversalTime().ToString('o')
  }
  $target = Join-Path $stateDir 'startup-status.json'
  $temporary = $target + '.new'
  $payload | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $target -Force
}
function Get-StartupDeadline([string]$stateDir) {
  $path = Join-Path $stateDir 'deadline.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $now = (Get-Date).ToUniversalTime()
    $record = [ordered]@{ createdUtc = $now.ToString('o'); deadlineUtc = $now.AddHours(24).ToString('o') }
    $record | ConvertTo-Json -Compress | Set-Content -LiteralPath ($path + '.new') -Encoding UTF8
    Move-Item -LiteralPath ($path + '.new') -Destination $path -Force
  }
  try {
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    return [DateTime]::Parse([string]$record.deadlineUtc).ToUniversalTime()
  } catch {
    # A malformed deadline is treated as an expired bootstrap, never extended.
    return [DateTime]::UtcNow.AddSeconds(-1)
  }
}
function Test-StartupReadiness([int]$rdpPort) {
  $reasons = New-Object System.Collections.Generic.List[string]
  try {
    $setup = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\Setup' -ErrorAction Stop
    foreach ($name in @('SystemSetupInProgress','OOBEInProgress','SetupInProgress')) {
      if (($name -eq 'SystemSetupInProgress' -and $null -eq $setup.PSObject.Properties[$name]) -or ($null -ne $setup.PSObject.Properties[$name] -and [int]$setup.$name -ne 0)) {
        [void]$reasons.Add('SETUP_NOT_FINISHED')
      }
    }
  } catch { [void]$reasons.Add('SETUP_NOT_FINISHED') }
  try {
    $version = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    $build = [int]$version.CurrentBuildNumber
    if (@(${editions}) -notcontains [string]$version.EditionID) { [void]$reasons.Add('EDITION_MISMATCH') }
    if ($build -lt ${os.minBuild} -or $build -gt ${os.maxBuild}) { [void]$reasons.Add('BUILD_MISMATCH') }
    if ([string]$version.InstallationType -ne ${installationType}) { [void]$reasons.Add('INSTALLATION_TYPE_MISMATCH') }
  } catch { [void]$reasons.Add('WINDOWS_PROOF_UNAVAILABLE') }
  try {
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $rdpPort -ErrorAction SilentlyContinue)
    if ($listener.Count -eq 0) { [void]$reasons.Add('RDP_NOT_LISTENING') }
  } catch { [void]$reasons.Add('RDP_NOT_LISTENING') }
  try {
    # Local service/readiness checks only; no remote licensing action is performed.
    if (${plan.options.runAttachedScript && !plan.options.getFiles ? "$true" : "$false"}) {
    $spp = Get-Service -Name 'sppsvc' -ErrorAction Stop
    if ($spp.Status -ne 'Running') { Start-Service -Name 'sppsvc' -ErrorAction Stop; $spp = Get-Service -Name 'sppsvc' -ErrorAction Stop }
    if ($spp.Status -ne 'Running') { [void]$reasons.Add('SPPSVC_NOT_READY') }
    }
  } catch { [void]$reasons.Add('SPPSVC_NOT_READY') }
  try {
    $gateway = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -and $_.State -ne 'Unreachable' })
    if ($gateway.Count -eq 0) { [void]$reasons.Add('DEFAULT_GATEWAY_NOT_READY') }
  } catch { [void]$reasons.Add('DEFAULT_GATEWAY_NOT_READY') }
  try {
    $dns = @(Resolve-DnsName -Name 'www.microsoft.com' -ErrorAction Stop)
    if ($dns.Count -eq 0) { [void]$reasons.Add('DNS_NOT_READY') }
  } catch { [void]$reasons.Add('DNS_NOT_READY') }
  if ($reasons.Count -eq 0) { return [pscustomobject]@{ Ready = $true; Reason = 'READY' } }
  return [pscustomobject]@{ Ready = $false; Reason = ($reasons -join ',') }
}
function Send-StartupWindowsReady([string]$originValue, [string]$runValue, $requestHeaders, [int]$rdpPort) {
  # This callback is advisory. Transport failure must never gate the local worker.
  try {
    $version = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    $body = @{ stage = 'windows_ready'; windowsEdition = [string]$version.EditionID; windowsBuild = [int]$version.CurrentBuildNumber; windowsInstallationType = [string]$version.InstallationType; rdpListening = $true } | ConvertTo-Json -Compress
    $uri = ([string]$originValue).TrimEnd('/') + '/api/installer/tracking/runs/' + [string]$runValue + '/events'
    Invoke-RestMethod -Uri $uri -Method Post -Headers $requestHeaders -ContentType 'application/json' -Body $body -TimeoutSec 12 | Out-Null
  } catch { }
}

$origin = ${psOrigin}
$run = ${psRun}
$token = ${psToken}
$headers = @{ Authorization = 'Bearer ' + [string]$token }
$rdpPortText = ${psPort}
$taskName = 'Win11DeskPostInstall-' + [string]$run
$stateDir = Join-Path $env:ProgramData ('Win11Desk\PostInstall\' + [string]$run)
$workerPath = Join-Path $stateDir 'worker.ps1'
$deadlinePath = Join-Path $stateDir 'deadline.json'
$reportDelivered = Join-Path $stateDir 'report-delivered.marker'
$waitPath = Join-Path $stateDir 'WAIT-PENDING.json'
$mutex = $null
try {
  if (-not (Test-StartupCanonicalRun ([string]$run))) { throw 'STARTUP_WORKER_ERROR' }
  $rdpPort = 0
  if (-not [int]::TryParse([string]$rdpPortText, [ref]$rdpPort) -or -not (Test-StartupPort ([string]$rdpPort))) { throw 'STARTUP_WORKER_ERROR' }
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  if (Test-Path -LiteralPath $reportDelivered -PathType Leaf) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-post-register.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-attached.bat') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-post.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workerPath -Force -ErrorAction SilentlyContinue
    return
  }
  $terminalResult = $false
  try {
    $existingState = Get-Content -LiteralPath (Join-Path $stateDir 'state.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    $terminalResult = ($existingState.overallFinal -eq $true)
  } catch { }
  $deadline = Get-StartupDeadline $stateDir
  if ([DateTime]::UtcNow -ge $deadline) {
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
    Write-StartupStatus $stateDir 'EXPIRED' 'DEADLINE_EXPIRED'
    return
  }
  $readiness = if ($terminalResult) { [pscustomobject]@{Ready=$true;Reason='REPORT_RETRY'} } else { Test-StartupReadiness $rdpPort }
  if (-not $readiness.Ready) {
    $pending = [ordered]@{ status = 'PENDING'; reason = [string]$readiness.Reason; updatedUtc = (Get-Date).ToUniversalTime().ToString('o') }
    $pending | ConvertTo-Json -Compress | Set-Content -LiteralPath ($waitPath + '.new') -Encoding UTF8
    Move-Item -LiteralPath ($waitPath + '.new') -Destination $waitPath -Force
    Write-StartupStatus $stateDir 'PENDING' ([string]$readiness.Reason)
    return
  }
  Remove-Item -LiteralPath $waitPath -Force -ErrorAction SilentlyContinue
  $mutex = New-Object Threading.Mutex($false, ('Global\Win11DeskPostInstallStartup-' + [string]$run))
  if (-not $mutex.WaitOne(0)) { return }

  if (-not $terminalResult) { Send-StartupWindowsReady $origin $run $headers $rdpPort }
  # The worker owns its state/result and report-delivered marker. Re-invoking it
  # after a terminal state is safe because it never replays side-effect work.
${worker}
  if (Test-Path -LiteralPath $reportDelivered -PathType Leaf) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-post-register.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-attached.bat') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:SystemDrive 'win11desk-post.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workerPath -Force -ErrorAction SilentlyContinue
  }
} catch {
  try {
    if ($stateDir -and (Test-Path -LiteralPath $stateDir)) { Write-StartupStatus $stateDir 'ERROR' 'STARTUP_WORKER_ERROR' }
  } catch { }
  # Keep the task so the native trigger retries; no reporter task is touched.
} finally {
  if ($null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose() }
}
`;
}

/** Generates the SYSTEM/highest idempotent registration script staged by setup/GPO. */
export function postInstallRegistrationScript(run: string): string {
  const psRun = runtimeValue(run, "run");
  return String.raw`# Win11Desk post-install task registration (PowerShell 5.1).
# Registration only stages/protects the worker and creates the task; it never runs it.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
function Test-StartupCanonicalRun([string]$value) {
  return $value -cmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
}
function Set-StartupAcl([string]$path, [bool]$directory) {
  if ($directory) { $acl = New-Object System.Security.AccessControl.DirectorySecurity }
  else { $acl = New-Object System.Security.AccessControl.FileSecurity }
  $acl.SetAccessRuleProtection($true, $false)
  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  $admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
  if ($directory) {
    $inherit = 'ContainerInherit,ObjectInherit'
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system,'FullControl',$inherit,'None','Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins,'FullControl',$inherit,'None','Allow')))
  } else {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system,'FullControl','None','None','Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins,'FullControl','None','None','Allow')))
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
function Write-RegistrationStatus([string]$stateDir, [string]$reason) {
  try {
    $status = [ordered]@{ status = 'ERROR'; reason = $reason; updatedUtc = (Get-Date).ToUniversalTime().ToString('o') }
    $status | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $stateDir 'startup-status.json') -Encoding UTF8
  } catch { }
}
function Register-StartupTask([string]$name, [string]$worker) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $worker)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  # IgnoreNew prevents concurrent instances; battery and idle state never gates execution.
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfIdle:$false -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
  $triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(90) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Hours 24))
  )
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Trigger $triggers -Force | Out-Null
}
$run = ${psRun}
$stateDir = Join-Path $env:ProgramData ('Win11Desk\PostInstall\' + [string]$run)
$sourcePath = Join-Path $env:SystemDrive 'win11desk-post.ps1'
$workerPath = Join-Path $stateDir 'worker.ps1'
$deadlinePath = Join-Path $stateDir 'deadline.json'
$taskName = 'Win11DeskPostInstall-' + [string]$run
try {
  if (-not (Test-StartupCanonicalRun ([string]$run))) { throw 'STARTUP_WORKER_ERROR' }
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  Set-StartupAcl $stateDir $true
  if (-not (Test-Path -LiteralPath $deadlinePath -PathType Leaf)) {
    $now = (Get-Date).ToUniversalTime()
    $deadline = [ordered]@{ createdUtc = $now.ToString('o'); deadlineUtc = $now.AddHours(24).ToString('o') }
    $deadline | ConvertTo-Json -Compress | Set-Content -LiteralPath ($deadlinePath + '.new') -Encoding UTF8
    Move-Item -LiteralPath ($deadlinePath + '.new') -Destination $deadlinePath -Force
  }
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'STARTUP_WORKER_ERROR' }
  Copy-Item -LiteralPath $sourcePath -Destination $workerPath -Force
  Set-StartupAcl $workerPath $false
  Start-Service -Name 'Schedule' -ErrorAction Stop
  Register-StartupTask $taskName $workerPath
  [IO.File]::WriteAllText((Join-Path $stateDir 'task-registered.marker'), 'Registered')
} catch {
  Write-RegistrationStatus $stateDir 'STARTUP_WORKER_ERROR'
  exit 1
}
`;
}
