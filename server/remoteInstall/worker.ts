import { failedReceiptOutcome } from "./reconciliation";
import { config } from "../control/config.js";
import { randomUUID } from "node:crypto";
import { decrypt } from "../control/crypto.js";
import { rows, exec } from "../control/db.js";
import { issueRemoteCommand } from "../control/admin.js";
import type {
  RemoteReceipt,
  RemoteTarget,
  RemoteSettings,
  TargetInventory,
} from "@shared/remoteInstall";
import {
  connectTarget,
  type TargetSession,
  RemoteSshError,
} from "./sshClient.js";
import {
  remoteQueue,
  queueHealth,
  WORKSPACE,
  type QueueJobRow,
  LEASE_MS,
} from "./queue.js";

export type WorkerDependencies = {
  queue?: typeof remoteQueue;
  connect?: typeof connectTarget;
  issue?: typeof issueRemoteCommand;
  now?: () => Date;
  workerId?: string;
  isActorActive?: (ownerId: string) => Promise<boolean>;
  recordHeartbeat?: (workerId: string, now: Date) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};
export type WorkerOptions = WorkerDependencies & {
  once?: boolean;
  signal?: AbortSignal;
  pollMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function parsed<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      /* never expose malformed data */
    }
  }
  return fallback;
}
function errorCode(error: unknown): string {
  if (error instanceof RemoteSshError) return error.code;
  const value =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : null;
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "WORKER_FAILED";
}
function mismatch(
  expected: TargetInventory,
  actual: TargetInventory
): string | null {
  if (expected.hostname !== actual.hostname) return "HOSTNAME_MISMATCH";
  if (expected.disk !== actual.disk || expected.diskBytes !== actual.diskBytes)
    return "DISK_MISMATCH";
  if (expected.diskSerial && expected.diskSerial !== actual.diskSerial)
    return "DISK_SERIAL_MISMATCH";
  if (
    expected.architecture !== actual.architecture ||
    expected.root !== actual.root ||
    expected.runner !== actual.runner ||
    !actual.httpsReachable
  )
    return "PREFLIGHT_CHANGED";
  return null;
}
function envelope(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
async function activeOwner(ownerId: string): Promise<boolean> {
  const found = await rows<{ role: string; active: number }>(
    "SELECT role,active FROM wc_accounts WHERE id=? LIMIT 1",
    [ownerId]
  );
  return (
    !!found[0] &&
    Number(found[0].active) === 1 &&
    (found[0].role === "owner" || found[0].role === "admin")
  );
}
async function heartbeat(workerId: string, now: Date): Promise<void> {
  const h = await queueHealth();
  await exec(
    `INSERT INTO wc_remote_worker_heartbeat(worker_id,workspace_id,heartbeat_at,queue_depth,oldest_queued_at,updated_at)
    VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE heartbeat_at=VALUES(heartbeat_at),queue_depth=VALUES(queue_depth),oldest_queued_at=VALUES(oldest_queued_at),updated_at=VALUES(updated_at)`,
    [
      workerId,
      WORKSPACE,
      now,
      h.queued,
      h.oldestQueuedAt ? new Date(h.oldestQueuedAt) : null,
      now,
    ]
  );
}

export class RemoteWorker {
  private readonly queue: typeof remoteQueue;
  private readonly connect: typeof connectTarget;
  private readonly issue: typeof issueRemoteCommand;
  private readonly now: () => Date;
  readonly workerId: string;
  private readonly isActorActive: typeof activeOwner;
  private readonly recordHeartbeat: typeof heartbeat;
  private readonly pause: (ms: number) => Promise<void>;
  constructor(deps: WorkerDependencies = {}) {
    this.isActorActive = deps.isActorActive || activeOwner;
    this.recordHeartbeat = deps.recordHeartbeat || heartbeat;
    this.queue = deps.queue || remoteQueue;
    this.connect = deps.connect || connectTarget;
    this.issue = deps.issue || issueRemoteCommand;
    this.now = deps.now || (() => new Date());
    this.workerId =
      deps.workerId || `remote-worker:${process.pid}:${randomUUID()}`;
    this.pause = deps.sleep || sleep;
  }
  async tick(): Promise<boolean> {
    const now = this.now();
    await this.recordHeartbeat(this.workerId, now);
    await this.queue.recoverStale(now);
    const row = await this.queue.claim(this.workerId, now);
    if (!row) return false;
    const loaded = await this.queue.raw(row.id);
    await this.process(loaded || row);
    return true;
  }
  private async process(row: QueueJobRow): Promise<void> {
    const id = row.id;
    let session: TargetSession | null = null;
    let intent = false;
    const beat = setInterval(
      () => {
        void this.queue
          .heartbeat(this.workerId, id, this.now())
          .catch(() => undefined);
      },
      Math.max(5_000, Math.floor(LEASE_MS / 3))
    );
    try {
      if (!(await this.isActorActive(row.owner_id))) {
        await this.queue.setState(
          id,
          "blocked",
          "ACTOR_INACTIVE",
          this.workerId
        );
        await this.queue.clearSecrets(id, this.now());
        return;
      }
      const target = parsed<RemoteTarget>(row.target_json, {
        host: row.target_host,
        port: Number(row.target_port),
        username: "root",
      });
      const expected = parsed<TargetInventory>(
        row.expected_inventory_json,
        {} as TargetInventory
      );
      if (
        !row.settings_secret_id ||
        !row.ssh_secret_id ||
        !row.settings_ciphertext ||
        !row.ssh_ciphertext
      ) {
        await this.queue.setState(
          id,
          "blocked",
          "SECRET_UNAVAILABLE",
          this.workerId
        );
        await this.queue.clearSecrets(id, this.now());
        return;
      }
      const settings = JSON.parse(
        decrypt(
          envelope(row.settings_ciphertext),
          `remote:settings:${row.settings_secret_id}`
        )
      ) as RemoteSettings;
      if (
        !settings ||
        typeof settings.profileId !== "string" ||
        !Number.isSafeInteger(settings.profileRevision)
      ) {
        await this.queue.setState(
          id,
          "blocked",
          "PROFILE_SNAPSHOT_INVALID",
          this.workerId
        );
        await this.queue.clearSecrets(id, this.now());
        return;
      }
      session = await this.connect(
        target,
        decrypt(
          envelope(row.ssh_ciphertext),
          `remote:ssh:${row.ssh_secret_id}`
        ),
        row.fingerprint
      );
      if (!(await this.queue.setState(id, "checking", null, this.workerId)))
        throw new RemoteSshError("LAUNCH_UNCERTAIN");
      const actual = await session.preflight(config().publicUrl);
      const difference = mismatch(expected, actual);
      if (difference) {
        await this.queue.setState(id, "blocked", difference, this.workerId);
        await this.queue.clearSecrets(id, this.now());
        return;
      }
      if (!(await this.queue.setState(id, "sending", null, this.workerId)))
        throw new RemoteSshError("LAUNCH_UNCERTAIN");
      const issuance = await this.issue(row.owner_id, settings, expected, id);
      if (
        row.command_id &&
        row.group_id &&
        (issuance.commandId !== row.command_id ||
          issuance.groupId !== row.group_id)
      ) {
        await this.queue.setState(
          id,
          "launch_uncertain",
          "ISSUANCE_CHANGED",
          this.workerId
        );
        return;
      }
      if (!row.command_id) {
        const saved = await this.queue.saveIssuance(
          id,
          issuance.commandId,
          issuance.groupId,
          this.workerId,
          this.now()
        );
        if (!saved) {
          await this.queue.setState(
            id,
            "launch_uncertain",
            "ISSUANCE_SAVE_FAILED",
            this.workerId
          );
          return;
        }
      }
      intent = true;
      if (!(await this.queue.setState(id, "launching", null, this.workerId)))
        throw new RemoteSshError("LAUNCH_UNCERTAIN");
      const receipt: RemoteReceipt = await session.launch(
        id,
        issuance.bootstrap,
        expected
      );
      if (receipt.state === "launched") {
        await this.queue.setState(id, "handed_off", null, this.workerId);
        await this.queue.clearSecrets(id, this.now());
      } else if (receipt.state === "failed") {
        const failure = failedReceiptOutcome(
          receipt.errorCode || "LAUNCH_FAILED"
        );
        await this.queue.setState(
          id,
          failure.state,
          failure.errorCode,
          this.workerId
        );
        await this.queue.clearSecrets(id, this.now());
      } else {
        await this.queue.setState(
          id,
          "launch_uncertain",
          receipt.errorCode || "LAUNCH_UNCERTAIN",
          this.workerId
        );
        await this.queue.clearSecrets(id, this.now());
      }
    } catch (error) {
      const code = errorCode(error);
      if (intent || row.dispatch_intent_at || row.command_id)
        await this.queue.setState(
          id,
          "launch_uncertain",
          code === "AUTH_FAILED" ? "LAUNCH_UNCERTAIN" : code,
          this.workerId
        );
      else
        await this.queue.setState(
          id,
          [
            "AUTH_FAILED",
            "CONNECTION_FAILED",
            "CONNECTION_REFUSED",
            "CONNECTION_RESET",
            "CONNECTION_UNREACHABLE",
            "SSH_HANDSHAKE_TIMEOUT",
            "TIMEOUT",
          ].includes(code)
            ? "connection_failed"
            : "blocked",
          code,
          this.workerId
        );
    } finally {
      if (!intent) await this.queue.clearSecrets(id, this.now());
      clearInterval(beat);
      try {
        session?.close();
      } catch {
        /* no raw remote error */
      }
    }
  }
  async run(
    options: { once?: boolean; signal?: AbortSignal; pollMs?: number } = {}
  ): Promise<void> {
    const once = options.once === true;
    const pollMs = options.pollMs ?? 1_000;
    do {
      try {
        await this.tick();
      } catch {
        console.error("Remote worker maintenance unavailable");
      }
      if (once || options.signal?.aborted) return;
      await this.pause(pollMs);
    } while (!options.signal?.aborted);
  }
}

export async function runRemoteWorker(
  options: WorkerOptions = {}
): Promise<void> {
  const worker = new RemoteWorker(options);
  await worker.run(options);
}
