# Desktop installer files and post-install automation

Yes: Win11Desk can offer the browser/tool selection shown in the reference and place selected installer files in a desktop folder. It can also run a batch file automatically after Windows setup is finished. Those are separate features; copying an installer is not the same as installing that browser. Neither network delivery nor an arbitrary third-party batch file can be guaranteed issue-free.

## What the current code actually does

`shared/deployment.ts` already contains choices for Chrome, Firefox, Edge, Brave and7-Zip, plus a custom-file field. However, the live profile-only issuer does not currently connect those choices to automatic desktop delivery. `postInstallScript()` in `shared/installer.ts` is a separate manual helper using winget; it is not the requested folder of installer files and is not a completed automatic post-install integration. It also requires winget, which should not be assumed available in every freshly installed Windows/Server profile.

The real installer already injects Windows setup/startup hooks and starts a bounded SYSTEM reporter. The new feature should reuse those verified hook locations without replacing their networking, password setup or Windows-ready proof.

## Stage1 — selected installers on the desktop

Add a **Get files** group to New installer with labelled multi-select controls for Chrome, Firefox, Edge, Brave and7-Zip. Selected files are downloaded, not silently installed. Keep the current OS selector profile-name-only and keep ISO links inside the profile editor.

Use `C:\Users\Public\Desktop\Win11Desk Installers\` so the configured RDP user sees the folder without first creating a specific user profile. It should contain only the selected installers, an optional custom file and a short readme. Use Windows x64 files consistent with the supported OS catalog. The catalog must identify official publisher download sources and verify expected publisher signatures after download. Version-changing installer links cannot be treated as permanently fixed SHA-256 files; record the actual hash, publisher and version for downloaded executables. Browser/vendor version compatibility must be checked before offering a choice on older Server profiles.

Restore an optional direct HTTPS custom-file field for `.zip`/`.iso` downloads with a100MiB streamed limit, clear errors and no automatic extraction/execution. That limit applies to the user-supplied custom file, not silently to larger official browser installers. Reject credentials in URLs, unsafe file names, private/internal destination addresses and unsupported redirects. Keep certificate validation, bounded download retries and file validation; do not leave HTML error pages or partial downloads named as successful installers.

Run file delivery independently after Windows setup/network readiness. Do not inflate the boot initramfs with large browser packages, introduce winget as a prerequisite or block RDP while browsers download. A missing browser download must not change an already proven OS installation into “installation failed.” Show separate per-file progress/outcome in Details.

## Stage2 — a one-time batch runner

Provide authenticated admin upload/versioning of `.bat`/`.cmd` files with an explicit **Run once after installation** option, selected profile compatibility and visible execution mode. Preserve exact uploaded bytes and a SHA-256 digest. Copy the small pinned script into the installation payload before reboot, rather than depending on a short-lived upload link after a long Windows installation.

An issued command snapshots the chosen apps, file settings, exact script version/hash and execution mode. Later profile/script changes affect new commands only. Existing commands, encrypted credentials and immutable installer artifacts remain untouched.

The Windows setup hook should only arm the task; it must not synchronously wait for an interactive batch program. Microsoft documents that SetupComplete uses SYSTEM privileges, is skipped for some OEM-key configurations, does not validate script exit codes and cannot safely reboot/resume mid-script.[1] Keep the pinned installer's existing OEM-aware startup-hook path and use a separate scheduled task with bounded execution after setup is no longer in progress, the selected edition/build is verified, RDP is listening and required networking is available. Windows Task Scheduler supports batch files and explicit execution principals, but does not validate OS compatibility for the script.[2]

Unattended scripts can run as SYSTEM without an RDP login or storing another user password. Interactive scripts cannot reliably show a dialog in that background context; they need a separate first-logon mode or explicit supported unattended configuration. Do not enable auto-logon merely to make a batch file run.

Use a per-run lock and durable started/completed markers. Do not automatically retry a script after an unknown partial run or interrupted reboot: arbitrary batch operations may not be idempotent. A failure before the script starts can be retried within bounded preparation rules. After script execution has begun, retain its exit code, timestamps and redacted/size-limited logs; operator inspection precedes any manual retry. Remove the task after its final outcome. Do not weaken Windows protection or suppress signature/integrity errors to make a file run.

Keep **Windows ready** independent of **Post-install pending/running/completed/failed/timed out**. Add a separate scoped post-install report channel: the current tracking state machine intentionally protects terminal OS status and must not be overloaded with a later script outcome. A batch exit code alone is not proof that its intended work succeeded; use an appropriate verification step for the configured action.

## The specific attached file

The attachment identifies itself as **Microsoft Activation Scripts3.12**, not a browser installer. Static inspection found elevation checks, licensing-service/product-key/ticket changes, network dependencies, unattended dispatch and interactive exit/error paths. The attached copy's default MainMenu jumps directly to its HWID activation routine. That routine explicitly rejects Windows Server and has edition/build restrictions. Therefore it cannot simply be enabled unchanged on all32 supported OS selections.

Simply launching it with no arguments is not reliable background automation: it can take an interactive path, look for a desktop and wait at an exit/error prompt. Its selected unattended behavior and eligible client profiles must be agreed before enabling it. Keep OS-edition changes disallowed unless separately requested; valid Windows licensing remains the owner's responsibility. Do not assume generic process success proves activation, and do not promise activation will succeed on every build or network.

I inspected the startup, dispatch and relevant compatibility/prompt sections as text. I have not executed this file, certified it as harmless or performed a complete security audit of all19,219 lines.

Attachment integrity at inspection:761,356 bytes; SHA-256 `17f10848ae162dd6e68c0e19080474e043ecad3caba4b10a50368006d2788e90`; CRLF line endings preserved.

## Stage3 — verification and release

First complete desktop-file delivery with harmless fixtures and isolated dashboard/API tests. Then test the generic post-install runner with a harmless batch file that writes a marker and exits. Cover slow/no network, setup still running, reboot, duplicate hooks, failed/timed-out execution, independent OS status, permissions and immutable snapshots. A fresh Windows target test requires an explicitly approved disposable target; no previously supplied VPS should be erased just to test these features.

Only claim real batch execution after Windows evidence exists. Roll out dashboard/issuer changes with encrypted backup, additive migrations before app switch and existing-record preservation checks. Regenerate the standalone ZIP/manifest/checksum after verified changes. Previously issued commands will need replacement to receive the new hooks; an already installed/booted target is not patched by refreshing the dashboard.

## Decision needed

For the attached MAS file, choose its eligible OS scope: Windows11Pro only; compatible Windows10/11 client profiles only; or build the generic runner while leaving this attachment unassigned. Windows Server/evaluation profiles should not inherit its default HWID path. This changes what code runs with administrator-level permissions on future installations, so it should not be silently guessed.

No application, production dashboard or target VPS has been modified for this proposal. The existing released ZIP/checksum remain unchanged.

## References

[1]: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/add-a-custom-script-to-windows-setup?view=windows-11 "Microsoft: Add a Custom Script to Windows Setup"
[2]: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask?view=windowsserver2025-ps "Microsoft: Register-ScheduledTask"
