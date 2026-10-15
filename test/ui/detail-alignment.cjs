const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.TEST_BASE || "http://127.0.0.1:3122";
const out = process.env.UI_OUTPUT || "/tmp/win11desk-detail-alignment";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addInitScript(() => {
    window.__copies = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async v => window.__copies.push(v) },
      configurable: true,
    });
  });
  const page = await ctx.newPage(),
    errors = [],
    checks = [];
  page.on("pageerror", e => errors.push(e.message));
  const id = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  const profile = {
    id: "00000000-0000-4000-8000-000000000011",
    name: "Windows 11 Pro",
    osId: "windows-11-pro",
    osName: "Windows 11 Pro",
    group: "Windows 11",
    revision: 2,
    username: "Administrator",
    remotePort: 22,
    retries: 10,
    tested: true,
  };
  const now = Date.now();
  let run = {
    id,
    label: "COMPANY-1",
    hostname: "COMPANY-1",
    username: "Administrator",
    publicIP: "192.0.2.5",
    rdpPort: 22,
    status: "completed",
    stage: "windows_ready",
    phase: "payload",
    downloadedBytes: 0,
    totalBytes: null,
    createdAt: new Date(now - 1000000).toISOString(),
    startedAt: new Date(now - 999000).toISOString(),
    finishedAt: new Date(now - 60000).toISOString(),
    lastHeartbeatAt: new Date(now - 60000).toISOString(),
    windowsEdition: "Professional",
    windowsBuild: 26300,
    windowsInstallationType: "Client",
    rdpListening: true,
    credentialAvailable: true,
    notes: "Original notes",
    tags: ["one"],
    profile,
    os: "Windows 11 Pro",
  };
  let revealDelay = 0;
  let longPassword = false,
    submitted = null,
    patches = 0;
  await page.route("**/api/**", async route => {
    const u = new URL(route.request().url());
    let body = {};
    if (u.pathname === "/api/auth/me")
      body = {
        user: {
          id: "fixture",
          name: "Synthetic Owner",
          email: "fixture@example.test",
          role: "owner",
        },
        csrf: "fixture",
      };
    else if (u.pathname === "/api/admin/profiles/ready")
      body = { items: [profile], defaultProfileId: profile.id };
    else if (u.pathname.endsWith("/reveal")) {
      if (revealDelay) await new Promise(r => setTimeout(r, revealDelay));
      body = {
        username: run.username,
        password: longPassword ? "x".repeat(128) : "Win123!x",
      };
    } else if (u.pathname.startsWith("/api/admin/deployments/")) {
      if (route.request().method() === "PATCH") {
        submitted = route.request().postDataJSON();
        patches++;
        await new Promise(r => setTimeout(r, 150));
        Object.assign(run, submitted);
      }
      const selected = u.pathname.endsWith(other)
        ? {
            ...run,
            id: other,
            label: "COMPANY-2",
            notes: "Second record notes",
            tags: ["two"],
            credentialAvailable: false,
          }
        : run;
      body = {
        deployment: selected,
        events: [
          {
            eventId: "fixture-event",
            stage: run.stage,
            receivedAt: run.finishedAt,
            payload: { message: "Safe synthetic completion evidence" },
          },
        ],
        trackingUrl: null,
      };
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base + "/installer");
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Operating system"]')?.value ===
      "00000000-0000-4000-8000-000000000011"
  );
  assert.equal(
    await page
      .getByLabel("Operating system", { exact: true })
      .locator("option:checked")
      .innerText(),
    "Windows 11 Pro"
  );
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    const m = await page.evaluate(() => {
      const s = document
          .querySelector(".os-profile-toolbar select")
          .getBoundingClientRect(),
        b = document
          .querySelector(".os-profile-toolbar button")
          .getBoundingClientRect(),
        field = document
          .querySelector(".os-profile-field")
          .getBoundingClientRect(),
        fieldset = document
          .querySelector(".installer-fields")
          .getBoundingClientRect(),
        label = document
          .querySelector(".os-profile-toolbar label span")
          .getBoundingClientRect();
      return {
        doc: document.documentElement.scrollWidth,
        view: innerWidth,
        gap: b.left - s.right,
        bottomDelta: Math.abs(b.bottom - s.bottom),
        labelGap: s.top - label.bottom,
        fieldWidth: field.width,
        formWidth:
          fieldset.width -
          parseFloat(
            getComputedStyle(document.querySelector(".installer-fields"))
              .paddingLeft
          ) -
          parseFloat(
            getComputedStyle(document.querySelector(".installer-fields"))
              .paddingRight
          ) -
          parseFloat(
            getComputedStyle(document.querySelector(".installer-fields"))
              .borderLeftWidth
          ) -
          parseFloat(
            getComputedStyle(document.querySelector(".installer-fields"))
              .borderRightWidth
          ),
      };
    });
    assert.ok(m.doc <= width + 1, JSON.stringify(m));
    assert.ok(m.gap >= 7 && m.gap <= 13, JSON.stringify(m));
    assert.ok(m.bottomDelta <= 1);
    assert.ok(m.labelGap >= 5);
    assert.ok(Math.abs(m.fieldWidth - m.formWidth) <= 1, JSON.stringify(m));
    checks.push({ area: "selector", width, ...m });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(base + "/deployments/" + id);
  await page.locator(".deployment-facts").waitFor();
  assert.equal(
    await page.locator(".vng-presentation__progress").count(),
    0,
    "no misleading terminal empty payload box"
  );
  assert.equal(
    await page.locator(".vng-presentation__profile").innerText(),
    "Windows 11 Pro · issued revision 2"
  );
  const duration = await page.locator(".deployment-timer strong").innerText();
  await page.waitForTimeout(1100);
  assert.equal(
    await page.locator(".deployment-timer strong").innerText(),
    duration
  );
  await page
    .getByLabel("Internal notes")
    .fill("Operator draft survives refresh");
  await page.waitForTimeout(5200);
  assert.equal(
    await page.getByLabel("Internal notes").inputValue(),
    "Operator draft survives refresh"
  );
  await page.getByLabel("Tags", { exact: true }).fill("one, handoff");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.getByText("Deployment notes saved.", { exact: true }).waitFor();
  assert.equal(patches, 1);
  assert.equal(submitted.notes, "Operator draft survives refresh");
  assert.deepEqual(submitted.tags, ["one", "handoff"]);
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    const m = await page.evaluate(() => {
      const p = document.querySelector(".deployment-presentation"),
        box = p.getBoundingClientRect(),
        heading = p.parentElement
          .querySelector(".panel-heading")
          .getBoundingClientRect(),
        padding = parseFloat(getComputedStyle(p).paddingLeft),
        notes = document
          .querySelector(".deployment-notes")
          .getBoundingClientRect(),
        nh = document
          .querySelector(".deployment-notes")
          .parentElement.querySelector(".panel-heading"),
        noteLabel = document
          .querySelector(".deployment-notes label")
          .getBoundingClientRect();
      const pairs = [...p.querySelectorAll(".connection-value")].map(v => {
        const c = v.querySelector("code").getBoundingClientRect(),
          b = v.querySelector("button").getBoundingClientRect();
        return {
          gap: b.left - c.right,
          center: Math.abs(b.top + b.height / 2 - (c.top + c.height / 2)),
        };
      });
      return {
        doc: document.documentElement.scrollWidth,
        view: innerWidth,
        padding,
        statusInset:
          p.querySelector(".vng-presentation__head").getBoundingClientRect()
            .left - box.left,
        headingInset: parseFloat(
          getComputedStyle(p.parentElement.querySelector(".panel-heading"))
            .paddingLeft
        ),
        notesInset: noteLabel.left - nh.getBoundingClientRect().left,
        notesHeadingInset: parseFloat(getComputedStyle(nh).paddingLeft),
        pairs,
      };
    });
    assert.ok(m.doc <= width + 1, JSON.stringify(m));
    assert.ok(m.padding >= 16);
    assert.ok(
      m.statusInset >= m.headingInset && m.statusInset <= m.headingInset + 18,
      JSON.stringify(m)
    );
    assert.ok(
      Math.abs(m.notesInset - m.notesHeadingInset) <= 1,
      JSON.stringify(m)
    );
    assert.ok(
      m.pairs.every(p => p.gap >= 7 && p.gap <= 9 && p.center <= 1),
      JSON.stringify(m)
    );
    checks.push({ area: "detail", width, ...m });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: out + "/completed-desktop.png",
    fullPage: true,
  });
  await page.locator(".connection-line button").click();
  assert.equal(
    await page.evaluate(() => window.__copies.at(-1)),
    "192.0.2.5:22"
  );
  await page
    .locator(".credential-password")
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  await page.waitForFunction(() => window.__copies.at(-1) === "Win123!x");
  assert.equal(
    await page.locator(".credential-password code").innerText(),
    "********"
  );
  longPassword = true;
  await page.setViewportSize({ width: 320, height: 1080 });
  await page
    .locator(".credential-password")
    .getByRole("button", { name: "Reveal", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".credential-password code")?.textContent ===
      "x".repeat(128)
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({ path: out + "/detail-mobile.png", fullPage: true });
  await page
    .locator(".credential-password")
    .getByRole("button", { name: "Hide", exact: true })
    .click();
  revealDelay = 400;
  await page
    .locator(".credential-password")
    .getByRole("button", { name: "Reveal", exact: true })
    .click();
  // Client-side route identity change must not reuse old record drafts or secrets.
  await page.evaluate(next => {
    history.pushState(null, "", next);
    dispatchEvent(new PopStateEvent("popstate"));
  }, "/deployments/" + other);
  await page
    .getByRole("heading", { name: "COMPANY-2", exact: true, level: 1 })
    .waitFor();
  assert.equal(
    await page.getByLabel("Internal notes").inputValue(),
    "Second record notes"
  );
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator(".credential-password code").innerText(),
    "********"
  );
  run = {
    ...run,
    status: "installing",
    stage: "downloading",
    finishedAt: null,
    phase: "iso_integrity",
    downloadedBytes: 512,
    totalBytes: 1024,
  };
  await page.goto(base + "/deployments/" + id);
  await page.locator(".progress-track").waitFor();
  assert.match(
    await page.locator(".vng-presentation__progress-head").innerText(),
    /50.0%/
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/RESULT.json",
    JSON.stringify(
      {
        passed: true,
        labelDeduplicated: true,
        fullWidthSelector: true,
        detailInsets: true,
        adjacentCopies: true,
        terminalEvidence: true,
        longPasswordContained: true,
        notesSaveAndDraft: true,
        recordIdentityReset: true,
        activeProgress: true,
        checks,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "PASS detail/selector alignment, terminal evidence, safe Copy/Reveal, notes and mobile containment"
  );
  await browser.close();
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
