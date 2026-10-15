# Win11Desk — download progress and deployment history update

## What changed

1. **Real ISO transfer progress:** new scripts report transferred bytes roughly every 15 seconds. History and the optional tracker show phase, transferred/total size and a percentage when the source provides a total. The two phases are **Integrity** (full streamed SHA-256 check before partition replacement) and **Payload** (ISO downloaded into the installer source partition). A source without a trustworthy total shows transferred bytes, not an invented percentage. Retries reset the current attempt's progress.
2. **Elapsed installation timer:** each deployment shows `HH:MM:SS`, counting up from its recorded start and freezing at the persisted successful Windows-ready callback. This is elapsed time, not an unreliable finish-time estimate. Failed runs freeze at their stop time; older terminal records without a stored finish time show `Not recorded`.
3. **Aligned deployment cards:** responsive connection sections show `IP ADDRESS: <actual-IP>:<RDP-port>`, username and masked RDP password. Created, Started, Completed, actual stage, heartbeat and Windows evidence remain visible. Filters, dates, details, tracker, RDP helper and Trash/Restore protections remain available.
4. **Copy and Reveal:** authenticated users with credential permission can copy/reveal the Windows password without re-entering the administrator password. Copy keeps the password visually masked; Reveal auto-hides after 30 seconds and invalidates pending requests when the page is hidden or closed. Anonymous/viewer access is still blocked; sensitive deletion and account/security changes still require their existing verification.
5. **Windows password minimum:** 8–128 printable ASCII characters across the form, API and generated Bash. Administrator account login passwords still use their separate 15-character minimum.
6. **UI repairs:** stacked sidebar brand/subtitle, corrected search/filter icon padding and responsive cards. Archive restore returns a record to active history; accepted progress/stage callbacks now count as liveness. Unknown RDP listener evidence stays unknown.

## Use on the live dashboard

Open **Live history** at <https://installer.d3m0nbox.online/deployments> and refresh the page after this update. No administrator or Windows passwords are reset by the dashboard upgrade.

**New transfer telemetry requires a freshly generated installer command.** Existing issued scripts are immutable, and a target that already booted an older installer cannot receive new shell hooks from a webpage refresh. Its existing status callbacks still work. Do not rerun a destructive installation merely to add progress to the same machine.

**100% downloaded is not Windows ready.** Completion still requires the Windows 11 Pro and local RDP-listener callback; it is not proof of provider-firewall reachability, client authentication or a completed ordinary desktop. The Windows screenshot at `Installing 100%` can still be finishing setup/rebooting.

## Validation

- TypeScript, production build and complete unit suite pass.
- Actual BusyBox ash and `pv -n -b` stream fixture proves measured intermediate and final bytes and retained SHA-256 enforcement; no real ISO download or target-disk operation performed.
- Isolated MySQL/HTTP acceptance covers 8-character issuance, seven-character rejection, encrypted vault, authenticated non-step-up reveal, CSRF/viewer rejection, phase-total resets, accepted-callback liveness, real overview counts, terminal date preservation and protected deletion.
- Synthetic desktop/mobile browser fixtures check logo stacking, search padding, no page overflow, measured 50% display, live/frozen timers, individual clipboard controls and masking.
- Live deployment verification is recorded after the application update; production records are not used as test fixtures.

## Live deployment result

The reviewed source was deployed to `45.63.51.163` at `/opt/win11desk`. Trusted HTTPS health returned success; anonymous history and credential requests returned401. The application was rebuilt/recreated without restarting the database or HTTPS proxy. Existing account password hashes, saved command artifacts and encrypted Windows credentials match their before-update checks; existing run IDs remain present. `.env` and keys are unchanged. Production counts stayed at1 account,1 command and1 deployment record. Source rollback copies are retained on the VPS.

Validation totals: **112 unit tests**, **22 core HTTP checks**, **9 security HTTP checks**, desktop/mobile UI fixtures and a clean extracted ZIP install/typecheck/build. No new Windows target installation performed.

## Compact multi-VPS history refinement

The default history is now a compact table: one short row per deployment, not an expanded card. IP:port, username and masked password Copy/Reveal are in separate columns, alongside Created date/label, status and measured transfer progress, elapsed/completed time and Details/RDP actions. Full timestamps, evidence, timeline and optional tracker remain on the existing Details page. Completed rows do not waste space displaying obsolete download telemetry.25/50/100 rows per page and sticky headers support large inventories; narrow screens scroll only the table horizontally. Credential rules and automatic installation are unchanged.

Compact-row live deployment succeeded: frontend-only3-file patch, trusted HTTPS health OK, anonymous history/reveal401. All existing accounts, issued command artifacts/credential ciphertext, run IDs and production.env preserved. Database/proxy unchanged; no OS installation performed.

## Full-width workspace refinement

Authenticated dashboard sections now use the available workspace width instead of the former centered 1180px page cap. Desktop gutters are 24px; mobile gutters remain 16px. History columns spread across wide screens while retaining compact per-VPS rows. Narrow screens still scroll the table locally, and full deployment details stay available. No artificial vertical filler, installer changes, or authentication changes were added.

Synthetic browser verification at 1667px and 1920px measured panel widths of 1367px and 1620px respectively, with 24px side gutters, no horizontal table scroll at those sizes, and unchanged 81px active-row height. TypeScript, production build and all 112 unit tests passed. Live deployment evidence is appended after the CSS-only production update.

Full-width live deployment completed successfully on 2026-10-13. Only `client/src/index.css` was patched and the app rebuilt/recreated. Trusted HTTPS health passed; anonymous history and password-reveal requests returned 401. Existing account hashes, issued command artifact/credential ciphertext hashes, deployment run IDs and `.env` were unchanged (one account, command and run before/after). Database and proxy were not restarted. The synthetic UI regression also passed against the deployed frontend, with no real login or production data used as fixtures. A clean extracted ZIP dependency install, typecheck and production build passed. No installer target was modified.

## Adjacent Copy and row alignment repair

History-only CSS now keeps each Copy control 8px beside its IP, username or password value instead of expanding the value to push Copy to the column edge. Primary row items share a 24px line; Created and Windows Ready/stage text line up on the secondary line. Elapsed values align directly beneath their header. Details/RDP stays in a true table cell rather than inheriting flex-container styling. The approved full-width workspace, compact rows, detail page, credential behavior and mobile scrolling remain unchanged.

Synthetic installing and completed rows at 1667px/1920px pass geometric checks: all three Copy gaps 8px, primary-line center difference 0px, Created/stage secondary-line difference 0px, and timer/header left difference 0px. Completed rows measure 74px. TypeScript, production build and all 112 tests passed. Live evidence follows deployment.

Alignment repair deployed successfully: history CSS only; app rebuilt/recreated, database/proxy unchanged. Trusted HTTPS health passed and anonymous history/reveal returned 401. All existing account hashes, command/credential ciphertext hashes, run IDs and `.env` were preserved (one account/command/run before and after). The deployed-asset synthetic regression passed for installing/completed rows at both wide desktop sizes plus mobile. Active rows remain 81px, completed rows 74px. No homepage, installer target, credentials or OS installation changed.

## Deployment profiles and32 Windows OS choices

Deployment profiles are now live at `/profiles`. Create a named profile, choose a Windows11/Windows10 edition or Server2019/2022/2025 Standard/Datacenter licensed/evaluation Desktop Experience, and save its own direct ISO link. Blank-link profiles remain unconfigured. Use profile applies OS/media server-side, revision checks prevent stale issuance, and exact image names can be overridden for the actual ISO. Commands/history retain an immutable profile snapshot and grouped filtering. Duplicate/archive/restore, real usage counts and Created/Updated dates are included; existing compact rows and Copy/status/timer alignment remain intact.

Additional OSs use real ISO adapters with exact image and edition/build/installation-type gates; they are not end-to-end VPS certified. Historical Windows11Pro remains the only real-target test evidence. Home/Core/Linux arbitrary ISOs are excluded rather than fake support. Read `DEPLOYMENT-PROFILES-GUIDE.md` for the full catalog and media requirements.

Authorized live app/additive migration update passed, with encrypted SQL/config/source backup, healthy trusted HTTPS and anonymous private401 responses. Existing accounts, command/credential ciphertext, run IDs, settings/presets and.env were preserved. Database/proxy and target VPSs untouched.147tests,13profile/22core/9security HTTP scenarios, deployed-asset synthetic UI and clean extracted ZIP install/check/test/build passed. No new Windows installation performed.
