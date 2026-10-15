import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PostInstallPlan } from "./postInstall";
import {
  postInstallRegistrationScript,
  postInstallStartupScript,
} from "./postInstallStartup";

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
const origin = "https://example.com";
const run = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(64);
const plan: PostInstallPlan = {
  version: 1,
  options: {
    getFiles: true,
    apps: ["chrome"],
    customFileUrl: "",
    runAttachedScript: false,
  },
  files: [
    {
      id: "chrome",
      name: "Chrome",
      version: "stable",
      // The worker only sees this value through its base64 plan transport.
      filename: "ChromeSetup.exe",
      url: "https://downloads.example.com/ChromeSetup.exe",
      sha256: null,
      maxBytes: 100000000,
      publisher: "Google LLC",
      requireSignature: true,
      minBuild: 22000,
    },
  ],
  script: null,
};

function parsePowerShell(file: string) {
  const safePath = file.replaceAll("'", "''");
  return execFileSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${safePath}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count -gt 0){$errors|% Message;exit 1}`,
    ],
    { encoding: "utf8", timeout: 10000 }
  );
}

function extractFunction(script: string, name: string) {
  const start = script.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < script.length; i++) {
    if (script[i] === "{") {
      depth++;
      opened = true;
    } else if (script[i] === "}") {
      depth--;
      if (opened && depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

describe("post-install startup scripts", () => {
  it.skipIf(!hasPowerShell)(
    "parses the generated orchestrator and registration under PowerShell",
    () => {
      const orchestrator = postInstallStartupScript(
        origin,
        run,
        token,
        "3389",
        "windows-11-pro",
        plan
      );
      const registration = postInstallRegistrationScript(run);
      const dir = mkdtempSync(path.join(tmpdir(), "win11desk-post-startup-"));
      try {
        const orchestratorPath = path.join(dir, "worker.ps1");
        const registrationPath = path.join(dir, "register.ps1");
        writeFileSync(orchestratorPath, orchestrator);
        writeFileSync(registrationPath, registration);
        parsePowerShell(orchestratorPath);
        parsePowerShell(registrationPath);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      expect(orchestrator).not.toMatch(/-register(?:\s|['"]|$)/);
      expect(orchestrator).toContain("Test-StartupReadiness");
      expect(orchestrator).toContain("report-delivered.marker");
      expect(registration).toContain("-AtStartup");
      expect(registration).toContain("-AtLogOn");
      expect(registration).toContain("-Once -At");
      expect(registration).toContain(
        "-RepetitionInterval (New-TimeSpan -Minutes 2)"
      );
      expect(registration).toContain(
        "-RepetitionDuration (New-TimeSpan -Hours 24)"
      );
      expect(registration).toContain(
        "-ExecutionTimeLimit (New-TimeSpan -Hours 2)"
      );
      expect(registration).toContain("-MultipleInstances IgnoreNew");
      expect(registration).toContain("-RunOnlyIfIdle:$false");
      expect(registration).toContain("-AllowStartIfOnBatteries");
      expect(registration).toContain("-DontStopIfGoingOnBatteries");
    }
  );

  it.skipIf(!hasPowerShell)(
    "executes extracted helper guards for valid and invalid run/port branches",
    () => {
      const script = postInstallStartupScript(
        origin,
        run,
        token,
        "3389",
        "windows-11-pro",
        plan
      );
      const helpers = [
        extractFunction(script, "Test-StartupCanonicalRun"),
        extractFunction(script, "Test-StartupPort"),
      ].join("\n");
      const result = execFileSync(
        "pwsh",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `${helpers};@(
          (Test-StartupCanonicalRun '${run}'),
          (Test-StartupCanonicalRun 'not-a-run'),
          (Test-StartupPort '3389'),
          (Test-StartupPort '0'),
          (Test-StartupPort '65536')
        ) -join ','`,
        ],
        { encoding: "utf8", timeout: 10000 }
      ).trim();
      expect(result).toBe("True,False,True,False,False");
    }
  );

  it("preserves dynamic tracking placeholders while keeping plan data encoded", () => {
    const script = postInstallStartupScript(
      "$TRACK_ORIGIN",
      "$TRACK_RUN",
      "$TRACK_TOKEN",
      "$RDP_PORT",
      "windows-11-pro",
      plan
    );
    expect(script).toContain("$origin = '$TRACK_ORIGIN'");
    expect(script).toContain("$run = '$TRACK_RUN'");
    expect(script).toContain("$token = '$TRACK_TOKEN'");
    expect(script).toContain("$rdpPortText = '$RDP_PORT'");
    expect(script).not.toContain("ChromeSetup.exe");
    expect(script).toContain("FromBase64String");
  });
});
