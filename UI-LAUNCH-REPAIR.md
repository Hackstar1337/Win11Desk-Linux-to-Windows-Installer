# Win11Desk — review layout and installation-start navigation

## UI corrections

- **Final installation review:** review heading, target/disk/profile details, backup/erasure confirmations, warning and the **Install and reboot** button now flow vertically. Details use responsive columns; the button has a normal height instead of stretching beside the entire review. Target fingerprint/disk/settings and both required acknowledgements are retained.
- **Login:** the oversized abstract introduction is replaced with **“Install Windows. Track every deployment.”** and **“Choose a profile, install Windows on your VPS, and follow its progress from one dashboard.”** Typography and spacing are compacted without removing email/password/authenticator, setup or recovery controls.
- **Deployment history:** restored padding and spacing around **Select all visible deployments**, aligned row checkboxes and the nested deployment-profile filter. The eight-column ledger and its horizontal scrolling remain usable on narrow screens.

## Install and reboot behavior

1. Clicking the button still requires a valid frozen review and both acknowledgements. It submits the existing approval digest and idempotency key; no approval or SSH trust protections have been removed.
2. Only after the server returns an accepted job with its durable ID, the page clears transient passwords and opens **Deployment history**.
3. A success notice says **“Installation started”**, explicitly explaining that the request was accepted. The existing remote-job progress panel is visible immediately, even before the VPS has reported a deployment row. History continues its normal reporting/polling.
4. Rejected requests or a response without a usable job ID remain on the review with an error. They do not announce success or redirect. There is no automatic destructive retry.

**“Installation started” means the approved launch request was accepted, not that Windows is already installed or RDP-ready.** The job shows queued/checking/handoff states; Windows readiness still requires the existing target reports. This update does not start a new target installation as part of testing or deployment.

## Release verification and preservation

`TEST-REPORT.md` records the completed synthetic browser checks and clean-build/unit evidence. Browser launch requests are intercepted fixtures, not real SSH installations. The testing-site update is frontend-only, backed up first, and preserves account/session data, profiles/settings, encrypted credentials, backend/worker behavior and proxy configuration. No live cleanup is performed.

## Additional Clear All verification correction

The shared verification dialog used the generic page-panel class, whose **relative positioning overrode its fixed dialog position**. This could place it below the viewport after scrolling the underlying page. It is now explicitly viewport-fixed and centered, width/height-bounded, with internal scrolling on short displays. The accessible portal, required password/MFA, focus trapping and confirmation controls remain intact.

Clear All category counts now adapt to the **available panel width**, rather than assuming three columns fit. Long labels wrap, totals remain visible, and cleanup success/blocker summaries stack correctly. The regression fixture includes all 18 categories with large counts, seven screen widths and 21 dialog width/height combinations after scrolling the page. No real cleanup is used to check these UI states.

## Expanded interactive-state review corrections

- **Users:** the current account is identified from the authenticated user, not nonexistent fields in the users response. Its disable/revoke controls remain disabled. Pending verification and committing changes lock other protected actions so a later action cannot overwrite the current one. Invitation headings wrap safely.
- **Commands:** a new retrieval clears the previous private preview, including on failure. Expanded copy now reports clipboard success/denial; revocation has pending feedback/locking, and old errors clear when a new action succeeds. Filter heights and long profile text are contained.
- **Account:** confirmed MFA changes to Enabled, removes pending-code controls, and presents recovery codes in the existing copyable/dismissable region. Six-digit input and in-flight guards prevent invalid/duplicate confirmation calls. Session revoke requests are tracked per session; action feedback no longer pairs stale success with a new error.
- **Deployment details:** long titles wrap, label-editor controls have proper spacing, notes-save completion is bound to the viewed deployment, and intentionally cancelled credential requests do not show false errors.
- **Operations:** expanded attention details use the actual rendered CSS classes and responsive grid/header rules. Recovery feedback clears between attempts, and evidence failures are announced accessibly.
- **Verification cancellation:** closing the dialog or leaving its page invalidates an in-flight verification result. A delayed success cannot run an action that was cancelled before dispatch. This is a frontend lifecycle guard, not an automatic retry or a change to server authorization.

These are focused frontend corrections. Existing server API shapes, command/approval semantics, credentials, login/session data, profiles/settings and remote-worker behavior are retained.
