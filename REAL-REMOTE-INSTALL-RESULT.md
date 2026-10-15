# Win11Desk Version 2 — real remote-install test

## Verified on the disposable VPS

| Check | Evidence |
| --- | --- |
| Actual authenticated portal | Existing owner session; no authentication bypass or account reset |
| Previous uncertain job | Pinned password-only read-only reconciliation proved not dispatched; job closed without resending |
| Fresh target preflight |139.84.154.218, root,2CPU,x86_64,UEFI,128GiB/dev/vda, null serial |
| Explicit erasure approval | Owner approved/dev/vda erasure, Windows11Pro installation/reboot and RDP verification |
| Remote job |9a3ae0fd-a330-46c2-92c7-4e9268fba47a; state handed_off |
| Linked deployment |b8936d3e-8f74-6e55-6dc2-cdd049e813e7 |
| Live history/detail tracking | Preflight, staging, rebooting, installer booted, measured integrity/payload byte progress, media verified, preparing, Windows Setup, Windows Ready |
| Windows proof | Professional, build26300, Client; local RDP listener reported |
| Measured install time |18minutes41seconds |
| Options for this test | Selected uploaded ChromeSetup.exe only; attached licensing script Off |

The null disk serial previously disappeared during SSH login-shell argument parsing. The fix quotes every encoded positional argument, including empty ones. Real harmless systemd handoff and actual portal installation both passed this previously failing path. No SSH keys were added.

## Owner rebuild interrupted final checks

After Windows-ready telemetry, external port22 served SSH with a changed host key and the deployment was Trashed. The owner confirmed rebuilding the VPS and/or trashing its record. No credentials were sent to the changed target and no installation was repeated.

**Not verified:** external Windows RDP authentication and ChromeSetup.exe presence/hash on the Windows desktop. Windows-ready telemetry does not prove selected-file delivery. No optional-file completion report was received before the rebuild. A fresh run kept online until verification finishes is needed to close these two checks; it must use the current target credentials/host identity and a fresh exact disk/settings approval.

## Additional portal fix

The successful queue response used to disappear when Windows-password clearing invalidated the form's temporary notice. The last submitted job now has independent non-secret state, a live remote-job panel and a stable Open remote job link. Passwords and frozen reviews are still cleared. Changing input fields does not hide the previous submitted result or repeat installation. Direct query-linked job details are supported. The job filter is explicitly a search field.

## Validation

-332unit/generated-interpreter tests across54files passed.
- TypeScript checking and production build passed.
- Synthetic portal workflow passed: one install POST, no password in review/job approval, cleared password fields, retained submitted-result panel, direct job navigation and safe cancellation.
- Actual source ZIP passed clean dependency installation, typecheck, all tests and build.

The UI-only release deployment and preservation receipt will be recorded below after verification. Existing remote-runner/reconciliation fixes are already live on the testing dashboard.

## Verified UI-only release

The submitted-job persistence fix is deployed on **https://testing.d3m0nbox.online** through one retained password-authenticated SSH connection to the existing dashboard host. An encrypted SQL/config backup and source rollback copies were made first. Only three UI/test files were synchronized and only the app container was rebuilt/restarted. The remote-worker,database and HTTPS proxy were not restarted.

Before/after checks preserved the existing1account,11immutable commands/credentials/artifacts/grants,10run IDs,profiles,settings,presets,audit IDs and.env. HTTPS health and anonymous private-API401 checks passed. The deployed synthetic workflow verifies stable tracking after password clearing and direct job navigation; it does not create a live installation. Setupv1/v2/v3 integrity checks passed. The rebuilt disposable target was not contacted or reinstalled during this UI release.

**Next test requirement:** if a complete external RDP/Chrome acceptance is wanted, perform a fresh current-target review/approval and leave the target online without rebuilding or trashing its record until both checks finish. The prior real Windows-ready test is genuine, but is not an external RDP/file proof.
