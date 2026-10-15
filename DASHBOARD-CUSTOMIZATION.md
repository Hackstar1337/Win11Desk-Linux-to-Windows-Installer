# Dashboard customization

## Awaiting update

Missing VPS telemetry is now displayed as **Awaiting update**, replacing “Stale.” The existing three-minute heartbeat/progress threshold is unchanged. The amber badge means the latest installation state is not confirmed; it does not assert failure or offline status. The last-known stage and last-contact time remain available. Fresh reports clear the warning automatically. Internal API/filter status remains `stale` so old integrations continue to work.

## Rename a deployment

Open **Deployment history → Details → Deployment label**. Edit **Label name** and choose **Save label**. **Cancel** discards unsaved edits; **Restore original label** removes the display override and returns to the label originally issued with the command. Blank label saves also remove the override. Labels support up to160 characters; control characters are rejected.

The edited name appears in the detail heading/status summary, history Created/label column, label search, CSV export and Operations attention. The original created date, run identity, detected hostname, deployment profile and its issued revision stay unchanged. Edits apply only to that run: sibling VPS runs, original commands, generated installer bytes, usernames and encrypted passwords are never rewritten. Renaming does not require reinstalling Windows or generating another command.

Owners, admins and operators can edit labels under the existing deployment-write permission and CSRF controls. Viewers have a disabled read-only label editor. Changes are audited. The separate additive label table is included in normal SQL backups; purge removes its metadata as part of existing deletion behavior. Existing notes/tags continue working independently.

## Deployment profile names

The New installer OS selector displays **only the saved deployment profile name**, not a combined OS/profile string. For example, a profile named “Europe Production” appears as “Europe Production,” even when its OS is Windows11Pro. OS-family grouping and configured-only availability remain; profile IDs and exact revision checks still control command generation. The helper shows revision/readiness, not a duplicated OS title. Detail attribution likewise uses the saved profile name and issued revision. Profile media links remain in the profile editor, not New installer.

## Theme colour

Use **Theme colour** near the bottom of the sidebar. Choose **Cyan(default), Blue, Violet, Emerald, Amber or Rose**. On a phone, open the navigation menu first. Accent buttons, links, active navigation, progress accents, focus and selection update immediately. Dark surfaces remain unchanged; completed/failed/Awaiting update statuses retain green/red/amber meanings rather than adopting the selected theme.

The colour is saved **in this browser**, survives page refresh and dashboard navigation, and does not change another administrator's preference or the server configuration. Another browser starts with Cyan. Invalid saved values safely fall back to Cyan; blocked browser storage still allows colour changes for the current page. A separate Settings section is not added back.

## Validation

The connected feature is being checked with compiler/build/unit tests, isolated database/API fixtures and synthetic browser workflows. Browser tests cover all six persisted palettes, invalid-storage fallback, profile-only naming, label save/cancel/reset and route/draft identity, disabled viewer controls, exact Awaiting update wording and amber colour, dense history/detail geometry and320–1920px containment. No target VPS or Windows install is required for these UI/metadata changes. Final rollout evidence follows after deployment.

## Release verification

The final source passes TypeScript, production build and178 tests/32 files, plus isolated API checks for labels, roles, credentials, profile snapshots and Operations. The actual standalone ZIP was extracted into a clean directory and its dependency install/typecheck/tests/build all passed.

The27-file application update is deployed at [installer.d3m0nbox.online](https://installer.d3m0nbox.online). Verification found that the existing one-off rollout utility had omitted the separate migration command. The already-backed-up additive migration was then explicitly applied; the supported `deploy/start.sh` already runs migrations before app startup, and the rollout utility is corrected to do the same before future switches. No existing table was replaced or database restored. Health and anonymous-history protection passed after recovery.

Before/after preservation checks retain1 administrator account,3 issued commands and3 deployment runs, their password/artifact/credential hashes, all profile/settings/preset records, audit IDs and the production environment file. Database/proxy containers were not restarted. A root-only encrypted SQL/config backup and source rollback copies are retained on the dashboard host. No Windows target VPS was changed.

Final deployed-asset browser checks pass for profile-only selection, exact Awaiting update wording in history/details/Operations/public tracker, per-run label save/cancel/reset and viewer restrictions, six persisted palettes and mobile containment. These tests intercept API responses with synthetic data; they do not modify real deployments or accounts. The original compact history regression also passes on live assets. Public HTTPS health is OK; anonymous ready-profile/history APIs remain401, and the public v1 launcher SHA-256 is unchanged.
