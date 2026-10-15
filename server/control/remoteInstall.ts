import { reconciliationOutcome } from "../remoteInstall/reconciliation.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  remoteTargetSchema,
  remoteSettingsSchema,
  type RemoteReview,
  type RemoteSettings,
  type RemoteTarget,
  type TargetInventory,
  type RemoteHealth,
} from "@shared/remoteInstall";
import {
  postInstallOptionsSchema,
  scriptCompatible,
} from "@shared/postInstall";
import { resolveProfile } from "./profiles.js";
import { audit, requirePermission, type AdminRequest } from "./auth.js";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import { exec, rows, transaction } from "./db.js";
import {
  canonicalIp,
  discoverHost,
  connectTarget,
  assertPublicTarget,
  type TargetSession,
  RemoteSshError,
} from "../remoteInstall/sshClient.js";
import {
  queueHealth,
  remoteQueue,
  WORKSPACE,
  SECRET_TTL_MS,
} from "../remoteInstall/queue.js";

const NETWORK_WINDOW = new Map<string, { count: number; until: number }>();
function networkLimit(req: Request, res: Response, next: NextFunction) {
  const id = actor(req).id,
    now = Date.now();
  if (NETWORK_WINDOW.size > 1000)
    for (const [key, value] of NETWORK_WINDOW)
      if (value.until < now) NETWORK_WINDOW.delete(key);
  const prior = NETWORK_WINDOW.get(id),
    value =
      prior && prior.until > now ? prior : { count: 0, until: now + 60000 };
  value.count++;
  NETWORK_WINDOW.set(id, value);
  if (value.count > 10) {
    res.status(429).json({
      error: "REMOTE_RATE_LIMIT",
      message: "Wait before another target connection.",
    });
    return;
  }
  next();
}
const ENABLED = "1";
const CHECK_TTL_MS = 15 * 60_000;
const REVIEW_TTL_MS = 5 * 60_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FP_RE = /^SHA256:[A-Za-z0-9+/]+={0,2}$/;
const ID_KEY_RE = /^[A-Za-z0-9._:-]{16,128}$/;
const safeTargetSchema = remoteTargetSchema
  .extend({ host: z.string().trim().min(2).max(64) })
  .strict();

type HttpFailure = Error & { status: number; code: string };
function fail(status: number, code: string, message: string): never {
  const e = new Error(message) as HttpFailure;
  e.status = status;
  e.code = code;
  throw e;
}
function enabled(): boolean {
  return process.env.REMOTE_INSTALL_ENABLED === ENABLED;
}
function guardEnabled(): void {
  if (!enabled())
    fail(404, "REMOTE_INSTALL_DISABLED", "Remote installation is disabled.");
}
function actor(req: Request): { id: string; role: string } {
  const a = (req as AdminRequest).admin;
  if (!a) fail(401, "AUTH_REQUIRED", "Authentication required");
  return { id: a.id, role: a.role };
}
function body(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    fail(400, "INVALID_REQUEST", "Invalid request body");
  return req.body as Record<string, unknown>;
}
function parseTarget(value: unknown): RemoteTarget {
  const parsed = safeTargetSchema.safeParse(value);
  if (!parsed.success) fail(400, "INVALID_TARGET", "Invalid remote target.");
  return { ...parsed.data, host: canonicalIp(parsed.data.host.trim()) };
}
function parseFingerprint(value: unknown): string {
  if (typeof value !== "string" || !FP_RE.test(value.trim()))
    fail(400, "INVALID_FINGERPRINT", "Invalid SSH host fingerprint.");
  return value.trim();
}
function json<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      /* safe fallback */
    }
  }
  return fallback;
}
function iso(value: unknown): string {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? new Date(0).toISOString()
    : d.toISOString();
}
function sameFingerprint(a: string, b: string): boolean {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function safeError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "code" in error
  ) {
    const e = error as { status?: number; code?: string; message?: string };
    return {
      status: e.status && e.status >= 400 && e.status < 500 ? e.status : 500,
      code: e.code || "REMOTE_INSTALL_FAILED",
      message:
        e.status && e.status < 500
          ? e.message || "Request rejected"
          : "Remote installation failed.",
    };
  }
  if (error instanceof RemoteSshError)
    return { status: 422, code: error.code, message: error.message };
  return {
    status: 500,
    code: "REMOTE_INSTALL_FAILED",
    message: "Remote installation failed.",
  };
}
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(error => {
      const e = safeError(error);
      if (e.status >= 500)
        console.error("Remote install operation failed", e.code);
      res.status(e.status).json({ error: e.code, message: e.message });
    });
  };
}
function targetKey(target: RemoteTarget): string {
  return `${target.host}:${target.port}`;
}
function approvalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function publicReview(row: any): RemoteReview {
  const settings = json<Record<string, unknown>>(row.settings_json, {});
  delete settings.password;
  return {
    id: row.id,
    approvalDigest: row.approval_digest,
    expiresAt: iso(row.expires_at),
    target: json<RemoteTarget>(row.target_json, {
      host: row.target_host || "",
      port: Number(row.target_port || 22),
      username: "root",
    }),
    fingerprint: row.fingerprint,
    inventory: json<TargetInventory>(row.inventory_json, {} as TargetInventory),
    settings: settings as Omit<RemoteSettings, "password">,
    profileName: row.profile_name,
  };
}
function invalidExpired(value: unknown): boolean {
  return !value || new Date(String(value)).getTime() <= Date.now();
}

async function saveTrust(
  actorId: string,
  target: RemoteTarget,
  fingerprint: string,
  keyType: string
): Promise<void> {
  await exec(
    `INSERT INTO wc_remote_trust(workspace_id,host,port,fingerprint,key_type,approved_by,approved_at,last_seen_at)
    VALUES(?,?,?,?,?,?,NOW(6),NOW(6)) ON DUPLICATE KEY UPDATE fingerprint=VALUES(fingerprint),key_type=VALUES(key_type),approved_by=VALUES(approved_by),approved_at=VALUES(approved_at),last_seen_at=NOW(6)`,
    [
      WORKSPACE,
      target.host,
      target.port,
      fingerprint,
      keyType.slice(0, 64),
      actorId,
    ]
  );
}
async function checkRow(id: string, actorId: string): Promise<any> {
  if (!UUID_RE.test(id)) fail(400, "INVALID_CHECK", "Invalid check id.");
  const found = await rows<any>(
    "SELECT c.*,s.id AS ssh_secret_id,s.ciphertext AS ssh_ciphertext FROM wc_remote_checks c JOIN wc_remote_secrets s ON s.check_id=c.id AND s.purpose='ssh' AND s.cleared_at IS NULL WHERE c.workspace_id=? AND c.id=? AND c.actor_id=? LIMIT 1",
    [WORKSPACE, id, actorId]
  );
  const row = found[0];
  if (!row || invalidExpired(row.expires_at) || row.consumed_at)
    fail(410, "CHECK_EXPIRED", "The target check has expired.");
  return row;
}

export function remoteInstallEnabled(): boolean {
  return enabled();
}
export function validateRemoteSettings(value: unknown): RemoteSettings {
  const parsed = remoteSettingsSchema.safeParse(value);
  if (!parsed.success)
    fail(
      400,
      "INVALID_SETTINGS",
      parsed.error.issues[0]?.message || "Invalid Windows settings."
    );
  const postInstall = parsed.data.postInstall
    ? postInstallOptionsSchema.safeParse(parsed.data.postInstall)
    : { success: true as const, data: undefined };
  if (!postInstall.success)
    fail(
      400,
      "INVALID_POST_INSTALL",
      postInstall.error.issues[0]?.message || "Invalid post-install options."
    );
  return {
    ...parsed.data,
    ...(postInstall.data ? { postInstall: postInstall.data } : {}),
  } as RemoteSettings;
}

export function registerRemoteInstallRoutes(app: Express): void {
  app.get(
    "/api/admin/remote/config",
    requirePermission("remote:install"),
    route(async (_req, res) => {
      res.set("Cache-Control", "no-store").json({ enabled: enabled() });
    })
  );
  app.get(
    "/api/admin/remote/health",
    requirePermission("remote:install"),
    route(async (_req, res) => {
      const h = await queueHealth();
      const value: RemoteHealth = {
        enabled: enabled(),
        workerAlive:
          !!h.workerHeartbeatAt &&
          Date.now() - new Date(h.workerHeartbeatAt).getTime() < 90_000,
        workerHeartbeatAt: h.workerHeartbeatAt,
        queued: h.queued,
        oldestQueuedAt: h.oldestQueuedAt,
        uncertain: h.uncertain,
      };
      res.set("Cache-Control", "no-store").json(value);
    })
  );
  app.post(
    "/api/admin/remote/discover",
    requirePermission("remote:trust"),
    networkLimit,
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const target = parseTarget(body(req).target);
      await assertPublicTarget(target);
      let found: Awaited<ReturnType<typeof discoverHost>>;
      try {
        found = await discoverHost(target);
      } catch (error) {
        const safe = safeError(error);
        await audit(a.id, "remote.discover_failed", null, {
          target: targetKey(target),
          code: safe.code,
        });
        throw error;
      }
      await audit(a.id, "remote.discover", null, {
        target: targetKey(target),
        fingerprint: found.fingerprint,
        keyType: found.keyType,
      });
      res.set("Cache-Control", "no-store").json({
        target,
        fingerprint: found.fingerprint,
        keyType: found.keyType,
      });
    })
  );
  app.post(
    "/api/admin/remote/checks",
    requirePermission("remote:trust"),
    networkLimit,
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const b = body(req);
      const target = parseTarget(b.target);
      const fingerprint = parseFingerprint(b.fingerprint);
      if (b.trustHostKey !== true)
        fail(
          400,
          "HOST_KEY_TRUST_REQUIRED",
          "Explicitly approve the displayed host key before checking."
        );
      const sshPassword = b.password;
      if (
        typeof sshPassword !== "string" ||
        sshPassword.length < 1 ||
        sshPassword.length > 512 ||
        sshPassword.includes("\0")
      )
        fail(400, "INVALID_SSH_PASSWORD", "SSH password is invalid.");
      let session: Awaited<ReturnType<typeof connectTarget>> | null = null;
      let inventory: TargetInventory;
      try {
        await assertPublicTarget(target);
        const discovered = await discoverHost(target);
        if (!sameFingerprint(discovered.fingerprint, fingerprint))
          fail(409, "HOST_KEY_MISMATCH", "The target SSH host key changed.");
        await saveTrust(a.id, target, fingerprint, discovered.keyType);
        session = await connectTarget(target, sshPassword, fingerprint);
        inventory = await session.preflight(config().publicUrl);
      } catch (error) {
        const safe = safeError(error);
        await audit(a.id, "remote.check_failed", null, {
          target: targetKey(target),
          code: safe.code,
        });
        throw error;
      } finally {
        try {
          session?.close();
        } catch {
          /* Never replace the original safe diagnostic. */
        }
      }
      const checkId = randomUUID();
      const secretId = randomUUID();
      const expiresAt = new Date(Date.now() + CHECK_TTL_MS);
      await transaction(async c => {
        await c.execute(
          "INSERT INTO wc_remote_secrets(id,workspace_id,check_id,purpose,ciphertext,created_at,expires_at) VALUES(?,?,?,?,?,NOW(6),?)",
          [
            secretId,
            WORKSPACE,
            checkId,
            "ssh",
            encrypt(sshPassword, `remote:ssh:${secretId}`),
            expiresAt,
          ]
        );
        await c.execute(
          "INSERT INTO wc_remote_checks(id,workspace_id,actor_id,target_json,fingerprint,inventory_json,created_at,expires_at) VALUES(?,?,?,?,?,?,NOW(6),?)",
          [
            checkId,
            WORKSPACE,
            a.id,
            JSON.stringify(target),
            fingerprint,
            JSON.stringify(inventory),
            expiresAt,
          ]
        );
      });
      await audit(a.id, "remote.check", checkId, {
        target: targetKey(target),
        fingerprint,
        hostname: inventory.hostname,
      });
      res.set("Cache-Control", "no-store").status(201).json({
        checkId,
        target,
        fingerprint,
        inventory,
        expiresAt: expiresAt.toISOString(),
      });
    })
  );
  app.post(
    "/api/admin/remote/reviews",
    requirePermission("remote:install"),
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const b = body(req);
      const check = await checkRow(String(b.checkId || ""), a.id);
      const settings = validateRemoteSettings(b.settings);
      const profile = await resolveProfile(
        settings.profileId,
        settings.profileRevision
      );
      if (
        settings.postInstall?.runAttachedScript &&
        !scriptCompatible(profile.osId)
      )
        fail(
          422,
          "ATTACHED_SCRIPT_INCOMPATIBLE",
          "The attached script is not compatible with this profile."
        );
      const reviewId = randomUUID();
      const settingsSecretId = randomUUID();
      const expiresAt = new Date(Date.now() + REVIEW_TTL_MS);
      const target = json<RemoteTarget>(check.target_json, {
        host: "",
        port: 22,
        username: "root",
      });
      const inventory = json<TargetInventory>(
        check.inventory_json,
        {} as TargetInventory
      );
      const digest = approvalDigest({
        workspace: WORKSPACE,
        target,
        fingerprint: check.fingerprint,
        inventory,
        settings: { ...settings, password: undefined },
        profile,
      });
      const settingsMeta = { ...settings };
      delete (settingsMeta as any).password;
      await transaction(async c => {
        const [consumed]: any = await c.execute(
          "UPDATE wc_remote_checks SET consumed_at=NOW(6) WHERE workspace_id=? AND id=? AND actor_id=? AND consumed_at IS NULL AND expires_at>NOW(6)",
          [WORKSPACE, check.id, a.id]
        );
        if (consumed.affectedRows !== 1)
          fail(410, "CHECK_EXPIRED", "This check was already used or expired.");
        await c.execute(
          "INSERT INTO wc_remote_secrets(id,workspace_id,check_id,review_id,purpose,ciphertext,created_at,expires_at) VALUES(?,?,?,?,?,?,NOW(6),?)",
          [
            settingsSecretId,
            WORKSPACE,
            check.id,
            reviewId,
            "settings",
            encrypt(
              JSON.stringify(settings),
              `remote:settings:${settingsSecretId}`
            ),
            expiresAt,
          ]
        );
        await c.execute(
          "UPDATE wc_remote_secrets SET review_id=? WHERE workspace_id=? AND check_id=? AND purpose='ssh' AND cleared_at IS NULL",
          [reviewId, WORKSPACE, check.id]
        );
        await c.execute(
          "INSERT INTO wc_remote_reviews(id,workspace_id,actor_id,check_id,target_json,fingerprint,inventory_json,settings_json,settings_secret_id,approval_digest,profile_id,profile_revision,profile_snapshot_json,profile_name,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(6),?)",
          [
            reviewId,
            WORKSPACE,
            a.id,
            check.id,
            JSON.stringify(target),
            check.fingerprint,
            JSON.stringify(inventory),
            JSON.stringify(settingsMeta),
            settingsSecretId,
            digest,
            profile.id,
            profile.revision,
            JSON.stringify(profile),
            profile.name,
            expiresAt,
          ]
        );
      });
      await audit(a.id, "remote.review", reviewId, {
        target: targetKey(target),
        fingerprint: check.fingerprint,
        profileId: profile.id,
        profileRevision: profile.revision,
        approvalDigest: digest,
      });
      res
        .set("Cache-Control", "no-store")
        .status(201)
        .json(
          publicReview({
            id: reviewId,
            approval_digest: digest,
            expires_at: expiresAt,
            target_json: target,
            fingerprint: check.fingerprint,
            inventory_json: inventory,
            settings_json: settingsMeta,
            profile_name: profile.name,
          })
        );
    })
  );
  app.post(
    "/api/admin/remote/jobs",
    requirePermission("remote:install"),
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const b = body(req);
      const reviewId = String(b.reviewId || "");
      const key = String(b.idempotencyKey || "");
      if (!UUID_RE.test(reviewId) || !ID_KEY_RE.test(key))
        fail(400, "INVALID_REQUEST", "Review or idempotency key is invalid.");
      if (
        b.eraseConfirmed !== true ||
        b.backupConfirmed !== true ||
        b.recoveryConfirmed !== true
      )
        fail(
          400,
          "ACKNOWLEDGEMENTS_REQUIRED",
          "All installation acknowledgements are required."
        );
      const result: { existingId: string } = await transaction(async c => {
        const [existingRows] = await c.execute(
          "SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND owner_id=? AND idempotency_key=? FOR UPDATE",
          [WORKSPACE, a.id, key]
        );
        const existing = (existingRows as any[])[0];
        if (existing) {
          if (existing.review_id !== reviewId)
            fail(
              409,
              "IDEMPOTENCY_MISMATCH",
              "This key was already used for another review."
            );
          const [savedApproval]: any = await c.execute(
            "SELECT approval_digest FROM wc_remote_reviews WHERE id=? AND workspace_id=?",
            [reviewId, WORKSPACE]
          );
          if (
            !savedApproval[0] ||
            typeof b.approvalDigest !== "string" ||
            !sameFingerprint(b.approvalDigest, savedApproval[0].approval_digest)
          )
            fail(
              409,
              "APPROVAL_MISMATCH",
              "The approved review does not match."
            );
          return { existingId: String(existing.id) };
        }
        const [reviewRows] = await c.execute(
          "SELECT * FROM wc_remote_reviews WHERE workspace_id=? AND id=? AND actor_id=? FOR UPDATE",
          [WORKSPACE, reviewId, a.id]
        );
        const review = (reviewRows as any[])[0];
        if (!review || invalidExpired(review.expires_at) || review.consumed_at)
          fail(410, "REVIEW_EXPIRED", "The installation review has expired.");
        if (
          typeof b.approvalDigest !== "string" ||
          !sameFingerprint(b.approvalDigest, review.approval_digest)
        )
          fail(
            409,
            "APPROVAL_MISMATCH",
            "The approved review no longer matches."
          );
        const target = json<RemoteTarget>(review.target_json, {
          host: "",
          port: 22,
          username: "root",
        });
        const [trustRows] = await c.execute(
          "SELECT host,port,fingerprint FROM wc_remote_trust WHERE workspace_id=? AND host=? ORDER BY port FOR UPDATE",
          [WORKSPACE, target.host]
        );
        const trust = (trustRows as any[]).find(
          t => Number(t.port) === target.port
        );
        if (
          !trust ||
          !sameFingerprint(
            String(trust.fingerprint),
            String(review.fingerprint)
          )
        )
          fail(
            409,
            "HOST_KEY_REAPPROVAL_REQUIRED",
            "The target host key must be approved again."
          );
        const [activeRows] = await c.execute(
          "SELECT id FROM wc_remote_jobs WHERE workspace_id=? AND target_host=? AND state IN ('queued','connecting','checking','sending','launching','launch_uncertain','handed_off') AND (state<>'handed_off' OR NOT EXISTS(SELECT 1 FROM wc_run_meta m WHERE m.command_id=wc_remote_jobs.command_id AND m.stage IN('windows_ready','failed'))) LIMIT 1 FOR UPDATE",
          [WORKSPACE, target.host]
        );
        if ((activeRows as any[])[0])
          fail(
            409,
            "TARGET_BUSY",
            "The target already has an unresolved remote job."
          );
        const id = randomUUID();
        const now = new Date();
        const deadline = new Date(now.getTime() + 10 * 60_000);
        const sshRows = await c.execute(
          "SELECT id FROM wc_remote_secrets WHERE workspace_id=? AND review_id=? AND purpose='ssh' AND cleared_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [WORKSPACE, reviewId, now]
        );
        const ssh = (sshRows[0] as any[])[0];
        if (!ssh)
          fail(
            410,
            "SSH_SECRET_EXPIRED",
            "The temporary SSH credential has expired."
          );
        await c.execute(
          "INSERT INTO wc_remote_jobs(id,workspace_id,owner_id,review_id,idempotency_key,target_host,target_port,target_json,fingerprint,expected_inventory_json,settings_secret_id,ssh_secret_id,label,profile_name,state,dispatch_attempt,deadline_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'queued',0,?,?,?)",
          [
            id,
            WORKSPACE,
            a.id,
            reviewId,
            key,
            target.host,
            target.port,
            review.target_json,
            review.fingerprint,
            review.inventory_json,
            review.settings_secret_id,
            ssh.id,
            json<any>(review.settings_json, {}).label || "",
            review.profile_name,
            deadline,
            now,
            now,
          ]
        );
        await c.execute(
          "UPDATE wc_remote_reviews SET consumed_at=? WHERE workspace_id=? AND id=? AND consumed_at IS NULL",
          [now, WORKSPACE, reviewId]
        );
        await c.execute(
          "UPDATE wc_remote_secrets SET job_id=?,expires_at=? WHERE workspace_id=? AND (id=? OR id=?)",
          [id, deadline, WORKSPACE, review.settings_secret_id, ssh.id]
        );
        await c.execute(
          "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) VALUES(?,?,?,?,?)",
          [WORKSPACE, id, "queued", "QUEUED", now]
        );
        return { existingId: id };
      });
      const job = await remoteQueue.get(result.existingId, a.id);
      if (!job) fail(500, "JOB_CREATE_FAILED", "Job could not be created.");
      await audit(a.id, "remote.job_queued", job.id, {
        target: targetKey(job.target),
        approvalDigest: b.approvalDigest,
      });
      res.set("Cache-Control", "no-store").status(201).json({ job });
    })
  );
  app.get(
    "/api/admin/remote/jobs",
    requirePermission("remote:install"),
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      res
        .set("Cache-Control", "no-store")
        .json({ items: await remoteQueue.list(a.id) });
    })
  );
  app.get(
    "/api/admin/remote/jobs/:id",
    requirePermission("remote:install"),
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const job = await remoteQueue.get(req.params.id, a.id);
      if (!job) fail(404, "JOB_NOT_FOUND", "Remote job not found.");
      res
        .set("Cache-Control", "no-store")
        .json({ job, events: await remoteQueue.events(job.id, a.id) });
    })
  );
  app.post(
    "/api/admin/remote/jobs/:id/cancel",
    requirePermission("remote:install"),
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const job = await remoteQueue.cancel(req.params.id, a.id);
      if (!job) fail(404, "JOB_NOT_FOUND", "Remote job not found.");
      await audit(a.id, "remote.job_cancelled", job.id, {
        target: targetKey(job.target),
      });
      res.set("Cache-Control", "no-store").json({ job });
    })
  );
  app.post(
    "/api/admin/remote/jobs/:id/reconcile",
    requirePermission("remote:install"),
    networkLimit,
    route(async (req, res) => {
      guardEnabled();
      const a = actor(req);
      const row = await remoteQueue.raw(req.params.id);
      if (!row || row.owner_id !== a.id)
        fail(404, "JOB_NOT_FOUND", "Remote job not found.");
      if (row.state !== "launch_uncertain")
        fail(
          409,
          "RECONCILE_NOT_REQUIRED",
          "This job does not require reconciliation."
        );
      const b = body(req);
      if (
        typeof b.password !== "string" ||
        !b.password ||
        b.password.length > 512 ||
        b.password.includes("\0")
      )
        fail(
          400,
          "PASSWORD_REQUIRED",
          "Re-enter the SSH password for read-only reconciliation."
        );
      const session = await connectTarget(
        json<RemoteTarget>(row.target_json, {
          host: row.target_host,
          port: row.target_port,
          username: "root",
        }),
        b.password,
        row.fingerprint
      );
      let receipt;
      try {
        receipt = await session.reconcile(row.id);
      } finally {
        session.close();
      }
      const outcome = reconciliationOutcome(receipt);
      if (outcome) {
        await remoteQueue.setState(row.id, outcome.state, outcome.errorCode);
        if (outcome.clearSecrets) await remoteQueue.clearSecrets(row.id);
      }
      const job = await remoteQueue.get(row.id, a.id);
      await audit(a.id, "remote.job_reconciled", row.id, {
        outcome: receipt.state,
      });
      res.set("Cache-Control", "no-store").json({
        job,
        receipt: {
          state: receipt.state,
          ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        },
      });
    })
  );
}
export default registerRemoteInstallRoutes;
