import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { postInstallWorker } from "./postInstallWorker";
import { defaultPostInstallOptions, attachedScript } from "./postInstall";
const hasPowerShell = (() => {
  try {
    execFileSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();
const source = postInstallWorker({
  version: 1,
  options: { ...defaultPostInstallOptions, runAttachedScript: true },
  files: [],
  script: attachedScript,
});
describe("emitted action lifecycle without Windows side effects", () => {
  it("delivers files before script execution and never marks a not-started setup wait final", () => {
    expect(source.indexOf("$process.Start()")).toBeGreaterThan(
      source.indexOf("foreach ($fileState in @($state.files))")
    );
    expect(source).toContain(
      "$state.status = 'waiting'; $state.script.errorCode = 'SETUP_NOT_FINISHED'; Save-State; return"
    );
    expect(source).not.toContain(
      "$state.script.status = 'timed_out'; $state.script.errorCode = 'SETUP_NOT_FINISHED'"
    );
  });
  it.skipIf(!hasPowerShell)(
    "executes actual local-state/report-ack functions and atomic marker twice",
    () => {
      const encoded = Buffer.from(source).toString("base64");
      const markerA = source.indexOf(
        "$markerStream = [IO.File]::Open($startedMarker"
      );
      const markerB = source.indexOf("$state.scriptStarted = $true", markerA);
      expect(markerA).toBeGreaterThan(0);
      const marker = Buffer.from(source.slice(markerA, markerB)).toString(
        "base64"
      );
      const script = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'PARSE'}
$names=@('Get-Report','Send-Report','Save-State');foreach($f in $ast.FindAll({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $a.Name},$true)){Invoke-Expression $f.Extent.Text}
$stateDir=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString());[void][IO.Directory]::CreateDirectory($stateDir)
try{$statePath=Join-Path $stateDir 'state.json';$resultPath=Join-Path $stateDir 'result.json';$startedMarker=Join-Path $stateDir 'script-started.marker';$origin='https://fixture.example.com';$run='11111111-1111-4111-8111-111111111111';$headers=@{Authorization='fixture'}
$state=@{status='completed';files=@();script=@{enabled=$true;status='completed';exitCode=0;activationObserved=$true;errorCode=$null};errorCode=$null;overallFinal=$true}
function Start-Sleep{param($Seconds)};function Invoke-RestMethod{param($Uri,$Method,$Headers,$ContentType,$Body,$TimeoutSec)throw 'OFFLINE'}
Save-State;if(-not (Test-Path $statePath) -or -not (Test-Path $resultPath)){throw 'LOST_LOCAL_STATE'};if(Test-Path (Join-Path $stateDir 'report-delivered.marker')){throw 'FALSE_ACK'}
function Invoke-RestMethod{param($Uri,$Method,$Headers,$ContentType,$Body,$TimeoutSec) return $null}
Send-Report;if(-not (Test-Path (Join-Path $stateDir 'report-delivered.marker'))){throw 'MISSING_ACK'}
$m=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${marker}'));Invoke-Expression $m;$denied=$false;try{Invoke-Expression $m}catch{$denied=$true};if(-not $denied){throw 'REPLAY_ALLOWED'}
Write-Output 'PASS_OFFLINE_ACK_AND_ONCE'}finally{[IO.Directory]::Delete($stateDir,$true)}`;
      expect(
        execFileSync(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-Command", script],
          { encoding: "utf8" }
        ).trim()
      ).toBe("PASS_OFFLINE_ACK_AND_ONCE");
    }
  );
});
