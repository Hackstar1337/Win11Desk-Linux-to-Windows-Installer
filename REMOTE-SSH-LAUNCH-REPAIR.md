# Remote SSH launch repair

## Confirmed cause

The target had no reported disk serial (`null`). The remote runner encoded its six positional fields to base64 and joined them without shell quoting. The empty serial disappeared when the SSH login shell parsed the command; the runner then read a missing sixth argument under `set -u` and exited before creating its directory or delivering any installer.

The reported **Launch uncertain — review required** was conservative, not proof that an installer had run. Read-only diagnosis on the approved host fingerprint confirmed Linux was still running and no real runner receipt or installer artifacts existed.

## Correction

Every encoded argument is single-quoted, including the empty serial. Target identity, disk size/serial checks, host-wide replay lock, detached native service and scoped tracking are retained. Old issued commands and launcher hashes are not changed.

The runner fixture now executes the actual command through `/bin/sh -c` instead of splitting strings into argument arrays, which previously bypassed the failing shell behavior. The null-serial test proves one execution, receipt reconciliation and no duplicate replay. Full TypeScript check, production build and **326 tests across 53 files** passed.

## Current test boundary

The supplied target credentials authenticate with its previously approved SSH host fingerprint. No Windows reinstall has yet been started in this repair. A harmless native-runner check uses a separate diagnostic directory and does not touch the installation lock. Actual portal acceptance requires a live authenticated admin session, read-only reconciliation of the previous uncertain launch, then review of the exact target, OS/profile, Windows credentials and disk before a new installation. Windows-ready and selected-file/script outcomes must be verified separately; SSH handoff alone is not completion.

## Harmless real-target result

On the approved-fingerprint VPS, the actual Node `ssh2` client authenticated using the supplied root password. The emitted preflight passed with 3,392MiB usable/3,904MiB nominal RAM, 2 CPUs, UEFI, `/dev/vda` at 137,438,953,472 bytes and `diskSerial=null`. The repaired runner used native systemd startup, returned `state=launched`, and read-only reconciliation returned `state=launched`.

That proof ran only a harmless text-printing bootstrap in `/root/win11desk-remote-diagnostic-20261014`, not the real installation directory. No OS install, activation, partition change or real installation lock was touched. The authenticated browser available to the agent is still at the sign-in form; the user’s separate side-panel session does not by itself authenticate this browser. No login bypass/account reset was used.

## Recovering the previous uncertain job

A second connected defect kept a job uncertain forever even when read-only reconciliation proved it was never dispatched. The reconciliation probe now reports `absent` only when the receipt, job directory, job lock and host-wide dispatch marker are all missing. If any marker exists without a receipt it remains `unknown`; nothing is rerun automatically.

The scoped, password-authenticated reconciliation API closes a proven absent job as `blocked / RECONCILE_NOT_DISPATCHED`, clears its transient credentials and preserves its history/issued command. The portal explains that a fresh target check and installation review are required. Prepared/unknown receipts retain the conservative uncertain state. Final local checks: **332 tests across 54 files**, TypeScript and build.

## Verified deployment and remaining milestone

The final app/worker repair is deployed on **https://testing.d3m0nbox.online**. Protected encrypted SQL/config backup and source rollback copies are retained. The before/after checks preserved the existing 1 admin account, 9 immutable commands and their credential/artifact/grant ciphertext hashes, 8 run IDs, profiles, settings, presets, audit IDs and `.env`. Database/proxy services were not restarted; app and remote worker are healthy, and anonymous private APIs remain401.

The final clean ZIP passed installation, typechecking, 332 tests/54 files and build. Isolated final-runtime API acceptance passed18 checks without a dispatch worker or external installation. Live synthetic portal UI passed. Actual harmless preflight/systemd handoff/reconciliation succeeded on139.84.154.218 with its null disk serial.

**Still pending:** authentication in the agent-controlled portal browser, reconciliation of the old uncertain job through the real API, a fresh exact target/profile/Windows-settings erase review, installation/Windows readiness and RDP verification. The disposable VPS remains Linux; this repair does not claim a successful remote Windows installation.

## Real portal acceptance — pre-installation

The agent-controlled browser is now genuinely authenticated as the existing owner. The previous job `175d1134-7905-4433-a671-c0bc168b2c51` was reconciled through the actual portal with password-only pinned SSH. The API proved no real runner/receipt/global dispatch marker existed and closed it as `blocked / RECONCILE_NOT_DISPATCHED`; no installer was resent.

A fresh actual portal host discovery matched the approved ed25519 fingerprint. Password-only read-only preflight passed on139.84.154.218:22/root:hostname vultr,x86_64,2 CPUs,3.3GiB usable/3.8GiB nominal RAM,UEFI,systemd,128GiB/dev/vda,disk serial unavailable and dashboard HTTPS reachable. The new frozen review selects Windows11Pro profile revision2 using the direct d3m0nbox.online ISO,Administrator,RDP22,the previously supplied Windows test password (masked/encrypted),Chrome file only and attached script Off. No destructive dispatch has happened; exact target/disk/settings approval is requested before pressing Install and reboot.

## Actual approved installation — latest evidence

The approved portal installation on139.84.154.218 created remote job9a3ae0fd-a330-46c2-92c7-4e9268fba47a and linked deploymentb8936d3e-8f74-6e55-6dc2-cdd049e813e7. SSH state became handed_off and telemetry progressed through integrity/payload download,media_verified,preparing and windows_setup. Windows reported Professional,build26300,Client and local RDP listening at2026-10-14T19:18:23.309Z; measured elapsed18minutes41seconds. Selected Chrome has not supplied a separate optional report.

At2026-10-14T19:26Z external port22 served SSH-2.0-OpenSSH_10.3,not RDP. Its ed25519 identity SHA256:im7hPNTKLlxebVfAAbAn4b7QZQh2XMXv1bKDk7CfNvU differs from pre-install approved SHA256:9w6hzVrkrwAiHGcVqLdJAVLqa+HufiI+RdYfSvjeY78. The portal now shows this deployment as Trashed. User/provider intervention is possible but not established. No credentials were sent to the changed target,no installer was repeated,and no external RDP login or Chrome desktop presence was claimed. The telemetry-only monitor was stopped pending clarification.

The post-submit tracking-message bug is corrected locally: a stable last-submitted job panel/link survives form password clearing and settings invalidation. Synthetic UI,TypeScript,build and332tests/54files pass; clean extracted source ZIP also passes install/check/tests/build. This additional UI-only refinement is not yet deployed or committed. Existing null-serial/reconciliation fixes remain live. Earlier pending-milestone paragraphs above are historical and superseded by this latest section.

## Owner clarification — confirmed rebuild

On2026-10-14T19:33Z the owner confirmed rebuilding the VPS and/or trashing the deployment record. This explains the changed host identity and is not treated as a new installer malfunction. The real portal/API/password-only SSH handoff, durable deployment linkage, ISO telemetry and Windows11Pro-ready callback are verified. External RDP login and exact selected Chrome desktop delivery were interrupted by the rebuild and are still unverified for this run. No fresh installation is authorized by this clarification alone; do not re-erase the rebuilt target without a fresh current-credential/host/disk review and approval.
