import { describe, expect, it } from "vitest";
import {
  buildLegacyImportPlan,
  isTerminalLegacyStage,
  legacyCommandId,
  normalizeLegacyRun,
} from "./operations";

process.env.APP_PUBLIC_URL ??= "https://control.example.test";
process.env.VAULT_KEY ??= "a".repeat(64);
process.env.BOOTSTRAP_SECRET ??= "test-bootstrap-secret-that-is-long-enough";

const groupId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const readToken = "a".repeat(64);
const at = new Date("2026-01-02T03:04:05.000Z");

describe("control operations legacy import contracts", () => {
  it("normalizes a legacy run without carrying arbitrary payload or logs", () => {
    const run = normalizeLegacyRun(
      {
        id: runId,
        hostname: "legacy-host",
        wholeDisk: "/dev/sda",
        rdpPort: 3389,
        stage: "completed",
        sequence: 7,
        windowsEdition: "Windows 11 Professional",
        windowsBuild: 22631,
        rdpListening: true,

        createdAt: at,
        updatedAt: new Date(at.getTime() + 1000),
        logs: "must not be imported",
        proof: { password: "must not be imported" },
      },
      groupId,
      at
    );

    expect(run.runId).toBe(runId);
    expect(run.groupId).toBe(groupId);
    expect(run.stage).toBe("windows_ready");
    expect(run.proof).toEqual({
      windowsEdition: "Windows 11 Professional",
      windowsBuild: 22631,
      rdpListening: true,
    });
    expect(JSON.stringify(run)).not.toContain("must not be imported");
  });

  it("maps terminal statuses and bounds unsafe legacy values", () => {
    const failed = normalizeLegacyRun(
      {
        runId,
        status: "error",
        hostname: "bad\u0000host",
        rdpPort: 99999,
        windowsBuild: -1,
        rdpListening: "maybe",
      },
      groupId,
      at
    );
    expect(failed.stage).toBe("failed");
    expect(failed.hostname).toBeNull();
    expect(failed.rdpPort).toBeNull();
    expect(failed.windowsBuild).toBeNull();
    expect(failed.rdpListening).toBeNull();
    expect(isTerminalLegacyStage(failed.stage)).toBe(true);
  });

  it("builds an idempotent, non-deliverable synthetic command plan", () => {
    const first = buildLegacyImportPlan(
      { runId, stage: "failed", createdAt: at, updatedAt: at },
      groupId,
      "owner-1",
      readToken,
      at
    );
    const second = buildLegacyImportPlan(
      { runId, stage: "failed", createdAt: at, updatedAt: at },
      groupId,
      "owner-1",
      readToken,
      at
    );

    expect(first.commandId).toBe(legacyCommandId(runId));
    expect(first.commandId).toBe(second.commandId);
    expect(first.runValues[25]).toBe(0); // credential_available
    expect(first.commandValues[5]).toBe("Legacy import");
    expect(first.commandValues[35]).toEqual(new Date(0)); // expires_at
    expect(first.commandValues[36]).toEqual(at); // revoked_at
    expect(first.eventValues[6]).toEqual("{}"); // no proof/logs on this run
    expect(first.commandValues).toHaveLength(40);
    expect(first.runValues).toHaveLength(32);
  });
});
