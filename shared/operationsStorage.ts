export type StorageMeasurementState = "available" | "unavailable";

export interface FilesystemStorageMeasurement {
  state: StorageMeasurementState;
  scope: "shared-filesystem";
  sampledAt: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  reason?: "unavailable";
}

export interface DatabaseStorageMeasurement {
  state: StorageMeasurementState;
  scope: "table-allocation-metadata";
  sampledAt: string | null;
  dataBytes: number | null;
  indexBytes: number | null;
  allocatedBytes: number | null;
  reason?: "unavailable";
}

export interface CiphertextStorageMeasurement {
  state: StorageMeasurementState;
  scope: "logical-ciphertext-subset";
  sampledAt: string | null;
  bytes: number | null;
  reason?: "unavailable";
}

export interface OperationsStorage {
  /** Time at which this bounded snapshot was attempted; never a sentinel zero. */
  sampledAt: string;
  filesystem: FilesystemStorageMeasurement;
  database: DatabaseStorageMeasurement;
  ciphertextSubset: CiphertextStorageMeasurement;
}
