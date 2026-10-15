# Win11Desk — navigation cleanup and Operations

## What changed in Stage 1

Presets, Default settings and Activity are no longer standalone dashboard sections. Their old bookmarks redirect to Deployment profiles or Operations. Existing MySQL presets/defaults and internal security audit records are retained; obsolete preset/default editing APIs return HTTP 410 and do not change those records. Account security and Users & invites remain available under existing permissions. The approved Overview/homepage and compact deployment history layout are preserved.

The New installer page no longer loads a saved preset or global installer defaults. Profile selection still applies the selected profile's runtime defaults. **The ready-OS-only form and compact versioned launcher are the next stage**; this cleanup does not claim to deliver them or change any existing issued script.

## Operations

| View | What it tells you | What it does not prove |
| --- | --- | --- |
| Health | Current API/database queries, expected/applied migrations, local pinned source hashes, synthetic vault self-check, configured profile counts and permitted run/command counts | A configured ISO link is not a verified download or a certified new-OS install. HTTPS configuration is not a target firewall or remote certificate check. |
| Attention | Up to 50 active failed/stale or unrecognized-evidence records, last reported stage, safe error code, profile identity, dates and inspection links | Callback silence is not installation failure or success. An unrecognized stage remains unknown, not a guessed stale status. This view never reruns installation or manually marks Windows ready. |
| Notifications | Your own installation completion/failure notices, unread count, read/kind filters, Mark read and bounded Mark all read | Notices do not replace Windows evidence or the deployment event timeline. The removed general audit feed is not recreated here. |
| Recovery | Backup/restore evidence, download procedures, deliberate credential-free diagnostics export and collapsed legacy import for owner/admin | No shell, online restore, key reset, SQL dump or remote VPS operation is exposed in the dashboard. |

Operations refreshes only while the page is mounted and visible, with bounded HTTP requests and isolated error states. Installation notifications and diagnostics/recovery actions remain role-restricted. The backend applies the same permissions and data ownership boundaries independently of visible controls.

## Backup and restore status

The app reads only `/app/operations-status/backup.json`, supplied through a read-only Compose mount. The existing encrypted backup procedure writes the manifest after rechecking the encrypted archive's checksum. A failed attempt replaces the old success indicator with a failed outcome; its timestamp is the latest attempt, not a successful restore. The status file contains only outcome, timestamp, encrypted byte size, checksum-verification flag and optional independently verified restore-test timestamp. No SQL, passwords, source URLs, archive paths or keys belong in this directory.

A missing, unreadable, malformed or out-of-bounds manifest displays **Not reported**. A verified archive checksum does **not** establish that restoration has been tested. Restore verification remains **Not tested / not reported** unless an actual isolated restore test has separately recorded its evidence. Do not fabricate timestamps or treat a host-local archive as an off-host backup.

The procedures remain:

```bash
bash deploy/backup.sh
```

Restore and vault-key rotation are offline maintenance procedures from `DEPLOY.md` and `deploy/KEY-ROTATION.md`, not actions performed by Operations.

## Diagnostics and local legacy import

Owner/admin users can load a bounded preview, then deliberately download a JSON diagnostics snapshot of versions, health states, aggregate counts and safe failure codes. It excludes raw logs, Windows/admin passwords, keys, tokens/capabilities, `.env`, database DSNs, ISO URLs, user lists and arbitrary user-supplied deployment labels. It is a local download, not a public post.

Advanced legacy import verifies a private read capability against existing local tracker records, retains IDs and skips duplicate records. It cannot recover or invent an old Windows password. Existing step-up verification remains; the private input clears on cancellation, completion, hiding the browser page or leaving Recovery. It never contacts a caller-specified host or reinstalls a target.

## Release boundaries

No installer target was accessed, erased or rebooted for this stage. Existing issued artifacts, credentials, account hashes, run IDs, settings and presets must be preserved in the dashboard rollout. New-OS real-target certification remains limited to the evidence described in `DEPLOYMENT-PROFILES-GUIDE.md`.

## Verified Stage1 live release

The dedicated HTTPS dashboard app was rebuilt/recreated with29 reviewed source/config files; its database/proxy stayed running. Existing accounts, issued encrypted artifacts/credentials, run IDs, profiles, settings/presets, internal audit and.env were preserved.151 automated tests, isolated HTTP/UI checks and install/check/test/build from the actual clean release ZIP passed. No target OS install was performed.

## Storage and protected maintenance update

Operations → Health now includes visible-panel storage refreshes for the shared server filesystem, MySQL table allocation and a logical encrypted-command payload subset. They have different overlapping scopes and must not be summed.

Operations → Maintenance is owner-only. Clear finished history skips running/unresolved installation work; Clear All Data blocks unresolved launches and removes only installation/history data. Both retain accounts, admin login sessions, profiles/settings, audit, configuration/assets and backups. Preview, exact typed confirmation and existing password/MFA verification are required; the server rechecks locked rows transactionally and never retries a destructive request automatically.

See [Storage and protected history cleanup](OPERATIONS-MAINTENANCE-GUIDE.md) for the full retained-data list, confirmation phrases, concurrency protections and disk-reclamation limitations.
