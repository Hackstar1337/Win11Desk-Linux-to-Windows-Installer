import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  attachedScript,
  type PostInstallPlan,
  type PostInstallReport,
} from "../../shared/postInstall";

const { execute, transaction } = vi.hoisted(() => {
  const execute = vi.fn();
  const transaction = vi.fn(
    async (callback: (tx: { execute: typeof execute }) => unknown) =>
      callback({ execute })
  );
  return { execute, transaction };
});
vi.mock("./db", () => ({
  rows: vi.fn(),
  transaction,
}));

import {
  isPostInstallExpiryValid,
  recordPostInstallReport,
  validPostInstallTransition,
  validateReportForPlan,
} from "./postInstallReports";

const runId = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);
const fileSha = "b".repeat(64);
const plan: PostInstallPlan = {
  version: 1,
  options: {
    getFiles: true,
    apps: ["chrome"],
    customFileUrl: "",
    runAttachedScript: true,
  },
  files: [
    {
      id: "chrome",
      name: "Chrome",
      version: "stable",
      filename: "ChromeSetup.exe",
      url: "https://downloads.example.com/ChromeSetup.exe",
      sha256: fileSha,
      maxBytes: 1000,
      publisher: "Google",
      requireSignature: true,
      minBuild: 22000,
    },
  ],
  script: attachedScript,
};

function report(overrides: Partial<PostInstallReport> = {}): PostInstallReport {
  return {
    status: "running",
    files: [
      {
        id: "chrome",
        status: "downloaded",
        bytes: 10,
        sha256: fileSha,
        errorCode: null,
      },
    ],
    script: {
      enabled: true,
      status: "running",
      exitCode: null,
      activationObserved: null,
      errorCode: null,
    },
    errorCode: null,
    ...overrides,
  };
}

describe("post-install report contracts", () => {
  it("requires pinned digests and bounded positive downloaded bytes", () => {
    expect(() =>
      validateReportForPlan(
        report({ files: [{ ...report().files[0], sha256: "c".repeat(64) }] }),
        plan
      )
    ).toThrow();
    expect(() =>
      validateReportForPlan(
        report({ files: [{ ...report().files[0], bytes: 0 }] }),
        plan
      )
    ).toThrow();
    expect(() =>
      validateReportForPlan(
        report({ files: [{ ...report().files[0], bytes: 1001 }] }),
        plan
      )
    ).toThrow();
  });

  it("rejects unknown and duplicate file IDs and false activation completion", () => {
    expect(() =>
      validateReportForPlan(
        report({ files: [{ ...report().files[0], id: "custom" as "chrome" }] }),
        plan
      )
    ).toThrow();
    expect(() =>
      validateReportForPlan(
        report({
          script: {
            enabled: true,
            status: "completed",
            exitCode: 0,
            activationObserved: false,
            errorCode: null,
          },
        }),
        plan
      )
    ).toThrow();
  });

  it("only allows overall completion after every action completes", () => {
    expect(() =>
      validateReportForPlan(report({ status: "completed" }), plan)
    ).toThrow();
    expect(
      validateReportForPlan(
        report({
          status: "completed",
          script: {
            enabled: true,
            status: "completed",
            exitCode: 0,
            activationObserved: true,
            errorCode: null,
          },
        }),
        plan
      ).status
    ).toBe("completed");
  });

  it("keeps terminal states immutable and permits only forward transitions", () => {
    expect(validPostInstallTransition("waiting", "running")).toBe(true);
    expect(validPostInstallTransition("running", "completed")).toBe(true);
    expect(validPostInstallTransition("running", "waiting")).toBe(false);
    expect(validPostInstallTransition("completed", "failed")).toBe(false);
    expect(validPostInstallTransition("completed", "completed")).toBe(true);
  });

  it("uses a strict expiry boundary", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(isPostInstallExpiryValid(now + 7 * 24 * 60 * 60 * 1000, now)).toBe(
      true
    );
    expect(isPostInstallExpiryValid(now, now)).toBe(false);
  });

  it("locks the tracking and control rows before inserting the first report", async () => {
    execute
      .mockResolvedValueOnce([
        [
          {
            id: runId,
            groupId: "11111111-1111-4111-8111-111111111111",
            reportTokenHash: createHash("sha256")
              .update(token, "ascii")
              .digest("hex"),
            stage: "windows_ready",
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            run_id: runId,
            workspace_id: "default",
            command_id: "33333333-3333-4333-8333-333333333333",
            stage: "windows_ready",
            purged_at: null,
            config_json: { postInstall: plan },
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      recordPostInstallReport(runId, token, report())
    ).resolves.toEqual({
      idempotent: false,
    });
    expect(execute.mock.calls[0][0]).toContain("installerTrackingRuns");
    expect(execute.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[1][0]).toContain("wc_run_meta");
    expect(execute.mock.calls[1][0]).toContain("wc_commands");
    expect(execute.mock.calls[1][0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[3][0]).toContain(
      "INSERT INTO wc_post_install_runs"
    );
    execute.mockReset();
  });
});
