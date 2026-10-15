import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { PoolConnection } from "mysql2/promise";
import {
  osCatalog,
  profileInputSchema,
  profileSnapshot,
  isProfileReady,
  readyProfile,
  type DeploymentProfile,
  type ProfileInput,
  type ProfileSnapshot,
} from "../../shared/deploymentProfiles";
import { audit, requirePermission } from "./auth";
import { exec, rows, transaction } from "./db";

const WORKSPACE = "default";
const DEFAULT_PROFILE_ID = "00000000-0000-4000-8000-000000000011";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProfileRow = {
  id: string;
  workspace_id: string;
  name: string;
  os_id: string;
  iso_url: string;
  image_name: string;
  description: string;
  username: string;
  remote_port: number;
  retries: number;
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
  command_count?: number | string;
  deployment_count?: number | string;
};

type SnapshotRow = {
  id: string;
  profile_revision: number;
  snapshot_json: unknown;
  config_json: unknown;
};

/** A safe, status-coded failure used by profile consumers and HTTP handlers. */
export class ProfileError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProfileError";
    this.status = status;
    this.code = code;
  }
}

function executorRows<T>(
  connection: PoolConnection | undefined,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  if (connection) {
    return connection.execute(sql, params).then(([result]) => result as T[]);
  }
  return rows<T>(sql, params);
}

function dateIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function assertId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new ProfileError(400, "INVALID_PROFILE_ID", "Invalid profile id.");
  return value;
}

function assertRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ProfileError(
      400,
      "INVALID_REVISION",
      "Invalid profile revision."
    );
  return Number(value);
}

function parseInput(value: unknown): ProfileInput {
  try {
    return profileInputSchema.parse(value);
  } catch {
    throw new ProfileError(400, "INVALID_PROFILE", "Profile input is invalid.");
  }
}

function parseRevisionBody(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProfileError(400, "INVALID_REQUEST", "Request body is invalid.");
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "revision")
    throw new ProfileError(400, "INVALID_REQUEST", "Request body is invalid.");
  return assertRevision((value as Record<string, unknown>).revision);
}

function mapProfile(row: ProfileRow): DeploymentProfile {
  const raw = {
    name: row.name,
    osId: row.os_id,
    isoUrl: row.iso_url,
    imageName: row.image_name ?? "",
    description: row.description ?? "",
    username: row.username,
    remotePort: Number(row.remote_port),
    retries: Number(row.retries),
  };
  const parsed = profileInputSchema.safeParse(raw);
  const input: ProfileInput = parsed.success
    ? parsed.data
    : {
        name: stringValue(raw.name),
        osId: stringValue(raw.osId),
        isoUrl: stringValue(raw.isoUrl),
        imageName: stringValue(raw.imageName),
        description: stringValue(raw.description),
        username: stringValue(raw.username),
        remotePort: raw.remotePort,
        retries: raw.retries,
      };
  return {
    ...input,
    id: row.id,
    revision: Number(row.revision),
    createdAt: dateIso(row.created_at) || new Date(0).toISOString(),
    updatedAt: dateIso(row.updated_at) || new Date(0).toISOString(),
    archivedAt: dateIso(row.archived_at),
    commandCount: numberValue(row.command_count),
    deploymentCount: numberValue(row.deployment_count),
  };
}

const PROFILE_SELECT = `
  SELECT p.id,p.workspace_id,p.name,p.os_id,p.iso_url,p.image_name,p.description,p.username,
         p.remote_port,p.retries,p.revision,p.created_at,p.updated_at,p.archived_at,
         (SELECT COUNT(*) FROM wc_command_profiles cp
            WHERE cp.profile_id=p.id AND cp.workspace_id=p.workspace_id) AS command_count,
         (SELECT COUNT(*) FROM wc_run_meta r
            JOIN wc_command_profiles cp2 ON cp2.command_id=r.command_id
           WHERE cp2.profile_id=p.id AND cp2.workspace_id=p.workspace_id
             AND r.workspace_id=p.workspace_id AND r.purged_at IS NULL) AS deployment_count
    FROM wc_profiles p`;

async function profileById(
  id: string,
  connection?: PoolConnection,
  lock = false
): Promise<ProfileRow | undefined> {
  const result = await executorRows<ProfileRow>(
    connection,
    `${PROFILE_SELECT} WHERE p.workspace_id=? AND p.id=?${lock ? " FOR UPDATE" : ""}`,
    [WORKSPACE, id]
  );
  return result[0];
}

function duplicateError(error: unknown): boolean {
  return (error as { code?: string })?.code === "ER_DUP_ENTRY";
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ProfileError) {
    res
      .status(error.status)
      .json({ error: error.code, message: error.message });
    return;
  }
  if (duplicateError(error)) {
    res.status(409).json({
      error: "PROFILE_NAME_EXISTS",
      message: "A profile with that name already exists.",
    });
    return;
  }
  console.error(
    "Profile operation failed",
    (error as { code?: string }).code || "INTERNAL"
  );
  res.status(500).json({
    error: "PROFILE_OPERATION_FAILED",
    message: "Profile operation failed.",
  });
}

function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    void handler(req, res).catch(error => sendError(res, error));
  };
}

/** Resolve an active profile revision for command creation or another deployment consumer. */
export async function resolveProfile(
  id: string,
  revision: number,
  connection?: PoolConnection
): Promise<ProfileSnapshot> {
  const profileId = assertId(id);
  const expectedRevision = assertRevision(revision);
  const row = connection
    ? (
        await executorRows<ProfileRow>(
          connection,
          `${PROFILE_SELECT} WHERE p.workspace_id=? AND p.id=? LOCK IN SHARE MODE`,
          [WORKSPACE, profileId]
        )
      )[0]
    : await profileById(profileId);
  if (!row)
    throw new ProfileError(404, "PROFILE_NOT_FOUND", "Profile not found.");
  if (row.archived_at)
    throw new ProfileError(409, "PROFILE_INACTIVE", "Profile is archived.");
  if (Number(row.revision) !== expectedRevision)
    throw new ProfileError(
      409,
      "PROFILE_STALE",
      "Profile changed; reload before using it."
    );
  if (!row.iso_url)
    throw new ProfileError(
      422,
      "PROFILE_UNCONFIGURED",
      "Profile has no ISO URL configured."
    );
  const profile = mapProfile(row);
  if (!isProfileReady(profile))
    throw new ProfileError(
      422,
      "PROFILE_UNCONFIGURED",
      "Profile is not configured for issuance."
    );
  return profileSnapshot(profile);
}

/** Return the immutable profile snapshot persisted for a run, or null for legacy/unlinked runs. */
export async function getRunProfile(
  runId: string
): Promise<ProfileSnapshot | null> {
  if (!UUID_RE.test(runId)) return null;
  const result = await rows<SnapshotRow>(
    `SELECT cp.profile_id AS id,cp.profile_revision,cp.snapshot_json,c.config_json
       FROM wc_run_meta r
      JOIN wc_commands c ON c.id=r.command_id
        AND c.workspace_id=r.workspace_id
      LEFT JOIN wc_command_profiles cp ON cp.command_id=r.command_id
        AND cp.workspace_id=r.workspace_id
      WHERE r.workspace_id=? AND r.run_id=?
      LIMIT 1`,
    [WORKSPACE, runId]
  );
  const row = result[0];
  if (!row) return null;
  let config: Record<string, unknown> | null = null;
  if (typeof row.config_json === "string") {
    try {
      const parsed = JSON.parse(row.config_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        config = parsed as Record<string, unknown>;
    } catch {
      // An unparseable command config cannot establish that this was modern.
    }
  } else if (
    row.config_json &&
    typeof row.config_json === "object" &&
    !Array.isArray(row.config_json)
  ) {
    config = row.config_json as Record<string, unknown>;
  }
  const modern =
    Boolean(row.id) ||
    (config !== null &&
      (Object.hasOwn(config, "launcher") || Object.hasOwn(config, "profile")));
  const failModern = () => {
    if (modern)
      throw new ProfileError(
        422,
        "PROFILE_SNAPSHOT_UNAVAILABLE",
        "Issued profile snapshot is unavailable."
      );
  };
  if (modern) {
    const configured = config?.profile;
    if (
      !row.id ||
      !Number.isSafeInteger(Number(row.profile_revision)) ||
      Number(row.profile_revision) < 1 ||
      !configured ||
      typeof configured !== "object" ||
      Array.isArray(configured) ||
      (configured as Record<string, unknown>).id !== row.id ||
      Number((configured as Record<string, unknown>).revision) !==
        Number(row.profile_revision)
    ) {
      failModern();
    }
  }
  if (!row.id || row.profile_revision == null) return null;
  let value: unknown = row.snapshot_json;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      failModern();
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failModern();
    return null;
  }
  try {
    const snapshot = value as Record<string, unknown>;
    if (
      modern &&
      ((snapshot.id !== undefined && snapshot.id !== row.id) ||
        (snapshot.revision !== undefined &&
          Number(snapshot.revision) !== Number(row.profile_revision)))
    ) {
      failModern();
      return null;
    }
    const { id: _snapshotId, revision: _snapshotRevision, ...input } = snapshot;
    const parsed = profileInputSchema.safeParse(input);
    if (!parsed.success) {
      failModern();
      return null;
    }
    if (modern && !isProfileReady({ ...parsed.data, archivedAt: null })) {
      failModern();
      return null;
    }
    return {
      ...parsed.data,
      id: row.id,
      revision: Number(row.profile_revision),
    };
  } catch {
    failModern();
    return null;
  }
}

async function listProfiles(
  includeArchived: boolean
): Promise<DeploymentProfile[]> {
  const items = await rows<ProfileRow>(
    `${PROFILE_SELECT} WHERE p.workspace_id=?${includeArchived ? "" : " AND p.archived_at IS NULL"} ORDER BY p.name,p.id`,
    [WORKSPACE]
  );
  return items.map(mapProfile);
}

async function createProfile(input: ProfileInput): Promise<DeploymentProfile> {
  const id = randomUUID();
  const now = new Date();
  try {
    await exec(
      `INSERT INTO wc_profiles
       (id,workspace_id,name,os_id,iso_url,image_name,description,username,remote_port,retries,revision,created_at,updated_at,archived_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`,
      [
        id,
        WORKSPACE,
        input.name,
        input.osId,
        input.isoUrl,
        input.imageName,
        input.description,
        input.username,
        input.remotePort,
        input.retries,
        now,
        now,
      ]
    );
  } catch (error) {
    if (duplicateError(error))
      throw new ProfileError(
        409,
        "PROFILE_NAME_EXISTS",
        "A profile with that name already exists."
      );
    throw error;
  }
  const row = await profileById(id);
  if (!row)
    throw new ProfileError(
      500,
      "PROFILE_OPERATION_FAILED",
      "Profile operation failed."
    );
  return mapProfile(row);
}

async function updateProfile(
  id: string,
  input: ProfileInput,
  revision: number
): Promise<DeploymentProfile> {
  const profile = await transaction(async connection => {
    const current = await profileById(id, connection, true);
    if (!current)
      throw new ProfileError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    if (Number(current.revision) !== revision)
      throw new ProfileError(
        409,
        "PROFILE_STALE",
        "Profile changed; reload before saving."
      );
    try {
      await connection.execute(
        `UPDATE wc_profiles
            SET name=?,os_id=?,iso_url=?,image_name=?,description=?,username=?,remote_port=?,retries=?,revision=revision+1,updated_at=?
          WHERE workspace_id=? AND id=? AND revision=?`,
        [
          input.name,
          input.osId,
          input.isoUrl,
          input.imageName,
          input.description,
          input.username,
          input.remotePort,
          input.retries,
          new Date(),
          WORKSPACE,
          id,
          revision,
        ]
      );
    } catch (error) {
      if (duplicateError(error))
        throw new ProfileError(
          409,
          "PROFILE_NAME_EXISTS",
          "A profile with that name already exists."
        );
      throw error;
    }
    const updated = await profileById(id, connection, false);
    if (!updated)
      throw new ProfileError(
        500,
        "PROFILE_OPERATION_FAILED",
        "Profile operation failed."
      );
    return mapProfile(updated);
  });
  return profile;
}

async function setArchived(
  id: string,
  revision: number,
  archived: boolean
): Promise<DeploymentProfile> {
  return transaction(async connection => {
    const current = await profileById(id, connection, true);
    if (!current)
      throw new ProfileError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    if (Number(current.revision) !== revision)
      throw new ProfileError(
        409,
        "PROFILE_STALE",
        "Profile changed; reload before saving."
      );
    const isArchived = current.archived_at != null;
    if (isArchived !== archived) {
      await connection.execute(
        `UPDATE wc_profiles SET archived_at=?,revision=revision+1,updated_at=?
          WHERE workspace_id=? AND id=? AND revision=?`,
        [archived ? new Date() : null, new Date(), WORKSPACE, id, revision]
      );
    }
    const updated = await profileById(id, connection, false);
    if (!updated)
      throw new ProfileError(
        500,
        "PROFILE_OPERATION_FAILED",
        "Profile operation failed."
      );
    return mapProfile(updated);
  });
}

export function registerProfileRoutes(app: Express): void {
  app.get(
    "/api/admin/profiles/ready",
    requirePermission("settings:read"),
    route(async (_req, res) => {
      const items = (await listProfiles(false))
        .filter(isProfileReady)
        .map(readyProfile);
      res.json({
        items,
        defaultProfileId: items.some(p => p.id === DEFAULT_PROFILE_ID)
          ? DEFAULT_PROFILE_ID
          : null,
      });
    })
  );
  app.get(
    "/api/admin/profiles",
    requirePermission("settings:read"),
    route(async (req, res) => {
      const archived = req.query.archived === "all";
      res.json({ items: await listProfiles(archived), catalog: osCatalog });
    })
  );
  app.get(
    "/api/admin/profiles/:id",
    requirePermission("settings:read"),
    route(async (req, res) => {
      const id = assertId(req.params.id);
      const profile = await profileById(id);
      if (!profile)
        throw new ProfileError(404, "PROFILE_NOT_FOUND", "Profile not found.");
      res.json({ profile: mapProfile(profile), catalog: osCatalog });
    })
  );
  app.post(
    "/api/admin/profiles",
    requirePermission("settings:write"),
    route(async (req, res) => {
      const profile = await createProfile(parseInput(req.body));
      await audit(
        String((req as Request & { admin?: { id: string } }).admin?.id),
        "profile.create",
        profile.id,
        { revision: profile.revision }
      );
      res.status(201).json({ profile });
    })
  );
  app.put(
    "/api/admin/profiles/:id",
    requirePermission("settings:write"),
    route(async (req, res) => {
      const id = assertId(req.params.id);
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        throw new ProfileError(
          400,
          "INVALID_REQUEST",
          "Request body is invalid."
        );
      const body = req.body as Record<string, unknown>;
      if (!("revision" in body))
        throw new ProfileError(
          400,
          "INVALID_REVISION",
          "Profile revision is required."
        );
      const revision = assertRevision(body.revision);
      const { revision: _revision, ...inputBody } = body;
      const profile = await updateProfile(id, parseInput(inputBody), revision);
      await audit(
        String((req as Request & { admin?: { id: string } }).admin?.id),
        "profile.update",
        id,
        { revision: profile.revision }
      );
      res.json({ profile });
    })
  );
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    app.post(
      `/api/admin/profiles/:id/${action}`,
      requirePermission("settings:write"),
      route(async (req, res) => {
        const id = assertId(req.params.id);
        const revision = parseRevisionBody(req.body);
        const profile = await setArchived(id, revision, archived);
        await audit(
          String((req as Request & { admin?: { id: string } }).admin?.id),
          `profile.${action}`,
          id,
          { revision: profile.revision }
        );
        res.json({ profile });
      })
    );
  }
}

export { DEFAULT_PROFILE_ID, WORKSPACE };
export default registerProfileRoutes;
