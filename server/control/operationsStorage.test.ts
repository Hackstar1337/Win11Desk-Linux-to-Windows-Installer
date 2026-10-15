import { describe, expect, it } from "vitest";
import {
  createOperationsStorageReader,
  measureDatabaseAllocation,
  measureFilesystem,
} from "./operationsStorage";

const sampledAt = "2026-01-02T03:04:05.000Z";

describe("operations storage measurements", () => {
  it("returns an independent unavailable state when an injected measurement fails", async () => {
    const read = createOperationsStorageReader({
      statfs: async () => {
        throw new Error("private filesystem detail");
      },
      databaseAllocation: async () => {
        throw new Error("private database detail");
      },
      ciphertextSubset: async () => {
        throw new Error("private ciphertext detail");
      },
      now: () => new Date(sampledAt),
    });

    const result = await read();
    expect(result.sampledAt).toBe(sampledAt);
    expect(result.filesystem.state).toBe("unavailable");
    expect(result.database.state).toBe("unavailable");
    expect(result.ciphertextSubset.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.filesystem.sampledAt).toBeNull();
  });

  it("uses f_bfree for used space while f_bavail reports service-available space", () => {
    const result = measureFilesystem(
      { f_bsize: 4096, f_blocks: 100, f_bfree: 20, f_bavail: 10 },
      sampledAt
    );
    expect(result).toMatchObject({
      state: "available",
      scope: "shared-filesystem",
      totalBytes: 409_600,
      usedBytes: 327_680,
      availableBytes: 40_960,
      usedPercent: 80,
      sampledAt,
    });
  });

  it("keeps successful measurements when only one source is unavailable", async () => {
    const read = createOperationsStorageReader({
      statfs: async () => ({
        f_bsize: 1,
        f_blocks: 10,
        f_bfree: 5,
        f_bavail: 5,
      }),
      databaseAllocation: async () => {
        throw new Error("database unavailable");
      },
      ciphertextSubset: async () => ({
        artifact_bytes: 2,
        credential_bytes: 3,
      }),
      now: () => new Date(sampledAt),
    });
    const result = await read();
    expect(result.filesystem.state).toBe("available");
    expect(result.database.state).toBe("unavailable");
    expect(result.ciphertextSubset.state).toBe("available");
  });

  it("marks nonfinite filesystem and database values unavailable", () => {
    expect(
      measureFilesystem(
        {
          f_bsize: 4096,
          f_blocks: Number.POSITIVE_INFINITY,
          f_bfree: 1,
          f_bavail: 1,
        },
        sampledAt
      ).state
    ).toBe("unavailable");
    expect(
      measureDatabaseAllocation(
        { data_bytes: "NaN", index_bytes: 2 },
        sampledAt
      )
    ).toMatchObject({
      state: "unavailable",
      sampledAt: null,
      allocatedBytes: null,
    });
  });

  it("labels filesystem results as shared rather than app-only", async () => {
    const read = createOperationsStorageReader({
      statfs: async () => ({
        f_bsize: 1,
        f_blocks: 100,
        f_bfree: 50,
        f_bavail: 40,
      }),
      databaseAllocation: async () => ({ data_bytes: 10, index_bytes: 5 }),
      ciphertextSubset: async () => ({
        artifact_bytes: 2,
        credential_bytes: 3,
      }),
      now: () => new Date(sampledAt),
    });
    const result = await read();
    expect(result.filesystem.scope).toBe("shared-filesystem");
    expect(result.filesystem.sampledAt).toBe(result.database.sampledAt);
    expect(result.database.sampledAt).toBe(result.ciphertextSubset.sampledAt);
  });

  it("caches a snapshot for ten seconds by default", async () => {
    let calls = 0;
    const read = createOperationsStorageReader({
      statfs: async () => {
        calls++;
        return { f_bsize: 1, f_blocks: 10, f_bfree: 5, f_bavail: 5 };
      },
      databaseAllocation: async () => ({ data_bytes: 1, index_bytes: 1 }),
      ciphertextSubset: async () => ({
        artifact_bytes: 1,
        credential_bytes: 1,
      }),
      now: () => new Date(sampledAt),
    });
    await read();
    await read();
    expect(calls).toBe(1);
  });
});
