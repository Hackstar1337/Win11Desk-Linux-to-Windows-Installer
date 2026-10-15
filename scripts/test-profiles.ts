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
const windowsPassword = "Profile Windows Password 123!";
const osId = "windows-server-2022-standard-evaluation";
const imageName =
  "Windows Server 2022 Standard Evaluation (Desktop Experience)";
const source = "https://example.test/windows2022.iso";
let cookie = "";
let csrf = "";
let checks = 0;
let db: Awaited<ReturnType<typeof mysql.createConnection>> | null = null;

function safeText(value: string): string {
  return value
    .replaceAll(pass, "[REDACTED]")
    .replaceAll(windowsPassword, "[REDACTED]")
    .replace(/[a-f0-9]{64}/gi, "[TOKEN]");
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
  const [rows]: any = await db!.query(
    "SELECT capability_envelope FROM wc_delivery_secrets WHERE command_id=?",
    [id]
  );
  assert.ok(rows[0]?.capability_envelope, "delivery capability envelope");
  return openEnvelope(rows[0].capability_envelope, `delivery:${id}`);
}

async function req(
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
    `${method} ${path} returned ${response.status}`
  );
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
    assert.ok(
      setCookie.includes("HttpOnly") &&
        setCookie.includes("Secure") &&
        setCookie.includes("SameSite=Lax"),
      "session cookie flags"
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

function ok(label: string): void {
  checks++;
  console.log("PASS", label);
}

async function migrateAgain(): Promise<void> {
  try {
    execFileSync("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
      cwd: "/home/ubuntu/win11desk",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { stderr?: Buffer; status?: number };
    throw new Error(
      `repeat migration failed with status ${e.status ?? "unknown"}: ${safeText(
        e.stderr?.toString().slice(0, 240) || "no migration diagnostics"
      )}`
    );
  }
}

async function main(): Promise<void> {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(
    databaseUrl.pathname.replace(/^\/+/, "").startsWith("win11desk_test"),
    "DATABASE_URL must name an isolated win11desk_test database"
  );
  assert.ok(origin, "APP_PUBLIC_URL or test base is required");

  db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await req("/api/admin/profiles", "GET", undefined, 401);
    ok("Anonymous profile API blocked");

    const setupStatus = await req("/api/auth/setup/status");
    if (setupStatus.available) {
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
    } else {
      await req("/api/auth/login", "POST", {
        email: "owner@example.test",
        password: pass,
      });
    }
    ok("Owner bootstrap/session");

    const initial = await req("/api/admin/profiles");
    assert.equal(initial.catalog.length, 32);
    assert.ok(Array.isArray(initial.items));
    assert.ok(initial.catalog.some((os: any) => os.id === osId));
    ok("Profile list returns 32-entry OS catalog");

    const name = `Server 2022 Eval ${randomUUID().slice(0, 8)}`;
    const createInput = {
      name,
      osId,
      isoUrl: "",
      imageName: "",
    };
    const created = await req("/api/admin/profiles", "POST", createInput, 201);
    let profile = created.profile;
    assert.equal(profile.name, name);
    assert.equal(profile.revision, 1);
    assert.equal(profile.isoUrl, "");
    assert.equal(profile.imageName, "");
    const profileId = profile.id;
    ok("Synthetic unconfigured profile created");

    await req(
      "/api/admin/profiles",
      "POST",
      { ...createInput, name: `${name} secret`, password: windowsPassword },
      400
    );
    await req(
      "/api/admin/profiles",
      "POST",
      {
        ...createInput,
        name: `${name} unknown`,
        osId: "windows-server-2022-unknown",
      },
      400
    );
    await req(
      "/api/admin/profiles",
      "POST",
      { ...createInput, name: `${name} syntax`, isoUrl: "not-a-url" },
      400
    );
    await req(
      "/api/admin/profiles",
      "POST",
      {
        ...createInput,
        name: `${name} injection`,
        isoUrl: "https://example.test/x'$()",
      },
      400
    );
    ok("Profile strict secret, OS, URL syntax, and injection validation");

    const commandBase = {
      profileId,
      profileRevision: profile.revision,
      idempotencyKey: randomUUID(),
      label: "profile-unconfigured",
      username: "Administrator",
      password: windowsPassword,
      remotePort: 3389,
      retries: 3,
      count: 1,
    };
    await req("/api/admin/commands", "POST", commandBase, 403, {
      "X-CSRF-Token": "bad",
    });
    await req("/api/admin/commands", "POST", commandBase, 422);
    ok("Command CSRF and unconfigured profile guards");

    const configuredInput = {
      ...createInput,
      isoUrl: source,
      imageName,
      description: "Synthetic integration profile",
      username: "Administrator",
      remotePort: 3389,
      retries: 3,
    };
    const configured = await req(
      `/api/admin/profiles/${profileId}`,
      "PUT",
      { ...configuredInput, revision: profile.revision },
      200
    );
    profile = configured.profile;
    assert.equal(profile.revision, 2);
    assert.equal(profile.isoUrl, source);
    assert.equal(profile.imageName, imageName);
    await req(
      `/api/admin/profiles/${profileId}`,
      "PUT",
      { ...configuredInput, name: `${name} stale`, revision: 1 },
      409
    );
    ok("Profile update increments revision and rejects stale PUT");

    const issueInput = {
      profileId,
      profileRevision: profile.revision,
      idempotencyKey: randomUUID(),
      label: "profile-snapshot",
      username: "Administrator",
      password: windowsPassword,
      remotePort: 3389,
      retries: 3,
      count: 1,
    };
    const issued = await req("/api/admin/commands", "POST", issueInput, 200);
    const command = (issued.items || issued.commands)[0];
    assert.ok(command?.id && command.command);
    assert.equal(command.profile.id, profileId);
    assert.equal(command.profile.revision, profile.revision);
    assert.ok(!Object.prototype.hasOwnProperty.call(command.profile, "isoUrl"));
    assert.ok(
      !Object.prototype.hasOwnProperty.call(command.profile, "imageName")
    );
    assert.equal(command.profile.osId, osId);
    assert.equal(command.profile.group, "Windows Server");
    assert.equal(command.profile.tested, false);
    assert.ok(command.command.includes("/setup/v3.sh"));
    execFileSync("bash", ["-n"], { input: command.command });
    const capabilityToken = await capability(command.id);
    const artifact = await req("/api/installer/delivery", "POST", {
      id: command.id,
      token: capabilityToken,
      profileId,
      profileRevision: profile.revision,
    });
    assert.equal(typeof artifact, "string");
    assert.ok(artifact.includes(source));
    assert.ok(artifact.includes(`--image-name '${imageName}'`));
    assert.ok(artifact.includes("windowsInstallationType"));
    assert.ok(artifact.includes("ServerStandardEval"));
    assert.ok(artifact.includes("20348"));
    execFileSync("bash", ["-n"], { input: artifact });
    const artifactDigest = createHash("sha256").update(artifact).digest("hex");
    assert.equal(command.scriptHash, artifactDigest);
    ok("Profile command artifact is exact, OS-specific, and bash-valid");

    const [commandRows]: any = await db.query(
      "SELECT installer_digest,artifact_ciphertext FROM wc_commands WHERE id=?",
      [command.id]
    );
    assert.equal(commandRows[0].installer_digest, artifactDigest);
    const oldCiphertext = commandRows[0].artifact_ciphertext;
    const oldRevision = profile.revision;
    const oldName = profile.name;

    const renamed = await req(
      `/api/admin/profiles/${profileId}`,
      "PUT",
      {
        ...configuredInput,
        name: `${name} edited`,
        isoUrl: "https://example.test/windows2022-edited.iso",
        revision: profile.revision,
      },
      200
    );
    profile = renamed.profile;
    assert.equal(profile.revision, oldRevision + 1);
    const artifactAgain = await req("/api/installer/delivery", "POST", {
      id: command.id,
      token: capabilityToken,
      profileId,
      profileRevision: oldRevision,
    });
    assert.equal(artifactAgain, artifact);
    const [unchangedRows]: any = await db.query(
      "SELECT installer_digest,artifact_ciphertext FROM wc_commands WHERE id=?",
      [command.id]
    );
    assert.equal(unchangedRows[0].installer_digest, artifactDigest);
    assert.equal(unchangedRows[0].artifact_ciphertext, oldCiphertext);
    const commandList = await req(`/api/admin/commands?p=${profileId}`);
    const listedCommand = (commandList.items || commandList.commands).find(
      (item: any) => item.id === command.id
    );
    assert.equal(listedCommand.profile.name, oldName);
    assert.equal(listedCommand.profile.revision, oldRevision);
    assert.equal(listedCommand.profile.isoUrl, source);
    ok(
      "Issued artifact and command snapshot remain immutable after profile edit"
    );

    await migrateAgain();
    const [persisted]: any = await db.query(
      "SELECT name,iso_url,revision FROM wc_profiles WHERE id=?",
      [profileId]
    );
    assert.equal(persisted[0].name, profile.name);
    assert.equal(persisted[0].iso_url, profile.isoUrl);
    assert.equal(Number(persisted[0].revision), profile.revision);
    ok("Repeat migration is idempotent and preserves profile edits");

    const group = artifact.match(/TRACK_GROUP='([^']+)'/)?.[1];
    const write = artifact.match(/TRACK_GROUP_TOKEN='([a-f0-9]{64})'/)?.[1];
    assert.ok(group && write);
    const metadata = {
      executionId: randomUUID(),
      hostname: "synthetic-profile-vps",
      wholeDisk: "/dev/vda",
      rdpPort: 3389,
      publicIP: "192.0.2.222",
    };
    const run = await req(
      `/api/installer/tracking/${group}/runs`,
      "POST",
      metadata,
      201,
      { Authorization: `Bearer ${write}` }
    );
    const event = (body: unknown, status = 204) =>
      req(
        `/api/installer/tracking/runs/${run.runId}/events`,
        "POST",
        body,
        status,
        { Authorization: `Bearer ${run.reportToken}` }
      );
    await event(
      {
        stage: "windows_booted",
        windowsEdition: "Professional",
        windowsBuild: 26300,
        windowsInstallationType: "Client",
      },
      400
    );
    await event(
      {
        stage: "windows_booted",
        windowsEdition: "ServerStandardEval",
        windowsBuild: 20348,
        windowsInstallationType: "Server",
      },
      204
    );
    await event(
      {
        stage: "windows_ready",
        windowsEdition: "ServerStandardEval",
        windowsBuild: 20348,
        windowsInstallationType: "Server Core",
        rdpListening: true,
      },
      400
    );
    await event(
      {
        stage: "windows_ready",
        windowsEdition: "ServerStandardEval",
        windowsBuild: 20348,
        windowsInstallationType: "Server",
        rdpListening: true,
      },
      204
    );
    ok(
      "Profile-aware tracker rejects wrong proof and accepts exact Server proof"
    );

    const dto = await req(`/api/admin/profiles/${profileId}`);
    assert.equal(dto.profile.id, profileId);
    assert.equal(dto.profile.osId, osId);
    assert.equal(dto.catalog.length, 32);
    const deployments = await req(`/api/admin/deployments?p=${profileId}`);
    const deployment = (deployments.items || deployments.deployments).find(
      (item: any) => item.id === run.runId
    );
    assert.ok(deployment);
    assert.equal(deployment.windowsInstallationType, "Server");
    assert.equal(deployment.profile.id, profileId);
    assert.equal(deployment.profileRevision, oldRevision);
    assert.equal(deployment.profile.isoUrl, source);
    const csv = await req(`/api/admin/deployments/export?p=${profileId}`);
    assert.ok(csv.includes(run.runId));
    assert.ok(csv.includes(oldName));
    assert.ok(csv.includes("Windows Server 2022"));
    assert.ok(!csv.includes(windowsPassword));
    ok(
      "Profile DTO, OS DTO, filtered deployment history, and password-free CSV attribution"
    );

    const archived = await req(
      `/api/admin/profiles/${profileId}/archive`,
      "POST",
      { revision: profile.revision },
      200
    );
    profile = archived.profile;
    await req(
      "/api/admin/commands",
      "POST",
      {
        ...issueInput,
        idempotencyKey: randomUUID(),
        profileRevision: profile.revision,
      },
      409
    );
    const artifactWhileArchived = await req("/api/installer/delivery", "POST", {
      id: command.id,
      token: capabilityToken,
      profileId,
      profileRevision: oldRevision,
    });
    assert.equal(artifactWhileArchived, artifact);
    const restored = await req(
      `/api/admin/profiles/${profileId}/restore`,
      "POST",
      { revision: profile.revision },
      200
    );
    profile = restored.profile;
    assert.equal(profile.revision, archived.profile.revision + 1);
    const newIssue = await req(
      "/api/admin/commands",
      "POST",
      {
        ...issueInput,
        idempotencyKey: randomUUID(),
        profileRevision: profile.revision,
        label: "profile-after-restore",
      },
      200
    );
    const newCommand = (newIssue.items || newIssue.commands)[0];
    assert.notEqual(newCommand.id, command.id);
    assert.equal(newCommand.profile.revision, profile.revision);
    ok(
      "Archive blocks new issuance, preserves existing artifact, and restore permits new generation"
    );

    await req("/api/auth/logout", "POST", {});
    await req("/api/auth/me", "GET", undefined, 401);
    console.log(
      "INTEGRATION COMPLETE",
      checks,
      "checks; no OS installer executed."
    );
  } finally {
    await db.end();
    db = null;
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("TEST FAILURE", safeText(message));
  if (db) void db.end().catch(() => undefined);
  process.exit(1);
});
