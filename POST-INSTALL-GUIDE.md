# Selected desktop files and optional attached script

## Controls in New installer

Both controls default to **Off** and apply only to the newly generated command.

- **Get files — On:** select Chrome, Firefox, Brave and/or 7-Zip. Only selected installer files are downloaded after Windows readiness. They are **not silently installed**.
- Optional **Custom file link:** direct public HTTPS `.zip` or `.iso`, maximum **100 MiB**. It is downloaded, not extracted or executed. OS ISO links still belong in Deployment profiles, not here.
- **Run attached script after installation — On:** stage the exact supplied `MAS_AIO.bat` and run it once unattended on a compatible Windows 10/11 client. The script changes Windows licensing. Use only with valid license entitlement. It is disabled for Windows Server because this attachment's HWID mode does not support Server.
- Off excludes the corresponding staging and execution. Neither option requires the other. Changing choices clears an older generated result. Enter a password again after generation; the form intentionally clears it.

**Generate a fresh command for these options.** Existing issued commands and their artifacts do not change.

## Where files appear

On the installed VPS, open the desktop folder **Win11Desk Installers**. Its deployment Run ID subfolder contains the selected files:

`C:\Users\Public\Desktop\Win11Desk Installers\<run-id>\`

The per-run subfolder prevents temporary or final files from different runs overwriting each other. Deployment details show the path and each file's outcome, downloaded bytes and abbreviated checksum. Edge is no longer offered for new Get files selections. Previously issued Edge commands/results remain immutable and compatible.

## How the attached file runs

New optional commands use a separate protected **Win11DeskPostInstall-<run ID>** native SYSTEM/highest task. Startup/logon and bounded two-minute recovery triggers wait for local correct OS, setup completion, RDP and network readiness. A dashboard callback is attempted but never gates local execution. The script launches before unrelated browser downloads, using native Windows `cmd.exe` with:

```text
/HWID /HWID-NoEditionChange
```

These arguments select unattended client HWID behavior and prohibit automatic edition conversion. The attachment is unchanged, 761,356 bytes, SHA-256:

```text
17f10848ae162dd6e68c0e19080474e043ecad3caba4b10a50368006d2788e90
```

It is transferred through a streamed Base64 heredoc—not a giant process argument—verified, staged into Windows, copied into the protected per-run directory and verified again. A mutex and independent durable `script-started.marker` prevent a second launch for the same run, including when state JSON is missing/corrupt. An interrupted attempt is not replayed automatically. It has a 15-minute process limit and bounded local output; failures/timeouts are separate from OS completion. A zero process exit alone does not mean activation succeeded: the worker observes the current Windows edition's non-add-on licensing status as separate evidence.

Protected local state and logs:

`C:\ProgramData\Win11Desk\PostInstall\<run-id>\`

No raw script output, licensing keys or secret URLs are returned through report APIs. Turning this option Off does not reverse a script previously executed by another command.

## Download verification and reporting

- Firefox 157.0.1, Brave 155.1.97.56 and 7-Zip 26.04 use pinned official URLs and SHA-256 values independently checked by download-only research.
- Chrome uses the exact supplied13,283,768-byte `ChromeSetup.exe`, pinned SHA2562684f9be514e035224363ed120077dfbe09975a90c35126d188aeec4aff42d1e and a hash-addressed first-party HTTPS file route. No Enterprise MSI or silent Chrome installation. Target Authenticode checks remain untested on Windows.
- All downloads use TLS, bounded redirects/read time/deadline, public-address checks, streaming size limits and HTML/file-type rejection. Custom ZIP/ISO data is bounded at 100 MiB. No third-party installer is silently launched.
- Only selected files and the selected script setting may be reported by that run's authenticated, unexpired capability after Windows-ready evidence. Final outcomes cannot be overwritten. Archive/history operations keep their existing permissions; purge also removes optional-action report rows.

## Verification and limits

The release passes TypeScript, production build and 222 unit tests across 41 files, including actual PowerShell parsing and harmless helper execution on Linux. Isolated HTTP checks verify exact attachment bytes, selected-only plans, old Off/idempotency compatibility, immutable artifact/hash/replay, Server exclusion, report capability/selection/expiry rules and unchanged OS metadata after optional failure. Synthetic UI checks cover independent toggles, stale-output invalidation, source-free OS selection and 320–1440px containment.

**No browser installer, batch file or activation has been executed in these checks. No fresh Windows VPS end-to-end test has been performed for this feature.** PowerShell 7 parsing/helper checks are not a substitute for Windows PowerShell 5.1, registry/CIM, Authenticode, provider-network or actual unattended setup testing. Network/vendor availability, antivirus quarantine, unsupported editions or licensing errors can still make optional actions fail; Windows-ready stays separate. Dashboard outage does not block local actions. Terminal outcomes are retried without action replay; cleanup waits for acknowledgment, or the task is disabled at the24-hour deadline while local evidence is retained. No indefinite licensing rerun. See CHROME-STARTUP-REPAIR.md for the current startup repair and testing limits.

## Historical initial optional-feature deployment evidence

The 26-file app-only rollout is complete on the authorized VPS45.63.51.163. An encrypted root-only SQL/config backup preceded the additive `control-post-install-v1` migration. The attachment is present and readable by the app container, with the exact size/hash above. HTTPS health and anonymous API401 checks pass. Existing account hashes, command artifact/credential ciphertext hashes, profile data, audit IDs, run IDs, settings/presets and `.env` were preserved (one account, three commands, three runs before/after). Database and proxy were not restarted. Clean extracted ZIP dependency install, typecheck,198 tests (before the extra mocked licensing regression; final source199 tests) and production build passed without Git history. Optional-action execution on a Windows VPS remains untested.

### Verified public testing hostname

Use **https://testing.d3m0nbox.online** on45.63.51.163. The owner confirmed the old installer domain belongs to161.118.161.131; it is left untouched. Caddy trusted HTTPS and the updated public UI are verified. Synthetic optional-action and dense-history tests pass on the new public assets. Log in with this VPS's existing administrator account and generate fresh commands so delivery/tracking URLs use the testing origin. Previously issued encrypted artifacts retain their original URLs and were not rewritten. See TESTING-DOMAIN.md for preservation/certificate evidence. No DNS write was necessary.

Final refreshed ZIP clean-extraction test suite:199 tests/36 files, TypeScript and production build pass. The exact supplied batch is protected from Git newline conversion using a binary/exact-byte attribute; its SHA-256 remains unchanged.
