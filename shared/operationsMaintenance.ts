export const MAINTENANCE_MODES = ["finished", "all"] as const;
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

export const MAINTENANCE_CONFIRM_PHRASES: Record<MaintenanceMode, string> = {
  finished: "CLEAR FINISHED HISTORY",
  all: "CLEAR ALL INSTALLATION DATA",
};

/** Stable keys are intentionally table-shaped so the UI can render exact counts. */
export const MAINTENANCE_COUNT_KEYS = [
  "wc_sessions",
  "wc_commands",
  "wc_command_profiles",
  "wc_delivery_secrets",
  "wc_run_meta",
  "wc_events",
  "wc_run_labels",
  "wc_post_install_runs",
  "wc_notifications",
  "wc_remote_jobs",
  "wc_remote_job_events",
  "wc_remote_secrets",
  "wc_remote_reviews",
  "wc_remote_checks",
  "wc_remote_trust",
  "installerTickets",
  "installerTrackingRuns",
  "installerTrackingGroups",
] as const;
export type MaintenanceCountKey = (typeof MAINTENANCE_COUNT_KEYS)[number];

export type MaintenanceCounts = Record<string, number>;

export interface MaintenancePreview {
  mode: MaintenanceMode;
  checkedAt: string;
  previewDigest: string;
  confirmPhrase: string;
  counts: MaintenanceCounts;
  protectedCounts: Record<string, number>;
  blockers: string[];
  canClear: boolean;
  /** Explicitly tells the client what this action never touches. */
  retained: string[];
}

export interface MaintenanceClearRequest {
  mode: MaintenanceMode;
  confirm: string;
  previewDigest: string;
}

export interface MaintenanceClearResult {
  cleared: true;
  mode: MaintenanceMode;
  counts: MaintenanceCounts;
  protectedCounts: Record<string, number>;
  retained: string[];
}

export function isMaintenanceMode(value: unknown): value is MaintenanceMode {
  return value === "finished" || value === "all";
}

export function maintenanceConfirmPhrase(mode: MaintenanceMode): string {
  return MAINTENANCE_CONFIRM_PHRASES[mode];
}

export const MAINTENANCE_RETAINED = [
  "wc_accounts",
  "wc_sessions.current_browser_and_other_accounts",
  "wc_recovery",
  "wc_settings",
  "wc_presets",
  "wc_profiles",
  "wc_audit (existing records; one count-only reset receipt is appended)",
  "wc_remote_worker_heartbeat",
  "server configuration, backups, migration logs, and encrypted key material",
] as const;
