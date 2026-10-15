# Win11Desk Version 2 — Install directly from the portal

**Status: proposed for approval.** This turn reviews code and documentation and writes this plan only. No target VPS was contacted, no supplied credential or installation ticket was used, and no application, database, DNS or deployed container was changed.

## What Version 2 will do

Enter a target VPS IP, Linux SSH port, SSH username and SSH password in the authenticated portal. Select a ready deployment profile, set the **separate Windows username/password and RDP port**, and choose the existing Get files and Run attached script options. The portal checks the target, shows the exact disk and settings in an installation review, and starts the existing installer through SSH after **Install and reboot** is confirmed.

There is no command to copy and no terminal input required on the target. Closing the browser does not stop an accepted job. The current manual Generate/Copy workflow remains available and existing issued commands remain unchanged.

This is a control-plane upgrade, not a replacement Windows installation engine. It retains the pinned engine, media integrity checks, profile snapshots, credential vault, selected Chrome file, optional startup task, tracker callbacks and Windows-ready proof. It does not make an incompatible VPS or incorrect ISO supported.

### Password-only access — no SSH key installation

The portal authenticates using the existing Linux SSH username/password and passes the installer through that connection. It does **not** generate or upload login keys, run `ssh-copy-id`, modify `authorized_keys` or `sshd_config`, create an SSH account, or add a permanent remote-access agent. If the server does not already permit the supplied password login, report that limitation; do not change its SSH access settings automatically.

Host-key verification reads the SSH server's **existing public host key** and remembers its fingerprint on the portal side. It is an identity check, not an authentication key added to the VPS. No new host key is created or installed by this feature. The protected temporary installer/runner files described below are for launching this installation, not for granting future SSH access. The approved OS replacement will still erase the old Linux system as intended.

## Is the supplied SSH example correct?

**The basic structure is correct for a compatible Linux VPS.** `ssh ... 'bash -s'` feeds the local here-document to Bash on the remote machine. Quoting the `REMOTE_SCRIPT` delimiter keeps the local shell from expanding variables inside the installer before it reaches the target. The inner bootstrap downloads our setup, checks its digest and uses the issued ticket to retrieve the saved configuration. It is not a fresh configuration lookup.

That explains why the example can work manually. It depends on SSH reachability, correct Linux credentials, root access, required commands, a still-valid ticket, HTTPS access and a compatible disk/OS.

**Do not use the example as the portal backend unchanged:**

- `sshpass -p` puts the SSH password in a process command line. The sshpass manual identifies this as its least secure password option. The command can also be retained in shell history. [1]
- Disabling host checking and sending both known-host files to `/dev/null` means the client does not retain a trusted identity for that server. Host-key checking is designed to reject unexpected changes. [2]
- The installer is coupled to the SSH command’s lifetime. A production job needs a target-side runner that remains alive if the browser, worker or SSH channel disconnects before reboot.
- A reboot-related SSH disconnect or return code is **not proof that Windows is ready**. Conversely, a dropped connection is not automatically an installation failure.
- Repeating the whole command after an uncertain disconnect could start another destructive installation. The portal needs job identity, a target lock and reconciliation instead of blind retry.

I did not authenticate to the example address, run the here-document or retrieve its private package. If the pasted password or ticket is still live, treat it as shared sensitive information; rotate the password or revoke the ticket when practical. Neither value belongs in project documents or logs.

## Operator workflow

### 1. Enter the target and installation settings

**Target VPS** contains IP address, Linux SSH port (default 22), SSH username (default root) and a masked SSH password. **Windows installation** contains the ready profile selector, Windows username/password, Windows RDP port, label and the existing independent file/script choices. Label the two password fields clearly so they cannot be mistaken for one another.

Start with publicly routable IP addresses; hostname support and private-network access are later extensions, not hidden assumptions. Keep SSH passwords exactly as entered, including spaces and punctuation. Do not reuse or transform them into the Windows password.

### 2. Verify identity and test the connection

For a new target, perform an SSH handshake **without sending the password** to obtain its host-key fingerprint. Show it in the portal. Let the operator compare it with the provider console or supply a known fingerprint; otherwise make first-use trust explicit. First-use approval records trust, but is not independent proof of ownership. Recheck that exact key before authentication.

The **Test connection** action authenticates and runs a fixed, read-only inventory/preflight. It must not install packages, download a full ISO, edit boot entries, stage an installation or reboot. Show the Linux hostname, architecture, root privileges, virtualization, CPU/RAM, root-system disk and size, boot mode where detectable, required tool availability and target-to-dashboard HTTPS reachability.

Unknown hardware/provider information stays unknown. A successful SSH test is not labelled “Windows compatible” without the relevant preflight evidence.

### 3. Review and approve this installation

Show the target IP and SSH port, pinned fingerprint, Linux hostname, **whole disk to be erased**, disk size, profile name/revision and edition, Windows username/RDP port, optional files/script settings and the erase/reboot warning. Passwords remain masked. Include backup/disposable-target and provider-console acknowledgements in this one review, not terminal prompts.

The final **Install and reboot** action authorizes **this target and this immutable configuration**. It does not authorize future targets or a changed profile. A short-lived server-side review record binds the approved data. A changed fingerprint, target/disk identity or material setting invalidates it and requires another review.

### 4. Launch and track

Create the durable job before remote execution. A server-side worker connects over SSH, repeats the identity and preflight comparison, issues the configuration-bound installer and stages a protected job runner. The installer rechecks the approved hostname and whole disk rather than blindly using `auto` after approval. Bind disk size/serial or other available identity evidence where dependable; the IP alone is not sufficient.

After the remote runner acknowledges launch, show the job alongside its deployment history record. Follow the current callback-driven download, installation, reboot and Windows-ready stages. Show selected-file and attached-script results separately, including missing reports. No animation or SSH exit is used as Windows success evidence.

## Architecture: existing app plus one durable worker

Use the current self-hosted Docker/MySQL/Caddy stack on **testing.d3m0nbox.online**. Add a small **remote-install worker container** built from the same source/image and started with a separate entrypoint. It is not a Manus session job and does not depend on an open browser or this sandbox staying awake.

The HTTP app validates inputs, authorizes actions, records the immutable approval/job and returns promptly. MySQL stores the queue, attempts and bounded secret-free events. The worker claims jobs with transactional locks, a renewable lease and a per-target exclusion lock. Start with **one concurrent SSH preparation job**; increase only after measured tests. Targets continue their own installs after handoff, so the worker slot need not remain occupied for the entire Windows setup.

Use a maintained Node SSH client such as `ssh2`, pinned through the lockfile. Its password authentication, host verifier, timeout, keepalive and execution channels fit the existing Node stack; its default auto-accept behaviour must be overridden. [3] Do not put passwords in an `sshpass` subprocess, command arguments or shell environment variables.

Maintain a connection for the active target’s authentication, checks, staging and launch acknowledgement. Reuse it for those channels instead of reconnecting for every command. It cannot remain connected across the Linux-to-Windows reboot; tracking takes over then. Do not reconnect to a changed host key using the old Linux password.

### Target-side execution that survives an SSH interruption

Write the verified bootstrap and private input into a unique, root-owned directory with directory mode 0700 and files 0600. Transfer through SSH channels using fixed scripts and encoded/quoted data, not arbitrary user-provided shell text. The job ID supplies safe filenames and lock identifiers.

Prefer a transient **systemd service**, without attaching it to the browser/SSH file descriptors. Use a compatible `Type=exec` launch and record a root-only receipt with the job ID, launch state and safe failure code. systemd documents that a transient service runs under the service manager and can start detached; successful process creation still does not prove installer success. [4]

For supported non-systemd distributions, use a separately tested detached runner with `nohup`/`setsid`, redirected input/output and a target-local lock. If neither supported detachment path is available, stop before installation instead of silently running a fragile foreground process. Do not configure the destructive runner to automatically restart after crashes or reboots.

The target continues to download the immutable setup/artifact over HTTPS and check both pinned digests. Do not weaken TLS, remove media checks or expose configuration in a public setup script. Remote root can still inspect executable scripts and their settings; Version 2 removes the need for a copied command, not root’s ability to inspect its own machine.

## Durable jobs, configuration and restart recovery

New additive records should include:

- Target trust metadata: scoped target IP/port, host-key type/fingerprint, approving actor and timestamps. It stores no permanent SSH password by default.
- Installation review: target inventory/disk evidence, selected profile snapshot, options and encrypted credential material, revision/digest, expiry and approving actor.
- Remote job: review ID, issued command/group/run link, target identity, phase, dispatch attempt, lease, cancellation state and safe timestamps/error codes.
- Transient SSH secret: authenticated encryption bound to the workspace/job, creation/expiry and purge timestamp. Keep it separate from the existing Windows credential vault.
- Job events: bounded structured phase/error/receipt evidence without password, ticket, raw shell command or installer contents.

Refactor the current command issuance into an application service shared by the HTTP handler and worker. Do not forge browser sessions or fake an Express request inside a worker. Preserve the current immutable-artifact and idempotent replay behaviour.

Freeze the profile and options at approval. Issue the installer **once**, immediately before dispatch, from that reviewed snapshot; save its job link durably before sending anything destructive. Thus a queue delay does not consume the existing 30-minute delivery window. If a profile is disabled or permission revoked before dispatch, block the job rather than silently substituting a different OS.

Proposed initial bounds: review valid for 5 minutes; queued jobs must begin within 10 minutes; encrypted SSH secrets expire within 15 minutes unless cleared earlier. These are implementation defaults, not claims about installer duration. Delete transient secrets after verified handoff, confirmed cancellation, expiry or terminal prelaunch failure. Backups taken while secrets exist can retain encrypted copies; logical deletion does not erase old backups, process memory or remote-root artifacts. Document that retention honestly.

If the app/worker restarts, recover queued jobs from MySQL. If it crashed around remote launch, **do not send the installer again automatically**. Check the target’s job receipt/lock and existing tracking evidence using read-only operations while the short-lived credential is available. Otherwise show **Launch uncertain — review required** and allow re-entering credentials for read-only reconciliation. When disks have been replaced the original receipt may be gone; tracker evidence is then authoritative. Never promise distributed “exactly once” execution across an unacknowledged crash.

## Status and failure behaviour

Separate **remote launch status** from the existing **OS installation status**. Proposed launch states are Queued, Connecting, Checking target, Sending installer, Launching, Handed off, Connection failed, Blocked, Launch uncertain and Cancelled. Existing installation states continue independently, including **Awaiting update**, Failed and Windows Ready.

Wrong credentials or timeout stop before execution and offer a safe prelaunch retry. Host-key changes block authentication until reviewed. Missing root access, ambiguous disks, unsupported containers, incompatible architecture/resources or missing runner tools block launch with a specific explanation. Initial release requires a root SSH account; interactive sudo/MFA/keyboard challenges are not supported and are never guessed or bypassed.

The existing installer still performs full media and upstream-integrity checks. A failure there remains an installation/preparation error, not a reason to disable validation. An expected reboot disconnect changes neither a job into Failed nor a deployment into Windows Ready without evidence.

A browser refresh or repeat click uses an idempotency key and returns the same job. At most one unresolved portal job may own a target at a time. An IP reused after a provider rebuild requires host-key reapproval and an explicit new installation review; it does not inherit approval from the old machine.

**Cancel** is supported only while queued or before dispatch intent has been committed. Once remote launch is in progress, the UI explains that it cannot guarantee cancellation or undo disk erasure. No blind “Stop installation,” kill command or rollback promise is added. Failed and uncertain jobs link to the detail page and recovery-console guidance instead of offering an unconditional reinstall button.

## Credentials, permissions and network boundaries

New **remote:install** and **remote:trust** capabilities are initially owner/admin only. Operators retain the current manual command workflow; viewers cannot submit credentials or launch jobs. Expanding these permissions later must be deliberate. Recheck authorization at dispatch, use existing sessions/CSRF and audit actor, target, approval digest and safe outcome. An install review is required, but no repeated administrator-password prompt is added to ordinary form fields.

Never store SSH passwords in browser local storage, drafts, URLs, analytics or API read responses. Clear the input after submission. Encrypt queued secrets server-side and decrypt only for the worker’s connection attempt. Do not return them through the Windows-password Reveal/Copy controls. Avoid SSH debug logging and raw remote output in the browser; allowlist structured events and remove terminal control sequences. Restrict diagnostic logs, sizes and retention.

Validate IP and port as data; refuse loopback, private/link-local, metadata, multicast, unspecified and reserved destinations by default, including IPv4-mapped IPv6 bypasses. Block the dashboard host itself, its own public/private addresses and internal services. Resolve any future hostname once, validate/pin its chosen IP and recheck its SSH key. This is not a general network scanner, arbitrary command terminal or SSH tunnel endpoint. Authentication attempts and test-connection requests are bounded and rate-limited.

The worker does not need a Docker socket, host root, privileged mode or SSH access to the dashboard host. Its outbound access must reach approved target SSH ports and the normal HTTPS sources; provider firewalls may need to allow the dashboard VPS’s egress IP. Adding the worker must not publicly expose MySQL or a new worker port.

## UI and project structure

Reuse the current full-width dark control-center design and all six accent palettes. Keep dense history rows, adjacent Copy actions, consistent status/time alignment and responsive local scrolling. No decorative images or fake overall completion percentage.

**New installer** gains Manual command / Install via SSH modes. The SSH mode has compact Target VPS and Windows settings sections, then a clear read-only check result and final installation review. The existing installer choices do not change. History shows a launch-method indicator and target/job connection; failed prelaunch jobs must be visible even before a tracking run exists. Deployment detail gains a small Remote launch panel. Operations adds worker health, queue depth, oldest queued job and unresolved launches.

Proposed modules:

- `shared/remoteInstall.ts`: typed input, job states, review contracts and safe error codes.
- `server/control/remoteInstall.ts`: authenticated target/check/review/install/cancel/status APIs.
- `server/control/remoteInstall-schema.sql`: additive trust, review, job, secret and event tables.
- `server/control/commandIssuance.ts`: shared immutable issuance extracted without changing legacy output.
- `server/remoteInstall/sshClient.ts` and `preflight.ts`: host verification, fixed read-only probes and strict parsers.
- `server/remoteInstall/queue.ts`, `worker.ts`, `runner.ts` and `reconcile.ts`: durable claims/locks, startup, target staging and uncertain-launch handling.
- `client/src/components/control/remote-install/`: target fields, checks, approval review and job presentation.
- `compose.yaml`, `Dockerfile`, migration registry and deployment guides: worker entrypoint, health and safe configuration.

Use existing pages, DTO projections and metadata where sensible rather than creating another independent dashboard. Remote-install runtime capabilities must be disabled in ordinary development preview by default; tests opt in only against isolated fixtures.

## Step-by-step implementation after approval

1. **Foundation and target checks.** Add contracts, additive storage, credentials handling, host-key review and read-only SSH preflight. No destructive dispatch enabled yet.
2. **Reliable execution.** Add the durable worker, target lock/receipt, detached runner, immutable job issuance and fail-closed restart/retry handling.
3. **Portal integration.** Add final target-specific installation approval, history/detail links, cancel-before-dispatch and worker health in Operations. Keep manual installation compatible.
4. **Verification and testing-domain rollout.** Exercise password punctuation, identity changes, duplicate clicks, dropped connections, expired secrets, worker restart, missing tools, unsafe targets, cancelled jobs, detached-runner persistence and secret-free logs against mock/isolated SSH servers. Run existing artifact, UI, tracker and security regressions; validate the release ZIP from a clean extraction.
5. **Real end-to-end trial.** Only after a separately approved disposable target/disk/OS/settings, run one portal-triggered Windows install and verify Windows/RDP, the selected Chrome desktop file, optional-script outcome and tracking across reboot. This approval cannot be inferred from approval to build Version 2.

Deployment of the portal/worker remains **SSH-only to the authorized testing VPS**, with a retained connection for each deployment, encrypted backup, additive migration verification and source rollback. Preserve accounts, configuration, existing command ciphertexts/grants, profiles and deployment history. No GitHub/Vercel hosting deployment is part of this plan. Disable the new dispatch feature/worker for an app rollback; keep additive tables and do not interrupt already handed-off target installs.

**Approval requested:** implement this Version 2 plan with single-target installation first, root password authentication, explicit target identity/erase review, transient encrypted SSH credentials and a MySQL-backed worker. Bulk CSV installation, permanent saved SSH credentials, private-network agents, interactive sudo and arbitrary remote scripts are follow-up features—not prerequisites and not silently included.

## References

[1]: https://manpages.debian.org/testing/sshpass/sshpass.1.en.html "sshpass manual — password options and security considerations"
[2]: https://man.openbsd.org/ssh_config "OpenSSH client configuration — host-key checking and known-host files"
[3]: https://github.com/mscdex/ssh2 "Maintained Node SSH2 client — authentication, host verification and execution channels"
[4]: https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html "systemd-run — detached transient services and execution acknowledgement"
