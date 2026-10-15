import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  postInstallRegistrationScript,
  postInstallStartupScript,
} from "./postInstallStartup";
import { postInstallWorker } from "./postInstallWorker";
import { attachedScript, defaultPostInstallOptions } from "./postInstall";
const observedRun = "06b6faaf-88cd-be78-a4d4-6b8f1945d397";
const ids = [
  observedRun,
  "37a5e45a-1847-8939-ebc6-f37a6ea28f82",
  "aaaaaaaa-bbbb-0000-1234-cccccccccccc",
];
const plan = {
  version: 1 as const,
  options: {
    ...defaultPostInstallOptions,
    getFiles: true,
    apps: ["chrome" as const],
    runAttachedScript: true,
  },
  files: [],
  script: attachedScript,
};
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
function execute(body: string) {
  return execFileSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", body],
    { encoding: "utf8", timeout: 20000 }
  ).trim();
}
function guard(source: string) {
  const start = source.indexOf("function Test-StartupCanonicalRun");
  const end = source.indexOf("\n}", start);
  return source.slice(start, end + 2);
}
describe("tracker hash run IDs in optional native startup", () => {
  it("accepts existing tracker IDs without changing their identity or broadening path inputs", () => {
    for (const id of ids) {
      expect(postInstallRegistrationScript(id)).toContain(`$run = '${id}'`);
      expect(
        postInstallStartupScript(
          "https://fixture.example.com",
          id,
          "a".repeat(64),
          "22",
          "windows-11-pro",
          plan
        )
      ).toContain(`$run = '${id}'`);
    }
    for (const id of [
      "../run",
      observedRun + "/../other",
      observedRun + "'",
      observedRun.toUpperCase(),
      "bad",
      "00000000-0000-0000-0000-00000000000g",
    ])
      expect(() => postInstallRegistrationScript(id)).toThrow();
  });
  it.skipIf(!havePS)(
    "executes both actual emitted run guards with valid hash IDs and rejects injected paths",
    () => {
      for (const body of [
        postInstallRegistrationScript("$TRACK_RUN"),
        postInstallStartupScript(
          "$TRACK_ORIGIN",
          "$TRACK_RUN",
          "$TRACK_TOKEN",
          "$RDP_PORT",
          "windows-11-pro",
          plan
        ),
      ]) {
        const result = execute(
          `${guard(body)};@(${ids.map(id => `(Test-StartupCanonicalRun '${id}')`).join(",")},(Test-StartupCanonicalRun '../bad'),(Test-StartupCanonicalRun '${observedRun}/x')) -join ','`
        );
        expect(result).toBe("True,True,True,False,False");
      }
    }
  );
  it.skipIf(!havePS)(
    "materializes full registration with an observed run and reaches only mocked native registration",
    () => {
      let body = postInstallRegistrationScript("$TRACK_RUN").replace(
        "$run = '$TRACK_RUN'",
        `$run = '${observedRun}'`
      );
      const at = body.indexOf("$run =");
      body =
        body.slice(0, at) +
        String.raw`
function Set-StartupAcl { param($path,$directory) }
function Start-Service { param($Name,$ErrorAction) if($Name -ne 'Schedule'){throw 'SERVICE'} }
function Register-StartupTask { param($name,$worker) $script:taskName=$name; $script:worker=$worker }
` +
        body.slice(at);
      const encoded = Buffer.from(body).toString("base64");
      const result =
        execute(String.raw`$ErrorActionPreference='Stop';$root=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString());[void][IO.Directory]::CreateDirectory($root);$oldData=$env:ProgramData;$oldDrive=$env:SystemDrive;$env:ProgramData=$root;$env:SystemDrive=$root
try{
 [IO.File]::WriteAllText((Join-Path $root 'win11desk-post.ps1'),'# fixture; never executed')
 $source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));Invoke-Expression $source
 if($script:taskName -ne 'Win11DeskPostInstall-${observedRun}'){throw 'REGISTRATION_NOT_REACHED'}
 if(-not (Test-Path -LiteralPath (Join-Path (Split-Path $script:worker) 'task-registered.marker'))){throw 'NO_MARKER'}
 Write-Output 'PASS_OBSERVED_RUN_NATIVE_REGISTRATION'
}finally{$env:ProgramData=$oldData;$env:SystemDrive=$oldDrive;Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}`);
      expect(result).toBe("PASS_OBSERVED_RUN_NATIVE_REGISTRATION");
    }
  );
  it("downloads files before script execution and moves licensing-service waits into the script action", () => {
    const worker = postInstallWorker(plan);
    expect(
      worker.indexOf("foreach ($fileState in @($state.files))")
    ).toBeLessThan(worker.indexOf("if ([bool]$state.script.enabled"));
    expect(worker.indexOf("if (-not (Wait-ScriptService))")).toBeGreaterThan(
      worker.indexOf("foreach ($fileState in @($state.files))")
    );
    expect(worker.indexOf("if (-not (Wait-ScriptService))")).toBeLessThan(
      worker.indexOf("$process.Start()")
    );
    expect(worker).toContain(
      "if (-not (Wait-ScriptService)) { throw 'SPPSVC_NOT_READY' }"
    );
    const startup = postInstallStartupScript(
      "https://fixture.example.com",
      observedRun,
      "a".repeat(64),
      "22",
      "windows-11-pro",
      plan
    );
    const readiness = startup.slice(
      startup.indexOf("function Test-StartupReadiness"),
      startup.indexOf("function Send-StartupWindowsReady")
    );
    expect(readiness).toContain("if ($false)");
    expect(worker).toContain("throw 'SHA256_MISMATCH'");
    expect(worker).toContain("throw 'SIGNATURE_INVALID'");
  });
});

describe("optional script cannot leave files or a started process stranded", () => {
  it.skipIf(!havePS)(
    "bounds service retries and finalizes the script failure while retaining downloaded files",
    () => {
      const source = postInstallWorker(plan);
      const code = String.raw`$ErrorActionPreference='Stop';Set-StrictMode -Version 2
$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}'));$t=$null;$e=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e);if($e.Count){throw 'PARSE'}
foreach($f in $ast.FindAll({param($a)$a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -in @('Wait-ScriptService','Safe-ErrorCode','Stop-AttachedProcess')},$true)){Invoke-Expression $f.Extent.Text}
$script:reads=0;$script:sleeps=0;function Get-Service{param($Name,$ErrorAction)$script:reads++;throw 'NOT_READY'};function Start-Sleep{param($Seconds)$script:sleeps++;if($Seconds -ne 10){throw 'UNBOUNDED'}}
if(Wait-ScriptService){throw 'FALSE_SERVICE_READY'};if($script:reads -ne 12 -or $script:sleeps -ne 11){throw 'WRONG_BOUND'}
function Save-State{};function Test-SetupFinished{return $true}
$state=@{status='running';files=@(@{status='downloaded'});script=@{enabled=$true;status='pending';errorCode=$null};errorCode=$null;scriptFinal=$false;overallFinal=$false};$plan=@{script=@{name='fixture.bat'}};$env:SystemDrive='/tmp';$stateDir='/tmp';
$a=$s.IndexOf('    if ([bool]$state.script.enabled');$b=$s.IndexOf('    $state.overallFinal = $true',$a);$end=$s.IndexOf('    Save-State',$b)+'    Save-State'.Length;Invoke-Expression $s.Substring($a,$end-$a)
if($state.status -ne 'failed' -or -not $state.overallFinal -or -not $state.scriptFinal -or $state.script.errorCode -ne 'SPPSVC_NOT_READY'){throw 'UNFINALIZED'}
if($state.files[0].status -ne 'downloaded'){throw 'FILES_CHANGED'}
Write-Output 'PASS_BOUNDED_SCRIPT_ONLY_FAILURE_FILES_RETAINED'`;
      expect(execute(code)).toBe(
        "PASS_BOUNDED_SCRIPT_ONLY_FAILURE_FILES_RETAINED"
      );
    }
  );
  it.skipIf(!havePS)(
    "kills and waits for a mocked started child on exception, with disposal guarded in the actual action",
    () => {
      const source = postInstallWorker(plan);
      const code = String.raw`$ErrorActionPreference='Stop';$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}'));$t=$null;$e=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e);$f=$ast.FindAll({param($a)$a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Stop-AttachedProcess'},$true);Invoke-Expression $f[0].Extent.Text
function Join-Path{param($Path,$ChildPath)'taskkill.exe'};function taskkill.exe{$script:kills++}
$script:kills=0;$script:waits=0;$script:fallback=0;$env:windir='/tmp';$p=[pscustomobject]@{Id=42;HasExited=$false};$p|Add-Member ScriptMethod WaitForExit {param($ms)$script:waits++;return $false};$p|Add-Member ScriptMethod Kill {$script:fallback++;$this.HasExited=$true};Stop-AttachedProcess $p;Stop-AttachedProcess $null
if($script:kills -ne 1 -or $script:fallback -ne 1 -or $script:waits -ne 2){throw 'CHILD_NOT_CLEANED'};Write-Output 'PASS_MOCKED_CHILD_CLEANUP'`;
      expect(execute(code)).toBe("PASS_MOCKED_CHILD_CLEANUP");
      expect(source).toContain(
        "} finally { if ($null -ne $process) { $process.Dispose() } }"
      );
    }
  );
});
