import { describe, it, expect } from "vitest";
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPostInstallPayload } from "../server/control/postInstallAssets";
import { validateCommandInput } from "../server/control/admin";
import { windowsReporter, trackingPatchShell } from "./installerTrackingHooks";
import {
  defaultPostInstallOptions,
  postInstallOptionsSchema,
  attachedScript,
} from "./postInstall";
const hash = (s: Buffer | string) =>
  createHash("sha256").update(s).digest("hex");
const ids = {
  origin: "https://installer.example.com",
  run: "11111111-1111-4111-8111-111111111111",
  token: "a".repeat(64),
};
const enabled = () =>
  buildPostInstallPayload(
    {
      ...defaultPostInstallOptions,
      apps: ["chrome", "firefox", "brave", "7zip"],
      getFiles: true,
      runAttachedScript: true,
    },
    "windows-11-pro",
    ids.origin
  )!;
function parser(text: string) {
  try {
    execFileSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
  } catch {
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "post-parser-"));
  try {
    const file = join(dir, "worker.ps1");
    writeFileSync(file, text);
    return execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);if($e.Count){$e|% Message;exit 1}`,
      ],
      { encoding: "utf8" }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("per-install optional actions", () => {
  it("defaults Off, rejects empty selections, unknown and private custom URLs", () => {
    expect(postInstallOptionsSchema.parse({})).toEqual(
      defaultPostInstallOptions
    );
    for (const input of [
      { getFiles: true },
      { apps: ["evil"] },
      { getFiles: true, customFileUrl: "https://127.0.0.1/file.zip" },
      { getFiles: true, customFileUrl: "https://files.example.com/test.bat" },
      { getFiles: true, apps: ["edge", "edge"] },
    ])
      expect(postInstallOptionsSchema.safeParse(input).success).toBe(false);
    expect(
      buildPostInstallPayload(defaultPostInstallOptions, "windows-11-pro")
    ).toBeUndefined();
  });
  it("pins exact batch and only selected sources; Server forbids this batch", () => {
    const p = enabled();
    expect(hash(Buffer.from(p.scriptBase64!, "base64"))).toBe(
      attachedScript.sha256
    );
    expect(
      Buffer.from(p.scriptBase64!, "base64").equals(
        readFileSync("vendor/post-install/MAS_AIO.bat")
      )
    ).toBe(true);
    expect(p.plan.files).toHaveLength(4);
    expect(p.plan.files.find(f => f.id === "chrome")).toMatchObject({
      sha256:
        "2684f9be514e035224363ed120077dfbe09975a90c35126d188aeec4aff42d1e",
      filename: "ChromeSetup.exe",
      requireSignature: true,
      publisher: "Google LLC",
    });
    expect(
      p.plan.files.filter(f => f.id !== "chrome").every(f => !!f.sha256)
    ).toBe(true);
    expect(() =>
      buildPostInstallPayload(
        { ...defaultPostInstallOptions, runAttachedScript: true },
        "windows-server-2022-standard"
      )
    ).toThrow(/Windows Server/);
    const files = buildPostInstallPayload(
      { ...defaultPostInstallOptions, getFiles: true, apps: ["firefox"] },
      "windows-11-pro"
    )!;
    expect(files.scriptBase64).toBeUndefined();
    expect(files.plan.files.map(f => f.id)).toEqual(["firefox"]);
  });
  it("keeps valid explicit Off omitted from legacy normalized fingerprints", () => {
    const b = {
      profileId: ids.run,
      profileRevision: 1,
      username: "Administrator",
      password: "Synthetic!123",
      idempotencyKey: ids.run,
    };
    expect(
      validateCommandInput({ ...b, postInstall: defaultPostInstallOptions })
    ).toEqual(validateCommandInput(b));
    expect(() =>
      validateCommandInput({ ...b, postInstall: { getFiles: true } })
    ).toThrow(/Select at least/);
  });
  it("stages exact batch and separate startup job only when options enabled", () => {
    const p = enabled(),
      s = trackingPatchShell("windows-11-pro", "Windows 11 Pro", p);
    execFileSync("bash", ["-n"], { input: s });
    const block = s.match(/<<'ATTACHED_BYTES'\n([\s\S]*?)\nATTACHED_BYTES/);
    expect(!!block).toBe(true);
    expect(hash(Buffer.from(block![1], "base64"))).toBe(attachedScript.sha256);
    expect((s.match(/schtasks \/Create/g) || []).length).toBe(1);
    expect(s.includes("cp /configs/win11desk-attached.bat")).toBe(true);
    expect(s).toContain("win11desk-post-register.ps1");
    expect(s).toContain("Register-StartupTask");
    expect(s).toContain("$postRegisteredMarker");
    expect(s).toContain("/SC MINUTE /MO 2");
    expect(trackingPatchShell().includes("ATTACHED_BYTES")).toBe(false);
    parser(
      windowsReporter(
        ids.origin,
        ids.run,
        ids.token,
        "22",
        "windows-11-pro",
        p.plan
      )
    );
  });
  it("emits byte-identical legacy reporter and tracking hooks when options are absent", () => {
    const old = readFileSync(
      "test/fixtures/tracking-hooks-before-post-install.txt",
      "utf8"
    );
    const built = buildSync({
      stdin: {
        contents: old,
        resolveDir: resolve("shared"),
        sourcefile: "baseline.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
    });
    const dir = mkdtempSync(join(tmpdir(), "post-baseline-"));
    try {
      const file = join(dir, "old.cjs");
      writeFileSync(file, built.outputFiles[0].contents);
      const baseline = createRequire(import.meta.url)(file);
      expect(hash(windowsReporter(ids.origin, ids.run, ids.token, "22"))).toBe(
        hash(baseline.windowsReporter(ids.origin, ids.run, ids.token, "22"))
      );
      expect(hash(trackingPatchShell())).toBe(
        hash(baseline.trackingPatchShell())
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
