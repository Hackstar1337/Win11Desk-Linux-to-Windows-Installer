# Win11Desk Version 2 — install directly through the portal

## What changes

New installer now offers **Manual command** and **Install via SSH**. Manual commands remain available and use the same pinned v3 setup. SSH mode sends that configuration-bound command to the selected Linux VPS; it does not add SSH keys or install a remote management agent.

The deployment remains self-hosted with MySQL, the web app, a separate durable **remote-worker**, and the existing HTTPS proxy. The application does not wait inside an HTTP request for Windows installation to complete.

## Install via SSH

1. Sign in as **Owner or Admin**. Choose New installer → Install via SSH.
2. Select a ready Deployment profile. Set the **Windows** username/password, RDP port, label and optional desktop files/attached-script controls. These Windows credentials are separate from the VPS's current Linux SSH password.
3. Enter the VPS's literal **public IP**, SSH port and current root password. This release supports password-authenticated `root`, not arbitrary users/sudo, private networks, hostnames or key authentication.
4. Click Discover host. Compare the displayed **SHA256 SSH host fingerprint** with the VPS provider console or your independently known fingerprint. Approve that displayed identity; the portal never turns off verification.
5. Test connection. This step is read-only: it checks root, supported x86_64 VM, RAM/CPU, the plain root-system whole disk, serial when available, boot mode, detached runner availability and HTTPS reachability. No installer is sent here. The submitted SSH password is cleared from the form even if the request fails.
6. Create installation review. Inspect the exact IP/port, fingerprint, hostname, disk/size/serial, profile revision, Windows username/RDP port and selected optional actions. Password values and ISO URLs are not shown. Changes invalidate the review.
7. Confirm backup/disposable target plus provider recovery access, and complete whole-disk erasure/reboot consent. Click **Install and reboot** to enqueue that exact review.
8. Watch **Remote installations** for queue/transport state, then Deployment history for the real installation callback, elapsed time, Windows evidence and separate optional-file/script reports.

The final click authorizes destruction of the displayed target's system disk. Do not select a VPS containing data you still need.

## No SSH keys added

Only the password is passed to the SSH client in server memory; no `sshpass -p` shell invocation is used. The application does not edit `authorized_keys`, `sshd_config`, Linux passwords or persistent SSH accounts. Host fingerprints are stored in the **dashboard database** for verification, not installed onto the VPS.

The target receives protected `/root/win11desk-remote/<job-id>/` staging files, a receipt, a supervisor and a restricted log. A systemd transient unit is used when available; otherwise a detached setsid/nohup supervisor is used. The private bootstrap is streamed through SSH stdin, not embedded in the remote command argv, and removed after the child exits. A target-wide dispatch lock prevents a second IP/port alias from blindly launching another install. These are installation artifacts, not SSH-access changes; normal OS reinstallation replaces the Linux system.

## Durable safety and status

| State | Meaning |
| --- | --- |
| Queued | Approved job is waiting. Cancellation is available only before dispatch. |
| Connecting / Checking | Worker is authenticating to the pinned key and rechecking the displayed host/disk. |
| Sending / Launching | Immutable command issuance and target staging/handoff are in progress. |
| Handed off | Target supervisor acknowledged starting. This **does not prove Windows is ready**. |
| Blocked / Connection failed | Preflight, identity, credential, queue-expiry or launch failure needs attention. |
| Launch uncertain | The worker lost acknowledgment or restarted near dispatch. It will **not automatically rerun** the destructive install. |

For Launch uncertain, re-enter the current SSH password and use **read-only reconciliation**. It reads the receipt only; it never reinstalls. If the VPS has already rebooted into Alpine/Windows and no Linux SSH receipt is accessible, use the deployment tracker/provider console. Never infer success or failure from SSH disconnection alone.

Same-review repeat clicks reuse one idempotent job. A different review cannot reuse its key. Unresolved jobs and handoffs without terminal installation evidence retain the target lock. A new install requires a freshly checked/reviewed target; there is no retry button that reuses a destructive grant. A target-wide Linux dispatch marker also intentionally prevents an automatic second launch on the same surviving Linux filesystem.

## Storage and privacy

- Short-lived SSH and pending Windows settings are encrypted using the existing vault and scoped associated-data labels. No plaintext credentials are saved in job/check/review tables.
- Check validity is 15 minutes; review validity is 5 minutes; queue deadline is 10 minutes. Temporary job envelopes are expired/cleared by worker maintenance and cleared on cancellation, known pre-dispatch failure and acknowledged/uncertain handoff.
- Safe job events contain phase/error codes, not raw SSH output, installer script, tickets or passwords. Remote staged files/logs are root-only. Administrators of the target still have access to its own installation files; this is not a guarantee of source secrecy against root.
- Owner/Admin permissions and existing session/CSRF checks are enforced server-side. Operator/Viewer accounts cannot dispatch remote installation or inspect remote credentials.
- The worker serializes remote dispatches; Windows installations already handed off continue independently on their VPSs. No synthetic test or preview starts a real worker automatically.

## Standalone operations

Use the supplied normal deployment workflow (`deploy/start.sh`). It applies additive migrations before starting Compose services. `remote-worker` needs the same database/vault configuration and outbound SSH/HTTPS access; it has no publicly exposed listener. The web app and worker run non-root in read-only containers with dropped capabilities. Existing database/proxy volumes remain unchanged.

`REMOTE_INSTALL_ENABLED=1` enables this feature in standalone Compose; `REMOTE_INSTALL_ENABLED=0` disables new remote dispatch. `REMOTE_BLOCKED_IPS` can list additional excluded IPs. Dashboard-origin DNS addresses, local/private/reserved/metadata ranges are always excluded. Supported targets must satisfy current engine preflight (at least two CPUs, approximately 4 GB RAM and 64 GB disk, plain whole-system disk and supported VM environment); unsupported containers/LVM/ambiguous roots fail closed rather than guessing.

Remote worker health and queue/uncertain counts appear in Operations. If it is unavailable, queued jobs are not dispatched; fix worker connectivity before issuing new approvals. Do not scale workers indiscriminately; leases and target guards protect queue ownership, but the target remains destructive infrastructure.

## Verification boundary

Validation uses a real **loopback SSH server with synthetic credentials**, mocked disk/host utilities and harmless child scripts, isolated MySQL/HTTP acceptance and synthetic desktop/mobile browser data. It covers host-key change before authentication, exact punctuation passwords, timeouts/output limits/nonzero remote exits, bootstrap stdin privacy, run-once target markers, duplicate approvals, leases/restart uncertainty, encrypted envelope round-trip/cleanup, pinned issuance and old-command compatibility.

**No new external VPS was erased, rebooted or installed while developing Version 2.** No Windows target outcome or zero-error guarantee is claimed. Use a separately approved disposable target for the first end-to-end destructive rollout.

## Verified testing-domain rollout — October14,2026

The app and new remote-worker are deployed on the existing testing host. Trusted HTTPS health, anonymous401 protection, additive remote migration, live worker heartbeat, exact supplied Chrome/MAS bytes and current v3 setup digest passed. Root-only encrypted SQL/config backup and source rollback copies were retained. Existing1 account,8 commands and8 runs remain; account hashes, command/artifact/credential ciphertext, delivery grants, profiles, settings, presets, audit IDs and `.env` are preserved. Database/proxy were not restarted. Clean extracted ZIP install, TypeScript,289 tests/50 files and app/worker build passed. Final public browser/asset checks are recorded after completion; no external target installation is implied by this app rollout.

Deployed synthetic browser checks also passed for the Version2 target/trust/review/job workflow and existing dense history/clipboard/timers, full1667/1920px workspace and mobile containment. Public v1/v2/v3 setup digests remain unchanged; the exact Chrome attachment was verified within the deployed image. No production admin login, synthetic production-data write or remote OS target dispatch was used for these checks.

Final public verification passed: exact downloaded ChromeSetup.exe SHA-256, all retained v1/v2/v3 setup SHA-256 values, trusted HTTPS health, anonymous remote config/health/jobs401 responses and Version2 frontend bundle. The source package includes this guide and the approved no-SSH-key plan. The first real portal-triggered destructive Windows test remains a separate disposable-target approval, not part of these mock/read-only checks.
