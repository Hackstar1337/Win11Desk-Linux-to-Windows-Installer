const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3125",
  out = process.env.UI_OUTPUT || "/tmp/win11desk-customization-ui";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    }),
    ctx = await browser.newContext({ viewport: { width: 1667, height: 1080 } }),
    page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const id = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  let role = "owner",
    patches = [],
    run = {
      id,
      label: "COMPANY-1",
      originalLabel: "COMPANY-1",
      hostname: "COMPANY-1",
      username: "Administrator",
      rdpPort: 22,
      publicIP: "192.0.2.5",
      status: "stale",
      stale: true,
      stage: "downloading",
      phase: "payload",
      downloadedBytes: 512,
      totalBytes: 1024,
      createdAt: "2026-10-13T12:00:00Z",
      startedAt: "2026-10-13T12:01:00Z",
      lastHeartbeatAt: "2026-10-13T12:02:00Z",
      credentialAvailable: true,
      notes: "original",
      tags: [],
      profile: {
        id: "00000000-0000-4000-8000-000000000011",
        name: "Europe Production",
        osId: "windows-11-pro",
        revision: 2,
      },
      os: "Windows 11 Pro",
    };
  const profile = {
    ...run.profile,
    osName: "Windows 11 Pro",
    group: "Windows 11",
    username: "Administrator",
    remotePort: 22,
    retries: 10,
    tested: true,
  };
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    let body = {};
    if (p === "/api/auth/me")
      body = {
        user: {
          id: "fixture",
          name: "Synthetic Owner",
          email: "fixture@example.test",
          role,
        },
        csrf: "fixture",
      };
    else if (p.startsWith("/api/installer/tracking/"))
      body = {
        runs: [
          {
            ...run,
            runId: id,
            wholeDisk: "/dev/vda",
            updatedAt: run.lastHeartbeatAt,
          },
        ],
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
    else if (p === "/api/admin/profiles/ready")
      body = { items: [profile], defaultProfileId: profile.id };
    else if (p === "/api/admin/profiles") body = { items: [profile] };
    else if (p === "/api/admin/deployments") body = { items: [run], total: 1 };
    else if (p.startsWith("/api/admin/deployments/")) {
      if (route.request().method() === "PATCH") {
        const data = route.request().postDataJSON();
        patches.push(data);
        if ("label" in data) run.label = data.label || run.originalLabel;
      }
      body = {
        deployment: p.endsWith(other)
          ? {
              ...run,
              id: other,
              label: "COMPANY-2",
              originalLabel: "COMPANY-2",
            }
          : run,
        events: [],
        trackingUrl: null,
      };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base + "/installer");
  await page.getByLabel("Theme colour").waitFor();
  await page.waitForFunction(
    id =>
      document.querySelector('select[aria-label="Operating system"]')?.value ===
      id,
    profile.id
  );
  assert.equal(
    await page
      .getByLabel("Operating system", { exact: true })
      .locator("option:checked")
      .innerText(),
    "Europe Production"
  );
  assert.ok(
    !(await page.locator(".os-profile-field .form-hint").innerText()).includes(
      "Windows 11 Pro"
    )
  );
  const expected = {
    cyan: "rgb(94, 216, 233)",
    blue: "rgb(137, 181, 255)",
    violet: "rgb(188, 163, 255)",
    emerald: "rgb(105, 215, 177)",
    amber: "rgb(237, 195, 117)",
    rose: "rgb(241, 166, 192)",
  };
  const changes = [];
  for (const [value, color] of Object.entries(expected)) {
    await page.getByLabel("Theme colour").selectOption(value);
    await page.waitForFunction(
      v => document.documentElement.dataset.accent === v,
      value
    );
    const computed = await page
      .locator(".theme-colour-swatch")
      .evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(computed, color);
    changes.push({ id: value, color: computed });
  }
  await page.reload();
  await page.getByLabel("Theme colour").waitFor();
  assert.equal(await page.getByLabel("Theme colour").inputValue(), "rose");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("win11desk.accent")),
    "rose"
  );
  await page.goto(base + "/deployments");
  await page.locator(".deployment-table-row").waitFor();
  assert.match(
    await page.locator(".deployment-table-row .state-badge").innerText(),
    /Awaiting update/
  );
  assert.equal(
    await page.locator('option[value="stale"]').innerText(),
    "Awaiting update"
  );
  assert.ok(
    !(await page.locator(".control-main").innerText()).match(/\bstale\b/i)
  );
  await page.goto(base + "/deployments/" + id);
  await page.getByLabel("Label name").waitFor();
  assert.equal(
    await page.locator(".deployment-status-row .state-stale").count(),
    1
  );
  assert.equal(
    await page
      .locator(".deployment-status-row .state-stale")
      .evaluate(el => getComputedStyle(el).color),
    "rgb(236, 203, 139)"
  );
  assert.equal(await page.getByLabel("Label name").inputValue(), "COMPANY-1");
  await page.getByLabel("Label name").fill("Europe RDP");
  await page.getByRole("button", { name: "Save label", exact: true }).click();
  await page.getByText("Deployment label saved.", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Europe RDP", exact: true, level: 1 })
    .waitFor();
  assert.deepEqual(patches[0], { label: "Europe RDP" });
  assert.equal(
    await page
      .getByRole("heading", { name: "Europe RDP", exact: true, level: 1 })
      .innerText(),
    "Europe RDP"
  );
  await page.getByLabel("Label name").fill("Unsaved change");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Label name").inputValue(), "Europe RDP");
  await page
    .getByRole("button", { name: "Restore original label", exact: true })
    .click();
  await page
    .getByText("Original deployment label restored.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Label name").inputValue(), "COMPANY-1");
  await page.getByLabel("Label name").fill("Draft survives polling");
  await page.waitForTimeout(5300);
  assert.equal(
    await page.getByLabel("Label name").inputValue(),
    "Draft survives polling"
  );
  const sizes = [];
  for (const width of [1920, 1667, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    const bounds = await page.locator(".deployment-label-form").evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    sizes.push({ width, ...bounds });
  }
  await page.screenshot({ path: out + "/detail-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1667, height: 1080 });
  await page.goto(base + "/deployments/" + other);
  await page
    .getByRole("heading", { name: "COMPANY-2", exact: true, level: 1 })
    .waitFor();
  assert.equal(await page.getByLabel("Label name").inputValue(), "COMPANY-2");
  await page.screenshot({ path: out + "/detail-desktop.png", fullPage: true });
  role = "viewer";
  await page.reload();
  await page.getByLabel("Label name").waitFor();
  assert.ok(await page.getByLabel("Label name").isDisabled());
  assert.ok(
    await page
      .getByRole("button", { name: "Save label", exact: true })
      .isDisabled()
  );
  await page.evaluate(() =>
    localStorage.setItem("win11desk.accent", "invalid")
  );
  await page.reload();
  await page.getByLabel("Theme colour").waitFor();
  assert.equal(await page.getByLabel("Theme colour").inputValue(), "cyan");
  await page.goto(base + "/track/" + id + "#" + "a".repeat(64));
  await page.locator(".run-card .tiny-badge").waitFor();
  assert.equal(
    await page.locator(".run-card .tiny-badge").textContent(),
    "Awaiting update"
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        profileNamesOnly: true,
        awaitingUpdate: true,
        labelSaveCancelReset: true,
        roleAwareEditor: true,
        draftAndRouteIdentity: true,
        persistedThemes: changes,
        invalidStoredFallback: true,
        sizes,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "PASS profile-only names, Awaiting update, label save/cancel/reset/roles and six persisted themes; mobile contained"
  );
  await browser.close();
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
