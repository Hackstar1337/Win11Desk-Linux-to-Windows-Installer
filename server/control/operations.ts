import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { isIP } from "node:net";
import type { Express, Request, Response } from "express";
import {
  getTrackingGroup,
  TrackingNotFoundError,
  TrackingValidationError,
} from "../installTracking";
import { config } from "./config";
import { exec, rows, transaction, type PoolConnection } from "./db";
import {
  audit,
  requireAuth,
  requirePermission,
  requireStepUp,
  type AdminRequest,
} from "./auth";

const WORKSPACE = "default";
const MAX_NOTIFICATIONS = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = [
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
] as const;
type Stage = (typeof STAGES)[number];

type EncryptedValue = { ciphertext: string; iv: string; tag: string };

/** The fields read from the old, local installer tracking tables. */
export type LegacyRunLike = Record<string, unknown> & {
  runId?: unknown;
  id?: unknown;
  groupId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  expiresAt?: unknown;
  stage?: unknown;
  status?: unknown;
};

export interface NormalizedLegacyRun {
  runId: string;
  groupId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  hostname: string | null;
  wholeDisk: string | null;
  rdpPort: number | null;
  publicIP: string | null;
  stage: Stage;
  sequence: number;
  windowsEdition: string | null;
  windowsBuild: number | null;
  rdpListening: boolean | null;
  errorStage: string | null;
  safeCode: string | null;
  proof: Record<string, string | number | boolean>;
}

export class OperationsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsInputError";
  }
}

function value(row: Record<string, unknown>, camel: string, snake: string) {
  return row[camel] ?? row[snake];
}

function asUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new OperationsInputError(`Invalid ${field}`);
  return value;
}

function dateValue(value: unknown, fallback: Date): Date {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : new Date(fallback.getTime());
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text)) return null;
  return text;
}

function safePort(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 65535
    ? number
    : null;
}

function safeBuild(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 2_147_483_647
    ? number
    : null;
}

function safeSequence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(value)
    ? value
    : null;
}

function safeBoolean(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  if (value === false || value === 0 || value === "0" || value === "false")
    return false;
  return null;
}

function parseProof(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stageForLegacy(value: unknown): Stage {
  const stage = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((STAGES as readonly string[]).includes(stage)) return stage as Stage;
  if (
    ["completed", "complete", "success", "succeeded", "ready"].includes(stage)
  )
    return "windows_ready";
  if (["failed", "failure", "error", "errored"].includes(stage))
    return "failed";
  return "starting";
}

/**
 * Convert a legacy tracking row into the bounded, non-secret representation used
 * by the control plane. In particular, logs and arbitrary legacy payloads never
 * cross the import boundary.
 */
export function normalizeLegacyRun(
  source: LegacyRunLike,
  groupId: string,
  now = new Date()
): NormalizedLegacyRun {
  const runId = asUuid(value(source, "runId", "run_id") ?? source.id, "run id");
  const createdAt = dateValue(value(source, "createdAt", "created_at"), now);
  const updatedAt = dateValue(
    value(source, "updatedAt", "updated_at") ??
      value(source, "stageAt", "stage_at"),
    createdAt
  );
  const expiresAt = dateValue(
    value(source, "expiresAt", "expires_at"),
    new Date(createdAt.getTime())
  );
  const stage = stageForLegacy(
    value(source, "stage", "stage") ?? value(source, "status", "status")
  );
  const windowsEdition = safeText(
    value(source, "windowsEdition", "windows_edition"),
    64
  );
  const windowsBuild = safeBuild(
    value(source, "windowsBuild", "windows_build")
  );
  const rdpListening = safeBoolean(
    value(source, "rdpListening", "rdp_listening")
  );
  const errorStage = safeText(value(source, "errorStage", "error_stage"), 64);
  const rawProof = parseProof(
    value(source, "proof", "proof_json") ??
      value(source, "lastProof", "last_proof")
  );
  const proof: Record<string, string | number | boolean> = {};
  const proofEdition = safeText(
    rawProof.windowsEdition ?? rawProof.windows_edition,
    64
  );
  const proofBuild = safeBuild(rawProof.windowsBuild ?? rawProof.windows_build);
  const proofRdp = safeBoolean(rawProof.rdpListening ?? rawProof.rdp_listening);
  const proofError = safeText(rawProof.errorStage ?? rawProof.error_stage, 64);
  const proofPhase = safeCode(rawProof.phase);
  const proofCode = safeCode(rawProof.errorCode ?? rawProof.error_code);
  if (proofEdition !== null) proof.windowsEdition = proofEdition;
  if (proofBuild !== null) proof.windowsBuild = proofBuild;
  if (proofRdp !== null) proof.rdpListening = proofRdp;
  if (proofError !== null) proof.errorStage = proofError;
  if (proofPhase !== null) proof.phase = proofPhase;
  if (proofCode !== null) proof.errorCode = proofCode;
  if (windowsEdition !== null) proof.windowsEdition = windowsEdition;
  if (windowsBuild !== null) proof.windowsBuild = windowsBuild;
  if (rdpListening !== null) proof.rdpListening = rdpListening;
  if (errorStage !== null) proof.errorStage = errorStage;
  return {
    runId,
    groupId: asUuid(groupId, "group id"),
    createdAt,
    updatedAt,
    expiresAt,
    hostname: safeText(value(source, "hostname", "hostname"), 253),
    wholeDisk: safeText(
      value(source, "wholeDisk", "whole_disk") ?? value(source, "disk", "disk"),
      128
    ),
    rdpPort: safePort(value(source, "rdpPort", "rdp_port")),
    publicIP:
      typeof value(source, "publicIP", "public_ip") === "string" &&
      isIP(String(value(source, "publicIP", "public_ip")).trim())
        ? String(value(source, "publicIP", "public_ip")).trim()
        : null,
    stage,
    sequence: safeSequence(value(source, "sequence", "sequence")),
    windowsEdition,
    windowsBuild,
    rdpListening,
    errorStage,
    safeCode:
      safeCode(value(source, "errorCode", "error_code")) ??
      proofCode ??
      safeCode(value(source, "lastErrorCode", "last_error_code")),
    proof,
  };
}

/** Stable IDs make a retried import safe even if a process stopped mid-transaction. */
export function legacyCommandId(runId: string): string {
  const hex = createHash("sha256")
    .update("win11desk:legacy-command:")
    .update(runId)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function legacyEventId(runId: string): string {
  return `legacy-import:${runId}`.slice(0, 128);
}

export function isTerminalLegacyStage(stage: Stage): boolean {
  return stage === "windows_ready" || stage === "failed";
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function seal(value: string, associatedData: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config().vaultKey, iv);
  cipher.setAAD(Buffer.from(`win11desk-control:v4:${associatedData}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function commandValues(
  run: NormalizedLegacyRun,
  ownerId: string,
  readToken: string
) {
  const commandId = legacyCommandId(run.runId);
  const emptyArtifact = seal("", `artifact:${commandId}:${digest("")}`);
  const emptyCredential = seal("", `credential:${commandId}:1`);
  const read = seal(readToken, `read-token:${commandId}`);
  const emptyCapability = randomBytes(32).toString("hex");
  const write = seal("", `write-token:${commandId}`);
  const created = run.createdAt;
  // A synthetic command is always unusable: its artifact is empty and its
  // delivery window is already closed. Legacy run dates remain on wc_run_meta.
  const expired = new Date(0);
  return {
    commandId,
    values: [
      commandId,
      WORKSPACE,
      ownerId,
      `legacy-import:${run.runId}`,
      null,
      "Legacy import",
      "legacy",
      json(["Legacy import"]),
      "",
      run.rdpPort ?? 3389,
      0,
      "",
      digest(""),
      json({}),
      json({}),
      json({ legacy: true }),
      digest(""),
      emptyArtifact.ciphertext,
      emptyArtifact.iv,
      emptyArtifact.tag,
      "vault-v1",
      emptyCredential.ciphertext,
      emptyCredential.iv,
      emptyCredential.tag,
      "vault-v1",
      1,
      digest(emptyCapability),
      run.groupId,
      read.ciphertext,
      read.iv,
      read.tag,
      write.ciphertext,
      write.iv,
      write.tag,
      created,
      expired,
      created,
      0,
      null,
      1,
    ] as unknown[],
    id: commandId,
    expiredAt: expired,
  };
}

const COMMAND_COLUMNS = `id,workspace_id,owner_id,idempotency_key,batch_id,label,provider,tags_json,username,remote_port,retries,iso_url,iso_sha256,target_json,config_json,installer_version,installer_digest,artifact_ciphertext,artifact_iv,artifact_tag,artifact_key_id,credential_ciphertext,credential_iv,credential_tag,credential_key_id,credential_version,delivery_hash,group_id,read_token_ciphertext,read_token_iv,read_token_tag,write_token_ciphertext,write_token_iv,write_token_tag,created_at,expires_at,revoked_at,download_count,last_used_at,created_by_batch`;

const RUN_COLUMNS = `run_id,workspace_id,owner_id,command_id,group_id,nonce_hash,report_hash,hostname,whole_disk,rdp_port,public_ip,stage,phase,created_at,registered_at,started_at,stage_at,last_heartbeat_at,last_event_at,finished_at,downloaded_bytes,total_bytes,windows_edition,windows_build,rdp_listening,credential_available,notes,tags_json,archived_at,trashed_at,purged_at,tombstone_code`;

function runValues(
  run: NormalizedLegacyRun,
  ownerId: string,
  commandId: string
) {
  const finished = isTerminalLegacyStage(run.stage) ? run.updatedAt : null;
  return [
    run.runId,
    WORKSPACE,
    ownerId,
    commandId,
    run.groupId,
    null,
    null,
    run.hostname,
    run.wholeDisk,
    run.rdpPort,
    run.publicIP,
    run.stage,
    null,
    run.createdAt,
    run.createdAt,
    run.stage === "starting" ? null : run.createdAt,
    run.updatedAt,
    null,
    run.updatedAt,
    finished,
    null,
    null,
    run.windowsEdition,
    run.windowsBuild,
    run.rdpListening,
    0,
    "Legacy import",
    json(["Legacy import"]),
    null,
    null,
    null,
    null,
  ];
}

function eventValues(run: NormalizedLegacyRun) {
  const proof = json(run.proof);
  return [
    run.runId,
    legacyEventId(run.runId),
    run.sequence,
    null,
    run.stage,
    run.safeCode ?? run.errorStage,
    proof,
    json({ stage: run.stage, proof: run.proof }),
    run.updatedAt,
    run.updatedAt,
  ];
}

export interface LegacyImportPlan {
  run: NormalizedLegacyRun;
  commandId: string;
  commandValues: unknown[];
  runValues: unknown[];
  eventValues: unknown[];
}

/** Pure plan builder used by tests and by the database importer. */
export function buildLegacyImportPlan(
  source: LegacyRunLike,
  groupId: string,
  ownerId: string,
  readToken: string,
  now = new Date()
): LegacyImportPlan {
  const run = normalizeLegacyRun(source, groupId, now);
  const command = commandValues(run, ownerId, readToken);
  return {
    run,
    commandId: command.id,
    commandValues: command.values,
    runValues: runValues(run, ownerId, command.id),
    eventValues: eventValues(run),
  };
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new OperationsInputError("JSON object required");
  return body as Record<string, unknown>;
}

function importInput(body: unknown) {
  const b = bodyObject(body);
  const keys = Object.keys(b);
  if (keys.some(key => !["groupId", "readToken", "confirm"].includes(key)))
    throw new OperationsInputError("Unsupported field");
  if (b.confirm !== true)
    throw new OperationsInputError("Explicit confirmation is required");
  return {
    groupId: asUuid(b.groupId, "group id"),
    readToken:
      typeof b.readToken === "string" && /^[0-9a-f]{64}$/i.test(b.readToken)
        ? b.readToken.toLowerCase()
        : (() => {
            throw new OperationsInputError("Invalid read token");
          })(),
  };
}

function actor(req: Request): NonNullable<AdminRequest["admin"]> {
  const admin = (req as AdminRequest).admin;
  if (!admin) throw new OperationsInputError("Authentication required");
  return admin;
}

function sendOperationsError(res: Response, error: unknown): void {
  if (error instanceof OperationsInputError)
    res.status(400).json({ error: error.message });
  else {
    console.error(
      "Control operations failed",
      (error as Error)?.message || "INTERNAL"
    );
    res.status(500).json({ error: "Control operation failed." });
  }
}

function notificationId(value: unknown): string {
  return asUuid(value, "notification id");
}

async function listNotifications(req: Request, res: Response) {
  const a = actor(req);
  const raw = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(raw)
    ? Math.min(MAX_NOTIFICATIONS, Math.max(1, raw))
    : 50;
  const read = String(req.query.read ?? "all"),
    kind = String(req.query.kind ?? "all");
  if (
    !["all", "unread", "read"].includes(read) ||
    !["all", "failed", "completed"].includes(kind)
  )
    return res.status(400).json({ error: "Invalid notification filter." });
  const where = ["workspace_id=?", "owner_id=?"],
    params: unknown[] = [WORKSPACE, String(a.id)];
  if (read !== "all")
    where.push(read === "unread" ? "read_at IS NULL" : "read_at IS NOT NULL");
  if (kind !== "all") {
    where.push("kind=?");
    params.push(kind === "completed" ? "windows_ready" : "failed");
  }
  const items = await rows<any>(
    "SELECT id,run_id AS runId,kind,title,body,read_at AS readAt,created_at AS createdAt FROM wc_notifications WHERE " +
      where.join(" AND ") +
      " ORDER BY created_at DESC,id DESC LIMIT ?",
    [...params, limit]
  );
  const unread = await rows<any>(
    "SELECT COUNT(*) AS count FROM wc_notifications WHERE workspace_id=? AND owner_id=? AND read_at IS NULL",
    [WORKSPACE, String(a.id)]
  );
  res.set("Cache-Control", "private, no-store").json({
    notifications: items,
    items,
    unreadCount: Number(unread[0]?.count ?? 0),
    limit,
  });
}

async function markAllNotificationsRead(req: Request, res: Response) {
  const a = actor(req);
  if (
    req.body &&
    (typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length)
  )
    return res.status(400).json({ error: "No fields accepted." });
  const result = await exec(
    "UPDATE wc_notifications SET read_at=UTC_TIMESTAMP(3) WHERE workspace_id=? AND owner_id=? AND read_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 100",
    [WORKSPACE, String(a.id)]
  );
  await audit(String(a.id), "notification.read-all", null, {
    count: result.affectedRows,
  });
  return res.json({ readCount: result.affectedRows, limit: 100 });
}

async function markNotificationRead(req: Request, res: Response) {
  const a = actor(req);
  const id = notificationId(req.params.id);
  const result = await exec(
    "UPDATE wc_notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE id=? AND workspace_id=? AND owner_id=?",
    [id, WORKSPACE, String(a.id)]
  );
  if (!result.affectedRows)
    return res.status(404).json({ error: "Notification not found." });
  await audit(String(a.id), "notification.read", id);
  return res.json({ id, read: true });
}

async function importLegacy(req: Request, res: Response) {
  const a = actor(req);
  if (a.role !== "owner" && a.role !== "admin")
    return res.status(403).json({ error: "Owner/admin permission required" });
  const input = importInput(req.body);
  // Authentication is deliberately against the existing local tracking API.
  // No URL, callback, or caller-supplied table is ever read.
  const group = await getTrackingGroup(input.groupId, input.readToken);
  const plans = group.runs.map(run =>
    buildLegacyImportPlan(
      run as unknown as LegacyRunLike,
      input.groupId,
      String(a.id),
      input.readToken
    )
  );
  let imported = 0;
  let skipped = 0;
  await transaction(async (connection: PoolConnection) => {
    for (const plan of plans) {
      const existing = await connection.execute(
        "SELECT run_id,command_id,owner_id FROM wc_run_meta WHERE run_id=? LIMIT 1 FOR UPDATE",
        [plan.run.runId]
      );
      if ((existing[0] as Array<any>).length) {
        skipped++;
        continue;
      }
      const command = await connection.execute(
        "SELECT id,owner_id,label FROM wc_commands WHERE id=? LIMIT 1 FOR UPDATE",
        [plan.commandId]
      );
      if ((command[0] as Array<any>).length) {
        // Never attach a legacy run to an unrelated command, and never mutate
        // an existing command owned by the current or another principal.
        skipped++;
        continue;
      }
      await connection.execute(
        `INSERT INTO wc_commands (${COMMAND_COLUMNS}) VALUES (${plan.commandValues.map(() => "?").join(",")})`,
        plan.commandValues
      );
      await connection.execute(
        `INSERT INTO wc_run_meta (${RUN_COLUMNS}) VALUES (${plan.runValues.map(() => "?").join(",")})`,
        plan.runValues
      );
      await connection.execute(
        "INSERT IGNORE INTO wc_events (run_id,event_id,sequence_no,phase,stage,safe_code,proof_json,payload_json,client_at,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        plan.eventValues
      );
      imported++;
    }
  });
  const idempotent = plans.length === 0 || imported === 0;
  await audit(String(a.id), "legacy.import", null, {
    groupId: input.groupId,
    imported,
    skipped,
  });
  return res.json({ count: imported, imported, skipped, idempotent });
}

export function registerOperationsRoutes(app: Express): void {
  app.get(
    "/api/admin/notifications",
    requireAuth,
    requirePermission("activity:read"),
    (req, res, next) => {
      void listNotifications(req, res).catch(next);
    }
  );
  app.post(
    "/api/admin/notifications/read-all",
    requireAuth,
    requirePermission("activity:read"),
    (req, res, next) => {
      void markAllNotificationsRead(req, res).catch(next);
    }
  );
  app.post(
    "/api/admin/notifications/:id/read",
    requireAuth,
    requirePermission("activity:read"),
    (req, res, next) => {
      void markNotificationRead(req, res).catch(next);
    }
  );
  app.post(
    "/api/admin/legacy-import",
    requireAuth,
    requirePermission("deployments:write"),
    requireStepUp,
    (req, res, next) => {
      void importLegacy(req, res).catch(error => {
        if (error instanceof TrackingNotFoundError)
          return res.status(404).json({ error: "Tracker unavailable" });
        if (error instanceof TrackingValidationError)
          return res.status(400).json({ error: "Invalid tracker capability" });
        if (error instanceof OperationsInputError)
          return sendOperationsError(res, error);
        next(error);
      });
    }
  );
}

export default registerOperationsRoutes;
