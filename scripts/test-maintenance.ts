import { execFileSync } from "node:child_process";
import { createTrackingGroup } from "../server/installTracking";
import { onRunRegistered, issueRemoteCommand } from "../server/control/admin";
import { RemoteQueue } from "../server/remoteInstall/queue";
import { transaction } from "../server/control/db";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { hashPassword } from "../server/control/crypto";
import type { MaintenancePreview } from "../shared/operationsMaintenance";

const base = process.env.TEST_BASE || "http://127.0.0.1:3143";
const syntheticPassword = "Synthetic owner password long 123!";
let cookie = "",
  csrf = "",
  checks = 0;
const prefix = "/api/admin/operations/maintenance";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
  extra: Record<string, string> = {}
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.APP_PUBLIC_URL!,
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    status,
    `${method} ${path}: unexpected HTTP status`
  );
  const nextCookie = response.headers.get("set-cookie");
  if (nextCookie) cookie = nextCookie.split(";")[0];
  const result = await response.json();
  if (result.csrf) csrf = result.csrf;
  return result;
}
function ok(message: string) {
  checks++;
  console.log("PASS", message);
}
async function main() {
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/win11desk_test_maintenance",
    "Dedicated maintenance-test DB required"
  );
  assert.ok(
    ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
    "Loopback only; never run cleanup against a public portal"
  );
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    await request(prefix + "/preview?mode=all", "GET", undefined, 401);
    await request("/api/admin/operations/storage", "GET", undefined, 401);
    const available = await request("/api/auth/setup/status");
    if (available.available)
      await request(
        "/api/auth/setup",
        "POST",
        {
          secret: process.env.BOOTSTRAP_SECRET,
          email: "owner@example.test",
          name: "Synthetic Owner",
          password: syntheticPassword,
        },
        201
      );
    else
      await request("/api/auth/login", "POST", {
        email: "owner@example.test",
        password: syntheticPassword,
      });
    const me = await request("/api/auth/me");
    const owner = me.user.id;
    const ownSessions = () =>
      db.query("SELECT id FROM wc_sessions WHERE account_id=?", [owner]);
    async function extraSession(state = "active", accountId = owner) {
      const id = randomUUID();
      await db.execute(
        "INSERT INTO wc_sessions(id,account_id,token_digest,csrf_token,expires_at,revoked_at,last_seen_at) VALUES(?,?,?,?,?,?,NOW(6))",
        [
          id,
          accountId,
          createHash("sha256").update(id).digest("hex"),
          "f".repeat(64),
          new Date(Date.now() + (state === "expired" ? -60000 : 3600000)),
          state === "revoked" ? new Date() : null,
        ]
      );
      return id;
    }
    const otherAccount = randomUUID();
    await db.execute(
      "INSERT INTO wc_accounts(id,email,name,password_hash,role) VALUES(?,?,?,?,?)",
      [
        otherAccount,
        `session-isolation-${otherAccount}@example.test`,
        "Other account",
        await hashPassword(syntheticPassword),
        "viewer",
      ]
    );
    const otherAccountSession = await extraSession("active", otherAccount);
    const revoked = await extraSession("revoked"),
      expired = await extraSession("expired"),
      other = await extraSession();
    const activeSessions = await request("/api/auth/account/sessions");
    assert.ok(
      !activeSessions.sessions.some((s: any) =>
        [revoked, expired].includes(s.id)
      )
    );
    const currentLogin = activeSessions.sessions.find((s: any) => s.current).id;
    await request(
      "/api/auth/account/sessions/clear-others",
      "POST",
      { confirm: true },
      401
    );
    await request("/api/auth/step-up", "POST", { password: syntheticPassword });
    await request(
      "/api/auth/account/sessions/clear-others",
      "POST",
      { confirm: true },
      403,
      { "X-CSRF-Token": "bad" }
    );
    await request(
      "/api/auth/account/sessions/clear-others",
      "POST",
      { confirm: false },
      400
    );
    const sessionResult = await request(
      "/api/auth/account/sessions/clear-others",
      "POST",
      { confirm: true }
    );
    assert.equal(sessionResult.cleared, 3);
    assert.deepEqual((await ownSessions())[0], [{ id: currentLogin }]);
    await request("/api/auth/me");
    ok(
      "Active session list excludes revoked/expired logins; bulk clear removes other own sessions and keeps this browser"
    );
    await extraSession();

    const storage = await request("/api/admin/operations/storage");
    assert.equal(storage.filesystem.state, "available");
    assert.ok(storage.filesystem.totalBytes > 0);
    assert.equal(storage.database.state, "available");
    assert.ok(storage.database.allocatedBytes >= 0);
    assert.equal(storage.ciphertextSubset.state, "available");
    assert.equal(storage.filesystem.scope, "shared-filesystem");
    const safe = JSON.stringify(storage);
    assert.ok(
      !safe.includes(process.env.DATABASE_URL!) && !safe.includes("VAULT_KEY")
    );
    ok("Authenticated live storage is measured, scoped and secret-free");
    const profile = (
      await request(
        "/api/admin/profiles",
        "POST",
        {
          name: "Maintenance fixture " + randomUUID().slice(0, 8),
          osId: "windows-11-pro",
          isoUrl:
            "https://example.com/windows11.iso",
          username: "Administrator",
          remotePort: 22,
          retries: 10,
        },
        201
      )
    ).profile;
    const issue = async (label: string, optional = false) =>
      (
        await request("/api/admin/commands", "POST", {
          profileId: profile.id,
          profileRevision: profile.revision,
          idempotencyKey: randomUUID(),
          label,
          username: "Administrator",
          password: "FakeOnly123!",
          remotePort: 22,
          count: 1,
          uniquePasswords: false,
          ...(optional
            ? {
                postInstall: {
                  getFiles: true,
                  apps: ["chrome"],
                  customFileUrl: "",
                  runAttachedScript: false,
                },
              }
            : {}),
        })
      ).items[0];
    const active = await issue("maintenance active"),
      completed = await issue("maintenance completed"),
      siblings = await issue("maintenance siblings"),
      unused = await issue("maintenance unused"),
      optional = await issue("maintenance optional", true);
    const runs: Record<string, string> = {};
    async function run(name: string, command: any, stage: string) {
      const id = randomUUID();
      runs[name] = id;
      await db.execute(
        "INSERT INTO wc_run_meta(run_id,workspace_id,owner_id,command_id,group_id,hostname,whole_disk,stage,created_at,registered_at,tags_json,finished_at) VALUES(?,'default',?,?,?,'synthetic','/dev/vda',?,NOW(3),NOW(3),'[]',?)",
        [
          id,
          owner,
          command.id,
          command.groupId,
          stage,
          ["windows_ready", "failed"].includes(stage) ? new Date() : null,
        ]
      );
      await db.execute(
        "INSERT INTO installerTrackingRuns(id,groupId,reportTokenHash,hostname,wholeDisk,rdpPort,stage,expiresAt) VALUES(?,?,?,'synthetic','/dev/vda',22,?,DATE_ADD(NOW(),INTERVAL 7 DAY))",
        [id, command.groupId, "a".repeat(64), stage]
      );
      await db.execute(
        "INSERT INTO wc_events(run_id,event_id,stage,payload_json,received_at) VALUES(?,?,?,'{}',NOW(3))",
        [id, randomUUID(), stage]
      );
      await db.execute(
        "INSERT INTO wc_run_labels(run_id,workspace_id,display_label,updated_at) VALUES(?,'default',?,NOW(3))",
        [id, name]
      );
    }
    await run("active", active, "downloading");
    await run("completed", completed, "windows_ready");
    await run("siblingReady", siblings, "failed");
    await run("siblingActive", siblings, "windows_setup");
    await run("optional", optional, "windows_ready");
    const orphanGroup = await createTrackingGroup();
    await run(
      "failedOrphan",
      { id: randomUUID(), groupId: orphanGroup.groupId },
      "failed"
    );
    await db.execute(
      "UPDATE wc_commands SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 HOUR) WHERE id IN (?,?,?,?)",
      [active.id, completed.id, siblings.id, optional.id]
    );
    const jobs: Record<string, string> = {};
    async function job(
      name: string,
      state: string,
      commandId: string | null = null
    ) {
      const id = randomUUID();
      jobs[name] = id;
      await db.execute(
        "INSERT INTO wc_remote_jobs(id,workspace_id,owner_id,review_id,idempotency_key,target_host,target_port,target_json,fingerprint,expected_inventory_json,settings_secret_id,label,profile_name,state,command_id,deadline_at,created_at,updated_at) VALUES(?,'default',?,?,?,'192.0.2.55',22,?,'SHA256:synthetic','{}',?,'synthetic','synthetic',?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR),NOW(),NOW())",
        [
          id,
          owner,
          randomUUID(),
          randomUUID(),
          JSON.stringify({ host: "192.0.2.55", port: 22, username: "root" }),
          randomUUID(),
          state,
          commandId,
        ]
      );
      await db.execute(
        "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) VALUES('default',?,?,?,NOW())",
        [id, state, state.toUpperCase()]
      );
      await db.execute(
        "INSERT INTO wc_remote_secrets(id,workspace_id,job_id,purpose,ciphertext,created_at,expires_at) VALUES(?,'default',?,'ssh',JSON_OBJECT('cleared',true),NOW(),DATE_SUB(NOW(),INTERVAL 1 HOUR))",
        [randomUUID(), id]
      );
    }
    await job("closed", "cancelled");
    await job("uncertain", "launch_uncertain");
    await db.execute(
      "INSERT INTO wc_notifications(id,workspace_id,owner_id,run_id,kind,title,body,created_at) VALUES(?,'default',?,?,'completed','Synthetic','Synthetic',NOW(3))",
      [randomUUID(), owner, runs.completed]
    );
    const [profilesBefore] = await db.query(
      "SELECT * FROM wc_profiles ORDER BY id"
    );
    const [settingsBefore] = await db.query(
      "SELECT * FROM wc_settings ORDER BY workspace_id"
    );
    const [accountsBefore] = await db.query(
      "SELECT id,email,name,password_hash,role,active,mfa_enabled,mfa_secret_envelope FROM wc_accounts ORDER BY id"
    );
    const [auditBefore]: any = await db.query("SELECT id FROM wc_audit");
    const fingerprint = async (id: string) => {
      const [rows]: any = await db.execute(
        "SELECT artifact_ciphertext,credential_ciphertext,delivery_hash,config_json FROM wc_commands WHERE id=?",
        [id]
      );
      return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    };
    const activeHash = await fingerprint(active.id),
      siblingHash = await fingerprint(siblings.id);
    const preview = (await request(
      prefix + "/preview?mode=finished"
    )) as MaintenancePreview;
    assert.ok(preview.canClear);
    assert.ok(preview.counts.wc_commands >= 1);
    const body = {
      mode: preview.mode,
      confirm: preview.confirmPhrase,
      previewDigest: preview.previewDigest,
    };
    await request(prefix + "/clear", "POST", body, 403, {
      "X-CSRF-Token": "invalid",
    });
    await db.execute("UPDATE wc_sessions SET step_up_at=NULL WHERE id=?", [
      currentLogin,
    ]);
    await request(prefix + "/clear", "POST", body, 401);
    await request("/api/auth/step-up", "POST", { password: syntheticPassword });
    await request(
      prefix + "/clear",
      "POST",
      { ...body, confirm: "WRONG" },
      400
    );
    const cleared = await request(prefix + "/clear", "POST", body);
    assert.ok(cleared.cleared);
    const [gone]: any = await db.execute(
      "SELECT id FROM wc_commands WHERE id=?",
      [completed.id]
    );
    assert.equal(gone.length, 0);
    for (const table of ["wc_run_meta", "wc_events", "wc_run_labels"]) {
      const [orphans]: any = await db.query(
        `SELECT COUNT(*) n FROM ${table} WHERE run_id=?`,
        [runs.failedOrphan]
      );
      assert.equal(orphans[0].n, 0, "failed orphan dependent history cleared");
    }
    const [orphanTracker]: any = await db.query(
      "SELECT COUNT(*) n FROM installerTrackingRuns WHERE id=?",
      [runs.failedOrphan]
    );
    assert.equal(orphanTracker[0].n, 0);
    const [kept]: any = await db.query(
      "SELECT id FROM wc_commands WHERE id IN (?,?,?,?)",
      [active.id, siblings.id, unused.id, optional.id]
    );
    assert.equal(kept.length, 4);
    assert.equal(await fingerprint(active.id), activeHash);
    assert.equal(await fingerprint(siblings.id), siblingHash);
    const [uncertain]: any = await db.execute(
      "SELECT id FROM wc_remote_jobs WHERE id=?",
      [jobs.uncertain]
    );
    assert.equal(uncertain.length, 1);
    const [closed]: any = await db.execute(
      "SELECT id FROM wc_remote_jobs WHERE id=?",
      [jobs.closed]
    );
    assert.equal(closed.length, 0);
    ok(
      "Finished cleanup deletes closed work only; running/shared/uncertain/live-command/optional-missing work and ciphertext stay protected"
    );
    const allReady = (await request(
      prefix + "/preview?mode=all"
    )) as MaintenancePreview;
    assert.equal(allReady.canClear, true);
    assert.deepEqual(allReady.blockers, []);
    assert.ok(allReady.counts.wc_remote_jobs >= 1);
    assert.ok(allReady.counts.wc_run_meta >= 4);
    ok(
      "Clear All includes active/uncertain/handed-off/post-install work without activity blockers"
    );
    // Finished mode still binds the exact reviewed scope.
    const finishedPreview = await request(prefix + "/preview?mode=finished");
    const extra = await issue("maintenance after preview");
    await request(
      prefix + "/clear",
      "POST",
      {
        mode: "finished",
        confirm: finishedPreview.confirmPhrase,
        previewDigest: finishedPreview.previewDigest,
      },
      409
    );
    ok("Finished cleanup still rejects stale exact preview without deletion");
    // ALL means all then-current data: additional running work does not block it.
    let finalPreview = allReady;
    await run("raced", extra, "starting");
    ok(
      "New running activity is included in unconditional reset rather than blocking it"
    );
    await db.execute(
      "INSERT INTO wc_events(run_id,event_id,stage,payload_json,received_at) VALUES(?,?,'failed','{}',NOW(3))",
      [randomUUID(), randomUUID()]
    );
    await db.execute(
      "INSERT INTO wc_delivery_secrets(command_id,input_digest,capability_envelope) VALUES(?,?,'{}')",
      [randomUUID(), "f".repeat(64)]
    );
    await db.execute(
      "INSERT INTO wc_remote_job_events(workspace_id,job_id,phase,code,created_at) VALUES('default',?,'cancelled','CANCELLED',NOW())",
      [randomUUID()]
    );
    await db.execute("UPDATE wc_remote_jobs SET group_id=? WHERE id=?", [
      randomUUID(),
      jobs.uncertain,
    ]);
    await request(prefix + "/clear", "POST", {
      mode: "all",
      confirm: finalPreview.confirmPhrase,
      previewDigest: finalPreview.previewDigest,
    });
    for (const table of [
      "wc_commands",
      "wc_remote_jobs",
      "wc_run_meta",
      "wc_events",
      "wc_post_install_runs",
      "wc_notifications",
      "wc_remote_secrets",
      "wc_remote_reviews",
      "wc_remote_checks",
      "wc_remote_job_events",
      "wc_delivery_secrets",
      "wc_command_profiles",
      "wc_run_labels",
      "installerTrackingRuns",
      "installerTrackingGroups",
    ]) {
      const [rows]: any = await db.query(`SELECT COUNT(*) n FROM ${table}`);
      assert.equal(Number(rows[0].n), 0, table + " should be empty");
    }
    assert.deepEqual((await ownSessions())[0], [{ id: currentLogin }]);
    const [otherPreserved]: any = await db.query(
      "SELECT id FROM wc_sessions WHERE id=?",
      [otherAccountSession]
    );
    assert.equal(otherPreserved.length, 1);
    await request("/api/auth/me");
    // Delayed callbacks/events cannot rebuild a cleared capability/history row.
    await onRunRegistered(runs.active, active.groupId, {
      hostname: "synthetic",
      wholeDisk: "/dev/vda",
      rdpPort: 22,
    });
    await new RemoteQueue().event(jobs.uncertain, "cleared", "CLEARED");
    await assert.rejects(
      () =>
        issueRemoteCommand(
          owner,
          {
            profileId: profile.id,
            profileRevision: profile.revision,
            username: "Administrator",
            password: "FakeOnly123!",
            remotePort: 22,
            retries: 10,
            postInstall: {
              getFiles: false,
              apps: [],
              customFileUrl: "",
              runAttachedScript: false,
            },
          } as any,
          { hostname: "synthetic", disk: "/dev/vda" } as any,
          jobs.uncertain
        ),
      /Remote job was cleared/
    );
    for (const table of [
      "wc_commands",
      "wc_run_meta",
      "wc_remote_job_events",
      "installerTrackingGroups",
    ]) {
      const [v]: any = await db.query(`SELECT COUNT(*) n FROM ${table}`);
      assert.equal(v[0].n, 0);
    }
    ok(
      "Clear All keeps current login, removes other own sessions and rejects late mirror/worker writes"
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM wc_profiles ORDER BY id"))[0],
      profilesBefore
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM wc_settings ORDER BY workspace_id"))[0],
      settingsBefore
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT id,email,name,password_hash,role,active,mfa_enabled,mfa_secret_envelope FROM wc_accounts ORDER BY id"
        )
      )[0],
      accountsBefore
    );
    assert.equal((await request("/api/auth/me")).user.id, owner);
    const [auditAfter]: any = await db.query(
      "SELECT id,metadata_json FROM wc_audit"
    );
    const ids = new Set(auditAfter.map((r: any) => r.id));
    assert.ok(auditBefore.every((r: any) => ids.has(r.id)));
    ok(
      "Clear All empties Commands/Remote Installations/legacy tracking/dependent secrets and preserves profiles/settings/admin login/audit"
    );
    const atomicCounts = async () => {
      const result: Record<string, number> = {};
      for (const table of [
        "installerTrackingGroups",
        "wc_commands",
        "wc_delivery_secrets",
        "wc_command_profiles",
      ]) {
        const [count]: any = await db.query(`SELECT COUNT(*) n FROM ${table}`);
        result[table] = count[0].n;
      }
      return result;
    };
    const beforeFailedEnvelope = await atomicCounts();
    const adminDDL = async (sql: string) => {
      const container = process.env.TEST_MYSQL_ADMIN_CONTAINER;
      if (!container) return db.query(sql);
      assert.match(container, /^[a-zA-Z0-9_-]+$/);
      // Root privileges are used only inside the explicitly named disposable test
      // container; never grant SUPER or relax binary-log safety for the app user.
      execFileSync(
        "sudo",
        [
          "docker",
          "exec",
          container,
          "sh",
          "-c",
          'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot win11desk_test_maintenance -e "$1"',
          "test-ddl",
          sql,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    };
    await adminDDL(
      "CREATE TRIGGER maintenance_fail_delivery BEFORE INSERT ON wc_delivery_secrets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic delivery rollback'"
    );
    try {
      await request(
        "/api/admin/commands",
        "POST",
        {
          profileId: profile.id,
          profileRevision: profile.revision,
          idempotencyKey: randomUUID(),
          username: "Administrator",
          password: "FakeOnly123!",
          remotePort: 22,
          count: 1,
          uniquePasswords: false,
        },
        500
      );
    } finally {
      await adminDDL("DROP TRIGGER maintenance_fail_delivery");
    }
    assert.deepEqual(await atomicCounts(), beforeFailedEnvelope);
    ok(
      "Failed delivery-envelope insertion rolls back command, tracker, profile snapshot and secret atomically"
    );
    const [groupBaseline]: any = await db.query(
      "SELECT COUNT(*) n FROM installerTrackingGroups"
    );
    await assert.rejects(
      transaction(async conn => {
        await createTrackingGroup(conn);
        throw new Error("Synthetic command insert failure");
      })
    );
    const [groupAfterRollback]: any = await db.query(
      "SELECT COUNT(*) n FROM installerTrackingGroups"
    );
    assert.equal(groupAfterRollback[0].n, groupBaseline[0].n);
    ok(
      "Tracker creation rolls back atomically with failed issuance; no orphan capability survives"
    );
    for (const role of ["admin", "operator", "viewer"]) {
      const id = randomUUID(),
        email = `${role}-${id}@example.test`;
      await db.execute(
        "INSERT INTO wc_accounts(id,email,name,password_hash,role) VALUES(?,?,?,?,?)",
        [id, email, role, await hashPassword(syntheticPassword), role]
      );
      await request("/api/auth/login", "POST", {
        email,
        password: syntheticPassword,
      });
      await request(prefix + "/preview?mode=all", "GET", undefined, 403);
      await request(
        prefix + "/clear",
        "POST",
        {
          mode: "all",
          confirm: "CLEAR ALL INSTALLATION DATA",
          previewDigest: "a".repeat(64),
        },
        403
      );
    }
    ok(
      "Admin/operator/viewer cannot access owner-only maintenance or mutate workspace data"
    );
    await request("/api/auth/login", "POST", {
      email: "owner@example.test",
      password: syntheticPassword,
    });
    assert.equal((await request("/api/admin/commands")).items.length, 0);
    const remote = await request("/api/admin/remote/jobs");
    assert.equal((remote.jobs || remote.items || []).length, 0);
    console.log(
      "MAINTENANCE ACCEPTANCE COMPLETE",
      checks,
      "checks; dedicated isolated database only; no VPS installation or live cleanup."
    );
  } finally {
    await db.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      "Maintenance isolated acceptance failed:",
      error.name,
      String(error.message).slice(0, 500)
    );
    process.exit(1);
  });
