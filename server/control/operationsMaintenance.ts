import { randomUUID } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import {
  MAINTENANCE_CONFIRM_PHRASES,
  MAINTENANCE_RETAINED,
  isMaintenanceMode,
  type MaintenanceClearRequest,
  type MaintenanceClearResult,
  type MaintenanceMode,
  type MaintenancePreview,
} from "../../shared/operationsMaintenance";
import {
  requireAuth,
  requirePermission,
  requireStepUp,
  type AdminRequest,
} from "./auth";
import { rows, transaction, type PoolConnection } from "./db";
import {
  evaluateMaintenanceSnapshot,
  MAINTENANCE_WORKSPACE,
  MAINTENANCE_MAX_ROWS,
  type MaintenanceSqlConnection,
  type MaintenanceSnapshot,
  type MaintenanceCommandRow,
  type MaintenanceRunRow,
  type MaintenanceTrackerRunRow,
  type MaintenanceTrackerGroupRow,
  type MaintenanceRemoteJobRow,
  type MaintenanceReviewRow,
  type MaintenanceCheckRow,
  type MaintenanceSecretRow,
  type DeleteIds,
} from "./operationsMaintenancePlan";
export {
  evaluateMaintenanceSnapshot,
  MAINTENANCE_WORKSPACE,
  MAINTENANCE_MAX_ROWS,
  type MaintenanceSnapshot,
} from "./operationsMaintenancePlan";
function resultRows(result: any): any[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  return Array.isArray(result) ? result : [];
}
async function connRows<T = any>(
  conn: MaintenanceSqlConnection,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await (conn.query
    ? conn.query(sql, params)
    : conn.execute(sql, params));
  return resultRows(result) as T[];
}
async function boundedRows<T = any>(
  reader: (sql: string, params: unknown[]) => Promise<T[]>,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const found = await reader(`${sql} LIMIT ?`, [
    ...params,
    MAINTENANCE_MAX_ROWS + 1,
  ]);
  if (found.length > MAINTENANCE_MAX_ROWS) throw new MaintenanceTooLargeError();
  return found;
}

export class MaintenanceTooLargeError extends Error {
  readonly status = 409;
  readonly code = "MAINTENANCE_BOUNDS";
  constructor() {
    super("Maintenance preview is too large to evaluate safely.");
  }
}
export class MaintenanceBlockedError extends Error {
  readonly status = 409;
  readonly code = "MAINTENANCE_BLOCKED";
  constructor(public readonly blockers: string[]) {
    super(
      "Active or uncertain installation work must finish before this reset."
    );
  }
}
export class MaintenanceDigestError extends Error {
  readonly status = 409;
  readonly code = "MAINTENANCE_PREVIEW_STALE";
  constructor() {
    super("Maintenance preview is stale; refresh before clearing.");
  }
}
export class MaintenanceInputError extends Error {
  readonly status = 400;
  readonly code = "MAINTENANCE_INPUT";
  constructor(message: string) {
    super(message);
  }
}

async function loadSnapshot(
  reader: (sql: string, params?: unknown[]) => Promise<any[]>,
  lock: boolean,
  login?: { id: string; sessionId: string }
): Promise<MaintenanceSnapshot & { trusts: Array<{ id: string }> }> {
  const suffix = lock ? " LIMIT ? FOR UPDATE" : " LIMIT ?";
  const get = async <T>(sql: string, params: unknown[] = []) => {
    const result = await reader(sql + suffix, [
      ...params,
      MAINTENANCE_MAX_ROWS + 1,
    ]);
    if (result.length > MAINTENANCE_MAX_ROWS)
      throw new MaintenanceTooLargeError();
    return result as T[];
  };
  // Do not parallelize FOR UPDATE reads. Callback registration uses these rows
  // too; one deterministic order avoids a maintenance/registration deadlock.
  const trackerGroups = await get<MaintenanceTrackerGroupRow>(
    "SELECT id,expiresAt FROM installerTrackingGroups ORDER BY id"
  );
  const trackerRuns = await get<MaintenanceTrackerRunRow>(
    "SELECT id,groupId,stage,expiresAt FROM installerTrackingRuns ORDER BY id"
  );
  const commands = await get<MaintenanceCommandRow>(
    "SELECT id,workspace_id,group_id,expires_at,revoked_at,config_json FROM wc_commands WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const runs = await get<MaintenanceRunRow>(
    "SELECT run_id,workspace_id,command_id,group_id,stage,archived_at,trashed_at,purged_at FROM wc_run_meta WHERE workspace_id=? ORDER BY run_id",
    [MAINTENANCE_WORKSPACE]
  );
  const jobs = await get<MaintenanceRemoteJobRow>(
    "SELECT id,state,review_id,command_id,group_id,run_id FROM wc_remote_jobs WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const reviews = await get<MaintenanceReviewRow>(
    "SELECT id,check_id,expires_at FROM wc_remote_reviews WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const checks = await get<MaintenanceCheckRow>(
    "SELECT id,expires_at FROM wc_remote_checks WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const secrets = await get<MaintenanceSecretRow>(
    "SELECT id,check_id,review_id,job_id FROM wc_remote_secrets WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const notifications = await get<{ id: string; run_id: string | null }>(
    "SELECT id,run_id FROM wc_notifications WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const tickets = await get<{ id: string; expiresAt: unknown }>(
    "SELECT id,expiresAt FROM installerTickets ORDER BY id"
  );
  const trusts = await get<{ id: string }>(
    "SELECT CONCAT(host,':',port) AS id FROM wc_remote_trust WHERE workspace_id=? ORDER BY host,port",
    [MAINTENANCE_WORKSPACE]
  );
  // Reports are read after run locks and are included in the same bounded snapshot.
  const reportRows = await get<{ run_id: string; report_json: unknown }>(
    "SELECT run_id,report_json FROM wc_post_install_runs WHERE workspace_id=? ORDER BY run_id",
    [MAINTENANCE_WORKSPACE]
  );
  const reportByRun = new Map(
    reportRows.map(row => [row.run_id, row.report_json])
  );
  for (const run of runs)
    (
      run as MaintenanceRunRow & { post_install_report?: unknown }
    ).post_install_report = reportByRun.get(run.run_id);
  const dependentRows: Record<
    string,
    Array<{ key: string; parent: string }>
  > = {};
  dependentRows.wc_events = await get(
    "SELECT CONCAT(e.run_id, ':',e.event_id) AS `key`,e.run_id AS parent FROM wc_events e LEFT JOIN wc_run_meta r ON r.run_id=e.run_id WHERE (r.workspace_id=? OR r.run_id IS NULL) ORDER BY e.run_id,e.event_id",
    [MAINTENANCE_WORKSPACE]
  );
  dependentRows.wc_run_labels = await get(
    "SELECT run_id AS `key`,run_id AS parent FROM wc_run_labels WHERE workspace_id=? ORDER BY run_id",
    [MAINTENANCE_WORKSPACE]
  );
  dependentRows.wc_post_install_runs = reportRows.map(row => ({
    key: row.run_id,
    parent: row.run_id,
  }));
  dependentRows.wc_command_profiles = await get(
    "SELECT command_id AS `key`,command_id AS parent FROM wc_command_profiles WHERE workspace_id=? ORDER BY command_id",
    [MAINTENANCE_WORKSPACE]
  );
  dependentRows.wc_delivery_secrets = await get(
    "SELECT s.command_id AS `key`,s.command_id AS parent FROM wc_delivery_secrets s LEFT JOIN wc_commands c ON c.id=s.command_id WHERE (c.workspace_id=? OR c.id IS NULL) ORDER BY s.command_id",
    [MAINTENANCE_WORKSPACE]
  );
  dependentRows.wc_remote_job_events = await get(
    "SELECT CAST(id AS CHAR) AS `key`,job_id AS parent FROM wc_remote_job_events WHERE workspace_id=? ORDER BY id",
    [MAINTENANCE_WORKSPACE]
  );
  const otherLoginSessions = login
    ? await get<{ id: string }>(
        "SELECT id FROM wc_sessions WHERE account_id=? AND id<>? ORDER BY id",
        [login.id, login.sessionId]
      )
    : [];
  return {
    otherLoginSessions,
    commands,
    runs,
    trackerRuns,
    trackerGroups,
    jobs,
    reviews,
    checks,
    secrets,
    notifications,
    tickets,
    trusts,
    dependentRows,
  };
}

async function readSnapshot(): Promise<
  MaintenanceSnapshot & { trusts: Array<{ id: string }> }
> {
  return loadSnapshot((sql, params) => rows(sql, params), false);
}
async function lockedSnapshot(
  conn: PoolConnection,
  login?: { id: string; sessionId: string }
): Promise<MaintenanceSnapshot & { trusts: Array<{ id: string }> }> {
  // Tracker groups/runs are locked first, then commands, control runs and jobs.
  // A registered-but-not-yet-mirrored tracker remains a blocker; registration waiting
  // for its deleted group fails after commit. InnoDB deadlock victims roll back safely.
  const reader = (sql: string, params: unknown[] = []) =>
    connRows(conn, sql, params);
  return loadSnapshot(reader, true, login);
}

export async function previewMaintenance(
  mode: MaintenanceMode,
  login?: { id: string; sessionId: string }
): Promise<MaintenancePreview> {
  if (!isMaintenanceMode(mode)) throw new Error("Invalid maintenance mode");
  const checkedAt = new Date();
  const snapshot = await transaction(conn =>
    lockedSnapshot(conn, mode === "all" ? login : undefined)
  );
  return evaluateMaintenanceSnapshot(snapshot, mode, checkedAt).preview;
}

function placeholders(ids: string[]): string {
  return ids.map(() => "?").join(",");
}
async function deleteByIds(
  conn: MaintenanceSqlConnection,
  table: string,
  column: string,
  ids: string[]
): Promise<void> {
  if (!ids.length) return;
  // IDs came only from locked rows; values remain parameters and chunks bound payload size.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await conn.execute(
      `DELETE FROM ${table} WHERE ${column} IN (${placeholders(chunk)})`,
      chunk
    );
  }
}
async function applyDeletes(
  conn: MaintenanceSqlConnection,
  ids: DeleteIds
): Promise<void> {
  // Child tables first; no FK checks are disabled and no TRUNCATE is used.
  await deleteByIds(conn, "wc_notifications", "id", ids.wc_notifications || []);
  await deleteByIds(
    conn,
    "wc_remote_job_events",
    "job_id",
    ids.wc_remote_job_events || []
  );
  await deleteByIds(
    conn,
    "wc_remote_secrets",
    "id",
    ids.wc_remote_secrets || []
  );
  await deleteByIds(
    conn,
    "wc_remote_reviews",
    "id",
    ids.wc_remote_reviews || []
  );
  await deleteByIds(conn, "wc_remote_checks", "id", ids.wc_remote_checks || []);
  await deleteByIds(conn, "wc_remote_jobs", "id", ids.wc_remote_jobs || []);
  await deleteByIds(
    conn,
    "wc_post_install_runs",
    "run_id",
    ids.wc_post_install_runs || []
  );
  await deleteByIds(conn, "wc_events", "run_id", ids.wc_events || []);
  await deleteByIds(conn, "wc_run_labels", "run_id", ids.wc_run_labels || []);
  await deleteByIds(
    conn,
    "wc_delivery_secrets",
    "command_id",
    ids.wc_delivery_secrets || []
  );
  await deleteByIds(
    conn,
    "wc_command_profiles",
    "command_id",
    ids.wc_command_profiles || []
  );
  await deleteByIds(conn, "wc_run_meta", "run_id", ids.wc_run_meta || []);
  await deleteByIds(conn, "wc_commands", "id", ids.wc_commands || []);
  await deleteByIds(conn, "installerTickets", "id", ids.installerTickets || []);
  await deleteByIds(
    conn,
    "installerTrackingRuns",
    "id",
    ids.installerTrackingRuns || []
  );
  await deleteByIds(
    conn,
    "installerTrackingGroups",
    "id",
    ids.installerTrackingGroups || []
  );
  for (const composite of ids.wc_remote_trust || []) {
    const separator = composite.lastIndexOf(":");
    if (separator > 0)
      await conn.execute(
        "DELETE FROM wc_remote_trust WHERE workspace_id=? AND host=? AND port=?",
        [
          MAINTENANCE_WORKSPACE,
          composite.slice(0, separator),
          Number(composite.slice(separator + 1)),
        ]
      );
  }
}

export async function clearMaintenance(
  request: MaintenanceClearRequest,
  actorId: string,
  currentSessionId?: string
): Promise<MaintenanceClearResult> {
  if (
    !isMaintenanceMode(request.mode) ||
    request.confirm !== MAINTENANCE_CONFIRM_PHRASES[request.mode]
  )
    throw Object.assign(new Error("Exact typed confirmation is required."), {
      status: 400,
      code: "MAINTENANCE_CONFIRMATION",
    });
  if (!/^[a-f0-9]{64}$/i.test(request.previewDigest))
    throw Object.assign(new Error("Invalid cleanup preview digest."), {
      status: 400,
      code: "MAINTENANCE_DIGEST",
    });
  return transaction(async conn => {
    const checkedAt = new Date();
    const snapshot = await lockedSnapshot(
      conn,
      request.mode === "all" && currentSessionId
        ? { id: actorId, sessionId: currentSessionId }
        : undefined
    );
    const plan = evaluateMaintenanceSnapshot(snapshot, request.mode, checkedAt);
    if (
      request.mode === "finished" &&
      plan.preview.previewDigest.toLowerCase() !==
        request.previewDigest.toLowerCase()
    )
      throw new MaintenanceDigestError();
    if (!plan.preview.canClear)
      throw new MaintenanceBlockedError(plan.preview.blockers);
    await applyDeletes(conn, plan.deleteIds);
    await deleteByIds(
      conn,
      "wc_sessions",
      "id",
      plan.deleteIds.wc_sessions || []
    );
    // Keep the security audit stream. The receipt is deliberately aggregate-only.
    await conn.execute(
      "INSERT INTO wc_audit (id,actor_id,action,target_id,metadata_json) VALUES (?,?,?,?,?)",
      [
        randomUUID(),
        actorId,
        "operations.maintenance.clear",
        null,
        JSON.stringify({
          mode: request.mode,
          counts: plan.preview.counts,
          protectedCounts: plan.preview.protectedCounts,
        }),
      ]
    );
    return {
      cleared: true,
      mode: request.mode,
      counts: plan.preview.counts,
      protectedCounts: plan.preview.protectedCounts,
      retained: [...MAINTENANCE_RETAINED],
    };
  });
}

function ownerOnly(req: Request, res: Response, next: NextFunction): void {
  const admin = (req as AdminRequest).admin;
  if (!admin)
    return void res
      .status(401)
      .json({ error: "AUTH_REQUIRED", message: "Authentication required" });
  if (admin.role !== "owner")
    return void res
      .status(403)
      .json({ error: "OWNER_REQUIRED", message: "Owner permission required" });
  next();
}
function requestBody(value: unknown): MaintenanceClearRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Object.assign(new Error("Invalid request body"), { status: 400 });
  const keys = Object.keys(value as object);
  if (
    keys.length !== 3 ||
    keys.some(key => !["mode", "confirm", "previewDigest"].includes(key))
  )
    throw Object.assign(
      new Error("Body must be {mode,confirm,previewDigest}"),
      { status: 400 }
    );
  const body = value as Record<string, unknown>;
  if (
    !isMaintenanceMode(body.mode) ||
    typeof body.confirm !== "string" ||
    typeof body.previewDigest !== "string"
  )
    throw Object.assign(new Error("Invalid maintenance request"), {
      status: 400,
    });
  return {
    mode: body.mode,
    confirm: body.confirm,
    previewDigest: body.previewDigest,
  };
}
function routeError(res: Response, error: unknown): void {
  const e = error as Partial<{
    status: number;
    code: string;
    message: string;
    blockers: string[];
  }>;
  const status = e.status && e.status >= 400 && e.status < 500 ? e.status : 500;
  res.status(status).json({
    error: e.code || "MAINTENANCE_ERROR",
    message: status === 500 ? "Maintenance operation failed." : e.message,
    ...(e.blockers ? { blockers: e.blockers } : {}),
  });
}

export function registerOperationsMaintenanceRoutes(app: Express): void {
  app.get(
    "/api/admin/operations/maintenance/preview",
    requireAuth,
    requirePermission("users:manage"),
    ownerOnly,
    (req, res) => {
      const mode = String(req.query.mode || "");
      if (!isMaintenanceMode(mode))
        return res.status(400).json({
          error: "INVALID_MODE",
          message: "mode must be finished or all",
        });
      void previewMaintenance(mode, (req as AdminRequest).admin!)
        .then(preview =>
          res.set("Cache-Control", "private, no-store").json(preview)
        )
        .catch(error => routeError(res, error));
    }
  );
  app.post(
    "/api/admin/operations/maintenance/clear",
    requireAuth,
    requirePermission("users:manage"),
    ownerOnly,
    requireStepUp,
    (req, res) => {
      let body: MaintenanceClearRequest;
      try {
        body = requestBody(req.body);
      } catch (error) {
        return routeError(res, error);
      }
      const actor = (req as AdminRequest).admin!;
      void clearMaintenance(body, actor.id, actor.sessionId)
        .then(result =>
          res.set("Cache-Control", "private, no-store").json(result)
        )
        .catch(error => routeError(res, error));
    }
  );
}

export default registerOperationsMaintenanceRoutes;
