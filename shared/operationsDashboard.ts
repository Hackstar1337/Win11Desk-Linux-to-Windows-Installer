export type CheckState = "ok" | "warning" | "error" | "unknown";
export interface OperationalCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  checkedAt: string | null;
}
export interface BackupStatus {
  state: CheckState;
  lastBackupAt: string | null;
  outcome: "success" | "failed" | "not-reported";
  encryptedBytes: number | null;
  checksumVerified: boolean | null;
  lastRestoreVerifiedAt: string | null;
  note: string;
}
export interface OperationsHealth {
  checkedAt: string;
  checks: OperationalCheck[];
  migrations: {
    expected: number;
    applied: number;
    pending: string[];
    state: CheckState;
  };
  versions: { app: string; installer: string; launcher: string };
  profiles: { ready: number; needsSource: number; archived: number } | null;
  commands: {
    available: number;
    expired: number;
    revoked: number;
    total: number;
    batchCommands: number;
  } | null;
  deployments: {
    active: number;
    completed: number;
    failed: number;
    stale: number;
  } | null;
  callback: {
    origin: string;
    httpsConfigured: boolean;
    observedHttps: "not-checked";
  };
  backup: BackupStatus;
}
export interface AttentionItem {
  id: string;
  label: string;
  publicIP: string | null;
  username?: string;
  os: string;
  profileId: string | null;
  profileName: string | null;
  stage: string;
  status: "failed" | "stale" | "unknown";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  safeCode: string | null;
  nextStep: string;
}
export interface OperationsAttention {
  checkedAt: string;
  items: AttentionItem[];
  limit: number;
}
export function isOperationsAdmin(role: string) {
  return role === "owner" || role === "admin";
}
export function safeFailureGuidance(code: string | null): string {
  if (code && /ISO_SHA256_MISMATCH|MEDIA_CHANGED|SOURCE_CHANGED/.test(code))
    return "The reported media integrity check failed. Review the profile source and deployment details before preparing a new command.";
  if (code && /ISO|MEDIA|QUOTA|HTML/.test(code))
    return "The installer reported a media problem. Inspect Details and review the matching profile ISO; saving a new link will not restart this VPS.";
  if (code && /IMAGE|EDITION|BUILD|PROOF/.test(code))
    return "The reported image or Windows evidence did not match. Review the selected profile and exact image name in Details.";
  return "Inspect the last reported stage and Details. A missing heartbeat is not proof that installation failed; check provider console access before considering another install.";
}
