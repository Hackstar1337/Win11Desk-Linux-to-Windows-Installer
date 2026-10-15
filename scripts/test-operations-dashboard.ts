import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
const base = process.env.TEST_BASE || "http://127.0.0.1:3118";
const pass = "Synthetic owner password long 123!";
let cookie = "",
  csrf = "",
  count = 0;
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
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(r.status, status, method + " " + path);
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  const t = await r.text();
  let v: any;
  try {
    v = JSON.parse(t);
  } catch {
    return t;
  }
  if (v.csrf) csrf = v.csrf;
  return v;
}
function ok(label: string) {
  count++;
  console.log("PASS", label);
}
async function main() {
  assert.ok(
    new URL(process.env.DATABASE_URL!).pathname.startsWith("/win11desk_test")
  );
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  await req("/api/admin/operations/health", "GET", undefined, 401);
  await req("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: pass,
  });
  const me = await req("/api/auth/me");
  const owner = me.user.id;
  const [before]: any = await db.query("SELECT * FROM wc_settings");
  const [presetsBefore]: any = await db.query("SELECT * FROM wc_presets");
  await req("/api/admin/settings", "PATCH", { revision: 1, settings: {} }, 410);
  await req(
    "/api/admin/presets",
    "POST",
    { label: "removed", settings: {} },
    410
  );
  await req("/api/admin/presets/" + randomUUID(), "DELETE", undefined, 410);
  await req("/api/admin/activity", "GET", undefined, 404);
  const [after]: any = await db.query("SELECT * FROM wc_settings");
  const [presetsAfter]: any = await db.query("SELECT * FROM wc_presets");
  assert.deepEqual(after, before);
  assert.deepEqual(presetsAfter, presetsBefore);
  ok("Removed editors reject writes; stored settings/presets preserved");
  const health = await req("/api/admin/operations/health");
  assert.ok(health.checkedAt);
  assert.ok(Array.isArray(health.checks));
  assert.equal(health.migrations.pending.length, 0);
  assert.ok(health.profiles);
  assert.ok(health.commands);
  assert.equal(health.callback.observedHttps, "not-checked");
  assert.equal(health.backup.outcome, "not-reported");
  assert.ok(!JSON.stringify(health).includes(".iso"));
  assert.ok(!JSON.stringify(health).includes("isoUrl"));
  ok(
    "Measured health, migrations, profile counts and honest unknown backup/TLS"
  );
  const attention = await req("/api/admin/operations/attention");
  assert.ok(Array.isArray(attention.items));
  assert.ok(attention.items.length <= 50);
  assert.ok(
    attention.items.every((x: any) =>
      ["failed", "stale", "unknown"].includes(x.status)
    )
  );
  ok("Bounded attention does not invent installation success");
  const diagnostics = await req("/api/admin/operations/diagnostics");
  const safe = JSON.stringify(diagnostics);
  for (const forbidden of [
    pass,
    "iso_url",
    "isoUrl",
    "credential_ciphertext",
    "DATABASE_URL",
    "VAULT_KEY",
    "BOOTSTRAP_SECRET",
    "reportToken",
    "deliveryCapability",
  ])
    assert.ok(!safe.includes(forbidden));
  ok("Allowlisted diagnostics exclude secrets and media links");
  await req("/api/admin/operations/guides/backup");
  await req("/api/admin/operations/guides/invalid", "GET", undefined, 404);
  ok("Recovery guides use fixed whitelist");
  const [runRows]: any = await db.query(
    "SELECT run_id FROM wc_run_meta WHERE owner_id=? LIMIT 1",
    [owner]
  );
  assert.ok(runRows.length);
  const run = runRows[0].run_id;
  const [original]: any = await db.query(
    "SELECT stage,archived_at,trashed_at,purged_at FROM wc_run_meta WHERE run_id=?",
    [run]
  );
  try {
    await db.execute(
      "UPDATE wc_run_meta SET stage='unrecognized_stage',archived_at=NULL,trashed_at=NULL,purged_at=NULL WHERE run_id=?",
      [run]
    );
    const invalid = await req("/api/admin/operations/attention");
    const item = invalid.items.find((v: any) => v.id === run);
    assert.equal(item.status, "unknown");
  } finally {
    await db.execute(
      "UPDATE wc_run_meta SET stage=?,archived_at=?,trashed_at=?,purged_at=? WHERE run_id=?",
      [
        original[0].stage,
        original[0].archived_at,
        original[0].trashed_at,
        original[0].purged_at,
        run,
      ]
    );
  }
  ok("Invalid stage remains unknown, not a guessed stale failure");

  const ownId = randomUUID(),
    otherId = randomUUID(),
    otherOwner = randomUUID();
  // The existing schema has no owner FK on notifications; synthetic principal tests remain local.
  await db.execute(
    "INSERT INTO wc_notifications(id,workspace_id,owner_id,run_id,kind,title,body,created_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3)),(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",
    [
      ownId,
      "default",
      owner,
      run,
      "failed",
      "Synthetic failure",
      "Open details",
      otherId,
      "default",
      otherOwner,
      run,
      "failed",
      "Other principal",
      "Must not leak",
    ]
  );
  const filtered = await req(
    "/api/admin/notifications?read=unread&kind=failed"
  );
  assert.ok(filtered.items.some((x: any) => x.id === ownId));
  assert.ok(!filtered.items.some((x: any) => x.id === otherId));
  await req("/api/admin/notifications?kind=invalid", "GET", undefined, 400);
  await req("/api/admin/notifications/read-all", "POST", {}, 403, {
    "X-CSRF-Token": "invalid",
  });
  const all = await req("/api/admin/notifications/read-all", "POST", {});
  assert.ok(all.readCount <= 100);
  const [others]: any = await db.query(
    "SELECT read_at FROM wc_notifications WHERE id=?",
    [otherId]
  );
  assert.equal(others[0].read_at, null);
  ok("Notification filters, CSRF and bounded principal-scoped read-all");
  await db.execute("DELETE FROM wc_notifications WHERE id IN (?,?)", [
    ownId,
    otherId,
  ]);
  await req("/api/auth/step-up", "POST", { password: pass });
  const invite = await req(
    "/api/auth/users/invite",
    "POST",
    { email: "ops-viewer-" + randomUUID() + "@example.test", role: "viewer" },
    201
  );
  const ownerCookie = cookie,
    ownerCsrf = csrf;
  await req(
    "/api/auth/invites/accept",
    "POST",
    { token: invite.token, name: "Ops Viewer", password: pass },
    201
  );
  const viewerHealth = await req("/api/admin/operations/health");
  assert.equal(viewerHealth.commands, null);
  const ownAttention = await req("/api/admin/operations/attention");
  assert.equal(ownAttention.items.length, 0);
  await req("/api/admin/operations/diagnostics", "GET", undefined, 403);
  await req("/api/admin/notifications", "GET", undefined, 403);
  await req("/api/admin/notifications/read-all", "POST", {}, 403);
  ok(
    "Viewer gets only scoped health/attention and no admin notifications or diagnostics"
  );
  cookie = ownerCookie;
  csrf = ownerCsrf;
  const [audit]: any = await db.query(
    "SELECT id FROM wc_audit WHERE action='notification.read-all' LIMIT 1"
  );
  assert.ok(audit.length);
  ok("Internal administrative audit retained without Activity page");
  await db.end();
  console.log(
    "OPERATIONS DASHBOARD COMPLETE",
    count,
    "checks; isolated DB only."
  );
}
main().catch(e => {
  console.error("OPERATIONS DASHBOARD FAILURE", e.message);
  process.exit(1);
});
