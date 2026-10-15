# Exact Chrome file and one-time startup repair

## What changes

Selecting Chrome in **Get files** will deliver your exact `ChromeSetup.exe` into the per-run **Win11Desk Installers** desktop folder. It is **13,283,768 bytes** with SHA-256 `2684f9be514e035224363ed120077dfbe09975a90c35126d188aeec4aff42d1e`. The larger Chrome Enterprise MSI is no longer used for new commands. Chrome is staged as a file, not automatically installed.

**Edge is removed from new Get files choices.** Previous commands and their historical Edge results remain readable and immutable.

## Why change startup execution

The former optional worker ran only after a successful dashboard `windows_ready` HTTP callback and shared a reporter that removed itself after its retry loop. That could skip optional execution when callbacks failed. Its setup wait could also become a final timeout before Windows setup finished. These are confirmed code paths, but they are not proof of the exact cause on your previous Windows VPS without its local logs.

New optional commands use an independent protected Task Scheduler job named **Win11DeskPostInstall-<run ID>**. It runs as SYSTEM with highest privileges; it does not require RDP login, a user Startup folder, an elevation click or an extra forced reboot. Local setup, correct OS edition/build, RDP and network readiness gate the actions. Dashboard availability does not gate execution.

Startup and logon triggers plus a bounded two-minute recovery trigger keep not-yet-started work pending through early setup/network delays for up to 24 hours. Overlapping task instances are ignored. The licensing batch runs before unrelated browser downloads can delay it.

## Run once, not every reboot

The exact attached batch is checked by hash and copied into a SYSTEM/Administrators-only directory. It uses the existing unattended `/HWID /HWID-NoEditionChange` arguments. An atomically created started marker prevents a second execution, including after a crash or reboot. If the process started but its outcome was lost, the result is **Interrupted**, not an automatic retry with unknown licensing side effects.

A resumed downloaded-file state is rechecked for existence, byte count, hash/type and required signature before it can be skipped.

Local state, result and logs remain in:

```text
C:\ProgramData\Win11Desk\PostInstall\<run ID>\
```

Terminal results retry delivery without rerunning the batch. If initial task registration fails, the ordinary reporter retries registration and retains a bounded two-minute native fallback instead of deleting its only retry path. The task, credential-bearing worker and staged transport batch are removed after acknowledgment. If the bounded deadline expires, the task is disabled and local evidence is retained rather than claiming completion. Windows installation success remains separate from batch execution, licensing observations and browser file-download results.

## Existing installations and testing limits

Refresh **New installer**, choose the desired files, enable **Run attached script after installation**, and generate a **new command** after rollout. Already-issued commands and already-installed Windows VPSs do not change automatically. Do not rerun an OS installer on an existing Windows VPS merely to obtain this startup change.

The supplied EXE and batch are not executed in the development environment. Generated Bash/AWK/PowerShell code and mocked native-task/readiness/report/marker paths are tested; this is not a guarantee of successful third-party activation or a fresh Windows-target test. Keep a valid Windows license entitlement. To diagnose an existing missed run, inspect its protected local result/startup status/logs and Task Scheduler history; do not share passwords or report tokens.

## References

Microsoft documents SYSTEM setup-script behavior, OEM-key restrictions and SetupComplete restart limitations.[1] Task Scheduler exposes non-overlap, restart and execution-limit controls.[2]

[1]: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/add-a-custom-script-to-windows-setup?view=windows-11 "Microsoft: Add a custom script to Windows Setup"
[2]: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps "Microsoft: Scheduled task settings"

## Verified deployment

The app-only update is deployed at https://testing.d3m0nbox.online on the authorized dashboard VPS. Encrypted root-only SQL/config backup preceded the rebuild; no database/proxy restart or installer target operation. Existing account, command/artifact/credential ciphertext, profile/settings/preset/audit and run data plus.env were preserved (one account, five commands and five runs before/after). The app container contains exact Chrome and batch byte counts/hashes. HTTPS health and anonymous401 checks pass; deployed synthetic On/Off/Edge-removal/mobile-control checks pass. Final reviewed clean ZIP TypeScript,222 tests/41 files and production build pass. No actual uploaded EXE/batch execution or Windows end-to-end install was performed.

Final public checks passed: exact Chrome byte count/SHA256 downloaded over testing HTTPS, unchanged pinned launcher digest, and deployed synthetic dense-history geometry. Generate new commands for the repair. Windows-target execution remains untested.
