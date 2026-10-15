import type { PostInstallPlan } from "./postInstall";

/**
 * Generates the action body inserted by the dedicated per-run startup orchestrator.
 * The surrounding reporter supplies the already authenticated `$origin`, `$run`,
 * and `$headers` variables. No scheduled task is created here.
 */
export function postInstallWorker(plan: PostInstallPlan): string {
  if (!plan.options.getFiles && !plan.options.runAttachedScript) return "";

  const planBase64 = Buffer.from(JSON.stringify(plan), "utf8").toString(
    "base64"
  );
  const prefix = String.raw`
# Win11Desk post-install worker. Dedicated startup task supplies locally verified readiness.
# Callback failures never block actions. This body never registers a task.
& {
  $ErrorActionPreference = 'Stop'
  Set-StrictMode -Version 2
  Add-Type -AssemblyName System.Net.Http
  $mutex = $null
  $script:wdPostClient = $null
  try {
    if (-not $origin -or -not $run -or -not $headers) { return }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $planJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('`;
  const suffix = String.raw`'))
    $plan = $planJson | ConvertFrom-Json
    $safeRun = ([string]$run -replace '[^A-Za-z0-9-]', '_')
    if ([string]::IsNullOrWhiteSpace($safeRun)) { return }

    $stateDir = Join-Path $env:ProgramData ('Win11Desk\PostInstall\' + $safeRun)
    $statePath = Join-Path $stateDir 'state.json'
    $startedMarker = Join-Path $stateDir 'script-started.marker'
    $resultPath = Join-Path $stateDir 'result.json'
    $logDir = Join-Path $stateDir 'logs'
    $state = $null
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null

    # Restrict the per-run directory to SYSTEM and local Administrators.
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    Set-Acl -LiteralPath $stateDir -AclObject $acl

    $mutex = New-Object Threading.Mutex($false, ('Global\Win11DeskPostInstall-' + $safeRun))
    if (-not $mutex.WaitOne(0)) { return }

    function Get-Report {
      $fileReports = @($state.files | ForEach-Object {
        [ordered]@{
          id = [string]$_.id
          status = [string]$_.status
          bytes = [int64]$_.bytes
          sha256 = if ($_.sha256) { [string]$_.sha256 } else { $null }
          errorCode = if ($_.errorCode) { [string]$_.errorCode } else { $null }
        }
      })
      [ordered]@{
        status = [string]$state.status
        files = $fileReports
        script = [ordered]@{
          enabled = [bool]$state.script.enabled
          status = [string]$state.script.status
          exitCode = if ($null -ne $state.script.exitCode) { [int]$state.script.exitCode } else { $null }
          activationObserved = if ($null -ne $state.script.activationObserved) { [bool]$state.script.activationObserved } else { $null }
          errorCode = if ($state.script.errorCode) { [string]$state.script.errorCode } else { $null }
        }
        errorCode = if ($state.errorCode) { [string]$state.errorCode } else { $null }
      }
    }

    function Send-Report {
      try {
        $body = (Get-Report | ConvertTo-Json -Depth 8 -Compress)
        $callback = ([string]$origin).TrimEnd('/') + '/api/installer/tracking/runs/' + [string]$run + '/post-install'
        for ($i = 0; $i -lt 3; $i++) {
          try {
            Invoke-RestMethod -Uri $callback -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 12 | Out-Null
            if ($state.overallFinal -eq $true) { [IO.File]::WriteAllText((Join-Path $stateDir 'report-delivered.marker'), 'Acknowledged') }
            break
          } catch {
            if ($i -lt 2) { Start-Sleep -Seconds 2 }
          }
        }
      } catch { }
    }

    function Save-State {
      $state | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath ($statePath + '.new') -Encoding UTF8
      Move-Item -LiteralPath ($statePath + '.new') -Destination $statePath -Force
      (Get-Report | ConvertTo-Json -Depth 8 -Compress) | Set-Content -LiteralPath ($resultPath + '.new') -Encoding UTF8
      Move-Item -LiteralPath ($resultPath + '.new') -Destination $resultPath -Force
      Send-Report
    }

    function New-FileState($file) {
      [ordered]@{ id = [string]$file.id; status = 'pending'; bytes = [int64]0; sha256 = $null; errorCode = $null }
    }

    if (Test-Path -LiteralPath $statePath) {
      try { $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $state = $null }
    } else { $state = $null }
    if ($null -eq $state) {
      $state = [ordered]@{
        status = 'waiting'
        files = @($plan.files | ForEach-Object { New-FileState $_ })
        script = [ordered]@{ enabled = [bool]$plan.options.runAttachedScript; status = if ($plan.options.runAttachedScript) { 'pending' } else { 'disabled' }; exitCode = $null; activationObserved = $null; errorCode = $null }
        errorCode = $null
        scriptStarted = $false
        scriptFinal = $false
        overallFinal = $false
      }
      if($plan.options.runAttachedScript -and (Test-Path -LiteralPath $startedMarker)) { $state.scriptStarted=$true; $state.scriptFinal=$true; $state.script.status='interrupted'; $state.script.errorCode='INTERRUPTED' }
      Save-State
    } elseif ($state.overallFinal -eq $true) {
      Send-Report
      return
    } elseif ($state.scriptStarted -eq $true -and $state.scriptFinal -ne $true) {
      # A started process has unknown side effects; never replay it after reboot/crash.
      $state.script.status = 'interrupted'
      $state.script.errorCode = 'INTERRUPTED'
      $state.scriptFinal = $true
      $state.status = 'running'
      Save-State
    }

    $state.status = 'running'
    $state.errorCode = $null
    Save-State

    function Set-FileState($fileState, [string]$status, [int64]$bytes, [string]$hash, [string]$errorCode) {
      $fileState.status = $status
      $fileState.bytes = $bytes
      $fileState.sha256 = $hash
      $fileState.errorCode = $errorCode
      Save-State
    }

    function Wait-ScriptService {
      # Licensing readiness is bounded and gates this script only, after files.
      for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
          $service = Get-Service -Name 'sppsvc' -ErrorAction Stop
          if ($service.Status -ne 'Running') { Start-Service -Name 'sppsvc' -ErrorAction Stop; $service = Get-Service -Name 'sppsvc' -ErrorAction Stop }
          if ($service.Status -eq 'Running') { return $true }
        } catch { }
        if ($attempt -lt 11) { Start-Sleep -Seconds 10 }
      }
      return $false
    }

    function Stop-AttachedProcess($process) {
      if ($null -eq $process) { return }
      try {
        if (-not $process.HasExited) {
          $taskkill = Join-Path $env:windir 'System32\taskkill.exe'
          & $taskkill /PID $process.Id /T /F *> $null
          if (-not $process.WaitForExit(5000)) { $process.Kill(); [void]$process.WaitForExit(5000) }
        }
      } catch { try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) } } catch { } }
    }

    function Safe-ErrorCode([string]$value) {
      $known = @('URL_REJECTED','HOST_REJECTED','DNS_FAILED','PRIVATE_ADDRESS','REDIRECT_LIMIT','HTTP_STATUS','SIZE_LIMIT','READ_TIMEOUT','DOWNLOAD_DEADLINE','SHA256_MISMATCH','SIGNATURE_INVALID','PUBLISHER_MISMATCH','HTML_REJECTED','MAGIC_INVALID','FILENAME_REJECTED','SCRIPT_MISSING','SCRIPT_HASH_MISMATCH','SCRIPT_COPY_MISMATCH','SCRIPT_PLAN_MISSING','PROCESS_TIMEOUT','LOG_TOO_LARGE','PROCESS_EXIT','SPPSVC_NOT_READY')
      if ($known -contains $value) { return $value }
      return 'WORKER_ERROR'
    }

    function Test-PublicAddress([Net.IPAddress]$address) {
      if ([Net.IPAddress]::IsLoopback($address) -or $address.IsIPv6LinkLocal -or $address.IsIPv6SiteLocal -or $address.IsIPv6Multicast -or $address.Equals([Net.IPAddress]::Any) -or $address.Equals([Net.IPAddress]::IPv6Any)) { return $false }
      $b = $address.GetAddressBytes()
      if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) {
        if ($b[0] -eq 10 -or $b[0] -eq 127 -or ($b[0] -eq 169 -and $b[1] -eq 254) -or ($b[0] -eq 192 -and $b[1] -eq 168) -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 0) -or ($b[0] -ge 224)) { return $false }
      } else {
        if (($b[0] -band 0xfe) -eq 0xfc -or $address.IsIPv4MappedToIPv6) { return $false }
      }
      return $true
    }

    function Assert-PublicHost([string]$hostname) {
      if ([string]::IsNullOrWhiteSpace($hostname) -or $hostname -match '[\\/]') { throw 'HOST_REJECTED' }
      $addresses = @()
      $parsed = $null
      try {
        if ([Net.IPAddress]::TryParse($hostname, [ref]$parsed)) { $addresses = @($parsed) }
        else { $addresses = @([Net.Dns]::GetHostAddresses($hostname)) }
      } catch { throw 'DNS_FAILED' }
      if ($addresses.Count -eq 0) { throw 'DNS_FAILED' }
      foreach ($address in $addresses) { if (-not (Test-PublicAddress $address)) { throw 'PRIVATE_ADDRESS' } }
    }

    function Get-SafeUri([string]$value) {
      try { $uri = New-Object Uri($value) } catch { throw 'URL_REJECTED' }
      if ($uri.Scheme -ne 'https' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Fragment) { throw 'URL_REJECTED' }
      Assert-PublicHost $uri.DnsSafeHost
      return $uri
    }

    function Get-DownloadedFile($file, $fileState, [string]$destination) {
      $maxBytes = [int64]$file.maxBytes
      if ($file.id -eq 'custom' -and $maxBytes -gt 104857600) { $maxBytes = 104857600 }
      $current = Get-SafeUri ([string]$file.url)
      $redirects = 0
      $deadline = [Diagnostics.Stopwatch]::StartNew()
      $part = $destination + '.partial'
      Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
      if ($null -eq $script:wdPostClient) {
        $handler = New-Object Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $false
        $handler.UseProxy = $false
        $script:wdPostClient = New-Object Net.Http.HttpClient($handler)
        $script:wdPostClient.Timeout = [TimeSpan]::FromSeconds(30)
      }
      try {
        while ($true) {
          if ($deadline.Elapsed.TotalSeconds -gt 900) { throw 'DOWNLOAD_DEADLINE' }
          $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, $current)
          $response = $script:wdPostClient.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
          try {
            if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
              if ($redirects -ge 5 -or $null -eq $response.Headers.Location) { throw 'REDIRECT_LIMIT' }
              $next = New-Object Uri($current, $response.Headers.Location)
              $current = Get-SafeUri $next.AbsoluteUri
              $redirects++
              continue
            }
            if (-not $response.IsSuccessStatusCode) { throw 'HTTP_STATUS' }
            if ($response.Content.Headers.ContentLength -and [int64]$response.Content.Headers.ContentLength -gt $maxBytes) { throw 'SIZE_LIMIT' }
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $out = New-Object IO.FileStream($part, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 65536, [IO.FileOptions]::SequentialScan)
            $buffer = New-Object byte[] 65536
            [int64]$total = 0
            try {
              while ($true) {
                if ($deadline.Elapsed.TotalSeconds -gt 900) { throw 'DOWNLOAD_DEADLINE' }
                $readCts = New-Object Threading.CancellationTokenSource
                $readCts.CancelAfter(15000)
                try { $count = $stream.ReadAsync($buffer, 0, $buffer.Length, $readCts.Token).GetAwaiter().GetResult() } catch { throw 'READ_TIMEOUT' } finally { $readCts.Dispose() }
                if ($count -le 0) { break }
                $total += $count
                if ($total -gt $maxBytes) { throw 'SIZE_LIMIT' }
                $out.Write($buffer, 0, $count)
                $fileState.bytes = $total
              }
            } finally { $out.Dispose(); $stream.Dispose() }
            Move-Item -LiteralPath $part -Destination $destination -Force
            return $total
          } finally { $response.Dispose(); $request.Dispose() }
        }
      } finally { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
    }

    function Test-FileContent($file, [string]$path) {
      $check = [IO.File]::OpenRead($path);try { $bytes=New-Object byte[] ([int][Math]::Min(512,$check.Length));[void]$check.Read($bytes,0,$bytes.Length) }finally{$check.Dispose()}
      if ($bytes.Length -lt 4) { throw 'MAGIC_INVALID' }
      $head = [Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(512, $bytes.Length)).ToLowerInvariant()
      if ($head -match '<!doctype|<html|<head|<script') { throw 'HTML_REJECTED' }
      if ($file.id -eq 'custom') {
        $lower = ([IO.Path]::GetExtension([string]$file.filename)).ToLowerInvariant()
        if ($lower -eq '.zip' -and -not (($bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4b -and (($bytes[2] -eq 0x03 -and $bytes[3] -eq 0x04) -or ($bytes[2] -eq 0x05 -and $bytes[3] -eq 0x06) -or ($bytes[2] -eq 0x07 -and $bytes[3] -eq 0x08))))) { throw 'MAGIC_INVALID' }
        if ($lower -eq '.iso') {
          $check=[IO.File]::OpenRead($path);try {if($check.Length -lt 32774){throw 'MAGIC_INVALID'};[void]$check.Seek(32769,[IO.SeekOrigin]::Begin);$magic=New-Object byte[] 5;[void]$check.Read($magic,0,5);$iso=[Text.Encoding]::ASCII.GetString($magic)}finally{$check.Dispose()}
          if ($iso -ne 'CD001') { throw 'MAGIC_INVALID' }
        }
        if ($lower -ne '.zip' -and $lower -ne '.iso') { throw 'MAGIC_INVALID' }
      }
    }

    function Test-SetupFinished {
      try {
        $setup = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\Setup' -ErrorAction Stop
        if($null -eq $setup.PSObject.Properties['SystemSetupInProgress']) {return $false}
        $a = [int]$setup.SystemSetupInProgress
        $b = if ($null -eq $setup.PSObject.Properties['SetupInProgress']) { 0 } else { [int]$setup.SetupInProgress }
        $c = if ($null -eq $setup.PSObject.Properties['OOBEInProgress']) { 0 } else { [int]$setup.OOBEInProgress }
        return ($a -eq 0 -and $b -eq 0 -and $c -eq 0)
      } catch { return $false }
    }

    # Get files is independent and should not wait for a long-running attached script.
    foreach ($fileState in @($state.files)) {
      $file = @($plan.files | Where-Object { [string]$_.id -eq [string]$fileState.id })[0]
      if ($null -eq $file -or $fileState.status -eq 'downloaded') { continue }
      $fileState.status = 'downloading'; $fileState.errorCode = $null; Save-State
      $folder = Join-Path (Join-Path $env:Public 'Desktop\Win11Desk Installers') $safeRun
      New-Item -ItemType Directory -Path $folder -Force | Out-Null
      $name = [IO.Path]::GetFileName([string]$file.filename)
      if ([string]::IsNullOrWhiteSpace($name) -or $name -ne [string]$file.filename -or $name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { Set-FileState $fileState 'failed' 0 $null 'FILENAME_REJECTED'; continue }
      $destination = Join-Path $folder $name
      $success = $false
      for ($attempt = 1; $attempt -le 3 -and -not $success; $attempt++) {
        try {
          [int64]$bytes = Get-DownloadedFile $file $fileState $destination
          Test-FileContent $file $destination
          $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($file.sha256 -and $hash -ne ([string]$file.sha256).ToLowerInvariant()) { throw 'SHA256_MISMATCH' }
          $sig = $null
          if ([bool]$file.requireSignature -or ([string]$file.publisher -match 'Google' -and -not $file.sha256)) {
            $sig = Get-AuthenticodeSignature -FilePath $destination
            if ($sig.Status -ne 'Valid') { throw 'SIGNATURE_INVALID' }
            if ([string]$file.publisher -match 'Google' -and $sig.SignerCertificate.Subject -notmatch '(^|,)\s*CN=Google LLC(?:,|$)') { throw 'PUBLISHER_MISMATCH' }
          } elseif ([IO.Path]::GetExtension($name) -match '\.(exe|msi|cmd|bat)$') {
            $sig = Get-AuthenticodeSignature -FilePath $destination
            if ($sig.Status -and $sig.Status -ne 'NotSigned' -and $sig.Status -ne 'Valid') { throw 'SIGNATURE_INVALID' }
          }
          $fileState.bytes = $bytes
          Set-FileState $fileState 'downloaded' $bytes $hash $null
          $success = $true
        } catch {
          Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
          if ($attempt -eq 3) { Set-FileState $fileState 'failed' ([int64]$fileState.bytes) $null (Safe-ErrorCode ([string]$_.Exception.Message)) }
          else { Start-Sleep -Seconds 2 }
        }
      }
    }

    if ([bool]$state.script.enabled -and $state.script.status -eq 'pending') {
      $setupDeadline = [Diagnostics.Stopwatch]::StartNew()
      while (-not (Test-SetupFinished) -and $setupDeadline.Elapsed.TotalSeconds -lt 600) { Start-Sleep -Seconds 5 }
      if (-not (Test-SetupFinished)) {
        $state.status = 'waiting'; $state.script.errorCode = 'SETUP_NOT_FINISHED'; Save-State; return
      } elseif ($null -eq $plan.script) {
        $state.script.status = 'failed'; $state.script.errorCode = 'SCRIPT_PLAN_MISSING'; $state.scriptFinal = $true; Save-State
      } else {
        $staged = Join-Path $env:SystemDrive 'win11desk-attached.bat'
        $protected = Join-Path $stateDir ([IO.Path]::GetFileName([string]$plan.script.name))
        $process = $null
        try {
          # File delivery is already finished. Licensing-service readiness only gates this action.
          if (-not (Wait-ScriptService)) { throw 'SPPSVC_NOT_READY' }
          if (-not (Test-Path -LiteralPath $staged -PathType Leaf)) { throw 'SCRIPT_MISSING' }
          $before = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($before -ne ([string]$plan.script.sha256).ToLowerInvariant()) { throw 'SCRIPT_HASH_MISMATCH' }
          Copy-Item -LiteralPath $staged -Destination $protected -Force
          $afterCopy = (Get-FileHash -LiteralPath $protected -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($afterCopy -ne $before) { throw 'SCRIPT_COPY_MISMATCH' }
          $outLog = Join-Path $logDir 'attached.stdout.log'; $errLog = Join-Path $logDir 'attached.stderr.log'
          Remove-Item -LiteralPath $outLog,$errLog -Force -ErrorAction SilentlyContinue
          # Independent CreateNew marker survives corrupt/missing JSON and prevents replay.
          $markerStream = [IO.File]::Open($startedMarker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
          $markerStream.Flush($true); $markerStream.Dispose()
          $state.scriptStarted = $true; $state.script.status = 'running'; $state.script.errorCode = $null; Save-State
          $cmd = if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { Join-Path $env:windir 'Sysnative\cmd.exe' } else { Join-Path $env:windir 'System32\cmd.exe' }
          $psi = New-Object Diagnostics.ProcessStartInfo
          $psi.FileName = $cmd
          $psi.Arguments = '/d /c ""' + $protected + '" /HWID /HWID-NoEditionChange 1>"' + $outLog + '" 2>"' + $errLog + '""'
          $psi.WorkingDirectory = $stateDir
          $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
          $process = New-Object Diagnostics.Process; $process.StartInfo = $psi
          [void]$process.Start()
          $timedOut = $false; $logLimit = 4194304; $started = [Diagnostics.Stopwatch]::StartNew()
          while (-not $process.HasExited) {
            Start-Sleep -Milliseconds 250
            $outTooLarge = (Test-Path -LiteralPath $outLog) -and ((Get-Item -LiteralPath $outLog).Length -gt $logLimit)
            $errTooLarge = (Test-Path -LiteralPath $errLog) -and ((Get-Item -LiteralPath $errLog).Length -gt $logLimit)
            if ($outTooLarge -or $errTooLarge) { $timedOut = $true; $state.script.errorCode = 'LOG_TOO_LARGE'; break }
            if ($started.Elapsed.TotalSeconds -gt 900) { $timedOut = $true; break }
          }
          if ($timedOut) {
            $taskkill = Join-Path $env:windir 'System32\taskkill.exe'
            & $taskkill /PID $process.Id /T /F *> $null
            if(-not $process.WaitForExit(5000)) { try{$process.Kill()}catch{}; [void]$process.WaitForExit(5000) }
          } else { [void]$process.WaitForExit(5000) }
          foreach ($log in @($outLog, $errLog)) {
            if (Test-Path -LiteralPath $log) {
              if((Get-Item -LiteralPath $log).Length -gt $logLimit) { $truncate=[IO.File]::Open($log,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);try{$truncate.SetLength($logLimit)}finally{$truncate.Dispose()} }
            }
          }
          $state.script.exitCode = if($process.HasExited){[int]$process.ExitCode}else{$null}
          if ($timedOut) { $state.script.status = 'timed_out'; if (-not $state.script.errorCode) { $state.script.errorCode = 'PROCESS_TIMEOUT' } }
          else {
            try {
              $currentLicenseEdition=[string](Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -Name EditionID -ErrorAction Stop).EditionID
              $licensed = @(Get-CimInstance -ClassName SoftwareLicensingProduct -ErrorAction Stop | Where-Object { [string]$_.ApplicationID -eq '55c92734-d682-4d71-983e-d6ec3f16059f' -and $_.PartialProductKey -and -not $_.LicenseIsAddon -and [string]$_.LicenseFamily -eq $currentLicenseEdition -and [int]$_.LicenseStatus -eq 1 })
              $state.script.activationObserved = ($licensed.Count -gt 0)
            } catch { $state.script.activationObserved = $false }
            $state.script.status = if ($process.ExitCode -eq 0 -and $state.script.activationObserved) { 'completed' } else { 'failed' }
            if($process.ExitCode -eq 0 -and -not $state.script.activationObserved) {$state.script.errorCode='NO_ACTIVATION_EVIDENCE'}
            if ($process.ExitCode -ne 0) { $state.script.errorCode = 'PROCESS_EXIT' }
          }
          $state.scriptFinal = $true; Save-State
        } catch {
          Stop-AttachedProcess $process
          $state.script.status = 'failed'; $state.script.errorCode = Safe-ErrorCode ([string]$_.Exception.Message); $state.scriptFinal = $true; Save-State
        } finally { if ($null -ne $process) { $process.Dispose() } }
      }
    }

    $fileFailure = @($state.files | Where-Object { $_.status -eq 'failed' }).Count -gt 0
    $scriptFailure = $state.script.status -in @('failed','timed_out','interrupted')
    if ($scriptFailure) { $state.errorCode = 'SCRIPT_' + ([string]$state.script.errorCode) }
    elseif ($fileFailure) { $state.errorCode = 'FILE_DOWNLOAD_FAILED' }
    $state.status = if ($scriptFailure -and $state.script.status -eq 'timed_out') { 'timed_out' } elseif ($scriptFailure -or $fileFailure) { 'failed' } else { 'completed' }
    $state.overallFinal = $true
    Save-State
  } catch {
    try {
      if ($null -ne $state) { $state.status = 'failed'; $state.errorCode = 'WORKER_FAILED'; $state.overallFinal = $true; Save-State }
    } catch { }
  } finally {
    if ($null -ne $script:wdPostClient) { $script:wdPostClient.Dispose() }
    if ($null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose() }
  }
}
`;
  return prefix + planBase64 + suffix;
}
