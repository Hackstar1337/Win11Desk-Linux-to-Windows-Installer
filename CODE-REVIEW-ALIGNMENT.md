# Win11Desk — code review and alignment repair

## Result

This update fixes the reported duplicated OS name and inconsistent New installer/Deployment Details alignment at their actual source. The review covered shared dashboard styles and page composition, browser request/credential lifecycle, authenticated profile issuance, tracking and immutable installer proof. It is a source review plus focused automated validation—not a guarantee of bug-free code or new operating-system certification.

## Confirmed fixes

| Area | Root cause | Correction |
| --- | --- | --- |
| OS name repeated | Selector always printed profile name plus OS name, including identical values. | Show the canonical OS once when names match (ignoring case/spacing); distinct profiles retain `OS — profile name` and distinct IDs. Stored names are unchanged. |
| OS/Refresh alignment | A plain inline label shared a general-purpose form footer. | Dedicated full-width selector toolbar, explicit label, adjacent Refresh button aligned with the select, consistent label/help spacing. |
| Partial-width installer controls | A `display: contents` fieldset did not change DOM ownership, so direct-child grid spans missed OS/Advanced/footer controls. | Real grid-owning fieldset within a padded form; disabled semantics and mobile one-column behavior retained. |
| Edge-flush details | Panel body padding applied only to selected child classes, omitting the deployment presentation and notes fields. | Consistent 20px desktop/16px mobile detail inset; Notes/tags use a padded semantic form with saving/error states. |
| Copy far from values | Detail values expanded with `flex: 1`. | Separate label and value/actions groups; Copy/Reveal sit 8px beside IP, username and password. Long revealed passwords scroll locally instead of stretching the page. |
| Details status/time/facts | Reused card rules lacked a coordinated full-width detail layout. | Aligned status/elapsed summary plus responsive telemetry/facts and connection columns; facts, notes, run identity and timeline have consistent insets. |
| Empty completed “Payload” block | A completed historical run could show zero bytes/no total as if a transfer still required attention. | Omit a terminal transfer box without useful recorded bytes; retain actual recorded transfer data and honest unknown-total states for active runs. No guessed installation percentage. |
| Route/poll races | Previous detail data could initialize another run's notes, and overlapping polls could overwrite newer responses. | Identity-gated data, draft initialization only for matching run ID, reset on navigation, abort/timeout cleanup and single-flight polling. Drafts survive same-record refresh. |
| Credential lifecycle | Reused detail instances could retain a prior reveal during record navigation. | Key detail presentation by run ID; credential cleanup includes identity/availability changes and aborts pending reveal. Copied indicators expire. No repeat admin-password prompt added. |
| Other frontend cleanup | Profile filter/setup reads and recovery actions could resolve after unmount; delayed recovery navigation had no timer cleanup. | Request abort/mounted guards and recovery navigation cleanup; successful password recovery clears entered secrets. Correct profile-row style scope and suppress duplicate label/profile attribution. |
| Ready-profile validation | Profiles permitted a trailing-dot Windows username and readiness only checked OS/URL. | Align username validation with issuance; validate persisted runtime profile settings before offering them as ready. Invalid stored rows remain editable but cannot be issued. |
| Selected-OS proof isolation | A missing/malformed linkage could fall back to generic legacy Professional proof. | Known profile-issued commands require the exact valid immutable profile snapshot and matching ID/revision. A corrupt/missing modern snapshot fails closed; genuine legacy/unlinked records retain existing behavior. |

## Findings checked and not treated as active defects

The old `pageInstallerDelivery.ts` issuance module remains in historical source, but the current standalone entrypoint does **not** mount `registerInstallerRoutes` or `registerPageInstallerRoutes`. It mounts authenticated profile-only commands and capability delivery directly. This release does not reopen that route or introduce a new activation bypass.

Same-terminal tracking retries already leave the tracking transaction and proceed to the existing `onRunEvent` mirror callback. A `return` inside that transaction callback is not a return from `recordTrackingEvent`. The proposed redundant change was discarded; the working terminal replay control flow remains unchanged.

Contained horizontal scrolling in dense mobile inventory/Operations tables is deliberate and previously approved. It is not document-level overflow. This release retains compact rows rather than replacing them with large cards.

## Verification

**Local final checks:** TypeScript, production build and **165 unit/fixture tests in 30 files** pass. Isolated MySQL HTTP acceptance passes: 8 ready-OS checks, 13 profile checks, 24 core command/history checks and 8 security checks. No real OS installer was executed.

New synthetic browser regression covers one identical-name profile; full-width selector and adjacent Refresh at 320/390/768/1440/1920px; detail padding/adjacent copies at 320/390/768/1024/1440/1920px; completed frozen duration; no empty terminal payload box; active measured 50% transfer; notes save and draft preservation; 128-character password containment; pending reveal cancellation and record identity reset. Existing ready-OS, profile and Operations browser checks pass. Compact history regression remains part of the release validation.

Browser tests intercept API requests with synthetic data—even when checking the deployed origin. They validate the actual frontend assets, not a real production login or a real user's Windows password.

## Preservation and limits

No profile renaming, destructive schema migration, account/security permission change, installer-target action, or published launcher-v1 change is part of this release. Existing issued artifact bytes remain immutable. The planned app-only rollout uses an encrypted pre-update SQL/config backup and hash comparisons of accounts, encrypted artifacts/credentials, profile/settings/preset state, run/audit identities and `.env`; production evidence is appended only after the rollout succeeds.

Additional Windows editions still require appropriate administrator-supplied ISO media and separately authorized real-target testing. Historical Windows/RDP tests are not certification of every catalog entry. Visual code review cannot independently confirm the health of a remote Windows instance.

## Verified production rollout

The reviewed update is live at https://installer.d3m0nbox.online. Seventeen changed application/source/test files were installed with rollback copies and an encrypted pre-update SQL/config backup. Only the app was rebuilt/recreated. Account hashes, existing command artifact and credential ciphertext hashes, run IDs, profile state, settings/presets, audit IDs and production `.env` were preserved; counts remained one account/command/run. Database and proxy were not restarted. HTTPS health succeeds and anonymous profile/history access returns401. The deployed detail/selector synthetic regression passed; no real production credentials or login were used by it.

The actual ZIP was extracted into a clean workspace: all member checksums verified, no `.env` included, frozen dependency install/typecheck/**165 tests**/production build passed. Source copy `/opt/win11desk-source-backups/alignment-review-20261013-160405` remains on the authorized host for rollback. No installer target was accessed or reinstalled.

Final deployed compact-history regression also passed:12 dense rows,8 columns, sticky header,25/50/100 selector, full1667/1920px workspace,8px Copy gaps, aligned status/duration, contained mobile table scroll and existing credential controls. HTTPS health200, anonymous ready-OS API401 and the exact frozen public launcher-v1 SHA256 were verified. Final ZIP regeneration changes only release documentation after the clean-build validation; deployed application source remains the tested version.
