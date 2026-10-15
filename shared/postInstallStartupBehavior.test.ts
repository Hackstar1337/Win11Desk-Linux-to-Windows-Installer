import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  postInstallStartupScript,
  postInstallRegistrationScript,
} from "./postInstallStartup";
import { attachedScript, defaultPostInstallOptions } from "./postInstall";
const havePS = (() => {
  try {
    execFileSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();
const run = "11111111-1111-4111-8111-111111111111";
const plan = {
  version: 1 as const,
  options: { ...defaultPostInstallOptions, runAttachedScript: true },
  files: [],
  script: attachedScript,
};
const body = postInstallStartupScript(
  "https://fixture.example.com",
  run,
  "a".repeat(64),
  "22",
  "windows-11-pro",
  plan
);
const register = postInstallRegistrationScript(run);
function invoke(script: string) {
  return execFileSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" }
  ).trim();
}
function extract(source: string, names: string[]) {
  return String.raw`$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}'));$t=$null;$e=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$t,[ref]$e);if($e.Count){throw 'PARSE'};$names=@(${names.map(n => `'${n}'`).join(",")});foreach($f in $ast.FindAll({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $a.Name},$true)){Invoke-Expression $f.Extent.Text}`;
}
describe("actual startup helper behavior (mocked Windows only)", () => {
  it("cleans the attached transport only with acknowledgment and records task registration", () => {
    expect(
      (body.match(/win11desk-attached\.bat/g) || []).length
    ).toBeGreaterThanOrEqual(2);
    expect(register).toContain("task-registered.marker");
    expect(register).toContain("Start-Service -Name 'Schedule'");
  });

  it.skipIf(!havePS)(
    "handles optional setup keys, starts licensing service, detects unavailable network and preserves deadline",
    () => {
      const script = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
${extract(body, ["Test-StartupReadiness", "Get-StartupDeadline"])}
$script:setup=[pscustomobject]@{SystemSetupInProgress=0};$script:service='Stopped';$script:dnsOnline=$true
function Get-ItemProperty{param($LiteralPath,$ErrorAction)if($LiteralPath -eq 'HKLM:\SYSTEM\Setup'){return $script:setup};return [pscustomobject]@{EditionID='Professional';CurrentBuildNumber='26300';InstallationType='Client'}}
function Get-NetTCPConnection{param($State,$LocalPort,$ErrorAction)return [pscustomobject]@{LocalPort=$LocalPort}}
function Get-Service{param($Name,$ErrorAction)return [pscustomobject]@{Status=$script:service}}
function Start-Service{param($Name,$ErrorAction)$script:service='Running'}
function Get-NetRoute{param($DestinationPrefix,$ErrorAction)return [pscustomobject]@{NextHop='8.8.8.8';State='Alive'}}
function Resolve-DnsName{param($Name,$ErrorAction)if(-not $script:dnsOnline){throw 'OFFLINE'};return [pscustomobject]@{Name=$Name}}
$r=Test-StartupReadiness 22;if(-not $r.Ready -or $script:service -ne 'Running'){throw ('NOT_READY:'+ $r.Reason)}
$script:setup=[pscustomobject]@{};$r=Test-StartupReadiness 22;if($r.Ready -or $r.Reason -notmatch 'SETUP_NOT_FINISHED'){throw 'UNKNOWN_SETUP'}
$script:setup=[pscustomobject]@{SystemSetupInProgress=0;OOBEInProgress=1};if((Test-StartupReadiness 22).Ready){throw 'EARLY_SETUP'}
$script:setup=[pscustomobject]@{SystemSetupInProgress=0};$script:dnsOnline=$false;$r=Test-StartupReadiness 22;if($r.Ready -or $r.Reason -notmatch 'DNS_NOT_READY'){throw 'NETWORK'}
$dir=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString());[void][IO.Directory]::CreateDirectory($dir)
try{$a=Get-StartupDeadline $dir;$b=Get-StartupDeadline $dir;if($a -ne $b){throw 'DEADLINE_RESET'};[IO.File]::WriteAllText((Join-Path $dir 'deadline.json'),'bad');if((Get-StartupDeadline $dir) -gt [DateTime]::UtcNow){throw 'BAD_DEADLINE_EXTENDED'}}finally{[IO.Directory]::Delete($dir,$true)}
Write-Output 'PASS_LOCAL_READINESS_AND_DEADLINE'`;
      expect(invoke(script)).toBe("PASS_LOCAL_READINESS_AND_DEADLINE");
    }
  );
  it.skipIf(!havePS)(
    "invokes native-task mocks with SYSTEM, highest, non-overlap and bounded startup/recovery triggers",
    () => {
      const script = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
${extract(register, ["Register-StartupTask"])}
function New-ScheduledTaskAction{param($Execute,$Argument)return [pscustomobject]@{Execute=$Execute;Argument=$Argument}}
function New-ScheduledTaskPrincipal{param($UserId,$LogonType,$RunLevel)return [pscustomobject]@{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel}}
function New-ScheduledTaskSettingsSet{param($MultipleInstances,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$RunOnlyIfIdle,[switch]$StartWhenAvailable,$ExecutionTimeLimit,$RestartCount,$RestartInterval)return [pscustomobject]$PSBoundParameters}
function New-ScheduledTaskTrigger{param([switch]$AtStartup,[switch]$AtLogOn,[switch]$Once,$At,$RepetitionInterval,$RepetitionDuration)return [pscustomobject]$PSBoundParameters}
function Register-ScheduledTask{param($TaskName,$Action,$Principal,$Settings,$Trigger,[switch]$Force)$script:registration=$PSBoundParameters}
Register-StartupTask 'fixture' 'C:\ProgramData\Win11Desk\worker.ps1';$r=$script:registration;if($r.Principal.UserId -ne 'SYSTEM' -or $r.Principal.RunLevel -ne 'Highest' -or $r.Settings.MultipleInstances -ne 'IgnoreNew'){throw 'IDENTITY_OR_OVERLAP'}
if($r.Trigger.Count -ne 3 -or -not $r.Trigger[0].AtStartup -or -not $r.Trigger[1].AtLogOn -or $r.Trigger[2].RepetitionInterval.TotalMinutes -ne 2 -or $r.Trigger[2].RepetitionDuration.TotalHours -ne 24){throw 'TRIGGERS'}
if($r.Settings.ExecutionTimeLimit.TotalHours -ne 2 -or $r.Settings.RunOnlyIfIdle){throw 'LIMIT'}
Write-Output 'PASS_NATIVE_REGISTRATION_ARGUMENTS'`;
      expect(invoke(script)).toBe("PASS_NATIVE_REGISTRATION_ARGUMENTS");
    }
  );
});
