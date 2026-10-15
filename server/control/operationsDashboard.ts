import {
  ACTIVE_STAGES,
  KNOWN_STAGES,
  attentionState,
} from "../../shared/operationsEvidence";
import { isIP } from "node:net";
import type { Express, Request, Response } from "express";
import { getOs } from "../../shared/deploymentProfiles";
import {
  safeFailureGuidance,
  type AttentionItem,
  type OperationsAttention,
} from "../../shared/operationsDashboard";
import { can, requirePermission, type AdminRequest } from "./auth";
import { rows } from "./db";
import { buildOperationsHealth, operationsHealthHandler } from "./readiness";

const WORKSPACE = "default";
const ATTENTION_LIMIT = 50;
const STALE_MINUTES = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE_RE = /^[A-Za-z0-9_-]{1,96}$/;
const STAGES = new Set([
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
  "windows_ready",
  "failed",
]);

type AttentionScope = { ownerId: string | null };

type AttentionRow = {
  id?: unknown;
  run_id?: unknown;
  label?: unknown;
  public_ip?: unknown;
  username?: unknown;
  profile_id?: unknown;
  profile_snapshot?: unknown;
  stage?: unknown;
  created_at?: unknown;
  started_at?: unknown;
  finished_at?: unknown;
  last_heartbeat_at?: unknown;
  safe_code?: unknown;
  is_failed?: unknown;
};

type SafeSnapshot = {
  id: string | null;
  name: string | null;
  osId: string | null;
};

const GUIDES = {
  deploy: {
    name: "deploy",
    title: "Deployment runbook",
    summary:
      "Prepare a deployment profile, confirm its source and target settings, then issue a new command only after the profile is ready.",
    steps: [
      "Open Deployment profiles and review the selected profile's readiness.",
      "Inspect a failed or stale deployment before preparing a new command.",
      "Use the generated command only on the intended provider target and retain the deployment timeline for evidence.",
    ],
  },
  backup: {
    name: "backup",
    title: "Backup runbook",
    summary:
      "Use the host-owned encrypted backup process and verify its checksum before treating a backup as usable.",
    steps: [
      "Run the existing host backup procedure outside the dashboard.",
      "Publish only the bounded backup status manifest when the host has recorded the result.",
      "Keep backup keys and backup contents out of the dashboard and browser.",
    ],
  },
  restore: {
    name: "restore",
    title: "Restore runbook",
    summary:
      "Restore through the established host and database recovery procedure; the dashboard does not execute restores or arbitrary commands.",
    steps: [
      "Confirm the selected encrypted backup and its checksum through the host recovery process.",
      "Perform the restore using the existing protected operator procedure.",
      "Record a separate restore verification result; a backup manifest alone does not establish restore readiness.",
    ],
  },
} as const;

function scopeFor(req: Request): AttentionScope {
  const principal = (req as AdminRequest).admin;
  return {
    ownerId:
      principal && !can(principal.role, "users:manage")
        ? String(principal.id)
        : null,
  };
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > max || /[\x00-\x1f\x7f]/.test(result))
    return null;
  return result;
}

function safeTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseSnapshot(value: unknown): SafeSnapshot {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { id: null, name: null, osId: null };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { id: null, name: null, osId: null };
  const source = parsed as Record<string, unknown>;
  return {
    id:
      typeof source.id === "string" && UUID_RE.test(source.id)
        ? source.id
        : null,
    name: safeText(source.name, 160),
    osId: safeText(source.osId, 128),
  };
}

function safeOs(osId: string | null): string {
  if (!osId) return "Unknown OS";
  try {
    return getOs(osId).name;
  } catch {
    return osId.slice(0, 128);
  }
}

function attentionScopeSql(scope: AttentionScope): {
  sql: string;
  params: unknown[];
} {
  if (scope.ownerId === null)
    return { sql: "r.workspace_id=?", params: [WORKSPACE] };
  return {
    sql: "r.workspace_id=? AND r.owner_id=?",
    params: [WORKSPACE, scope.ownerId],
  };
}

function mapAttention(row: AttentionRow): AttentionItem {
  const snapshot = parseSnapshot(row.profile_snapshot);
  const stage =
    typeof row.stage === "string" && STAGES.has(row.stage)
      ? row.stage
      : "unknown";
  const failed =
    stage === "failed" || row.is_failed === 1 || row.is_failed === true;
  const publicIP =
    typeof row.public_ip === "string" && isIP(row.public_ip)
      ? row.public_ip
      : null;
  const runId =
    typeof row.run_id === "string" && UUID_RE.test(row.run_id)
      ? row.run_id
      : "unknown";
  const safeCode = SAFE_CODE_RE.test(String(row.safe_code ?? ""))
    ? String(row.safe_code)
    : null;
  return {
    id: runId,
    label: safeText(row.label, 160) ?? "Untitled deployment",
    publicIP,
    username: safeText(row.username, 20) ?? undefined,
    os: safeOs(snapshot.osId),
    profileId: snapshot.id,
    profileName: snapshot.name,
    stage,
    status: attentionState(stage),
    createdAt: safeTimestamp(row.created_at) ?? "",
    startedAt: safeTimestamp(row.started_at),
    finishedAt: safeTimestamp(row.finished_at),
    lastHeartbeatAt: safeTimestamp(row.last_heartbeat_at),
    safeCode,
    nextStep: safeFailureGuidance(safeCode),
  };
}

export async function getOperationsAttention(
  req: Request
): Promise<OperationsAttention> {
  const scope = attentionScopeSql(scopeFor(req));
  const rowsFound = await rows<AttentionRow>(
    `SELECT r.run_id,r.stage,r.created_at,r.started_at,r.finished_at,r.last_heartbeat_at,
            r.public_ip,COALESCE((SELECT l.display_label FROM wc_run_labels l WHERE l.run_id=r.run_id AND l.workspace_id=r.workspace_id),c.label) AS label,c.username,cp.profile_id,
            cp.snapshot_json AS profile_snapshot,
            CASE WHEN r.stage='failed' THEN 1 ELSE 0 END AS is_failed,
            (SELECT e.safe_code
               FROM wc_events e
              WHERE e.run_id=r.run_id
                AND e.safe_code REGEXP '^[A-Za-z0-9_-]{1,96}$'
              ORDER BY e.received_at DESC,e.sequence_no DESC
              LIMIT 1) AS safe_code
       FROM wc_run_meta r
       JOIN wc_commands c ON c.id=r.command_id AND c.workspace_id=r.workspace_id
       LEFT JOIN wc_command_profiles cp ON cp.command_id=c.id AND cp.workspace_id=c.workspace_id
      WHERE ${scope.sql}
        AND r.purged_at IS NULL
        AND r.trashed_at IS NULL
        AND r.archived_at IS NULL
        AND (
          r.stage='failed'
          OR r.stage NOT IN (${KNOWN_STAGES.map(s => "'" + s + "'").join(",")})
          OR (r.stage IN (${ACTIVE_STAGES.map(s => "'" + s + "'").join(",")})
              AND GREATEST(COALESCE(r.last_heartbeat_at,r.created_at),COALESCE(r.last_event_at,r.created_at))
                  < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${STALE_MINUTES} MINUTE))
        )
      ORDER BY r.created_at DESC,r.run_id DESC
      LIMIT ${ATTENTION_LIMIT}`,
    scope.params
  );
  return {
    checkedAt: new Date().toISOString(),
    items: rowsFound.slice(0, ATTENTION_LIMIT).map(mapAttention),
    limit: ATTENTION_LIMIT,
  };
}

export async function operationsAttentionHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const result = await getOperationsAttention(req);
    res.set("Cache-Control", "private, no-store").json(result);
  } catch {
    res.status(503).json({ error: "Operations attention checks unavailable." });
  }
}

function diagnosticPayload(
  health: Awaited<ReturnType<typeof buildOperationsHealth>>,
  attention: OperationsAttention
) {
  return {
    formatVersion: 1,
    generatedAt: health.checkedAt,
    versions: health.versions,
    checks: health.checks.map(check => ({
      label: check.label,
      state: check.state,
      detail: check.detail,
      checkedAt: check.checkedAt,
    })),
    migrations: health.migrations,
    profiles: health.profiles,
    commands: health.commands,
    deployments: health.deployments,
    callback: health.callback,
    backup: health.backup,
    attentionCount: attention.items.length,
    failureCodes: [
      ...new Set(
        attention.items
          .map(item => item.safeCode)
          .filter((code): code is string => code !== null)
      ),
    ],
    attention: attention.items.map(item => ({
      stage: item.stage,
      safeCode: item.safeCode,
    })),
  };
}

export async function operationsDiagnosticsHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const [health, attention] = await Promise.all([
      buildOperationsHealth(req),
      getOperationsAttention(req),
    ]);
    const body = JSON.stringify(diagnosticPayload(health, attention));
    res
      .set({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="operations-diagnostics.json"',
        "Cache-Control": "no-store",
      })
      .send(body);
  } catch {
    res.status(503).json({ error: "Operations diagnostics unavailable." });
  }
}

export function operationsGuideHandler(req: Request, res: Response): void {
  const name = req.params.name as keyof typeof GUIDES;
  if (!Object.prototype.hasOwnProperty.call(GUIDES, name)) {
    res.status(404).json({ error: "Guide not found." });
    return;
  }
  const guide = GUIDES[name];
  res.set("Cache-Control", "private, no-store").json(guide);
}

export function registerOperationsDashboardRoutes(app: Express): void {
  app.get(
    "/api/admin/operations/health",
    requirePermission("settings:read"),
    (req, res, next) => {
      void operationsHealthHandler(req, res).catch(() =>
        next(new Error("operations health unavailable"))
      );
    }
  );
  app.get(
    "/api/admin/operations/attention",
    requirePermission("deployments:read"),
    (req, res, next) => {
      void operationsAttentionHandler(req, res).catch(() =>
        next(new Error("operations attention unavailable"))
      );
    }
  );
  app.get(
    "/api/admin/operations/diagnostics",
    requirePermission("users:manage"),
    (req, res, next) => {
      void operationsDiagnosticsHandler(req, res).catch(() =>
        next(new Error("operations diagnostics unavailable"))
      );
    }
  );
  app.get(
    "/api/admin/operations/guides/:name",
    requirePermission("settings:read"),
    operationsGuideHandler
  );
}

export { GUIDES };
export default registerOperationsDashboardRoutes;
