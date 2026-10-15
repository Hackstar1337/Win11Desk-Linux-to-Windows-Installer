import { statfs as defaultStatfs } from "node:fs/promises";
import type { Express, Request, Response } from "express";
import type {
  CiphertextStorageMeasurement,
  DatabaseStorageMeasurement,
  FilesystemStorageMeasurement,
  OperationsStorage,
} from "../../shared/operationsStorage";
import { requirePermission } from "./auth";
import { rows } from "./db";

const CACHE_MS = 10_000;
const GENERIC_UNAVAILABLE = "unavailable" as const;

type StatFsValue = number | bigint;
export interface StatFsLike {
  /** Node exposes bsize/blocks/bfree/bavail; f_* aliases keep tests explicit. */
  bsize?: StatFsValue;
  blocks?: StatFsValue;
  bfree?: StatFsValue;
  bavail?: StatFsValue;
  f_bsize?: StatFsValue;
  f_blocks?: StatFsValue;
  f_bfree?: StatFsValue;
  f_bavail?: StatFsValue;
}

export interface DatabaseAllocationRow {
  data_bytes?: unknown;
  index_bytes?: unknown;
  total_bytes?: unknown;
}

export interface CiphertextSubsetRow {
  artifact_bytes?: unknown;
  credential_bytes?: unknown;
}

export interface OperationsStorageDependencies {
  statfs?: () => Promise<StatFsLike>;
  databaseAllocation?: () => Promise<DatabaseAllocationRow>;
  ciphertextSubset?: () => Promise<CiphertextSubsetRow>;
  now?: () => Date;
  cacheMs?: number;
}

function finiteNonnegative(value: unknown): number | null {
  const number =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sampleTimestamp(now: () => Date): string {
  const date = now();
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString();
}

function unavailableFilesystem(): FilesystemStorageMeasurement {
  return {
    state: "unavailable",
    scope: "shared-filesystem",
    sampledAt: null,
    totalBytes: null,
    usedBytes: null,
    availableBytes: null,
    usedPercent: null,
    reason: GENERIC_UNAVAILABLE,
  };
}

function unavailableDatabase(): DatabaseStorageMeasurement {
  return {
    state: "unavailable",
    scope: "table-allocation-metadata",
    sampledAt: null,
    dataBytes: null,
    indexBytes: null,
    allocatedBytes: null,
    reason: GENERIC_UNAVAILABLE,
  };
}

function unavailableCiphertext(): CiphertextStorageMeasurement {
  return {
    state: "unavailable",
    scope: "logical-ciphertext-subset",
    sampledAt: null,
    bytes: null,
    reason: GENERIC_UNAVAILABLE,
  };
}

/** Convert an injected statfs result without exposing the server path. */
export function measureFilesystem(
  stats: StatFsLike,
  sampledAt: string
): FilesystemStorageMeasurement {
  const blockSize = finiteNonnegative(stats.f_bsize ?? stats.bsize);
  const blocks = finiteNonnegative(stats.f_blocks ?? stats.blocks);
  const freeBlocks = finiteNonnegative(stats.f_bfree ?? stats.bfree);
  const availableBlocks = finiteNonnegative(stats.f_bavail ?? stats.bavail);
  if (
    blockSize === null ||
    blocks === null ||
    freeBlocks === null ||
    availableBlocks === null
  )
    return unavailableFilesystem();

  const totalBytes = blockSize * blocks;
  const freeBytes = blockSize * freeBlocks;
  const serviceAvailableBytes = blockSize * availableBlocks;
  if (
    ![totalBytes, freeBytes, serviceAvailableBytes].every(Number.isFinite) ||
    totalBytes <= 0
  )
    return unavailableFilesystem();

  // f_bfree includes blocks reserved for the filesystem; f_bavail excludes
  // those blocks and represents space available to this service account.
  const boundedFreeBytes = Math.min(totalBytes, Math.max(0, freeBytes));
  const availableBytes = Math.min(
    totalBytes,
    Math.max(0, serviceAvailableBytes)
  );
  const usedBytes = Math.min(
    totalBytes,
    Math.max(0, totalBytes - boundedFreeBytes)
  );
  const usedPercent = Math.min(
    100,
    Math.max(0, (usedBytes / totalBytes) * 100)
  );
  if (![usedBytes, availableBytes, usedPercent].every(Number.isFinite))
    return unavailableFilesystem();

  return {
    state: "available",
    scope: "shared-filesystem",
    sampledAt,
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent,
  };
}

export function measureDatabaseAllocation(
  row: DatabaseAllocationRow,
  sampledAt: string
): DatabaseStorageMeasurement {
  const dataBytes = finiteNonnegative(row.data_bytes);
  const indexBytes = finiteNonnegative(row.index_bytes);
  const computedTotal =
    dataBytes === null || indexBytes === null ? null : dataBytes + indexBytes;
  const reportedTotal =
    row.total_bytes === undefined
      ? computedTotal
      : finiteNonnegative(row.total_bytes);
  const allocatedBytes =
    computedTotal !== null && reportedTotal === computedTotal
      ? reportedTotal
      : null;
  if (
    dataBytes === null ||
    indexBytes === null ||
    allocatedBytes === null ||
    !Number.isFinite(allocatedBytes)
  )
    return unavailableDatabase();
  return {
    state: "available",
    scope: "table-allocation-metadata",
    sampledAt,
    dataBytes,
    indexBytes,
    allocatedBytes,
  };
}

export function measureCiphertextSubset(
  row: CiphertextSubsetRow,
  sampledAt: string
): CiphertextStorageMeasurement {
  const artifactBytes = finiteNonnegative(row.artifact_bytes);
  const credentialBytes = finiteNonnegative(row.credential_bytes);
  const bytes =
    artifactBytes === null || credentialBytes === null
      ? null
      : artifactBytes + credentialBytes;
  if (bytes === null || !Number.isFinite(bytes)) return unavailableCiphertext();
  return {
    state: "available",
    scope: "logical-ciphertext-subset",
    sampledAt,
    bytes,
  };
}

async function defaultDatabaseAllocation(): Promise<DatabaseAllocationRow> {
  const result = await rows<DatabaseAllocationRow>(
    `SELECT COALESCE(SUM(data_length), 0) AS data_bytes,
            COALESCE(SUM(index_length), 0) AS index_bytes,
            COALESCE(SUM(data_length + index_length), 0) AS total_bytes
       FROM information_schema.tables
      WHERE table_schema = DATABASE()`
  );
  return result[0] ?? {};
}

async function defaultCiphertextSubset(): Promise<CiphertextSubsetRow> {
  const result = await rows<CiphertextSubsetRow>(
    `SELECT COALESCE(SUM(OCTET_LENGTH(artifact_ciphertext)), 0) AS artifact_bytes,
            COALESCE(SUM(OCTET_LENGTH(credential_ciphertext)), 0) AS credential_bytes
       FROM wc_commands`
  );
  return result[0] ?? {};
}

export function createOperationsStorageReader(
  dependencies: OperationsStorageDependencies = {}
): () => Promise<OperationsStorage> {
  const readStatfs =
    dependencies.statfs ??
    (async (): Promise<StatFsLike> => {
      const stats = await defaultStatfs(process.cwd(), { bigint: true });
      return {
        bsize: stats.bsize,
        blocks: stats.blocks,
        bfree: stats.bfree,
        bavail: stats.bavail,
      };
    });
  const readDatabaseAllocation =
    dependencies.databaseAllocation ?? defaultDatabaseAllocation;
  const readCiphertextSubset =
    dependencies.ciphertextSubset ?? defaultCiphertextSubset;
  const now = dependencies.now ?? (() => new Date());
  const cacheMs = dependencies.cacheMs ?? CACHE_MS;
  let cached: { expiresAt: number; value: OperationsStorage } | undefined;
  let pending: Promise<OperationsStorage> | undefined;

  return async function readOperationsStorage(): Promise<OperationsStorage> {
    const currentMs = Date.now();
    if (cached && currentMs < cached.expiresAt) return cached.value;
    if (pending) return pending;

    const sampledAt = sampleTimestamp(now);
    pending = Promise.allSettled([
      readStatfs(),
      readDatabaseAllocation(),
      readCiphertextSubset(),
    ])
      .then(([filesystemResult, databaseResult, ciphertextResult]) => ({
        sampledAt,
        filesystem:
          filesystemResult.status === "fulfilled"
            ? measureFilesystem(filesystemResult.value, sampledAt)
            : unavailableFilesystem(),
        database:
          databaseResult.status === "fulfilled"
            ? measureDatabaseAllocation(databaseResult.value, sampledAt)
            : unavailableDatabase(),
        ciphertextSubset:
          ciphertextResult.status === "fulfilled"
            ? measureCiphertextSubset(ciphertextResult.value, sampledAt)
            : unavailableCiphertext(),
      }))
      .then(value => {
        cached = { expiresAt: Date.now() + Math.max(0, cacheMs), value };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

const readOperationsStorage = createOperationsStorageReader();

export async function operationsStorageHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const value = await readOperationsStorage();
  res.set("Cache-Control", "private, no-store").json(value);
}

export function registerOperationsStorageRoutes(app: Express): void {
  app.get(
    "/api/admin/operations/storage",
    requirePermission("settings:read"),
    (req, res, next) => {
      void operationsStorageHandler(req, res).catch(() =>
        next(new Error("operations storage unavailable"))
      );
    }
  );
}

export { CACHE_MS };
export default registerOperationsStorageRoutes;
