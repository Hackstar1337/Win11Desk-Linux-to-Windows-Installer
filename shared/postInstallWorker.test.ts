import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachedScript, type PostInstallPlan } from "./postInstall";
import { postInstallWorker } from "./postInstallWorker";

const plan = (
  overrides: Partial<PostInstallPlan["options"]> = {}
): PostInstallPlan => ({
  version: 1,
  options: {
    getFiles: false,
    apps: [],
    customFileUrl: "",
    runAttachedScript: false,
    ...overrides,
  },
  files: [],
  script: null,
});

function powershellAvailable() {
  try {
    execFileSync(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$PSVersionTable.PSVersion.Major",
      ],
      {
        stdio: "ignore",
      }
    );
    return "pwsh";
  } catch {
    try {
      execFileSync(
        "powershell",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$PSVersionTable.PSVersion.Major",
        ],
        {
          stdio: "ignore",
        }
      );
      return "powershell";
    } catch {
      return null;
    }
  }
}

describe("post-install worker generator", () => {
  it("returns no worker at all when both post-install flags are off", () => {
    expect(postInstallWorker(plan())).toBe("");
  });

  it("embeds only base64 JSON plan data and uses the existing callback variables", () => {
    const current = plan({ getFiles: true });
    current.files = [
      {
        id: "custom",
        name: "Custom archive",
        version: "user",
        filename: "tools.zip",
        url: "https://downloads.example/tools.zip",
        sha256: "a".repeat(64),
        maxBytes: 100 * 1024 * 1024,
        publisher: null,
        requireSignature: false,
        minBuild: 0,
      },
    ];
    const generated = postInstallWorker(current);
    const match = generated.match(/FromBase64String\('([^']+)'\)/);
    expect(match).not.toBeNull();
    expect(
      JSON.parse(Buffer.from(match![1], "base64").toString("utf8"))
    ).toEqual(current);
    expect(generated).toContain("$origin");
    expect(generated).toContain("$run");
    expect(generated).toContain("$headers");
    expect(generated).toContain(
      "/api/installer/tracking/runs/' + [string]$run + '/post-install"
    );
    expect(generated).not.toContain("MAS_AIO.bat:");
  });

  it("contains no second scheduler/service and stages files on the Public Desktop only", () => {
    const generated = postInstallWorker(plan({ getFiles: true }));
    expect(generated).not.toMatch(
      /Register-ScheduledTask|New-ScheduledTask|schtasks|New-Service|sc\.exe/i
    );
    expect(generated).toContain(
      "Join-Path $env:Public 'Desktop\\Win11Desk Installers'"
    );
    expect(generated).not.toContain("$env:USERPROFILE\\Desktop");
    expect(generated).toContain(".partial");
    expect(generated).toContain(
      "Move-Item -LiteralPath $part -Destination $destination -Force"
    );
  });

  it("enforces HTTPS 443, redirect, DNS, streaming, cap, and integrity checks", () => {
    const generated = postInstallWorker(plan({ getFiles: true }));
    for (const fragment of [
      "AllowAutoRedirect = $false",
      "$uri.Scheme -ne 'https' -or $uri.Port -ne 443",
      "Assert-PublicHost $uri.DnsSafeHost",
      "$redirects -ge 5",
      "CancelAfter(15000)",
      "$deadline.Elapsed.TotalSeconds -gt 900",
      "throw 'SIZE_LIMIT'",
      "Get-FileHash -LiteralPath $destination -Algorithm SHA256",
      "throw 'HTML_REJECTED'",
      "throw 'MAGIC_INVALID'",
    ])
      expect(generated).toContain(fragment);
    expect(generated).toContain("for ($attempt = 1; $attempt -le 3");
    expect(generated).toContain("$b[0] -eq 169 -and $b[1] -eq 254");
    expect(generated).toContain("$address.IsIPv6LinkLocal");
  });

  it("keeps report payloads typed and callbacks sanitized/bounded", () => {
    const generated = postInstallWorker(plan({ getFiles: true }));
    expect(generated).toContain("status = [string]$_.status");
    expect(generated).toContain("bytes = [int64]$_.bytes");
    expect(generated).toContain("activationObserved");
    expect(generated).toContain("for ($i = 0; $i -lt 3; $i++)");
    expect(generated).toContain("-TimeoutSec 12");
    expect(generated).not.toContain("$_.Exception.ToString()");
    expect(generated).not.toContain("stdout = [string]");
  });

  it("gates attachment reads on the flag and verifies/copies it before one native cmd run", () => {
    const current = plan({ runAttachedScript: true });
    current.script = attachedScript;
    const generated = postInstallWorker(current);
    expect(generated).toContain(
      "if ([bool]$state.script.enabled -and $state.script.status -eq 'pending')"
    );
    expect(generated).toContain(
      "Join-Path $env:SystemDrive 'win11desk-attached.bat'"
    );
    expect(generated).toContain("throw 'SCRIPT_HASH_MISMATCH'");
    expect(generated).toContain("throw 'SCRIPT_COPY_MISMATCH'");
    expect(generated).toContain("$state.scriptStarted = $true");
    expect(generated).toContain("Sysnative\\cmd.exe");
    expect(generated).toContain("/HWID /HWID-NoEditionChange");
    expect(generated).toContain("taskkill.exe");
    expect(generated).toContain(
      "Get-CimInstance -ClassName SoftwareLicensingProduct"
    );
    expect(generated).toContain("LicenseStatus -eq 1");
    expect(generated).not.toContain("Register-ScheduledTask");
  });

  it("marks an interrupted started script final without replaying it", () => {
    const current = plan({ runAttachedScript: true });
    current.script = attachedScript;
    const generated = postInstallWorker(current);
    expect(generated).toContain(
      "$state.scriptStarted -eq $true -and $state.scriptFinal -ne $true"
    );
    expect(generated).toContain("$state.script.status = 'interrupted'");
    expect(generated).toContain("$state.scriptFinal = $true");
    expect(generated).toContain("$state.overallFinal -eq $true");
  });

  it("parses as PowerShell when a parser is available", () => {
    const shell = powershellAvailable();
    if (!shell) return;
    const dir = mkdtempSync(path.join(tmpdir(), "post-install-worker-"));
    try {
      const file = path.join(dir, "worker.ps1");
      writeFileSync(file, postInstallWorker(plan({ getFiles: true })));
      const command =
        "$tokens=$null; $errors=$null; $null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '" +
        file.replaceAll("'", "''") +
        "'), [ref]$null, [ref]$errors); if ($errors.Count) { $errors | % Message; exit 1 }";
      execFileSync(
        shell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8" }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
