# Win11Desk — SSH reliability and clearer wording

## Confirmed corrections

- **Late SSH errors no longer escape the connection handler.** A real local SSH/TCP regression reproduced a second protocol error after a timed-out or closed connection. The guarded error listener now remains attached, and early socket closure rejects the pending connection promptly.
- **Connection failures keep their real reason.** Refused connections, network routing failures, connection resets and a port that does not complete the SSH handshake receive distinct safe messages. Discovery no longer replaces every failure with a generic fingerprint error. Discovery failures are recorded in the existing security audit without passwords or raw remote output.
- **Installer failures are not called SSH failures.** Explicit target-check rejections before bootstrap runs are stopped. An installer process error, an existing target installation marker, or an unknown failed receipt remains under review. Existing database state values are retained; no database migration or automatic retry is introduced. Older stored receipts also receive accurate display labels.
- **Remote installation requests are bounded.** Connection/review requests explain a timeout; job listing, detail, cancellation and read-only receipt checks also have timeouts. A timed-out install request directs the operator to inspect its job before repeating an action.
- **Remote job selection follows its URL.** Selecting a job updates the deep link, and query/back-forward changes select the corresponding detail.

## Clearer pages

Overview uses **Installation overview** and **Track your Windows installations**. Deployment history uses **Your deployments** with a plain deployment count. Profiles, commands, users, account security, Operations, login/setup and private tracking use direct descriptions instead of fleet, ledger, control-plane and signal metaphors. SSH job records are called jobs—not successful deployments. Reported installation updates are not described as SSH connection checks.

The final SSH review, compact layouts, Clear All confirmation, role protections, encrypted credential handling and accepted-job redirect to Deployment history remain part of this release. **Installer sent / queued / connection successful is not Windows ready.**

## Retained protections

SSH remains password-only with a pinned, explicitly verified host fingerprint. No SSH key or agent is supplied or installed. Target/disk/settings reviews, server-side idempotency, one-dispatch behavior, cancellation guards and uncertain-launch handling remain in place. No target disk, DNS, proxy configuration, account, profile or setting is changed by these code corrections.

## Verification boundary

Real local SSH fixtures verify fingerprint discovery without authentication, exact password punctuation, no keys/agent, changed-key rejection, wrong-password handling, command/channel behavior, refused ports, closed login and silent/non-SSH ports. Worker and reconciliation tests verify that failures do not automatically issue or resend an installer.

The live app and worker were inspected read-only: both were running, their backend image hashes matched, and their actual vault keys and public origins matched. The retained installation/job history had already been cleared, so the user's latest VPS-specific failure could not be traced to a saved job. A current failing-step screenshot/job ID is still needed to identify that particular connection problem. **No new live VPS login, disk erasure, Windows reinstall, RDP authentication or desktop-file test has been performed for this revision.**

The final completed test and rollout results are recorded in `TEST-REPORT.md` when available. Reload the browser once after the update to load the new UI assets.


## Final verification and rollout

- TypeScript, production build and **56 test files / 372 unit tests** passed.
- **All 11 UI suites** passed locally; four affected UI sweeps passed again on the exact live JavaScript/CSS/font assets, with synthetic API interception and no live mutations.
- Loopback-only maintenance (11), control (27), remote API (18) and account-security (8) acceptance checks passed in the disposable schema. Real password-only, pinned-key SSH fixtures cover authentication, refusals, resets, handshake timeouts and guarded late error events.
- The ZIP independently installed and built with runtime credentials removed. Final module hashes match the clean-built and deployed source; there is no database migration.
- **testing.d3m0nbox.online** is updated; the app and worker share the tested backend code and the new worker heartbeat is healthy. Existing accounts/login sessions, profiles/settings/presets, command/delivery data and history/audit identities were preserved. `.env`, proxy/DNS configuration and database/proxy containers were not changed.
- No new target Windows installation or RDP/desktop-file test was performed. The old failed job records had already been cleared; send a current job ID/error screenshot to identify the specific VPS failure. Do not put passwords in that screenshot or message.
