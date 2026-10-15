import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { pool } from "../server/control/db";
import { encrypt, decrypt } from "../server/control/crypto";
import { issueRemoteCommand } from "../server/control/admin";
import { RemoteQueue } from "../server/remoteInstall/queue";
import type { TargetInventory } from "../shared/remoteInstall";
const base = process.env.TEST_BASE || "http://127.0.0.1:3138";
const origin = process.env.APP_PUBLIC_URL || base;
const syntheticOwnerPassword = "Synthetic owner password long 123!";
const sshPassword = "Synthetic ' SSH $ pass with spaces";
const windowsPassword = "Synthetic Windows 123!";
let cookie = "",
  csrf = "",
  checks = 0;
function ok(s: string) {
  checks++;
  console.log("PASS", s);
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
  csrfOverride?: string
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "X-CSRF-Token": csrfOverride ?? csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  assert.equal(res.status, status, `${method} ${path}: ${text.slice(0, 200)}`);
  const c = res.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  const value = JSON.parse(text);
  if (value.csrf) csrf = value.csrf;
  return value;
}
async function main() {
  assert.equal(
    new URL(base).hostname,
    "127.0.0.1",
    "Only a loopback API fixture is permitted"
  );
  assert.ok(
    new URL(process.env.DATABASE_URL!).pathname.startsWith("/win11desk_test"),
    "Only isolated test database permitted"
  );
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  const ids: string[] = [];
  let actorId = "";
  try {
    await db.execute(
      "DELETE e FROM wc_remote_job_events e JOIN wc_remote_jobs j ON j.id=e.job_id WHERE j.label='Portal SSH fixture'"
    );
    await db.execute(
      "DELETE s FROM wc_remote_secrets s JOIN wc_remote_jobs j ON j.id=s.job_id WHERE j.label='Portal SSH fixture'"
    );
    await db.execute(
      "DELETE FROM wc_remote_jobs WHERE label='Portal SSH fixture'"
    );
    await request("/api/admin/remote/config", "GET", undefined, 401);
    ok("Anonymous remote API denied");
    const setup = await request("/api/auth/setup/status");
    if (setup.available)
      await request(
        "/api/auth/setup",
        "POST",
        {
          secret: process.env.BOOTSTRAP_SECRET,
          email: "owner@example.test",
          name: "Test Owner",
          password: syntheticOwnerPassword,
        },
        201
      );
    else
      await request("/api/auth/login", "POST", {
        email: "owner@example.test",
        password: syntheticOwnerPassword,
      });
    const [account]: any = await db.query(
      "SELECT id FROM wc_accounts WHERE email='owner@example.test'"
    );
    actorId = String(account[0].id);
    const cfg = await request("/api/admin/remote/config");
    assert.equal(cfg.enabled, true);
    ok("Remote feature explicitly enabled only on test runtime");
    await request(
      "/api/admin/remote/discover",
      "POST",
      { target: { host: "127.0.0.1", port: 22, username: "root" } },
      422
    );
    ok("Unsafe target rejected before any SSH connection");
    await request(
      "/api/admin/remote/discover",
      "POST",
      { target: { host: "127.0.0.1", port: 22, username: "root" } },
      403,
      "incorrect"
    );
    ok("CSRF prevents credential/connection actions");
    let ready = await request("/api/admin/profiles/ready");
    if (!ready.items.length) {
      await request("/api/auth/step-up", "POST", {
        password: syntheticOwnerPassword,
      });
      await request(
        "/api/admin/profiles",
        "POST",
        {
          name: "Synthetic SSH acceptance profile",
          osId: "windows-11-pro",
          isoUrl: "https://example.com/windows11.iso",
          username: "Administrator",
          remotePort: 22,
          retries: 10,
        },
        201
      );
      ready = await request("/api/admin/profiles/ready");
    }
    assert.ok(
      ready.items.length,
      "A configured fixture profile must be selectable before remote review"
    );
    const profile = ready.items[0];
    const target = { host: "8.8.4.4", port: 22, username: "root" as const };
    const fingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const inventory: TargetInventory = {
      hostname: "fixture-target",
      architecture: "x86_64",
      root: true,
      virtualization: "kvm",
      memoryMiB: 4096,
      cpuCount: 2,
      disk: "/dev/vda",
      diskBytes: 80 * 1024 ** 3,
      diskSerial: "fixture-only",
      bootMode: "uefi",
      runner: "systemd",
      httpsReachable: true,
      checkedAt: new Date().toISOString(),
    };
    async function seedCheck() {
      const checkId = randomUUID(),
        secretId = randomUUID();
      ids.push(checkId);
      await db.execute(
        "INSERT INTO wc_remote_trust(workspace_id,host,port,fingerprint,key_type,approved_by,approved_at,last_seen_at) VALUES('default',?,?,?,?,?,NOW(),NOW()) ON DUPLICATE KEY UPDATE fingerprint=VALUES(fingerprint)",
        [target.host, target.port, fingerprint, "ssh-ed25519", actorId]
      );
      await db.execute(
        "INSERT INTO wc_remote_checks(id,workspace_id,actor_id,target_json,fingerprint,inventory_json,created_at,expires_at) VALUES(?,'default',?,?,?,?,NOW(),DATE_ADD(NOW(),INTERVAL 15 MINUTE))",
        [
          checkId,
          actorId,
          JSON.stringify(target),
          fingerprint,
          JSON.stringify(inventory),
        ]
      );
      await db.execute(
        "INSERT INTO wc_remote_secrets(id,workspace_id,check_id,purpose,ciphertext,created_at,expires_at) VALUES(?,'default',?,'ssh',?,NOW(),DATE_ADD(NOW(),INTERVAL 15 MINUTE))",
        [secretId, checkId, encrypt(sshPassword, `remote:ssh:${secretId}`)]
      );
      return checkId;
    }
    const settings = {
      profileId: profile.id,
      profileRevision: profile.revision,
      username: "Administrator",
      password: windowsPassword,
      remotePort: 3390,
      retries: 10,
      label: "Portal SSH fixture",
      postInstall: {
        getFiles: false,
        apps: [],
        customFileUrl: "",
        runAttachedScript: false,
      },
    };
    const review = await request(
      "/api/admin/remote/reviews",
      "POST",
      { checkId: await seedCheck(), settings },
      201
    );
    assert.equal(review.settings.username, "Administrator");
    assert.equal(review.settings.remotePort, 3390);
    assert.ok(!JSON.stringify(review).includes(windowsPassword));
    assert.ok(!JSON.stringify(review).includes(sshPassword));
    ok("Review permits runtime Windows settings and excludes both passwords");
    const launch = {
      reviewId: review.id,
      approvalDigest: review.approvalDigest,
      idempotencyKey: randomUUID(),
      eraseConfirmed: true,
      backupConfirmed: true,
      recoveryConfirmed: true,
    };
    await request(
      "/api/admin/remote/jobs",
      "POST",
      { ...launch, eraseConfirmed: false },
      400
    );
    ok("Explicit target/disk erasure review required");
    const queued = (
      await request("/api/admin/remote/jobs", "POST", launch, 201)
    ).job;
    assert.equal(queued.state, "queued");
    const again = (await request("/api/admin/remote/jobs", "POST", launch, 201))
      .job;
    assert.equal(again.id, queued.id);
    ok("Durable queue and duplicate-click idempotency");
    await request(
      "/api/admin/remote/jobs",
      "POST",
      { ...launch, reviewId: randomUUID() },
      409
    );
    ok("Idempotency cannot substitute another approval");
    const review2 = await request(
      "/api/admin/remote/reviews",
      "POST",
      { checkId: await seedCheck(), settings },
      201
    );
    await request(
      "/api/admin/remote/jobs",
      "POST",
      {
        ...launch,
        reviewId: review2.id,
        approvalDigest: review2.approvalDigest,
        idempotencyKey: randomUUID(),
      },
      409
    );
    ok("Second unresolved installation on same target blocked");
    const queue = new RemoteQueue();
    const raw = await queue.raw(queued.id);
    assert.ok(raw);
    const normalize = (v: any) =>
      typeof v === "string" ? v : JSON.stringify(v);
    assert.equal(
      decrypt(
        normalize(raw!.ssh_ciphertext),
        `remote:ssh:${raw!.ssh_secret_id}`
      ),
      sshPassword
    );
    assert.equal(
      JSON.parse(
        decrypt(
          normalize(raw!.settings_ciphertext),
          `remote:settings:${raw!.settings_secret_id}`
        )
      ).password,
      windowsPassword
    );
    ok(
      "Encrypted durable settings and exact punctuation-safe SSH secret round-trip"
    );
    const claim = await queue.claim("fixture-worker");
    assert.equal(claim?.id, queued.id);
    assert.equal(
      await queue.setState(queued.id, "checking", null, "fixture-worker"),
      true
    );
    assert.equal(await queue.heartbeat("fixture-worker", queued.id), true);
    ok("Transactional claim, leased transitions and heartbeat");
    assert.equal(
      await queue.setState(queued.id, "sending", null, "fixture-worker"),
      true
    );
    const issued = await issueRemoteCommand(
      actorId,
      settings,
      inventory,
      queued.id
    );
    const replay = await issueRemoteCommand(
      actorId,
      settings,
      inventory,
      queued.id
    );
    assert.deepEqual(replay, issued);
    const [commands]: any = await db.query(
      "SELECT target_json,config_json,artifact_ciphertext FROM wc_commands WHERE id=?",
      [issued.commandId]
    );
    const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
    assert.equal(parse(commands[0].target_json).targetDisk, "/dev/vda");
    assert.equal(
      parse(commands[0].target_json).expectedHostname,
      "fixture-target"
    );
    assert.equal(parse(commands[0].config_json).remoteJobId, queued.id);
    assert.ok(!issued.bootstrap.includes(windowsPassword));
    assert.ok(!issued.bootstrap.includes(sshPassword));
    ok("Shared issuance pins approved host/disk and exact idempotent replay");
    await queue.saveIssuance(
      queued.id,
      issued.commandId,
      issued.groupId,
      "fixture-worker"
    );
    await queue.setState(queued.id, "launching", null, "fixture-worker");
    await request(
      `/api/admin/remote/jobs/${queued.id}/cancel`,
      "POST",
      {},
      409
    );
    ok("Cancellation cannot claim to undo committed launch");
    await db.execute(
      "UPDATE wc_remote_jobs SET lease_until=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
      [queued.id]
    );
    await queue.recoverStale();
    assert.equal((await queue.get(queued.id))!.state, "launch_uncertain");
    ok(
      "Restart around launch becomes uncertain, never automatic destructive rerun"
    );
    await queue.setState(queued.id, "handed_off", null);
    await queue.clearSecrets(queued.id);
    const [secrets]: any = await db.query(
      "SELECT ciphertext,cleared_at FROM wc_remote_secrets WHERE job_id=?",
      [queued.id]
    );
    assert.ok(secrets.length >= 2);
    assert.ok(
      secrets.every(
        (x: any) =>
          x.cleared_at && !JSON.stringify(x.ciphertext).includes('"data"')
      )
    );
    ok("Verified handoff clears decryptable transient envelopes");
    const review3 = await request(
      "/api/admin/remote/reviews",
      "POST",
      { checkId: await seedCheck(), settings },
      201
    );
    await request(
      "/api/admin/remote/jobs",
      "POST",
      {
        ...launch,
        reviewId: review3.id,
        approvalDigest: review3.approvalDigest,
        idempotencyKey: randomUUID(),
      },
      409
    );
    ok("Handoff keeps target excluded while Windows outcome is still unknown");
    const health = await request("/api/admin/remote/health");
    assert.ok("workerAlive" in health);
    ok("Measured worker/queue health endpoint");
    await db.execute("UPDATE wc_accounts SET role='operator' WHERE id=?", [
      actorId,
    ]);
    await request("/api/admin/remote/config", "GET", undefined, 403);
    await db.execute("UPDATE wc_accounts SET role='owner' WHERE id=?", [
      actorId,
    ]);
    ok("Operator cannot use owner/admin remote capabilities");
    console.log(
      `Remote installation acceptance: ${checks} checks passed; no target SSH session or installation executed.`
    );
  } finally {
    if (actorId)
      await db.execute("UPDATE wc_accounts SET role='owner' WHERE id=?", [
        actorId,
      ]);
    await db.end();
    await pool().end();
  }
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      error instanceof Error ? error.message : "Remote fixture failed"
    );
    process.exit(1);
  });
