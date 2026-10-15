import assert from "node:assert/strict";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import {
  SETUP_V2_SHA256,
  SETUP_V2_TEXT,
  SETUP_V2_VERSION,
  buildPrivateSetupCommand,
} from "../server/control/launcherV2";
import { config } from "../server/control/config";

/**
 * Isolated API acceptance coverage for the short private setup launcher.
 *
 * This test never starts a listener and never executes an installer.  The
 * caller supplies a fresh TEST_BASE and an isolated DATABASE_URL (the shared
 * synthetic /tmp/wc-profiles.env may be sourced by the caller, but this file
 * deliberately never reads or prints that file).
 */
const base =
  process.env.TEST_BASE ||
  process.env.TEST_BASE3114 ||
  process.env.TEST_BASE3113 ||
  "http://127.0.0.1:3113";
const origin = process.env.APP_PUBLIC_URL || base;
if (
  !process.env.TEST_BASE ||
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname)
)
  throw new Error(
    "TEST_BASE must explicitly identify the isolated loopback test runtime."
  );
if (
  process.env.LEGACY_TEST_BASE &&
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.LEGACY_TEST_BASE).hostname
  )
)
  throw new Error(
    "LEGACY_TEST_BASE must identify the isolated loopback legacy runtime."
  );
const pass = "Synthetic owner password long 123!";
const commandPassword = "V2 synthetic command password 123!";
const source = "https://example.test/v2-synthetic-windows.iso";
const customFile = "https://files.example.com/v2-payload.zip";
let cookie = "";
let csrf = "";
let checks = 0;
let db: mysql.Connection;

function ok(label: string) {
  checks++;
  console.log("PASS", label);
}

function parsedJson(value: unknown): any {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
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
  assert.ok(
    rows[0]?.capability_envelope,
    "encrypted capability envelope exists"
  );
  return openEnvelope(rows[0].capability_envelope, `delivery:${id}`);
}

async function row(id: string): Promise<any> {
  const [rows]: any = await db.query("SELECT * FROM wc_commands WHERE id=?", [
    id,
  ]);
  assert.ok(rows[0], "issued synthetic command row exists");
  return rows[0];
}

async function configRow(id: string): Promise<any> {
  const value = (await row(id)).config_json;
  return parsedJson(value);
}

function bodyHasSecret(value: unknown, secrets: string[]): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return secrets.some(secret => secret.length > 0 && text.includes(secret));
}

type RequestResult = {
  value: any;
  status: number;
  text: string;
  headers: Headers;
};

async function request(
  serverBase: string,
  path: string,
  method = "GET",
  body?: unknown,
  expected = 200,
  extra: Record<string, string> = {},
  state: { cookie: string; csrf: string } = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
    get csrf() {
      return csrf;
    },
    set csrf(value: string) {
      csrf = value;
    },
  }
): Promise<RequestResult> {
  const headers: Record<string, string> = {
    Origin: origin,
    "Content-Type": "application/json",
    ...(state.cookie ? { Cookie: state.cookie } : {}),
    ...(state.csrf ? { "X-CSRF-Token": state.csrf } : {}),
    ...extra,
  };
  const response = await fetch(serverBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    expected,
    `${method} ${path} returned an unexpected status`
  );
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    state.cookie = setCookie.split(";")[0];
    assert.ok(
      setCookie.includes("HttpOnly") &&
        setCookie.includes("Secure") &&
        setCookie.includes("SameSite=Lax"),
      "session cookie has secure attributes"
    );
  }
  let value: any = text;
  try {
    value = JSON.parse(text);
    if (value?.csrf) state.csrf = value.csrf;
  } catch {
    // Plain-text delivery artifacts are intentional.
  }
  return { value, status: response.status, text, headers: response.headers };
}

async function api(
  path: string,
  method = "GET",
  body?: unknown,
  expected = 200,
  extra: Record<string, string> = {}
): Promise<any> {
  return (await request(base, path, method, body, expected, extra)).value;
}

async function authenticate(
  serverBase: string,
  state: { cookie: string; csrf: string }
) {
  const setup = await request(
    serverBase,
    "/api/auth/setup/status",
    "GET",
    undefined,
    200,
    {},
    state
  );
  if (setup.value.available) {
    await request(
      serverBase,
      "/api/auth/setup",
      "POST",
      {
        secret: process.env.BOOTSTRAP_SECRET,
        email: "owner@example.test",
        name: "Test Owner",
        password: pass,
      },
      201,
      {},
      state
    );
  } else {
    await request(
      serverBase,
      "/api/auth/login",
      "POST",
      { email: "owner@example.test", password: pass },
      200,
      {},
      state
    );
  }
}

function commandItem(result: any): any {
  return (result.items || result.commands || [])[0];
}

function assertSafeError(value: unknown, knownSecrets: string[]) {
  assert.equal(
    bodyHasSecret(value, knownSecrets),
    false,
    "invalid response is secret-free"
  );
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(
    /(?:https?:\/\/[^\s"']+\.iso)/i.test(text),
    false,
    "invalid response has no ISO URL"
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const dbUrl = new URL(databaseUrl);
  assert.ok(
    dbUrl.pathname.replace(/^\/+/, "").startsWith("win11desk_test"),
    "DATABASE_URL must name an isolated win11desk_test database"
  );
  assert.ok(
    process.env.APP_PUBLIC_URL,
    "APP_PUBLIC_URL is required by the control plane"
  );
  assert.ok(
    process.env.BOOTSTRAP_SECRET,
    "BOOTSTRAP_SECRET is required by synthetic setup"
  );
  db = await mysql.createConnection(databaseUrl);

  let profile: any;
  let issued: any;
  let ticket = "";
  let artifact = "";
  let expiresAt = "";
  const syntheticSecrets = [commandPassword, source, customFile];

  try {
    await api("/api/admin/commands", "GET", undefined, 401);
    ok("Anonymous private command API remains blocked");

    await authenticate(base, {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value;
      },
      get csrf() {
        return csrf;
      },
      set csrf(value: string) {
        csrf = value;
      },
    });
    ok("Synthetic owner session established");

    const setupResponse = await request(base, "/setup/v2.sh");
    assert.equal(
      setupResponse.text,
      SETUP_V2_TEXT,
      "public v2 setup bytes are pinned"
    );
    assert.equal(
      createHash("sha256").update(setupResponse.text).digest("hex"),
      SETUP_V2_SHA256,
      "public v2 setup digest matches immutable identity"
    );
    assert.equal(
      setupResponse.headers.get("cache-control"),
      "public, max-age=31536000, immutable"
    );
    assert.equal(setupResponse.headers.get("etag"), `"${SETUP_V2_SHA256}"`);
    assert.equal(
      bodyHasSecret(setupResponse.text, syntheticSecrets),
      false,
      "generic setup has no fixture secrets"
    );
    assert.equal(
      setupResponse.text.includes(profile?.id || "__no_profile__"),
      false
    );
    ok("Generic setup is public, immutable, transport-only, and nonsensitive");

    const suffix = randomUUID().slice(0, 8);
    profile = (
      await api(
        "/api/admin/profiles",
        "POST",
        {
          name: `V2 synthetic ${suffix}`,
          osId: "windows-11-pro",
          isoUrl: source,
          imageName: "Windows 11 Pro",
          description: "Synthetic v2 acceptance profile",
          username: "Administrator",
          remotePort: 3389,
          retries: 3,
        },
        201
      )
    ).profile;
    assert.equal(profile.revision, 1);

    const options = {
      getFiles: true,
      apps: ["chrome", "firefox", "7zip"],
      customFileUrl: customFile,
      runAttachedScript: true,
    };
    const issuanceBody = {
      profileId: profile.id,
      profileRevision: profile.revision,
      username: "Administrator",
      password: commandPassword,
      remotePort: 3389,
      retries: 3,
      count: 1,
      uniquePasswords: false,
      idempotencyKey: randomUUID(),
      label: "v2 synthetic acceptance",
      tags: ["synthetic", "v2"],
      provider: "v2-test-provider",
      postInstall: options,
    };
    issued = commandItem(
      await api("/api/admin/commands", "POST", issuanceBody)
    );
    assert.ok(issued?.id && issued.command, "current command was generated");
    assert.ok(
      issued.command.includes("/setup/v3.sh"),
      "current issuance stays on v3"
    );
    // This suite checks retained v2 compatibility, not new-command version selection.
    // Materialize the equivalent historical transport metadata only in the isolated
    // database; keep the exact issued encrypted installer artifact and ticket.
    const currentConfig = await configRow(issued.id);
    assert.equal(currentConfig.launcher?.version, "v3");
    const legacyTicket = await capability(issued.id);
    await db.query("UPDATE wc_commands SET config_json=? WHERE id=?", [
      JSON.stringify({
        ...currentConfig,
        launcher: { version: SETUP_V2_VERSION, sha256: SETUP_V2_SHA256 },
      }),
      issued.id,
    ]);
    issued.command = buildPrivateSetupCommand(
      origin,
      legacyTicket,
      issued.scriptHash
    );
    assert.equal(
      issued.command.includes(`/setup/${SETUP_V2_VERSION}.sh`),
      true
    );
    assert.equal(
      issued.command.includes("/api/installer/launcher/v1.sh"),
      false
    );
    assert.equal(
      issued.command.includes(profile.id),
      false,
      "paste omits profile UUID"
    );
    assert.equal(
      issued.command.includes(issued.id),
      false,
      "paste omits command UUID"
    );
    assert.equal(
      bodyHasSecret(issued.command, syntheticSecrets),
      false,
      "paste omits settings and credentials"
    );
    execFileSync("bash", ["-n"], { input: issued.command });

    const issuedRow = await row(issued.id);
    ticket = await capability(issued.id);
    assert.match(ticket, /^[0-9a-f]{64}$/);
    assert.equal(
      issuedRow.delivery_hash,
      createHash("sha256").update(ticket).digest("hex")
    );
    assert.equal(
      (issued.command.match(new RegExp(ticket, "g")) || []).length,
      1,
      "paste carries one private ticket"
    );
    assert.equal(
      issued.command.includes(issued.scriptHash),
      true,
      "paste carries the issued artifact digest"
    );
    assert.equal(
      issued.command.includes(SETUP_V2_SHA256),
      true,
      "paste pins the generic setup digest"
    );
    assert.equal(
      issuedRow.config_json.toString().includes(commandPassword),
      false,
      "DB config does not contain plaintext password"
    );
    assert.equal(
      issuedRow.artifact_ciphertext.includes(commandPassword),
      false,
      "DB artifact is encrypted at rest"
    );
    const saved = await configRow(issued.id);
    assert.equal(saved.launcher?.version, SETUP_V2_VERSION);
    assert.equal(saved.launcher?.sha256, SETUP_V2_SHA256);
    assert.deepEqual(
      saved.postInstall?.files?.map((v: any) => v.id),
      ["chrome", "firefox", "7zip", "custom"]
    );
    assert.ok(
      saved.postInstall?.script,
      "immutable attached script snapshot exists"
    );
    assert.match(String(saved.postInstall?.script?.sha256), /^[0-9a-f]{64}$/);
    assert.equal(saved.profile?.id, profile.id);
    assert.equal(saved.profile?.revision, profile.revision);
    ok(
      "Generated command has one ticket/no identities and immutable v2 snapshot metadata"
    );

    const validLaunch = await request(
      base,
      "/api/installer/launch/v2",
      "POST",
      { ticket: ticket.toUpperCase() }
    );
    assert.match(
      validLaunch.headers.get("cache-control") || "",
      /(?:^|,\s*)no-store(?:,|$)/
    );
    assert.equal(validLaunch.headers.get("referrer-policy"), "no-referrer");
    assert.equal(validLaunch.headers.get("x-content-type-options"), "nosniff");
    assert.equal(validLaunch.headers.get("x-script-sha256"), issued.scriptHash);
    artifact = validLaunch.text;
    assert.equal(
      createHash("sha256").update(artifact).digest("hex"),
      issued.scriptHash
    );
    assert.equal(artifact.includes(source), true);
    assert.equal(artifact.includes("WIN_USER='Administrator'"), true);
    assert.equal(artifact.includes(commandPassword), true);
    const representations = [artifact];
    for (const encoded of artifact.match(/[A-Za-z0-9+/=]{80,}/g) || []) {
      const bytes = Buffer.from(encoded, "base64");
      representations.push(bytes.toString("utf8"), bytes.toString("utf16le"));
    }
    const worker = representations.find(text =>
      text.includes("Win11Desk post-install worker")
    );
    assert.ok(worker, "delivered artifact stages the optional worker");
    const encodedPlan = worker.match(
      /\$planJson\s*=.*FromBase64String\('([A-Za-z0-9+/=]+)'/
    );
    assert.ok(
      encodedPlan,
      "worker includes its immutable encoded configuration"
    );
    const deliveredPlan = JSON.parse(
      Buffer.from(encodedPlan[1], "base64").toString("utf8")
    );
    assert.deepEqual(deliveredPlan, saved.postInstall);
    assert.ok(deliveredPlan.files.some((file: any) => file.url === customFile));
    execFileSync("bash", ["-n"], { input: artifact });
    assert.equal((await row(issued.id)).installer_digest, issued.scriptHash);
    ok(
      "Uppercase ticket retrieves the exact encrypted artifact and digest-matched settings"
    );

    const beforeDownloads = Number((await row(issued.id)).download_count);
    const repeated = await api("/api/installer/launch/v2", "POST", { ticket });
    assert.equal(repeated, artifact, "repeated v2 retrieval is byte-identical");
    const afterDownloads = Number((await row(issued.id)).download_count);
    assert.equal(
      afterDownloads,
      beforeDownloads + 1,
      "multiple retrievals count safely without ticket rotation"
    );
    const direct = await api("/api/installer/delivery", "POST", {
      id: issued.id,
      token: ticket,
    });
    assert.equal(
      direct,
      artifact,
      "legacy {id,token} delivery remains functional for a v2 command"
    );
    ok("Exact replay and legacy direct delivery remain functional");

    for (const invalid of [
      undefined,
      {},
      { ticket: "bad" },
      { ticket: ticket, profileId: profile.id },
      { ticket: ticket, artifactHash: issued.scriptHash },
      { ticket, username: "Administrator" },
      [ticket],
    ]) {
      const bad = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        invalid,
        400
      );
      assertSafeError(bad.value, [
        ticket,
        commandPassword,
        source,
        customFile,
        profile.id,
        issued.id,
      ]);
    }
    const queryOverride = await request(
      base,
      "/api/installer/launch/v2?profileId=" + encodeURIComponent(profile.id),
      "POST",
      { ticket },
      400
    );
    assertSafeError(queryOverride.value, [
      ticket,
      commandPassword,
      source,
      customFile,
      profile.id,
      issued.id,
    ]);
    const mediaOverride = await request(
      base,
      "/api/installer/launch/v2",
      "POST",
      JSON.stringify({ ticket }),
      400,
      { "Content-Type": "text/plain" }
    );
    assertSafeError(mediaOverride.value, [
      ticket,
      commandPassword,
      source,
      customFile,
      profile.id,
      issued.id,
    ]);
    const unknown = await request(
      base,
      "/api/installer/launch/v2",
      "POST",
      { ticket: "a".repeat(64) },
      404
    );
    assertSafeError(unknown.value, [
      ticket,
      commandPassword,
      source,
      customFile,
      profile.id,
      issued.id,
    ]);
    const getLaunch = await request(
      base,
      "/api/installer/launch/v2",
      "GET",
      undefined,
      404
    );
    assertSafeError(getLaunch.value, [
      ticket,
      commandPassword,
      source,
      customFile,
      profile.id,
      issued.id,
    ]);
    ok(
      "Strict body/query/media overrides and unknown tickets fail closed with generic secret-free errors"
    );

    const oldExpires = (await row(issued.id)).expires_at;
    await db.query(
      "UPDATE wc_commands SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id=?",
      [issued.id]
    );
    try {
      const expired = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        { ticket },
        404
      );
      assertSafeError(expired.value, [
        ticket,
        commandPassword,
        source,
        customFile,
        profile.id,
        issued.id,
      ]);
    } finally {
      await db.query("UPDATE wc_commands SET expires_at=? WHERE id=?", [
        oldExpires,
        issued.id,
      ]);
    }
    const oldRevoked = (await row(issued.id)).revoked_at;
    await db.query(
      "UPDATE wc_commands SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
      [issued.id]
    );
    try {
      const revoked = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        { ticket },
        404
      );
      assertSafeError(revoked.value, [
        ticket,
        commandPassword,
        source,
        customFile,
        profile.id,
        issued.id,
      ]);
    } finally {
      await db.query("UPDATE wc_commands SET revoked_at=? WHERE id=?", [
        oldRevoked,
        issued.id,
      ]);
    }
    assert.equal(
      (await request(base, "/api/installer/launch/v2", "POST", { ticket }))
        .text,
      artifact
    );
    ok(
      "Expired and revoked fixture rows reject retrieval and restore for subsequent replay"
    );

    const originalConfig = await configRow(issued.id);
    await db.query("UPDATE wc_commands SET config_json=? WHERE id=?", [
      JSON.stringify({
        ...originalConfig,
        launcher: { version: "v1", sha256: SETUP_V2_SHA256 },
      }),
      issued.id,
    ]);
    try {
      const wrongVersion = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        { ticket },
        404
      );
      assertSafeError(wrongVersion.value, [
        ticket,
        commandPassword,
        source,
        customFile,
        profile.id,
        issued.id,
      ]);
    } finally {
      await db.query("UPDATE wc_commands SET config_json=? WHERE id=?", [
        JSON.stringify(originalConfig),
        issued.id,
      ]);
    }
    const tamperedConfig = {
      ...originalConfig,
      launcher: { version: SETUP_V2_VERSION, sha256: "0".repeat(64) },
    };
    await db.query("UPDATE wc_commands SET config_json=? WHERE id=?", [
      JSON.stringify(tamperedConfig),
      issued.id,
    ]);
    try {
      const tampered = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        { ticket },
        404
      );
      assertSafeError(tampered.value, [
        ticket,
        commandPassword,
        source,
        customFile,
        profile.id,
        issued.id,
      ]);
    } finally {
      await db.query("UPDATE wc_commands SET config_json=? WHERE id=?", [
        JSON.stringify(originalConfig),
        issued.id,
      ]);
    }
    ok(
      "Unknown launcher version and tampered launcher identity are rejected without rotating the saved ticket"
    );

    const oldRevision = profile.revision;
    const oldProfile = { ...profile };
    let editedProfile: any;
    let archivedProfile: any;
    try {
      editedProfile = (
        await api(`/api/admin/profiles/${profile.id}`, "PUT", {
          name: profile.name + " edited",
          osId: profile.osId,
          isoUrl: "https://example.test/v2-edited.iso",
          imageName: profile.imageName,
          description: profile.description,
          username: profile.username,
          remotePort: profile.remotePort,
          retries: profile.retries,
          revision: profile.revision,
        })
      ).profile;
      archivedProfile = (
        await api(`/api/admin/profiles/${profile.id}/archive`, "POST", {
          revision: editedProfile.revision,
        })
      ).profile;
      const replay = commandItem(
        await api("/api/admin/commands", "POST", issuanceBody)
      );
      assert.equal(replay.id, issued.id);
      assert.equal(replay.command, issued.command);
      assert.equal(
        await api("/api/installer/launch/v2", "POST", { ticket }),
        artifact
      );
      assert.equal((await configRow(issued.id)).profile.isoUrl, source);
      ok(
        "Profile edit/archive cannot alter immutable v2 replay or delivery snapshot"
      );
    } finally {
      if (archivedProfile) {
        await api(`/api/admin/profiles/${profile.id}/restore`, "POST", {
          revision: archivedProfile.revision,
        });
      } else if (editedProfile) {
        await api(`/api/admin/profiles/${profile.id}`, "PUT", {
          ...oldProfile,
          revision: editedProfile.revision,
        });
      }
    }
    assert.equal(oldRevision, 1);

    const group = artifact.match(/TRACK_GROUP='([^']+)'/)?.[1];
    const writeToken = artifact.match(
      /TRACK_GROUP_TOKEN='([a-f0-9]{64})'/
    )?.[1];
    assert.ok(
      group && writeToken,
      "v2 artifact carries synthetic tracking capability"
    );
    const runA = await api(
      `/api/installer/tracking/${group}/runs`,
      "POST",
      {
        executionId: randomUUID(),
        hostname: `v2-synthetic-a-${suffix}`,
        disk: "/dev/vda",
        rdpPort: 3389,
        publicIP: "192.0.2.241",
      },
      201,
      { Authorization: "Bearer " + writeToken }
    );
    const runB = await api(
      `/api/installer/tracking/${group}/runs`,
      "POST",
      {
        executionId: randomUUID(),
        hostname: `v2-synthetic-b-${suffix}`,
        disk: "/dev/vdb",
        rdpPort: 3389,
        publicIP: "192.0.2.242",
      },
      201,
      { Authorization: "Bearer " + writeToken }
    );
    assert.notEqual(
      runA.runId,
      runB.runId,
      "independent synthetic runs receive distinct IDs"
    );
    ok(
      "Reused v2 artifact registers independent synthetic runs without executing an installer"
    );

    if (process.env.LEGACY_TEST_BASE) {
      const legacyCookie = { cookie: "", csrf: "" };
      await authenticate(process.env.LEGACY_TEST_BASE, legacyCookie);
      const legacySource = "https://example.test/legacy-v1.iso";
      const legacyProfile = (
        await request(
          process.env.LEGACY_TEST_BASE,
          "/api/admin/profiles",
          "POST",
          {
            name: "Legacy v1 " + suffix,
            osId: "windows-11-pro",
            isoUrl: legacySource,
            imageName: "Windows 11 Pro",
            username: "Administrator",
            remotePort: 22,
            retries: 3,
          },
          201,
          {},
          legacyCookie
        )
      ).value.profile;
      const legacyBody = {
        idempotencyKey: randomUUID(),
        profileId: legacyProfile.id,
        profileRevision: legacyProfile.revision,
        username: "Administrator",
        password: "Legacy synthetic password 123!",
        remotePort: 22,
        retries: 3,
        label: "legacy-v1-fixture",
      };
      const legacyIssued = commandItem(
        (
          await request(
            process.env.LEGACY_TEST_BASE,
            "/api/admin/commands",
            "POST",
            legacyBody,
            200,
            {},
            legacyCookie
          )
        ).value
      );
      assert.ok(legacyIssued.command.includes("/api/installer/launcher/v1.sh"));
      assert.equal(
        legacyIssued.command.includes(`/setup/${SETUP_V2_VERSION}.sh`),
        false
      );
      const legacyTicket = await capability(legacyIssued.id);
      const legacyArtifact = (
        await request(
          process.env.LEGACY_TEST_BASE,
          "/api/installer/delivery",
          "POST",
          { id: legacyIssued.id, token: legacyTicket },
          200,
          {},
          legacyCookie
        )
      ).text;
      assert.equal(
        createHash("sha256").update(legacyArtifact).digest("hex"),
        legacyIssued.scriptHash
      );
      const legacyReplay = commandItem(
        (
          await request(
            base,
            "/api/admin/commands",
            "POST",
            legacyBody,
            200,
            {},
            legacyCookie
          )
        ).value
      );
      assert.equal(legacyReplay.id, legacyIssued.id);
      assert.equal(legacyReplay.command, legacyIssued.command);
      assert.equal(
        (
          await request(
            base,
            "/api/installer/delivery",
            "POST",
            { id: legacyIssued.id, token: legacyTicket },
            200,
            {},
            legacyCookie
          )
        ).text,
        legacyArtifact
      );
      const oldAtV2 = await request(
        base,
        "/api/installer/launch/v2",
        "POST",
        { ticket: legacyTicket },
        404
      );
      assertSafeError(oldAtV2.value, [
        legacyTicket,
        legacyBody.password,
        legacySource,
        legacyIssued.id,
      ]);
      ok(
        "Upgraded server replays exact prior v1 command and artifact while its ticket is refused by the new v2 route"
      );
    }
  } finally {
    await db.end();
  }
  console.log(
    "LAUNCH V2 ACCEPTANCE COMPLETE",
    checks,
    "checks; synthetic DB only; no installer, batch, disk, or production access."
  );
}

main().catch(error => {
  // Do not print response bodies, request bodies, tickets, credentials, or URLs.
  console.error(
    "LAUNCH V2 ACCEPTANCE FAILURE",
    error instanceof Error ? error.stack : "unexpected failure"
  );
  process.exit(1);
});
