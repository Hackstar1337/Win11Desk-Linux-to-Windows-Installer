import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { postInstallWorker } from "./postInstallWorker";
import { defaultPostInstallOptions, type PostInstallPlan } from "./postInstall";
const plan: PostInstallPlan = {
  version: 1,
  options: { ...defaultPostInstallOptions, getFiles: true },
  files: [],
  script: null,
};
const havePowerShell = (() => {
  try {
    execFileSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();
describe("PowerShell helper execution (no Windows actions)", () => {
  it.skipIf(!havePowerShell)(
    "executes actual DNS/URL, setup state and bounded file-magic guards",
    () => {
      const source = Buffer.from(postInstallWorker(plan)).toString("base64");
      const code = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
 $source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'));$t=$null;$e=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$t,[ref]$e);if($e.Count){throw 'PARSE'}
 $names=@('Test-PublicAddress','Assert-PublicHost','Get-SafeUri','Test-FileContent','Test-SetupFinished')
 foreach($d in $ast.FindAll({param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $a.Name},$true)){Invoke-Expression $d.Extent.Text}
 foreach($ip in @('127.0.0.1','10.0.0.1','172.20.1.2','192.168.1.1','169.254.169.254','::1','fc00::1','fe80::1')){if(Test-PublicAddress ([Net.IPAddress]::Parse($ip))){throw 'PRIVATE'}}
 foreach($ip in @('8.8.8.8','1.1.1.1','2606:4700:4700::1111')){if(-not (Test-PublicAddress ([Net.IPAddress]::Parse($ip)))){throw 'PUBLIC'}}
 Assert-PublicHost '8.8.8.8';if((Get-SafeUri 'https://8.8.8.8/file.zip').Scheme -ne 'https'){throw 'HTTPS'}
 foreach($url in @('http://8.8.8.8/file.zip','https://8.8.8.8:444/file.zip','https://user:pass@8.8.8.8/file.zip','https://127.0.0.1/file.zip')){$rejected=$false;try{[void](Get-SafeUri $url)}catch{$rejected=$true};if(-not $rejected){throw 'URL'}}
 $script:setupFixture=[pscustomobject]@{SystemSetupInProgress=0};function Get-ItemProperty{param($LiteralPath,$ErrorAction) return $script:setupFixture};if(-not (Test-SetupFinished)){throw 'MISSING_OPTIONAL_PROPERTY'}
 $script:setupFixture=[pscustomobject]@{SystemSetupInProgress=1};if(Test-SetupFinished){throw 'SETUP_BUSY'}
 $script:setupFixture=[pscustomobject]@{};if(Test-SetupFinished){throw 'SETUP_UNKNOWN'}
 $dir=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString());[void][IO.Directory]::CreateDirectory($dir)
 try{$zip=Join-Path $dir 'ok.zip';[IO.File]::WriteAllBytes($zip,[byte[]]@(0x50,0x4b,0x03,0x04,0,0,0,0));Test-FileContent ([pscustomobject]@{id='custom';filename='ok.zip'}) $zip
 $html=Join-Path $dir 'bad.zip';[IO.File]::WriteAllText($html,'<!doctype html><html>no file</html>');$rejected=$false;try{Test-FileContent ([pscustomobject]@{id='custom';filename='bad.zip'}) $html}catch{$rejected=$_.Exception.Message -eq 'HTML_REJECTED'};if(-not $rejected){throw 'HTML'}
 $iso=Join-Path $dir 'ok.iso';$stream=[IO.File]::OpenWrite($iso);$stream.SetLength(32774);[void]$stream.Seek(32769,[IO.SeekOrigin]::Begin);$stream.Write([Text.Encoding]::ASCII.GetBytes('CD001'),0,5);$stream.Dispose();Test-FileContent ([pscustomobject]@{id='custom';filename='ok.iso'}) $iso
 }finally{[IO.Directory]::Delete($dir,$true)}
 Write-Output 'PASS_HELPERS'
 `;
      expect(
        execFileSync(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-Command", code],
          { encoding: "utf8" }
        ).trim()
      ).toBe("PASS_HELPERS");
    }
  );
});

describe("emitted activation observations (mocked, no licensing actions)", () => {
  it.skipIf(!havePowerShell)(
    "uses the correct registry path and rejects add-on or different-edition licenses",
    () => {
      const emitted = postInstallWorker(plan);
      const start = emitted.indexOf("$currentLicenseEdition=");
      const end = emitted.indexOf(
        "$state.script.activationObserved = ($licensed.Count -gt 0)",
        start
      );
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const block = Buffer.from(
        emitted.slice(
          start,
          end +
            "$state.script.activationObserved = ($licensed.Count -gt 0)".length
        )
      ).toString("base64");
      const code = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
function Get-ItemProperty{param($LiteralPath,$Name,$ErrorAction) if($LiteralPath -ne 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -or $Name -ne 'EditionID'){throw 'PATH'};return [pscustomobject]@{EditionID='Professional'}}
function Get-CimInstance{param($ClassName,$ErrorAction) if($ClassName -ne 'SoftwareLicensingProduct'){throw 'CLASS'};return $script:rows}
$b=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${block}'))
function LicenseRow($family,$addon,$status){return [pscustomobject]@{ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f';PartialProductKey='fixture';LicenseFamily=$family;LicenseIsAddon=$addon;LicenseStatus=$status}}
$state=@{script=@{}};$script:rows=@((LicenseRow 'Professional' $true 1),(LicenseRow 'Enterprise' $false 1));Invoke-Expression $b;if($state.script.activationObserved){throw 'FALSE_POSITIVE'}
$script:rows=@((LicenseRow 'Professional' $false 0));Invoke-Expression $b;if($state.script.activationObserved){throw 'UNLICENSED'}
$script:rows=@((LicenseRow 'Professional' $false 1));Invoke-Expression $b;if(-not $state.script.activationObserved){throw 'MISSING'}
Write-Output 'PASS_OBSERVATION'`;
      expect(
        execFileSync(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-Command", code],
          { encoding: "utf8" }
        ).trim()
      ).toBe("PASS_OBSERVATION");
    }
  );
});
