# Private setup commands — Win11Desk v3 (v2 retained)

## Using the new command

Open **New installer**, choose the configured deployment profile, set Windows credentials/RDP/label and optional Get files/Run attached script choices, then Generate and Copy. Paste the resulting private Bash block into **root SSH on the intended Linux VPS**.

The block downloads first-party **`setup/v3.sh`**, checks its pinned SHA-256, then passes one private installation ticket and the independently issued installer digest to that setup through standard input. Setup retrieves the exact saved encrypted installer over HTTPS, validates it and runs the existing automatic installation workflow. It does not read the current profile's newly edited values.

**Pasting starts the existing disk-erasing installation and automatic reboot.** Generate/Copy by themselves do not connect to a VPS or install an OS.

## What is not in the copied block

The new block omits command/profile UUIDs and profile revision, Windows username/password, ISO link, RDP configuration, browser/file selections, attached batch contents and the installer engine. It carries only the public setup address/origin, a private per-command ticket and non-secret integrity hashes.

The generic public setup contains transport and integrity checks only. Account administration, credential-vault keys and control-plane implementation remain on the dashboard host. A valid ticket retrieves a credential-bearing installer, so **the entire copied command is private**. Do not publish it or paste it in support chats.

This is protection against casual exposure and anonymous access—not protection from root on the executing VPS. Root can capture the downloaded installer and inspect settings/code it must execute. Temporary cleanup does not guarantee forensic erasure, and shell history can retain the private copied ticket.

## Configuration and compatibility

The issued OS/profile/media/credentials/options and full artifact remain immutable. Editing a profile or changing a file catalog after issuance does not change that command. New commands use v3; previously issued v2/v1/legacy commands retain their original format, artifact and allowed delivery behavior. Viewing/retrieving or idempotently replaying a command does not rotate its ticket.

The ticket retains the current **30-minute delivery window** and revocation behavior. It is not consumed by the first HTTP request: download retries and authorized use on multiple VPSs remain possible while valid. Each VPS execution still registers independently in deployment history. Download expiry is not evidence of a failed running Windows install.

Existing full media/hash/preflight checks, local Windows-ready proof, compact history, Awaiting update semantics and separate optional-file/startup-script outcomes are not replaced by this transport change. The exact uploaded Chrome is unchanged; the current generator corrects tracker-shaped run-ID validation and downloads files before long script execution. See CHROME-CLEAN-COMMAND-FIX.md.

## Failure handling

Both download stages use bounded attempts/timeouts, normal TLS/certificate checks, private temporary paths and fresh files. Neither a failed download nor an old `setup.sh` in the working directory is executed. An empty/partial/error response or hash mismatch stops before installer execution. The private ticket travels in the request body, not a URL, downloader argument or environment variable.

If delivery is unavailable, first check whether the command is expired/revoked and the dashboard is reachable. If an integrity check fails, do not disable it. Obtain a new valid command after investigating the deployment. A failed pre-boot delivery is different from a VPS already in an installer: **do not blindly reinstall or rerun a destructive command on a partially installed target**.

No global DNS rewrite, TLS bypass, unchecked latest binary or new crypto-verifier dependency is added. The existing unique delivery-hash index and encrypted secret envelopes are reused, so this feature needs no new key or schema migration.

## Verification boundary

Release evidence will distinguish harmless Bash transport/mock-interpreter and isolated SQL/API/UI checks from a real Windows installation. This change does not execute installers, batch files or Windows programs on an actual target VPS. New provider/OS/media and licensing-script behavior cannot be certified by transport-only tests.

## Verified local release — 2026-10-14

The testing-domain command measures **12 lines /1,841 bytes**. Both generic setup and delivered artifact are pinned before execution. Frozen setup SHA-256: `b29b8dc8d5ab31acebe074bd60d6e6f84c5d15e5dfbe24c47263cd2fe1cf04d5`.

Compiler/build,234 unit tests,12 v2 isolated API checks plus retained ready-OS/optional-files/security/core suites and private-command/dense-history UI regressions pass. The download-cap review finding is corrected: both wget subprocesses have an enforced file-size bound and core dumps disabled.6MiB mock responses stop at or below4MiB and never run a sentinel. Required initial-host tools are Bash/core utilities and curl or compatible wget with timeout; missing prerequisites stop rather than bypass integrity checks. No real OS/batch/EXE execution is claimed.

## Verified app-only rollout

Deployed on **https://testing.d3m0nbox.online**. The public v2 setup matches the frozen SHA-256; retained v1 also matches its unchanged hash. HTTPS health passes; anonymous profile/history APIs remain401. An encrypted pre-update backup and root-only source rollback copy were retained. Existing delivery-secret hashes/ciphertexts, accounts, command artifacts/Windows credentials, run IDs, profiles, settings/presets, audit IDs and.env remain unchanged:1 account,5 commands and5 runs before/after. Database/proxy were not restarted and no installation target was accessed.

The actual source ZIP installed, typechecked, passed all234 tests and built successfully in a fresh extraction. Generate a **new command** to use v2; existing commands retain their issued version/settings/expiry. A copied ticket remains sensitive, and root can inspect downloaded code: this reduces visible configuration and implementation, not provides root-proof copy protection. No fresh Windows installation test has been performed for this transport-only change.

Deployed private-command and compact-history browser checks also passed with synthetic fixtures; no production login/data writes.

## Current v3 and missing-file repair

New testing-domain commands are8 lines/1,230 bytes,33% shorter than the earlier v2 format. The setup/artifact hash checks remain. Actual TTY spinner, failed-but-complete transfers and private bounded logs were exercised; Windows readiness is confirmed separately by the existing callbacks, never by an animation. v2 evidence above is historical; v1/v2 bytes and exact issued-command replay are retained. The repaired optional helper accepts existing tracker-shaped run IDs and bounds licensing-service readiness for the script action only, after selected files. A files-only recovery helper is available for an already installed VPS without rerunning MAS or reinstalling Windows. No real Windows target execution is claimed.
