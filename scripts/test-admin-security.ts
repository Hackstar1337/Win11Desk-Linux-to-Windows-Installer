import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { totpCode } from "../server/control/crypto";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_BASE || "http://127.0.0.1:3100";
let cookie = "",
  csrf = "";
const pass = "Synthetic owner password long 123!";
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
  const text = await r.text();
  assert.equal(r.status, status, `${p} ${text.slice(0, 150)}`);
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  if (data.csrf) csrf = data.csrf;
  return data;
}
function ok(s: string) {
  count++;
  console.log("PASS", s);
}
async function main() {
  assert.ok(process.env.DATABASE_URL?.includes("win11desk_test"));
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  await api("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: pass,
  });
  await api("/api/auth/step-up", "POST", { password: pass });
  const initial = await api("/api/admin/settings");
  await api(
    "/api/admin/settings",
    "PATCH",
    { revision: initial.revision, settings: {} },
    410
  );
  await api(
    "/api/admin/presets",
    "POST",
    { label: "retired", settings: {} },
    410
  );
  await api("/api/admin/presets/" + randomUUID(), "DELETE", undefined, 410);
  const unchanged = await api("/api/admin/settings");
  assert.deepEqual(unchanged, initial);
  ok("Removed editors reject writes and retain stored defaults/presets");
  const profileResult = await api(
    "/api/admin/profiles",
    "POST",
    {
      name: `Security synthetic ${randomUUID().slice(0, 8)}`,
      osId: "windows-11-pro",
      isoUrl: "https://example.test/security-windows11.iso",
      imageName: "Windows 11 Pro",
      description: "Synthetic security integration profile",
      username: "Administrator",
      remotePort: 22,
      retries: 10,
    },
    201
  );
  const securityProfile = profileResult.profile;
  const batchInput = {
    profileId: securityProfile.id,
    profileRevision: securityProfile.revision,
    username: "Administrator",
    password: "Security batch password 123!",
    remotePort: 22,
    retries: 10,
    idempotencyKey: randomUUID(),
    label: "security-batch",
    tags: ["synthetic", "security"],
    provider: "security-test-provider",
    count: 2,
    uniquePasswords: true,
  };
  const batch = await api("/api/admin/commands", "POST", batchInput);
  assert.equal(batch.items.length, 2);
  const retry = await api("/api/admin/commands", "POST", batchInput);
  assert.deepEqual(
    retry.items.map((v: any) => v.id),
    batch.items.map((v: any) => v.id)
  );
  assert.deepEqual(
    retry.items.map((v: any) => v.command),
    batch.items.map((v: any) => v.command)
  );
  const [secrets]: any = await db.query(
    "SELECT credential_ciphertext FROM wc_commands WHERE batch_id=(SELECT batch_id FROM wc_commands WHERE id=?)",
    [batch.items[0].id]
  );
  assert.notEqual(
    secrets[0].credential_ciphertext,
    secrets[1].credential_ciphertext
  );
  ok("Unique-password batch and exact immutable replay");
  const before = batch.items[0].command;
  await api("/api/admin/commands/" + batch.items[0].id + "/revoke", "POST", {});
  await api(
    "/api/admin/commands/" + batch.items[0].id + "/retrieve",
    "POST",
    {},
    410
  );
  ok("Revoked command cannot be silently revived");
  await api("/api/admin/overview");
  await api("/api/admin/readiness");
  await api("/api/admin/activity", "GET", undefined, 404);
  const [activity]: any = await db.query(
    'SELECT action FROM wc_audit WHERE action="command.issue" LIMIT 1'
  );
  assert.ok(activity.length);
  ok("Real overview/readiness/audit");
  const invite = await api(
    "/api/auth/users/invite",
    "POST",
    { email: "viewer-" + randomUUID() + "@example.test", role: "viewer" },
    201
  );
  const ownerCookie = cookie,
    ownerCsrf = csrf;
  await api(
    "/api/auth/invites/accept",
    "POST",
    { token: invite.token, name: "Viewer", password: pass },
    201
  );
  await api("/api/admin/deployments");
  await api(
    "/api/admin/commands",
    "POST",
    { idempotencyKey: randomUUID() },
    403
  );
  await api("/api/admin/settings", "PATCH", { revision: 1, settings: {} }, 403);
  await api("/api/admin/operations/diagnostics", "GET", undefined, 403);
  await api(
    "/api/admin/deployments/11111111-1111-4111-8111-111111111111/reveal",
    "POST",
    {},
    403
  );
  await api(
    "/api/admin/deployments/11111111-1111-4111-8111-111111111111",
    "PATCH",
    { label: "Viewer rename" },
    403
  );
  ok(
    "Invited viewer cannot generate/settings/audit/reveal credentials or edit labels"
  );
  cookie = ownerCookie;
  csrf = ownerCsrf;
  const enrollment = await api("/api/auth/account/mfa/enroll", "POST", {});
  const step = Math.floor(Date.now() / 30000);
  const code = totpCode(enrollment.secret, step);
  const confirmed = await api("/api/auth/account/mfa/confirm", "POST", {
    code,
  });
  assert.equal(confirmed.enabled, true);
  assert.equal(confirmed.recoveryCodes.length, 10);
  await api("/api/auth/logout", "POST", {});
  await api(
    "/api/auth/login",
    "POST",
    { email: "owner@example.test", password: pass },
    401
  );
  await api(
    "/api/auth/login",
    "POST",
    { email: "owner@example.test", password: pass, code },
    401
  );
  await api("/api/auth/login", "POST", {
    email: "owner@example.test",
    password: pass,
    code: confirmed.recoveryCodes[0],
  });
  ok(
    "MFA enrollment, required login, TOTP replay rejection and single-use code login"
  );
  await api("/api/auth/step-up", "POST", {
    password: pass,
    code: totpCode(enrollment.secret, step + 1),
  });
  await api("/api/auth/account/mfa/disable", "POST", {});
  await api("/api/auth/account/recovery", "POST", {});
  ok("Step-up MFA disable and offline recovery regeneration");
  const users = await api("/api/auth/users");
  const owner = users.users.find((u: any) => u.email === "owner@example.test");
  await api("/api/auth/users/" + owner.id, "PATCH", { role: "viewer" }, 400);
  ok("Last active owner protected");
  await db.end();
  console.log(
    "SECURITY INTEGRATION COMPLETE",
    count,
    "checks; synthetic database only."
  );
}
main().catch(e => {
  console.error("SECURITY TEST FAILURE", e.message);
  process.exit(1);
});
