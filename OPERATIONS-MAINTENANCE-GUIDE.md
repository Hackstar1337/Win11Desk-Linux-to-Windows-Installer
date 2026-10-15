# Win11Desk — storage, unconditional reset and login sessions

## Controls

- **Operations → Health → Storage usage:** refreshed storage measurements.
- **Operations → Maintenance:** owner-only **Clear finished history** and **Clear All Data**.
- **Account security → Active sessions:** **Clear other sessions — keep this browser**.

## Clear All Data — revised behavior

**Clear All is unconditional with respect to installation status.** Running, awaiting-update, uncertain, handed-off and pending post-install records are included. `active_remote_job`, `handed_off_unresolved` and `post_install_unresolved` do **not** block it.

It deletes all installation records present when the transaction executes, including new activity since preview: commands, encrypted Windows credentials/artifacts and delivery capabilities; deployments/events/labels/post-install results; remote jobs/events/reviews/checks/encrypted SSH data; installation-target fingerprint trust; notifications; legacy delivery tickets and tracker groups/runs. Orphan installation children are included.

Clear All also deletes the **invoking owner's other login sessions**, keeping this browser and other accounts' sessions. It retains accounts/password/MFA/recovery data, profiles, settings/presets, existing audit, worker health, server configuration, encryption keys, installer assets and backups. It appends an aggregate audit receipt.

Owner permission, CSRF, the typed phrase **CLEAR ALL INSTALLATION DATA** and recent password/MFA verification establish intentional authorized deletion. Preview counts describe the current complete scope, not a frozen list: changed counts or activity do not block reset. Counts are recalculated from locked rows when clearing. Technical failures still roll back; destructive requests are not automatically retried.

> **Portal cleanup is not target cancellation.** OS installation or optional tasks already launched on a VPS may continue. Portal tracking/callback capabilities disappear; cleared unused commands no longer work. Do not reset if you need the installation's history or credentials. Clear All does not erase VPS disks or connect to a target.

Delayed tracking mirroring and worker issuance are fenced against missing tracker/job rows; missing-job events do not recreate orphan history. An already-authorized external launch cannot be undone by removing its portal record.

## Clear finished history

This separate mode deletes safely finished history, revoked/expired commands and closed remote work. It retains running, uncertain, shared-command, live-command and unresolved optional work, and does not delete login sessions. Its exact preview is revalidated; a changed scope requires a fresh preview. Phrase: **CLEAR FINISHED HISTORY**.

## Active login sessions

Only your own non-revoked, unexpired sessions seen within the login idle window appear as active. Previously revoked, expired or idle records are no longer mislabeled as active.

**Clear other sessions — keep this browser** deletes your other login rows after password/MFA verification. Other browsers must sign in again. This browser, your account/password/MFA, other accounts' sessions and installation history are unaffected. The action is audited and authenticated/CSRF-protected. Clear All uses the same own-account/current-browser preservation.

## Storage scopes

The visible Health panel refreshes approximately every **15 seconds**; backend readings may be cached for **10 seconds**.

- **Shared filesystem:** capacity/used/available for the filesystem visible to the app, often backed by the host. Not an app-only footprint or target VPS disk usage. Reserved blocks can make used plus available differ from total.
- **Database data/index allocation:** MySQL table metadata, not literal physical database volume size, transaction logs or backups.
- **Logical encrypted payload subset:** selected ciphertext sizes already represented in database allocation. Do not add it to disk/database figures.

Unavailable readings do not become fake zeroes. Responses include no raw path, database URL, key, password or ciphertext. Deleting rows may not immediately shrink InnoDB files or free physical disk space. Cleanup does not rebuild tables, prune Docker or delete backups.

## Release boundaries

Target: **https://testing.d3m0nbox.online**. Validation uses a dedicated loopback-only disposable database and intercepted synthetic browser APIs, without a dispatch worker. **No live reset or login-session purge is performed during rollout.** App/worker updates use verified SSH, encrypted SQL/config backup and source rollback copies, with existing data/config preservation checks. Full chronological evidence is in `TEST-REPORT.md` inside the ZIP. No fresh OS, RDP, desktop-file or activation-script test is claimed for this portal revision.
