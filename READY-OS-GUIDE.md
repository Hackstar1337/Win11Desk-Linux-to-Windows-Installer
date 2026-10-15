# Ready operating systems and automatic commands

## Configure media once

Open **Deployment profiles** as an owner/admin. Create or edit a named profile, select its supported OS edition, and configure its direct HTTPS x64 Windows ISO URL. Optional exact image name, username, RDP port and retry defaults stay in that profile. The approved Windows 11 Pro Default profile remains available if it is configured and active.

A profile with no ISO URL or an archive state is not an Operating system choice on New installer. **Ready means configured for command issuance**, not a successful media reachability check, a certified installation on every provider, or a Windows license. The broader Windows catalog and media requirements remain documented in the Deployment profiles guide.

## Generate and run

1. Open **New installer**. Choose an **Operating system** from the ready profiles. Ordinary entry selects the configured Default if it exists; otherwise select explicitly.
2. Enter the Windows username, password (minimum 8 printable ASCII characters), RDP port and optional label.
3. Open **Advanced** only for retries, tags or a batch. Unique-password batches generate a separate password for each item; no shared Windows password is required in that mode.
4. Generate, copy and paste the complete command in **root Bash SSH on the intended Linux VPS**.
5. Watch **Deployment history** for that VPS's detected IP, selected profile/revision, stage, measured ISO transfer progress and elapsed time.

**Pasting and running authorizes erasure of the automatically detected VPS system disk and automatic reboot.** Generation alone does not connect to a VPS or change its disk. Keep provider recovery access and a usable backup/disposable target.

There is no ISO URL field, Restore default ISO, Custom configuration or preset selector on New installer. Changing media belongs exclusively to Deployment profiles. A requested `?p=` profile must be ready before issuance; unavailable links never silently select a different operating system. Loading/API failures disable generation. Choose a valid option or Refresh after correcting the profile.

## How the compact command works

The command downloads a **versioned first-party launcher from your dashboard**, verifies the launcher hash embedded in the issued command, and passes its issued command identity and private retrieval capability through standard input. The launcher obtains the original issued installer over capability-protected POST delivery, checks the selected immutable profile identity and the installer hash, then runs the existing automatic installer.

Bounded curl/wget download handling, private temporary files and hash checks prevent failed/empty/corrupt downloads from executing a stale `setup.sh`. It does not change global DNS, fetch an unpinned third-party executable, disable TLS validation or discover a substitute ISO.

The copied command does **not** contain the Windows password, but its bearer capability authorizes retrieval of the private installer. **Treat the entire command as a secret.** Root on the destination can inspect the downloaded installer and its credentials. The feature is not a promise to hide credentials from the server's owner.

## Existing commands and truthful completion

Previously issued artifacts, encrypted credentials, callbacks and command identities are not rewritten. Existing valid command retrieval and exact idempotent replay remain compatible. New commands retain their profile/media/launcher identity even after a profile is edited or archived; those changes affect fresh issuance only. Expiry/revocation still controls starting/retrieving a command, not whether a previously started installation succeeded.

Each execution registers separately, so a still-valid copied command can produce multiple VPS history rows. Windows-ready requires matching selected OS proof and a local RDP listener. Download 100%, SSH disconnect, a timeout or an open remote port alone never establishes successful Windows installation or external RDP authentication.

## Validation boundary

This refinement is verified through safe generated-shell fixtures, isolated database/API tests and synthetic browser checks. It does not perform another destructive VPS installation and does not newly certify all Windows editions or providers. Historical Windows 11 Pro boot/RDP tests remain distinct from this release's application-level tests.

## Stage2 release checks

The14-line reference compact command has safe shell transport/sentinel evidence, not a new destructive VPS test. The actual ZIP clean dependency install, TypeScript,157 tests and production build pass.9 ready-OS,24 core,13 profile and8 security isolated HTTP checks pass. The18-file app-only update preserved existing accounts, issued artifacts/credentials, command/run IDs, profiles/settings/presets/audit and.env; database/proxy stayed running. No target install occurred.

Final deployed ready-OS/profile/history synthetic checks passed. The public v1 launcher bytes match the frozen release hash, HTTPS health succeeds and unauthenticated ready-profile access is blocked. Refresh New installer to use the delivered form.
