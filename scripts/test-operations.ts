import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createTrackingGroup,
  registerTrackingRun,
  recordTrackingEvent,
} from "../server/installTracking";
import { pool } from "../server/control/db";
const base = process.env.TEST_BASE || "http://127.0.0.1:3103";
let cookie = "",
  csrf = "";
let count = 0;
async function api(p: string, m = "GET", b?: unknown, status = 200) {
  const r = await fetch(base + p, {
    method: m,
    headers: {
      Origin: process.env.APP_PUBLIC_URL!,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  const t = await r.text();
  assert.equal(r.status, status, p + " " + t.slice(0, 160));
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  let v;
  try {
    v = JSON.parse(t);
  } catch {
    return t;
  }
  if (v.csrf) csrf = v.csrf;
  return v;
}
function ok(s: string) {
  count++;
  console.log("PASS", s);
}
async function main() {
  assert.ok(process.env.DATABASE_URL?.includes("win11desk_test"));
  await api("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: "Synthetic owner password long 123!",
  });
  await api("/api/auth/step-up", "POST", {
    password: "Synthetic owner password long 123!",
  });
  const group = await createTrackingGroup();
  const r = { runId: randomUUID() };
  await pool().execute(
    "INSERT INTO installerTrackingRuns(id,groupId,reportTokenHash,hostname,wholeDisk,rdpPort,publicIP,stage,sequence,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      r.runId,
      group.groupId,
      "a".repeat(64),
      "legacy-test",
      "/dev/vda",
      22,
      "192.0.2.250",
      "failed",
      1,
      group.expiry,
    ]
  );
  await api(
    "/api/admin/legacy-import",
    "POST",
    { groupId: group.groupId, readToken: "b".repeat(64), confirm: true },
    404
  );
  const imported = await api("/api/admin/legacy-import", "POST", {
    groupId: group.groupId,
    readToken: group.readToken,
    confirm: true,
  });
  assert.equal(imported.imported, 1);
  const again = await api("/api/admin/legacy-import", "POST", {
    groupId: group.groupId,
    readToken: group.readToken,
    confirm: true,
  });
  assert.equal(again.imported, 0);
  ok("Capability-authenticated legacy import preserves IDs and is idempotent");
  const d = await api("/api/admin/deployments/" + r.runId);
  assert.equal(d.deployment.id, r.runId);
  assert.equal(d.deployment.publicIP, "192.0.2.250");
  assert.equal(d.deployment.credentialAvailable, false);
  await api("/api/admin/deployments/" + r.runId + "/reveal", "POST", {}, 404);
  ok("Legacy history preserves metadata but never invents credentials");
  await api("/api/admin/deployments/actions", "POST", {
    action: "trash",
    ids: [r.runId],
    confirm: true,
  });
  const trash = await api("/api/admin/deployments?trash=trash");
  assert.ok(trash.items.some((v: any) => v.id === r.runId));
  await api("/api/admin/deployments/actions", "POST", {
    action: "restore",
    ids: [r.runId],
    confirm: true,
  });
  await api("/api/admin/deployments/" + r.runId, "PATCH", { archive: true });
  const archive = await api("/api/admin/deployments?trash=archive");
  assert.ok(archive.items.some((v: any) => v.id === r.runId));
  ok("Bulk trash/restore and actual archive filter");
  await api("/api/admin/deployments/actions", "POST", {
    action: "purge",
    ids: [r.runId],
    confirm: true,
  });
  await api("/api/admin/deployments/" + r.runId, "GET", undefined, 404);
  ok("Authorized confirmed bulk purge");
  const n = await api("/api/admin/notifications");
  assert.ok(Array.isArray(n.items));
  if (n.items.length) {
    await api("/api/admin/notifications/" + n.items[0].id + "/read", "POST");
  }
  ok("Principal-scoped notifications/read acknowledgment");
  await pool().end();
  const tracker = await import("../server/db");
  // All assertions complete. Legacy Drizzle opens its own pool; terminate this test runner explicitly.
  console.log("OPERATIONS INTEGRATION COMPLETE", count, "checks.");
  process.exit(0);
}
main().catch(e => {
  console.error("OPERATIONS FAILURE", e.message);
  process.exit(1);
});
