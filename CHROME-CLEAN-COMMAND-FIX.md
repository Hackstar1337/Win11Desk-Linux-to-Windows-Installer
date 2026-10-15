# Missing Chrome and cleaner installation commands

## What was wrong

The tracker derives run IDs as **hexadecimal UUID-shaped hashes**. The optional startup helper incorrectly required an RFC UUID version/variant. A real tracker ID can therefore be valid in the dashboard but rejected before the optional task is registered. This can leave Windows ready while **Get files** never runs and no separate optional-task report arrives. The uploaded Chrome file itself remains the same pinned 13,283,768-byte `ChromeSetup.exe`.

The strict helper was reproduced with the observed identifier in a harmless generated-PowerShell fixture. The repaired helper accepts only the exact tracker shape, still rejects malformed/path-injected IDs, and reaches **mocked native task registration** with those IDs. This verifies the generated code path—not a fresh physical Windows installation.

## Repair for newly generated installations

- The registration and startup guards now agree with the existing tracker; no historical run IDs or commands are changed.
- Selected files download and verify **before** the attached script can run for a long time. A licensing-service wait gates only the script, not Get files. Each action still has its own status and bounded retry rules.
- The exact uploaded Chrome bytes, issued checksum, signature/publisher verification, per-run Public Desktop folder and script run-once marker remain intact. No Edge option is restored.
- The detail page says **Awaiting optional-task report** when no evidence exists. **Windows ready is not proof of file delivery or script completion.** The destination is `Desktop → Win11Desk Installers → <run ID>`.

Refresh **https://testing.d3m0nbox.online**, select Chrome under Get files and generate a **new command** for a future Linux VPS installation. Existing commands/artifacts are immutable and retain the old startup code. Do not paste a destructive installer command into your already installed Windows VPS.

## Cleaner copied command — v3

The testing-domain command is **8 lines / 1,230 bytes**, approximately **33% shorter** than the previous 12-line / 1,841-byte v2 paste. It still warns that installation erases the intended disk and reboots.

The copied block retrieves immutable first-party `setup/v3.sh`, verifies its pinned SHA-256, and sends one private ticket plus the independent artifact checksum through stdin. The generic setup retrieves the exact encrypted issued installer and verifies it before execution. No Windows credentials, ISO/options or engine are displayed in the copied block. v1/v2 setup files and delivery/replay behavior are retained byte-for-byte.

The VPS terminal shows genuine rotating activity during **package retrieval and first-stage preparation**. It does not invent a percent or declare Windows ready. Raw preparation output goes into a private, bounded diagnostic rather than the console. Failure remains visible with the actual exit code; successful first-stage handoff says to follow the dashboard. Later Alpine/Windows boot-console output is not concealed by this first-stage wrapper.

Both download integrity checks remain enforced. A failed, empty, partial, oversized, HTML or checksum-invalid transfer does not run. Bash scope preserves the surrounding SSH shell/traps. A separate process session owns the installer pipeline for interruption cleanup, and output is drained after a 256 KiB log cap so the cap cannot truncate or size-limit ISO/disk writes. The verified installer does not receive the delivery ticket on stdin.

This reduces casual exposure, **not root-proof copy protection**: root on the executing VPS can inspect code and settings it must run. The entire command/ticket is private; its existing expiry/revocation and authorized multi-VPS behavior are preserved.

## Already installed VPS — files-only recovery

`deploy/recover-selected-chrome.ps1` downloads the exact Chrome file into the matching Public Desktop subfolder. It verifies exact byte count, SHA-256 and Google publisher/signature, and leaves an already verified file unchanged. Download/time limits, no redirects, partial-file cleanup and normal TLS verification are retained.

Copy the helper onto the **already installed Windows VPS** (not just your local Windows PC) and run there in elevated Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\recover-selected-chrome.ps1
```

The helper defaults to the affected observed run. For another run, use its Details-page run ID:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\recover-selected-chrome.ps1 -RunId '<your run ID>'
```

This is **download only**: it does not run ChromeSetup.exe or MAS, change licensing, register/re-enable tasks, reboot or reinstall Windows. It also does not fabricate a dashboard callback. It was parsed and inspected, not executed on your Windows VPS; physical file recovery is not claimed completed.

## Verification boundary

Harmless generated Bash/PowerShell execution tests, mock downloader/TTY tests and isolated SQL/API/UI tests verify the repaired paths. They do not certify every provider, Microsoft setup path, third-party executable/signature trust environment or MAS outcome. Live dashboard rollout and exact public hashes are recorded separately after verification.

## Verified testing-site deployment — 2026-10-14

Deployed on **https://testing.d3m0nbox.online** with an encrypted pre-update backup and protected source rollback copies. Only the app was rebuilt/restarted; database/proxy and installer targets were untouched. Existing **1 account,6 issued commands and6 run IDs** were retained, with account hashes, command/artifact/Windows credential ciphertext, delivery-secret envelopes/hashes, profiles/settings/presets/audit IDs and.env unchanged.

Public HTTPS health, anonymous API401 protection, strict v3 endpoint400 behavior, exact supplied Chrome bytes/checksum and the current frontend bundle passed. Retained v1/v2 setup hashes remain unchanged. New immutable v3 SHA-256: `28cef62c58017bec84f7b4dd6e5f6fb41bc8fa72da1e1f7b5175693053482bbb`.

The actual ZIP installed, typechecked, passed all253 unit tests and built in a fresh extraction. Final isolated HTTP checks cover v3 creation/settings/legacy replay (13 checks), optional artifact/outcome isolation (10 checks) and core history/security/data lifecycle (27 checks). Read-only review corrections include bounded script-service waits that finalize failure while retaining downloaded files, and started-child cleanup/disposal on exception. Actual pseudo-TTY frames and failed-but-complete downloads were executed with harmless stubs. No Windows executable, MAS licensing action, target OS installation or existing-VPS recovery was performed by this release.

Final deployed ready-OS/private-command, selected-only file controls and dense history synthetic UI checks also pass. Refresh the page and generate a new command to receive these changes.
