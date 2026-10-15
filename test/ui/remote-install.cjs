#!/usr/bin/env node
const fs = require("node:fs");
/*
 * Run against an isolated local preview only. Every response below is synthetic:
 * no production login, real target, SSH connection, installer, or disk operation.
 * Example:
 *   TEST_BASE=http://127.0.0.1:3111 NODE_PATH=/tmp/win11desk-browser-test/node_modules node test/ui/remote-install.cjs
 */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const base = process.env.TEST_BASE || "http://127.0.0.1:3111";
const output = process.env.UI_OUTPUT || "/tmp/win11desk-ui-verification";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) =>
      original(
        handler,
        delay === 75000 && window.__fastSshTimeout ? 30 : delay,
        ...args
      );
  });
  const requests = [];
  let rejectFirstCheck = true;
  let rejectConnectionCheck = true;
  let delayConnectionCheck = true;
  const launchResponses = ["reject", "missing", "accepted"];
  const geometry = [];
  const rejection =
    "The VPS reports 1 CPU core(s); at least 2 are required. No installation started.";
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : undefined;
    requests.push({ method: request.method(), path: url.pathname, body });
    const json = value =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (url.pathname === "/api/auth/me")
      return json({
        user: {
          id: "fixture-admin",
          role: "admin",
          email: "admin@example.test",
          name: "Fixture Admin",
          permissions: ["remote:install"],
        },
        csrf: "fixture",
      });
    if (url.pathname === "/api/admin/profiles/ready")
      return json({
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Windows 11 Pro",
            osId: "windows-11-pro",
            osName: "Windows 11 Pro",
            group: "Windows 11",
            revision: 7,
            username: "Administrator",
            remotePort: 3389,
            retries: 10,
            tested: true,
          },
        ],
        defaultProfileId: "11111111-1111-4111-8111-111111111111",
      });
    if (url.pathname === "/api/admin/remote/config")
      return json({ enabled: true });
    if (url.pathname === "/api/admin/remote/discover")
      return json({
        fingerprint: "SHA256:fixture-host-fingerprint",
        keyType: "ssh-ed25519",
      });
    if (url.pathname === "/api/admin/remote/checks" && rejectFirstCheck) {
      rejectFirstCheck = false;
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "PREFLIGHT_CPU_INSUFFICIENT",
          message: rejection,
        }),
      });
    }
    if (url.pathname === "/api/admin/remote/checks" && rejectConnectionCheck) {
      rejectConnectionCheck = false;
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "CONNECTION_REFUSED",
          message:
            "This VPS refused the SSH connection. Check its SSH service and port.",
        }),
      });
    }
    if (url.pathname === "/api/admin/remote/checks" && delayConnectionCheck) {
      delayConnectionCheck = false;
      await new Promise(resolve => setTimeout(resolve, 200));
      return route
        .fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "TIMEOUT",
            message: "Delayed fixture",
          }),
        })
        .catch(() => {});
    }
    if (url.pathname === "/api/admin/remote/checks")
      return json({
        checkId: "check-fixture",
        fingerprint: "SHA256:fixture-host-fingerprint",
        inventory: {
          hostname: "fixture-linux",
          architecture: "x86_64",
          root: true,
          virtualization: "kvm",
          memoryMiB: 4096,
          nominalMemoryMiB: 4352,
          crashReservedBytes: 268435456,
          cpuCount: 4,
          disk: "/dev/vda",
          diskBytes: 214748364800,
          diskSerial: "fixture-disk",
          bootMode: "uefi",
          runner: "systemd",
          httpsReachable: true,
          checkedAt: new Date().toISOString(),
        },
      });
    if (url.pathname === "/api/admin/remote/reviews")
      return json({
        review: {
          id: "review-fixture",
          approvalDigest: "digest-fixture",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          target: { host: "203.0.113.20", port: 22, username: "root" },
          fingerprint: "SHA256:fixture-host-fingerprint",
          inventory: {
            hostname: "fixture-linux",
            architecture: "x86_64",
            root: true,
            virtualization: "kvm",
            memoryMiB: 4096,
            nominalMemoryMiB: 4352,
            crashReservedBytes: 268435456,
            cpuCount: 4,
            disk: "/dev/vda",
            diskBytes: 214748364800,
            diskSerial: "fixture-disk",
            bootMode: "uefi",
            runner: "systemd",
            httpsReachable: true,
            checkedAt: new Date().toISOString(),
          },
          settings: {
            profileId: "11111111-1111-4111-8111-111111111111",
            profileRevision: 7,
            username: "Administrator",
            remotePort: 3389,
            retries: 10,
            label: "fixture",
            postInstall: undefined,
          },
          profileName: "Windows 11 Pro",
        },
      });
    if (url.pathname === "/api/admin/remote/jobs" && request.method() === "GET")
      return json({
        items: [
          {
            id: "job-fixture",
            target: { host: "203.0.113.20", port: 22, username: "root" },
            state: "queued",
            label: "fixture",
            profileName: "Windows 11 Pro",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            errorCode: null,
            commandId: null,
            groupId: null,
            runId: null,
            canCancel: true,
          },
        ],
      });
    if (
      url.pathname === "/api/admin/remote/jobs" &&
      request.method() === "POST"
    ) {
      const next = launchResponses.shift();
      if (next === "reject")
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Fixture launch rejected. No installation started.",
          }),
        });
      if (next === "missing") return json({});
      return json({ id: "job-fixture", state: "queued" });
    }
    if (url.pathname === "/api/admin/deployments")
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (url.pathname === "/api/admin/remote/jobs/job-fixture")
      return json({
        job: {
          id: "job-fixture",
          target: { host: "203.0.113.20", port: 22, username: "root" },
          state: "queued",
          label: "fixture",
          profileName: "Windows 11 Pro",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          errorCode: null,
          commandId: null,
          groupId: null,
          runId: null,
          canCancel: true,
        },
        events: [
          {
            phase: "queued",
            message: "Job accepted",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    if (url.pathname === "/api/admin/remote/jobs/job-fixture/cancel")
      return json({ state: "cancelled" });
    if (url.pathname === "/api/admin/remote/health")
      return json({
        enabled: true,
        workerAlive: true,
        workerHeartbeatAt: new Date().toISOString(),
        queued: 1,
        oldestQueuedAt: new Date().toISOString(),
        uncertain: 0,
      });
    return json({});
  });

  try {
    await page.goto(`${base}/installer`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("tab", { name: "Install via SSH", exact: true })
      .click();
    await page
      .locator(".installer-form input[type=password]")
      .fill("windows-secret-fixture");
    const panel = page.locator(".remote-install");
    await panel.scrollIntoViewIfNeeded();
    await page.getByLabel("Public IP address").fill("203.0.113.20");
    await page.getByLabel("SSH password").fill("ssh punctuation ! @ # $ %");
    await page.getByRole("button", { name: "Discover host" }).click();
    await page
      .getByText("SHA256:fixture-host-fingerprint", { exact: true })
      .waitFor();
    await assert.match(
      await panel.innerText(),
      /SHA256:fixture-host-fingerprint/
    );
    assert.equal(
      await page.getByRole("button", { name: "Test connection" }).isDisabled(),
      true
    );
    assert.equal(
      requests.filter(item => item.path === "/api/admin/remote/checks").length,
      0,
      "host key trust must be explicit"
    );
    await page.getByLabel(/I compared this fingerprint/).check();
    await page.getByRole("button", { name: "Test connection" }).click();
    await panel.getByRole("alert").filter({ hasText: rejection }).waitFor();
    assert.equal(await page.getByLabel("SSH password").inputValue(), "");
    assert.equal(
      await page
        .getByRole("button", { name: "Create installation review" })
        .count(),
      0
    );
    assert.equal(
      requests.filter(
        x => x.path === "/api/admin/remote/jobs" && x.method === "POST"
      ).length,
      0
    );
    await page.getByLabel("SSH password").fill("ssh punctuation ! @ # $ %");
    await page.getByRole("button", { name: "Test connection" }).click();
    await panel
      .getByRole("alert")
      .filter({ hasText: "refused the SSH connection" })
      .waitFor();
    assert.equal(await page.getByLabel("SSH password").inputValue(), "");
    assert.equal(
      await page
        .getByRole("button", { name: "Create installation review" })
        .count(),
      0
    );
    await page.evaluate(() => {
      window.__fastSshTimeout = true;
    });
    await page.getByLabel("SSH password").fill("ssh punctuation ! @ # $ %");
    await page.getByRole("button", { name: "Test connection" }).click();
    await panel
      .getByRole("alert")
      .filter({ hasText: "connection request timed out" })
      .waitFor();
    assert.equal(await page.getByLabel("SSH password").inputValue(), "");
    assert.equal(
      requests.filter(
        x => x.path === "/api/admin/remote/jobs" && x.method === "POST"
      ).length,
      0
    );
    await page.evaluate(() => {
      window.__fastSshTimeout = false;
    });
    await page.getByLabel("SSH password").fill("ssh punctuation ! @ # $ %");
    await page.getByRole("button", { name: "Test connection" }).click();
    await page
      .getByText("Nominal memory (includes crash reservation)", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Create installation review" })
      .click();
    await page.locator('[aria-label="Final installation review"]').waitFor();
    const review = await page
      .locator('[aria-label="Final installation review"]')
      .innerText();
    assert.match(review, /203\.0\.113\.20/);
    assert.match(review, /fixture-linux/);
    assert.match(review, /Whole disk to erase/i);
    assert.doesNotMatch(review, /ssh punctuation/);
    assert.doesNotMatch(review, /windows-secret-fixture/);
    const reviewRequest = requests.find(
      item => item.path === "/api/admin/remote/reviews"
    );
    assert.ok(reviewRequest);
    assert.equal(
      JSON.stringify(reviewRequest.body).includes("ssh punctuation"),
      false,
      "SSH password must be excluded from review"
    );
    assert.equal(
      requests.filter(
        item => item.path === "/api/admin/remote/jobs" && item.method === "POST"
      ).length,
      0,
      "review creation must not auto-submit a job"
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Install and reboot" })
        .isDisabled(),
      true,
      "final action must require both confirmations"
    );
    fs.mkdirSync(output, { recursive: true });
    for (const width of [1920, 1397, 1024, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const boxes = await page
        .locator('[aria-label="Final installation review"]')
        .evaluate(root => {
          const box = selector => {
            const r = root.querySelector(selector).getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          return {
            heading: box(".remote-vng-section-heading"),
            facts: box(".remote-review-facts"),
            confirm: box(".remote-vng-confirmations"),
            warning: box(".remote-vng-destructive-line"),
            button: box(".remote-vng-launch"),
            overflow: document.documentElement.scrollWidth > innerWidth + 2,
          };
        });
      assert.ok(boxes.heading.bottom <= boxes.facts.y + 2);
      assert.ok(boxes.facts.bottom <= boxes.confirm.y + 2);
      assert.ok(boxes.confirm.bottom <= boxes.warning.y + 2);
      assert.ok(boxes.warning.bottom <= boxes.button.y + 2);
      assert.ok(
        boxes.button.height >= 35 && boxes.button.height <= 65,
        JSON.stringify(boxes.button)
      );
      assert.equal(boxes.overflow, false, `review overflow at ${width}`);
      geometry.push({
        width,
        buttonHeight: boxes.button.height,
        stacked: true,
      });
      if (width === 1397)
        await page
          .locator('[aria-label="Final installation review"]')
          .screenshot({ path: `${output}/final-review-1397.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel(/backup or this is a disposable target/).check();
    await page.getByLabel(/whole selected disk/).check();
    await page.getByRole("button", { name: "Install and reboot" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Fixture launch rejected" })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/installer");
    assert.equal(
      await page
        .getByRole("status")
        .filter({ hasText: "Installation started." })
        .count(),
      0
    );
    await page.getByRole("button", { name: "Install and reboot" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "did not return a job ID" })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/installer");
    await page.getByRole("button", { name: "Install and reboot" }).click();
    await page.waitForURL("**/deployments?job=job-fixture");
    await page
      .getByRole("status")
      .filter({ hasText: "Installation started." })
      .waitFor();
    assert.equal(
      requests.filter(
        item => item.path === "/api/admin/remote/jobs" && item.method === "POST"
      ).length,
      3,
      "each launch request requires an explicit click; no automatic retry"
    );
    const jobsRequest = requests.find(
      item => item.path === "/api/admin/remote/jobs" && item.method === "POST"
    );
    assert.equal("password" in jobsRequest.body, false);
    assert.equal(jobsRequest.body.backupConfirmed, true);
    assert.equal(jobsRequest.body.recoveryConfirmed, true);
    assert.equal(jobsRequest.body.eraseConfirmed, true);
    const submitted = page.locator('[aria-label="Remote job detail"]');
    await submitted.locator(".remote-state-queued").waitFor();
    assert.match(await submitted.innerText(), /Windows is not confirmed ready/);
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /ssh punctuation|windows-secret-fixture/
    );
    assert.equal(
      await page.locator('[aria-label="Final installation review"]').count(),
      0
    );
    assert.equal(
      await page.getByRole("button", { name: "Install and reboot" }).count(),
      0
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Open remote job", exact: true })
        .getAttribute("href"),
      "/remote-jobs?job=job-fixture"
    );
    const keys = requests
      .filter(x => x.path === "/api/admin/remote/jobs" && x.method === "POST")
      .map(x => x.body.idempotencyKey);
    assert.equal(
      new Set(keys).size,
      1,
      "same frozen review reuses the same idempotency key"
    );
    await page
      .getByRole("link", { name: "Open remote job", exact: true })
      .click();
    await page.waitForURL("**/remote-jobs?job=job-fixture");
    await submitted.locator(".remote-state-queued").waitFor();
    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: "Cancel before it starts" }).click();
    assert.equal(
      requests.filter(
        item => item.path.endsWith("/cancel") && item.method === "POST"
      )[0].body,
      undefined,
      "cancel must use an empty body"
    );
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: `${output}/remote-install.png`,
      fullPage: true,
    });
    fs.writeFileSync(
      `${output}/RESULT.json`,
      JSON.stringify(
        {
          passed: true,
          geometry,
          acceptedRedirect: true,
          refusedConnectionFeedback: true,
          requestTimeoutFeedback: true,
          errorsStayOnReview: true,
          missingIdNoSuccess: true,
          idempotencyPreserved: true,
          noRealApiRequests: true,
        },
        null,
        2
      )
    );
    console.log(
      "PASS review geometry, error/missing-ID handling, Installation started/history redirect and job progress"
    );
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
