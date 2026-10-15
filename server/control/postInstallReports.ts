import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  attachedScript,
  isPublicFileUrl,
  postInstallReportSchema,
  postInstallView,
  type PostInstallFile,
  type PostInstallPlan,
  type PostInstallReport,
  type PostInstallView,
} from "../../shared/postInstall";
import { rows, transaction } from "./db";

type SqlConn = {
  query?: (sql: string, params?: unknown[]) => Promise<any>;
  execute?: (sql: string, params?: unknown[]) => Promise<any>;
};

type TrackingRow = {
  id: string;
  groupId: string;
  reportTokenHash: string;
  stage: string;
  expiresAt: Date | string;
};

type RunRow = {
  run_id: string;
  workspace_id: string;
  owner_id?: string;
  command_id: string;
  stage: string;
  purged_at: Date | string | null;
  config_json: unknown;
};

type StoredReportRow = {
  report_json: unknown;
  updated_at: Date | string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_BYTES = 1_073_741_824;
const TERMINAL = new Set<PostInstallReport["status"]>([
  "completed",
  "failed",
  "timed_out",
  "interrupted",
]);
const STATUS_ORDER: Record<PostInstallReport["status"], number> = {
  waiting: 0,
  running: 1,
  completed: 2,
  failed: 2,
  timed_out: 2,
  interrupted: 2,
};

export class PostInstallNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("Post-install record unavailable.");
    this.name = "PostInstallNotFoundError";
  }
}

export class PostInstallValidationError extends Error {
  readonly status = 400;
  constructor(message = "Post-install report rejected.") {
    super(message);
    this.name = "PostInstallValidationError";
  }
}

export class PostInstallDatabaseError extends Error {
  readonly status = 503;
  constructor() {
    super("Post-install tracking unavailable.");
    this.name = "PostInstallDatabaseError";
  }
}

export function isCanonicalUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isCanonicalReportToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

function digestToken(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("hex");
}

function capabilityMatches(stored: unknown, presented: string): boolean {
  if (typeof stored !== "string" || !HASH_RE.test(stored)) return false;
  const expected = Buffer.from(stored, "hex");
  const actual = Buffer.from(digestToken(presented), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isPostInstallExpiryValid(
  expiresAt: Date | string | number,
  now: Date | string | number = Date.now()
): boolean {
  const expiry = new Date(expiresAt).getTime();
  const current = new Date(now).getTime();
  return (
    Number.isFinite(expiry) && Number.isFinite(current) && expiry > current
  );
}

/** Terminal reports are immutable; non-terminal reports only move forward. */
export function validPostInstallTransition(
  previous: PostInstallReport["status"],
  next: PostInstallReport["status"]
): boolean {
  if (previous === next) return true;
  if (TERMINAL.has(previous)) return false;
  if (next === "waiting") return false;
  return STATUS_ORDER[next] >= STATUS_ORDER[previous];
}

export const isValidPostInstallTransition = validPostInstallTransition;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safePlanUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096)
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      !/[\x00-\x20'"`$\\]/.test(value) &&
      url.hostname.includes(".") &&
      !/^(localhost|.*\.(localhost|local|internal|test)|\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(
        url.hostname.toLowerCase()
      )
    );
  } catch {
    return false;
  }
}

function planFiles(plan: PostInstallPlan): PostInstallFile[] {
  return plan.files;
}

/** Validate the immutable command snapshot before using it as report authority. */
export function validatePostInstallPlan(value: unknown): PostInstallPlan {
  const plan = asObject(parseJson(value));
  const options = asObject(plan?.options);
  if (!plan || plan.version !== 1 || !options || !Array.isArray(plan.files))
    throw new PostInstallNotFoundError();
  if (
    typeof options.getFiles !== "boolean" ||
    typeof options.runAttachedScript !== "boolean" ||
    !Array.isArray(options.apps) ||
    typeof options.customFileUrl !== "string"
  )
    throw new PostInstallNotFoundError();
  if (
    options.apps.some(
      v => !["chrome", "firefox", "edge", "brave", "7zip"].includes(String(v))
    ) ||
    new Set(options.apps as unknown[]).size !== options.apps.length ||
    options.customFileUrl.length > 4096 ||
    (options.customFileUrl !== "" && !isPublicFileUrl(options.customFileUrl))
  )
    throw new PostInstallNotFoundError();

  const seen = new Set<string>();
  const files: PostInstallFile[] = [];
  for (const raw of plan.files) {
    const file = asObject(raw);
    if (!file || typeof file.id !== "string" || seen.has(file.id))
      throw new PostInstallNotFoundError();
    if (
      !["chrome", "firefox", "edge", "brave", "7zip", "custom"].includes(
        file.id
      )
    )
      throw new PostInstallNotFoundError();
    if (
      typeof file.name !== "string" ||
      typeof file.version !== "string" ||
      typeof file.filename !== "string" ||
      !safePlanUrl(file.url) ||
      (file.sha256 !== null &&
        (typeof file.sha256 !== "string" || !HASH_RE.test(file.sha256))) ||
      !Number.isInteger(file.maxBytes) ||
      Number(file.maxBytes) < 1 ||
      Number(file.maxBytes) > MAX_BYTES ||
      (file.publisher !== null && typeof file.publisher !== "string") ||
      typeof file.requireSignature !== "boolean" ||
      !Number.isInteger(file.minBuild) ||
      Number(file.minBuild) < 0
    )
      throw new PostInstallNotFoundError();
    seen.add(file.id);
    files.push(file as unknown as PostInstallFile);
  }
  if (Boolean(options.getFiles) !== files.length > 0)
    throw new PostInstallNotFoundError();

  const rawScript = plan.script;
  if (options.runAttachedScript) {
    const script = asObject(rawScript);
    if (
      !script ||
      script.name !== attachedScript.name ||
      script.version !== attachedScript.version ||
      script.sha256 !== attachedScript.sha256
    )
      throw new PostInstallNotFoundError();
  } else if (rawScript !== null) {
    throw new PostInstallNotFoundError();
  }
  return {
    version: 1,
    options: options as unknown as PostInstallPlan["options"],
    files,
    script: rawScript as PostInstallPlan["script"],
  };
}

function fileById(plan: PostInstallPlan): Map<string, PostInstallFile> {
  return new Map(planFiles(plan).map(file => [file.id, file]));
}

/** Strictly bind every reported outcome to the immutable command plan. */
export function validateReportForPlan(
  input: unknown,
  planInput: PostInstallPlan | unknown
): PostInstallReport {
  const parsed = postInstallReportSchema.safeParse(input);
  if (!parsed.success) throw new PostInstallValidationError();
  const plan = validatePostInstallPlan(planInput);
  const report = parsed.data;
  const expected = fileById(plan);
  const ids = report.files.map(file => file.id);
  if (new Set(ids).size !== ids.length || ids.length !== expected.size)
    throw new PostInstallValidationError();
  for (const outcome of report.files) {
    const planned = expected.get(outcome.id);
    if (!planned || outcome.bytes > planned.maxBytes)
      throw new PostInstallValidationError();
    if (outcome.status === "downloaded") {
      if (outcome.bytes <= 0 || !outcome.sha256)
        throw new PostInstallValidationError();
      if (planned.sha256 !== null && outcome.sha256 !== planned.sha256)
        throw new PostInstallValidationError();
    } else if (outcome.sha256 !== null) {
      throw new PostInstallValidationError();
    }
  }

  const script = report.script;
  if (!plan.options.runAttachedScript) {
    if (
      script.enabled ||
      script.status !== "disabled" ||
      script.exitCode !== null ||
      script.activationObserved !== null
    )
      throw new PostInstallValidationError();
  } else {
    if (!plan.script || !script.enabled || script.status === "disabled")
      throw new PostInstallValidationError();
    if (
      script.activationObserved === true &&
      ["pending", "running"].includes(script.status)
    )
      throw new PostInstallValidationError();
    if (
      script.status === "completed" &&
      (script.exitCode !== 0 || script.activationObserved !== true)
    )
      throw new PostInstallValidationError();
  }

  if (report.status === "completed") {
    if (report.files.some(file => file.status !== "downloaded"))
      throw new PostInstallValidationError();
    if (plan.options.runAttachedScript && script.status !== "completed")
      throw new PostInstallValidationError();
  }
  return report;
}

function connQuery<T = any>(
  conn: SqlConn,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const fn = conn.execute ?? conn.query;
  if (!fn)
    return Promise.reject(new Error("Database connection has no query method"));
  return fn
    .call(conn, sql, params)
    .then((result: any) =>
      Array.isArray(result) && Array.isArray(result[0])
        ? result[0]
        : Array.isArray(result)
          ? result
          : []
    );
}

function connExec(
  conn: SqlConn,
  sql: string,
  params: unknown[] = []
): Promise<any> {
  const fn = conn.execute ?? conn.query;
  if (!fn)
    return Promise.reject(new Error("Database connection has no query method"));
  return fn.call(conn, sql, params);
}

function normalizedReport(value: unknown): PostInstallReport {
  const parsed = postInstallReportSchema.safeParse(parseJson(value));
  if (!parsed.success) throw new PostInstallDatabaseError();
  return parsed.data;
}

function reportsEqual(a: PostInstallReport, b: PostInstallReport): boolean {
  const canonical = (report: PostInstallReport) =>
    JSON.stringify({
      ...report,
      files: [...report.files].sort((x, y) => x.id.localeCompare(y.id)),
    });
  return canonical(a) === canonical(b);
}

export async function recordPostInstallReport(
  runIdInput: string,
  reportToken: string,
  input: unknown
): Promise<{ idempotent: boolean }> {
  if (!isCanonicalUUID(runIdInput) || !isCanonicalReportToken(reportToken))
    throw new PostInstallNotFoundError();
  return transaction(async tx => {
    const tracking = (
      await connQuery<TrackingRow>(
        tx,
        "SELECT id,groupId,reportTokenHash,stage,expiresAt FROM installerTrackingRuns WHERE id=? LIMIT 1 FOR UPDATE",
        [runIdInput]
      )
    )[0];
    if (!tracking || !capabilityMatches(tracking.reportTokenHash, reportToken))
      throw new PostInstallNotFoundError();
    if (!isPostInstallExpiryValid(tracking.expiresAt))
      throw new PostInstallNotFoundError();

    // Locking the legacy/control row serializes the first callback as well as updates.
    const run = (
      await connQuery<RunRow>(
        tx,
        "SELECT r.run_id,r.workspace_id,r.owner_id,r.command_id,r.stage,r.purged_at,c.config_json FROM wc_run_meta r INNER JOIN wc_commands c ON c.id=r.command_id AND c.workspace_id=r.workspace_id WHERE r.run_id=? AND r.purged_at IS NULL LIMIT 1 FOR UPDATE",
        [runIdInput]
      )
    )[0];
    if (
      !run ||
      run.purged_at ||
      run.stage !== "windows_ready" ||
      tracking.stage !== "windows_ready"
    )
      throw new PostInstallNotFoundError();
    const config = asObject(parseJson(run.config_json));
    const rawPlan = config?.postInstall;
    if (!rawPlan) throw new PostInstallNotFoundError();
    const plan = validatePostInstallPlan(rawPlan);
    const report = validateReportForPlan(input, plan);
    const previousRow = (
      await connQuery<StoredReportRow>(
        tx,
        "SELECT report_json,updated_at FROM wc_post_install_runs WHERE run_id=? AND workspace_id=? LIMIT 1 FOR UPDATE",
        [runIdInput, run.workspace_id]
      )
    )[0];
    if (previousRow) {
      const previous = normalizedReport(previousRow.report_json);
      if (TERMINAL.has(previous.status)) {
        if (reportsEqual(previous, report)) return { idempotent: true };
        throw new PostInstallValidationError();
      }
      if (!validPostInstallTransition(previous.status, report.status))
        throw new PostInstallValidationError();
      await connExec(
        tx,
        "UPDATE wc_post_install_runs SET report_json=?,updated_at=? WHERE run_id=? AND workspace_id=?",
        [JSON.stringify(report), new Date(), runIdInput, run.workspace_id]
      );
      return { idempotent: false };
    }
    const now = new Date();
    await connExec(
      tx,
      "INSERT INTO wc_post_install_runs (run_id,workspace_id,report_json,created_at,updated_at) VALUES (?,?,?,?,?)",
      [runIdInput, run.workspace_id, JSON.stringify(report), now, now]
    );
    return { idempotent: false };
  });
}

/** Build the admin-facing DTO without exposing the custom URL or report transport fields. */
export async function getPostInstallView(
  runIdInput: string,
  planInput?: PostInstallPlan
): Promise<PostInstallView | null> {
  if (!isCanonicalUUID(runIdInput)) return null;
  const found = await rows<any>(
    "SELECT c.config_json,p.report_json,p.updated_at FROM wc_run_meta r INNER JOIN wc_commands c ON c.id=r.command_id AND c.workspace_id=r.workspace_id LEFT JOIN wc_post_install_runs p ON p.run_id=r.run_id AND p.workspace_id=r.workspace_id WHERE r.run_id=? AND r.purged_at IS NULL LIMIT 1",
    [runIdInput]
  );
  const row = found[0];
  if (!row) return null;
  const plan =
    planInput ??
    validatePostInstallPlan(asObject(parseJson(row.config_json))?.postInstall);
  const report =
    row.report_json == null ? null : normalizedReport(row.report_json);
  const updated =
    row.updated_at == null ? null : new Date(row.updated_at).toISOString();
  return postInstallView(plan, report, updated, runIdInput);
}

function setHeaders(res: Response): void {
  res.set({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function bearer(req: Request): string | null {
  const value = req.get("Authorization") ?? "";
  return /^Bearer [0-9a-f]{64}$/.test(value) ? value.slice(7) : null;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof PostInstallValidationError)
    res.status(400).json({ error: "Post-install report rejected." });
  else if (error instanceof PostInstallNotFoundError)
    res.status(404).json({ error: "Post-install record unavailable." });
  else if (error instanceof PostInstallDatabaseError)
    res.status(503).json({ error: "Post-install tracking unavailable." });
  else res.status(500).json({ error: "Post-install tracking failed." });
}

export function registerPostInstallRoutes(app: Express): void {
  app.post(
    "/api/installer/tracking/runs/:runId/post-install",
    async (req, res) => {
      setHeaders(res);
      const token = bearer(req);
      if (!token) {
        res.status(401).json({ error: "Report capability required." });
        return;
      }
      try {
        const result = await recordPostInstallReport(
          req.params.runId,
          token,
          req.body
        );
        res.status(204).end();
        void result;
      } catch (error) {
        sendError(res, error);
      }
    }
  );
}

export default registerPostInstallRoutes;
