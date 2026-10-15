import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PoolConnection } from "mysql2/promise";
import { adminPasswordIssue } from "../../shared/adminPassword";
import { config } from "./config";
import {
  digest,
  decrypt,
  encrypt,
  generateTotpSecret,
  hashPassword,
  randomToken,
  totpMatchingStep,
  totpUri,
  verifyPassword,
} from "./crypto";
import { exec, rows, transaction } from "./db";

export const SESSION_COOKIE = "win11desk_admin_session";
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const STEP_UP_MS = 5 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY = 16_384;
const HASH_MAX_ACTIVE = 2;
const HASH_MAX_WAITERS = 16;
let hashActive = 0;
const hashWaiters: Array<() => void> = [];

export type AdminRole = "owner" | "admin" | "operator" | "viewer";
export type Permission =
  | "remote:install"
  | "remote:trust"
  | "workspace:read"
  | "commands:read"
  | "commands:write"
  | "deployments:read"
  | "deployments:write"
  | "credentials:reveal"
  | "settings:read"
  | "settings:write"
  | "users:read"
  | "users:manage"
  | "activity:read"
  | "auth:password"
  | "auth:mfa"
  | "auth:recovery";
const CAPABILITIES: Record<AdminRole, ReadonlySet<Permission>> = {
  owner: new Set([
    "workspace:read",
    "commands:read",
    "commands:write",
    "deployments:read",
    "deployments:write",
    "credentials:reveal",
    "settings:read",
    "settings:write",
    "users:read",
    "users:manage",
    "remote:install",
    "remote:trust",
    "activity:read",
    "auth:password",
    "auth:mfa",
    "auth:recovery",
  ]),
  admin: new Set([
    "workspace:read",
    "commands:read",
    "commands:write",
    "deployments:read",
    "deployments:write",
    "credentials:reveal",
    "settings:read",
    "settings:write",
    "users:read",
    "users:manage",
    "remote:install",
    "remote:trust",
    "activity:read",
    "auth:password",
    "auth:mfa",
    "auth:recovery",
  ]),
  operator: new Set([
    "workspace:read",
    "commands:read",
    "commands:write",
    "deployments:read",
    "deployments:write",
    "settings:read",
    "auth:password",
    "auth:mfa",
    "auth:recovery",
  ]),
  viewer: new Set([
    "workspace:read",
    "deployments:read",
    "settings:read",
    "auth:password",
    "auth:mfa",
    "auth:recovery",
  ]),
};
export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  csrf: string;
  sessionId: string;
}
export type AdminRequest = Request & { admin?: AdminPrincipal };
interface AccountRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  password_hash: string;
  active: number;
  mfa_enabled: number;
  mfa_secret_envelope: string | null;
  mfa_pending_envelope: string | null;
  mfa_pending_expires: string | null;
}
interface SessionRow extends AccountRow {
  session_id: string;
  csrf_token: string;
  session_created_at: string;
  last_seen_at: string;
  expires_at: string;
  step_up_at: string | null;
  revoked_at: string | null;
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string" || email.length > 320)
    throw new Error("Invalid email");
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320)
    throw new Error("Invalid email");
  return value;
}
export function can(role: AdminRole, permission: Permission | string): boolean {
  return CAPABILITIES[role]?.has(permission as Permission) ?? false;
}
export function canGrantRole(actor: AdminRole, role: AdminRole): boolean {
  return actor === "owner" || (role !== "owner" && role !== "admin");
}
export function canAlterTarget(
  actor: AdminRole,
  targetRole: AdminRole
): boolean {
  return actor === "owner" || targetRole !== "owner";
}
export function removesActiveOwner(
  targetRole: AdminRole,
  targetActive: boolean,
  nextRole: AdminRole,
  nextActive: boolean
): boolean {
  return (
    targetRole === "owner" &&
    targetActive &&
    (nextRole !== "owner" || !nextActive)
  );
}
function httpError(
  status: number,
  code: string,
  message: string
): Error & { status: number; code: string } {
  const e = new Error(message) as Error & { status: number; code: string };
  e.status = status;
  e.code = code;
  return e;
}
function body(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw httpError(400, "INVALID_REQUEST", "Invalid request body");
  if (JSON.stringify(req.body).length > MAX_BODY)
    throw httpError(413, "REQUEST_TOO_LARGE", "Request is too large");
  return req.body as Record<string, unknown>;
}
function text(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string" || v.length < min || v.length > max)
    throw httpError(400, "INVALID_REQUEST", `${field} is invalid`);
  return v;
}
function sendError(res: Response, error: unknown): void {
  const e = error as Partial<{ status: number; code: string; message: string }>;
  const status = e.status && e.status >= 400 && e.status < 500 ? e.status : 500;
  res.status(status).json({
    error: e.code || "AUTH_ERROR",
    message:
      status === 500
        ? "Authentication service error"
        : e.message || "Request rejected",
  });
}
function route(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(error => sendError(res, error));
  };
}
export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* malformed cookie is treated as absent */
    }
  }
  return out;
}
export function sessionCookieOptions() {
  const c = config();
  return {
    httpOnly: true,
    secure: !c.allowHttp,
    sameSite:
      process.env.EMBEDDED_PREVIEW === "1"
        ? ("none" as const)
        : ("lax" as const),
    path: "/",
    maxAge: ABSOLUTE_MS,
  };
}
function issueCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}
function clearCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: 0 });
}
function clientIp(req: Request): string {
  return (req.socket.remoteAddress || "unknown").slice(0, 128);
}
function safeUser(a: AdminPrincipal) {
  return { id: a.id, email: a.email, name: a.name, role: a.role };
}
function requirePasswordPolicy(password: unknown): string {
  const issue = adminPasswordIssue(password);
  if (issue) throw httpError(400, issue.code, issue.message);
  return password as string;
}
function originAllowed(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  const allowed = new Set([config().publicUrl]);
  if (process.env.PREVIEW_ORIGIN)
    allowed.add(process.env.PREVIEW_ORIGIN.replace(/\/$/, ""));
  return allowed.has(origin.replace(/\/$/, ""));
}
function assertOrigin(req: Request): void {
  if (!originAllowed(req))
    throw httpError(403, "ORIGIN_REJECTED", "Request origin is not allowed");
}
function assertMutation(req: Request): void {
  assertOrigin(req);
  const expected = (req as AdminRequest).admin?.csrf;
  if (!expected || req.get("x-csrf-token") !== expected)
    throw httpError(403, "CSRF_REJECTED", "CSRF token is invalid");
}
function dateMs(value: string | Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

async function withHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (hashActive >= HASH_MAX_ACTIVE) {
    if (hashWaiters.length >= HASH_MAX_WAITERS)
      throw httpError(
        429,
        "AUTH_BUSY",
        "Authentication is busy; try again later"
      );
    await new Promise<void>(resolve => hashWaiters.push(resolve));
  }
  hashActive++;
  try {
    return await work();
  } finally {
    hashActive--;
    hashWaiters.shift()?.();
  }
}
async function boundedHash(password: string): Promise<string> {
  return withHashSlot(() => hashPassword(password));
}
async function boundedVerify(hash: string, password: string): Promise<boolean> {
  return withHashSlot(() => verifyPassword(hash, password));
}

async function loadAdmin(req: Request): Promise<AdminPrincipal | undefined> {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return undefined;
  const session = (
    await rows<SessionRow>(
      "SELECT s.id AS session_id,s.csrf_token,s.created_at AS session_created_at,s.last_seen_at,s.expires_at,s.step_up_at,s.revoked_at,a.id,a.email,a.name,a.role,a.password_hash,a.active,a.mfa_enabled,a.mfa_secret_envelope,a.mfa_pending_envelope,a.mfa_pending_expires FROM wc_sessions s JOIN wc_accounts a ON a.id=s.account_id WHERE s.token_digest=? LIMIT 1",
      [digest(raw)]
    )
  )[0];
  if (!session || !session.active || session.revoked_at) return undefined;
  const now = Date.now();
  if (
    dateMs(session.expires_at) <= now ||
    now - dateMs(session.last_seen_at) > IDLE_MS
  ) {
    await exec(
      "UPDATE wc_sessions SET revoked_at=NOW(6) WHERE id=? AND revoked_at IS NULL",
      [session.session_id]
    );
    return undefined;
  }
  if (req.get("x-admin-polling") !== "1")
    await exec(
      "UPDATE wc_sessions SET last_seen_at=NOW(6) WHERE id=? AND revoked_at IS NULL",
      [session.session_id]
    );
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    role: session.role,
    csrf: session.csrf_token,
    sessionId: session.session_id,
  };
}
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  void loadAdmin(req)
    .then(admin => {
      if (!admin)
        return void res
          .status(401)
          .json({ error: "AUTH_REQUIRED", message: "Authentication required" });
      (req as AdminRequest).admin = admin;
      next();
    })
    .catch(next);
}
const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export function requirePermission(permission: Permission | string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void loadAdmin(req)
      .then(admin => {
        if (!admin)
          return void res.status(401).json({
            error: "AUTH_REQUIRED",
            message: "Authentication required",
          });
        (req as AdminRequest).admin = admin;
        if (!can(admin.role, permission))
          return void res
            .status(403)
            .json({ error: "FORBIDDEN", message: "Permission denied" });
        try {
          if (mutating.has(req.method)) assertMutation(req);
        } catch (e) {
          sendError(res, e);
          return;
        }
        next();
      })
      .catch(next);
  };
}
export function requireStepUp(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const a = (req as AdminRequest).admin;
  if (!a)
    return void res
      .status(401)
      .json({ error: "AUTH_REQUIRED", message: "Authentication required" });
  void rows<{ step_up_at: string | null }>(
    "SELECT step_up_at FROM wc_sessions WHERE id=? AND revoked_at IS NULL LIMIT 1",
    [a.sessionId]
  )
    .then((r: Array<{ step_up_at: string | null }>) => {
      if (
        !r[0]?.step_up_at ||
        Date.now() - dateMs(r[0].step_up_at) > STEP_UP_MS
      )
        return void res.status(401).json({
          error: "STEP_UP_REQUIRED",
          message: "Recent password or MFA verification required",
        });
      next();
    })
    .catch(next);
}
export async function audit(
  actorId: string | null,
  action: string,
  targetId?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  await exec(
    "INSERT INTO wc_audit (id,actor_id,action,target_id,metadata_json) VALUES (?,?,?,?,?)",
    [
      randomUUID(),
      actorId,
      action.slice(0, 120),
      targetId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}
async function makeSession(
  accountId: string,
  req: Request,
  connection?: PoolConnection
): Promise<{ token: string; csrf: string; id: string }> {
  const token = randomToken(),
    csrf = randomToken(),
    id = randomUUID();
  const sql =
    "INSERT INTO wc_sessions (id,account_id,token_digest,csrf_token,user_agent,ip_address,expires_at) VALUES (?,?,?,?,?,?,?)";
  const p = [
    id,
    accountId,
    digest(token),
    csrf,
    (req.get("user-agent") || "").slice(0, 512) || null,
    clientIp(req),
    new Date(Date.now() + ABSOLUTE_MS),
  ];
  if (connection) await connection.execute(sql, p);
  else await exec(sql, p);
  return { token, csrf, id };
}
async function accountByEmail(email: string): Promise<AccountRow | undefined> {
  return (
    await rows<AccountRow>(
      "SELECT id,email,name,role,password_hash,active,mfa_enabled,mfa_secret_envelope,mfa_pending_envelope,mfa_pending_expires FROM wc_accounts WHERE email=? LIMIT 1",
      [email]
    )
  )[0];
}
async function consumeTotp(
  id: string,
  secret: string,
  code: string
): Promise<boolean> {
  const step = totpMatchingStep(secret, code);
  if (step === null) return false;
  return (
    (
      await exec(
        "UPDATE wc_accounts SET mfa_last_step=? WHERE id=? AND (mfa_last_step IS NULL OR mfa_last_step<?)",
        [step, id, step]
      )
    ).affectedRows === 1
  );
}
function limitKey(kind: string, value: string): string {
  return digest(`${kind}:${value}`);
}
async function limitStatus(kind: string, value: string): Promise<boolean> {
  const r = (
    await rows<{ blocked_until: string | null }>(
      "SELECT blocked_until FROM wc_auth_limits WHERE key_type=? AND key_value=? LIMIT 1",
      [kind, limitKey(kind, value)]
    )
  )[0];
  return !!r?.blocked_until && dateMs(r.blocked_until) > Date.now();
}
async function recordFailure(kind: string, value: string): Promise<void> {
  const key = limitKey(kind, value),
    threshold = kind.includes("ip") ? 20 : 5;
  await transaction(async (c: PoolConnection) => {
    await c.execute(
      "INSERT IGNORE INTO wc_auth_limits (key_type,key_value,failures,window_started_at,blocked_until) VALUES (?,?,0,NOW(6),NULL)",
      [kind, key]
    );
    const [rs] = await c.execute(
      "SELECT failures,window_started_at FROM wc_auth_limits WHERE key_type=? AND key_value=? FOR UPDATE",
      [kind, key]
    );
    const r = (rs as Array<{ failures: number; window_started_at: string }>)[0];
    const fresh = Date.now() - dateMs(r.window_started_at) >= LOGIN_WINDOW_MS;
    const failures = fresh ? 1 : Number(r.failures) + 1;
    const blocked =
      failures >= threshold
        ? new Date(
            Date.now() +
              Math.min(
                60 * 60 * 1000,
                Math.pow(2, Math.max(0, failures - 5)) * 1000
              )
          )
        : null;
    await c.execute(
      "UPDATE wc_auth_limits SET failures=?,window_started_at=?,blocked_until=? WHERE key_type=? AND key_value=?",
      [failures, fresh ? new Date() : r.window_started_at, blocked, kind, key]
    );
  });
}
async function clearFailures(email: string, ip: string): Promise<void> {
  await exec(
    "DELETE FROM wc_auth_limits WHERE (key_type=? AND key_value=?) OR (key_type=? AND key_value=?) OR (key_type=? AND key_value=?) OR (key_type=? AND key_value=?)",
    [
      "email",
      limitKey("email", email),
      "ip",
      limitKey("ip", ip),
      "recovery_email",
      limitKey("recovery_email", email),
      "recovery_ip",
      limitKey("recovery_ip", ip),
    ]
  );
}
function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomToken().slice(0, 16).toUpperCase()
  );
}
async function storeRecovery(
  id: string,
  codes: string[],
  c?: PoolConnection
): Promise<void> {
  for (const code of codes) {
    const sql =
      "INSERT INTO wc_recovery (id,account_id,code_hash) VALUES (?,?,?)";
    if (c) await c.execute(sql, [randomUUID(), id, digest(code)]);
    else await exec(sql, [randomUUID(), id, digest(code)]);
  }
}
async function consumeRecovery(
  id: string,
  code: string,
  c?: PoolConnection
): Promise<boolean> {
  const list = c
    ? ((
        await c.execute(
          "SELECT id,code_hash FROM wc_recovery WHERE account_id=? AND used_at IS NULL FOR UPDATE",
          [id]
        )
      )[0] as Array<{ id: string; code_hash: string }>)
    : await rows<{ id: string; code_hash: string }>(
        "SELECT id,code_hash FROM wc_recovery WHERE account_id=? AND used_at IS NULL",
        [id]
      );
  const found = list.find(
    (x: { id: string; code_hash: string }) => digest(code) === x.code_hash
  );
  if (!found) return false;
  const result = c
    ? await c.execute(
        "UPDATE wc_recovery SET used_at=NOW(6) WHERE id=? AND used_at IS NULL",
        [found.id]
      )
    : [
        await exec(
          "UPDATE wc_recovery SET used_at=NOW(6) WHERE id=? AND used_at IS NULL",
          [found.id]
        ),
      ];
  return (
    Number(((result as any)[0] as { affectedRows?: number }).affectedRows) === 1
  );
}
async function revokeAccountSessions(
  id: string,
  except?: string
): Promise<void> {
  await exec(
    except
      ? "UPDATE wc_sessions SET revoked_at=NOW(6) WHERE account_id=? AND id<>? AND revoked_at IS NULL"
      : "UPDATE wc_sessions SET revoked_at=NOW(6) WHERE account_id=? AND revoked_at IS NULL",
    except ? [id, except] : [id]
  );
}

export function registerAuthRoutes(app: Express): void {
  app.get(
    "/api/auth/setup/status",
    route(async (_req, res) => {
      const r = await rows<{ count: number }>(
        "SELECT COUNT(*) AS count FROM wc_accounts"
      );
      res
        .set("Cache-Control", "no-store")
        .json({ available: Number(r[0]?.count || 0) === 0 });
    })
  );
  app.post(
    "/api/auth/setup",
    route(async (req, res) => {
      assertOrigin(req);
      const i = body(req),
        secret = text(i.secret, "secret", 32, 512),
        email = normalizeEmail(i.email),
        name = text(i.name, "name", 1, 160).trim(),
        password = requirePasswordPolicy(i.password),
        cfg = config();
      let result;
      try {
        result = await transaction(async (c: PoolConnection) => {
          const lock = (
            await c.execute("SELECT GET_LOCK(?,10) AS acquired", [
              "win11desk:bootstrap",
            ])
          )[0] as Array<{ acquired: number }>;
          if (!lock[0]?.acquired)
            throw httpError(503, "SETUP_BUSY", "Setup is busy; try again");
          try {
            const [existing] = await c.execute(
              "SELECT id FROM wc_accounts LIMIT 1 FOR UPDATE"
            );
            if ((existing as unknown[]).length)
              throw httpError(
                409,
                "SETUP_CLOSED",
                "Owner setup is already complete"
              );
            if (digest(secret) !== digest(cfg.bootstrapSecret))
              throw httpError(
                401,
                "SETUP_REJECTED",
                "Bootstrap secret is invalid"
              );
            const id = randomUUID(),
              codes = newRecoveryCodes();
            await c.execute(
              "INSERT INTO wc_accounts (id,email,name,password_hash,role,bootstrap_digest) VALUES (?,?,?,?,?,?)",
              [
                id,
                email,
                name,
                await boundedHash(password),
                "owner",
                digest(cfg.bootstrapSecret),
              ]
            );
            await storeRecovery(id, codes, c);
            const session = await makeSession(id, req, c);
            return { id, email, name, role: "owner" as const, session, codes };
          } finally {
            await c.execute("SELECT RELEASE_LOCK(?)", ["win11desk:bootstrap"]);
          }
        });
      } catch (e) {
        if ((e as { code?: string }).code === "ER_DUP_ENTRY")
          throw httpError(
            409,
            "SETUP_CLOSED",
            "Owner setup is already complete"
          );
        throw e;
      }
      issueCookie(res, result.session.token);
      res
        .set("Cache-Control", "no-store")
        .status(201)
        .json({
          user: {
            id: result.id,
            email: result.email,
            name: result.name,
            role: result.role,
          },
          csrf: result.session.csrf,
          recoveryCodes: result.codes,
        });
    })
  );
  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      assertOrigin(req);
      const i = body(req),
        email = normalizeEmail(i.email),
        password = text(i.password, "password", 1, 128),
        code = typeof i.code === "string" ? i.code : undefined,
        ip = clientIp(req);
      if ((await limitStatus("email", email)) || (await limitStatus("ip", ip)))
        throw httpError(429, "LOGIN_THROTTLED", "Try again later");
      const account = await accountByEmail(email);
      const valid = account
        ? await boundedVerify(account.password_hash, password)
        : await boundedHash(password).then(() => false);
      if (!account || !account.active || !valid) {
        await recordFailure("email", email);
        await recordFailure("ip", ip);
        throw httpError(401, "LOGIN_FAILED", "Email or password is incorrect");
      }
      if (account.mfa_enabled) {
        let ok = false;
        if (code && account.mfa_secret_envelope)
          try {
            ok = await consumeTotp(
              account.id,
              decrypt(account.mfa_secret_envelope, `mfa:${account.id}`),
              code
            );
          } catch {}
        if (!ok && code) ok = await consumeRecovery(account.id, code);
        if (!ok) {
          await recordFailure("email", email);
          await recordFailure("ip", ip);
          throw httpError(
            401,
            code ? "MFA_FAILED" : "MFA_REQUIRED",
            code
              ? "Authenticator code is invalid"
              : "Authenticator code is required"
          );
        }
      }
      await clearFailures(email, ip);
      const session = await makeSession(account.id, req);
      await exec("UPDATE wc_accounts SET last_login_at=NOW(6) WHERE id=?", [
        account.id,
      ]);
      await audit(account.id, "auth.login", account.id);
      issueCookie(res, session.token);
      res.set("Cache-Control", "no-store").json({
        user: {
          id: account.id,
          email: account.email,
          name: account.name,
          role: account.role,
        },
        csrf: session.csrf,
      });
    })
  );
  app.get(
    "/api/auth/me",
    requireAuth,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!;
      res
        .set("Cache-Control", "no-store")
        .json({ user: safeUser(a), csrf: a.csrf });
    })
  );
  app.post(
    "/api/auth/logout",
    route(async (req, res) => {
      assertOrigin(req);
      const a = await loadAdmin(req);
      if (a) {
        (req as AdminRequest).admin = a;
        assertMutation(req);
        await exec("UPDATE wc_sessions SET revoked_at=NOW(6) WHERE id=?", [
          a.sessionId,
        ]);
        await audit(a.id, "auth.logout", a.id);
      }
      clearCookie(res);
      res.json({ success: true });
    })
  );
  app.post(
    "/api/auth/step-up",
    requireAuth,
    requirePermission("auth:password"),
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        i = body(req),
        password = text(i.password, "password", 1, 128),
        code = typeof i.code === "string" ? i.code : undefined,
        account = (
          await rows<AccountRow>(
            "SELECT id,email,name,role,password_hash,active,mfa_enabled,mfa_secret_envelope,mfa_pending_envelope,mfa_pending_expires FROM wc_accounts WHERE id=?",
            [a.id]
          )
        )[0];
      let valid =
        !!account && (await boundedVerify(account.password_hash, password));
      if (valid && account?.mfa_enabled) {
        try {
          valid =
            !!code &&
            !!account.mfa_secret_envelope &&
            (await consumeTotp(
              account.id,
              decrypt(account.mfa_secret_envelope, `mfa:${account.id}`),
              code
            ));
        } catch {
          valid = false;
        }
      }
      if (!valid)
        throw httpError(401, "STEP_UP_FAILED", "Recent verification failed");
      await exec("UPDATE wc_sessions SET step_up_at=NOW(6) WHERE id=?", [
        a.sessionId,
      ]);
      await audit(a.id, "auth.step_up", a.id);
      res.json({ success: true, validForSeconds: STEP_UP_MS / 1000 });
    })
  );
  app.post(
    "/api/auth/account/password",
    requireAuth,
    requirePermission("auth:password"),
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        i = body(req),
        current = text(i.currentPassword, "currentPassword", 1, 128),
        next = requirePasswordPolicy(i.password),
        account = (
          await rows<AccountRow>(
            "SELECT id,email,name,role,password_hash,active,mfa_enabled,mfa_secret_envelope,mfa_pending_envelope,mfa_pending_expires FROM wc_accounts WHERE id=?",
            [a.id]
          )
        )[0];
      if (!account || !(await boundedVerify(account.password_hash, current)))
        throw httpError(
          401,
          "PASSWORD_REJECTED",
          "Current password is incorrect"
        );
      await exec(
        "UPDATE wc_accounts SET password_hash=?,updated_at=NOW(6) WHERE id=?",
        [await boundedHash(next), a.id]
      );
      await revokeAccountSessions(a.id, a.sessionId);
      await audit(a.id, "auth.password_changed", a.id);
      res.json({ success: true });
    })
  );
  app.get(
    "/api/auth/account/sessions",
    requireAuth,
    requirePermission("auth:password"),
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!;
      const ss = await rows<any>(
        "SELECT id,user_agent,ip_address,created_at,last_seen_at,expires_at,revoked_at FROM wc_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6) AND last_seen_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 MINUTE) ORDER BY created_at DESC",
        [a.id]
      );
      res.set("Cache-Control", "no-store").json({
        sessions: ss.map((s: any) => ({
          ...s,
          current: s.id === a.sessionId,
        })),
      });
    })
  );
  app.post(
    "/api/auth/account/sessions/clear-others",
    requireAuth,
    requirePermission("auth:password"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!;
      if (body(req).confirm !== true)
        throw httpError(
          400,
          "CONFIRM_REQUIRED",
          "Confirm clearing your other login sessions"
        );
      const count = await transaction(async tx => {
        const [result]: any = await tx.execute(
          "DELETE FROM wc_sessions WHERE account_id=? AND id<>?",
          [a.id, a.sessionId]
        );
        await tx.execute(
          "INSERT INTO wc_audit(id,actor_id,action,target_id,metadata_json) VALUES(?,?,?,?,?)",
          [
            randomUUID(),
            a.id,
            "auth.other_sessions_cleared",
            a.id,
            JSON.stringify({ count: result.affectedRows }),
          ]
        );
        return result.affectedRows;
      });
      res
        .set("Cache-Control", "no-store")
        .json({ success: true, cleared: count, currentSessionPreserved: true });
    })
  );
  app.delete(
    "/api/auth/account/sessions/:id",
    requireAuth,
    requirePermission("auth:password"),
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        id = text(req.params.id, "id", 1, 64);
      await exec(
        "UPDATE wc_sessions SET revoked_at=NOW(6) WHERE id=? AND account_id=?",
        [id, a.id]
      );
      await audit(a.id, "auth.session_revoked", id);
      res.json({ success: true });
    })
  );
  app.post(
    "/api/auth/account/mfa/enroll",
    requireAuth,
    requirePermission("auth:mfa"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        secret = generateTotpSecret();
      await exec(
        "UPDATE wc_accounts SET mfa_pending_envelope=?,mfa_pending_expires=DATE_ADD(NOW(6),INTERVAL 10 MINUTE) WHERE id=? AND active=1",
        [encrypt(secret, `mfa:${a.id}`), a.id]
      );
      await audit(a.id, "auth.mfa_enroll_started", a.id);
      res
        .set("Cache-Control", "no-store")
        .json({ secret, uri: totpUri(secret, a.email) });
    })
  );
  app.post(
    "/api/auth/account/mfa/confirm",
    requireAuth,
    requirePermission("auth:mfa"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        code = text(body(req).code, "code", 6, 6),
        account = (
          await rows<AccountRow>(
            "SELECT id,email,name,role,password_hash,active,mfa_enabled,mfa_secret_envelope,mfa_pending_envelope,mfa_pending_expires FROM wc_accounts WHERE id=?",
            [a.id]
          )
        )[0];
      if (
        !account?.mfa_pending_envelope ||
        !account.mfa_pending_expires ||
        dateMs(account.mfa_pending_expires) < Date.now()
      )
        throw httpError(
          400,
          "MFA_ENROLLMENT_EXPIRED",
          "Start MFA enrollment again"
        );
      const secret = decrypt(account.mfa_pending_envelope, `mfa:${a.id}`);
      if (!(await consumeTotp(a.id, secret, code)))
        throw httpError(
          401,
          "MFA_CODE_INVALID",
          "Authenticator code is invalid"
        );
      const codes = newRecoveryCodes();
      await transaction(async (c: PoolConnection) => {
        await c.execute(
          "UPDATE wc_accounts SET mfa_enabled=1,mfa_secret_envelope=?,mfa_pending_envelope=NULL,mfa_pending_expires=NULL WHERE id=?",
          [encrypt(secret, `mfa:${a.id}`), a.id]
        );
        await c.execute(
          "DELETE FROM wc_recovery WHERE account_id=? AND used_at IS NULL",
          [a.id]
        );
        await storeRecovery(a.id, codes, c);
      });
      await audit(a.id, "auth.mfa_enabled", a.id);
      res
        .set("Cache-Control", "no-store")
        .json({ enabled: true, recoveryCodes: codes });
    })
  );
  app.post(
    "/api/auth/account/mfa/disable",
    requireAuth,
    requirePermission("auth:mfa"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!;
      await exec(
        "UPDATE wc_accounts SET mfa_enabled=0,mfa_secret_envelope=NULL,mfa_pending_envelope=NULL,mfa_pending_expires=NULL WHERE id=?",
        [a.id]
      );
      await exec("DELETE FROM wc_recovery WHERE account_id=?", [a.id]);
      await revokeAccountSessions(a.id, a.sessionId);
      await audit(a.id, "auth.mfa_disabled", a.id);
      res.json({ enabled: false });
    })
  );
  app.post(
    "/api/auth/account/recovery",
    requireAuth,
    requirePermission("auth:recovery"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        codes = newRecoveryCodes();
      await transaction(async (c: PoolConnection) => {
        await c.execute("DELETE FROM wc_recovery WHERE account_id=?", [a.id]);
        await storeRecovery(a.id, codes, c);
      });
      await audit(a.id, "auth.recovery_codes_regenerated", a.id);
      res.set("Cache-Control", "no-store").json({ recoveryCodes: codes });
    })
  );
  app.post(
    "/api/auth/recovery",
    route(async (req, res) => {
      assertOrigin(req);
      const i = body(req),
        email = normalizeEmail(i.email),
        code = text(i.code, "code", 6, 128),
        password = requirePasswordPolicy(i.password),
        ip = clientIp(req);
      if (
        (await limitStatus("recovery_email", email)) ||
        (await limitStatus("recovery_ip", ip))
      )
        throw httpError(429, "RECOVERY_THROTTLED", "Try again later");
      const account = await accountByEmail(email);
      let ok = false;
      if (account?.active) ok = await consumeRecovery(account.id, code);
      if (!ok) {
        await recordFailure("recovery_email", email);
        await recordFailure("recovery_ip", ip);
        throw httpError(
          401,
          "RECOVERY_FAILED",
          "Recovery request could not be completed"
        );
      }
      await exec(
        "UPDATE wc_accounts SET password_hash=?,mfa_enabled=0,mfa_secret_envelope=NULL,updated_at=NOW(6) WHERE id=?",
        [await boundedHash(password), account!.id]
      );
      await revokeAccountSessions(account!.id);
      await clearFailures(email, ip);
      await audit(account!.id, "auth.recovery_used", account!.id);
      res.json({ success: true });
    })
  );
  app.get(
    "/api/auth/users",
    requireAuth,
    requirePermission("users:read"),
    route(async (_req, res) => {
      const us = await rows<any>(
        "SELECT id,email,name,role,active,mfa_enabled,created_at,last_login_at FROM wc_accounts ORDER BY created_at ASC"
      );
      res.json({
        users: us.map((u: any) => ({
          ...u,
          active: !!u.active,
          mfaEnabled: !!u.mfa_enabled,
        })),
      });
    })
  );
  app.post(
    "/api/auth/users/invite",
    requireAuth,
    requirePermission("users:manage"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!;
      const i = body(req),
        email = normalizeEmail(i.email),
        role = i.role;
      if (role !== "admin" && role !== "operator" && role !== "viewer")
        throw httpError(400, "INVALID_ROLE", "Invalid invitation role");
      if (role === "admin" && a.role !== "owner")
        throw httpError(
          403,
          "OWNER_REQUIRED",
          "Only the owner may grant admin role"
        );
      const token = randomToken();
      await exec(
        "INSERT INTO wc_invites (id,email,role,token_hash,invited_by,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(6),INTERVAL 72 HOUR))",
        [randomUUID(), email, role, digest(token), a.id]
      );
      await audit(a.id, "auth.invite_created", null, { email, role });
      res
        .set("Cache-Control", "no-store")
        .status(201)
        .json({ email, role, token, expiresInHours: 72 });
    })
  );
  app.post(
    "/api/auth/invites/accept",
    route(async (req, res) => {
      assertOrigin(req);
      const i = body(req),
        token = text(i.token, "token", 64, 64),
        name = text(i.name, "name", 1, 160).trim(),
        password = requirePasswordPolicy(i.password),
        result = await transaction(async (c: PoolConnection) => {
          const [found] = await c.execute(
            "SELECT id,email,role,expires_at,accepted_at FROM wc_invites WHERE token_hash=? FOR UPDATE",
            [digest(token)]
          );
          const inv = (found as Array<any>)[0];
          if (!inv || inv.accepted_at || dateMs(inv.expires_at) < Date.now())
            throw httpError(
              400,
              "INVITE_INVALID",
              "Invitation is invalid or expired"
            );
          const id = randomUUID();
          await c.execute(
            "INSERT INTO wc_accounts (id,email,name,password_hash,role) VALUES (?,?,?,?,?)",
            [id, inv.email, name, await boundedHash(password), inv.role]
          );
          await c.execute(
            "UPDATE wc_invites SET accepted_at=NOW(6) WHERE id=?",
            [inv.id]
          );
          return {
            id,
            email: inv.email,
            role: inv.role,
            session: await makeSession(id, req, c),
          };
        });
      issueCookie(res, result.session.token);
      res.status(201).json({
        user: { id: result.id, email: result.email, name, role: result.role },
        csrf: result.session.csrf,
      });
    })
  );
  app.patch(
    "/api/auth/users/:id",
    requireAuth,
    requirePermission("users:manage"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        id = text(req.params.id, "id", 1, 64),
        i = body(req),
        role = i.role,
        active = i.active;
      if (id === a.id && active === false)
        throw httpError(
          400,
          "LAST_OWNER_PROTECTED",
          "You cannot disable your current account"
        );
      if (
        role !== undefined &&
        !(["owner", "admin", "operator", "viewer"] as unknown[]).includes(role)
      )
        throw httpError(400, "INVALID_ROLE", "Invalid role");
      if ((role === "owner" || role === "admin") && a.role !== "owner")
        throw httpError(
          403,
          "OWNER_REQUIRED",
          "Only the owner may grant owner or admin roles"
        );
      let target;
      try {
        await transaction(async (c: PoolConnection) => {
          const [rs] = await c.execute(
            "SELECT role,active FROM wc_accounts WHERE id=? FOR UPDATE",
            [id]
          );
          target = (rs as Array<{ role: AdminRole; active: number }>)[0];
          if (!target) throw httpError(404, "USER_NOT_FOUND", "User not found");
          if (target.role === "owner" && a.role !== "owner")
            throw httpError(
              403,
              "OWNER_REQUIRED",
              "Only the owner may alter an owner"
            );
          const nextRole = (role ?? target.role) as AdminRole,
            nextActive =
              typeof active === "boolean" ? (active ? 1 : 0) : target.active;
          if (
            target.role === "owner" &&
            target.active === 1 &&
            (nextRole !== "owner" || nextActive === 0)
          ) {
            const [owners] = await c.execute(
              "SELECT id FROM wc_accounts WHERE role='owner' AND active=1 FOR UPDATE"
            );
            if ((owners as unknown[]).length <= 1)
              throw httpError(
                400,
                "LAST_OWNER_PROTECTED",
                "The last owner cannot be removed or disabled"
              );
          }
          await c.execute(
            "UPDATE wc_accounts SET role=?,active=?,updated_at=NOW(6) WHERE id=?",
            [nextRole, nextActive, id]
          );
        });
      } catch (e) {
        throw e;
      }
      if (role !== undefined || active === false)
        await revokeAccountSessions(id);
      await audit(a.id, "auth.user_updated", id, { role, active });
      res.json({ success: true });
    })
  );
  app.post(
    "/api/auth/users/:id/revoke",
    requireAuth,
    requirePermission("users:manage"),
    requireStepUp,
    route(async (req, res) => {
      const a = (req as AdminRequest).admin!,
        id = text(req.params.id, "id", 1, 64);
      if (id === a.id)
        throw httpError(
          400,
          "INVALID_REQUEST",
          "Use logout for your current session"
        );
      await revokeAccountSessions(id);
      await audit(a.id, "auth.user_sessions_revoked", id);
      res.json({ success: true });
    })
  );
}
