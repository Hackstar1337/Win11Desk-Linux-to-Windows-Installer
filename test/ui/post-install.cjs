const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

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
            command: "# synthetic command",
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
  };

  await gotoInstaller();
  await page.waitForFunction(
    () =>
      !!document.querySelector('select[aria-label="Operating system"]').value
  );
  const get = page.getByRole("switch", { name: "Get files", exact: true }),
    script = page.getByRole("switch", {
      name: "Run attached script after installation",
      exact: true,
    });
  try {
    assert.equal(await get.isChecked({ timeout: 8000 }), false);
  } catch (e) {
    console.log(
      "SYNTHETIC LIVE BODY",
      await page.evaluate(() => ({
        text: document.body.innerText,
        scripts: [...document.scripts].map(x => x.src),
      }))
    );
    throw e;
  }
  assert.equal(await script.isChecked(), false);
  assert.equal(await page.locator('input[type="url"]').count(), 0);
  await get.check();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Download Edge installer", exact: true })
      .count(),
    0
  );
  await page.getByText(/protected startup task/).waitFor();
  await page
    .getByRole("checkbox", { name: "Download Chrome installer", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Download 7-Zip installer", exact: true })
    .check();
  await script.check();
  await page
    .locator('input[autocomplete="new-password"]')
    .fill("Synthetic!123");
  await page
    .getByRole("button", { name: "Generate 1 command", exact: true })
    .click();
  try {
    await page
      .getByText("Command generated", { exact: true })
      .waitFor({ timeout: 8000 });
  } catch (e) {
    console.log(
      "SYNTHETIC UI DIAGNOSTIC",
      await page.evaluate(() => ({
        text: document.body.innerText,
        invalid: Array.from(document.querySelectorAll("input"))
          .filter(i => !i.checkValidity())
          .map(i => ({
            name: i.name,
            type: i.type,
            error: i.validationMessage,
          })),
      })),
      requests.length
    );
    throw e;
  }
  assert.deepEqual(requests.at(-1).postInstall, {
    getFiles: true,
    apps: ["chrome", "7zip"],
    customFileUrl: "",
    runAttachedScript: true,
  });
  await script.uncheck();
  await page.waitForFunction(
    () => !document.body.textContent.includes("# synthetic command")
  );
  await page
    .getByLabel("Operating system", { exact: true })
    .selectOption(ids.server);
  assert.equal(await script.isDisabled(), true);
  assert.equal(await script.isChecked(), false);
  await page
    .locator('input[autocomplete="new-password"]')
    .fill("Synthetic!123");
  await page
    .getByRole("button", { name: "Generate 1 command", exact: true })
    .click();
  await page.getByText("Command generated", { exact: true }).waitFor();
  assert.equal(requests.at(-1).postInstall.runAttachedScript, false);
  await get.uncheck();
  await page
    .locator('input[autocomplete="new-password"]')
    .fill("Synthetic!123");
  await page
    .getByRole("button", { name: "Generate 1 command", exact: true })
    .click();
  await page.getByText("Command generated", { exact: true }).waitFor();
  assert.equal("postInstall" in requests.at(-1), false);
  await gotoInstaller();
  await page.waitForFunction(
    () =>
      !!document.querySelector('select[aria-label="Operating system"]').value
  );
  await get.check();
  await page
    .getByRole("checkbox", { name: "Download Firefox installer", exact: true })
    .check();
  await script.check();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    if (width === 1440)
      await page.screenshot({
        path: out + "/options-desktop.png",
        fullPage: true,
      });
    if (width === 390)
      await page.screenshot({
        path: out + "/options-mobile.png",
        fullPage: true,
      });
  }
  assert.ok(await get.evaluate(e => e.getBoundingClientRect().width >= 33));
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        defaultOff: true,
        edgeRemoved: true,
        startupWording: true,
        selectedOnly: true,
        serverBlocked: true,
        staleCommandCleared: true,
        mobileContained: true,
      },
      null,
      2
    ) + "\n"
  );
  await browser.close();
  console.log(
    "PASS independent toggles, selected-only payload, server guard, stale output and responsive geometry"
  );
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
