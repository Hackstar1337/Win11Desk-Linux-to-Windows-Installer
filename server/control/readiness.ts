import {
  ACTIVE_STAGES,
  KNOWN_STAGES,
  matchesReleaseJournal,
  sourceEvidence,
} from "../../shared/operationsEvidence";
import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import type { Express, Request, Response } from "express";
import { directIsoUrl, getOs } from "../../shared/deploymentProfiles";
import { installerVersion } from "../../shared/installer";
import type {
  BackupStatus,
  CheckState,
  OperationalCheck,
  OperationsHealth,
} from "../../shared/operationsDashboard";
import { can, requirePermission, type AdminRequest } from "./auth";
import { config } from "./config";
import { decrypt, encrypt } from "./crypto";
import { rows } from "./db";

const WORKSPACE = "default";
const STALE_MINUTES = 3;
const BACKUP_STATUS_PATH = "/app/operations-status/backup.json";
const MAX_BACKUP_BYTES = 16 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_JOURNAL_BYTES = 64 * 1024;
const MAX_PROFILE_ROWS = 10_000;
const MAX_REPORTED_BACKUP_BYTES = 1024 * 1024 * 1024 * 1024;
const JOURNAL_PATH = "drizzle/meta/_journal.json";
const APP_VERSION = "1.0.0";
import { SETUP_V3_VERSION as LAUNCHER_VERSION } from "./launcherV3";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE_RE = /^[A-Za-z0-9_-]{1,96}$/;
const CONTROL_MIGRATION_NAMES = [
  "control-auth-v1",
  "control-admin-v1",
  "control-extra-v1",
  "control-profiles-v1",
  "control-display-labels-v1",
  "control-post-install-v1",
  "control-remote-install-v1",
] as const;
export const MIGRATION_NAMES = [
  "0000_initial_users",
  "0001_lowly_giant_girl",
  "0002_fine_toro",
  ...CONTROL_MIGRATION_NAMES,
] as const;

type HealthScope = { ownerId: string | null; role: string };
type QueryState<T> = { value: T; state: CheckState; detail: string };

type BackupManifest = {
  outcome?: unknown;
  encryptedBytes?: unknown;
  checksumVerified?: unknown;
  lastBackupAt?: unknown;
  lastRestoreVerifiedAt?: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function checked(
  id: string,
  label: string,
  state: CheckState,
  detail: string
): OperationalCheck {
  return { id, label, state, detail, checkedAt: nowIso() };
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > max || /[\x00-\x1f\x7f]/.test(result))
    return null;
  return result;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE_RE.test(value) ? value : null;
}

function scopeFor(req: Request): HealthScope {
  const principal = (req as AdminRequest).admin;
  if (!principal) return { ownerId: null, role: "viewer" };
  return {
    ownerId: can(principal.role, "users:manage") ? null : String(principal.id),
    role: principal.role,
  };
}

function scopedWhere(
  alias: string,
  scope: HealthScope
): { sql: string; params: unknown[] } {
  if (scope.ownerId === null)
    return { sql: `${alias}.workspace_id=?`, params: [WORKSPACE] };
  return {
    sql: `${alias}.workspace_id=? AND ${alias}.owner_id=?`,
    params: [WORKSPACE, scope.ownerId],
  };
}

async function databaseCheck(): Promise<QueryState<boolean>> {
  try {
    await rows("SELECT 1 AS ok");
    return { value: true, state: "ok", detail: "Database query succeeded." };
  } catch {
    return {
      value: false,
      state: "error",
      detail: "Database query was unavailable.",
    };
  }
}

async function expectedMigrationNames(): Promise<string[]> {
  const info = await stat(JOURNAL_PATH);
  if (!info.isFile() || info.size > MAX_JOURNAL_BYTES)
    throw new Error("migration journal unavailable");
  const parsed = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as {
    entries?: Array<{ tag?: unknown }>;
  };
  if (!parsed || !Array.isArray(parsed.entries))
    throw new Error("migration journal invalid");
  const journalNames = parsed.entries.map(entry => {
    const tag = entry?.tag;
    if (typeof tag !== "string" || !/^[A-Za-z0-9_.-]{1,255}$/.test(tag))
      throw new Error("migration tag invalid");
    return tag;
  });
  if (!matchesReleaseJournal(journalNames))
    throw new Error("release journal mismatch");
  return [...MIGRATION_NAMES];
}

async function migrationCheck(): Promise<
  QueryState<OperationsHealth["migrations"]>
> {
  let journalError = false;
  let expected: string[];
  try {
    expected = await expectedMigrationNames();
  } catch {
    journalError = true;
    expected = [...MIGRATION_NAMES];
  }
  const pending = [...expected];
  try {
    const applied = await rows<{ name: string }>(
      `SELECT name FROM wc_migrations WHERE name IN (${expected.map(() => "?").join(",")})`,
      [...expected]
    );
    const appliedSet = new Set(applied.map(row => String(row.name)));
    const remaining = pending.filter(name => !appliedSet.has(name));
    const value = {
      expected: expected.length,
      applied: expected.length - remaining.length,
      pending: remaining,
      state: journalError
        ? ("unknown" as const)
        : remaining.length
          ? ("warning" as const)
          : ("ok" as const),
    };
    return {
      value,
      state: value.state,
      detail: journalError
        ? "Expected migration list could not be read."
        : remaining.length
          ? `${remaining.length} expected migration${remaining.length === 1 ? " is" : "s are"} pending.`
          : "All expected migrations are applied.",
    };
  } catch {
    return {
      value: {
        expected: expected.length,
        applied: 0,
        pending,
        state: "error",
      },
      state: "error",
      detail: "Migration history could not be read.",
    };
  }
}

async function profileCheck(): Promise<
  QueryState<NonNullable<OperationsHealth["profiles"]> | null>
> {
  try {
    const profileRows = await rows<{
      os_id: unknown;
      iso_url: unknown;
      archived_at: unknown;
    }>(
      "SELECT os_id,iso_url,archived_at FROM wc_profiles WHERE workspace_id=? LIMIT ?",
      [WORKSPACE, MAX_PROFILE_ROWS + 1]
    );
    if (profileRows.length > MAX_PROFILE_ROWS)
      return {
        value: null,
        state: "unknown",
        detail: "Profile readiness could not be bounded safely.",
      };
    let ready = 0;
    let needsSource = 0;
    let archived = 0;
    for (const profile of profileRows) {
      if (profile.archived_at != null) {
        archived++;
        continue;
      }
      const osReady =
        typeof profile.os_id === "string" &&
        (() => {
          try {
            getOs(profile.os_id);
            return true;
          } catch {
            return false;
          }
        })();
      const source =
        typeof profile.iso_url === "string" ? profile.iso_url.trim() : "";
      if (osReady && source.length > 0 && directIsoUrl(source)) ready++;
      else needsSource++;
    }
    const value = {
      ready,
      needsSource,
      archived,
    };
    return {
      value,
      state: "ok",
      detail: `${value.ready} configured for issuance, ${value.needsSource} needing configuration, ${value.archived} archived. Media reachability and new-OS E2E are not verified.`,
    };
  } catch {
    return {
      value: null,
      state: "unknown",
      detail: "Profile readiness could not be measured.",
    };
  }
}

async function commandCheck(
  scope: HealthScope
): Promise<QueryState<NonNullable<OperationsHealth["commands"]> | null>> {
  if (scope.role === "viewer")
    return {
      value: null,
      state: "ok",
      detail: "Command counts are restricted for viewer accounts.",
    };
  const where = scopedWhere("c", scope);
  try {
    const [row] = await rows<any>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN c.revoked_at IS NULL AND c.expires_at>UTC_TIMESTAMP(3) THEN 1 ELSE 0 END) AS available,
         SUM(CASE WHEN c.expires_at<=UTC_TIMESTAMP(3) AND c.revoked_at IS NULL THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN c.revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
         SUM(CASE WHEN c.batch_id IS NOT NULL THEN 1 ELSE 0 END) AS batchCommands
       FROM wc_commands c WHERE ${where.sql}`,
      where.params
    );
    const value = {
      available: numberValue(row?.available),
      expired: numberValue(row?.expired),
      revoked: numberValue(row?.revoked),
      total: numberValue(row?.total),
      batchCommands: numberValue(row?.batchCommands),
    };
    return {
      value,
      state: "ok",
      detail: `${value.available} available commands.`,
    };
  } catch {
    return {
      value: null,
      state: "unknown",
      detail: "Command counts could not be measured.",
    };
  }
}

async function deploymentCheck(
  scope: HealthScope
): Promise<QueryState<NonNullable<OperationsHealth["deployments"]> | null>> {
  const where = scopedWhere("r", scope);
  try {
    const [row] = await rows<any>(
      `SELECT
         SUM(CASE WHEN r.stage IN (${ACTIVE_STAGES.map(s => "'" + s + "'").join(",")}) AND r.trashed_at IS NULL AND r.purged_at IS NULL THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN r.stage='windows_ready' AND r.purged_at IS NULL THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN r.stage='failed' AND r.purged_at IS NULL THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.stage IN (${ACTIVE_STAGES.map(s => "'" + s + "'").join(",")}) AND r.trashed_at IS NULL AND r.purged_at IS NULL
                   AND GREATEST(COALESCE(r.last_heartbeat_at,r.created_at),COALESCE(r.last_event_at,r.created_at)) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${STALE_MINUTES} MINUTE)
                  THEN 1 ELSE 0 END) AS stale
       FROM wc_run_meta r WHERE ${where.sql}`,
      where.params
    );
    const value = {
      active: numberValue(row?.active),
      completed: numberValue(row?.completed),
      failed: numberValue(row?.failed),
      stale: numberValue(row?.stale),
    };
    return {
      value,
      state: "ok",
      detail: `${value.active} active deployments.`,
    };
  } catch {
    return {
      value: null,
      state: "unknown",
      detail: "Deployment counts could not be measured.",
    };
  }
}

async function sourceCheck(): Promise<QueryState<boolean>> {
  const paths = [
    ["vendor/reinstall/reinstall.sh", installerVersion.sha256],
    ["vendor/reinstall/trans.sh", installerVersion.transSha256],
  ] as const;
  let unavailable = false;
  for (const [file, expected] of paths) {
    let digest: string | null = null;
    try {
      const info = await stat(file);
      if (info.isFile() && info.size <= MAX_SOURCE_BYTES)
        digest = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    } catch {}
    const state = sourceEvidence(digest, expected);
    if (state === "error")
      return {
        value: false,
        state,
        detail: "Pinned installer source digest mismatch was measured.",
      };
    if (state === "unknown") unavailable = true;
  }
  return unavailable
    ? {
        value: false,
        state: "unknown",
        detail:
          "Pinned source inspection unavailable; integrity is not established.",
      }
    : {
        value: true,
        state: "ok",
        detail: "Pinned installer source files match their recorded hashes.",
      };
}

async function vaultCheck(): Promise<QueryState<boolean>> {
  try {
    const synthetic = "operations-vault-self-check";
    const envelope = encrypt(synthetic, "operations:synthetic");
    if (decrypt(envelope, "operations:synthetic") !== synthetic)
      throw new Error("vault mismatch");
    return {
      value: true,
      state: "ok",
      detail: "Vault configuration and synthetic round-trip succeeded.",
    };
  } catch {
    return {
      value: false,
      state: "error",
      detail: "Vault configuration or synthetic round-trip failed.",
    };
  }
}

function notReportedBackup(): BackupStatus {
  return {
    state: "unknown",
    lastBackupAt: null,
    outcome: "not-reported",
    encryptedBytes: null,
    checksumVerified: null,
    lastRestoreVerifiedAt: null,
    note: "Not reported. Restore verification is separate and has not been established.",
  };
}

function manifestTimestamp(value: unknown): string | null {
  return safeTimestamp(value);
}

async function backupStatus(): Promise<BackupStatus> {
  try {
    const info = await lstat(BACKUP_STATUS_PATH);
    if (!info.isFile() || info.size > MAX_BACKUP_BYTES)
      return notReportedBackup();
    const raw = await readFile(BACKUP_STATUS_PATH, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_BACKUP_BYTES)
      return notReportedBackup();
    const value = JSON.parse(raw) as BackupManifest;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return notReportedBackup();
    const allowed = new Set([
      "outcome",
      "encryptedBytes",
      "checksumVerified",
      "lastBackupAt",
      "lastRestoreVerifiedAt",
    ]);
    if (Object.keys(value).some(key => !allowed.has(key)))
      return notReportedBackup();
    if (value.outcome !== "success" && value.outcome !== "failed")
      return notReportedBackup();
    const outcome = value.outcome;
    const encryptedBytes =
      Number.isSafeInteger(value.encryptedBytes) &&
      Number(value.encryptedBytes) > 0 &&
      Number(value.encryptedBytes) <= MAX_REPORTED_BACKUP_BYTES
        ? Number(value.encryptedBytes)
        : null;
    const checksumVerified =
      typeof value.checksumVerified === "boolean"
        ? value.checksumVerified
        : null;
    const lastBackupAt = manifestTimestamp(value.lastBackupAt);
    const lastRestoreVerifiedAt = manifestTimestamp(
      value.lastRestoreVerifiedAt
    );
    const state: CheckState =
      outcome === "success" &&
      lastBackupAt !== null &&
      encryptedBytes !== null &&
      checksumVerified === true
        ? "ok"
        : outcome === "failed"
          ? "warning"
          : "unknown";
    return {
      state,
      lastBackupAt,
      outcome,
      encryptedBytes,
      checksumVerified,
      lastRestoreVerifiedAt,
      note:
        outcome === "failed"
          ? "The host reported a failed backup; inspect the backup runbook."
          : lastRestoreVerifiedAt
            ? "Backup reported. Restore verification is shown separately."
            : "Backup reported; restore verification is not tested.",
    };
  } catch {
    return notReportedBackup();
  }
}

export async function buildOperationsHealth(
  req: Request
): Promise<OperationsHealth> {
  const checkedAt = nowIso();
  const scope = scopeFor(req);
  const [
    database,
    migrations,
    profiles,
    commands,
    deployments,
    source,
    vault,
    backup,
  ] = await Promise.all([
    databaseCheck(),
    migrationCheck(),
    profileCheck(),
    commandCheck(scope),
    deploymentCheck(scope),
    sourceCheck(),
    vaultCheck(),
    backupStatus(),
  ]);
  const configuredOrigin = (() => {
    try {
      return config().publicUrl;
    } catch {
      return "not configured";
    }
  })();
  const checks: OperationalCheck[] = [
    checked("api", "Application API", "ok", "Operations API responded."),
    checked("database", "Database", database.state, database.detail),
    checked(
      "migrations",
      "Schema migrations",
      migrations.state,
      migrations.detail
    ),
    checked("profiles", "Deployment profiles", profiles.state, profiles.detail),
    checked("commands", "Commands", commands.state, commands.detail),
    checked(
      "deployments",
      "Deployments",
      deployments.state,
      deployments.detail
    ),
    checked(
      "installer-source",
      "Installer source",
      source.state,
      source.detail
    ),
    checked("vault", "Vault", vault.state, vault.detail),
    checked("backup", "Backup", backup.state, backup.note),
  ];
  return {
    checkedAt,
    checks,
    migrations: migrations.value,
    versions: {
      app: APP_VERSION,
      installer: installerVersion.commit,
      launcher: LAUNCHER_VERSION,
    },
    profiles: profiles.value,
    commands: commands.value,
    deployments: deployments.value,
    callback: {
      origin: configuredOrigin,
      httpsConfigured: configuredOrigin.startsWith("https:"),
      observedHttps: "not-checked",
    },
    backup,
  };
}

export async function operationsHealthHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const health = await buildOperationsHealth(req);
    res.set("Cache-Control", "private, no-store").json(health);
  } catch {
    res.status(503).json({ error: "Operations health checks unavailable." });
  }
}

export function registerReadinessRoutes(app: Express): void {
  app.get(
    "/api/admin/readiness",
    requirePermission("settings:read"),
    (req, res, next) => {
      void operationsHealthHandler(req, res).catch(() =>
        next(new Error("readiness unavailable"))
      );
    }
  );
}

export { BACKUP_STATUS_PATH };
export default registerReadinessRoutes;
