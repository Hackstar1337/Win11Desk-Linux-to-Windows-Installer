import { describe, expect, it } from "vitest";
import {
  commandPreview,
  defaults,
  deploymentSchema,
  nonSensitiveConfig,
} from "./deployment";

describe("Windows 11 Pro configuration", () => {
  it("allows the one supported OS and valid defaults", () => {
    expect(deploymentSchema.safeParse(defaults).success).toBe(true);
    expect(
      deploymentSchema.safeParse({ ...defaults, os: "Windows 10" }).success
    ).toBe(false);
  });
  it("rejects invalid ports and usernames", () => {
    for (const remotePort of [0, 65536, NaN, 22.5])
      expect(
        deploymentSchema.safeParse({ ...defaults, remotePort }).success
      ).toBe(false);
    for (const username of [
      "",
      "bad/user",
      "trailing.",
      "morethan20characterslong",
    ])
      expect(
        deploymentSchema.safeParse({ ...defaults, username }).success
      ).toBe(false);
  });
  it("validates URLs, hostname and attempts", () => {
    for (const fileUrl of [
      "https://",
      "https://example.com/file.exe",
      "https://user:pass@example.com/file.zip",
    ]) {
      expect(deploymentSchema.safeParse({ ...defaults, fileUrl }).success).toBe(
        false
      );
    }
    expect(
      deploymentSchema.safeParse({ ...defaults, imageUrl: "https://" }).success
    ).toBe(false);
    expect(
      deploymentSchema.safeParse({
        ...defaults,
        fileUrl: "https://example.com/file.zip?token=abc",
      }).success
    ).toBe(true);
    expect(
      deploymentSchema.safeParse({
        ...defaults,
        fileUrl: "http://example.com/file.zip",
      }).success
    ).toBe(false);
    expect(
      deploymentSchema.safeParse({ ...defaults, hostname: "-bad" }).success
    ).toBe(false);
    expect(
      deploymentSchema.safeParse({ ...defaults, retries: 21 }).success
    ).toBe(false);
  });
  it("never persists a password with a draft", () => {
    const saved = nonSensitiveConfig({
      ...defaults,
      password: "unique-test-secret",
    });
    expect(saved).not.toHaveProperty("password");
    expect(JSON.stringify(saved)).not.toContain("unique-test-secret");
  });
  it("uses edited preferences in both previews and redacts secrets by default", () => {
    const config = {
      ...defaults,
      username: "CustomUser",
      password: "unique-test-secret",
      remotePort: 3390,
      privateTracking: false,
    };
    for (const platform of ["linux", "windows"] as const) {
      const output = commandPreview(config, platform);
      expect(output).toContain("CustomUser");
      expect(output).toContain("3390");
      expect(output).toContain('"privateTracking": false');
      expect(output).not.toContain(config.password);
      expect(output).toContain("<PASSWORD_REDACTED>");
      expect(output.split("\n").every(line => line.startsWith("#"))).toBe(true);
      expect(commandPreview(config, platform, true)).toContain(config.password);
    }
  });
  it("keeps multiline malicious strings in comments", () => {
    const output = commandPreview(
      { ...defaults, password: "'\nrm -rf /\n$(touch /tmp/x)" },
      "linux",
      true
    );
    expect(output.split("\n").every(line => line.startsWith("#"))).toBe(true);
  });
  it("includes contextual retry and confirmation preferences", () => {
    const output = commandPreview(
      { ...defaults, initScript: true, retries: 7, preConfirmed: true },
      "linux"
    );
    expect(output).toContain("up to 7 times");
    expect(output).toContain("must still confirm disk replacement");
  });
});
