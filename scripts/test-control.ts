import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { config } from "../server/control/config";
const base = process.env.TEST_BASE || "http://127.0.0.1:3100";
let cookie = "",
  csrf = "";
const pass = "Synthetic owner password long 123!";
let checks = 0;
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
  extra: Record<string, string> = {}
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.APP_PUBLIC_URL!,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  assert.equal(r.status, status, `${method} ${path}: ${text.slice(0, 200)}`);
  const sc = r.headers.get("set-cookie");
  if (sc) {
    cookie = sc.split(";")[0];
    assert.ok(
      sc.includes("HttpOnly") &&
        sc.includes("Secure") &&
        sc.includes("SameSite=Lax")
    );
  }
  try {
    const b = JSON.parse(text);
    if (b.csrf) csrf = b.csrf;
    return b;
  } catch {
    return text;
  }
}
function ok(s: string) {
  checks++;
  console.log("PASS", s);
}
function openEnvelope(value: string, associatedData: string): string {
  const e = JSON.parse(value) as {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    config().vaultKey,
    Buffer.from(e.iv, "hex")
  );
  decipher.setAAD(Buffer.from(`win11desk-control:v4:${associatedData}`));
  decipher.setAuthTag(Buffer.from(e.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(e.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
async function capability(db: mysql.Connection, id: string): Promise<string> {
  const [rows]: any = await db.query(
    "SELECT capability_envelope FROM wc_delivery_secrets WHERE command_id=?",
    [id]
  );
  assert.ok(rows[0]?.capability_envelope, "delivery capability envelope");
  return openEnvelope(rows[0].capability_envelope, `delivery:${id}`);
}
async function main() {
  assert.ok(
    process.env.DATABASE_URL?.includes("win11desk_test"),
    "Isolated test database required"
  );
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  await req("/api/admin/deployments", "GET", undefined, 401);
  ok("Anonymous private API blocked");
  const status = await req("/api/auth/setup/status");
  if (status.available) {
    const setup = await req(
      "/api/auth/setup",
      "POST",
      {
        secret: process.env.BOOTSTRAP_SECRET,
        email: "owner@example.test",
        name: "Test Owner",
        password: pass,
      },
      201
    );
    assert.equal(setup.user.role, "owner");
    assert.equal(setup.recoveryCodes.length, 10);
  } else
    await req("/api/auth/login", "POST", {
      email: "owner@example.test",
      password: pass,
    });
  ok("Owner bootstrap/session/recovery");
  await req(
    "/api/auth/setup",
    "POST",
    {
      secret: process.env.BOOTSTRAP_SECRET,
      email: "other@example.test",
      name: "Other",
      password: pass,
    },
    409
  );
  ok("Setup closes");
  const [acc]: any = await db.query("SELECT password_hash FROM wc_accounts");
  assert.ok(acc[0].password_hash.startsWith("$argon2id$"));
  ok("Owner password hashed");
  await req("/api/admin/commands", "POST", {}, 403, { "X-CSRF-Token": "bad" });
  ok("CSRF rejected");
  const source =
      "https://example.com/windows11.iso",
    wp = "Win123!x";
  const profileInput = {
    name: `Core synthetic ${crypto.randomUUID().slice(0, 8)}`,
    osId: "windows-11-pro",
    isoUrl: source,
    imageName: "Windows 11 Pro",
    description: "Synthetic core integration profile",
    username: "Administrator",
    remotePort: 22,
    retries: 10,
  };
  const profileCreated = await req(
    "/api/admin/profiles",
    "POST",
    profileInput,
    201
  );
  const profile = profileCreated.profile;
  assert.equal(profile.revision, 1);
  ok("Synthetic configured profile created through admin API");
  const input = {
    profileId: profile.id,
    profileRevision: profile.revision,
    idempotencyKey: crypto.randomUUID(),
    label: "test-command",
    username: "Administrator",
    password: wp,
    remotePort: 22,
    retries: 10,
    count: 1,
    uniquePasswords: false,
    tags: ["synthetic"],
    provider: "test-provider",
  };
  await req("/api/admin/commands", "POST", { ...input, isoUrl: source }, 400);
  await req(
    "/api/admin/commands",
    "POST",
    { ...input, input: { settings: {} } },
    400
  );
  await req(
    "/api/admin/commands",
    "POST",
    { ...input, target: { isoUrl: source } },
    400
  );
  await req(
    "/api/admin/commands",
    "POST",
    { ...input, password: "Win12!x" },
    400
  );
  const issued = await req("/api/admin/commands", "POST", input);
  const c = (issued.items || issued.commands)[0];
  assert.ok(c.command && !c.command.includes(wp));
  assert.ok(c.command.includes("/setup/v3.sh"));
  assert.ok(!c.command.includes(c.id) && !c.command.includes(profile.id));
  assert.ok(
    c.profile && !Object.prototype.hasOwnProperty.call(c.profile, "isoUrl")
  );
  execFileSync("bash", ["-n"], { input: c.command });
  ok("Private Bash generation/syntax");
  const [vault]: any = await db.query("SELECT * FROM wc_commands WHERE id=?", [
    c.id,
  ]);
  assert.ok(!JSON.stringify(vault).includes(wp));
  ok("Credential/artifact vault encryption");
  const token = await capability(db, c.id);
  const artifact = await req("/api/installer/delivery", "POST", {
    id: c.id,
    token,
    profileId: profile.id,
    profileRevision: profile.revision,
  });
  assert.equal(typeof artifact, "string");
  assert.ok(artifact.includes(source) && artifact.includes("AUTOMATIC='1'"));
  assert.ok(
    c.command.includes(createHash("sha256").update(artifact).digest("hex"))
  );
  execFileSync("bash", ["-n"], { input: artifact });
  ok("Hash-verified delivery/direct source/automatic mode (not executed)");
  await req(
    "/api/installer/delivery",
    "POST",
    { id: c.id, token: "a".repeat(64) },
    404
  );
  ok("Wrong capability blocked");
  const retry = await req("/api/admin/commands", "POST", input);
  assert.equal((retry.items || retry.commands)[0].id, c.id);
  assert.equal((retry.items || retry.commands)[0].command, c.command);
  ok("Idempotent issuance");
  await req(`/api/admin/commands/${c.id}/retrieve`, "POST", {}, 401);
  await req("/api/auth/step-up", "POST", { password: pass });
  const retrieved = await req(
    `/api/admin/commands/${c.id}/retrieve`,
    "POST",
    {}
  );
  assert.equal(retrieved.id, c.id);
  assert.equal(retrieved.command, c.command);
  ok("Step-up command retrieval preserves compact command identity");
  await req("/api/auth/logout", "POST", {});
  await req("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: pass,
  });
  const group = artifact.match(/TRACK_GROUP='([^']+)'/)?.[1],
    write = artifact.match(/TRACK_GROUP_TOKEN='([a-f0-9]{64})'/)?.[1];
  assert.ok(group && write);
  const metadata = {
    executionId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    hostname: "synthetic-vps",
    disk: "/dev/vda",
    rdpPort: 22,
    publicIP: "192.0.2.123",
  };
  const run = await req(
    `/api/installer/tracking/${group}/runs`,
    "POST",
    metadata,
    201,
    { Authorization: "Bearer " + write }
  );
  const again = await req(
    `/api/installer/tracking/${group}/runs`,
    "POST",
    metadata,
    201,
    { Authorization: "Bearer " + write }
  );
  assert.equal(run.runId, again.runId);
  assert.equal(run.reportToken, again.reportToken);
  ok("Stable execution registration");
  const cb = (body: any, status = 204) =>
    req(
      `/api/installer/tracking/runs/${run.runId}/events`,
      "POST",
      body,
      status,
      { Authorization: "Bearer " + run.reportToken }
    );
  for (const stage of ["preflight", "staging", "rebooting", "installer_booted"])
    await cb({ stage });
  await cb({
    stage: "downloading",
    phase: "payload",
    downloadedBytes: 512,
    totalBytes: 1024,
  });
  await req(
    `/api/installer/tracking/runs/${run.runId}/heartbeat`,
    "POST",
    {},
    204,
    { Authorization: "Bearer " + run.reportToken }
  );
  const h = await req("/api/admin/deployments");
  const r = (h.items || h.deployments).find((v: any) => v.id === run.runId);
  assert.ok(r && r.createdAt);
  assert.equal(r.publicIP, metadata.publicIP);
  assert.equal(r.username, "Administrator");
  assert.equal(r.downloadedBytes, 512);
  assert.equal(r.rdpListening, null);
  await db.query(
    "UPDATE wc_run_meta SET last_heartbeat_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE),last_event_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) WHERE run_id=?",
    [run.runId]
  );
  await cb({
    stage: "downloading",
    phase: "payload",
    downloadedBytes: 600,
    totalBytes: 1024,
  });
  const live = await req(`/api/admin/deployments/${run.runId}`);
  assert.equal(live.deployment.stale, false);
  assert.equal(live.deployment.status, "installing");
  const staleList = await req("/api/admin/deployments?status=stale");
  assert.ok(!staleList.items.some((item: any) => item.id === run.runId));
  const overview = await req("/api/admin/overview");
  assert.ok(
    overview.counts.commands >= 1 &&
      overview.counts.active >= 1 &&
      overview.counts.reporting >= 1
  );
  ok(
    "Fresh progress callback counts as liveness; overview counts are real and listener unknown stays null"
  );
  assert.ok(!JSON.stringify(h).includes(wp));
  ok("Central history IP/user/date/counters/no plaintext");

  const reveal = await req(
    `/api/admin/deployments/${run.runId}/reveal`,
    "POST",
    {}
  );
  assert.equal(reveal.password, wp);
  await req("/api/admin/activity", "GET", undefined, 404);
  const auditDb = await mysql.createConnection(process.env.DATABASE_URL!);
  const [auditRows]: any = await auditDb.query(
    'SELECT action,metadata_json FROM wc_audit WHERE action="credential.reveal" ORDER BY created_at DESC LIMIT 5'
  );
  assert.ok(auditRows.length);
  assert.ok(!JSON.stringify(auditRows).includes(wp));
  await auditDb.end();
  await req(`/api/admin/deployments/${run.runId}/reveal`, "POST", {}, 403, {
    "X-CSRF-Token": "invalid",
  });
  ok("Eight-character Windows credential reveal without repeat admin password");
  await cb({
    stage: "downloading",
    phase: "integrity",
    downloadedBytes: 256,
    totalBytes: 1024,
  });
  let progress = await req(`/api/admin/deployments/${run.runId}`);
  assert.equal(progress.deployment.phase, "integrity");
  assert.equal(progress.deployment.totalBytes, 1024);
  await cb({ stage: "downloading", phase: "payload", downloadedBytes: 10 });
  progress = await req(`/api/admin/deployments/${run.runId}`);
  assert.equal(progress.deployment.phase, "payload");
  assert.equal(progress.deployment.totalBytes, null);
  assert.equal(progress.deployment.downloadedBytes, 10);
  await cb({
    stage: "downloading",
    phase: "payload",
    downloadedBytes: 512,
    totalBytes: 1024,
  });
  ok(
    "Real phase counters reset obsolete totals; known total restored only when reported"
  );
  const labelPath = `/api/admin/deployments/${run.runId}`;
  const sibling = await req(
    `/api/installer/tracking/${group}/runs`,
    "POST",
    {
      ...metadata,
      executionId: crypto.randomUUID(),
      hostname: "synthetic-sibling",
    },
    201,
    { Authorization: "Bearer " + write }
  );
  const [frozen]: any = await db.query(
    "SELECT label,installer_digest,artifact_ciphertext,credential_ciphertext FROM wc_commands WHERE id=?",
    [c.id]
  );
  await req(labelPath, "PATCH", { label: "Europe Production" });
  const named = await req(labelPath);
  assert.equal(named.deployment.label, "Europe Production");
  assert.equal(named.deployment.originalLabel, "test-command");
  assert.equal(named.deployment.createdAt, r.createdAt);
  assert.equal(
    (await req(`/api/admin/deployments/${sibling.runId}`)).deployment.label,
    "test-command"
  );
  const [unchanged]: any = await db.query(
    "SELECT label,installer_digest,artifact_ciphertext,credential_ciphertext FROM wc_commands WHERE id=?",
    [c.id]
  );
  assert.deepEqual(unchanged, frozen);
  assert.equal(
    (await req("/api/admin/deployments?q=Europe%20Production")).items[0].id,
    run.runId
  );
  assert.ok(
    (await req("/api/admin/deployments/export")).includes("Europe Production")
  );
  ok(
    "Per-run label updates detail/search/CSV and preserves command bytes, sibling label and created date"
  );
  await db.query(
    "UPDATE wc_run_meta SET last_heartbeat_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE),last_event_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) WHERE run_id=?",
    [run.runId]
  );
  const attention = await req("/api/admin/operations/attention");
  assert.ok(
    attention.items.some(
      (item: any) => item.id === run.runId && item.label === "Europe Production"
    )
  );
  await cb({
    stage: "downloading",
    phase: "payload",
    downloadedBytes: 600,
    totalBytes: 1024,
  });
  ok(
    "Awaiting-update Operations attention retains edited run label and clears after fresh callback"
  );
  await req(labelPath, "PATCH", { label: "x".repeat(161) }, 400);
  await req(labelPath, "PATCH", { label: "bad\nlabel" }, 400);
  await req(labelPath, "PATCH", { label: "CSRF bypass" }, 403, {
    "X-CSRF-Token": "invalid",
  });
  await req(labelPath, "PATCH", { label: "" });
  assert.equal((await req(labelPath)).deployment.label, "test-command");
  const [labelAudit]: any = await db.query(
    "SELECT metadata_json FROM wc_audit WHERE action='deployment.update' AND JSON_EXTRACT(metadata_json,'$.runId')=?",
    [run.runId]
  );
  assert.ok(labelAudit.length);
  ok(
    "Label validation, CSRF and audit enforced; reset restores original label"
  );
  await req(labelPath, "PATCH", { label: "Delete me on purge" });
  for (const stage of ["media_verified", "preparing", "windows_setup"])
    await cb({ stage });
  await cb({
    stage: "windows_booted",
    windowsEdition: "Professional",
    windowsBuild: 26300,
    windowsInstallationType: "Client",
  });
  await cb({
    stage: "windows_ready",
    windowsEdition: "Professional",
    windowsBuild: 26300,
    windowsInstallationType: "Client",
    rdpListening: true,
  });
  const d = await req(`/api/admin/deployments/${run.runId}`);
  assert.equal(d.deployment.stage, "windows_ready");
  assert.ok(d.deployment.finishedAt);
  const completedAt = d.deployment.finishedAt;
  const sameCompletion = await req(`/api/admin/deployments/${run.runId}`);
  assert.equal(sameCompletion.deployment.finishedAt, completedAt);
  assert.ok(d.events.length >= 7);
  ok("Windows completion evidence and timeline");
  await cb({ stage: "failed" }, 400);
  ok("Delayed terminal change rejected");
  const csv = await req("/api/admin/deployments/export");
  assert.ok(csv.includes(metadata.publicIP) && !csv.includes(wp));
  ok("Password-free CSV");
  await req(`/api/admin/deployments/${run.runId}`, "PATCH", {
    notes: "Test note",
    tags: ["synthetic"],
  });
  await req(`/api/admin/deployments/${run.runId}`, "PATCH", { archive: true });
  const archived = await req("/api/admin/deployments?trash=archive");
  assert.ok(archived.items.some((item: any) => item.id === run.runId));
  await req(`/api/admin/deployments/${run.runId}/restore`, "POST", {});
  const active = await req("/api/admin/deployments");
  assert.ok(active.items.some((item: any) => item.id === run.runId));
  ok(
    "Archived history restores to active without deleting its credentials or dates"
  );
  await req(`/api/admin/deployments/${run.runId}/trash`, "POST", {});
  await req(`/api/admin/deployments/${run.runId}/restore`, "POST", {});
  await req(`/api/admin/commands/${c.id}/revoke`, "POST", {});
  await req("/api/installer/delivery", "POST", { id: c.id, token }, 404);
  ok("Notes/trash/restore/revoke");
  await req(
    `/api/admin/deployments/${run.runId}/purge`,
    "POST",
    { confirm: run.runId },
    401
  );
  await req("/api/auth/step-up", "POST", { password: pass });
  await req(`/api/admin/deployments/${run.runId}/purge`, "POST", {
    confirm: run.runId,
  });
  const [gone]: any = await db.query(
    "SELECT id FROM installerTrackingRuns WHERE id=?",
    [run.runId]
  );
  assert.equal(gone.length, 0);
  const [goneLabels]: any = await db.query(
    "SELECT run_id FROM wc_run_labels WHERE run_id=?",
    [run.runId]
  );
  assert.equal(goneLabels.length, 0);
  await req(`/api/admin/deployments/${run.runId}`, "GET", undefined, 404);
  ok("Terminal purge removes actual tracker records");
  await req("/api/auth/logout", "POST", {});
  await req("/api/auth/me", "GET", undefined, 401);
  await req("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: pass,
  });
  ok("Revocable session/logout/login");
  await db.end();
  console.log("INTEGRATION COMPLETE", checks, "checks; no OS installer run.");
}
main().catch(e => {
  console.error("TEST FAILURE", e.message);
  process.exit(1);
});
