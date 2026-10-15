import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chromeAttachment, chromeAssetPath } from "./chromeAttachment";
import {
  readChromeAttachment,
  buildPostInstallPayload,
} from "../server/control/postInstallAssets";
import {
  defaultPostInstallOptions,
  selectablePostInstallAppIds,
  postInstallReportSchema,
} from "./postInstall";
import { validatePostInstallPlan } from "../server/control/postInstallReports";

describe("exact Chrome and retired Edge", () => {
  it("pins the exact byte size/hash and first-party filename, never Enterprise MSI", () => {
    const bytes = readChromeAttachment();
    expect(bytes.length).toBe(13283768);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      chromeAttachment.sha256
    );
    const plan = buildPostInstallPayload(
      { ...defaultPostInstallOptions, getFiles: true, apps: ["chrome"] },
      "windows-11-pro",
      "https://testing.example.com"
    )!;
    expect(plan.plan.files[0]).toMatchObject({
      filename: "ChromeSetup.exe",
      url: "https://testing.example.com" + chromeAssetPath,
      sha256: chromeAttachment.sha256,
      maxBytes: chromeAttachment.bytes,
    });
    expect(JSON.stringify(plan)).not.toContain("enterprise64.msi");
  });
  it("does not select Edge in new UI or build a new Edge payload", () => {
    expect(selectablePostInstallAppIds).toEqual([
      "chrome",
      "firefox",
      "brave",
      "7zip",
    ]);
    expect(() =>
      buildPostInstallPayload(
        { ...defaultPostInstallOptions, getFiles: true, apps: ["edge"] },
        "windows-11-pro"
      )
    ).toThrow(/no longer offered/);
  });
  it("still validates immutable historical Edge plans and reports", () => {
    const legacy = {
      version: 1,
      options: { ...defaultPostInstallOptions, getFiles: true, apps: ["edge"] },
      files: [
        {
          id: "edge",
          name: "Microsoft Edge",
          version: "old",
          filename: "Edge.msi",
          url: "https://download.microsoft.com/old.msi",
          sha256: "a".repeat(64),
          maxBytes: 402653184,
          publisher: "Microsoft Corporation",
          requireSignature: false,
          minBuild: 17763,
        },
      ],
      script: null,
    };
    expect(validatePostInstallPlan(legacy).files[0].id).toBe("edge");
    expect(
      postInstallReportSchema.parse({
        status: "completed",
        files: [
          {
            id: "edge",
            status: "downloaded",
            bytes: 42,
            sha256: "a".repeat(64),
          },
        ],
        script: { enabled: false, status: "disabled" },
      }).files[0].id
    ).toBe("edge");
  });
});
