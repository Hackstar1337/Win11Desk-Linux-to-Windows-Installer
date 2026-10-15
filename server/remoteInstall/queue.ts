import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type {
  RemoteJob,
  RemoteJobState,
  RemoteTarget,
  TargetInventory,
} from "@shared/remoteInstall";
import { exec, pool, rows, transaction } from "../control/db.js";

export const WORKSPACE = "default";
export const QUEUE_DEADLINE_MS = 10 * 60_000;
export const SECRET_TTL_MS = 15 * 60_000;
export const LEASE_MS = 45_000;
export const ACTIVE_STATES: readonly RemoteJobState[] = [
  "queued",
  "connecting",
  "checking",
  "sending",
  "launching",
  "launch_uncertain",
  "handed_off",
];
export const TERMINAL_STATES: readonly RemoteJobState[] = [
  "handed_off",
  "blocked",
  "connection_failed",
  "cancelled",
];

type JsonObject = Record<string, unknown>;
export type QueueJobRow = {
  id: string;
  owner_id: string;
  review_id: string;
  idempotency_key: string;
  target_host: string;
  target_port: number;
  target_json: unknown;
  fingerprint: string;
  expected_inventory_json: unknown;
  settings_secret_id: string;
  ssh_secret_id: string | null;
  label: string;
  profile_name: string;
  state: RemoteJobState;
  error_code: string | null;
  command_id: string | null;
  group_id: string | null;
  run_id: string | null;
  dispatch_attempt: number;
  dispatch_intent_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  deadline_at: string;
  created_at: string;
  updated_at: string;
  handed_off_at: string | null;
  terminal_at: string | null;
  settings_ciphertext?: string | null;
  ssh_ciphertext?: string | null;
};

function parse<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
function date(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function safeJob(row: QueueJobRow): RemoteJob {
  const target = parse<RemoteTarget>(row.target_json, {
    host: row.target_host,
    port: Number(row.target_port),
    username: "root",
  });
  const state = row.state;
  return {
    id: row.id,
    target,
    state,
    label: row.label,
    profileName: row.profile_name,
    createdAt: date(row.created_at) || new Date(0).toISOString(),
    updatedAt: date(row.updated_at) || new Date(0).toISOString(),
    errorCode: row.error_code || null,
    commandId: row.command_id || null,
    groupId: row.group_id || null,
    runId: row.run_id || null,
    canCancel: state === "queued",
  };
}
function activeState(state: string): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(state);
}
function connectionRows(
  c: PoolConnection,
  sql: string,
  params: unknown[] = []
) {
  return c.execute(sql, params).then(([r]) => r as QueueJobRow[]);
}

export type EnqueueInput = {
  id: string;
  ownerId: string;
  reviewId: string;
  idempotencyKey: string;
  target: RemoteTarget;
  fingerprint: string;
  expected: TargetInventory;
  settingsSecretId: string;
  sshSecretId: string | null;
  label: string;
  profileName: string;
  settingsCiphertext?: string;
  sshCiphertext?: string;
  now?: Date;
};

export class RemoteQueue {
  readonly workspace = WORKSPACE;
  async enqueue(input: EnqueueInput): Promise<RemoteJob> {
    const now = input.now || new Date();
    return transaction(async c => {
      const existing = await connectionRows(
        c,
        "SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND owner_id=? AND idempotency_key=? FOR UPDATE",
        [WORKSPACE, input.ownerId, input.idempotencyKey]
      );
      if (existing[0]) {
        if (existing[0].review_id !== input.reviewId)
          throw Object.assign(new Error("Idempotency review mismatch"), {
            status: 409,
            code: "IDEMPOTENCY_MISMATCH",
          });
        return safeJob(existing[0]);
      }
      await c.execute(
        "SELECT host,port FROM wc_remote_trust WHERE workspace_id=? AND host=? ORDER BY port FOR UPDATE",
        [WORKSPACE, input.target.host]
      );
      const locked = await connectionRows(
        c,
        `SELECT id FROM wc_remote_jobs WHERE workspace_id=? AND target_host=?
         AND state IN ('queued','connecting','checking','sending','launching','launch_uncertain','handed_off')
         AND (state<>'handed_off' OR NOT EXISTS (SELECT 1 FROM wc_run_meta m WHERE m.command_id=wc_remote_jobs.command_id AND m.stage IN('windows_ready','failed'))) LIMIT 1 FOR UPDATE`,
        [WORKSPACE, input.target.host]
      );
      if (locked[0])
        throw Object.assign(
          new Error("Target already has an unresolved remote job"),
          { status: 409, code: "TARGET_BUSY" }
        );
      const id = input.id || randomUUID();
      const deadline = new Date(now.getTime() + QUEUE_DEADLINE_MS);
      await c.execute(
        `INSERT INTO wc_remote_jobs
         (id,workspace_id,owner_id,review_id,idempotency_key,target_host,target_port,target_json,fingerprint,expected_inventory_json,
          settings_secret_id,ssh_secret_id,label,profile_name,state,dispatch_attempt,deadline_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'queued',0,?,?,?)`,
        [
          id,
          WORKSPACE,
          input.ownerId,
          input.reviewId,
          input.idempotencyKey,
          input.target.host,
          input.target.port,
          JSON.stringify(input.target),
          input.fingerprint,
          JSON.stringify(input.expected),
          input.settingsSecretId,
          input.sshSecretId,
          input.label,
          input.profileName,
          deadline,
          now,
          now,
        ]
      );
      await c.execute(
        "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) VALUES(?,?,?,?,?)",
        [WORKSPACE, id, "queued", "QUEUED", now]
      );
      const [r] = await c.execute(
        "SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND id=?",
        [WORKSPACE, id]
      );
      return safeJob((r as QueueJobRow[])[0]);
    });
  }

  async get(id: string, ownerId?: string): Promise<RemoteJob | null> {
    const params: unknown[] = [WORKSPACE, id];
    const where = ownerId ? " AND owner_id=?" : "";
    if (ownerId) params.push(ownerId);
    const found = await rows<QueueJobRow>(
      `SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND id=?${where} LIMIT 1`,
      params
    );
    return found[0] ? safeJob(found[0]) : null;
  }
  async raw(id: string): Promise<QueueJobRow | null> {
    const found = await rows<QueueJobRow>(
      "SELECT j.*,ss.ciphertext AS settings_ciphertext,sh.ciphertext AS ssh_ciphertext FROM wc_remote_jobs j LEFT JOIN wc_remote_secrets ss ON ss.id=j.settings_secret_id AND ss.workspace_id=j.workspace_id AND ss.cleared_at IS NULL AND ss.expires_at>NOW(6) LEFT JOIN wc_remote_secrets sh ON sh.id=j.ssh_secret_id AND sh.workspace_id=j.workspace_id AND sh.cleared_at IS NULL AND sh.expires_at>NOW(6) WHERE j.workspace_id=? AND j.id=? LIMIT 1",
      [WORKSPACE, id]
    );
    return found[0] || null;
  }
  async list(ownerId: string): Promise<RemoteJob[]> {
    const found = await rows<QueueJobRow>(
      "SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND owner_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
      [WORKSPACE, ownerId]
    );
    return found.map(safeJob);
  }
  async events(
    id: string,
    ownerId?: string
  ): Promise<Array<{ phase: string; code: string; createdAt: string | null }>> {
    const ownerClause = ownerId
      ? " AND EXISTS (SELECT 1 FROM wc_remote_jobs j WHERE j.workspace_id=e.workspace_id AND j.id=e.job_id AND j.owner_id=?)"
      : "";
    const p: unknown[] = [WORKSPACE, id];
    if (ownerId) p.push(ownerId);
    const result = await rows<{
      phase: string;
      code: string;
      created_at: string;
    }>(
      `SELECT phase,code,created_at FROM wc_remote_job_events e WHERE workspace_id=? AND job_id=?${ownerClause} ORDER BY id ASC LIMIT 200`,
      p
    );
    return result.map(x => ({
      phase: x.phase,
      code: x.code,
      createdAt: date(x.created_at),
    }));
  }
  async claim(workerId: string, now = new Date()): Promise<QueueJobRow | null> {
    return transaction(async c => {
      const [result] = await c.execute(
        `SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND state='queued' AND deadline_at>?
         AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [WORKSPACE, now, now]
      );
      const row = (result as QueueJobRow[])[0];
      if (!row) return null;
      const lease = new Date(now.getTime() + LEASE_MS);
      await c.execute(
        "UPDATE wc_remote_jobs SET state='connecting',dispatch_attempt=dispatch_attempt+1,lease_owner=?,lease_until=?,updated_at=? WHERE workspace_id=? AND id=? AND state='queued'",
        [workerId, lease, now, WORKSPACE, row.id]
      );
      await this.eventTx(c, row.id, "connecting", "CONNECTING", now);
      row.state = "connecting";
      row.dispatch_attempt = Number(row.dispatch_attempt) + 1;
      row.lease_owner = workerId;
      row.lease_until = lease.toISOString();
      return row;
    });
  }
  async heartbeat(
    workerId: string,
    jobId: string,
    now = new Date()
  ): Promise<boolean> {
    const lease = new Date(now.getTime() + LEASE_MS);
    const result = await exec(
      "UPDATE wc_remote_jobs SET lease_until=?,updated_at=? WHERE workspace_id=? AND id=? AND lease_owner=? AND state IN ('connecting','checking','sending','launching')",
      [lease, now, WORKSPACE, jobId, workerId]
    );
    return result.affectedRows === 1;
  }
  async setState(
    id: string,
    state: RemoteJobState,
    code?: string | null,
    workerId?: string,
    now = new Date()
  ): Promise<boolean> {
    let guard = "";
    if (workerId)
      guard =
        " AND lease_owner=? AND state IN ('connecting','checking','sending','launching') AND lease_until>?";
    const set = ["state=?", "error_code=?", "updated_at=?"];
    const values: unknown[] = [state, code || null, now];
    if (state === "handed_off") {
      set.push("handed_off_at=?", "terminal_at=?");
      values.push(now, now);
    } else if (TERMINAL_STATES.includes(state)) {
      set.push("terminal_at=?");
      values.push(now);
    }
    if (state === "handed_off" || TERMINAL_STATES.includes(state))
      set.push("lease_until=NULL");
    values.push(WORKSPACE, id);
    if (workerId) values.push(workerId, now);
    const result = await exec(
      `UPDATE wc_remote_jobs SET ${set.join(",")} WHERE workspace_id=? AND id=?${guard}`,
      values
    );
    if (result.affectedRows)
      await this.event(id, state, code || state.toUpperCase(), now);
    return result.affectedRows === 1;
  }
  async saveIssuance(
    id: string,
    commandId: string,
    groupId: string,
    workerId: string,
    now = new Date()
  ): Promise<boolean> {
    const result = await exec(
      "UPDATE wc_remote_jobs SET command_id=?,group_id=?,dispatch_intent_at=?,updated_at=? WHERE workspace_id=? AND id=? AND lease_owner=? AND command_id IS NULL",
      [commandId, groupId, now, now, WORKSPACE, id, workerId]
    );
    return result.affectedRows === 1;
  }
  async event(
    id: string,
    phase: string,
    code: string,
    now = new Date()
  ): Promise<void> {
    await exec(
      "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) SELECT workspace_id,id,?,?,? FROM wc_remote_jobs WHERE workspace_id=? AND id=?",
      [phase.slice(0, 32), code.slice(0, 64), now, WORKSPACE, id]
    );
  }
  private async eventTx(
    c: PoolConnection,
    id: string,
    phase: string,
    code: string,
    now: Date
  ) {
    await c.execute(
      "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) VALUES(?,?,?,?,?)",
      [WORKSPACE, id, phase, code, now]
    );
  }
  async cancel(
    id: string,
    ownerId: string,
    now = new Date()
  ): Promise<RemoteJob | null> {
    return transaction(async c => {
      const found = await connectionRows(
        c,
        "SELECT * FROM wc_remote_jobs WHERE workspace_id=? AND id=? AND owner_id=? FOR UPDATE",
        [WORKSPACE, id, ownerId]
      );
      const row = found[0];
      if (!row) return null;
      if (row.state !== "queued")
        throw Object.assign(
          new Error("Remote launch can no longer be cancelled"),
          { status: 409, code: "CANCEL_TOO_LATE" }
        );
      await c.execute(
        "UPDATE wc_remote_jobs SET state='cancelled',terminal_at=?,updated_at=?,lease_until=NULL WHERE workspace_id=? AND id=? AND state='queued'",
        [now, now, WORKSPACE, id]
      );
      await this.eventTx(c, id, "cancelled", "CANCELLED", now);
      await c.execute(
        "UPDATE wc_remote_secrets SET cleared_at=?,ciphertext=JSON_OBJECT('cleared',true) WHERE workspace_id=? AND (job_id=? OR id IN (SELECT settings_secret_id FROM wc_remote_jobs WHERE id=?)) AND cleared_at IS NULL",
        [now, WORKSPACE, id, id]
      );
      row.state = "cancelled";
      row.updated_at = now.toISOString();
      row.terminal_at = now.toISOString();
      return safeJob(row);
    });
  }
  async recoverStale(now = new Date()): Promise<number> {
    await transaction(async c => {
      const [expired]: any = await c.execute(
        "SELECT id FROM wc_remote_jobs WHERE workspace_id=? AND state='queued' AND deadline_at<=? LIMIT 100 FOR UPDATE",
        [WORKSPACE, now]
      );
      for (const job of expired) {
        await c.execute(
          "UPDATE wc_remote_jobs SET state='blocked',error_code='QUEUE_EXPIRED',terminal_at=?,updated_at=? WHERE id=? AND workspace_id=? AND state='queued'",
          [now, now, job.id, WORKSPACE]
        );
        await this.eventTx(c, job.id, "blocked", "QUEUE_EXPIRED", now);
      }
    });
    await exec(
      "UPDATE wc_remote_secrets s LEFT JOIN wc_remote_jobs j ON j.id=s.job_id AND j.workspace_id=s.workspace_id SET s.ciphertext=JSON_OBJECT('cleared',true),s.cleared_at=? WHERE s.workspace_id=? AND s.cleared_at IS NULL AND (s.expires_at<=? OR j.state IN('blocked','connection_failed','cancelled','handed_off'))",
      [now, WORKSPACE, now]
    );
    await exec(
      "UPDATE wc_remote_jobs j SET run_id=(SELECT m.run_id FROM wc_run_meta m WHERE m.command_id=j.command_id ORDER BY m.created_at DESC LIMIT 1) WHERE j.workspace_id=? AND j.command_id IS NOT NULL AND j.run_id IS NULL",
      [WORKSPACE]
    );
    const result = await exec(
      "UPDATE wc_remote_jobs SET state='launch_uncertain',error_code='WORKER_RESTART',updated_at=?,lease_until=NULL WHERE workspace_id=? AND state IN ('connecting','checking','sending','launching') AND lease_until<?",
      [now, WORKSPACE, now]
    );
    if (result.affectedRows) {
      const found = await rows<{ id: string }>(
        "SELECT id FROM wc_remote_jobs WHERE workspace_id=? AND state='launch_uncertain' AND error_code='WORKER_RESTART' AND updated_at=?",
        [WORKSPACE, now]
      );
      for (const row of found)
        await this.event(row.id, "launch_uncertain", "WORKER_RESTART", now);
    }
    return result.affectedRows;
  }
  async clearSecrets(id: string, now = new Date()): Promise<void> {
    await exec(
      "UPDATE wc_remote_secrets SET cleared_at=?,ciphertext=JSON_OBJECT('cleared',true) WHERE workspace_id=? AND (job_id=? OR id IN (SELECT settings_secret_id FROM wc_remote_jobs WHERE workspace_id=? AND id=?)) AND cleared_at IS NULL",
      [now, WORKSPACE, id, WORKSPACE, id]
    );
  }
}

export const remoteQueue = new RemoteQueue();

export async function queueHealth(): Promise<{
  queued: number;
  oldestQueuedAt: string | null;
  uncertain: number;
  workerHeartbeatAt: string | null;
}> {
  const [q, o, u, h] = await Promise.all([
    rows<{ n: number }>(
      "SELECT COUNT(*) n FROM wc_remote_jobs WHERE workspace_id=? AND state='queued'",
      [WORKSPACE]
    ),
    rows<{ at: string | null }>(
      "SELECT MIN(created_at) at FROM wc_remote_jobs WHERE workspace_id=? AND state='queued'",
      [WORKSPACE]
    ),
    rows<{ n: number }>(
      "SELECT COUNT(*) n FROM wc_remote_jobs WHERE workspace_id=? AND state='launch_uncertain'",
      [WORKSPACE]
    ),
    rows<{ at: string | null }>(
      "SELECT MAX(heartbeat_at) at FROM wc_remote_worker_heartbeat WHERE workspace_id=?",
      [WORKSPACE]
    ),
  ]);
  return {
    queued: Number(q[0]?.n || 0),
    oldestQueuedAt: date(o[0]?.at),
    uncertain: Number(u[0]?.n || 0),
    workerHeartbeatAt: date(h[0]?.at),
  };
}

export function isSafeJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
