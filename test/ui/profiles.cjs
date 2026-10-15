const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3114",
  out = process.env.UI_OUTPUT || "/tmp/win11desk-profiles-ui";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  const now = new Date().toISOString();
  const id = "33333333-3333-4333-8333-333333333333";
  const profile = {
    id,
    name: "EU Windows Server",
    osId: "windows-server-2022-standard-evaluation",
    isoUrl: "https://example.test/server.iso",
    imageName: "Windows Server 2022 Standard Evaluation (Desktop Experience)",
    description: "Synthetic profile",
    username: "Administrator",
    remotePort: 22,
    retries: 10,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    commandCount: 2,
    deploymentCount: 1,
  };
  let items = [profile];
  let issue = null,
    created = null;
  const run = {
    id: "44444444-4444-4444-8444-444444444444",
    label: "Company1",
    profile,
    os: "Windows Server 2022 Standard Evaluation (Desktop Experience)",
    stage: "windows_ready",
    status: "completed",
    publicIP: "192.0.2.5",
    username: "Administrator",
    rdpPort: 22,
    createdAt: now,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    finishedAt: now,
    credentialAvailable: true,
  };
  await p.route("**/api/**", async r => {
    const u = new URL(r.request().url());
    let body = {};
    if (u.pathname === "/api/auth/me")
      body = {
        user: {
          id: "fixture",
          name: "Synthetic Owner",
          email: "fixture@example.test",
          role: "owner",
        },
        csrf: "synthetic",
      };
    else if (
      u.pathname === "/api/admin/profiles" &&
      r.request().method() === "POST"
    ) {
      created = r.request().postDataJSON();
      body = {
        profile: {
          ...profile,
          ...created,
          id: "55555555-5555-4555-8555-555555555555",
        },
      };
      items.push(body.profile);
      return r.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } else if (u.pathname === "/api/admin/profiles/ready")
      body = {
        items: items
          .filter(x => x.isoUrl && !x.archivedAt)
          .map(x => ({
            id: x.id,
            name: x.name,
            osId: x.osId,
            osName:
              "Windows Server 2022 Standard Evaluation (Desktop Experience)",
            group: "Windows Server",
            revision: x.revision,
            username: x.username,
            remotePort: x.remotePort,
            retries: x.retries,
            tested: false,
          })),
        defaultProfileId: null,
      };
    else if (u.pathname === "/api/admin/profiles") body = { items };
    else if (u.pathname.startsWith("/api/admin/profiles/")) body = { profile };
    else if (u.pathname === "/api/admin/settings")
      body = {
        items: [
          {
            key: "installer.defaults",
            value: {
              username: "OtherDefault",
              isoUrl: "https://example.test/other.iso",
            },
          },
        ],
      };
    else if (u.pathname === "/api/admin/presets") body = { items: [] };
    else if (
      u.pathname === "/api/admin/commands" &&
      r.request().method() === "POST"
    ) {
      issue = r.request().postDataJSON();
      body = {
        items: [
          {
            id: "fixture-command",
            profile,
            command: "# synthetic nonexecuting command",
            createdAt: now,
            expiresAt: now,
          },
        ],
      };
    } else if (u.pathname === "/api/admin/deployments")
      body = { items: [run], total: 1 };
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await p.goto(base + "/profiles");
  await p
    .getByRole("heading", { name: "Deployment profiles", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "New profile", exact: true }).click();
  await p.getByLabel("Profile name").fill("New Server");
  await p
    .locator(".profiles-form select")
    .selectOption("windows-server-2025-datacenter");
  assert.equal(await p.getByLabel("Direct ISO URL").inputValue(), "");
  await p.getByRole("button", { name: "Create profile", exact: true }).click();
  await p.getByText("Profile created.", { exact: true }).waitFor();
  assert.equal(created.osId, "windows-server-2025-datacenter");
  assert.equal(created.isoUrl, "");
  assert.ok(!("password" in created));
  await p.screenshot({ path: out + "/catalog.png", fullPage: true });
  await p.goto(base + "/installer?p=" + id);
  await p.getByLabel("Operating system", { exact: true }).waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Operating system"]')?.value ===
      "33333333-3333-4333-8333-333333333333"
  );
  assert.equal(await p.locator("input[type=url]").count(), 0);
  assert.ok(!(await p.locator("body").innerText()).includes(profile.isoUrl));
  assert.equal(
    await p.getByLabel("Windows username", { exact: true }).inputValue(),
    "Administrator"
  );
  await p.locator("input[autocomplete=new-password]").fill("Win123!x");
  await p
    .getByRole("button", { name: "Generate 1 command", exact: true })
    .click();
  await p.getByText("Command generated", { exact: true }).waitFor();
  assert.equal(issue.profileId, id);
  assert.equal(issue.profileRevision, 1);
  assert.equal(issue.username, "Administrator");
  assert.ok(
    !("isoUrl" in issue) && !("input" in issue) && !("target" in issue)
  );
  await p.screenshot({ path: out + "/installer.png", fullPage: true });
  await p.goto(base + "/deployments?p=" + id);
  await p.locator(".deployment-table-row").waitFor();
  assert.equal(
    await p.getByLabel("Filter by deployment profile").inputValue(),
    id
  );
  assert.equal(await p.locator(".row-profile").textContent(), profile.name);
  for (const width of [1920, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    const geometry = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: innerWidth,
      height: document
        .querySelector(".deployment-table-row")
        .getBoundingClientRect().height,
    }));
    assert.ok(geometry.doc <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.height <= 100, JSON.stringify(geometry));
  }
  await p.screenshot({ path: out + "/history-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        profileCreation: true,
        serverSelection: true,
        sourceAuthoritative: true,
        profileIssuance: true,
        compactHistory: true,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "PASS synthetic profile create/select/issue/history and desktop/mobile checks"
  );
  await b.close();
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
