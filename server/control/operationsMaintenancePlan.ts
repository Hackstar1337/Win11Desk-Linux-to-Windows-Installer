import { createHash } from "node:crypto";
import {
  MAINTENANCE_COUNT_KEYS,
  MAINTENANCE_RETAINED,
  MAINTENANCE_CONFIRM_PHRASES,
  type MaintenanceCounts,
  type MaintenanceMode,
  type MaintenancePreview,
} from "../../shared/operationsMaintenance";
import { postInstallReportSchema } from "../../shared/postInstall";
export const MAINTENANCE_WORKSPACE = "default";
export const MAINTENANCE_MAX_ROWS = 10_000;
const TERMINAL_INSTALL_STAGES = new Set(["failed", "windows_ready"]);
const REMOTE_ACTIVE_STATES = new Set([
  "queued",
  "connecting",
  "checking",
  "sending",
  "launching",
  "launch_uncertain",
]);
const REMOTE_CLOSED_STATES = new Set([
  "blocked",
  "connection_failed",
  "cancelled",
  "handed_off",
]);
const POST_TERMINAL = new Set([
  "completed",
  "failed",
  "timed_out",
  "interrupted",
]);
const KNOWN_NONTERMINAL_INSTALL_STAGES = new Set([
  "starting",
  "preflight",
  "staging",
  "rebooting",
  "installer_booted",
  "downloading",
  "media_verified",
  "preparing",
  "windows_setup",
  "windows_booted",
]);

export type MaintenanceSqlConnection = {
  execute: (sql: string, params?: unknown[]) => Promise<any>;
  query?: (sql: string, params?: unknown[]) => Promise<any>;
};

export type MaintenanceCommandRow = {
  id: string;
  workspace_id: string;
  group_id: string;
  expires_at: unknown;
  revoked_at: unknown;
  config_json: unknown;
};
export type MaintenanceRunRow = {
  run_id: string;
  workspace_id: string;
  command_id: string;
  group_id: string;
  stage: string;
  archived_at: unknown;
  trashed_at: unknown;
  purged_at: unknown;
};
export type MaintenanceTrackerRunRow = {
  id: string;
  groupId: string;
  stage: string;
  expiresAt: unknown;
};
export type MaintenanceTrackerGroupRow = {
  id: string;
  expiresAt: unknown;
};
export type MaintenanceRemoteJobRow = {
  id: string;
  state: string;
  review_id: string;
  command_id: string | null;
  group_id: string | null;
  run_id: string | null;
};
export type MaintenanceReviewRow = {
  id: string;
  check_id: string;
  expires_at: unknown;
};
export type MaintenanceCheckRow = { id: string; expires_at: unknown };
export type MaintenanceSecretRow = {
  id: string;
  check_id: string | null;
  review_id: string | null;
  job_id: string | null;
};
export type MaintenanceSnapshot = {
  commands: MaintenanceCommandRow[];
  runs: MaintenanceRunRow[];
  trackerRuns: MaintenanceTrackerRunRow[];
  trackerGroups: MaintenanceTrackerGroupRow[];
  jobs: MaintenanceRemoteJobRow[];
  reviews: MaintenanceReviewRow[];
  checks: MaintenanceCheckRow[];
  secrets: MaintenanceSecretRow[];
  notifications: Array<{ id: string; run_id: string | null }>;
  events?: Array<{ run_id: string; event_id: string }>;
  postInstallRuns?: Array<{ run_id: string }>;
  runLabels?: Array<{ run_id: string }>;
  deliverySecrets?: Array<{ command_id: string }>;
  commandProfiles?: Array<{ command_id: string }>;
  remoteJobEvents?: Array<{ id: string; job_id: string }>;
  tickets: Array<{ id: string; expiresAt: unknown }>;
  otherLoginSessions?: Array<{ id: string }>;
  dependentRows?: Record<string, Array<{ key: string; parent: string }>>;
};

export type DeleteIds = Record<string, string[]>;
export type MaintenancePlan = {
  preview: MaintenancePreview;
  deleteIds: DeleteIds;
};

const RETAINED = [...MAINTENANCE_RETAINED];

function emptyCounts(): MaintenanceCounts {
  return Object.fromEntries(MAINTENANCE_COUNT_KEYS.map(key => [key, 0]));
}
function dateMs(value: unknown): number {
  const result = new Date(String(value ?? "")).getTime();
  return Number.isFinite(result) ? result : NaN;
}
function expired(value: unknown, now: number): boolean {
  const at = dateMs(value);
  return Number.isFinite(at) && at <= now;
}
function parseJson(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A malformed post-install snapshot is unknown state, never proof of completion. */
function postInstallState(
  command: MaintenanceCommandRow,
  run: MaintenanceRunRow | undefined
): "none" | "terminal" | "pending" | "unknown" {
  const config = object(parseJson(command.config_json));
  if (!config) return "unknown";
  if (config.postInstall == null) return "none";
  const plan = object(parseJson(config.postInstall));
  const options = object(plan?.options);
  if (
    !options ||
    typeof options.getFiles !== "boolean" ||
    typeof options.runAttachedScript !== "boolean"
  )
    return "unknown";
  const enabled =
    options.getFiles === true || options.runAttachedScript === true;
  if (!enabled) return "none";
  if (!run || run.stage !== "windows_ready") return "pending";
  // The report is joined by the SQL snapshot before classification when present.
  const report = object(
    parseJson(
      (
        run as
          | (MaintenanceRunRow & { post_install_report?: unknown })
          | undefined
      )?.post_install_report
    )
  );
  if (!report) return "pending";
  const parsed = postInstallReportSchema.safeParse(report);
  if (!parsed.success) return "unknown";
  return POST_TERMINAL.has(parsed.data.status) ? "terminal" : "pending";
}

function addId(ids: DeleteIds, key: string, id: string): void {
  (ids[key] ||= []).push(id);
}
function addProtected(
  protectedCounts: Record<string, number>,
  reason: string
): void {
  protectedCounts[reason] = (protectedCounts[reason] || 0) + 1;
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}
function stableDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function emptyDeleteIds(): DeleteIds {
  return Object.fromEntries(MAINTENANCE_COUNT_KEYS.map(key => [key, []]));
}

function rowKey(row: { id?: unknown; run_id?: unknown }): string {
  return String(row.id ?? row.run_id ?? "");
}

/** Explicit owner reset: scope is all records present at commit, regardless of status. */
function fullResetPlan(
  snapshot: MaintenanceSnapshot,
  checkedAt: Date
): MaintenancePlan {
  const deleteIds = emptyDeleteIds();
  const groups: Record<string, string[]> = {
    wc_commands: snapshot.commands.map(r => r.id),
    wc_run_meta: snapshot.runs.map(r => r.run_id),
    wc_remote_jobs: snapshot.jobs.map(r => r.id),
    wc_remote_reviews: snapshot.reviews.map(r => r.id),
    wc_remote_checks: snapshot.checks.map(r => r.id),
    wc_remote_secrets: snapshot.secrets.map(r => r.id),
    wc_notifications: snapshot.notifications.map(r => r.id),
    installerTickets: snapshot.tickets.map(r => r.id),
    installerTrackingRuns: snapshot.trackerRuns.map(r => r.id),
    installerTrackingGroups: snapshot.trackerGroups.map(r => r.id),
    wc_sessions: (snapshot.otherLoginSessions || []).map(r => r.id),
    wc_remote_trust: (
      (snapshot as MaintenanceSnapshot & { trusts?: Array<{ id: string }> })
        .trusts || []
    ).map(r => r.id),
  };
  for (const table of ["wc_events", "wc_run_labels", "wc_post_install_runs"])
    groups[table] = groups.wc_run_meta;
  for (const table of ["wc_delivery_secrets", "wc_command_profiles"])
    groups[table] = groups.wc_commands;
  groups.wc_remote_job_events = groups.wc_remote_jobs;
  for (const [table, ids] of Object.entries(groups))
    deleteIds[table] = [...new Set(ids)];
  // Include orphan children as well: force reset intentionally leaves no installation history.
  for (const [table, items] of Object.entries(snapshot.dependentRows || {}))
    deleteIds[table] = [
      ...new Set([...deleteIds[table], ...items.map(r => r.parent)]),
    ];
  const counts = emptyCounts();
  for (const [table, ids] of Object.entries(deleteIds))
    counts[table] = snapshot.dependentRows?.[table]?.length ?? ids.length;
  return {
    deleteIds,
    preview: {
      mode: "all",
      checkedAt: checkedAt.toISOString(),
      previewDigest: stableDigest({
        mode: "all",
        deleteIds,
        dependent: snapshot.dependentRows,
        counts,
      }),
      confirmPhrase: MAINTENANCE_CONFIRM_PHRASES.all,
      counts,
      protectedCounts: {},
      blockers: [],
      canClear: true,
      retained: RETAINED,
    },
  };
}

/**
 * Pure classification used by both the real transaction and isolated dependency-fake tests.
 * It intentionally prefers protecting a row over making a deletion guess.
 */
export function evaluateMaintenanceSnapshot(
  snapshot: MaintenanceSnapshot,
  mode: MaintenanceMode,
  checkedAt = new Date()
): MaintenancePlan {
  const reset = mode === "all" ? fullResetPlan(snapshot, checkedAt) : null;
  if (reset) return reset;
  const now = checkedAt.getTime();
  const counts = emptyCounts();
  const protectedCounts: Record<string, number> = {};
  const blockers = new Set<string>();
  const deleteIds = emptyDeleteIds();
  const runsByCommand = new Map<string, MaintenanceRunRow[]>();
  const runsByGroup = new Map<string, MaintenanceRunRow[]>();
  const commandById = new Map(snapshot.commands.map(row => [row.id, row]));
  const commandsByGroup = new Map<string, MaintenanceCommandRow[]>();
  const trackerByGroup = new Map<string, MaintenanceTrackerRunRow[]>();
  const unresolvedRemote = (job: MaintenanceRemoteJobRow) =>
    REMOTE_ACTIVE_STATES.has(job.state) ||
    !REMOTE_CLOSED_STATES.has(job.state) ||
    (job.state === "handed_off" &&
      !snapshot.runs.some(
        run =>
          (run.run_id === job.run_id || run.command_id === job.command_id) &&
          (run.stage === "failed" ||
            (run.stage === "windows_ready" &&
              commandById.has(run.command_id) &&
              ["none", "terminal"].includes(
                postInstallState(commandById.get(run.command_id)!, run)
              )))
      ));
  const activeRemoteCommandIds = new Set(
    snapshot.jobs
      .filter(job => unresolvedRemote(job) && job.command_id)
      .map(job => job.command_id as string)
  );
  const activeRemoteGroupIds = new Set(
    snapshot.jobs
      .filter(job => unresolvedRemote(job) && job.group_id)
      .map(job => job.group_id as string)
  );

  for (const run of snapshot.runs) {
    (
      runsByCommand.get(run.command_id) ||
      (runsByCommand.set(run.command_id, []),
      runsByCommand.get(run.command_id)!)
    ).push(run);
    (
      runsByGroup.get(run.group_id) ||
      (runsByGroup.set(run.group_id, []), runsByGroup.get(run.group_id)!)
    ).push(run);
  }
  for (const command of snapshot.commands)
    (
      commandsByGroup.get(command.group_id) ||
      (commandsByGroup.set(command.group_id, []),
      commandsByGroup.get(command.group_id)!)
    ).push(command);
  for (const tracker of snapshot.trackerRuns)
    (
      trackerByGroup.get(tracker.groupId) ||
      (trackerByGroup.set(tracker.groupId, []),
      trackerByGroup.get(tracker.groupId)!)
    ).push(tracker);

  const safeGroups = new Set<string>();
  const groupReasons = new Map<string, string>();
  const allGroupIds = new Set([
    ...snapshot.runs.map(row => row.group_id),
    ...snapshot.commands.map(row => row.group_id),
    ...snapshot.trackerGroups.map(row => row.id),
    ...snapshot.trackerRuns.map(row => row.groupId),
  ]);
  for (const groupId of allGroupIds) {
    const commands = commandsByGroup.get(groupId) || [];
    const runs = runsByGroup.get(groupId) || [];
    const trackers = trackerByGroup.get(groupId) || [];
    let reason: string | undefined;
    if (
      activeRemoteGroupIds.has(groupId) ||
      commands.some(command => activeRemoteCommandIds.has(command.id))
    ) {
      reason = "active_remote_job";
      if (mode === "all") blockers.add("active_remote_job");
    }
    if (
      runs.some(
        run =>
          !commandById.has(run.command_id) &&
          !TERMINAL_INSTALL_STAGES.has(run.stage)
      )
    ) {
      reason = "orphan_control_run";
      if (mode === "all") blockers.add("orphan_control_run");
    }
    if (
      mode === "finished" &&
      commands.some(
        command => !command.revoked_at && !expired(command.expires_at, now)
      )
    )
      reason = "live_command";
    for (const run of runs) {
      if (!TERMINAL_INSTALL_STAGES.has(run.stage)) {
        const knownActive = KNOWN_NONTERMINAL_INSTALL_STAGES.has(run.stage);
        reason =
          reason || (knownActive ? "active_run" : "unknown_install_stage");
        if (mode === "all")
          blockers.add(
            run.stage ? "active_control_run" : "unknown_control_run"
          );
        if (!knownActive) blockers.add("unknown_control_run");
      }
      const command = commandById.get(run.command_id);
      if (!command && run.stage === "windows_ready" && !run.purged_at) {
        reason = reason || "missing_command_snapshot";
        if (mode === "all") blockers.add("missing_command_snapshot");
      }
      if (command && run.stage === "windows_ready") {
        const post = postInstallState(command, run);
        if (post === "pending") reason = reason || "post_install_pending";
        if (post === "unknown") reason = reason || "post_install_unknown";
        if (mode === "all" && (post === "pending" || post === "unknown"))
          blockers.add("post_install_unresolved");
      }
    }
    for (const tracker of trackers) {
      if (!TERMINAL_INSTALL_STAGES.has(tracker.stage)) {
        reason = reason || "active_tracker_run";
        if (mode === "all") blockers.add("active_tracker_run");
      }
    }
    if (
      mode === "finished" &&
      commands.length &&
      commands.some(
        command => !command.revoked_at && !expired(command.expires_at, now)
      )
    )
      reason = reason || "live_command";
    if (
      !reason &&
      commands.length &&
      mode === "finished" &&
      commands.some(
        command => !command.revoked_at && !expired(command.expires_at, now)
      )
    )
      reason = "live_command";
    if (!reason) safeGroups.add(groupId);
    else groupReasons.set(groupId, reason);
  }

  // Any active tracker without a control mirror is an explicit fail-safe blocker.
  for (const tracker of snapshot.trackerRuns) {
    const mirror = snapshot.runs.some(run => run.run_id === tracker.id);
    if (!mirror && !TERMINAL_INSTALL_STAGES.has(tracker.stage)) {
      addProtected(protectedCounts, "tracker_without_control_mirror");
      blockers.add("active_tracker_without_control_mirror");
    }
  }

  for (const command of snapshot.commands) {
    const groupSafe = safeGroups.has(command.group_id);
    if (!groupSafe) {
      addProtected(
        protectedCounts,
        groupReasons.get(command.group_id) || "shared_group_protected"
      );
      continue;
    }
    const commandRuns = runsByCommand.get(command.id) || [];
    const eligible =
      mode === "all" ||
      Boolean(command.revoked_at) ||
      expired(command.expires_at, now);
    if (!eligible) {
      addProtected(protectedCounts, "live_command");
      continue;
    }
    // In ALL, a never-registered command is intentionally a candidate: deleting the
    // command and its capabilities atomically makes it unusable before a callback can register.
    addId(deleteIds, "wc_commands", command.id);
    addId(deleteIds, "wc_delivery_secrets", command.id);
    addId(deleteIds, "wc_command_profiles", command.id);
    if (commandRuns.length) {
      for (const run of commandRuns) {
        addId(deleteIds, "wc_run_meta", run.run_id);
        addId(deleteIds, "wc_events", run.run_id);
        addId(deleteIds, "wc_run_labels", run.run_id);
        addId(deleteIds, "wc_post_install_runs", run.run_id);
      }
    }
  }

  // Failed/purged orphan history is safely eligible in both cleanup modes.
  for (const run of snapshot.runs) {
    if (
      !commandById.has(run.command_id) &&
      safeGroups.has(run.group_id) &&
      (run.stage === "failed" || Boolean(run.purged_at))
    ) {
      for (const table of [
        "wc_run_meta",
        "wc_events",
        "wc_run_labels",
        "wc_post_install_runs",
      ])
        addId(deleteIds, table, run.run_id);
    }
  }

  for (const tracker of snapshot.trackerRuns) {
    const hasMirror = snapshot.runs.some(run => run.run_id === tracker.id);
    const safe =
      safeGroups.has(tracker.groupId) &&
      (hasMirror ||
        (mode === "all" && TERMINAL_INSTALL_STAGES.has(tracker.stage)) ||
        expired(tracker.expiresAt, now));
    if (safe) addId(deleteIds, "installerTrackingRuns", tracker.id);
    else {
      addProtected(
        protectedCounts,
        hasMirror
          ? "tracker_group_protected"
          : "active_tracker_without_control_mirror"
      );
      if (
        mode === "all" &&
        !hasMirror &&
        !TERMINAL_INSTALL_STAGES.has(tracker.stage)
      )
        blockers.add("active_tracker_without_control_mirror");
    }
  }
  for (const group of snapshot.trackerGroups) {
    const trackers = trackerByGroup.get(group.id) || [];
    const allRunsSelected = trackers.every(run =>
      deleteIds.installerTrackingRuns.includes(run.id)
    );
    if (
      allRunsSelected &&
      (mode === "all" ||
        safeGroups.has(group.id) ||
        expired(group.expiresAt, now))
    )
      addId(deleteIds, "installerTrackingGroups", group.id);
    else addProtected(protectedCounts, "tracker_group_protected");
  }

  const runsById = new Map(snapshot.runs.map(run => [run.run_id, run]));
  for (const job of snapshot.jobs) {
    const linkedRun =
      (job.run_id && runsById.get(job.run_id)) ||
      (job.command_id && (runsByCommand.get(job.command_id) || [])[0]);
    const linkedGroupProtected = Boolean(
      job.group_id && groupReasons.has(job.group_id)
    );
    const active = REMOTE_ACTIVE_STATES.has(job.state);
    let safe = false;
    if (active) {
      addProtected(
        protectedCounts,
        job.state === "launch_uncertain"
          ? "launch_uncertain"
          : "active_remote_job"
      );
      if (mode === "all")
        blockers.add(
          job.state === "launch_uncertain"
            ? "launch_uncertain"
            : "active_remote_job"
        );
    } else if (job.state === "handed_off") {
      const post =
        linkedRun && linkedRun.stage === "failed"
          ? "none"
          : linkedRun && commandById.get(linkedRun.command_id)
            ? postInstallState(
                commandById.get(linkedRun.command_id)!,
                linkedRun
              )
            : "pending";
      safe = Boolean(
        linkedRun &&
          linkedRun.stage === "windows_ready" &&
          post !== "pending" &&
          post !== "unknown" &&
          !linkedGroupProtected
      );
      if (!safe) {
        addProtected(
          protectedCounts,
          linkedRun
            ? "handed_off_without_terminal_work"
            : "handed_off_without_control_mirror"
        );
        if (mode === "all") blockers.add("handed_off_unresolved");
      }
    } else if (REMOTE_CLOSED_STATES.has(job.state)) {
      safe = !linkedGroupProtected;
      if (!safe) addProtected(protectedCounts, "closed_job_active_link");
    } else {
      addProtected(protectedCounts, "unknown_remote_job_state");
      if (mode === "all") blockers.add("unknown_remote_job_state");
    }
    if (
      safe ||
      (mode === "all" &&
        !active &&
        !linkedGroupProtected &&
        REMOTE_CLOSED_STATES.has(job.state))
    ) {
      addId(deleteIds, "wc_remote_jobs", job.id);
      addId(deleteIds, "wc_remote_job_events", job.id);
    }
  }

  const jobReviewIds = new Set(snapshot.jobs.map(job => job.review_id));
  const selectedReviews = new Set<string>();
  const selectedChecks = new Set<string>();
  for (const review of snapshot.reviews) {
    const safe =
      mode === "all" ||
      (expired(review.expires_at, now) && !jobReviewIds.has(review.id));
    if (safe) {
      selectedReviews.add(review.id);
      addId(deleteIds, "wc_remote_reviews", review.id);
    } else addProtected(protectedCounts, "active_review_or_linked_job");
  }
  for (const check of snapshot.checks) {
    const safe =
      mode === "all" ||
      (expired(check.expires_at, now) &&
        !snapshot.reviews.some(
          review =>
            review.check_id === check.id && !selectedReviews.has(review.id)
        ));
    if (safe) {
      selectedChecks.add(check.id);
      addId(deleteIds, "wc_remote_checks", check.id);
    } else addProtected(protectedCounts, "active_check");
  }
  for (const secret of snapshot.secrets) {
    if (
      mode === "all" ||
      selectedReviews.has(secret.review_id || "") ||
      selectedChecks.has(secret.check_id || "") ||
      deleteIds.wc_remote_jobs.includes(secret.job_id || "")
    )
      addId(deleteIds, "wc_remote_secrets", secret.id);
  }
  const selectedRunIds = new Set(deleteIds.wc_run_meta);
  for (const notification of snapshot.notifications) {
    if (mode === "all" || selectedRunIds.has(notification.run_id || ""))
      addId(deleteIds, "wc_notifications", notification.id);
  }
  for (const ticket of snapshot.tickets) {
    if (mode === "all" || expired(ticket.expiresAt, now))
      addId(deleteIds, "installerTickets", ticket.id);
  }
  if (mode === "all") {
    // Trust rows are installation trust history, never profiles/settings/auth state.
    // The query is workspace-scoped when loaded; IDs are host:port stable keys.
    for (const row of (
      snapshot as MaintenanceSnapshot & { trusts?: Array<{ id: string }> }
    ).trusts || [])
      addId(deleteIds, "wc_remote_trust", row.id);
  }

  const dependentRows = snapshot.dependentRows || {};
  for (const [table, items] of Object.entries(dependentRows)) {
    if (mode === "all") {
      const parents =
        table === "wc_remote_job_events"
          ? new Set(snapshot.jobs.map(row => row.id))
          : ["wc_delivery_secrets", "wc_command_profiles"].includes(table)
            ? new Set(snapshot.commands.map(row => row.id))
            : new Set(snapshot.runs.map(row => row.run_id));
      for (const item of items)
        if (!parents.has(item.parent)) addId(deleteIds, table, item.parent);
    }
  }

  for (const key of Object.keys(deleteIds)) {
    deleteIds[key] = [...new Set(deleteIds[key])];
    counts[key] = dependentRows[key]
      ? dependentRows[key].filter(row => deleteIds[key].includes(row.parent))
          .length
      : deleteIds[key].length;
  }
  const payload = {
    mode,
    commands: snapshot.commands.map(row => ({
      id: row.id,
      group: row.group_id,
      expiry: row.expires_at,
      revoked: Boolean(row.revoked_at),
      config: stableDigest(row.config_json),
    })),
    runs: snapshot.runs.map(row => ({
      id: row.run_id,
      command: row.command_id,
      group: row.group_id,
      stage: row.stage,
      archived: Boolean(row.archived_at),
      trashed: Boolean(row.trashed_at),
      purged: Boolean(row.purged_at),
    })),
    trackers: snapshot.trackerRuns.map(row => ({
      id: row.id,
      group: row.groupId,
      stage: row.stage,
      expiry: row.expiresAt,
    })),
    jobs: snapshot.jobs.map(row => ({
      id: row.id,
      state: row.state,
      command: row.command_id,
      group: row.group_id,
      run: row.run_id,
    })),
    reviews: snapshot.reviews.map(row => ({
      id: row.id,
      expiry: row.expires_at,
    })),
    checks: snapshot.checks.map(row => ({
      id: row.id,
      expiry: row.expires_at,
    })),
    selected: deleteIds,
    dependent: Object.fromEntries(
      Object.entries(dependentRows).map(([key, items]) => [
        key,
        items
          .filter(row => deleteIds[key].includes(row.parent))
          .map(row => row.key),
      ])
    ),
    reports: snapshot.runs.map(run => ({
      id: run.run_id,
      report: stableDigest(
        (run as MaintenanceRunRow & { post_install_report?: unknown })
          .post_install_report ?? null
      ),
    })),
    counts,
    protectedCounts,
    blockers: [...blockers].sort(),
  };
  const previewDigest = stableDigest(payload);
  const canClear = mode === "finished" || blockers.size === 0;
  return {
    preview: {
      mode,
      checkedAt: checkedAt.toISOString(),
      previewDigest,
      confirmPhrase: MAINTENANCE_CONFIRM_PHRASES[mode],
      counts,
      protectedCounts,
      blockers: mode === "all" ? [...blockers].sort() : [],
      canClear,
      retained: RETAINED,
    },
    deleteIds,
  };
}
