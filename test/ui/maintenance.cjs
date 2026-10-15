const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const base = process.env.TEST_BASE || "http://127.0.0.1:3143";
const output = process.env.UI_OUTPUT || "/tmp/win11desk-maintenance-ui";
const digest = "a".repeat(64);
const profile = {
  id: "00000000-0000-4000-8000-000000000011",
  name: "Windows 11 Pro",
  osId: "windows-11-pro",
  revision: 1,
};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  let role = "owner",
    blockAll = false,
    failClear = false,
    storageReads = 0;
  const calls = [];
  const countGeometry = [],
    dialogGeometry = [];
  const allCounts = Object.fromEntries(
    [
      "wc_sessions",
      "wc_commands",
      "wc_command_profiles",
      "wc_delivery_secrets",
      "wc_run_meta",
      "wc_events",
      "wc_run_labels",
      "wc_post_install_runs",
      "wc_notifications",
      "wc_remote_jobs",
      "wc_remote_job_events",
      "wc_remote_secrets",
      "wc_remote_reviews",
      "wc_remote_checks",
      "wc_remote_trust",
      "installerTickets",
      "installerTrackingRuns",
      "installerTrackingGroups",
    ].map((key, index) => [key, 1234567 + index])
  );
  let otherSession = true;
  const context = await browser.newContext({
    viewport: { width: 1667, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60000);
  const consoleErrors = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  const storage = {
    sampledAt: new Date().toISOString(),
    filesystem: {
      state: "available",
      scope: "shared-filesystem",
      sampledAt: new Date().toISOString(),
      totalBytes: 100 * 1024 ** 3,
      usedBytes: 25 * 1024 ** 3,
      availableBytes: 70 * 1024 ** 3,
      usedPercent: 25,
    },
    database: {
      state: "available",
      scope: "table-allocation-metadata",
      sampledAt: new Date().toISOString(),
      dataBytes: 4 * 1024 ** 2,
      indexBytes: 1024 ** 2,
      allocatedBytes: 5 * 1024 ** 2,
    },
    ciphertextSubset: {
      state: "available",
      scope: "logical-ciphertext-subset",
      sampledAt: new Date().toISOString(),
      bytes: 1024 ** 2,
    },
  };
  await page.route("**/api/**", async route => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let status = 200,
      body = {};
    if (path === "/api/auth/me")
      body = {
        user: {
          id: "synthetic-owner",
          email: "owner@example.test",
          name: "Synthetic Owner",
          role,
        },
        csrf: "synthetic",
      };
    else if (path === "/api/admin/operations/storage") {
      storageReads++;
      body = storage;
    } else if (path === "/api/auth/account/sessions")
      body = {
        sessions: [
          {
            id: "current",
            current: true,
            last_seen_at: new Date().toISOString(),
          },
          ...(otherSession
            ? [
                {
                  id: "other",
                  current: false,
                  user_agent: "Synthetic other browser",
                  last_seen_at: new Date().toISOString(),
                },
              ]
            : []),
        ],
      };
    else if (path === "/api/auth/account/sessions/clear-others") {
      assert.deepEqual(req.postDataJSON(), { confirm: true });
      otherSession = false;
      body = { success: true, cleared: 1, currentSessionPreserved: true };
    } else if (path === "/api/admin/operations/health")
      body = {
        checkedAt: new Date().toISOString(),
        checks: [],
        versions: { app: "1.0.0", installer: "synthetic", launcher: "v3" },
        deployments: { active: 0, completed: 0, failed: 0, stale: 0 },
        migrations: { pending: [], applied: 0 },
        profiles: {
          ready: 1,
          active: 1,
          unconfigured: 0,
          needsSource: 0,
          archived: 0,
        },
        commands: {
          active: 0,
          available: 0,
          expired: 0,
          revoked: 0,
          total: 0,
          batchCommands: 0,
        },
        callback: { observedHttps: "not-checked" },
        backup: {
          state: "unknown",
          outcome: "not-reported",
          note: "Not reported; restore not tested.",
        },
      };
    else if (path === "/api/admin/operations/attention")
      body = {
        checkedAt: new Date().toISOString(),
        items: [],
        limit: 50,
        counts: { failed: 0, stale: 0, unknown: 0 },
      };
    else if (path === "/api/admin/notifications")
      body = { items: [], unread: 0 };
    else if (path === "/api/admin/remote/health")
      body = { enabled: true, worker: { alive: true }, queue: { depth: 0 } };
    else if (path === "/api/admin/operations/maintenance/preview") {
      const mode = url.searchParams.get("mode");
      body = {
        mode,
        checkedAt: new Date().toISOString(),
        previewDigest: digest,
        confirmPhrase:
          mode === "all"
            ? "CLEAR ALL INSTALLATION DATA"
            : "CLEAR FINISHED HISTORY",
        counts:
          mode === "all"
            ? allCounts
            : { wc_commands: 2, wc_run_meta: 2, wc_remote_jobs: 1 },
        protectedCounts: mode === "finished" ? { active_run: 1 } : {},
        blockers: mode === "all" && blockAll ? ["active_control_run"] : [],
        canClear: mode !== "all" || !blockAll,
        retained: ["Admin accounts", "Profiles", "Settings"],
      };
    } else if (path === "/api/auth/step-up") {
      calls.push({ kind: "step-up" });
      body = { verified: true };
    } else if (path === "/api/admin/operations/maintenance/clear") {
      const data = req.postDataJSON();
      calls.push({ kind: "clear", body: data });
      if (failClear) {
        status = 409;
        body = {
          message: "Maintenance preview is stale; refresh before clearing.",
        };
      } else
        body = {
          cleared: true,
          mode: data.mode,
          counts: { wc_commands: 2, wc_run_meta: 2, wc_remote_jobs: 1 },
          protectedCounts: data.mode === "finished" ? { active_run: 1 } : {},
          retained: ["profiles", "settings", "accounts"],
        };
    } else if (path === "/api/admin/profiles/ready")
      body = { items: [profile], defaultProfileId: profile.id };
    else if (
      path === "/api/admin/deployments" ||
      path === "/api/admin/commands" ||
      path === "/api/admin/remote/jobs"
    )
      body = { items: [], jobs: [], total: 0 };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base + "/operations", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Storage usage", exact: true })
    .waitFor();
  await page
    .getByText(/25.0 GiB/)
    .first()
    .waitFor();
  assert.match(
    await page.locator(".storage-panel").innerText(),
    /not an app-only total/
  );
  assert.match(await page.locator(".storage-panel").innerText(), /5.0 MiB/);
  const beforeRefresh = storageReads;
  await page
    .locator(".storage-panel")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await page.waitForTimeout(150);
  assert.ok(storageReads > beforeRefresh);
  await page.screenshot({
    path: output + "/storage-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Maintenance", exact: true }).click();
  await page
    .getByRole("heading", { name: "Data maintenance", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Preview Clear All Data", exact: true })
    .click();
  await page
    .getByLabel(
      "Type CLEAR ALL INSTALLATION DATA to confirm permanent deletion"
    )
    .waitFor();
  assert.equal(
    await page.getByText("Cannot clear safely:", { exact: true }).count(),
    0
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Verify and clear all installation data",
        exact: true,
      })
      .count(),
    1
  );
  assert.equal(calls.filter(x => x.kind === "clear").length, 0);
  for (const width of [1920, 1397, 1160, 1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 625 });
    const geometry = await page
      .locator(".ops-maintenance-preview .ops-maintenance-counts")
      .evaluate(root => {
        const r = root.getBoundingClientRect();
        const cells = Array.from(root.querySelectorAll("dt,dd")).map(el =>
          el.getBoundingClientRect()
        );
        return {
          width: r.width,
          count: root.children.length,
          allVisible: cells.every(
            c => c.x >= r.x - 1 && c.right <= r.right + 1
          ),
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
        };
      });
    assert.equal(geometry.count, 18);
    assert.ok(geometry.allVisible, `counts clipped at ${width}`);
    assert.equal(geometry.overflow, false);
    countGeometry.push({ width, ...geometry });
    if (width === 1160)
      await page
        .locator(".ops-maintenance-preview")
        .screenshot({ path: output + "/clear-all-review-1160.png" });
  }
  await page.setViewportSize({ width: 1667, height: 1000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview finished cleanup", exact: true })
    .click();
  await page.getByText("Protected / retained work", { exact: true }).waitFor();
  const confirmButton = page.getByRole("button", {
    name: "Verify and clear finished history",
    exact: true,
  });
  assert.ok(await confirmButton.isDisabled());
  await page
    .getByLabel("Type CLEAR FINISHED HISTORY to confirm permanent deletion")
    .fill("CLEAR FINISHED HISTORY");
  await confirmButton.click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Current password", { exact: true })
    .fill("Synthetic owner password long 123!");
  await modal.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByText("Cleanup completed.", { exact: true }).waitFor();
  assert.deepEqual(calls.filter(x => x.kind === "clear")[0].body, {
    mode: "finished",
    confirm: "CLEAR FINISHED HISTORY",
    previewDigest: digest,
  });
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  blockAll = false;
  failClear = false;
  await page
    .getByRole("button", { name: "Preview Clear All Data", exact: true })
    .click();
  await page
    .getByLabel(
      "Type CLEAR ALL INSTALLATION DATA to confirm permanent deletion"
    )
    .fill("CLEAR ALL INSTALLATION DATA");
  await page
    .getByRole("button", {
      name: "Verify and clear all installation data",
      exact: true,
    })
    .click();
  const allDialog = page.getByRole("dialog");
  await allDialog.waitFor();
  for (const width of [1920, 1397, 1160, 1024, 820, 390, 320]) {
    for (const height of [900, 625, 420]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(220);
      const geometry = await allDialog.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          position: getComputedStyle(el).position,
        };
      });
      assert.equal(geometry.position, "fixed");
      assert.ok(
        geometry.x >= 14 && geometry.right <= width - 14,
        JSON.stringify(geometry)
      );
      assert.ok(
        geometry.y >= 18 && geometry.bottom <= height - 18,
        JSON.stringify(geometry)
      );
      const action = allDialog.getByRole("button", {
        name: "Verify and continue",
      });
      await action.scrollIntoViewIfNeeded();
      const r = await action.boundingBox();
      assert.ok(r.y >= 0 && r.y + r.height <= height, JSON.stringify(r));
      dialogGeometry.push({ width, height, contained: true });
      if (width === 1160 && height === 625)
        await page.screenshot({
          path: output + "/clear-all-verification-1160.png",
        });
    }
  }
  await allDialog.getByLabel("Current password", { exact: true }).focus();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    assert.ok(
      await allDialog.evaluate(el => el.contains(document.activeElement)),
      "focus must remain within verification"
    );
  }
  await page.setViewportSize({ width: 1667, height: 1000 });
  await allDialog
    .getByLabel("Current password", { exact: true })
    .fill("Synthetic password 123!");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Verify and continue" })
    .click();
  await page.getByText("Cleanup completed.", { exact: true }).waitFor();
  assert.equal(calls.filter(x => x.kind === "clear").length, 2);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Verify and clear all installation data",
        exact: true,
      })
      .count(),
    0
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.screenshot({
    path: output + "/maintenance-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.evaluate(() => {
    history.pushState(null, "", "/account");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page
    .getByRole("button", {
      name: "Clear other sessions — keep this browser",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Current password", { exact: true })
    .fill("Synthetic password 123!");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Verify and continue" })
    .click();
  await page
    .getByText(
      "Cleared 1 other login sessions. This browser remains signed in.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await page.getByText("Synthetic other browser", { exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByText("This browser", { exact: true }).count(),
    1
  );
  role = "admin";
  await page.goto(base + "/operations", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Storage usage", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Maintenance", exact: true })
      .count(),
    0
  );
  assert.deepEqual(consoleErrors, []);
  const result = {
    passed: true,
    countGeometry,
    dialogGeometry,
    keyboardFocusContained: true,
    storageReads,
    clearCalls: calls.filter(x => x.kind === "clear").length,
    ownerOnly: true,
    unconditionalAll: true,
    clearOtherSessionsKeepsCurrent: true,
    protectedRunning: true,
    typedAndStepUp: true,
    noRealApiRequests: true,
    mobileContained: true,
  };
  fs.writeFileSync(
    output + "/RESULT.json",
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
