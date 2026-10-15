import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  getOs,
  hasOsProof,
  isProfileReady,
  osCatalog,
  profileInputSchema,
} from "./deploymentProfiles";
import { defaults } from "./deployment";
import { linuxInstaller } from "./installer";
import { automaticTarget, defaultIsoUrl } from "./media";
import { windowsReporter } from "./installerTrackingHooks";

describe("deployment profile contracts", () => {
  it("contains 32 distinct x64 RDP-capable Windows ISO selections without fake Linux or Home", () => {
    expect(osCatalog).toHaveLength(32);
    expect(new Set(osCatalog.map(o => o.id)).size).toBe(32);
    expect(new Set(osCatalog.map(o => o.name)).size).toBe(32);
    expect(osCatalog.some(o => /home|linux|ubuntu|debian/i.test(o.name))).toBe(
      false
    );
  });
  it("strictly validates optional media and rejects secrets or executable image syntax", () => {
    const p = { name: "  Standard   EU ", osId: "windows-11-pro", isoUrl: "" };
    expect(profileInputSchema.parse(p).name).toBe("Standard EU");
    expect(profileInputSchema.parse(p).imageName).toBe("");
    expect(
      profileInputSchema.safeParse({ ...p, password: "notallowed" }).success
    ).toBe(false);
    expect(
      profileInputSchema.safeParse({
        ...p,
        isoUrl: "https://user:pass@example.com/a.iso",
      }).success
    ).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...p, imageName: "Windows'; reboot" })
        .success
    ).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...p, username: "Admin." }).success
    ).toBe(false);
    expect(
      profileInputSchema.safeParse({ ...p, username: "Admin-1" }).success
    ).toBe(true);
  });
  it("only reports profiles ready when persisted runtime settings remain valid", () => {
    const ready = {
      name: "Standard EU",
      osId: "windows-11-pro",
      isoUrl: "https://example.com/windows.iso",
      imageName: "",
      description: "",
      username: "Administrator",
      remotePort: 22,
      retries: 10,
      archivedAt: null,
    } as const;
    expect(isProfileReady(ready)).toBe(true);
    expect(isProfileReady({ ...ready, username: "Admin." })).toBe(false);
    expect(isProfileReady({ ...ready, remotePort: 0 })).toBe(false);
    expect(isProfileReady({ ...ready, retries: 21 })).toBe(false);
  });
  it.each(osCatalog.map(o => [o.id, o] as const))(
    "validates selected %s edition/build/installation type and generates Bash without execution",
    (_id, os) => {
      expect(
        hasOsProof(os, os.editions[0], os.minBuild, os.installationType)
      ).toBe(true);
      expect(hasOsProof(os, "Core", os.minBuild, os.installationType)).toBe(
        false
      );
      expect(
        hasOsProof(os, os.editions[0], os.minBuild - 1, os.installationType)
      ).toBe(false);
      expect(
        hasOsProof(os, os.editions[0], os.maxBuild + 1, os.installationType)
      ).toBe(false);
      expect(hasOsProof(os, os.editions[0], os.minBuild, "Server Core")).toBe(
        false
      );
      const script = linuxInstaller(
        { ...defaults, os: os.name, password: "Win123!x" },
        automaticTarget(defaultIsoUrl),
        true,
        {
          automatic: true,
          osId: os.id,
          tracking: {
            origin: "https://installer.example.test",
            groupId: "11111111-1111-4111-8111-111111111111",
            writeToken: "a".repeat(64),
          },
        }
      );
      execFileSync("bash", ["-n"], { input: script });
      expect(script).toContain(os.imageName);
      expect(script).toContain("Required selected image missing");
      const reporter = windowsReporter(
        "https://installer.example.test",
        "run",
        "token",
        "22",
        os
      );
      expect(reporter).toContain(os.editions[0]);
      expect(reporter).toContain("windowsInstallationType");
    }
  );
  it("does not accept Server2025 evidence as Windows11 Pro and supports exact image overrides", () => {
    const os = getOs("windows-11-pro");
    expect(hasOsProof(os, "ServerDatacenter", 26100, "Server")).toBe(false);
    const server = getOs("windows-server-2022-standard-evaluation");
    const script = linuxInstaller(
      { ...defaults, os: server.name, password: "Win123!x" },
      automaticTarget(defaultIsoUrl),
      true,
      {
        automatic: true,
        osId: server.id,
        imageName: "Windows Server Standard Evaluation (Desktop Experience)",
      }
    );
    expect(script).toContain(
      "Windows Server Standard Evaluation (Desktop Experience)"
    );
    expect(() =>
      linuxInstaller(
        { ...defaults, password: "Win123!x" },
        automaticTarget(defaultIsoUrl),
        true,
        { automatic: true, imageName: "x'; touch /tmp/invalid" }
      )
    ).toThrow();
  });
});
