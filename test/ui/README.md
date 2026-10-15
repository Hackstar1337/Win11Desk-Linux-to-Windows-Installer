# Deployment history UI regression

Run only against an isolated local application process. All API requests are intercepted with synthetic fixtures; the test does not log in to production, run OS commands or alter target disks.

Install Playwright into a temporary folder, not the production application's dependency tree:

```bash
npm install --prefix /tmp/win11desk-browser-test playwright@1.55.1
/tmp/win11desk-browser-test/node_modules/.bin/playwright install chromium
TEST_BASE=http://127.0.0.1:3111 NODE_PATH=/tmp/win11desk-browser-test/node_modules node test/ui/history-visual.cjs
```

The test checks desktop/mobile geometry, logo subtitle stacking, search icon padding, measured transfer percentages, elapsed/frozen timers, masked password copy, reveal/hide, individual IP/username copy, no repeat admin-password field and Windows password minimum length. Output goes to `/tmp/win11desk-ui-verification` by default. `UI_OUTPUT` can select another temporary folder.

Browser tools are not installed in the deployment image. Screenshots contain synthetic credentials and are test evidence, not production screenshots.
