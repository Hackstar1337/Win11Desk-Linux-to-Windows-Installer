const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const privateCommand = execFileSync(
  "pnpm",
  [
    "exec",
    "tsx",
    "-e",
    `import {buildCleanSetupCommand} from './server/control/launcherV3'; process.stdout.write(buildCleanSetupCommand('https://fixture.example.com', 'a'.repeat(64), 'b'.repeat(64)));`,
  ],
  { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" }
);

const base = process.env.TEST_BASE || "http://127.0.0.1:3114";
const out = process.env.UI_OUTPUT || "/tmp/win11desk-ready-os-ui";
fs.mkdirSync(out, { recursive: true });

const ids = {
  eleven: "11111111-1111-4111-8111-111111111111",
  ten: "22222222-2222-4222-8222-222222222222",
  server: "33333333-3333-4333-8333-333333333333",
};
const ready = [
  {
    id: ids.eleven,
    name: "Windows 11 production",
    osId: "windows-11-pro",
    osName: "Windows 11 Pro",
    group: "Windows 11",
    revision: 4,
    username: "Administrator",
    remotePort: 3389,
    retries: 8,
    tested: true,
  },
  {
    id: ids.ten,
    name: "Windows 10 legacy",
    osId: "windows-10-pro",
    osName: "Windows 10 Pro",
    group: "Windows 10",
    revision: 2,
    username: "DeployAdmin",
    remotePort: 3390,
    retries: 5,
    tested: false,
  },
  {
    id: ids.server,
    name: "Server staging",
    osId: "windows-server-2022-standard-evaluation",
    osName: "Windows Server 2022 Standard Evaluation (Desktop Experience)",
    group: "Windows Server",
    revision: 7,
    username: "Administrator",
    remotePort: 3391,
    retries: 10,
    tested: false,
  },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  let mode = "ready";
  let revision = 4;
  page.on("pageerror", error => errors.push(error.message));

  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    let body;
    if (url.pathname === "/api/auth/me") {
      body = {
        user: {
          id: "fixture",
          name: "Synthetic Owner",
          email: "fixture@example.test",
          role: "owner",
        },
        csrf: "synthetic",
      };
    } else if (url.pathname === "/api/admin/profiles/ready") {
      if (mode === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Ready list unavailable" }),
        });
        return;
      }
      const items =
        mode === "zero"
          ? []
          : mode === "no-default"
            ? ready
            : ready.map(item => ({
                ...item,
                revision: item.id === ids.eleven ? revision : item.revision,
              }));
      body = {
        items,
        defaultProfileId: mode === "no-default" ? null : ids.eleven,
      };
    } else if (
      url.pathname === "/api/admin/commands" &&
      request.method() === "POST"
    ) {
      const posted = request.postDataJSON();
      requests.push(posted);
      body = {
        items: [
          {
            id: "fixture-command",
            command: privateCommand,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      };
    } else {
      body = {};
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  const gotoInstaller = async query => {
    await page.goto(`${base}/installer${query || ""}`);
    await page.getByLabel("Operating system", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".os-profile-field")
          ?.getAttribute("aria-busy") === "false"
    );
  };

  await gotoInstaller();
  await page.waitForFunction(
    () =>
      !document.querySelector('select[aria-label="Operating system"]').disabled
  );
  const osSelect = page.getByLabel("Operating system", { exact: true });
  assert.equal(
    await osSelect.inputValue(),
    ids.eleven,
    "configured default profile is selected"
  );
  assert.deepEqual(await osSelect.locator("optgroup").allTextContents(), [
    "Windows 11 production",
    "Windows 10 legacy",
    "Server staging",
  ]);
  assert.equal(await page.locator('input[type="url"]').count(), 0);
  assert.equal(await page.getByText(/https?:\/\//).count(), 0);
  assert.equal(
    await page.getByText("Custom configuration", { exact: false }).count(),
    0
  );
  assert.equal(
    await page.getByText("Restore default", { exact: false }).count(),
    0
  );

  const password = page.locator('input[autocomplete="new-password"]');
  await password.fill("Installer!234");
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByLabel("Batch count", { exact: true }).fill("2");
  await page
    .getByLabel("Generate a unique password for each batch item", {
      exact: true,
    })
    .check();
  assert.equal(await password.isDisabled(), true);
  assert.equal(
    await page
      .locator('input[autocomplete="new-password"]')
      .getAttribute("required"),
    null
  );
  await page
    .getByRole("button", { name: "Generate 2 commands", exact: true })
    .click();
  await page.getByText("Command generated", { exact: true }).waitFor();
  const pasted = await page.locator(".generated code").textContent();
  assert.equal(pasted, privateCommand);
  assert.ok(pasted.includes("/setup/v3.sh"));
  assert.ok(!pasted.includes("Installer!234"));
  assert.ok(!pasted.includes(ids.eleven));
  assert.ok(!pasted.includes("fixture-command"));
  assert.ok(!pasted.includes("isoUrl"));
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]).sort(), [
    "count",
    "idempotencyKey",
    "label",
    "profileId",
    "profileRevision",
    "remotePort",
    "retries",
    "tags",
    "uniquePasswords",
    "username",
  ]);
  assert.equal(requests[0].profileId, ids.eleven);
  assert.equal(requests[0].profileRevision, 4);
  assert.equal(requests[0].uniquePasswords, true);
  assert.equal("password" in requests[0], false);
  assert.equal("input" in requests[0], false);
  assert.equal("isoUrl" in requests[0], false);
  assert.equal("target" in requests[0], false);

  revision = 5;
  await page
    .getByRole("button", {
      name: "Refresh available operating systems",
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document.body.textContent.toLowerCase().includes("revision 5")
  );
  assert.equal(
    await osSelect.inputValue(),
    ids.eleven,
    "refresh keeps the selected profile"
  );

  await gotoInstaller(`?p=${ids.server}`);
  assert.equal(
    await osSelect.inputValue(),
    ids.server,
    "valid deep link wins over default"
  );
  await gotoInstaller(`?p=99999999-9999-4999-8999-999999999999`);
  await page
    .getByRole("alert")
    .filter({ hasText: "requested operating system is unavailable" })
    .waitFor();
  assert.equal(await osSelect.isDisabled(), false);
  assert.equal(
    await page
      .getByRole("button", { name: /^Generate [0-9]+ commands?$/ })
      .isDisabled(),
    true
  );
  await osSelect.selectOption(ids.ten);
  assert.equal(
    await osSelect.inputValue(),
    ids.ten,
    "manual recovery selects an available profile"
  );
  assert.equal(
    new URL(page.url()).searchParams.get("p"),
    ids.ten,
    "manual selection replaces deep-link query"
  );
  assert.equal(
    await page
      .getByRole("button", { name: /^Generate [0-9]+ commands?$/ })
      .isDisabled(),
    false
  );

  for (const nextMode of ["error", "no-default", "zero"]) {
    mode = nextMode;
    await gotoInstaller();
    await page
      .getByText(
        nextMode === "error"
          ? /Ready list unavailable/
          : nextMode === "no-default"
            ? /Choose an operating system/
            : /No operating systems are ready/,
        { exact: false }
      )
      .first()
      .waitFor();
    assert.equal(
      await page.getByLabel("Operating system", { exact: true }).isDisabled(),
      nextMode !== "no-default"
    );
    assert.equal(
      await page
        .getByRole("button", { name: /^Generate [0-9]+ commands?$/ })
        .isDisabled(),
      true
    );
    if (nextMode === "no-default") {
      await page
        .getByLabel("Operating system", { exact: true })
        .selectOption(ids.server);
      assert.equal(
        await page
          .getByRole("button", { name: /^Generate [0-9]+ commands?$/ })
          .isDisabled(),
        false
      );
    }
  }

  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        groups: true,
        defaultSelection: true,
        deepLinkBlocked: true,
        errorBlocked: true,
        flatPayload: true,
        uniqueBatch: true,
        refreshRevision: true,
        privateV2SetupDisplay: true,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "PASS ready OS grouped selector, guards, refresh, and flat installer payload"
  );
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
