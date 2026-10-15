import { chromeAttachment, chromeAssetPath } from "../shared/chromeAttachment";
import assert from "node:assert/strict";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import {
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installerVersion, bashQuote } from "../shared/installer";
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
  assert.ok(process.env.DATABASE_URL);
  assert.ok(
    new URL(process.env.DATABASE_URL!).pathname
      .replace(/^\/+/, "")
      .startsWith("win11desk_test")
  );
  assert.ok(new URL(base).hostname === "127.0.0.1");
  db = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const setup = await api("/api/auth/setup/status");
    if (setup.available)
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
    else
      await api("/api/auth/login", "POST", {
        email: "owner@example.test",
        password: pass,
      });
    const suffix = randomUUID().slice(0, 8);
    const makeProfile = async (osId: string, name: string, imageName: string) =>
      (
        await api(
          "/api/admin/profiles",
          "POST",
          {
            name: name + suffix,
            osId,
            isoUrl: "https://example.test/post-install.iso",
            imageName,
            description: "Synthetic optional action test",
            username: "Administrator",
            remotePort: 22,
            retries: 3,
          },
          201
        )
      ).profile;
    const p = await makeProfile(
      "windows-11-pro",
      "Post client ",
      "Windows 11 Pro"
    );
    const body = {
      profileId: p.id,
      profileRevision: p.revision,
      username: "Administrator",
      password: commandPassword,
      remotePort: 22,
      retries: 3,
      count: 1,
      uniquePasswords: false,
      idempotencyKey: randomUUID(),
      label: "Optional synthetic",
    };
    const off = {
      getFiles: false,
      apps: [],
      customFileUrl: "",
      runAttachedScript: false,
    };
    const plain = (await api("/api/admin/commands", "POST", body)).items[0];
    const plainCap = await capability(plain.id);
    const plainScript = await api("/api/installer/delivery", "POST", {
      id: plain.id,
      token: plainCap,
    });
    assert.ok(!plainScript.includes("Win11Desk post-install worker"));
    assert.ok(!plainScript.includes("ATTACHED_BYTES"));
    const same = (
      await api("/api/admin/commands", "POST", { ...body, postInstall: off })
    ).items[0];
    assert.equal(same.id, plain.id);
    ok(
      "Default Off excludes worker/attachment and preserves old idempotent normalized request"
    );
    await api(
      "/api/admin/commands",
      "POST",
      {
        ...body,
        idempotencyKey: randomUUID(),
        postInstall: { ...off, getFiles: true },
      },
      400
    );
    await api(
      "/api/admin/commands",
      "POST",
      {
        ...body,
        idempotencyKey: randomUUID(),
        postInstall: {
          ...off,
          getFiles: true,
          customFileUrl: "https://127.0.0.1/test.zip",
        },
      },
      400
    );
    await api(
      "/api/admin/commands",
      "POST",
      {
        ...body,
        idempotencyKey: randomUUID(),
        postInstall: { ...off, getFiles: true, apps: ["edge"] },
      },
      400
    );
    const chromeResponse = await fetch(base + chromeAssetPath);
    assert.equal(chromeResponse.status, 200);
    const chromeBytes = Buffer.from(await chromeResponse.arrayBuffer());
    assert.equal(chromeBytes.length, chromeAttachment.bytes);
    assert.equal(
      createHash("sha256").update(chromeBytes).digest("hex"),
      chromeAttachment.sha256
    );
    ok("Exact pinned Chrome route bytes and rejected new Edge selection");
    ok("Invalid empty/private choices rejected");
    const options = {
      getFiles: true,
      apps: ["chrome", "firefox", "7zip"],
      customFileUrl: "https://files.example.com/payload.zip",
      runAttachedScript: true,
    };
    const onBody = {
      ...body,
      idempotencyKey: randomUUID(),
      postInstall: options,
    };
    const issued = (await api("/api/admin/commands", "POST", onBody)).items[0];
    const cap = await capability(issued.id);
    const artifact = await api("/api/installer/delivery", "POST", {
      id: issued.id,
      token: cap,
    });
    assert.equal(
      createHash("sha256").update(artifact).digest("hex"),
      issued.scriptHash
    );
    execFileSync("bash", ["-n"], { input: artifact });
    assert.ok(artifact.includes("ATTACHED_BYTES"));
    assert.ok(artifact.includes("/HWID /HWID-NoEditionChange"));
    assert.equal((artifact.match(/schtasks \/Create/g) || []).length, 1);
    const stagingDir = mkdtempSync(join(tmpdir(), "delivered-post-patch-"));
    try {
      copyFileSync(
        "vendor/reinstall/reinstall.sh",
        join(stagingDir, "original.sh")
      );
      copyFileSync(
        "vendor/reinstall/trans.sh",
        join(stagingDir, "trans.input.sh")
      );
      const patchStart = artifact.indexOf("unset github_proxy");
      const patchEnd = artifact.indexOf('chmod 700 "$WORK/reinstall.sh"');
      assert.ok(patchStart > 0 && patchEnd > patchStart);
      const harness =
        `set -euo pipefail\nWORK=${bashQuote(stagingDir)}\nDOWNLOAD="$WORK/original.sh"\nUPSTREAM_COMMIT=${installerVersion.commit}\nTRANS_SHA256=${installerVersion.transSha256}\nISO_SHA256=${"a".repeat(64)}\nRETRIES=3\nTRACK_ORIGIN=https://fixture.example.com\nTRACK_RUN=11111111-1111-4111-8111-111111111111\nTRACK_TOKEN=${"a".repeat(64)}\nRDP_PORT=22\nfail() { echo 'Fixture patch failed' >&2; exit 1; }\ncurl() { cp "$WORK/trans.input.sh" "$WORK/trans.original.sh"; }\n` +
        artifact.slice(patchStart, patchEnd);
      writeFileSync(join(stagingDir, "patch.sh"), harness);
      execFileSync("bash", [join(stagingDir, "patch.sh")], {
        maxBuffer: 1_000_000,
      });
      for (const file of ["reinstall.sh", "trans.sh"])
        execFileSync("bash", ["-n", join(stagingDir, file)]);
      assert.ok(
        readFileSync(join(stagingDir, "trans.sh"), "utf8").includes(
          'cp /configs/win11desk-attached.bat "$os_dir/win11desk-attached.bat"'
        )
      );
      assert.equal(
        createHash("sha256")
          .update(
            readFileSync(join(stagingDir, "tracking/win11desk-attached.bat"))
          )
          .digest("hex"),
        "17f10848ae162dd6e68c0e19080474e043ecad3caba4b10a50368006d2788e90"
      );
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    ok(
      "Exact delivered artifact full AWK/media/telemetry staging executes safely before any install call"
    );
    const [rows]: any = await db.query(
      "SELECT config_json FROM wc_commands WHERE id=?",
      [issued.id]
    );
    const cfg =
      typeof rows[0].config_json === "string"
        ? JSON.parse(rows[0].config_json)
        : rows[0].config_json;
    assert.deepEqual(
      cfg.postInstall.files.map((v: any) => v.id),
      ["chrome", "firefox", "7zip", "custom"]
    );
    assert.equal(
      cfg.postInstall.script.sha256,
      "17f10848ae162dd6e68c0e19080474e043ecad3caba4b10a50368006d2788e90"
    );
    ok(
      "Enabled immutable artifact stages exact batch, selected files only and a separate persistent startup job"
    );
    const replay = (await api("/api/admin/commands", "POST", onBody)).items[0];
    assert.equal(replay.id, issued.id);
    assert.equal(replay.command, issued.command);
    assert.equal(
      await api("/api/installer/delivery", "POST", {
        id: issued.id,
        token: cap,
      }),
      artifact
    );
    ok("Exact enabled replay/delivery unchanged");
    const s = await makeProfile(
      "windows-server-2022-standard-evaluation",
      "Post Server ",
      "Windows Server 2022 Standard Evaluation (Desktop Experience)"
    );
    await api(
      "/api/admin/commands",
      "POST",
      {
        ...body,
        profileId: s.id,
        profileRevision: s.revision,
        idempotencyKey: randomUUID(),
        postInstall: { ...off, runAttachedScript: true },
      },
      400
    );
    ok("Server attachment execution refused");
    const group = artifact.match(/TRACK_GROUP='([^']+)'/)![1],
      write = artifact.match(/TRACK_GROUP_TOKEN='([^']+)'/)![1];
    const run = await api(
      "/api/installer/tracking/" + group + "/runs",
      "POST",
      {
        executionId: randomUUID(),
        hostname: "post-synthetic",
        disk: "/dev/vda",
        rdpPort: 22,
        publicIP: "203.0.113.52",
      },
      201,
      { Authorization: "Bearer " + write }
    );
    const url = "/api/installer/tracking/runs/" + run.runId + "/post-install";
    const headers = { Authorization: "Bearer " + run.reportToken };
    const report: any = {
      status: "running",
      files: cfg.postInstall.files.map((f: any) => ({
        id: f.id,
        status: "pending",
        bytes: 0,
        sha256: null,
        errorCode: null,
      })),
      script: {
        enabled: true,
        status: "pending",
        exitCode: null,
        activationObserved: null,
        errorCode: null,
      },
      errorCode: null,
    };
    await api(url, "POST", report, 401);
    await api(url, "POST", report, 404, headers);
    await api(
      "/api/installer/tracking/runs/" + run.runId + "/events",
      "POST",
      {
        stage: "windows_ready",
        windowsEdition: "Professional",
        windowsBuild: 26300,
        windowsInstallationType: "Client",
        rdpListening: true,
      },
      204,
      headers
    );
    const beforeOs = (
      await db.query("SELECT * FROM wc_run_meta WHERE run_id=?", [run.runId])
    )[0];
    await api(url, "POST", report, 204, headers);
    await api(
      url,
      "POST",
      { ...report, files: [...report.files, report.files[0]] },
      400,
      headers
    );
    ok(
      "Run capability and actual Windows-ready stage required; strict selection outcomes"
    );
    const done = {
      ...report,
      status: "completed",
      files: cfg.postInstall.files.map((f: any) => ({
        id: f.id,
        status: "downloaded",
        bytes: 100,
        sha256: f.sha256 || "a".repeat(64),
        errorCode: null,
      })),
      script: {
        enabled: true,
        status: "completed",
        exitCode: 0,
        activationObserved: false,
        errorCode: null,
      },
    };
    await api(url, "POST", done, 400, headers);
    const failed = {
      ...done,
      status: "failed",
      script: {
        ...done.script,
        status: "failed",
        errorCode: "NO_ACTIVATION_EVIDENCE",
      },
    };
    await api(url, "POST", failed, 204, headers);
    await api(url, "POST", failed, 204, headers);
    await api(
      url,
      "POST",
      { ...done, script: { ...done.script, activationObserved: true } },
      400,
      headers
    );
    const detail = await api("/api/admin/deployments/" + run.runId);
    const d = detail.deployment;
    assert.equal(d.stage, "windows_ready");
    assert.equal(d.postInstall.report.status, "failed");
    assert.ok(d.postInstall.desktopFolder.endsWith(run.runId));
    assert.equal(d.postInstall.report.script.exitCode, 0);
    assert.ok(!JSON.stringify(d.postInstall).includes(options.customFileUrl));
    const [proof]: any = await db.query(
      "SELECT stage FROM wc_run_meta WHERE run_id=?",
      [run.runId]
    );
    assert.equal(proof[0].stage, "windows_ready");
    assert.equal(
      createHash("sha256")
        .update(
          JSON.stringify(
            (
              await db.query("SELECT * FROM wc_run_meta WHERE run_id=?", [
                run.runId,
              ])
            )[0]
          )
        )
        .digest("hex"),
      createHash("sha256").update(JSON.stringify(beforeOs)).digest("hex")
    );
    ok(
      "Optional failure never changes Windows completion; terminal callbacks immutable/idempotent and DTO redacts source"
    );
    await db.query(
      "UPDATE installerTrackingRuns SET expiresAt=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id=?",
      [run.runId]
    );
    await api(url, "POST", failed, 404, headers);
    ok("Expired report capability rejected");
  } finally {
    await db.end();
  }
  console.log(
    "POST-INSTALL INTEGRATION COMPLETE",
    checks,
    "checks; no OS or batch executed."
  );
}
main().catch(e => {
  console.error("POST INSTALL TEST FAILURE", e.message);
  process.exit(1);
});
