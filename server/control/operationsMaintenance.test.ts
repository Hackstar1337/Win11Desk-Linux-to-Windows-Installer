import { describe, expect, it } from "vitest";
import {
  evaluateMaintenanceSnapshot,
  type MaintenanceSnapshot,
} from "./operationsMaintenance";

const at = new Date("2026-10-15T00:00:00.000Z");
const command = (
  id: string,
  group: string,
  expiresAt: string,
  revoked_at: unknown = null,
  config_json: unknown = {}
) => ({
  id,
  workspace_id: "default",
  group_id: group,
  expires_at: expiresAt,
  revoked_at,
  config_json,
});
const run = (
  id: string,
  command_id: string,
  group_id: string,
  stage: string
) => ({
  run_id: id,
  workspace_id: "default",
  command_id,
  group_id,
  stage,
  archived_at: null,
  trashed_at: null,
  purged_at: null,
});
function snapshot(
  partial: Partial<MaintenanceSnapshot> = {}
): MaintenanceSnapshot {
  return {
    commands: [],
    runs: [],
    trackerRuns: [],
    trackerGroups: [],
    jobs: [],
    reviews: [],
    checks: [],
    secrets: [],
    notifications: [],
    tickets: [],
    ...partial,
  };
}

describe("operations maintenance contracts", () => {
  it("returns the stable preview shape and exact confirmation phrase", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot(),
      "finished",
      at
    ).preview;
    expect(result).toMatchObject({
      mode: "finished",
      checkedAt: at.toISOString(),
      confirmPhrase: "CLEAR FINISHED HISTORY",
      counts: expect.any(Object),
      protectedCounts: expect.any(Object),
      blockers: [],
      canClear: true,
      retained: expect.arrayContaining([
        "wc_accounts",
        "wc_sessions.current_browser_and_other_accounts",
        "wc_profiles",
        "wc_settings",
      ]),
    });
    expect(result.previewDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("protects a live command and its terminal sibling group in finished mode", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        commands: [
          command("live", "group", "2026-10-16T00:00:00.000Z"),
          command("old", "group", "2026-10-01T00:00:00.000Z"),
        ],
        runs: [run("done", "old", "group", "failed")],
      }),
      "finished",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.blockers).toEqual([]);
    expect(result.preview.protectedCounts.live_command).toBeGreaterThan(0);
    expect(result.preview.counts.wc_commands).toBe(0);
  });

  it("clears all mode even while a control run is active", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        commands: [command("active", "group", "2026-10-01T00:00:00.000Z")],
        runs: [run("run", "active", "group", "downloading")],
      }),
      "all",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.blockers).toEqual([]);
    expect(result.deleteIds.wc_run_meta).toEqual(["run"]);
  });

  it("allows all mode to delete an unused live command atomically", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        commands: [command("unused", "group", "2026-10-16T00:00:00.000Z")],
      }),
      "all",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.counts.wc_commands).toBe(1);
    expect(result.preview.counts.wc_delivery_secrets).toBe(1);
    expect(result.preview.counts.wc_command_profiles).toBe(1);
  });

  it("includes unknown remote states and launch uncertainty in unconditional all mode", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        jobs: [
          {
            id: "job-1",
            state: "launch_uncertain",
            review_id: "review",
            command_id: null,
            group_id: null,
            run_id: null,
          },
          {
            id: "job-2",
            state: "future_state",
            review_id: "review",
            command_id: null,
            group_id: null,
            run_id: null,
          },
        ],
      }),
      "all",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.blockers).toEqual([]);
    expect(result.deleteIds.wc_remote_jobs).toEqual(["job-1", "job-2"]);
  });
});

describe("maintenance running-work isolation", () => {
  it("finished cleanup remains possible beside an uncertain job", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        commands: [
          command("old", "old-group", "2026-10-01T00:00:00Z"),
          command("live", "live-group", "2026-10-01T00:00:00Z"),
        ],
        runs: [run("finished", "old", "old-group", "failed")],
        jobs: [
          {
            id: "active",
            state: "launch_uncertain",
            review_id: "r",
            command_id: "live",
            group_id: null,
            run_id: null,
          },
        ],
      }),
      "finished",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.deleteIds.wc_commands).toEqual(["old"]);
    expect(result.preview.protectedCounts.active_remote_job).toBeGreaterThan(0);
  });
  it("does not borrow a completed sibling report for a missing-report run", () => {
    const report = {
      status: "completed",
      files: [],
      script: { enabled: false, status: "disabled" },
    };
    const config = {
      postInstall: { options: { getFiles: true, runAttachedScript: false } },
    };
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        commands: [
          command("shared", "group", "2026-10-01T00:00:00Z", null, config),
        ],
        runs: [
          run("missing", "shared", "group", "windows_ready"),
          {
            ...run("reported", "shared", "group", "windows_ready"),
            post_install_report: report,
          } as any,
        ],
      }),
      "finished",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.protectedCounts.post_install_pending).toBeGreaterThan(
      0
    );
    expect(result.preview.counts.wc_commands).toBe(0);
  });
  it("counts real event rows rather than run keys and includes identities in the digest", () => {
    const data = snapshot({
      commands: [command("old", "g", "2026-10-01T00:00:00Z")],
      runs: [run("done", "old", "g", "failed")],
      dependentRows: {
        wc_events: [
          { key: "e1", parent: "done" },
          { key: "e2", parent: "done" },
        ],
        wc_delivery_secrets: [],
        wc_command_profiles: [],
      },
    });
    const first = evaluateMaintenanceSnapshot(data, "finished", at);
    expect(first.preview.counts.wc_events).toBe(2);
    expect(first.preview.counts.wc_delivery_secrets).toBe(0);
    data.dependentRows!.wc_events[0].key = "replacement";
    expect(
      evaluateMaintenanceSnapshot(data, "finished", at).preview.previewDigest
    ).not.toBe(first.preview.previewDigest);
  });
  it("clears terminal orphan tracker rows in all mode without treating them as live", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        trackerGroups: [{ id: "g", expiresAt: "2026-10-16T00:00:00Z" }],
        trackerRuns: [
          {
            id: "done",
            groupId: "g",
            stage: "failed",
            expiresAt: "2026-10-16T00:00:00Z",
          },
        ],
      }),
      "all",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.preview.counts.installerTrackingRuns).toBe(1);
  });
});

describe("finished orphan history cleanup", () => {
  it("clears failed orphan history and exact dependents in finished mode", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        runs: [
          run("failed-orphan", "missing-command", "orphan-group", "failed"),
        ],
        trackerGroups: [
          { id: "orphan-group", expiresAt: "2026-10-16T00:00:00Z" },
        ],
        trackerRuns: [
          {
            id: "failed-orphan",
            groupId: "orphan-group",
            stage: "failed",
            expiresAt: "2026-10-16T00:00:00Z",
          },
        ],
        dependentRows: {
          wc_events: [{ key: "event", parent: "failed-orphan" }],
          wc_run_labels: [{ key: "failed-orphan", parent: "failed-orphan" }],
          wc_post_install_runs: [
            { key: "failed-orphan", parent: "failed-orphan" },
          ],
        },
      }),
      "finished",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.deleteIds.wc_run_meta).toEqual(["failed-orphan"]);
    expect(result.preview.counts.wc_events).toBe(1);
    expect(result.deleteIds.installerTrackingRuns).toEqual(["failed-orphan"]);
  });
  it("keeps failed orphan siblings when their group has active or uncertain work", () => {
    const result = evaluateMaintenanceSnapshot(
      snapshot({
        runs: [
          run("failed-orphan", "missing-command", "shared-group", "failed"),
          run(
            "active-orphan",
            "missing-command",
            "shared-group",
            "downloading"
          ),
        ],
      }),
      "finished",
      at
    );
    expect(result.preview.canClear).toBe(true);
    expect(result.deleteIds.wc_run_meta).toEqual([]);
  });
});

describe("unconditional owner reset", () => {
  it("selects running, handed-off, pending optional, orphan tracker and other own login sessions without activity blockers", () => {
    const s = snapshot({
      commands: [
        command("c", "g", "2026-10-16T00:00:00Z", null, {
          postInstall: {
            options: { getFiles: true, runAttachedScript: false },
          },
        }),
      ],
      runs: [run("r", "c", "g", "windows_ready")],
      jobs: [
        {
          id: "j",
          state: "handed_off",
          review_id: "review",
          command_id: "c",
          group_id: "g",
          run_id: "r",
        },
      ],
      trackerRuns: [
        {
          id: "orphan",
          groupId: "orphan-g",
          stage: "downloading",
          expiresAt: "2026-10-16T00:00:00Z",
        },
      ],
      otherLoginSessions: [{ id: "other" }],
    });
    const p = evaluateMaintenanceSnapshot(s, "all", at);
    expect(p.preview.canClear).toBe(true);
    expect(p.preview.blockers).toEqual([]);
    expect(p.preview.protectedCounts).toEqual({});
    expect(p.deleteIds.wc_remote_jobs).toEqual(["j"]);
    expect(p.deleteIds.wc_run_meta).toEqual(["r"]);
    expect(p.deleteIds.installerTrackingRuns).toEqual(["orphan"]);
    expect(p.deleteIds.wc_sessions).toEqual(["other"]);
  });
});
