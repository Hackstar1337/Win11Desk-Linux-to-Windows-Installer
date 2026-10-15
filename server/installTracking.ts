import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import type { Express, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  installerTrackingGroups,
  installerTrackingRuns,
} from "../drizzle/schema";
import {
  canAdvanceInstallTrackingStage,
  hasWindowsProfessionalProof,
  hasWindowsReadyProof,
  INSTALL_TRACKING_STAGES,
  INSTALL_TRACKING_TTL_MS,
  type InstallTrackingStage,
} from "../shared/installTracking";
import { getDb } from "./db";
import { getOs, hasOsProof } from "../shared/deploymentProfiles";
import { getRunProfile } from "./control/profiles";
import {
  onRunRegistered,
  onRunEvent,
  onRunHeartbeat,
  isRunPurged,
  assertGroupActive,
} from "./control/admin";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** Allows the usual Linux /dev name or a safe disk identifier, never a path or shell syntax. */
export const SAFE_WHOLE_DISK = /^(?:\/dev\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_EDITION = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const TRACKING_ERROR_STAGES = INSTALL_TRACKING_STAGES.filter(
  stage => stage !== "failed"
) as Exclude<InstallTrackingStage, "failed">[];

export interface TrackingGroupCredentials {
  groupId: string;
  readToken: string;
  writeToken: string;
  expiry: Date;
}

export interface TrackingRunMetadata {
  hostname: string;
  wholeDisk: string;
  rdpPort: number;
  executionId?: string;
  publicIP?: string;
}

export interface TrackingEventUpdate {
  stage: InstallTrackingStage;
  windowsEdition?: string;
  windowsBuild?: number;
  windowsInstallationType?: "Client" | "Server" | "Server Core";
  rdpListening?: boolean;
  eventId?: string;
  errorCode?: string;
  phase?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

export class TrackingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackingValidationError";
  }
}

export class TrackingDatabaseUnavailableError extends Error {
  constructor() {
    super("Tracking database unavailable");
    this.name = "TrackingDatabaseUnavailableError";
  }
}

export class TrackingNotFoundError extends Error {
  constructor() {
    super("Tracking record unavailable");
    this.name = "TrackingNotFoundError";
  }
}

export const isCanonicalTrackingId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export const isCanonicalCapability = (value: unknown): value is string =>
  typeof value === "string" && HEX64.test(value);

export function sha256Capability(value: string): string {
  if (!isCanonicalCapability(value)) {
    throw new TrackingValidationError("Capability must be canonical hex64");
  }
  return createHash("sha256").update(value, "ascii").digest("hex");
}

/** Compare a presented capability to a stored SHA-256 digest without a variable-length compare. */
export function compareCapabilityHash(
  storedHash: unknown,
  presentedCapability: unknown
): boolean {
  if (
    !HEX64.test(String(storedHash ?? "")) ||
    !isCanonicalCapability(presentedCapability)
  ) {
    return false;
  }
  const expected = Buffer.from(String(storedHash), "hex");
  const actual = Buffer.from(sha256Capability(presentedCapability), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isTrackingExpiryValid(
  expiresAt: Date | string | number,
  now: Date | string | number = Date.now()
): boolean {
  const expiryMs = new Date(expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  return (
    Number.isFinite(expiryMs) && Number.isFinite(nowMs) && expiryMs > nowMs
  );
}

export function trackingExpiryFrom(now = Date.now()): Date {
  return new Date(now + INSTALL_TRACKING_TTL_MS);
}

export function validateTrackingGroupId(value: unknown): string {
  if (!isCanonicalTrackingId(value)) {
    throw new TrackingValidationError("Invalid tracking group id");
  }
  return value;
}

export function validateTrackingRunId(value: unknown): string {
  if (!isCanonicalTrackingId(value)) {
    throw new TrackingValidationError("Invalid tracking run id");
  }
  return value;
}

export function validateTrackingCapability(value: unknown): string {
  if (!isCanonicalCapability(value)) {
    throw new TrackingValidationError("Invalid tracking capability");
  }
  return value;
}

export function validateHostname(value: unknown): string {
  if (typeof value !== "string")
    throw new TrackingValidationError("Invalid hostname");
  const hostname = value.trim();
  if (hostname.length < 1 || hostname.length > 253 || hostname.endsWith(".")) {
    throw new TrackingValidationError("Invalid hostname");
  }
  const labels = hostname.split(".");
  if (labels.some(label => label.length > 63 || !SAFE_HOST_LABEL.test(label))) {
    throw new TrackingValidationError("Invalid hostname");
  }
  return hostname;
}

export function validateWholeDisk(value: unknown): string {
  if (typeof value !== "string")
    throw new TrackingValidationError("Invalid whole disk");
  const wholeDisk = value.trim();
  if (!SAFE_WHOLE_DISK.test(wholeDisk)) {
    throw new TrackingValidationError("Invalid whole disk");
  }
  return wholeDisk;
}

export function validateRdpPort(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    throw new TrackingValidationError("Invalid RDP port");
  }
  return value;
}

export function validatePublicIP(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || isIP(value.trim()) === 0) {
    throw new TrackingValidationError("Invalid public IP");
  }
  return value.trim();
}

export function validateTrackingMetadata(input: unknown): TrackingRunMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TrackingValidationError("Invalid run metadata");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "hostname",
    "wholeDisk",
    "disk",
    "rdpPort",
    "publicIP",
    "executionId",
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new TrackingValidationError("Unsupported run metadata");
  }
  if (value.wholeDisk !== undefined && value.disk !== undefined) {
    throw new TrackingValidationError("Specify one whole disk");
  }
  return {
    ...(value.executionId === undefined
      ? {}
      : { executionId: validateTrackingRunId(value.executionId) }),
    hostname: validateHostname(value.hostname),
    wholeDisk: validateWholeDisk(value.wholeDisk ?? value.disk),
    rdpPort: validateRdpPort(value.rdpPort),
    ...(validatePublicIP(value.publicIP) === undefined
      ? {}
      : { publicIP: validatePublicIP(value.publicIP) }),
  };
}

function validateWindowsEdition(value: unknown): string {
  if (typeof value !== "string")
    throw new TrackingValidationError("Invalid Windows edition");
  const edition = value.trim();
  if (!SAFE_EDITION.test(edition))
    throw new TrackingValidationError("Invalid Windows edition");
  return edition;
}

function validateWindowsBuild(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    throw new TrackingValidationError("Invalid Windows build");
  }
  return value;
}

export function validateTrackingEvent(input: unknown): TrackingEventUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TrackingValidationError("Invalid tracking event");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "stage",
    "windowsEdition",
    "windowsBuild",
    "windowsInstallationType",
    "rdpListening",
    "eventId",
    "errorCode",
    "phase",
    "downloadedBytes",
    "totalBytes",
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new TrackingValidationError("Unsupported tracking event");
  }
  if (
    typeof value.stage !== "string" ||
    !INSTALL_TRACKING_STAGES.includes(value.stage as InstallTrackingStage)
  ) {
    throw new TrackingValidationError("Invalid tracking stage");
  }
  const result: TrackingEventUpdate = {
    stage: value.stage as InstallTrackingStage,
  };
  if (value.windowsEdition !== undefined)
    result.windowsEdition = validateWindowsEdition(value.windowsEdition);
  if (value.windowsBuild !== undefined)
    result.windowsBuild = validateWindowsBuild(value.windowsBuild);
  if (value.windowsInstallationType !== undefined) {
    if (
      value.windowsInstallationType !== "Client" &&
      value.windowsInstallationType !== "Server" &&
      value.windowsInstallationType !== "Server Core"
    )
      throw new TrackingValidationError("Invalid Windows installation type");
    result.windowsInstallationType = value.windowsInstallationType;
  }
  if (value.rdpListening !== undefined) {
    if (typeof value.rdpListening !== "boolean")
      throw new TrackingValidationError("Invalid RDP listener state");
    result.rdpListening = value.rdpListening;
  }
  if (value.eventId !== undefined)
    result.eventId = validateTrackingRunId(value.eventId);
  for (const key of ["errorCode", "phase"] as const) {
    if (value[key] !== undefined) {
      if (
        typeof value[key] !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(value[key] as string)
      )
        throw new TrackingValidationError("Invalid event code");
      result[key] = value[key] as string;
    }
  }
  for (const key of ["downloadedBytes", "totalBytes"] as const) {
    if (value[key] !== undefined) {
      if (
        typeof value[key] !== "number" ||
        !Number.isSafeInteger(value[key]) ||
        (value[key] as number) < 0
      )
        throw new TrackingValidationError("Invalid byte counter");
      result[key] = value[key] as number;
    }
  }
  if (
    result.downloadedBytes !== undefined &&
    result.totalBytes !== undefined &&
    result.downloadedBytes > result.totalBytes
  )
    throw new TrackingValidationError("Counter exceeds total");
  return result;
}

function randomCapability(): string {
  return randomBytes(32).toString("hex");
}

function assertDatabase<T>(db: T | null | undefined): T {
  if (!db) throw new TrackingDatabaseUnavailableError();
  return db;
}

function assertNotExpired(expiresAt: Date): void {
  if (!isTrackingExpiryValid(expiresAt)) throw new TrackingNotFoundError();
}

async function findGroupWithCapability(
  db: any,
  groupId: string,
  capability: string,
  lock = false
) {
  const query = db
    .select()
    .from(installerTrackingGroups)
    .where(eq(installerTrackingGroups.id, groupId))
    .limit(1);
  const rows =
    lock && typeof query.for === "function"
      ? await query.for("update")
      : await query;
  const group = rows[0];
  if (!group || !compareCapabilityHash(group.writeTokenHash, capability)) {
    throw new TrackingNotFoundError();
  }
  assertNotExpired(group.expiresAt);
  return group;
}

export async function createTrackingGroup(connection?: {
  execute(sql: string, params: unknown[]): Promise<unknown>;
}): Promise<TrackingGroupCredentials> {
  const groupId = randomUUID();
  const readToken = randomCapability();
  const writeToken = randomCapability();
  const expiry = trackingExpiryFrom();
  if (connection) {
    await connection.execute(
      "INSERT INTO installerTrackingGroups(id,readTokenHash,writeTokenHash,expiresAt) VALUES(?,?,?,?)",
      [
        groupId,
        sha256Capability(readToken),
        sha256Capability(writeToken),
        expiry,
      ]
    );
  } else {
    const db = assertDatabase(await getDb());
    await db
      .insert(installerTrackingGroups)
      .values({
        id: groupId,
        readTokenHash: sha256Capability(readToken),
        writeTokenHash: sha256Capability(writeToken),
        expiresAt: expiry,
      });
  }
  return { groupId, readToken, writeToken, expiry };
}

export async function registerTrackingRun(
  groupIdInput: string,
  writeCapabilityInput: string,
  metadataInput: unknown
): Promise<{ runId: string; reportToken: string }> {
  const groupId = validateTrackingGroupId(groupIdInput);
  const writeCapability = validateTrackingCapability(writeCapabilityInput);
  const metadata = validateTrackingMetadata(metadataInput);
  const db = assertDatabase(await getDb());
  await assertGroupActive(groupId);
  const hash = metadata.executionId
    ? createHash("sha256")
        .update(groupId + metadata.executionId)
        .digest("hex")
        .slice(0, 32)
    : null;
  const runId = hash
    ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
    : randomUUID();
  const reportToken = metadata.executionId
    ? createHash("sha256")
        .update(writeCapability + metadata.executionId + "report-v2")
        .digest("hex")
    : randomCapability();
  const result = await db.transaction(async (tx: any) => {
    const group = await findGroupWithCapability(
      tx,
      groupId,
      writeCapability,
      true
    );
    const existing = await tx
      .select()
      .from(installerTrackingRuns)
      .where(eq(installerTrackingRuns.id, runId))
      .limit(1);
    if (existing.length) {
      if (!compareCapabilityHash(existing[0].reportTokenHash, reportToken))
        throw new TrackingNotFoundError();
      return { runId, reportToken };
    }
    const now = new Date();
    await tx.insert(installerTrackingRuns).values({
      id: runId,
      groupId,
      reportTokenHash: sha256Capability(reportToken),
      hostname: metadata.hostname,
      wholeDisk: metadata.wholeDisk,
      rdpPort: metadata.rdpPort,
      publicIP: metadata.publicIP,
      stage: "starting",
      sequence: 0,
      expiresAt: group.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return { runId, reportToken };
  });
  await onRunRegistered(runId, groupId, metadata);
  return result;
}

export async function recordTrackingEvent(
  runIdInput: string,
  reportCapabilityInput: string,
  eventInput: unknown
): Promise<void> {
  const runId = validateTrackingRunId(runIdInput);
  const reportCapability = validateTrackingCapability(reportCapabilityInput);
  const event = validateTrackingEvent(eventInput);
  // Filled only after the report capability is authenticated below; null preserves legacy runs.
  let profile: Awaited<ReturnType<typeof getRunProfile>> = null;
  event.eventId =
    event.eventId ||
    createHash("sha256").update(JSON.stringify(event)).digest("hex");
  if (await isRunPurged(runId)) throw new TrackingNotFoundError();
  const db = assertDatabase(await getDb());
  await db.transaction(async (tx: any) => {
    const rows = await tx
      .select()
      .from(installerTrackingRuns)
      .where(eq(installerTrackingRuns.id, runId))
      .limit(1)
      .for("update");
    const run = rows[0];
    if (!run || !compareCapabilityHash(run.reportTokenHash, reportCapability)) {
      throw new TrackingNotFoundError();
    }
    profile = await getRunProfile(runId);
    assertNotExpired(run.expiresAt);
    const currentStage = run.stage as InstallTrackingStage;
    if (currentStage === "windows_ready" || currentStage === "failed") {
      if (event.stage === currentStage) return;
      throw new TrackingValidationError("Terminal result cannot change.");
    }
    if (
      !INSTALL_TRACKING_STAGES.includes(currentStage) ||
      !canAdvanceInstallTrackingStage(currentStage, event.stage)
    ) {
      throw new TrackingValidationError(
        "Tracking stage cannot move backwards or after failure"
      );
    }
    const edition = profile
      ? event.windowsEdition
      : (event.windowsEdition ?? run.windowsEdition ?? undefined);
    const build = profile
      ? event.windowsBuild
      : (event.windowsBuild ?? run.windowsBuild ?? undefined);
    const installationType = profile
      ? event.windowsInstallationType
      : undefined;
    const listener = profile
      ? event.rdpListening
      : (event.rdpListening ?? run.rdpListening ?? undefined);
    const proof = profile
      ? hasOsProof(getOs(profile.osId), edition, build, installationType)
      : hasWindowsProfessionalProof(edition, build);
    if (event.stage === "windows_booted" && !proof) {
      throw new TrackingValidationError(
        profile
          ? "Selected OS boot proof requires the selected edition, supported build, and installation type"
          : "Windows boot proof requires Professional and build 22000+"
      );
    }
    if (event.stage === "windows_ready" && (!proof || listener !== true)) {
      throw new TrackingValidationError(
        profile
          ? "Selected OS ready proof requires the selected edition, supported build, installation type, and a local RDP listener"
          : "Windows ready proof requires Professional build 22000+ and a local RDP listener"
      );
    }
    const errorStage =
      event.stage === "failed"
        ? (currentStage as string) === "failed"
          ? null
          : TRACKING_ERROR_STAGES.includes(
                currentStage as Exclude<InstallTrackingStage, "failed">
              )
            ? currentStage
            : null
        : undefined;
    await tx
      .update(installerTrackingRuns)
      .set({
        stage: event.stage,
        sequence: Number(run.sequence) + 1,
        ...(event.windowsEdition !== undefined
          ? { windowsEdition: event.windowsEdition }
          : {}),
        ...(event.windowsBuild !== undefined
          ? { windowsBuild: event.windowsBuild }
          : {}),
        ...(event.rdpListening !== undefined
          ? { rdpListening: event.rdpListening }
          : {}),
        ...(event.stage === "failed" ? { errorStage } : {}),
        updatedAt: new Date(),
      })
      .where(eq(installerTrackingRuns.id, runId));
  });
  const recorded = (
    await db
      .select({ sequence: installerTrackingRuns.sequence })
      .from(installerTrackingRuns)
      .where(eq(installerTrackingRuns.id, runId))
      .limit(1)
  )[0];
  await onRunEvent(runId, {
    ...event,
    sequence: Number(recorded?.sequence || 0),
  });
}

export async function getTrackingGroup(
  groupIdInput: string,
  readCapabilityInput: string
) {
  const groupId = validateTrackingGroupId(groupIdInput);
  const readCapability = validateTrackingCapability(readCapabilityInput);
  const db = assertDatabase(await getDb());
  const groups = await db
    .select({
      id: installerTrackingGroups.id,
      createdAt: installerTrackingGroups.createdAt,
      expiresAt: installerTrackingGroups.expiresAt,
      readTokenHash: installerTrackingGroups.readTokenHash,
    })
    .from(installerTrackingGroups)
    .where(eq(installerTrackingGroups.id, groupId))
    .limit(1);
  const group = groups[0];
  if (!group || !compareCapabilityHash(group.readTokenHash, readCapability)) {
    throw new TrackingNotFoundError();
  }
  assertNotExpired(group.expiresAt);
  const runs = await db
    .select({
      runId: installerTrackingRuns.id,
      createdAt: installerTrackingRuns.createdAt,
      expiresAt: installerTrackingRuns.expiresAt,
      updatedAt: installerTrackingRuns.updatedAt,
      hostname: installerTrackingRuns.hostname,
      wholeDisk: installerTrackingRuns.wholeDisk,
      rdpPort: installerTrackingRuns.rdpPort,
      publicIP: installerTrackingRuns.publicIP,
      windowsEdition: installerTrackingRuns.windowsEdition,
      windowsBuild: installerTrackingRuns.windowsBuild,
      rdpListening: installerTrackingRuns.rdpListening,
      stage: installerTrackingRuns.stage,
      sequence: installerTrackingRuns.sequence,
      errorStage: installerTrackingRuns.errorStage,
    })
    .from(installerTrackingRuns)
    .where(
      and(
        eq(installerTrackingRuns.groupId, groupId),
        gt(installerTrackingRuns.expiresAt, new Date())
      )
    );
  const progressRows = runs.length
    ? await import("./control/db").then(({ rows }) =>
        rows<any>(
          `SELECT run_id,phase,downloaded_bytes,total_bytes,started_at,finished_at FROM wc_run_meta WHERE purged_at IS NULL AND run_id IN (${runs.map(() => "?").join(",")})`,
          runs.map(run => run.runId)
        )
      )
    : [];
  const progressByRun = new Map(progressRows.map(row => [row.run_id, row]));
  return {
    groupId: group.id,
    createdAt: group.createdAt,
    expiresAt: group.expiresAt,
    runs: runs.map(run => {
      const progress = progressByRun.get(run.runId);
      return {
        ...run,
        phase: progress?.phase ?? null,
        downloadedBytes:
          progress?.downloaded_bytes == null
            ? null
            : Number(progress.downloaded_bytes),
        totalBytes:
          progress?.total_bytes == null ? null : Number(progress.total_bytes),
        startedAt: progress?.started_at ?? run.createdAt,
        finishedAt: progress?.finished_at ?? null,
      };
    }),
  };
}

/** A heartbeat proves only that the reporting process is alive; it never advances installation stage. */
export async function recordTrackingHeartbeat(
  runIdInput: string,
  capabilityInput: string
): Promise<void> {
  const runId = validateTrackingRunId(runIdInput);
  const capability = validateTrackingCapability(capabilityInput);
  if (await isRunPurged(runId)) throw new TrackingNotFoundError();
  const db = assertDatabase(await getDb());
  await db.transaction(async tx => {
    const [run] = await tx
      .select()
      .from(installerTrackingRuns)
      .where(eq(installerTrackingRuns.id, runId))
      .limit(1)
      .for("update");
    if (!run || !compareCapabilityHash(run.reportTokenHash, capability))
      throw new TrackingNotFoundError();
    assertNotExpired(run.expiresAt);
    if (run.stage === "failed" || run.stage === "windows_ready") return;
    await tx
      .update(installerTrackingRuns)
      .set({ updatedAt: new Date() })
      .where(eq(installerTrackingRuns.id, runId));
  });
  await onRunHeartbeat(runId);
}

function setTrackingHeaders(res: Response): void {
  res.set({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function bearer(req: Request): string | null {
  const header = req.get("Authorization") ?? "";
  if (!/^Bearer [0-9a-f]{64}$/.test(header)) return null;
  return header.slice(7);
}

function sendTrackingError(res: Response, error: unknown): void {
  if (error instanceof TrackingDatabaseUnavailableError) {
    res.status(503).json({ error: "Tracking database unavailable." });
  } else if (error instanceof TrackingValidationError) {
    res.status(400).json({ error: error.message });
  } else if (error instanceof TrackingNotFoundError) {
    res.status(404).json({ error: "Tracking record unavailable." });
  } else {
    res.status(500).json({ error: "Tracking operation failed." });
  }
}

export function registerTrackingRoutes(app: Express): void {
  app.post(
    "/api/installer/tracking/runs/:runId/heartbeat",
    async (req, res) => {
      setTrackingHeaders(res);
      const capability = bearer(req);
      if (!capability) {
        res.status(401).json({ error: "Report capability required." });
        return;
      }
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length
      ) {
        res
          .status(400)
          .json({ error: "Heartbeat body must be empty JSON object." });
        return;
      }
      try {
        await recordTrackingHeartbeat(req.params.runId, capability);
        res.status(204).end();
      } catch (error) {
        sendTrackingError(res, error);
      }
    }
  );
  app.post("/api/installer/tracking/:groupId/runs", async (req, res) => {
    setTrackingHeaders(res);
    const capability = bearer(req);
    if (!capability) {
      res.status(401).json({ error: "Write capability required." });
      return;
    }
    try {
      const result = await registerTrackingRun(
        req.params.groupId,
        capability,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      sendTrackingError(res, error);
    }
  });

  app.post("/api/installer/tracking/runs/:runId/events", async (req, res) => {
    setTrackingHeaders(res);
    const capability = bearer(req);
    if (!capability) {
      res.status(401).json({ error: "Report capability required." });
      return;
    }
    try {
      await recordTrackingEvent(req.params.runId, capability, req.body);
      res.status(204).end();
    } catch (error) {
      sendTrackingError(res, error);
    }
  });

  app.get("/api/installer/tracking/:groupId", async (req, res) => {
    setTrackingHeaders(res);
    const capability = bearer(req);
    if (!capability) {
      res.status(401).json({ error: "Read capability required." });
      return;
    }
    try {
      const group = await getTrackingGroup(req.params.groupId, capability);
      res.json(group);
    } catch (error) {
      sendTrackingError(res, error);
    }
  });
}
