# Win11Desk Version 2 — read-only preflight repair

## What changed

The portal’s generic **“The target did not pass the read-only preflight”** message hid the actual rejected condition. Two code defects were confirmed and corrected:

1. **Shell execution:** the original SSH command contained Bash-only syntax but was handed to the account’s unspecified SSH login shell. The fixed probe is now sent through stdin to the explicit `bash -s` command.
2. **Memory parity:** the portal required 3900 MiB of usable Linux RAM, while the retained, working installer requires **3900000 KiB nominal RAM**, including Linux crash-reserved memory, and **1000000 KiB usable RAM**. The portal now uses the installer’s exact thresholds and reports usable/nominal memory separately.

A focused review also corrected early-exit disk-inspection pipelines: topology and mount inspection now fail closed, and matching filters consume complete output without SIGPIPE bypass. This applies to the portal probe and **future generated wrappers only**; previously issued encrypted scripts remain unchanged. The worker now uses the same normalized public origin as the portal. Authentication/discovery failures within a target check also receive a safe audit code.

These fixes do not lower or bypass the actual installer’s compatibility requirements. They do not change the pinned installer engine, Windows startup worker, Chrome asset, or any frozen setup version.

## Useful rejection reasons

The portal now returns safe, specific reasons for missing Linux tools, unsupported virtualization/architecture, non-root access, ambiguous/unsupported system disks, additional data mounts, inadequate memory/CPU/disk space, Secure Boot, unavailable detached execution, and failure to reach the dashboard over verified HTTPS. Where appropriate, it shows validated numeric evidence instead of arbitrary remote output.

Example:

> The VPS reports 1 CPU core(s); at least 2 are required. No installation started.

The failed check has a secret-free audit record. Raw SSH stderr, root passwords, Windows passwords and private installer capabilities are not returned as diagnostics. Failed checks do not create an installation job or authorize disk erasure.

## What to do now

1. Refresh **New installer → Install via SSH** on `https://testing.d3m0nbox.online`.
2. Choose the ready profile and fill the Windows credentials/options.
3. Enter the target’s **current Linux root password**. It must be the SSH password, not the future Windows password.
4. Discover/verify the host fingerprint, then click **Test connection**.
5. If a condition is still rejected, the portal now explains the exact safe reason. Correct that prerequisite and test again.
6. Only after a successful check, create and inspect the installation review and approve the target-specific **Install and reboot** action.

Checking the target is read-only. This repair did not run an installer, change an SSH key, modify a target disk, or reboot a target.

## Actual-target diagnostic limitation

The dashboard showed an approved target fingerprint but no successful target inventory or launch jobs. A read-only direct diagnostic matched that approved host key, but the previously supplied target password was rejected. Authentication stopped; it was not retried and no target inventory was obtained. Therefore, the original target-specific failed condition is **not established** by that diagnostic. The corrected code and more precise portal errors are verified; a real successful check on that VPS requires its current credentials.

## Local verification

- TypeScript check and full production build passed.
- **325 tests across 53 files passed.**
- Executed the real emitted probe under a POSIX SSH-shell fixture that explicitly starts Bash. Covered nominal/usable memory and crash reservation, missing tools, container virtualization, LVM, additional data mounts, Secure Boot, verified-HTTPS failure and missing detached runner.
- Loopback SSH regressions confirm password-only authentication, approved host-key enforcement, stdin transmission and no target SSH configuration/key changes.
- Isolated Version 2 API/SQL acceptance: **18 checks passed**, with no target SSH dispatch worker.
- Synthetic browser regression verifies a specific rejected-check message, cleared SSH password, no review/job on rejection, and usable/nominal RAM on success.
- Existing compact deployment history geometry, clipboard, password masking, progress and elapsed-time checks passed.

Production rollout and clean-release evidence are recorded below only after successful verification.

## Verified live release

The reviewed repair is deployed on **https://testing.d3m0nbox.online**. Only the dashboard app and remote worker were rebuilt/recreated. No migration, database/proxy restart, environment change or target installation was performed.

The encrypted pre-update SQL/config backup and source rollback copies were retained root-only. Verification preserved all existing account hashes, issued artifacts, credential ciphertext, delivery grants/envelopes, deployment run IDs, profiles, settings/presets and audit IDs. Existing counts remained one account, eight commands and eight runs; the worker heartbeat and HTTPS health passed, and private endpoints rejected anonymous requests.

The actual standalone ZIP passed frozen dependency installation, TypeScript, all **325 tests across 53 files**, and production build from a clean extraction. Deployed synthetic portal tests passed the precise failed-check message, cleared SSH password, rejection without review/job, successful memory display and explicit final installation review. Deployed compact history checks passed. Public v1/v2/v3 setup and exact uploaded Chrome asset hashes remain unchanged.

**Still not claimed:** a successful preflight or Windows installation on the reported VPS. Its old supplied password was rejected in the read-only direct diagnosis. Re-enter current target credentials in the updated portal; no automatic authentication retry or destructive retry was performed by this repair.
