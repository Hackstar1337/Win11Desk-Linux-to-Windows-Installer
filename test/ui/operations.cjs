const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3118",
  out = process.env.UI_OUTPUT || "/tmp/win11desk-operations-ui";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1667, height: 1080 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  let role = "owner",
    read = "all",
    kinds = [],
    marked = 0,
    failHealth = false;
  const now = new Date().toISOString();
  const backup = {
    state: "unknown",
    lastBackupAt: null,
    outcome: "not-reported",
    encryptedBytes: null,
    checksumVerified: null,
    lastRestoreVerifiedAt: null,
    note: "Not reported; restore not tested.",
  };
  const health = {
    checkedAt: now,
    checks: ["api", "database", "vault"].map(id => ({
      id,
      label: id === "api" ? "Application API" : id,
      state: "ok",
      detail: "Synthetic check succeeded",
      checkedAt: now,
    })),
    migrations: { expected: 7, applied: 7, pending: [], state: "ok" },
    versions: {
      app: "1.0.0",
      installer: "synthetic pinned source",
      launcher: "current embedded bootstrap",
    },
    profiles: { ready: 1, needsSource: 2, archived: 0 },
    commands: {
      available: 2,
      expired: 0,
      revoked: 0,
      total: 2,
      batchCommands: 0,
    },
    deployments: { active: 1, completed: 1, failed: 1, stale: 0 },
    callback: {
      origin: base,
      httpsConfigured: base.startsWith("https:"),
      observedHttps: "not-checked",
    },
    backup,
  };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()),
      p = url.pathname,
      method = route.request().method();
    let data = { items: [] };
    let status = 200;
    if (p === "/api/auth/me")
      data = {
        user: {
          id: "synthetic-user",
          name: "Synthetic Owner",
          email: "synthetic@example.test",
          role,
        },
        csrf: "synthetic-csrf",
      };
    else if (p === "/api/admin/operations/storage")
      data = {
        sampledAt: now,
        filesystem: { state: "unavailable" },
        database: { state: "unavailable" },
        ciphertextSubset: { state: "unavailable" },
      };
    else if (p === "/api/admin/operations/health") {
      data = {
        ...health,
        commands: role === "viewer" ? null : health.commands,
      };
      if (failHealth) {
        status = 503;
        data = { error: "Synthetic health unavailable" };
      }
    } else if (p === "/api/admin/operations/attention")
      data = {
        checkedAt: now,
        limit: 50,
        items: [
          {
            id: "00000000-0000-4000-8000-000000000123",
            label: "COMPANY-1",
            publicIP: "192.0.2.25",
            os: "Windows 11 Pro",
            profileId: "00000000-0000-4000-8000-000000000011",
            profileName: "Default",
            stage: "downloading",
            status: "stale",
            createdAt: now,
            startedAt: now,
            finishedAt: now,
            lastHeartbeatAt: now,
            safeCode: "ISO_SHA256_MISMATCH",
            nextStep:
              "Review the profile media and Details before preparing another command.",
          },
        ],
      };
    else if (p === "/api/admin/notifications" && method === "GET") {
      read = url.searchParams.get("read") || "all";
      kinds.push(url.searchParams.get("kind") || "all");
      data = {
        limit: 50,
        unreadCount: marked ? 0 : 1,
        items: [
          {
            id: "notification-1",
            runId: "00000000-0000-4000-8000-000000000123",
            kind: "failed",
            title: "Synthetic installation failure",
            body: "Open deployment details.",
            createdAt: now,
            readAt: marked ? now : null,
          },
        ],
      };
    } else if (p === "/api/admin/notifications/read-all") {
      marked++;
      data = { readCount: 1, limit: 100 };
    } else if (p === "/api/admin/operations/diagnostics")
      data = { ...health, failureCodes: ["ISO_SHA256_MISMATCH"] };
    else if (p.startsWith("/api/admin/operations/guides/"))
      data = {
        title: "Synthetic backup procedure",
        steps: ["Use encrypted host backup."],
      };
    else if (p === "/api/admin/profiles") data = { items: [], catalog: [] };
    else if (p === "/api/admin/overview")
      data = { counts: {}, recentDeployments: [] };
    else if (
      p === "/api/admin/presets" ||
      p === "/api/admin/settings" ||
      p === "/api/admin/activity"
    )
      throw new Error("Removed section fetched " + p);
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto(base + "/operations?removed=activity");
  await page.getByRole("heading", { name: "System health" }).waitFor();
  await page.getByText("Synthetic check succeeded").first().waitFor();
  const nav = page.getByRole("navigation", { name: "Dashboard navigation" });
  for (const name of ["Presets", "Default settings", "Activity"])
    assert.equal(await nav.getByRole("link", { name, exact: true }).count(), 0);
  assert.equal(
    await nav.getByRole("link", { name: "Account", exact: true }).count(),
    1
  );
  assert.equal(
    await nav.getByRole("link", { name: "Users & invites" }).count(),
    1
  );
  assert.ok(
    (await page.locator(".ops-inline-success").innerText()).includes("removed")
  );
  assert.equal(await page.locator("pre.generated").count(), 0);
  await page.screenshot({ path: out + "/health.png", fullPage: true });
  await page.getByRole("button", { name: "Attention", exact: true }).click();
  await page.getByText("COMPANY-1", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".ops-status-stale").innerText(),
    "Awaiting update"
  );
  assert.ok(
    (await page.locator(".ops-table tbody").innerText()).includes(
      "Last stage: downloading"
    )
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Installation history" })
      .getAttribute("href"),
    "/deployments?p=00000000-0000-4000-8000-000000000011"
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Open deployment" })
      .getAttribute("href"),
    "/deployments/00000000-0000-4000-8000-000000000123"
  );
  await page.screenshot({ path: out + "/attention.png", fullPage: true });
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page.getByText("Synthetic installation failure").waitFor();
  await page.locator(".ops-filter-row select").first().selectOption("unread");
  await page.waitForTimeout(250);
  assert.equal(read, "unread");
  await page.locator(".ops-filter-row select").nth(1).selectOption("failed");
  await page.waitForTimeout(250);
  assert.equal(kinds.at(-1), "failed");
  await page
    .getByRole("button", { name: "Mark all read", exact: true })
    .click();
  await page.waitForTimeout(200);
  assert.equal(marked, 1);
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
  await page.getByText("Not tested / not reported").waitFor();
  await page.getByRole("button", { name: "Load summary" }).click();
  await page
    .getByRole("button", { name: "Download diagnostics JSON" })
    .waitFor();
  await page.locator("summary").click();
  const token = page.getByLabel("Private tracker access token (after #)");
  await token.fill("synthetic-sensitive-token");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("summary").click();
  assert.equal(await token.inputValue(), "");
  await page.screenshot({ path: out + "/recovery.png", fullPage: true });
  for (const path of ["/presets", "/settings"]) {
    await page.goto(base + path);
    await page.waitForURL("**/profiles");
  }
  await page.goto(base + "/activity");
  await page.waitForURL("**/operations**");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "System health" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({ path: out + "/mobile.png", fullPage: true });
  role = "viewer";
  await page.goto(base + "/operations");
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Load summary" }).count(),
    0
  );
  assert.equal(await page.locator("summary").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .count(),
    0
  );
  role = "owner";
  failHealth = true;
  await page.goto(base + "/operations");
  await page
    .getByText("Synthetic health unavailable", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Attention", exact: true }).click();
  await page.getByText("COMPANY-1", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    removedSections: true,
    accountAndUsersRetained: true,
    legacyRedirects: true,
    healthAttentionRecovery: true,
    scopedNotifications: true,
    filterRefresh: true,
    tokenCleared: true,
    viewerRestrictions: true,
    partialErrorIsolation: true,
    mobileContained: true,
  };
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
