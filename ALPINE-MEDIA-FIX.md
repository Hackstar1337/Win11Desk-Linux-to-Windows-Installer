# Alpine installation failure — HTTPS client preparation fix

`MEDIA_HTTPS_CLIENT_UNAVAILABLE` in the supplied console is emitted by Win11Desk's media-preparation hook, before its media probe and partitioning calls. It is **not** a Windows password, RDP, ISO edition or Windows Setup error.

## Root cause and correction

The previous generated hook tried `apk add --no-cache curl ca-certificates pv` before the pinned installer's `add_community_repo()` call. Alpine's initial live environment has a main repository, while `pv` (the byte-progress meter) is supplied by community. APK rejects that combined transaction when `pv` cannot be found, and the hook reports a misleading HTTPS-client error. The pinned source places community initialization later, after `clear_previous`; our integrity guard intentionally runs earlier, so it must prepare its own dependencies first. [1]

The fix independently prepares **required curl/CA support**, reuses an already working HTTPS-capable curl and trusted CA bundle, and retries missing transport preparation three times with a 90-second bound per package call. It invokes the existing pinned helper to enable community for the **same mirror and running Alpine release**, before separately attempting the optional progress meter. It does not mix stable and edge repositories. If only `pv` is unavailable, installation continues with HTTPS certificate checks and full streamed SHA-256 verification; integrity percentage can remain unknown rather than stopping installation or inventing progress. A genuinely missing HTTPS client/CA bundle still stops before media/partition work with the correct error. [2]

Media signature, pre-partition full digest and post-download digest checks remain enabled. No certificate bypass, alternative ISO/mirror, changed Windows password policy, profile rename, account/security change or launcher-v1 rewrite is part of this repair.

## What was tested

The old combined APK transaction was reproduced in isolated real Alpine containers with only their existing main repository enabled. Each printed `pv (no such package)`. The corrected helper then installed required curl/CA and optional pv after community setup, successfully fetched the dashboard health endpoint over certificate-verified HTTPS, and still succeeded when optional meter installation was deliberately made to fail.

This real package test passed on **Alpine 3.24.2**, matching the screenshot's 3.24 branch; it also passed on 3.22.3 and an edge image. Tests ran only in disposable local containers, with no VPS disk or real Windows installer execution. An initial edge test harness assumed curl had been installed in the minimal image; that test assumption was corrected and the rerun passed.

Regression fixtures cover ready/offline core transport, missing core, transient required-install failures, permanently missing HTTPS dependencies, missing community/meter, already-ready transport/meter, patched-source ordering, portable ash syntax and SHA verification without pv. With no meter, a bad digest still prevents the continuation marker and progress stays indeterminate. Generated Bash/ash integrity hooks are tested against the actual pinned source.

## Your next attempt

**Previously generated commands and the failed VPS's `/trans.sh` are immutable copies; refreshing the website does not update them.** Generate a **new command after this fix is deployed**.

Your VPS is already booted into temporary Alpine, not its original Linux OS. Do not paste the normal Linux bootstrap into that rescue console without reviewing its root-disk environment, and do not run `sudo /trans.sh alpine`—that option installs Alpine instead of Windows. Merely rerunning the unchanged `/trans.sh` retains the old defect.

The straightforward fresh-start route is to rebuild **only the affected disposable target VPS** to its original Linux OS through its provider, then run a newly generated Windows command. A rebuild erases target data, so use it only for an authorized disposable/backed-up target. Keep the dashboard host separate and preserve the provider recovery console.

Alternatively, a carefully reviewed in-place recovery of that existing Alpine instance may be possible, but requires its exact IP and matching deployment/tracking identity before we inspect it. Resuming the installer can replace partitions and reboot. This repair does not access or resume an unidentified target, certify Windows readiness, or assume its disk is untouched merely because this particular guard ran early.

## Release status

Local compiler/build and **175 tests across31 files** passed, including both no-pv digest fixtures. A focused read-only review found no blocking defects; live preservation evidence follows after deployment. Isolated HTTP tests passed8 ready-OS and24 core command/history checks, including exact delivered artifacts, encrypted credentials, immutable profile replay and reported Windows evidence. No new real Windows/RDP test was performed.

## References

[1]: https://pkgs.alpinelinux.org/package/edge/community/x86/pv "Alpine package index: pv belongs to community"
[2]: https://pkgs.alpinelinux.org/package/edge/main/x86/ca-certificates "Alpine package index: ca-certificates belongs to main"

## Verified live update

The fix is deployed at https://installer.d3m0nbox.online. Five changed source/test/tool files were uploaded through one authenticated, host-key-verified SSH connection, with root-only encrypted SQL/config backup and rollback source copies. Only the application was rebuilt/recreated. Existing account hashes, command artifact/credential ciphertext hashes, two command/run identities, profile/settings/preset state, audit IDs and `.env` are unchanged. The database and proxy were not restarted. Public HTTPS health succeeds, anonymous command/profile/history APIs return401, and the published launcher-v1 digest remains byte-identical.

The standalone ZIP was extracted cleanly: every manifest digest verified, no `.env` included, frozen dependency install/typecheck/**175 tests**/production build passed. Final regeneration adds only release evidence to the documentation. No failed target VPS was accessed or resumed. New commands now receive the corrected helper; previously issued command scripts remain the original bytes.
