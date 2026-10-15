import assert from "node:assert/strict";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { config } from "../server/control/config";

const base =
  process.env.TEST_BASE ||
  process.env.TEST_BASE3114 ||
  process.env.TEST_BASE3113 ||
  "http://127.0.0.1:3113";
const origin = process.env.APP_PUBLIC_URL || base;
const pass = "Synthetic owner password long 123!";
const commandPassword = "Ready OS command password 123!";
let cookie = "";
let csrf = "";
let checks = 0;
let db: any;

function ok(label: string) {
  checks++;
  console.log("PASS", label);
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

async function capability(id: string): Promise<string> {
  const [rows]: any = await db.query(
    "SELECT capability_envelope FROM wc_delivery_secrets WHERE command_id=?",
    [id]
  );
  assert.ok(rows[0]?.capability_envelope, "delivery capability envelope");
  return openEnvelope(rows[0].capability_envelope, `delivery:${id}`);
}

async function api(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Promise<any> {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${text.slice(0, 240)}`
  );
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
    assert.ok(
      setCookie.includes("HttpOnly") &&
        setCookie.includes("Secure") &&
        setCookie.includes("SameSite=Lax")
    );
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed.csrf) csrf = parsed.csrf;
    return parsed;
  } catch {
    return text;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(
    new URL(databaseUrl).pathname
      .replace(/^\/+/, "")
      .startsWith("win11desk_test"),
    "DATABASE_URL must name an isolated win11desk_test database"
  );
  db = await mysql.createConnection(databaseUrl);

  try {
    await api("/api/admin/profiles/ready", "GET", undefined, 401);
    ok("Anonymous ready-profile API blocked");

    const setupStatus = await api("/api/auth/setup/status");
    if (setupStatus.available) {
      await api(
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
    } else {
      await api("/api/auth/login", "POST", {
        email: "owner@example.test",
        password: pass,
      });
    }
    ok("Owner bootstrap/session");

    if (process.env.LEGACY_TEST_BASE) {
      const legacyBody = {
        idempotencyKey: randomUUID(),
        username: "Administrator",
        password: commandPassword,
        remotePort: 22,
        retries: 10,
        isoUrl: "https://example.test/legacy-ready.iso",
        label: "legacy-compatibility",
      };
      const legacyResponse = await fetch(
        process.env.LEGACY_TEST_BASE + "/api/admin/commands",
        {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify(legacyBody),
        }
      );
      assert.equal(legacyResponse.status, 200);
      const legacyData: any = await legacyResponse.json();
      const old = legacyData.items[0];
      assert.ok(old.command.includes("/api/installer/delivery"));
      assert.ok(!old.command.includes("/launcher/"));
      const cap = await capability(old.id);
      const original = await api("/api/installer/delivery", "POST", {
        id: old.id,
        token: cap,
      });
      assert.equal(
        createHash("sha256").update(original).digest("hex"),
        old.scriptHash
      );
      const replay = await api("/api/admin/commands", "POST", legacyBody);
      assert.equal(replay.items[0].id, old.id);
      assert.equal(replay.items[0].command, old.command);
      await api(
        "/api/admin/commands",
        "POST",
        { ...legacyBody, idempotencyKey: randomUUID() },
        400
      );
      ok(
        "Previous-release custom command replays/delivers unchanged while new profile-less creation is blocked"
      );
    }

    const suffix = randomUUID().slice(0, 8);
    const noSource = await api(
      "/api/admin/profiles",
      "POST",
      {
        name: `Ready no source ${suffix}`,
        osId: "windows-11-pro",
        isoUrl: "",
        imageName: "",
        description: "Intentionally not ready",
        username: "Administrator",
        remotePort: 22,
        retries: 10,
      },
      201
    );
    const archived = await api(
      "/api/admin/profiles",
      "POST",
      {
        name: `Ready archived ${suffix}`,
        osId: "windows-11-pro",
        isoUrl: `https://example.test/archived-${suffix}.iso`,
        imageName: "Windows 11 Pro",
        description: "Intentionally archived",
        username: "Administrator",
        remotePort: 22,
        retries: 10,
      },
      201
    );
    const archivedId = archived.profile.id;
    await api(
      `/api/admin/profiles/${archivedId}/archive`,
      "POST",
      { revision: archived.profile.revision },
      200
    );
    const source = `https://example.test/ready-${suffix}.iso`;
    const configured = await api(
      "/api/admin/profiles",
      "POST",
      {
        name: `Ready configured ${suffix}`,
        osId: "windows-11-pro",
        isoUrl: source,
        imageName: "Windows 11 Pro",
        description: "Ready source-authoritative profile",
        username: "Administrator",
        remotePort: 3389,
        retries: 3,
      },
      201
    );
    let profile = configured.profile;
    assert.equal(profile.revision, 1);

    const ready = await api("/api/admin/profiles/ready");
    assert.ok(Array.isArray(ready.items));
    assert.equal(typeof ready.defaultProfileId, "string");
    const item = ready.items.find((v: any) => v.id === profile.id);
    assert.ok(item, "configured profile appears in ready list");
    assert.ok(!ready.items.some((v: any) => v.id === noSource.profile.id));
    assert.ok(!ready.items.some((v: any) => v.id === archivedId));
    const readyKeys = Object.keys(item).sort();
    assert.deepEqual(readyKeys, [
      "group",
      "id",
      "name",
      "osId",
      "osName",
      "remotePort",
      "retries",
      "revision",
      "tested",
      "username",
    ]);
    for (const forbidden of [
      "isoUrl",
      "imageName",
      "description",
      "archivedAt",
      "createdAt",
      "updatedAt",
    ])
      assert.ok(!(forbidden in item), `ready DTO excludes ${forbidden}`);
    ok(
      "Ready DTO is minimal and excludes source, archived, and no-source profiles"
    );

    const baseCommand = {
      profileId: profile.id,
      profileRevision: profile.revision,
      username: "Administrator",
      password: commandPassword,
      remotePort: 3389,
      retries: 3,
      count: 1,
      uniquePasswords: false,
      idempotencyKey: randomUUID(),
      label: "ready-os-command",
      tags: ["ready", "synthetic"],
      provider: "ready-test-provider",
    };
    await api(
      "/api/admin/commands",
      "POST",
      { ...baseCommand, profileId: undefined, profileRevision: undefined },
      400
    );
    for (const forbidden of [
      { isoUrl: source },
      { input: { settings: { isoUrl: source } } },
      { target: { isoUrl: source } },
      { osId: "windows-11-pro" },
    ])
      await api(
        "/api/admin/commands",
        "POST",
        { ...baseCommand, ...forbidden },
        400
      );
    await api(
      "/api/admin/commands",
      "POST",
      { ...baseCommand, profileRevision: profile.revision + 1 },
      409
    );
    ok(
      "Flat command requires an exact profile revision and rejects every source/OS bypass"
    );

    const issued = await api("/api/admin/commands", "POST", baseCommand);
    const command = (issued.items || issued.commands)[0];
    assert.ok(command?.id && command.command);
    assert.ok(command.profile);
    assert.ok(!Object.prototype.hasOwnProperty.call(command.profile, "isoUrl"));
    assert.ok(
      !Object.prototype.hasOwnProperty.call(command.profile, "imageName")
    );
    assert.equal(command.profile.id, profile.id);
    assert.equal(command.profile.revision, profile.revision);
    assert.ok(command.command.includes("/setup/v3.sh"));
    assert.ok(!command.command.includes(command.id));
    assert.ok(!command.command.includes(profile.id));
    assert.ok(!command.command.includes(commandPassword));
    execFileSync("bash", ["-n"], { input: command.command });
    const token = await capability(command.id);
    const artifact = await api("/api/installer/delivery", "POST", {
      id: command.id,
      token,
      profileId: profile.id,
      profileRevision: profile.revision,
    });
    assert.equal(typeof artifact, "string");
    assert.ok(artifact.includes(source));
    assert.ok(artifact.includes("WIN_USER='Administrator'"));
    assert.ok(artifact.includes("EMBEDDED_PASSWORD="));
    assert.ok(artifact.includes(commandPassword));
    assert.equal(
      createHash("sha256").update(artifact).digest("hex"),
      command.scriptHash
    );
    execFileSync("bash", ["-n"], { input: artifact });
    ok(
      "Exact profile source and credential-bearing delivery artifact are immutable and bash-valid"
    );

    const oldRevision = profile.revision;
    const oldSource = source;
    const edited = await api(
      `/api/admin/profiles/${profile.id}`,
      "PUT",
      {
        name: profile.name + " edited",
        osId: profile.osId,
        isoUrl: `https://example.test/edited-${suffix}.iso`,
        imageName: "Windows 11 Pro",
        description: profile.description,
        username: profile.username,
        remotePort: profile.remotePort,
        retries: profile.retries,
        revision: profile.revision,
      },
      200
    );
    profile = edited.profile;
    assert.equal(profile.revision, oldRevision + 1);
    const replay = await api("/api/admin/commands", "POST", baseCommand);
    const replayCommand = (replay.items || replay.commands)[0];
    assert.equal(replayCommand.id, command.id);
    assert.equal(replayCommand.command, command.command);
    const artifactAgain = await api("/api/installer/delivery", "POST", {
      id: command.id,
      token,
      profileId: command.profile.id,
      profileRevision: oldRevision,
    });
    assert.equal(artifactAgain, artifact);
    assert.ok(artifactAgain.includes(oldSource));
    await api(
      "/api/installer/delivery",
      "POST",
      {
        id: command.id,
        token,
        profileId: profile.id,
        profileRevision: profile.revision,
      },
      404
    );
    ok(
      "Profile edit cannot change exact idempotent replay, delivery, or issued profile identity"
    );

    const archivedState = await api(
      `/api/admin/profiles/${profile.id}/archive`,
      "POST",
      {
        revision: profile.revision,
      },
      200
    );
    profile = archivedState.profile;
    const archivedReplay = await api(
      "/api/admin/commands",
      "POST",
      baseCommand
    );
    assert.equal(
      (archivedReplay.items || archivedReplay.commands)[0].id,
      command.id
    );
    const archivedDelivery = await api("/api/installer/delivery", "POST", {
      id: command.id,
      token,
      profileId: command.profile.id,
      profileRevision: oldRevision,
    });
    assert.equal(archivedDelivery, artifact);
    await api(`/api/admin/commands/${command.id}/retrieve`, "POST", {}, 401);
    await api("/api/auth/step-up", "POST", { password: pass });
    const retrieved = await api(
      `/api/admin/commands/${command.id}/retrieve`,
      "POST",
      {}
    );
    assert.equal(retrieved.id, command.id);
    assert.equal(retrieved.command, command.command);
    ok(
      "Archive-after-issuance preserves exact replay, delivery, and step-up retrieval"
    );

    const restored = await api(
      `/api/admin/profiles/${profile.id}/restore`,
      "POST",
      {
        revision: profile.revision,
      },
      200
    );
    profile = restored.profile;

    await api(`/api/admin/commands/${command.id}/revoke`, "POST", {});
    await api(
      "/api/installer/delivery",
      "POST",
      { id: command.id, token },
      404
    );
    await api(`/api/admin/commands/${command.id}/retrieve`, "POST", {}, 410);

    const expiringInput = {
      ...baseCommand,
      idempotencyKey: randomUUID(),
      label: "ready-os-expiring",
      profileRevision: profile.revision,
    };
    const expiring = await api("/api/admin/commands", "POST", expiringInput);
    const expiringCommand = (expiring.items || expiring.commands)[0];
    const expiringToken = await capability(expiringCommand.id);
    await db.query(
      "UPDATE wc_commands SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id=?",
      [expiringCommand.id]
    );
    await api(
      "/api/installer/delivery",
      "POST",
      { id: expiringCommand.id, token: expiringToken },
      404
    );
    await api(
      `/api/admin/commands/${expiringCommand.id}/retrieve`,
      "POST",
      {},
      410
    );
    ok(
      "Revoked and expired delivery capabilities return 404 and retrieval returns 410"
    );
  } finally {
    await db.end();
  }
  console.log(
    "READY OS INTEGRATION COMPLETE",
    checks,
    "checks; synthetic database only."
  );
}

main().catch(error => {
  console.error(
    "READY OS TEST FAILURE",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
