const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3150";
const output = process.env.UI_OUTPUT || "/tmp/win11desk-redesign-ui";
const now = new Date().toISOString();
const id = "11111111-1111-4111-8111-111111111111";
const profile = {
  id,
  name: "Windows 11 laboratory",
  osId: "windows-11-pro",
  osName: "Windows 11 Pro",
  group: "Windows 11",
  revision: 1,
  username: "Administrator",
  remotePort: 22,
  retries: 10,
  isoUrl: "https://example.test/windows.iso",
  imageName: "Windows 11 Pro",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  tested: false,
  commandCount: 123456,
  deploymentCount: 0,
};
const user = {
  id: "synthetic-owner",
  name: "Synthetic Owner",
  email: "owner@example.test",
  role: "owner",
  mfaEnabled: false,
};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1000 },
  });
  const page = await context.newPage();
  async function navigateTo(path) {
    if (authenticated && page.url().startsWith(base)) {
      await page.evaluate(next => {
        history.pushState(null, "", next);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    } else await page.goto(base + path, { waitUntil: "domcontentloaded" });
  }
  const errors = [],
    requests = [],
    visited = [];
  let authenticated = true,
    testJobsEnabled = false;
  const jobA = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    label: "Synthetic job A",
    target: { host: "192.0.2.10", port: 22 },
    profileName: profile.name,
    state: "queued",
    canCancel: true,
    createdAt: now,
    updatedAt: now,
  };
  const jobB = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "Synthetic job B",
    target: { host: "192.0.2.11", port: 22 },
    profileName: profile.name,
    state: "handed_off",
    canCancel: false,
    createdAt: now,
    updatedAt: now,
  };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    requests.push({ path, method: request.method() });
    let status = 200,
      body = {};
    if (path === "/api/auth/me") {
      status = authenticated ? 200 : 401;
      body = authenticated
        ? { user, csrf: "synthetic" }
        : { message: "Unauthenticated" };
    } else if (path === "/api/auth/login") {
      authenticated = true;
      body = { success: true, user, csrf: "synthetic" };
    } else if (path === "/api/auth/setup/status") body = { available: true };
    else if (path === "/api/admin/overview")
      body = {
        counts: {
          active: 2,
          completed: 6,
          failed: 1,
          stale: 1,
          commands: 9,
          pending: 0,
          archived: 0,
        },
        notices: [],
        recent: [],
      };
    else if (path === "/api/admin/profiles/ready")
      body = { items: [profile], defaultProfileId: id };
    else if (path === "/api/admin/profiles") body = { items: [profile] };
    else if (path === "/api/admin/profiles/" + id) body = { profile };
    else if (
      path === "/api/admin/commands" ||
      path === "/api/admin/deployments"
    )
      body = { items: [], total: 0 };
    else if (path === "/api/admin/remote/jobs")
      body = {
        items: testJobsEnabled ? [jobA, jobB] : [],
        jobs: [],
        total: testJobsEnabled ? 2 : 0,
      };
    else if (path === "/api/admin/remote/config") body = { enabled: true };
    else if (path.startsWith("/api/admin/remote/jobs/")) {
      const job = path.endsWith(jobB.id) ? jobB : jobA;
      if (job === jobB) await new Promise(resolve => setTimeout(resolve, 700));
      body = { job, events: [] };
    } else if (path === "/api/auth/step-up") body = { verified: true };
    else if (path === "/api/auth/account/recovery")
      body = {
        recoveryCodes: ["SYNTHETIC-RECOVERY-01", "SYNTHETIC-RECOVERY-02"],
      };
    else if (path === "/api/admin/remote/health")
      body = { enabled: true, worker: { alive: true }, queue: { depth: 0 } };
    else if (path === "/api/admin/remote/capabilities")
      body = { enabled: true };
    else if (path === "/api/auth/users")
      body = {
        users: [{ ...user, active: true, created_at: now }],
        invitations: [],
        invites: [],
      };
    else if (path === "/api/auth/account/sessions")
      body = {
        sessions: [{ id: "current", current: true, last_seen_at: now }],
      };
    else if (path === "/api/admin/operations/health")
      body = {
        checkedAt: now,
        checks: [],
        versions: { app: "synthetic", installer: "synthetic", launcher: "v3" },
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
          note: "Not reported",
        },
      };
    else if (path === "/api/admin/operations/attention")
      body = {
        checkedAt: now,
        items: [],
        counts: { failed: 0, stale: 0, unknown: 0 },
        limit: 50,
      };
    else if (path === "/api/admin/operations/storage")
      body = {
        sampledAt: now,
        filesystem: {
          state: "unavailable",
          scope: "shared-filesystem",
          reason: "Synthetic unavailable sample",
        },
        database: { state: "unavailable", scope: "table-allocation-metadata" },
        ciphertextSubset: {
          state: "unavailable",
          scope: "logical-ciphertext-subset",
        },
      };
    else if (path === "/api/admin/notifications")
      body = { items: [], unread: 0 };
    else if (path.startsWith("/api/installer/tracking/"))
      body = {
        runs: [],
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base + "/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Where do you want to go?").fill("profiles");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/profiles");
  await dialog.waitFor({ state: "hidden" });
  for (const route of [
    "/",
    "/installer",
    "/remote-jobs",
    "/commands",
    "/deployments",
    "/profiles",
    "/profiles/" + id,
    "/operations",
    "/users",
    "/account",
  ]) {
    await navigateTo(route);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForTimeout(200);
    assert.ok(await page.locator(".workspace-topbar").isVisible());
    assert.equal(await page.locator(".control-sidebar").count(), 1);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      route + " desktop overflow"
    );
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(el => el.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    assert.deepEqual(duplicateIds, [], route + " duplicate IDs");
    visited.push(route);
    await page.screenshot({
      path:
        output +
        "/" +
        (route === "/" ? "overview" : route.replaceAll("/", "-").slice(1)) +
        ".png",
      fullPage: true,
    });
  }
  const compactChecks = [];
  for (const width of [1920, 1512, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/",
      "/installer",
      "/profiles",
      "/profiles/" + id,
      "/commands",
      "/deployments",
      "/remote-jobs",
      "/operations",
      "/users",
      "/account",
    ]) {
      await navigateTo(route);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForTimeout(150);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        route + " overflow at " + width
      );
      if (route === "/") {
        await page.locator(".overview-vng-hero").waitFor();
        const height = await page
          .locator(".overview-vng-hero")
          .evaluate(el => el.getBoundingClientRect().height);
        assert.ok(
          height <= (width > 760 ? 215 : 340),
          "Overview header oversized " + JSON.stringify({ width, height })
        );
        compactChecks.push({ route, width, height });
      } else if (route === "/installer") {
        await page.waitForFunction(
          () =>
            document
              .querySelector(".os-profile-field")
              ?.getAttribute("aria-busy") === "false"
        );
        for (const mode of ["Install via SSH", "Manual command"]) {
          await page.getByRole("tab", { name: mode, exact: true }).click();
          assert.equal(
            await page.locator(".installer-vng-rail").count(),
            0,
            "Workflow must be removed in " + mode
          );
          assert.equal(
            await page
              .locator(".installer-vng-workspace")
              .getByText("WORKFLOW", { exact: true })
              .count(),
            0
          );
          assert.ok(
            await page
              .getByLabel("Windows username", { exact: true })
              .isVisible()
          );
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            mode + " overflow at " + width
          );
        }
        compactChecks.push({ route, width, workflowRemovedBothModes: true });
      } else if (route === "/profiles") {
        await page.locator(".profiles-row-stats").waitFor();
        assert.equal(
          await page.locator(".profiles-row-stats .stat").count(),
          0,
          "Usage must not render generic tall Stat cards"
        );
        const usage = await page
          .locator(".profiles-row-stats")
          .evaluate(el => ({
            height: el.getBoundingClientRect().height,
            text: el.textContent,
          }));
        assert.ok(
          usage.height <= 60,
          "Usage counters oversized " + JSON.stringify({ width, ...usage })
        );
        assert.ok(
          usage.text.includes("123456") && usage.text.includes("Deployments")
        );
        compactChecks.push({ route, width, usageHeight: usage.height });
      }
      if (route === "/deployments") {
        const selection = await page
          .locator(".deployment-select-all")
          .evaluate(el => {
            const a = el.querySelector("input").getBoundingClientRect(),
              b = el.querySelector("span").getBoundingClientRect();
            return {
              gap: b.x - a.right,
              height: el.getBoundingClientRect().height,
            };
          });
        assert.ok(
          selection.gap >= 7 && selection.height >= 40,
          JSON.stringify(selection)
        );
      }
      if (
        [1920, 390].includes(width) &&
        ["/", "/installer", "/profiles"].includes(route)
      ) {
        await page.screenshot({
          path:
            output +
            "/compact-" +
            (route === "/" ? "overview" : route.slice(1)) +
            "-" +
            width +
            ".png",
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1512, height: 1000 });
  await navigateTo("/account");
  const themeControls = page.getByLabel("Theme colour", { exact: true });
  assert.equal(await themeControls.count(), 2);
  await themeControls.last().selectOption("emerald");
  await page.waitForTimeout(120);
  assert.equal(await themeControls.first().inputValue(), "emerald");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.accent),
    "emerald"
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await navigateTo("/installer");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    assert.ok(await page.locator(".control-sidebar").isVisible());
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label")
      ),
      "Close navigation"
    );
    await page
      .locator(".control-sidebar")
      .getByRole("link", { name: "Account", exact: true })
      .click();
    await page.waitForURL("**/account");
    assert.ok(!(await page.locator(".control-sidebar").isVisible()));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      "mobile overflow " + width
    );
    await page.screenshot({
      path: output + "/account-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1512, height: 1000 });
  await navigateTo("/account");
  await page
    .getByRole("button", {
      name: "Regenerate offline recovery codes",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Current password", { exact: true })
    .fill("Synthetic verification password 123!");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  const recovery = page.getByRole("region", {
    name: "New recovery codes",
    exact: true,
  });
  await recovery
    .getByText("SYNTHETIC-RECOVERY-01 SYNTHETIC-RECOVERY-02", { exact: true })
    .waitFor();
  await recovery
    .getByRole("button", { name: "Dismiss recovery codes", exact: true })
    .click();
  assert.equal(await recovery.count(), 0);
  testJobsEnabled = true;
  await navigateTo("/remote-jobs");
  await page
    .locator(".remote-job-row")
    .filter({ hasText: "Synthetic job A" })
    .click();
  const detail = page.getByRole("article", {
    name: "Remote job detail",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "Cancel before it starts", exact: true })
    .waitFor();
  const selectedJobAUrl = page.url();
  assert.ok(
    new URL(selectedJobAUrl).searchParams.get("job"),
    "Row selection must update its deep link"
  );
  await page
    .locator(".remote-job-row")
    .filter({ hasText: "Synthetic job B" })
    .click();
  assert.equal(
    await detail
      .getByRole("button", { name: "Cancel before it starts", exact: true })
      .count(),
    0,
    "Old-job action must disappear immediately on selection"
  );
  await detail.getByText("192.0.2.11:22 · root", { exact: true }).waitFor();
  assert.equal(
    await detail.getByText("192.0.2.10:22 · root", { exact: true }).count(),
    0
  );
  const selectedJobBUrl = page.url();
  assert.notEqual(
    new URL(selectedJobAUrl).searchParams.get("job"),
    new URL(selectedJobBUrl).searchParams.get("job")
  );
  await page.goBack();
  await page.waitForURL(selectedJobAUrl);
  await detail.getByText("192.0.2.10:22 · root", { exact: true }).waitFor();
  await page.goForward();
  await page.waitForURL(selectedJobBUrl);
  await detail.getByText("192.0.2.11:22 · root", { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base + "/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches
    ),
    true
  );
  authenticated = false;
  await page.setViewportSize({ width: 1512, height: 1000 });
  for (const route of ["/login", "/setup", "/recovery", "/invite"]) {
    await navigateTo(route);
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.ok(await page.locator(".auth-story").isVisible());
    assert.match(
      await page.locator(".auth-story h2").innerText(),
      /Install Windows\.\s*Track your installations\./
    );
    assert.match(
      await page.locator(".auth-story-content > p").innerText(),
      /Choose a profile, install Windows on your VPS/
    );
    assert.ok(
      await page
        .locator(".auth-story h2")
        .evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 42)
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    await page.screenshot({
      path: output + route.replace("/", "/auth-") + ".png",
      fullPage: true,
    });
  }
  await page.goto(base + "/track/" + id + "#" + "a".repeat(64));
  await page
    .getByRole("heading", {
      name: "Track your Windows installations.",
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Waiting for your deployment to start.", { exact: true })
    .waitFor();
  await page.screenshot({
    path: output + "/private-tracker.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.ok(
    !requests.some(request => request.path.endsWith("/clear")),
    "No cleanup request permitted"
  );
  assert.ok(
    !requests.some(request => request.path.endsWith("/install")),
    "No install request permitted"
  );
  const result = {
    passed: true,
    compactChecks,
    alignmentWidths: [1920, 1512, 820, 390, 320],
    visited,
    responsiveWidths: [1512, 820, 390],
    keyboardSearch: true,
    synchronizedTheme: true,
    reducedMotion: true,
    authRoutes: 4,
    privateTracker: true,
    recoveryCodeDisplayAndDismissal: true,
    staleRemoteSelectionProtected: true,
    noRealApiRequests: true,
    pageErrors: errors,
  };
  fs.writeFileSync(
    output + "/RESULT.json",
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
