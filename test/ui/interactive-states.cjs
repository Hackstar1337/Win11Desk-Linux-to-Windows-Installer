const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3152";
const output = process.env.UI_OUTPUT || "/tmp/win11desk-interactive-states";
const now = new Date().toISOString();
const profileId = "11111111-1111-4111-8111-111111111111";
const owner = {
  id: "fixture-owner",
  name: "Fixture Owner",
  email: "owner@example.test",
  role: "owner",
  mfaEnabled: false,
};
const longEmail = "a".repeat(60) + "@" + "b".repeat(60) + ".test";
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1397, height: 900 },
  });
  const errors = [],
    calls = [];
  let commandRevoked = false,
    delayStepUp = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async value => {
          if (window.fixtureClipboardDenied)
            throw new Error("Fixture clipboard denied");
          window.fixtureClipboard = value;
        },
      },
    });
  });
  await page.route("**/api/**", async route => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    calls.push({ path, method: req.method() });
    let status = 200,
      body = {};
    if (path === "/api/auth/me") body = { user: owner, csrf: "fixture" };
    else if (path === "/api/auth/users")
      body = {
        users: [
          { ...owner, active: true, created_at: now },
          {
            id: "fixture-other",
            email: "other@example.test",
            name: "Other",
            role: "operator",
            active: true,
            created_at: now,
          },
        ],
      };
    else if (path === "/api/auth/step-up") {
      if (delayStepUp) await new Promise(r => setTimeout(r, 650));
      body = { verified: true };
    } else if (path === "/api/auth/users/invite") {
      await new Promise(r => setTimeout(r, 650));
      body = { token: "synthetic-invitation-token" };
    } else if (path === "/api/auth/account/sessions")
      body = {
        sessions: [
          { id: "current", current: true, last_seen_at: now },
          {
            id: "other",
            current: false,
            user_agent: "Other fixture browser",
            last_seen_at: now,
          },
        ],
      };
    else if (path === "/api/auth/account/mfa/enroll")
      body = { secret: "SYNTHETIC-TOTP-SECRET", uri: "otpauth://totp/fixture" };
    else if (path === "/api/auth/account/mfa/confirm") {
      assert.deepEqual(req.postDataJSON(), { code: "123456" });
      await new Promise(r => setTimeout(r, 650));
      body = {
        enabled: true,
        recoveryCodes: ["SYNTHETIC-ONE", "SYNTHETIC-TWO"],
      };
    } else if (path === "/api/admin/commands")
      body = {
        items: ["A", "B"].map(id => ({
          id,
          label: "Fixture " + id,
          profile: { name: "P".repeat(160), revision: 1 },
          createdAt: now,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          revokedAt: id === "A" && commandRevoked ? now : null,
        })),
        total: 2,
      };
    else if (path === "/api/admin/commands/A/retrieve")
      body = { command: "echo SYNTHETIC-A" };
    else if (path === "/api/admin/commands/B/retrieve") {
      status = 410;
      body = { message: "Fixture retrieval expired." };
    } else if (path === "/api/admin/commands/A/revoke") {
      await new Promise(r => setTimeout(r, 650));
      commandRevoked = true;
      body = { revoked: true };
    } else if (path === "/api/admin/profiles") body = { items: [] };
    else if (path === "/api/admin/profiles/" + profileId)
      body = {
        profile: {
          id: profileId,
          name: "P".repeat(160),
          osId: "windows-11-pro",
          osName: "Windows 11 Pro",
          revision: 1,
          isoUrl: "https://example.test/windows.iso",
          imageName: "Windows 11 Pro",
          username: "Administrator",
          remotePort: 22,
          retries: 10,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        },
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  async function navigate(path) {
    if (page.url().startsWith(base))
      await page.evaluate(path => {
        history.pushState(null, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    else await page.goto(base + path, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();
  }
  async function verify() {
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Current password", { exact: true })
      .fill("Synthetic verification only 123!");
    await dialog
      .getByRole("button", { name: "Verify and continue", exact: true })
      .click();
  }
  await navigate("/users");
  const current = page.locator("tbody tr").filter({ hasText: owner.email });
  await current.waitFor();
  assert.ok(
    await current
      .getByRole("button", { name: "Disable " + owner.email, exact: true })
      .isDisabled()
  );
  assert.ok(
    await current
      .getByRole("button", { name: "Revoke", exact: true })
      .isDisabled()
  );
  await page.getByLabel("Email address", { exact: true }).fill(longEmail);
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await verify();
  await page.waitForFunction(
    () => document.querySelector(".users-primary-action")?.disabled
  );
  assert.ok(
    await page
      .getByLabel("Role for other@example.test", { exact: true })
      .isDisabled()
  );
  const inviteRequestDeadline = Date.now() + 5000;
  while (
    !calls.some(x => x.path === "/api/auth/users/invite") &&
    Date.now() < inviteRequestDeadline
  )
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(
    calls.filter(x => x.path === "/api/auth/users/invite").length,
    1
  );
  await page
    .locator(".users-issued-invite strong")
    .filter({ hasText: longEmail })
    .waitFor();
  for (const width of [1397, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const clipped = await page
      .locator(".users-issued-invite strong")
      .evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(clipped, false, "invitation email clipping at " + width);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2
      )
    );
  }
  await page.setViewportSize({ width: 1397, height: 900 });
  delayStepUp = true;
  await page
    .getByLabel("Email address", { exact: true })
    .fill("cancelled@example.test");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await verify();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForTimeout(800);
  assert.equal(
    calls.filter(x => x.path === "/api/auth/users/invite").length,
    1,
    "cancelled delayed verification must not run its protected action"
  );
  delayStepUp = false;
  await navigate("/account");
  await page
    .getByRole("button", { name: "Start MFA enrollment", exact: true })
    .click();
  await verify();
  const confirm = page.getByRole("button", {
    name: "Confirm MFA",
    exact: true,
  });
  await confirm.waitFor();
  assert.ok(await confirm.isDisabled());
  await page.getByLabel("Authenticator code", { exact: true }).fill("123");
  assert.ok(await confirm.isDisabled());
  assert.equal(
    calls.filter(x => x.path === "/api/auth/account/mfa/confirm").length,
    0
  );
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await confirm.click();
  assert.ok(
    await page
      .getByRole("button", { name: "Confirming…", exact: true })
      .isDisabled()
  );
  await page
    .getByText("MFA enabled. Save the one-time recovery codes shown below.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirm MFA", exact: true })
      .count(),
    0
  );
  assert.equal(
    await page.getByLabel("Authenticator code", { exact: true }).count(),
    0
  );
  await page
    .locator(".account-status-line")
    .getByText("Enabled", { exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "New recovery codes", exact: true })
    .getByText("SYNTHETIC-ONE SYNTHETIC-TWO", { exact: true })
    .waitFor();
  assert.equal(
    calls.filter(x => x.path === "/api/auth/account/mfa/confirm").length,
    1
  );
  await navigate("/commands");
  const rowA = page.locator("tbody tr").filter({ hasText: "Fixture A" }),
    rowB = page.locator("tbody tr").filter({ hasText: "Fixture B" });
  await rowA.waitFor();
  await rowA.getByRole("button", { name: "Review", exact: true }).click();
  const preview = page.locator(".commands-retrieval-card");
  await preview.getByText("echo SYNTHETIC-A", { exact: true }).waitFor();
  await preview
    .getByRole("button", { name: "Copy command", exact: true })
    .click();
  await page
    .locator(".notice.success")
    .getByText("Command copied to the clipboard.", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.fixtureClipboard),
    "echo SYNTHETIC-A"
  );
  await page.evaluate(() => (window.fixtureClipboardDenied = true));
  await preview
    .getByRole("button", { name: "Copy command", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Fixture clipboard denied" })
    .waitFor();
  assert.equal(await page.locator(".notice.success").count(), 0);
  await rowB.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Fixture retrieval expired." })
    .waitFor();
  assert.equal(
    await preview.count(),
    0,
    "old command preview must disappear when next retrieval fails"
  );
  page.once("dialog", dialog => dialog.accept());
  await rowA.getByRole("button", { name: "Revoke", exact: true }).click();
  assert.ok(
    await rowA
      .getByRole("button", { name: "Revoking…", exact: true })
      .isDisabled()
  );
  await page
    .locator(".notice.success")
    .getByText("Command revoked.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    "stale retrieval error must clear after successful action"
  );
  assert.equal(
    calls.filter(x => x.path === "/api/admin/commands/A/revoke").length,
    1
  );
  for (const width of [1397, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const height = await page
      .locator(".commands-search-field")
      .evaluate(el => el.getBoundingClientRect().height);
    assert.ok(height <= 40, "search height " + height);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2
      )
    );
    await navigate("/profiles/" + profileId);
    await page
      .getByRole("heading", { level: 1, name: "P".repeat(160), exact: true })
      .waitFor();
    const title = await page.getByRole("heading", { level: 1 }).boundingBox();
    assert.ok(
      title.x + title.width <= width + 1,
      "long title overflow at " + width
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2
      )
    );
    await navigate("/commands");
    await rowA.waitFor();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    output + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        currentUserProtected: true,
        cancelledVerificationDoesNotMutate: true,
        inviteMutationLocked: true,
        mfaValidatedAndEnabled: true,
        commandCopyFeedback: true,
        failedRetrievalClearsPreview: true,
        revokeLocked: true,
        longTextContained: true,
        noRealApiRequests: true,
      },
      null,
      2
    ) + "\n"
  );
  await browser.close();
  console.log(
    "PASS expanded account/users/commands states and long-data containment"
  );
})().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
