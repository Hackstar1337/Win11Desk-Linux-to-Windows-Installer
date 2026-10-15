import {
  postInstallOptionsSchema,
  hasPostInstall,
  postInstallView,
  type PostInstallOptions,
  scriptCompatible,
} from "../../shared/postInstall";
import {
  remoteSettingsSchema,
  type RemoteSettings,
  type TargetInventory,
} from "../../shared/remoteInstall";
import { buildPostInstallPayload } from "./postInstallAssets";
import {
  WINDOWS_PASSWORD_MIN_LENGTH,
  WINDOWS_PASSWORD_MAX_LENGTH,
  windowsPasswordIssue,
} from "../../shared/windowsPassword";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import type { Express, NextFunction, Request, Response } from "express";
import {
  defaults as deploymentDefaults,
  deploymentSchema,
  type DeploymentConfig,
} from "../../shared/deployment";
import {
  automaticTarget,
  defaultIsoSha256,
  defaultIsoUrl,
} from "../../shared/media";
import {
  linuxInstaller,
  installerVersion,
  installTargetSchema,
} from "../../shared/installer";
import { createTrackingGroup, getTrackingGroup } from "../installTracking";
import { config } from "./config";
import { exec, rows, transaction } from "./db";
import { requireAuth, requirePermission, requireStepUp, audit } from "./auth";

import {
  getOs,
  readyProfile,
  type ProfileSnapshot,
} from "../../shared/deploymentProfiles";
import { resolveProfile, ProfileError } from "./profiles";

import {
  buildCompactDeliveryCommand,
  LAUNCHER_VERSION,
  LAUNCHER_SHA256,
} from "./launcher";
import {
  buildPrivateSetupCommand,
  SETUP_V2_VERSION,
  SETUP_V2_SHA256,
} from "./launcherV2";
import {
  buildCleanSetupCommand,
  SETUP_V3_VERSION,
  SETUP_V3_SHA256,
} from "./launcherV3";
const WORKSPACE = "default";
const DELIVERY_MINUTES = 30;
const STALE_MS = 3 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const PASSWORD_RE = /^[\x20-\x7e]{12,128}$/;
const SAFE_TAG = /^[^\x00-\x1f\x7f]{1,48}$/;
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
type Enc = { ciphertext: string; iv: string; tag: string };
type Admin = {
  id: string | number;
  email: string;
  name: string;
  role: string;
  sessionId?: string;
};
type SqlConn = {
  query?: (sql: string, params?: unknown[]) => Promise<any>;
  execute?: (sql: string, params?: unknown[]) => Promise<any>;
};

function now() {
  return new Date();
}
function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function json(value: unknown, fallback: unknown = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function token() {
  return randomBytes(32).toString("hex");
}
function aad(value: string) {
  return Buffer.from(`win11desk-control:v4:${value}`, "utf8");
}
function seal(value: string, associatedData: string): Enc {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config().vaultKey, iv);
  cipher.setAAD(aad(associatedData));
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
function open(value: Enc, associatedData: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    config().vaultKey,
    Buffer.from(value.iv, "hex")
  );
  decipher.setAAD(aad(associatedData));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
function sameDigest(stored: unknown, presented: string) {
  if (
    typeof stored !== "string" ||
    !HEX64_RE.test(stored) ||
    !HEX64_RE.test(presented)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(stored, "hex"),
    Buffer.from(digest(presented), "hex")
  );
}
function asId(value: unknown) {
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new InputError("Invalid id");
  return value;
}
function asString(value: unknown, name: string, min = 0, max = 500) {
  if (typeof value !== "string" || value.length < min || value.length > max)
    throw new InputError(`Invalid ${name}`);
  return value;
}
function asInt(value: unknown, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw new InputError(`Invalid ${name}`);
  return Number(value);
}
function strictObject(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("JSON object required");
  const unknown = Object.keys(value as object).filter(
    k => !allowed.includes(k)
  );
  if (unknown.length) throw new InputError(`Unsupported field: ${unknown[0]}`);
  return value as Record<string, unknown>;
}
function tags(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30)
    throw new InputError("Invalid tags");
  return value
    .map(v => asString(v, "tag", 1, 48))
    .filter(v => SAFE_TAG.test(v));
}
function validateOrigin(req: Request) {
  const origin = req.get("Origin");
  if (!origin) return;
  if (origin !== config().publicUrl && origin !== process.env.PREVIEW_ORIGIN)
    throw new InputError("Untrusted origin");
}
function actor(req: Request): Admin {
  const a = (req as Request & { admin?: Admin }).admin;
  if (!a) throw new Error("Authentication required");
  return a;
}
async function recordAudit(
  req: Request,
  action: string,
  metadata: Record<string, unknown>
) {
  await audit(String(actor(req).id), action, null, metadata);
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ProfileError)
    return res.status(error.status).json({ error: error.message });
  if (error instanceof InputError)
    return res.status(400).json({ error: error.message });
  if (error instanceof StepUpError)
    return res
      .status(403)
      .json({ error: error.message, code: "STEP_UP_REQUIRED" });
  console.error(
    "Administrative operation failed",
    (error as { code?: string }).code || "INTERNAL"
  );
  return res.status(500).json({ error: "Administrative operation failed." });
}
class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
class StepUpError extends Error {}

export const defaultSettings = {
  username: "Administrator",
  remotePort: 22,
  retries: 10,
  isoUrl: defaultIsoUrl,
} as const;
export const allowedPermissions = [
  "workspace:read",
  "commands:read",
  "commands:write",
  "deployments:read",
  "deployments:write",
  "credentials:reveal",
  "settings:read",
  "settings:write",
  "activity:read",
] as const;
export type AdminPermission = (typeof allowedPermissions)[number];
export function commandStatus(
  row: {
    stage?: string;
    finishedAt?: unknown;
    lastHeartbeatAt?: unknown;
    trashedAt?: unknown;
  },
  at = Date.now()
) {
  if (row.trashedAt) return "trashed";
  if (row.stage === "failed") return "failed";
  if (row.stage === "windows_ready") return "completed";
  if (
    row.lastHeartbeatAt &&
    at - new Date(String(row.lastHeartbeatAt)).getTime() > STALE_MS
  )
    return "stale";
  return "installing";
}
export function maskPassword(password: string) {
  return "********";
}
export function safeCsvField(value: unknown) {
  const s = String(value ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
export function toCsv(rowsToExport: Record<string, unknown>[]) {
  const keys = [
    "id",
    "commandId",
    "label",
    "profileName",
    "os",
    "profileRevision",
    "username",
    "publicIP",
    "hostname",
    "wholeDisk",
    "rdpPort",
    "stage",
    "createdAt",
    "startedAt",
    "stageAt",
    "lastHeartbeatAt",
    "finishedAt",
    "phase",
    "downloadedBytes",
    "totalBytes",
    "windowsEdition",
    "windowsBuild",
    "rdpListening",
    "credentialAvailable",
    "notes",
    "tags",
    "archivedAt",
    "trashedAt",
  ];
  const q = (v: unknown) => `"${safeCsvField(v).replaceAll('"', '""')}"`;
  return (
    [
      keys.join(","),
      ...rowsToExport.map(r => keys.map(k => q(r[k])).join(",")),
    ].join("\n") + "\n"
  );
}
export function buildDeliveryCommand(
  publicUrl: string,
  id: string,
  capability: string,
  scriptHash: string
) {
  if (
    !/^https:\/\//.test(publicUrl) &&
    !/^http:\/\/localhost(?::\d+)?$/.test(publicUrl)
  )
    throw new InputError("Delivery origin must be HTTPS");
  return `#!/bin/bash
# PRIVATE: one expiring issued command. Pasting erases the detected VPS disk automatically.
(
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run sudo -i on the intended VPS first.' >&2; exit 1; }
umask 077
work=$(mktemp -d /root/win11desk-command.XXXXXX)
trap 'rm -rf "$work"' EXIT
t="$work/setup.sh"
payload='{"id":"${id}","token":"${capability}"}'
downloaded=0
for n in 1 2 3; do
 if printf '%s' "$payload" | curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 -H 'Content-Type: application/json' --data-binary @- '${publicUrl}/api/installer/delivery' -o "$t"; then downloaded=1; break; fi
 [ "$n" = 3 ] || sleep 2
done
unset payload
[[ "$downloaded" = 1 && -s "$t" ]] || { echo 'Delivery expired/revoked/unavailable. Generate a new command.' >&2; exit 1; }
printf '%s  %s\\n' '${scriptHash}' "$t" | sha256sum --check --status || { echo 'Installer integrity mismatch.' >&2; exit 1; }
bash "$t" --install
)
`;
}
export function validateCommandInput(body: unknown) {
  const root = strictObject(body, [
    "input",
    "idempotencyKey",
    "label",
    "provider",
    "tags",
    "username",
    "password",
    "remotePort",
    "retries",
    "isoUrl",
    "count",
    "uniquePasswords",
    "target",
    "profileId",
    "profileRevision",
    "postInstall",
  ]);
  const nested =
    root.input === undefined
      ? {}
      : strictObject(root.input, [
          "settings",
          "username",
          "password",
          "remotePort",
          "retries",
          "isoUrl",
          "target",
          "uniquePasswords",
        ]);
  const settings =
    nested.settings === undefined
      ? {}
      : strictObject(nested.settings, [
          "username",
          "password",
          "remotePort",
          "retries",
          "isoUrl",
          "target",
          "uniquePasswords",
        ]);
  const b = { ...settings, ...nested, ...root };
  const idempotencyKey = asString(b.idempotencyKey, "idempotencyKey", 16, 128);
  const label = b.label === undefined ? "" : asString(b.label, "label", 0, 160);
  const provider =
    b.provider === undefined ? null : asString(b.provider, "provider", 0, 160);
  const username =
    b.username === undefined
      ? defaultSettings.username
      : asString(b.username, "username", 1, 20);
  const password =
    b.password === undefined
      ? null
      : asString(
          b.password,
          "Windows password",
          WINDOWS_PASSWORD_MIN_LENGTH,
          WINDOWS_PASSWORD_MAX_LENGTH
        );
  if (password !== null && windowsPasswordIssue(password))
    throw new InputError(windowsPasswordIssue(password)!);
  const remotePort =
    b.remotePort === undefined
      ? 22
      : asInt(b.remotePort, "remotePort", 1, 65535);
  const retries =
    b.retries === undefined ? 10 : asInt(b.retries, "retries", 1, 20);
  const isoUrl =
    b.isoUrl === undefined
      ? defaultIsoUrl
      : asString(b.isoUrl, "isoUrl", 0, 4096);
  if (!isoUrl) throw new InputError("Configure an ISO source before issuing an installer command");
  const parsed = new URL(isoUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    /[\x00-\x20'"`$\\]/.test(isoUrl)
  )
    throw new InputError("ISO source must be a direct HTTPS URL");
  const count = b.count === undefined ? 1 : asInt(b.count, "count", 1, 20);
  if (count > 1 && !b.uniquePasswords)
    throw new InputError("Batch commands require uniquePasswords=true");
  if (b.uniquePasswords !== undefined && typeof b.uniquePasswords !== "boolean")
    throw new InputError("Invalid uniquePasswords");
  if (b.target !== undefined) {
    const t = strictObject(b.target, [
      "isoUrl",
      "isoSha256",
      "targetDisk",
      "expectedHostname",
      "logSshPort",
      "autoReboot",
      "backupReady",
      "recoveryReady",
      "unsupportedHardwareAccepted",
    ]);
    const expected = automaticTarget(isoUrl);
    for (const k of Object.keys(expected))
      if (t[k] !== undefined && t[k] !== (expected as any)[k])
        throw new InputError("Target is automatic and cannot be overridden");
    installTargetSchema.parse(expected);
  }
  return {
    idempotencyKey,
    label,
    provider,
    tags: tags(b.tags),
    username,
    password,
    remotePort,
    retries,
    isoUrl,
    count,
    uniquePasswords: Boolean(b.uniquePasswords),
    profileId: b.profileId === undefined ? null : asId(b.profileId),
    profileRevision:
      b.profileId === undefined
        ? null
        : asInt(b.profileRevision, "profileRevision", 1, 2147483647),
    profile: null as ProfileSnapshot | null,
    ...(b.postInstall === undefined
      ? {}
      : (() => {
          const parsed = postInstallOptionsSchema.safeParse(b.postInstall);
          if (!parsed.success)
            throw new InputError(parsed.error.issues[0].message);
          const p = parsed.data;
          return hasPostInstall(p) ? { postInstall: p } : {};
        })()),
  };
}
export function validateProfileCommandInput(body: unknown) {
  const b = strictObject(body, [
    "idempotencyKey",
    "label",
    "provider",
    "tags",
    "username",
    "password",
    "remotePort",
    "retries",
    "count",
    "uniquePasswords",
    "profileId",
    "profileRevision",
    "postInstall",
  ]);
  if (!b.profileId)
    throw new InputError("Choose a configured operating system profile.");
  const parsed = validateCommandInput(b);
  return parsed;
}
function compactFingerprint(input: ReturnType<typeof validateCommandInput>) {
  const { isoUrl, profile, ...runtime } = input;
  return createHash("sha256")
    .update(config().vaultKey)
    .update(json(runtime))
    .digest("hex");
}
function commandForRow(row: any, capability: string) {
  const cfg = parseJson(row.config_json, {} as any);
  if (cfg.launcher?.version === SETUP_V3_VERSION) {
    if (cfg.launcher.sha256 !== SETUP_V3_SHA256)
      throw new InputError("Original setup identity unavailable.");
    return buildCleanSetupCommand(
      config().publicUrl,
      capability,
      row.installer_digest
    );
  }
  if (cfg.launcher?.version === SETUP_V2_VERSION) {
    if (cfg.launcher.sha256 !== SETUP_V2_SHA256)
      throw new InputError("Original setup identity unavailable.");
    return buildPrivateSetupCommand(
      config().publicUrl,
      capability,
      row.installer_digest
    );
  }
  if (cfg.launcher?.version === LAUNCHER_VERSION) {
    if (cfg.launcher.sha256 !== LAUNCHER_SHA256 || !cfg.profile)
      throw new InputError("Original launcher identity unavailable.");
    return buildCompactDeliveryCommand(
      config().publicUrl,
      row.id,
      capability,
      row.installer_digest,
      cfg.profile.id,
      cfg.profile.revision
    );
  }
  if (cfg.launcher)
    throw new InputError("Original launcher version unavailable.");
  return buildDeliveryCommand(
    config().publicUrl,
    row.id,
    capability,
    row.installer_digest
  );
}
function makeConfig(
  input: ReturnType<typeof validateCommandInput>,
  password: string
): DeploymentConfig {
  return deploymentSchema.parse({
    ...deploymentDefaults,
    os: input.profile ? getOs(input.profile.osId).name : deploymentDefaults.os,
    username: input.username,
    password,
    remotePort: input.remotePort,
    retries: input.retries,
    initScript: true,
    isoUrl: input.isoUrl,
  });
}
function publicRun(row: any) {
  const stage = String(row.stage ?? "starting");
  const contactTimes = [
    row.lastHeartbeatAt ?? row.last_heartbeat_at,
    row.lastEventAt ?? row.last_event_at,
    row.createdAt ?? row.created_at,
  ]
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  const lastContact = contactTimes.length
    ? new Date(Math.max(...contactTimes))
    : null;
  return {
    id: row.runId ?? row.run_id ?? row.id,
    commandId: row.commandId ?? row.command_id ?? null,
    label: row.display_label ?? row.label ?? "",
    originalLabel: row.label ?? "",
    remoteJobId: row.remote_job_id ?? null,
    launchMethod: row.remote_job_id ? "ssh" : "manual",
    postInstall: row.post_install_plan
      ? postInstallView(
          parseJson<any>(row.post_install_plan, null),
          parseJson<any>(row.post_install_report, null),
          iso(row.post_install_at),
          row.run_id
        )
      : null,
    profile: parseJson<any>(row.profile_snapshot, null),
    profileName: parseJson<any>(row.profile_snapshot, null)?.name ?? null,
    profileRevision:
      parseJson<any>(row.profile_snapshot, null)?.revision ?? null,
    os: parseJson<any>(row.profile_snapshot, null)?.osId
      ? getOs(parseJson<any>(row.profile_snapshot, null).osId).name
      : "Windows 11 Pro",
    username: row.username ?? null,
    publicIP: row.publicIP ?? row.public_ip ?? null,
    hostname: row.hostname ?? null,
    wholeDisk: row.wholeDisk ?? row.whole_disk ?? null,
    rdpPort: row.rdpPort ?? row.rdp_port ?? null,
    stage,
    status: commandStatus({
      stage,
      lastHeartbeatAt: lastContact,
      trashedAt: row.trashedAt ?? row.trashed_at,
    }),
    stale:
      !["windows_ready", "failed"].includes(stage) &&
      (!lastContact || Date.now() - lastContact.getTime() > 180000),
    createdAt: iso(row.createdAt ?? row.created_at),
    startedAt: iso(row.startedAt ?? row.started_at),
    stageAt: iso(row.stageAt ?? row.stage_at),
    lastHeartbeatAt: iso(lastContact),
    finishedAt: iso(row.finishedAt ?? row.finished_at),
    phase: row.phase ?? null,
    downloadedBytes:
      row.downloadedBytes == null && row.downloaded_bytes == null
        ? null
        : Number(row.downloadedBytes ?? row.downloaded_bytes),
    totalBytes:
      row.totalBytes == null && row.total_bytes == null
        ? null
        : Number(row.totalBytes ?? row.total_bytes),
    windowsInstallationType: row.windowsInstallationType ?? null,
    windowsEdition: row.windowsEdition ?? row.windows_edition ?? null,
    windowsBuild:
      row.windowsBuild == null && row.windows_build == null
        ? null
        : Number(row.windowsBuild ?? row.windows_build),
    rdpListening:
      row.rdpListening == null && row.rdp_listening == null
        ? null
        : Boolean(row.rdpListening ?? row.rdp_listening),
    credentialAvailable: Boolean(
      row.credentialAvailable ?? row.credential_available
    ),
    notes: row.notes ?? null,
    tags: parseJson(row.tagsJson ?? row.tags_json, []),
    archivedAt: iso(row.archivedAt ?? row.archived_at),
    trashedAt: iso(row.trashedAt ?? row.trashed_at),
  };
}
async function connQuery<T = any>(
  conn: SqlConn,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const fn = conn.execute ?? conn.query;
  if (!fn) throw new Error("Database connection has no query method");
  const result = await fn.call(conn, sql, params);
  return Array.isArray(result) && Array.isArray(result[0])
    ? result[0]
    : Array.isArray(result)
      ? result
      : [];
}
async function connExec(conn: SqlConn, sql: string, params: unknown[] = []) {
  const fn = conn.execute ?? conn.query;
  if (!fn) throw new Error("Database connection has no query method");
  return fn.call(conn, sql, params);
}
function rowCommand(row: any, includeCommand = false) {
  const result: Record<string, unknown> = {
    id: row.id,
    profile: parseJson<any>(
      row.profile_snapshot ?? parseJson<any>(row.config_json, {}).profile,
      null
    ),
    postInstall: parseJson<any>(row.config_json, {}).postInstall
      ? postInstallView(parseJson<any>(row.config_json, {}).postInstall)
      : null,
    label: row.label,
    provider: row.provider,
    username: row.username,
    remotePort: Number(row.remotePort ?? row.remote_port),
    retries: Number(row.retries),
    isoUrl: row.isoUrl ?? row.iso_url,
    isoSha256: row.isoSha256 ?? row.iso_sha256,
    installerVersion: parseJson(
      row.installerVersion ?? row.installer_version,
      {}
    ),
    installerDigest: row.installerDigest ?? row.installer_digest,
    scriptHash: row.installerDigest ?? row.installer_digest,
    groupId: row.groupId ?? row.group_id,
    createdAt: iso(row.createdAt ?? row.created_at),
    expiresAt: iso(row.expiresAt ?? row.expires_at),
    revokedAt: iso(row.revokedAt ?? row.revoked_at),
    downloadCount: Number(row.downloadCount ?? row.download_count ?? 0),
    lastUsedAt: iso(row.lastUsedAt ?? row.last_used_at),
    tags: parseJson(row.tagsJson ?? row.tags_json, []),
    archivedAt: iso(row.archivedAt ?? row.archived_at),
    status:
      (row.revokedAt ?? row.revoked_at)
        ? "revoked"
        : new Date(String(row.expiresAt ?? row.expires_at)).getTime() <=
            Date.now()
          ? "expired"
          : "issued",
  };
  if (includeCommand) result.command = row.deliveryCommand;
  return result;
}
async function findCommand(id: string) {
  const found = await rows<any>(
    "SELECT * FROM wc_commands WHERE id=? AND workspace_id=? LIMIT 1",
    [id, WORKSPACE]
  );
  return found[0];
}
async function getRun(id: string) {
  const found = await rows<any>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(c.config_json,'$.remoteJobId')) AS remote_job_id,JSON_EXTRACT(c.config_json,'$.postInstall') AS post_install_plan,(SELECT pi.report_json FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_report,(SELECT pi.updated_at FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_at,(SELECT cp.snapshot_json FROM wc_command_profiles cp WHERE cp.command_id=c.id AND cp.workspace_id=c.workspace_id) AS profile_snapshot,(SELECT l.display_label FROM wc_run_labels l WHERE l.run_id=r.run_id AND l.workspace_id=r.workspace_id) AS display_label,(SELECT JSON_UNQUOTE(JSON_EXTRACT(e.proof_json,'$.windowsInstallationType')) FROM wc_events e WHERE e.run_id=r.run_id AND JSON_EXTRACT(e.proof_json,'$.windowsInstallationType') IS NOT NULL ORDER BY e.received_at DESC LIMIT 1) AS windowsInstallationType,r.*, r.run_id AS runId, r.command_id AS commandId, r.created_at AS createdAt, r.started_at AS startedAt, r.stage_at AS stageAt, r.last_heartbeat_at AS lastHeartbeatAt, r.finished_at AS finishedAt, r.credential_available AS credentialAvailable, r.tags_json AS tagsJson, r.trashed_at AS trashedAt, r.purged_at AS purgedAt, c.label,c.username,c.remote_port AS remotePort,c.credential_ciphertext,c.credential_iv,c.credential_tag,c.credential_key_id,c.credential_version,c.group_id AS commandGroupId,c.read_token_ciphertext AS readTokenCiphertext,c.read_token_iv AS readTokenIv,c.read_token_tag AS readTokenTag FROM wc_run_meta r JOIN wc_commands c ON c.id=r.command_id WHERE r.run_id=? AND r.workspace_id=? LIMIT 1`,
    [id, WORKSPACE]
  );
  return found[0];
}
function deliveryUrl(command: any, readToken?: string) {
  return readToken
    ? `${config().publicUrl}/track/${command.groupId}#${readToken}`
    : null;
}

async function issueOne(
  input: ReturnType<typeof validateCommandInput>,
  password: string,
  actorId: string | number,
  idempotencyKey: string,
  batchId: string | null,
  inputFingerprint: string,
  approvedTarget?: ReturnType<typeof automaticTarget>,
  remoteMetadata?: {
    jobId: string;
    approvalDigest: string;
    fingerprint: string;
  }
) {
  const id = randomUUID();
  if (
    input.postInstall?.runAttachedScript &&
    !scriptCompatible(input.profile!.osId)
  )
    throw new InputError(
      "Turn the attached script Off for Windows Server; its HWID mode requires a Windows10/11 client."
    );
  const postInstall = buildPostInstallPayload(
    input.postInstall,
    input.profile!.osId,
    config().publicUrl
  );
  return transaction(async tx => {
    const tracking = await createTrackingGroup(tx);
    if (remoteMetadata) {
      const job = await connQuery<any>(
        tx,
        "SELECT id FROM wc_remote_jobs WHERE id=? AND workspace_id=? AND owner_id=? AND state='sending' FOR UPDATE",
        [remoteMetadata.jobId, WORKSPACE, String(actorId)]
      );
      if (!job.length)
        throw new InputError(
          "Remote job was cleared or is no longer awaiting issuance."
        );
    }
    const created = now();
    const expiry = new Date(created.getTime() + DELIVERY_MINUTES * 60_000);
    const target = approvedTarget || automaticTarget(input.isoUrl);
    const cfg = makeConfig(input, password);
    const script = linuxInstaller(cfg, target, true, {
      postInstall,
      automatic: true,
      osId: input.profile?.osId,
      imageName: input.profile?.imageName || undefined,
      tracking: {
        origin: config().publicUrl,
        groupId: tracking.groupId,
        writeToken: tracking.writeToken,
      },
    });
    const scriptHash = digest(script);
    const deliveryCapability = token();
    const credential = seal(password, `credential:${id}:1`);
    const artifact = seal(script, `artifact:${id}:${scriptHash}`);
    const readToken = seal(tracking.readToken, `read-token:${id}`);
    const writeToken = seal(tracking.writeToken, `write-token:${id}`);
    await tx.execute(
      `INSERT INTO wc_commands (id,workspace_id,owner_id,idempotency_key,batch_id,label,provider,tags_json,username,remote_port,retries,iso_url,iso_sha256,target_json,config_json,installer_version,installer_digest,artifact_ciphertext,artifact_iv,artifact_tag,artifact_key_id,credential_ciphertext,credential_iv,credential_tag,credential_key_id,credential_version,delivery_hash,group_id,read_token_ciphertext,read_token_iv,read_token_tag,write_token_ciphertext,write_token_iv,write_token_tag,created_at,expires_at,created_by_batch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        WORKSPACE,
        String(actorId),
        idempotencyKey,
        batchId,
        input.label,
        input.provider,
        json(input.tags, []),
        input.username,
        input.remotePort,
        input.retries,
        input.isoUrl,
        input.isoUrl === defaultIsoUrl ? defaultIsoSha256 : "auto",
        json(target),
        json({
          username: input.username,
          remotePort: input.remotePort,
          retries: input.retries,
          isoUrl: input.isoUrl,
          profile: input.profile,
          ...(postInstall ? { postInstall: postInstall.plan } : {}),
          launcher: { version: SETUP_V3_VERSION, sha256: SETUP_V3_SHA256 },
          ...(remoteMetadata
            ? {
                remoteJobId: remoteMetadata.jobId,
                remoteApprovalDigest: remoteMetadata.approvalDigest,
              }
            : {}),
        }),
        json(installerVersion),
        scriptHash,
        artifact.ciphertext,
        artifact.iv,
        artifact.tag,
        "vault-v1",
        credential.ciphertext,
        credential.iv,
        credential.tag,
        "vault-v1",
        1,
        digest(deliveryCapability),
        tracking.groupId,
        readToken.ciphertext,
        readToken.iv,
        readToken.tag,
        writeToken.ciphertext,
        writeToken.iv,
        writeToken.tag,
        created,
        expiry,
        batchId ? 1 : 0,
      ]
    );
    await tx.execute(
      "INSERT INTO wc_delivery_secrets(command_id,input_digest,capability_envelope) VALUES(?,?,?)",
      [id, inputFingerprint, json(seal(deliveryCapability, "delivery:" + id))]
    );
    if (input.profile)
      await tx.execute(
        "INSERT INTO wc_command_profiles(command_id,workspace_id,profile_id,profile_revision,snapshot_json) VALUES(?,?,?,?,?)",
        [
          id,
          WORKSPACE,
          input.profile.id,
          input.profile.revision,
          json(input.profile),
        ]
      );
    const command = buildCleanSetupCommand(
      config().publicUrl,
      deliveryCapability,
      scriptHash
    );
    return {
      id,
      profile: input.profile ? readyProfile(input.profile) : null,
      ...(postInstall
        ? { postInstall: postInstallView(postInstall.plan) }
        : {}),
      command,
      scriptHash,
      expiresAt: expiry.toISOString(),
      groupId: tracking.groupId,
      readToken: tracking.readToken,
      password: password,
      deliveryCapability,
      createdAt: created.toISOString(),
    };
  });
}
/** Shared application service for approved remote jobs; never impersonates an HTTP session. */
export async function issueRemoteCommand(
  actorId: string,
  settings: RemoteSettings,
  expected: TargetInventory,
  jobId: string
) {
  const values = remoteSettingsSchema.parse(settings);
  if (!UUID_RE.test(jobId)) throw new InputError("Invalid remote job identity");
  const input = validateProfileCommandInput({
    ...values,
    idempotencyKey: "remote:" + jobId,
    count: 1,
    uniquePasswords: false,
  });
  const key = "remote:" + jobId;
  const lock = await import("./db").then(m => m.pool().getConnection());
  const lockName = "wc_remote_issue:" + jobId;
  let held = false,
    begun = false;
  try {
    const [taken]: any = await lock.query("SELECT GET_LOCK(?,15) ok", [
      lockName,
    ]);
    if (taken[0].ok !== 1) throw new InputError("Remote issuance busy");
    held = true;
    const existing = await rows<any>(
      "SELECT c.*,d.capability_envelope FROM wc_commands c JOIN wc_delivery_secrets d ON d.command_id=c.id WHERE c.workspace_id=? AND c.owner_id=? AND c.idempotency_key=?",
      [WORKSPACE, actorId, key]
    );
    const fingerprint = compactFingerprint(input);
    if (existing.length) {
      const row = existing[0],
        saved = parseJson(row.config_json, {} as any);
      if (
        saved.remoteJobId !== jobId ||
        saved.remoteApprovalDigest !==
          digest(json({ settings: values, expected }))
      )
        throw new InputError("Remote job settings changed");
      const cap = open(
        parseJson(row.capability_envelope, {} as Enc),
        "delivery:" + row.id
      );
      return {
        commandId: row.id,
        groupId: row.group_id,
        bootstrap: commandForRow(row, cap),
      };
    }
    await lock.beginTransaction();
    begun = true;
    input.profile = await resolveProfile(
      values.profileId,
      values.profileRevision,
      lock
    );
    input.isoUrl = input.profile.isoUrl;
    const target = installTargetSchema.parse({
      ...automaticTarget(input.isoUrl),
      expectedHostname: expected.hostname,
      targetDisk: expected.disk,
    });
    const item = await issueOne(
      input,
      values.password,
      actorId,
      key,
      null,
      fingerprint,
      target,
      {
        jobId,
        approvalDigest: digest(json({ settings: values, expected })),
        fingerprint,
      }
    );
    return {
      commandId: item.id,
      groupId: item.groupId,
      bootstrap: item.command,
    };
  } finally {
    if (begun) await lock.rollback();
    if (held) await lock.query("SELECT RELEASE_LOCK(?)", [lockName]);
    lock.release();
  }
}

export async function generateCommands(req: Request, body: unknown) {
  const raw = body as any;
  const key = asString(raw?.idempotencyKey, "idempotencyKey", 16, 128),
    a = actor(req),
    lock = await import("./db").then(m => m.pool().getConnection());
  const lockName = "wc_issue:" + digest(String(a.id)).slice(0, 30);
  let held = false,
    profileTransaction = false;
  try {
    const [taken]: any = await lock.query("SELECT GET_LOCK(?,15) ok", [
      lockName,
    ]);
    if (taken[0].ok !== 1) throw new InputError("Generation busy; retry");
    held = true;
    const existing = await rows<any>(
      "SELECT c.*,d.input_digest,d.capability_envelope FROM wc_commands c JOIN wc_delivery_secrets d ON d.command_id=c.id WHERE c.workspace_id=? AND c.owner_id=? AND (c.idempotency_key=? OR c.idempotency_key LIKE ?) ORDER BY c.created_at,c.idempotency_key",
      [WORKSPACE, String(a.id), key, key + ":%"]
    );
    if (existing.length) {
      const saved = parseJson(existing[0].config_json, {} as any);
      const modern = !!saved.launcher;
      const input = modern
        ? validateProfileCommandInput(body)
        : validateCommandInput(body);
      if (!modern && input.profileId) {
        input.profile = saved.profile;
        input.isoUrl = saved.profile?.isoUrl || input.isoUrl;
      }
      const { profileId, profileRevision, profile, ...legacy } = input;
      const fingerprint = modern
        ? compactFingerprint(input)
        : createHash("sha256")
            .update(config().vaultKey)
            .update(json(input.profileId ? input : legacy))
            .digest("hex");
      if (existing.some(r => r.input_digest !== fingerprint))
        throw new InputError(
          "Idempotency key already used for different settings"
        );
      if (existing.length !== input.count)
        throw new InputError(
          "Partial batch recorded; use a new key after reviewing commands"
        );
      const items = existing.map(r => {
        const cap = open(
          parseJson(r.capability_envelope, {} as Enc),
          "delivery:" + r.id
        );
        const read = open(
          {
            ciphertext: r.read_token_ciphertext,
            iv: r.read_token_iv,
            tag: r.read_token_tag,
          },
          "read-token:" + r.id
        );
        return {
          ...rowCommand(r),
          ...(modern ? { isoUrl: undefined, isoSha256: undefined } : {}),
          profile: saved.profile ? readyProfile(saved.profile) : null,
          command: commandForRow(r, cap),
          trackingUrl: deliveryUrl({ groupId: r.group_id }, read),
        };
      });
      return { commands: items, items, idempotent: true };
    }
    const input = validateProfileCommandInput(body);
    if (input.postInstall?.apps.includes("edge"))
      throw new InputError("Edge is no longer offered in Get files.");
    const fingerprint = compactFingerprint(input);
    await lock.beginTransaction();
    profileTransaction = true;
    input.profile = await resolveProfile(
      input.profileId!,
      input.profileRevision!,
      lock
    );
    input.isoUrl = input.profile.isoUrl;
    if (raw.username === undefined) input.username = input.profile.username;
    if (raw.remotePort === undefined)
      input.remotePort = input.profile.remotePort;
    if (raw.retries === undefined) input.retries = input.profile.retries;
    const batch = input.count > 1 ? randomUUID() : null,
      out: any[] = [];
    for (let i = 0; i < input.count; i++) {
      const secret =
        input.password && !input.uniquePasswords
          ? input.password
          : randomPassword();
      const item = await issueOne(
        input,
        secret,
        a.id,
        i ? key + ":" + i : key,
        batch,
        fingerprint
      );
      const {
        password: _password,
        deliveryCapability: _cap,
        readToken,
        ...result
      } = item;
      out.push({
        ...result,
        trackingUrl: deliveryUrl({ groupId: item.groupId }, readToken),
        trackerUrl: deliveryUrl({ groupId: item.groupId }, readToken),
      });
    }
    return { commands: out, items: out, sensitive: true };
  } finally {
    if (profileTransaction) await lock.rollback();
    if (held) await lock.query("SELECT RELEASE_LOCK(?)", [lockName]);
    lock.release();
  }
}

function randomPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-";
  const bytes = randomBytes(32);
  let result = "";
  for (const b of bytes) result += alphabet[b % alphabet.length];
  return result.slice(0, 24);
}

export async function delivery(req: Request, res: Response) {
  try {
    const b = strictObject(req.body, [
      "id",
      "token",
      "profileId",
      "profileRevision",
    ]);
    const id = asId(b.id);
    const capability = asString(b.token, "token", 64, 64).toLowerCase();
    if (!HEX64_RE.test(capability)) throw new InputError("Invalid capability");
    const found = await rows<any>(
      "SELECT * FROM wc_commands WHERE id=? LIMIT 1",
      [id]
    );
    const command = found[0];
    if (
      !command ||
      !sameDigest(command.delivery_hash, capability) ||
      command.revoked_at ||
      new Date(String(command.expires_at)).getTime() <= Date.now()
    )
      return res
        .status(404)
        .json({ error: "Delivery capability unavailable." });
    if (b.profileId !== undefined || b.profileRevision !== undefined) {
      const saved = parseJson(command.config_json, {} as any).profile;
      if (
        !saved ||
        b.profileId !== saved.id ||
        b.profileRevision !== saved.revision
      )
        return res
          .status(404)
          .json({ error: "Issued profile identity mismatch." });
    }
    let script: string;
    try {
      script = open(
        {
          ciphertext: command.artifact_ciphertext,
          iv: command.artifact_iv,
          tag: command.artifact_tag,
        },
        `artifact:${id}:${command.installer_digest}`
      );
    } catch {
      return res.status(503).json({ error: "Artifact vault unavailable." });
    }
    if (digest(script) !== command.installer_digest)
      return res
        .status(503)
        .json({ error: "Artifact integrity check failed." });
    await exec(
      "UPDATE wc_commands SET download_count=download_count+1,last_used_at=? WHERE id=? AND revoked_at IS NULL",
      [now(), id]
    );
    res.set({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Script-SHA256": command.installer_digest,
    });
    return res.status(200).send(script);
  } catch (e) {
    return sendError(res, e);
  }
}

async function listCommands(req: Request, res: Response) {
  try {
    const q = req.query;
    const limit = Math.min(
      100,
      Math.max(1, Number(q.limit ?? q.pageSize ?? 25))
    );
    const offset = Math.max(
      0,
      Number(q.offset ?? (Number(q.page || 1) - 1) * Number(q.pageSize || 25))
    );
    const clauses = ["workspace_id=?"];
    const params: unknown[] = [WORKSPACE];
    if (q.status === "expired")
      clauses.push("expires_at<=UTC_TIMESTAMP(3) AND revoked_at IS NULL");
    if (q.status === "revoked") clauses.push("revoked_at IS NOT NULL");
    if (q.status === "issued")
      clauses.push("expires_at>UTC_TIMESTAMP(3) AND revoked_at IS NULL");
    if (q.search || q.q) {
      clauses.push(
        "(id LIKE ? OR label LIKE ? OR username LIKE ? OR iso_url LIKE ?)"
      );
      const s = `%${String(q.search || q.q).slice(0, 120)}%`;
      params.push(s, s, s, s);
    }
    if (q.p || q.profileId) {
      clauses.push(
        "EXISTS(SELECT 1 FROM wc_command_profiles cp WHERE cp.command_id=wc_commands.id AND cp.workspace_id=wc_commands.workspace_id AND cp.profile_id=?)"
      );
      params.push(asId(q.p || q.profileId));
    }
    params.push(limit, offset);
    const list = await rows<any>(
      `SELECT * FROM wc_commands WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      params
    );
    const items = list.map(r => rowCommand(r));
    return res.json({ commands: items, items, limit, offset });
  } catch (e) {
    return sendError(res, e);
  }
}
async function retrieveCommand(req: Request, res: Response) {
  try {
    const a = actor(req);
    const id = asId(req.params.id);
    const c = await findCommand(id);
    if (!c) return res.status(404).json({ error: "Command not found." });
    if (c.revoked_at || new Date(String(c.expires_at)).getTime() <= Date.now())
      return res
        .status(410)
        .json({ error: "Command expired/revoked; generate a new command." });
    const secret = (
      await rows<any>(
        "SELECT capability_envelope FROM wc_delivery_secrets WHERE command_id=?",
        [id]
      )
    )[0];
    if (!secret)
      return res.status(404).json({ error: "Original command unavailable." });
    const capability = open(
      parseJson(secret.capability_envelope, {} as Enc),
      "delivery:" + id
    );
    const scriptHash = c.installer_digest;
    const command = commandForRow(c, capability);
    await recordAudit(req, "command.retrieve", { commandId: id });
    return res.json({
      command,
      expiresAt: iso(c.expires_at),
      id,
      actor: a.id,
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function revokeCommand(req: Request, res: Response) {
  try {
    const id = asId(req.params.id);
    await exec(
      "UPDATE wc_commands SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND workspace_id=?",
      [now(), id, WORKSPACE]
    );
    await recordAudit(req, "command.revoke", { commandId: id });
    return res.json({ revoked: true });
  } catch (e) {
    return sendError(res, e);
  }
}

function deploymentSelect(extra = "") {
  return `SELECT JSON_UNQUOTE(JSON_EXTRACT(c.config_json,'$.remoteJobId')) AS remote_job_id,JSON_EXTRACT(c.config_json,'$.postInstall') AS post_install_plan,(SELECT pi.report_json FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_report,(SELECT pi.updated_at FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_at,(SELECT cp.snapshot_json FROM wc_command_profiles cp WHERE cp.command_id=c.id AND cp.workspace_id=c.workspace_id) AS profile_snapshot,(SELECT l.display_label FROM wc_run_labels l WHERE l.run_id=r.run_id AND l.workspace_id=r.workspace_id) AS display_label,(SELECT JSON_UNQUOTE(JSON_EXTRACT(e.proof_json,'$.windowsInstallationType')) FROM wc_events e WHERE e.run_id=r.run_id AND JSON_EXTRACT(e.proof_json,'$.windowsInstallationType') IS NOT NULL ORDER BY e.received_at DESC LIMIT 1) AS windowsInstallationType,r.*,c.label,c.provider,c.username,c.remote_port AS remotePort,c.credential_ciphertext,c.credential_iv,c.credential_tag,c.credential_key_id,c.credential_version,c.group_id AS commandGroupId,c.credential_version FROM wc_run_meta r JOIN wc_commands c ON c.id=r.command_id WHERE r.workspace_id=? ${extra}`;
}
async function listDeployments(req: Request, res: Response) {
  try {
    const q = req.query;
    const limit = Math.min(
      100,
      Math.max(1, Number(q.limit ?? q.pageSize ?? 25))
    );
    const offset = Math.max(
      0,
      Number(q.offset ?? (Number(q.page || 1) - 1) * Number(q.pageSize || 25))
    );
    const clauses = ["r.workspace_id=?"];
    const params: unknown[] = [WORKSPACE];
    if (q.p || q.profileId) {
      clauses.push(
        "EXISTS(SELECT 1 FROM wc_command_profiles cp WHERE cp.command_id=c.id AND cp.workspace_id=r.workspace_id AND cp.profile_id=?)"
      );
      params.push(asId(q.p || q.profileId));
    }
    const status = String(q.status ?? "");
    if (["completed", "windows_ready"].includes(status))
      clauses.push("r.stage='windows_ready'");
    else if (status === "failed") clauses.push("r.stage='failed'");
    else if (status === "running" || status === "installing")
      clauses.push(
        "r.stage NOT IN ('windows_ready','failed') AND r.trashed_at IS NULL"
      );
    else if (status === "stale")
      clauses.push(
        "r.stage NOT IN ('windows_ready','failed') AND GREATEST(COALESCE(r.last_heartbeat_at,r.created_at),COALESCE(r.last_event_at,r.created_at)) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 MINUTE)"
      );
    if (q.trash === "true" || q.trash === "trash")
      clauses.push("r.trashed_at IS NOT NULL");
    else if (q.trash !== "all") clauses.push("r.trashed_at IS NULL");
    if (q.search || q.q) {
      clauses.push(
        "(r.run_id LIKE ? OR r.public_ip LIKE ? OR r.hostname LIKE ? OR COALESCE((SELECT l.display_label FROM wc_run_labels l WHERE l.run_id=r.run_id AND l.workspace_id=r.workspace_id),c.label) LIKE ? OR c.id LIKE ?)"
      );
      const needle = `%${String(q.search || q.q).slice(0, 120)}%`;
      params.push(needle, needle, needle, needle, needle);
    }
    if (q.from) {
      clauses.push("r.created_at>=?");
      params.push(new Date(String(q.from)));
    }
    if (q.to) {
      clauses.push("r.created_at<?");
      params.push(new Date(String(q.to)));
    }
    if (["archived", "archive"].includes(String(q.trash)))
      clauses.push("r.archived_at IS NOT NULL");
    else if (q.trash !== "true" && q.trash !== "trash")
      clauses.push("r.archived_at IS NULL");
    clauses.push("r.purged_at IS NULL");
    const where = clauses.join(" AND ");
    const sort = ["oldest", "created_asc"].includes(String(q.sort))
      ? "ASC"
      : "DESC";
    const order =
      q.sort === "stage_desc"
        ? "r.stage DESC,r.created_at DESC,r.run_id DESC"
        : `r.created_at ${sort},r.run_id ${sort}`;
    const listParams = [...params, limit, offset];
    const list = await rows<any>(
      `SELECT JSON_EXTRACT(c.config_json,'$.postInstall') AS post_install_plan,(SELECT pi.report_json FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_report,(SELECT pi.updated_at FROM wc_post_install_runs pi WHERE pi.run_id=r.run_id AND pi.workspace_id=r.workspace_id) AS post_install_at,(SELECT cp.snapshot_json FROM wc_command_profiles cp WHERE cp.command_id=c.id AND cp.workspace_id=c.workspace_id) AS profile_snapshot,(SELECT l.display_label FROM wc_run_labels l WHERE l.run_id=r.run_id AND l.workspace_id=r.workspace_id) AS display_label,(SELECT JSON_UNQUOTE(JSON_EXTRACT(e.proof_json,'$.windowsInstallationType')) FROM wc_events e WHERE e.run_id=r.run_id AND JSON_EXTRACT(e.proof_json,'$.windowsInstallationType') IS NOT NULL ORDER BY e.received_at DESC LIMIT 1) AS windowsInstallationType,r.*,r.run_id AS runId,r.command_id AS commandId,r.created_at AS createdAt,r.started_at AS startedAt,r.stage_at AS stageAt,r.last_heartbeat_at AS lastHeartbeatAt,r.finished_at AS finishedAt,r.public_ip AS publicIP,r.whole_disk AS wholeDisk,r.rdp_port AS rdpPort,r.windows_edition AS windowsEdition,r.windows_build AS windowsBuild,r.rdp_listening AS rdpListening,r.credential_available AS credentialAvailable,r.tags_json AS tagsJson,r.archived_at AS archivedAt,r.trashed_at AS trashedAt,c.label,c.username,c.remote_port AS commandRemotePort FROM wc_run_meta r JOIN wc_commands c ON c.id=r.command_id WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      listParams
    );
    const countRows = await rows<any>(
      `SELECT COUNT(*) AS count FROM wc_run_meta r JOIN wc_commands c ON c.id=r.command_id WHERE ${where}`,
      params
    );
    const items = list.map(publicRun);
    return res.json({
      deployments: items,
      items,
      total: Number(countRows[0]?.count ?? items.length),
      page: Number(q.page || 1),
      pageSize: limit,
      limit,
      offset,
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function deploymentDetail(req: Request, res: Response) {
  try {
    const run = await getRun(asId(req.params.id));
    if (!run || run.purgedAt)
      return res.status(404).json({ error: "Deployment not found." });
    const events = await rows<any>(
      "SELECT event_id AS eventId,sequence_no AS sequence,phase,stage,safe_code AS safeCode,proof_json AS proof,payload_json AS payload,client_at AS clientAt,received_at AS receivedAt FROM wc_events WHERE run_id=? ORDER BY sequence_no ASC,received_at ASC",
      [run.runId]
    );
    const group = run.commandGroupId;
    const command = { groupId: group };
    const read = run.readTokenCiphertext
      ? open(
          {
            ciphertext: run.readTokenCiphertext,
            iv: run.readTokenIv,
            tag: run.readTokenTag,
          },
          `read-token:${run.commandId}`
        )
      : null;
    return res.json({
      deployment: publicRun(run),
      events: events.map(e => ({
        ...e,
        proof: parseJson(e.proof, null),
        createdAt: iso(e.receivedAt),
        payload: {
          ...parseJson(e.payload, {}),
          message: e.safeCode || e.phase || undefined,
        },
        clientAt: iso(e.clientAt),
        receivedAt: iso(e.receivedAt),
      })),
      trackingUrl: read ? deliveryUrl(command, read) : null,
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function exportDeployments(req: Request, res: Response) {
  try {
    const list = await rows<any>(
      `${deploymentSelect("AND r.trashed_at IS NULL" + (req.query.p ? " AND EXISTS(SELECT 1 FROM wc_command_profiles cp WHERE cp.command_id=c.id AND cp.workspace_id=r.workspace_id AND cp.profile_id=?)" : ""))} ORDER BY r.created_at DESC LIMIT 10000`,
      req.query.p ? [WORKSPACE, asId(req.query.p)] : [WORKSPACE]
    );
    const content = toCsv(list.map(publicRun));
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="win11desk-deployments.csv"',
      "Cache-Control": "private, no-store",
    });
    return res.send(content);
  } catch (e) {
    return sendError(res, e);
  }
}
async function patchDeployment(req: Request, res: Response) {
  try {
    const id = asId(req.params.id);
    const b = strictObject(req.body, ["label", "notes", "tags", "archive"]);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (b.notes !== undefined) {
      sets.push("notes=?");
      params.push(asString(b.notes, "notes", 0, 4000));
    }
    if (b.tags !== undefined) {
      sets.push("tags_json=?");
      params.push(json(tags(b.tags), []));
    }
    if (b.archive !== undefined) {
      if (typeof b.archive !== "boolean")
        throw new InputError("Invalid archive");
      sets.push("archived_at=?");
      params.push(b.archive ? now() : null);
    }
    if (!sets.length && b.label === undefined)
      throw new InputError("No editable fields supplied");
    const label =
      b.label === undefined
        ? undefined
        : asString(b.label, "label", 0, 160).trim();
    if (label !== undefined && /[\x00-\x1f\x7f]/.test(label))
      throw new InputError("Invalid label");
    await transaction(async c => {
      const [existing]: any = await c.execute(
        "SELECT run_id FROM wc_run_meta WHERE run_id=? AND workspace_id=? AND purged_at IS NULL FOR UPDATE",
        [id, WORKSPACE]
      );
      if (!existing.length) throw new InputError("Deployment not found");
      if (label !== undefined) {
        if (label)
          await c.execute(
            "INSERT INTO wc_run_labels (run_id,workspace_id,display_label,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE display_label=VALUES(display_label),updated_at=VALUES(updated_at)",
            [id, WORKSPACE, label, now()]
          );
        else
          await c.execute(
            "DELETE FROM wc_run_labels WHERE run_id=? AND workspace_id=?",
            [id, WORKSPACE]
          );
      }
      if (!sets.length) return;
      params.push(id, WORKSPACE);
      await c.execute(
        `UPDATE wc_run_meta SET ${sets.join(",")} WHERE run_id=? AND workspace_id=? AND purged_at IS NULL`,
        params
      );
    });
    await recordAudit(req, "deployment.update", {
      runId: id,
      fields: Object.keys(b),
    });
    return res.json({ updated: true });
  } catch (e) {
    return sendError(res, e);
  }
}
async function trashDeployment(req: Request, res: Response) {
  try {
    const id = asId(req.params.id);
    await exec(
      "UPDATE wc_run_meta SET trashed_at=? WHERE run_id=? AND workspace_id=? AND purged_at IS NULL",
      [now(), id, WORKSPACE]
    );
    await recordAudit(req, "deployment.trash", { runId: id });
    return res.json({ trashed: true });
  } catch (e) {
    return sendError(res, e);
  }
}
async function restoreDeployment(req: Request, res: Response) {
  try {
    const id = asId(req.params.id);
    await exec(
      "UPDATE wc_run_meta SET trashed_at=NULL,archived_at=NULL WHERE run_id=? AND workspace_id=? AND purged_at IS NULL",
      [id, WORKSPACE]
    );
    await recordAudit(req, "deployment.restore", { runId: id });
    return res.json({ restored: true });
  } catch (e) {
    return sendError(res, e);
  }
}
async function purgeDeployment(req: Request, res: Response) {
  try {
    if (!["owner", "admin"].includes(actor(req).role))
      throw new InputError("Only an owner or administrator may purge records");
    const id = asId(req.params.id);
    const b = strictObject(req.body, ["confirm"]);
    if (b.confirm !== id)
      throw new InputError("Explicit confirmation is required");
    const result = await transaction(async (tx: SqlConn) => {
      const run = (
        await connQuery<any>(
          tx,
          "SELECT * FROM wc_run_meta WHERE run_id=? AND workspace_id=? LIMIT 1 FOR UPDATE",
          [id, WORKSPACE]
        )
      )[0];
      if (!run) throw new InputError("Deployment not found");
      if (
        !["windows_ready", "failed"].includes(String(run.stage)) ||
        run.purged_at
      )
        throw new InputError(
          "Only terminal deployments can be permanently deleted"
        );
      const command = (
        await connQuery<any>(
          tx,
          "SELECT * FROM wc_commands WHERE id=? AND workspace_id=? LIMIT 1 FOR UPDATE",
          [run.command_id, WORKSPACE]
        )
      )[0];
      await connExec(
        tx,
        "DELETE FROM wc_post_install_runs WHERE run_id=? AND workspace_id=?",
        [id, WORKSPACE]
      );
      await connExec(tx, "DELETE FROM wc_events WHERE run_id=?", [id]);
      await connExec(tx, "DELETE FROM installerTrackingRuns WHERE id=?", [id]);
      await connExec(
        tx,
        "UPDATE wc_run_meta SET hostname=NULL,whole_disk=NULL,public_ip=NULL,notes=NULL,tags_json='[]',credential_available=0,archived_at=NULL,trashed_at=NULL,purged_at=?,tombstone_code='PURGED' WHERE run_id=?",
        [now(), id]
      );
      await connExec(
        tx,
        "DELETE FROM wc_run_labels WHERE run_id=? AND workspace_id=?",
        [id, WORKSPACE]
      );
      const siblings = Number(
        (
          await connQuery<any>(
            tx,
            "SELECT COUNT(*) AS n FROM wc_run_meta WHERE command_id=? AND purged_at IS NULL",
            [run.command_id]
          )
        )[0]?.n ?? 0
      );
      if (
        command &&
        siblings === 0 &&
        (command.revoked_at ||
          new Date(String(command.expires_at)).getTime() < Date.now())
      )
        await connExec(
          tx,
          "UPDATE wc_commands SET artifact_ciphertext='',artifact_iv='',artifact_tag='',credential_ciphertext='',credential_iv='',credential_tag='',read_token_ciphertext='',read_token_iv='',read_token_tag='',write_token_ciphertext='',write_token_iv='',write_token_tag='',notes=NULL WHERE id=?",
          [run.command_id]
        );
      if (
        siblings === 0 &&
        command &&
        (command.revoked_at ||
          new Date(String(command.expires_at)).getTime() < Date.now())
      )
        await connExec(
          tx,
          "DELETE FROM wc_delivery_secrets WHERE command_id=?",
          [run.command_id]
        );
      return { purged: true, shared: siblings > 0 };
    });
    await recordAudit(req, "deployment.purge", {
      runId: id,
      retainedShared: result.shared,
    });
    return res.json(result);
  } catch (e) {
    return sendError(res, e);
  }
}
async function revealCredential(req: Request, res: Response) {
  try {
    const run = await getRun(asId(req.params.id));
    if (!run || run.purgedAt || !run.credentialAvailable)
      return res.status(404).json({ error: "Credential unavailable." });
    const password = open(
      {
        ciphertext: run.credential_ciphertext,
        iv: run.credential_iv,
        tag: run.credential_tag,
      },
      `credential:${run.commandId}:${run.credential_version}`
    );
    await recordAudit(req, "credential.reveal", { runId: run.runId });
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    });
    return res.json({ username: run.username, password });
  } catch (e) {
    return sendError(res, e);
  }
}

async function overview(req: Request, res: Response) {
  try {
    const counts = await rows<any>(
      "SELECT SUM(stage NOT IN ('windows_ready','failed') AND trashed_at IS NULL) AS installing,SUM(stage='windows_ready' AND trashed_at IS NULL) AS completed,SUM(stage='failed' AND trashed_at IS NULL) AS failed,SUM(stage NOT IN ('windows_ready','failed') AND GREATEST(COALESCE(last_heartbeat_at,created_at),COALESCE(last_event_at,created_at)) < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE) AND trashed_at IS NULL) AS stale FROM wc_run_meta WHERE workspace_id=? AND purged_at IS NULL AND archived_at IS NULL",
      [WORKSPACE]
    );
    const recent = await rows<any>(
      `${deploymentSelect("AND r.trashed_at IS NULL")} ORDER BY r.created_at DESC LIMIT 8`,
      [WORKSPACE]
    );
    const extras = await rows<any>(
      "SELECT COUNT(*) AS commands,SUM(NOT EXISTS(SELECT 1 FROM wc_run_meta r WHERE r.command_id=c.id)) AS pending FROM wc_commands c WHERE c.workspace_id=?",
      [WORKSPACE]
    );
    const archived = await rows<any>(
      "SELECT COUNT(*) AS n FROM wc_run_meta WHERE workspace_id=? AND archived_at IS NOT NULL AND purged_at IS NULL AND trashed_at IS NULL",
      [WORKSPACE]
    );
    const measuredCounts = Object.fromEntries(
      Object.entries(counts[0] || {}).map(([key, value]) => [
        key,
        Number(value || 0),
      ])
    );
    return res.json({
      counts: {
        ...measuredCounts,
        active: measuredCounts.installing || 0,
        reporting: Math.max(
          0,
          (measuredCounts.installing || 0) - (measuredCounts.stale || 0)
        ),
        attention: (measuredCounts.failed || 0) + (measuredCounts.stale || 0),
        commands: Number(extras[0]?.commands || 0),
        pending: Number(extras[0]?.pending || 0),
        archived: Number(archived[0]?.n || 0),
      },
      active: recent
        .filter(r => !["windows_ready", "failed"].includes(String(r.stage)))
        .map(publicRun),
      recent: recent.map(publicRun),
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function activity(req: Request, res: Response) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const items = await rows<any>(
      "SELECT id,actor_id AS actorId,action,target_id AS targetId,metadata_json AS metadata,created_at AS createdAt FROM wc_audit ORDER BY created_at DESC,id DESC LIMIT ?",
      [limit]
    );
    return res.json({
      items: items.map(i => ({
        id: i.id,
        actorId: i.actorId,
        action: i.action,
        targetId: i.targetId,
        metadata: parseJson(i.metadata, {}),
        createdAt: iso(i.createdAt),
      })),
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function rdpExport(req: Request, res: Response) {
  try {
    const run = await getRun(asId(req.params.id));
    if (!run || run.purgedAt)
      return res.status(404).json({ error: "Deployment not found." });
    const host = run.publicIP || run.public_ip || run.hostname;
    if (!host || !run.remotePort)
      return res
        .status(409)
        .json({ error: "RDP address has not been reported." });
    const content =
      [
        "full address:s:" + host + ":" + Number(run.remotePort),
        run.username ? "username:s:" + run.username : "screen mode id:i:2",
        "prompt for credentials:i:1",
        "authentication level:i:2",
        "redirectclipboard:i:1",
        "",
      ].join("\r\n") + "\r\n";
    res.set({
      "Content-Type": "application/x-rdp",
      "Content-Disposition": `attachment; filename=win11desk-${run.runId}.rdp`,
      "Cache-Control": "private, no-store",
    });
    return res.send(content);
  } catch (e) {
    return sendError(res, e);
  }
}
async function settings(req: Request, res: Response) {
  try {
    const found = await rows<any>(
      "SELECT revision,settings_json AS settings,updated_at AS updatedAt FROM wc_settings WHERE workspace_id=? LIMIT 1",
      [WORKSPACE]
    );
    const row = found[0];
    const value = parseJson(row?.settings, defaultSettings);
    return res.json({
      revision: Number(row?.revision ?? 1),
      settings: value,
      items: [
        {
          key: "installer.defaults",
          value,
          revision: Number(row?.revision ?? 1),
          updatedAt: iso(row?.updatedAt),
        },
      ],
    });
  } catch (e) {
    return sendError(res, e);
  }
}
async function updateSettings(req: Request, res: Response) {
  try {
    const b = strictObject(req.body, ["revision", "settings", "key", "value"]);
    const revision = asInt(b.revision, "revision", 1, 2147483647);
    const s = strictObject(b.settings ?? b.value, [
      "username",
      "remotePort",
      "retries",
      "isoUrl",
    ]);
    const next = {
      username:
        s.username === undefined
          ? defaultSettings.username
          : asString(s.username, "username", 1, 20),
      remotePort:
        s.remotePort === undefined
          ? 22
          : asInt(s.remotePort, "remotePort", 1, 65535),
      retries:
        s.retries === undefined ? 10 : asInt(s.retries, "retries", 1, 30),
      isoUrl:
        s.isoUrl === undefined
          ? defaultIsoUrl
          : asString(s.isoUrl, "isoUrl", 0, 4096),
    };
    if (next.isoUrl) {
      const parsed = new URL(next.isoUrl);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      )
        throw new InputError("ISO source must be direct HTTPS");
    }
    const a = actor(req);
    const result = await transaction(async tx => {
      const current = (
        await connQuery<any>(
          tx,
          "SELECT revision FROM wc_settings WHERE workspace_id=? FOR UPDATE",
          [WORKSPACE]
        )
      )[0];
      if (current && Number(current.revision) !== revision)
        throw new InputError("Settings changed; reload before saving");
      if (current)
        await connExec(
          tx,
          "UPDATE wc_settings SET revision=revision+1,settings_json=?,updated_by=?,updated_at=? WHERE workspace_id=?",
          [json(next), String(a.id), now(), WORKSPACE]
        );
      else
        await connExec(
          tx,
          "INSERT INTO wc_settings (workspace_id,revision,settings_json,updated_by,updated_at) VALUES (?,1,?,?,?)",
          [WORKSPACE, json(next), String(a.id), now()]
        );
      return true;
    });
    await recordAudit(req, "settings.update", { revision });
    return res.json({ updated: result });
  } catch (e) {
    return sendError(res, e);
  }
}
async function presets(req: Request, res: Response) {
  try {
    const list = await rows<any>(
      "SELECT id,label,settings_json AS settings,created_at AS createdAt,updated_at AS updatedAt,archived_at AS archivedAt FROM wc_presets WHERE workspace_id=? AND archived_at IS NULL ORDER BY label",
      [WORKSPACE]
    );
    const items = list.map(p => ({
      ...p,
      settings: parseJson(p.settings, {}),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      archivedAt: iso(p.archivedAt),
    }));
    return res.json({ presets: items, items });
  } catch (e) {
    return sendError(res, e);
  }
}
async function savePreset(req: Request, res: Response) {
  try {
    const b = strictObject(req.body, ["id", "label", "settings"]);
    const label = asString(b.label, "label", 1, 160);
    const s = strictObject(b.settings, [
      "username",
      "remotePort",
      "retries",
      "isoUrl",
    ]);
    if (
      Object.values(s).some(
        v => typeof v === "string" && /password|secret/i.test(v)
      )
    )
      throw new InputError("Presets cannot contain passwords");
    const id = b.id === undefined ? randomUUID() : asId(b.id);
    const a = actor(req);
    await exec(
      "INSERT INTO wc_presets (id,workspace_id,owner_id,label,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),settings_json=VALUES(settings_json),updated_at=VALUES(updated_at)",
      [id, WORKSPACE, String(a.id), label, json(s), now(), now()]
    );
    return res.json({ id, saved: true });
  } catch (e) {
    return sendError(res, e);
  }
}

export async function assertGroupActive(groupId: string) {
  const found = await rows<any>(
    "SELECT id FROM wc_commands WHERE group_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3) LIMIT 1",
    [groupId]
  );
  if (!found.length) throw new Error("Tracking group unavailable");
}
export async function onRunRegistered(
  runId: string,
  groupId: string,
  metadata: any
) {
  await transaction(async tx => {
    const trackers = await connQuery<any>(
      tx,
      "SELECT id FROM installerTrackingRuns WHERE id=? AND groupId=? FOR UPDATE",
      [runId, groupId]
    );
    if (!trackers.length) return;
    const command = (
      await connQuery<any>(
        tx,
        "SELECT id,workspace_id,owner_id,group_id,username,credential_ciphertext FROM wc_commands WHERE group_id=? LIMIT 1 FOR UPDATE",
        [groupId]
      )
    )[0];
    if (!command) return;
    const created = now();
    await connExec(
      tx,
      "INSERT IGNORE INTO wc_run_meta (run_id,workspace_id,owner_id,command_id,group_id,nonce_hash,hostname,whole_disk,rdp_port,public_ip,stage,created_at,registered_at,stage_at,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        runId,
        command.workspace_id,
        command.owner_id,
        command.id,
        groupId,
        metadata.executionId ? digest(String(metadata.executionId)) : null,
        metadata.hostname ?? null,
        metadata.wholeDisk ?? null,
        metadata.rdpPort ?? null,
        metadata.publicIP ?? null,
        "starting",
        created,
        created,
        created,
        "[]",
      ]
    );
  });
}
export async function onRunEvent(runId: string, event: any) {
  const at = now();
  const e = event && typeof event === "object" ? event : {};
  const stage = String(e.stage ?? "starting");
  if (!STAGES.includes(stage as Stage)) return;
  await transaction(async tx => {
    const run = (
      await connQuery<any>(
        tx,
        "SELECT stage,phase,downloaded_bytes,total_bytes FROM wc_run_meta WHERE run_id=? AND purged_at IS NULL FOR UPDATE",
        [runId]
      )
    )[0];
    if (!run) return;
    const current = String(run.stage);
    const terminal = current === "windows_ready" || current === "failed";
    if (terminal && stage !== current) return;
    const old = e.eventId
      ? await connQuery<any>(
          tx,
          "SELECT event_id FROM wc_events WHERE run_id=? AND event_id=?",
          [runId, e.eventId]
        )
      : [];
    if (old.length) return;
    if (stage !== current || e.eventId || e.phase || e.downloadedBytes != null)
      await connExec(
        tx,
        "INSERT IGNORE INTO wc_events (run_id,event_id,sequence_no,phase,stage,safe_code,proof_json,payload_json,client_at,received_at) SELECT ?,?,?,?,?,?,?,?,?,?",
        [
          runId,
          String(e.eventId ?? `${stage}:${at.getTime()}`),
          Number(e.sequence || 0),
          e.phase ?? null,
          stage,
          e.errorCode ?? null,
          json({
            windowsInstallationType: e.windowsInstallationType,
            windowsEdition: e.windowsEdition,
            windowsBuild: e.windowsBuild,
            rdpListening: e.rdpListening,
          }),
          json({
            stage,
            phase: e.phase,
            downloadedBytes: e.downloadedBytes,
            totalBytes: e.totalBytes,
          }),
          e.clientAt ? new Date(e.clientAt) : null,
          at,
        ]
      );
    if (stage !== current && ["windows_ready", "failed"].includes(stage))
      await connExec(
        tx,
        "INSERT INTO wc_notifications(id,owner_id,run_id,kind,title,body,created_at) SELECT ?,owner_id,run_id,?,?,?,? FROM wc_run_meta WHERE run_id=?",
        [
          randomUUID(),
          stage,
          stage === "windows_ready"
            ? "Windows installation reported complete"
            : "Installation reported an error",
          stage === "windows_ready"
            ? "Selected Windows OS and local RDP evidence received."
            : "Open the deployment timeline for its safe error code.",
          at,
          runId,
        ]
      );
    const phaseChanged = e.phase != null && e.phase !== run.phase;
    const reportsBytes = e.downloadedBytes != null;
    const downloadedBytes = reportsBytes
      ? e.downloadedBytes
      : phaseChanged
        ? null
        : run.downloaded_bytes;
    const totalBytes = reportsBytes
      ? (e.totalBytes ?? null)
      : phaseChanged
        ? null
        : run.total_bytes;
    await connExec(
      tx,
      "UPDATE wc_run_meta SET stage_at=IF(?<>?, ?, stage_at),stage=?,last_event_at=?,last_heartbeat_at=?,phase=COALESCE(?,phase),downloaded_bytes=?,total_bytes=?,windows_edition=COALESCE(?,windows_edition),windows_build=COALESCE(?,windows_build),rdp_listening=COALESCE(?,rdp_listening),started_at=IF(started_at IS NULL AND ? NOT IN ('starting'),?,started_at),finished_at=IF(? IN ('windows_ready','failed') AND finished_at IS NULL,?,finished_at) WHERE run_id=?",
      [
        stage,
        current,
        at,
        stage,
        at,
        at,
        e.phase ?? null,
        downloadedBytes ?? null,
        totalBytes ?? null,
        e.windowsEdition ?? null,
        e.windowsBuild ?? null,
        e.rdpListening ?? null,
        stage,
        at,
        stage,
        at,
        runId,
      ]
    );
  });
}
export async function onRunHeartbeat(runId: string) {
  await exec(
    "UPDATE wc_run_meta SET last_heartbeat_at=? WHERE run_id=? AND purged_at IS NULL AND stage NOT IN ('windows_ready','failed')",
    [now(), runId]
  );
}
export async function isRunPurged(runId: string) {
  const found = await rows<any>(
    "SELECT purged_at FROM wc_run_meta WHERE run_id=? LIMIT 1",
    [runId]
  );
  return Boolean(found[0]?.purged_at);
}

function protectedRoute(
  permission: AdminPermission,
  handler: (req: Request, res: Response, next?: NextFunction) => unknown,
  step = false
) {
  const middleware: any[] = [requireAuth, requirePermission(permission)];
  if (step) middleware.push(requireStepUp);
  middleware.push(async (req: Request, res: Response, next: NextFunction) => {
    try {
      validateOrigin(req);
      await Promise.resolve(handler(req, res, next));
    } catch (e) {
      sendError(res, e);
    }
  });
  return middleware;
}
export function registerAdminRoutes(app: Express) {
  app.post(
    "/api/admin/deployments/actions",
    ...protectedRoute("deployments:write", async (req, res) => {
      const b = strictObject(req.body, ["action", "ids", "confirm"]);
      if (
        b.confirm !== true ||
        !Array.isArray(b.ids) ||
        !b.ids.length ||
        b.ids.length > 100 ||
        !["trash", "restore", "purge"].includes(String(b.action))
      )
        throw new InputError("Invalid bulk action");
      if (b.action === "purge" && !["owner", "admin"].includes(actor(req).role))
        return res
          .status(403)
          .json({ error: "Owner/admin permission required" });
      const ids = b.ids.map(asId);
      if (b.action === "purge") {
        const verified = await rows<any>(
          "SELECT step_up_at FROM wc_sessions WHERE id=?",
          [actor(req).sessionId]
        );
        if (
          !verified[0]?.step_up_at ||
          Date.now() - new Date(verified[0].step_up_at).getTime() > 300000
        )
          return res.status(401).json({ error: "STEP_UP_REQUIRED" });
      }
      const results: any[] = [];
      for (const id of ids) {
        const fake = Object.create(req);
        fake.params = { id };
        fake.body = { confirm: id };
        let failure = false;
        const capture: any = {
          status: (code: number) => {
            if (code >= 400) failure = true;
            return capture;
          },
          json: (value: any) => {
            results.push({ id, ...value });
            return capture;
          },
          set: () => capture,
        };
        await (
          b.action === "purge"
            ? purgeDeployment
            : b.action === "trash"
              ? trashDeployment
              : restoreDeployment
        )(fake, capture);
        if (failure) {
          res.status(409).json({
            error: "Some records rejected; results include applied records.",
            results,
          });
          return;
        }
      }
      res.json({ results });
    })
  );

  app.post("/api/installer/delivery", delivery);
  app.get(
    "/api/admin/commands",
    ...protectedRoute("commands:read", listCommands)
  );
  app.post(
    "/api/admin/commands",
    ...protectedRoute("commands:write", async (req, res) => {
      const result = await generateCommands(req, req.body);
      await recordAudit(req, "command.issue", {
        count: result.commands.length,
      });
      res.set("Cache-Control", "private, no-store").json(result);
    })
  );

  app.post(
    "/api/admin/commands/:id/retrieve",
    ...protectedRoute("commands:write", retrieveCommand, true)
  );
  app.post(
    "/api/admin/commands/:id/revoke",
    ...protectedRoute("commands:write", revokeCommand)
  );
  app.get("/api/admin/overview", ...protectedRoute("workspace:read", overview));
  app.get(
    "/api/admin/deployments/export",
    ...protectedRoute("deployments:read", exportDeployments)
  );
  app.get(
    "/api/admin/deployments/:id/rdp",
    ...protectedRoute("deployments:read", rdpExport)
  );
  app.get(
    "/api/admin/deployments",
    ...protectedRoute("deployments:read", listDeployments)
  );
  app.get(
    "/api/admin/deployments/:id",
    ...protectedRoute("deployments:read", deploymentDetail)
  );
  app.patch(
    "/api/admin/deployments/:id",
    ...protectedRoute("deployments:write", patchDeployment)
  );
  app.post(
    "/api/admin/deployments/:id/archive",
    ...protectedRoute("deployments:write", patchDeployment)
  );
  app.post(
    "/api/admin/deployments/:id/trash",
    ...protectedRoute("deployments:write", trashDeployment)
  );
  app.post(
    "/api/admin/deployments/:id/restore",
    ...protectedRoute("deployments:write", restoreDeployment)
  );
  app.post(
    "/api/admin/deployments/:id/purge",
    ...protectedRoute("deployments:write", purgeDeployment, true)
  );
  app.post(
    "/api/admin/deployments/:id/reveal",
    ...protectedRoute("credentials:reveal", revealCredential)
  );
  app.get("/api/admin/settings", ...protectedRoute("settings:read", settings));
  // Legacy non-secret read compatibility; new editing lives in Deployment profiles.
  app.get("/api/admin/presets", ...protectedRoute("workspace:read", presets));
  const retired = (_req: Request, res: Response) =>
    res
      .status(410)
      .json({ error: "This editor was removed. Use Deployment profiles." });
  app.patch(
    "/api/admin/settings",
    ...protectedRoute("settings:write", retired)
  );
  app.post("/api/admin/presets", ...protectedRoute("commands:write", retired));
  app.delete(
    "/api/admin/presets/:id",
    ...protectedRoute("commands:write", retired)
  );
}
export default registerAdminRoutes;
