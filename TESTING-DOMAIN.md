# Testing dashboard — verified HTTPS deployment

Use **https://testing.d3m0nbox.online** for the dashboard on **45.63.51.163**. The owner confirmed that `installer.d3m0nbox.online` belongs to the old server; that server and its DNS were not changed.

## Completed hostname change

- Changed only `APP_DOMAIN` and `APP_PUBLIC_URL` in the protected host configuration, after saving a root-only rollback copy.
- Recreated only app/proxy. The database container remains healthy and was not restarted or recreated.
- All other environment variables—including encryption, database and authentication secrets—are unchanged.
- Existing account password hashes and encrypted command artifacts/Windows credentials match the protected encrypted SQL backup. All three existing deployment runs remain present.
- Google's public DNS returned A45.63.51.163 and no AAAA answer for the new hostname. No DNS write was needed.

## HTTPS and application checks

Trusted TLS certificate verification passed for `testing.d3m0nbox.online`; issuer **Let's Encrypt / YE2**, current certificate expiry **11 January 2027, 23:25:50 UTC**. Caddy's automatic certificate management uses the existing persistent certificate storage.

The new public hostname serves the updated `index-BNB95V-g.js` UI. HTTPS health passes, and anonymous deployment-history access returns401. Synthetic optional-action UI checks passed against these actual public assets: independent Get files/Run attached script controls, selected-only payloads, Server compatibility guard, stale-command invalidation and responsive geometry. No real account was used by those UI tests.

## Login and commands

Log in on the new hostname with the **existing administrator account**. Browser sessions are hostname-specific, so signing in again is normal; no account reset or new owner setup is required.

**Generate fresh commands on this hostname.** New delivery/tracking URLs use the configured testing origin. Previously issued encrypted artifacts still contain their original callback URLs; they were not rewritten. Downloading a previous command does not retrofit the new optional actions.

The browser/tool files are delivered to the desktop folder only when Get files is enabled. The attached batch is staged and run once only when its separate switch is enabled on a compatible Windows client profile. The actual licensing script and a fresh Windows installation have **not** been executed during this dashboard/domain update; third-party downloads or execution cannot be guaranteed issue-free.

## Verification receipt

The initial domain-change verifier expected an `ok` health field, whereas the endpoint exposes a successful status differently. That assertion failure did not indicate certificate or application failure. A read-only recovery verifier confirmed the already-applied configuration, trusted HTTPS, unchanged non-origin environment, account/credential hashes against the encrypted backup and the database's original start time. The domain change was not repeated.

Server management used SSH only, with a retained keepalive connection for subsequent verification. No GitHub/Vercel publication or old-host authentication was performed.

Dense-history public UI regression also passed:12 compact rows,8 columns, full1667/1920px workspace, responsive local scrolling, aligned copy actions, measured/frozen timers and existing credential safeguards.
