const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3110";
const out = process.env.UI_OUTPUT || "/tmp/win11desk-ui-verification";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1574, height: 1050 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const alignmentChecks = [];
  async function checkRowAlignment(state, width) {
    await page.setViewportSize({ width, height: 1050 });
    const measured = await page.evaluate(() => {
      const row = document.querySelector(".deployment-table-row");
      const box = selector =>
        row.querySelector(selector).getBoundingClientRect();
      const center = selector => {
        const r = box(selector);
        return r.top + r.height / 2;
      };
      const copyGaps = [".row-address", ".row-username", ".row-password"].map(
        selector => {
          const code = box(selector + " code"),
            button = box(selector + " button");
          return button.left - code.right;
        }
      );
      const primaryCenters = [
        ".row-label",
        ".row-address code",
        ".row-username code",
        ".row-password code",
        ".state-badge",
        ".deployment-timer strong",
        ".row-actions .text-button",
      ].map(center);
      const header = document.querySelector(
        ".deployment-history-table th:nth-child(7)"
      );
      return {
        copyGaps,
        centerSpread: Math.max(...primaryCenters) - Math.min(...primaryCenters),
        secondaryDelta: Math.abs(
          box(".row-created time").top - box(".row-stage").top
        ),
        timerHeaderDelta: Math.abs(
          box(".deployment-timer strong").left -
            header.getBoundingClientRect().left -
            parseFloat(getComputedStyle(header).paddingLeft)
        ),
        actionsDisplay: getComputedStyle(row.querySelector(".row-actions"))
          .display,
        rowHeight: row.getBoundingClientRect().height,
      };
    });
    assert.ok(
      measured.copyGaps.every(gap => gap >= 6 && gap <= 10),
      JSON.stringify(measured)
    );
    assert.ok(measured.centerSpread <= 2, JSON.stringify(measured));
    assert.ok(measured.secondaryDelta <= 1, JSON.stringify(measured));
    assert.ok(measured.timerHeaderDelta <= 1, JSON.stringify(measured));
    assert.equal(measured.actionsDisplay, "table-cell");
    assert.ok(measured.rowHeight <= 92);
    alignmentChecks.push({ state, width, ...measured });
  }
  const now = Date.now();
  const run = {
    id: "11111111-1111-4111-8111-111111111111",
    label: "UI fixture",
    username: "Administrator",
    publicIP: "64.177.9.58",
    hostname: "synthetic-vps",
    rdpPort: 22,
    stage: "downloading",
    status: "installing",
    phase: "payload",
    downloadedBytes: 512 * 1024 * 1024,
    totalBytes: 1024 * 1024 * 1024,
    createdAt: new Date(now - 120000).toISOString(),
    startedAt: new Date(now - 90000).toISOString(),
    finishedAt: null,
    lastHeartbeatAt: new Date(now).toISOString(),
    credentialAvailable: true,
  };
  let revealCount = 0;
  await ctx.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async value => window.__copied.push(value) },
      configurable: true,
    });
  });
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    let body = {};
    if (p === "/api/auth/me")
      body = {
        user: {
          id: "synthetic",
          name: "UI Fixture Owner",
          email: "fixture@example.test",
          role: "owner",
        },
        csrf: "synthetic-csrf",
      };
    else if (p === "/api/admin/deployments")
      body = {
        items: Array.from({ length: 12 }, (_, i) => ({
          ...run,
          id:
            i === 0
              ? run.id
              : `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
          label: i === 0 ? run.label : `Fleet VPS ${i + 1}`,
          publicIP: i === 0 ? run.publicIP : `192.0.2.${i + 1}`,
        })),
        total: 12,
        page: 1,
        pageSize: Number(
          new URL(route.request().url()).searchParams.get("pageSize") || 25
        ),
      };
    else if (p.endsWith("/reveal")) {
      revealCount++;
      body = { username: "Administrator", password: "Win123!x" };
    } else if (p.startsWith("/api/admin/deployments/"))
      body = { deployment: run, events: [], trackingUrl: null };
    else if (p === "/api/admin/profiles/ready")
      body = {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            name: "Default",
            osId: "windows-11-pro",
            osName: "Windows 11 Pro",
            group: "Windows 11",
            revision: 1,
            username: "Administrator",
            remotePort: 22,
            retries: 10,
            tested: true,
          },
        ],
        defaultProfileId: "00000000-0000-4000-8000-000000000011",
      };
    else if (p === "/api/admin/settings")
      body = {
        settings: {
          username: "Administrator",
          remotePort: 22,
          retries: 10,
          isoUrl: "https://example.test/windows.iso",
        },
        revision: 1,
      };
    else if (p === "/api/admin/presets") body = { items: [] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base + "/deployments");
  await page.getByText("64.177.9.58:22", { exact: true }).waitFor();
  assert.match(
    await page.locator(".row-progress").first().innerText(),
    /50\.0%/
  );
  assert.equal(
    await page.locator(".credential-password code").first().innerText(),
    "********"
  );
  const timers = page.locator(".deployment-timer strong").first();
  const before = await timers.innerText();
  await page.waitForTimeout(1100);
  assert.notEqual(await timers.innerText(), before);
  await page.locator(".connection-line button").first().click();
  assert.equal(
    await page.evaluate(() => window.__copied.at(-1)),
    "64.177.9.58:22"
  );
  await page
    .locator(".row-username .credential-line")
    .first()
    .locator("button")
    .click();
  assert.equal(
    await page.evaluate(() => window.__copied.at(-1)),
    "Administrator"
  );
  await page
    .locator(".credential-password")
    .first()
    .locator("button")
    .first()
    .click();
  await page.waitForFunction(() => window.__copied.at(-1) === "Win123!x");
  assert.equal(await page.evaluate(() => window.__copied.at(-1)), "Win123!x");
  assert.equal(
    await page.locator(".credential-password code").first().innerText(),
    "********"
  );
  assert.equal(revealCount, 1);
  await page
    .locator(".credential-password")
    .first()
    .getByRole("button", { name: "Reveal", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".credential-password code")?.textContent ===
      "Win123!x"
  );
  assert.equal(
    await page.locator(".credential-password code").first().innerText(),
    "Win123!x"
  );
  assert.equal(await page.locator("input[type=password]").count(), 0);
  await page
    .locator(".credential-password")
    .first()
    .getByRole("button", { name: "Hide", exact: true })
    .click();
  assert.equal(
    await page.locator(".credential-password code").first().innerText(),
    "********"
  );
  const geom = await page.evaluate(() => {
    const strong = document
        .querySelector(".brand-copy strong")
        .getBoundingClientRect(),
      small = document
        .querySelector(".brand-copy small")
        .getBoundingClientRect();
    return {
      stacked: small.top >= strong.bottom,
      padding: getComputedStyle(document.querySelector(".search-box input"))
        .paddingLeft,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(geom.stacked, true);
  assert.ok(parseFloat(geom.padding) >= 34);
  assert.equal(geom.overflow, false);
  assert.equal(await page.locator(".deployment-table-row").count(), 12);
  const density = await page
    .locator(".deployment-table-row")
    .first()
    .evaluate(row => row.getBoundingClientRect().height);
  assert.ok(density <= 92, `Row too tall: ${density}`);
  assert.equal(await page.locator(".deployment-card").count(), 0);
  assert.equal(
    await page.locator(".deployment-history-table thead th").count(),
    8
  );
  assert.equal(
    await page.getByRole("combobox", { name: "Rows per page" }).inputValue(),
    "25"
  );
  await page
    .getByRole("combobox", { name: "Rows per page" })
    .selectOption("100");
  await page.waitForTimeout(200);
  const widthChecks = [];
  for (const width of [1667, 1920]) {
    await page.setViewportSize({ width, height: 1050 });
    const measured = await page.evaluate(() => {
      const main = document
        .querySelector(".control-main")
        .getBoundingClientRect();
      const panel = document
        .querySelector(".vng-history__table-panel")
        .getBoundingClientRect();
      const wrap = document.querySelector(".deployment-table-wrap");
      return {
        mainWidth: main.width,
        panelWidth: panel.width,
        leftGap: panel.left - main.left,
        rightGap: main.right - panel.right,
        tableScroll: wrap.scrollWidth > wrap.clientWidth + 2,
      };
    });
    assert.ok(
      measured.leftGap <= 47 && measured.rightGap <= 47,
      JSON.stringify(measured)
    );
    assert.ok(measured.panelWidth >= measured.mainWidth - 94);
    assert.equal(measured.tableScroll, false);
    widthChecks.push({ width, ...measured });
    await checkRowAlignment("installing", width);
  }
  await page.screenshot({ path: out + "/history-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  const scrolling = await page
    .locator(".deployment-table-wrap")
    .evaluate(el => ({
      scroll: el.scrollWidth > el.clientWidth,
      head: getComputedStyle(el.querySelector("th")).position,
    }));
  assert.equal(scrolling.scroll, true);
  assert.equal(scrolling.head, "sticky");
  await page.screenshot({ path: out + "/history-mobile.png", fullPage: true });
  run.stage = "windows_ready";
  run.status = "completed";
  run.finishedAt = new Date(now - 30000).toISOString();
  run.windowsEdition = "Professional";
  run.windowsBuild = 26300;
  run.rdpListening = true;
  await page.reload();
  await page.getByText("64.177.9.58:22", { exact: true }).waitFor();
  const frozen = await timers.innerText();
  await page.waitForTimeout(1100);
  assert.equal(await timers.innerText(), frozen);
  assert.match(await timers.getAttribute("title"), /Completed in/);
  assert.equal(await page.locator(".row-progress").count(), 0);
  for (const width of [1667, 1920]) await checkRowAlignment("completed", width);
  await page.screenshot({
    path: out + "/history-completed-desktop.png",
    fullPage: true,
  });
  await page.goto(base + "/deployments/" + run.id);
  await page.locator(".deployment-facts").waitFor();
  assert.ok(await page.locator(".deployment-facts").count());
  await page.goto(base + "/installer");
  await page.locator("input[type=password]").first().waitFor();
  assert.equal(
    await page
      .locator("input[type=password]")
      .first()
      .getAttribute("minlength"),
    "8"
  );
  assert.deepEqual(errors, []);
  console.log(
    "UI PASS:12 dense rows <=92px,8 columns,100-row selector,sticky header/mobile local scrolling, detail page retained, full1667/1920px workspace, brand/icon alignment,50% counters, live/frozen timers, IP/user/password clipboard, copy stays masked, no admin password prompt, Windows min8."
  );
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        geometry: { ...geom, rowHeight: density, widthChecks, alignmentChecks },
        checks: 18,
      },
      null,
      2
    )
  );
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
