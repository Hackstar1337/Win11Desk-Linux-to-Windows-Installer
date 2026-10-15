import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { defaults } from "./deployment";
import { targetDefaults } from "./installer";
import {
  mediaDraft,
  restoreMedia,
  testedMedia,
  mediaExpiry,
  reusableSettings,
  reusableScript,
  reusableCommand,
} from "./reusableInstaller";
import { decodeReusableSettings } from "../server/reusableInstallerRoutes";
import { sha256 } from "../server/installerTicketCrypto";
const target = {
  ...targetDefaults,
  isoUrl: "https://example.com/win11.iso",
  isoSha256: testedMedia.sha256,
  backupReady: true,
  recoveryReady: true,
  unsupportedHardwareAccepted: true,
};
describe("repeat VPS attachment", () => {
  it("strips every password and private optional setting on both boundaries", () => {
    const data = reusableSettings(
      {
        ...defaults,
        password: "NeverSendSyntheticSecret",
        fileUrl: "https://private.example.com/a.zip",
        apps: ["chrome"],
      },
      target
    );
    expect(JSON.stringify(data)).not.toContain("Secret");
    expect(JSON.stringify(data)).not.toContain("private.example");
    expect(() =>
      reusableScript({ ...data, password: "not permitted" })
    ).toThrow();
    expect(() =>
      reusableScript({
        ...data,
        target: { ...data.target, password: "not permitted" },
      })
    ).toThrow();
    const script = reusableScript(data);
    expect(script).toContain("EMBEDDED_PASSWORD=''");
    expect(script).toContain("read -rs password");
  });
  it("allows reuse with auto targets and retains each actual erase/reboot gate", () => {
    const script = reusableScript(reusableSettings(defaults, target));
    expect(script).toContain("TARGET_DISK='auto'");
    expect(script).toContain("EXPECTED_HOST='auto'");
    expect(script).toContain("AUTO_REBOOT='1'");
    expect(script).toContain("ERASE $EXPECTED_HOST $TARGET_DISK WINDOWS11PRO");
    expect(script).toContain("REBOOT $EXPECTED_HOST $TARGET_DISK WINDOWS11PRO");
    execFileSync("bash", ["-n"], { input: script });
  });
  it("delivers exact hash-checked script with bounded canonical settings", () => {
    const data = reusableSettings(defaults, target);
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
    expect(decodeReusableSettings(encoded)).toEqual(data);
    expect(() => decodeReusableSettings(encoded + "=")).toThrow();
    expect(() => decodeReusableSettings("a".repeat(12001))).toThrow();
    const script = reusableScript(decodeReusableSettings(encoded));
    const cmd = reusableCommand(
      "https://dashboard.example.com",
      encoded,
      sha256(script)
    );
    expect(cmd).toContain("/api/installer/setup.sh");
    expect(cmd).not.toContain("?settings=");
    expect(cmd).toContain("--data-binary @-");
    expect(cmd).toContain(sha256(script));
    expect(cmd).toContain("sha256sum --check --status");
    expect(cmd).not.toContain("Bearer");
    execFileSync("bash", ["-n"], { input: cmd });
    expect(() =>
      reusableCommand("http://localhost", encoded, sha256(script))
    ).toThrow();
  });
  it("stores only media and restores no identity or acknowledgements", () => {
    const data = mediaDraft(target);
    expect(Object.keys(data).sort()).toEqual(["isoSha256", "isoUrl"]);
    expect(restoreMedia(JSON.stringify(data))).toEqual(data);
    expect(() =>
      restoreMedia(JSON.stringify({ ...data, password: "bad" }))
    ).toThrow();
  });
  it("interprets Microsoft P1 expiry without treating arbitrary URLs as authentic", () => {
    expect(
      mediaExpiry(
        "https://software.download.prss.microsoft.com/a.iso?P1=1791923403"
      )
    ).toBe(1791923403000);
    expect(mediaExpiry("https://example.com/a.iso?P1=1791923403")).toBeNull();
    expect(mediaExpiry("not a url")).toBeNull();
  });
});
