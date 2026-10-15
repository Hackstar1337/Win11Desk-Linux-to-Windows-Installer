# Win11Desk Control Center — Enhanced Product and Implementation Plan

**Revision 4 · 13 October 2026 · Proposed, not implemented · Independent VPS production target**

This revision replaces the earlier managed-production and Manus-login proposals. **The complete project will be deployable independently on your own Linux VPS: frontend, backend, custom email/password authentication, database, credential vault, installer delivery, tracking, audit and backups.** It must not require a Manus project, login, database, API key, storage service or Preview URL to remain operational after migration. The existing workspace is used only to develop and transition the current code/data; it is not the final production hosting architecture.

The goal is a private Windows 11 Pro deployment control center: generate a script, paste it into root SSH, and see the actual VPS, configured connection credentials and progress in one central history. The admin console must explain what happened, what can be done next and what remains unknown—not merely show a progress card or a password list.

## 1. Product decisions and boundaries

**The core experience:** sign in → configure Windows → generate private command → paste into VPS → watch history automatically → copy connection details when Windows reports ready.

The dashboard owns configurations, issued commands, saved Windows credentials, history, permissions and troubleshooting. The VPS installer owns disk replacement, boot preparation, media download and Windows setup. HTTPS callbacks connect the two. The dashboard does not gain ongoing remote control over a machine just because it generated a script.

We will retain Windows 11 Pro only, automatic target detection, RDP port 22 by default, the direct ISO and all existing source/media checks. No Drive source, website ISO mirror, automatic alternate source, billing system, other OS catalogue or public registration is introduced.

**Two passwords have different jobs.** Your admin account password signs you into the website and is stored as a salted password hash. The Windows deployment password is the credential installed on the target; it must be encrypted reversibly because you want Reveal/Copy later. These are never interchangeable, and the admin login password must not become the default Windows password.

**Admin control is explicit, not unlimited remote authority.** Revoking an unused command prevents future server delivery. Archiving a row hides it from normal lists. Neither action stops or removes a running Windows installation. Editing a stored credential does not change the remote password. A future remote-management agent or SSH integration would be a separate project phase.

This document is the full implementation proposal. Application code, accounts, permissions, secrets, schema, hosting and VPSs are unchanged during planning.

## 2. What changes from the current website

Today the main generator is public. Tracking groups have no account ownership. Passwords exist in generated command settings but are not durably retrievable from tracking records. A tracker requires a separate private link, and its single update timestamp mixes heartbeat with stage progression.

The new console will make generation private, bind each issued script to an authenticated account, store an encrypted credential snapshot, and connect each reported execution to it. The history page will query owned records directly rather than depend on browser-local links. A stage-event timeline will show real transitions, while a separate heartbeat timestamp tells us whether the reporter remains reachable.

The existing React/Express/tRPC/Drizzle/MySQL project is suitable for this extension. The current screenshot records Windows Professional/build 26300 and local RDP readiness for its completed run. We preserve that evidence, without labeling it external authentication or ongoing uptime proof.

## 3. Information architecture and navigation

**Public utility routes** will be limited to `/login`, protected first-owner setup, invitation acceptance, recovery, static assets and narrowly scoped capability endpoints used by VPS scripts. No public installer form or open sign-up.

**Authenticated workspace routes:**

- `/admin` — Overview and current activity.
- `/admin/installer` — New Windows configuration and command generation.
- `/admin/commands` — Generated, unused, active, expired and revoked commands.
- `/admin/deployments` — Actual executions, including installing, completed, failed and stale.
- `/admin/deployments/:id` — Execution evidence, timeline and connection details.
- `/admin/presets` — Reusable non-secret configuration templates.
- `/admin/settings` — Defaults, source integrity, access and operational preferences.
- `/admin/users` — Explicitly invited administrators and roles.
- `/admin/activity` — Security/admin activity audit.
- `/admin/account` — Your profile, password, MFA, recovery codes and sessions.

The existing `/track/:id` remains an optional progress-only sharing view. The root `/` redirects a logged-in administrator to Overview; everyone else sees the login entry. After login, the header shows the account display name and role instead of Sign in. Only safe in-app return routes are accepted.

Use five main navigation items initially: Overview, Installer, Deployments, Commands and Settings. Presets, Users, Activity and Account fit into secondary navigation so the console does not become crowded. Each item may exist only when the user's permissions allow it, but hiding it never substitutes for backend authorization.

## 4. Standalone admin account system

### 4.1 First-owner setup

There will be no hardcoded default account, no shared default password and no public “first person becomes admin” route. Configure a random one-time bootstrap secret through protected deployment configuration. The owner opens `/setup`, supplies that secret, chooses an email, display name and password, and completes account creation.

The server stores only the bootstrap-secret fingerprint needed to validate it, applies throttling, and creates the owner atomically with a unique bootstrap marker. Concurrent setup requests cannot create multiple owners. Setup becomes unavailable once the owner exists, including after a process restart. A deployment variable left present cannot reopen it. Reopening owner setup would require an explicit administrator recovery procedure, not a hidden web bypass.

The owner password is entered into the HTTPS application form or protected setup—not committed into files, displayed in tool output or reused from a VPS. Initial email is a login identifier until ownership has actually been verified; we do not claim email verification when there is no email-delivery integration.

### 4.2 Login and password storage

Email/password login uses normalized email identifiers and preserves password characters without silent trimming or truncation. The form permits password-manager autofill, paste, keyboard navigation and Show/Hide. Default policy: at least 15 characters, maximum 128 characters, with a common-password blocklist. This is a product choice grounded in current OWASP password guidance, not a claim that length alone guarantees safety. [3]

Hash account passwords using **Argon2id**, unique salts and versioned parameters; begin with a proposed 64 MiB, 3 passes, parallelism 1, then benchmark on the actual runtime. Do not use SHA-256 alone, plaintext or reversible encryption for website login passwords. Bound concurrent hash work so login requests cannot exhaust memory. OWASP's published Argon2id minimum is 19 MiB, 2 iterations and parallelism 1; settings must remain at least that strong if tuning is needed. [1]

Unknown account, wrong password and disabled account return a generic login failure. Perform equivalent dummy hash work for missing accounts where practical. Add account/IP throttling with progressive cooldown and bounded global concurrency. Proposed initial limits: five failed account attempts per 15 minutes and twenty per client IP per 15 minutes, configurable after observing legitimate usage. Do not permanently lock the owner due only to anonymous failed requests. Durable counters must work across application restarts/instances; no in-memory-only protection.

### 4.3 Sessions and logout

Use random opaque 32-byte session secrets and store only their digests in the database. A custom cookie such as `win11desk_admin_session` is distinct from all platform cookies. Manus OAuth cookies, JWTs or `manus-cookie` browser values are ignored by the custom admin authorization path.

Sessions are revocable server-side. Rotate the token after login and privilege elevation; invalidate sessions after reset, password/security changes or user disablement. Proposed limits: 30-minute inactivity timeout, eight-hour absolute expiry and a five-minute step-up authorization window for highly sensitive actions. Dashboard polling must not count as human activity and silently keep a session alive forever. Account sessions list browser label, created/last interaction/expiry and revoke controls, without displaying secrets. [2]

Use HttpOnly/Secure cookies. Embedded public HTTPS Preview needs `SameSite=None; Secure` with explicit CSRF protection; standalone production can use a stricter setting if embedding is not required. Browser third-party-cookie blocking is handled with a clear **Open in a standalone tab** option, not a insecure localStorage session or development login bypass. API requests receive 401 for expired authentication; the UI clears revealed secrets and returns to login while preserving only non-secret drafts.

### 4.4 CSRF and application authorization

A server-issued CSRF token bound to the custom session protects authenticated mutations. Validate permitted public origins deliberately; do not infer them from internal proxy Host headers or trust a client-supplied origin to choose callback destinations. Cookies alone, a custom header alone or SameSite alone are not the complete authorization scheme.

Every protected API checks account active state, session validity, role and workspace ownership. A logged-in viewer cannot call generation or credential routes by manually constructing a request. Mutations use allowlisted fields to prevent overwriting owner IDs, roles or audit metadata.

### 4.5 MFA and sensitive actions

Include authenticator-app TOTP in the account/security stage. Enrollment uses a temporary encrypted secret, requires a valid code before activation and shows one-time recovery codes. Store recovery-code hashes; each code is consumed atomically. Bound challenge attempts and reject reuse of accepted time steps within the allowed clock window. Do not use MFA QR images or recovery codes in logs/screenshots.

Initial development may demonstrate password-only login. **Before production, the owner must finish MFA enrollment.** Role changes, permanent deletion, vault key changes, MFA disablement and recovery-setting changes require recent password/MFA step-up. Credential reveal and secret-bearing command regeneration require a recent authenticated session, with stricter step-up configurable for shared/admin accounts.

### 4.6 Recovery without pretending an email service exists

Provide a clear recovery route, but implement delivery honestly. There is currently no selected transactional email service. Until one is configured, owner recovery uses an offline one-time owner recovery code created at setup/security enrollment, plus the approved recovery procedure. That code is shown once and stored hashed. It is not an ordinary public registration key.

Email-based reset can be activated after an approved delivery integration exists. Reset tokens are random, stored hashed, expire in 15 minutes, are single use, and come from a trusted configured application origin. Responses do not disclose whether an email exists. Reset revokes existing sessions and other pending reset grants and requires normal login afterward; passwords never go in email. [4]

Changing an email address uses recent authentication and proof of the new address when mail verification is available. When email delivery is absent, owner-admin-managed changes are explicitly marked unverified. No security questions, editable request-body owner identity or “forgot password returns reset token” shortcut.

## 5. Owner, administrator, operator and viewer permissions

Build authorization against explicit capabilities so future role changes do not require rewriting every route.

**Owner:** all workspace operations, invitations, role changes, vault/security configuration and confirmed deletion. There is exactly one bootstrap owner; ownership transfer is a separate confirmed operation. Cannot accidentally disable or remove the last owner.

**Administrator:** generation, all deployment metadata, notes/archive, defaults, credential reveal and scoped command revoke; cannot transfer ownership, expose the vault master key or erase security evidence. Delegated sensitive abilities can be disabled by the owner.

**Operator:** generate allowed configurations, view assigned/team deployments, copy permitted connection details, add notes and regenerate from non-secret presets. Credential reveal is a separate permission, not implied merely by seeing history. Cannot change user roles/global source/key settings.

**Viewer:** read authorized history, status and timeline only. No commands, credential reveal, settings mutations or export of sensitive data.

Start with owner-only access, then enable invitations/roles during the admin-controls stage. Invitations are one-time, time-limited and explicit about role/scope. Accepting an invite creates an account, never escalates a role requested by the browser. Access changes revoke affected sessions promptly.

All records belong to one workspace in this release. Do not equate creator identity with permission to see all workspaces if multi-workspace support is added later. The server stores actor IDs and owner/workspace bindings and checks both.

## 6. New installation page — detailed behavior

Keep the compact form: Windows username, password, RDP port, direct ISO link, Generate and optional retry/extras disclosure. Add an optional deployment label, provider label and tags. These labels are for organization, not a hidden provider API integration.

Support **fresh random password generation** in the browser and editable manual passwords. Never silently use your website admin password. Non-secret presets can remember username/RDP/source/retries; they do not retain a password unless you deliberately clone a credential-bearing configuration with permission and a warning.

After Generate succeeds, show an immutable configuration summary, the private command, delivery expiry, generated-command record ID and **View in history**. Any edit to username/password/port/source invalidates the visible old command and requires generation again. Copy/download actions are available only for the current configuration snapshot.

The command starts installation automatically on the intended root SSH target. Beside Generate/Copy keep one short consequence: **“Pasting this command erases the detected VPS system disk and reboots automatically.”** Do not reintroduce the removed checkbox clutter or terminal questions. Read-only preflight remains a separate optional tool, not an automatic-install prompt.

Do not automatically contact a VPS from this page. A user copying a command does not prove it ran. Until execution registers, status stays **Generated — not started**.

## 7. Issued command lifecycle and immutable artifacts

Separate the generated command from each execution. This is necessary for the same command running on several VPSs and for unused commands that never run.

**Command states:** Issued → expired or revoked, with independent execution-count/last-use metadata. “Used” is not a terminal state because multi-VPS use is supported. A 30-minute initial delivery validity remains the default. Time-limited extensions issue a new record; do not alter the original snapshot invisibly.

**Each command saves:** authenticated creator/workspace, display label/tags, exact non-secret configuration, credential-vault reference, issued version, source/ISO checksum, exact installer digest, encrypted immutable script artifact, hashed retrieval capability, created/delivery-expiry/revoked timestamps and related tracking group.

The current stateless envelope holds its own decryption key. That is not proof of admin issuance. New v2 delivery validates a server-created command record and capability; arbitrary user-created envelopes cannot obtain executable installer code through the new protected workflow. A request body never establishes the owner.

Store the exact issued script encrypted rather than reconstruct it with whatever generator code is installed later. This prevents a website update between Generate and Paste from changing its script hash. Bootstrap sends its opaque retrieval capability through HTTPS POST/header, not a password or URL query. Verify its expected digest before running. Store only the capability fingerprint; raw capabilities exist in the returned sensitive command.

Creation of configuration, credential, group and artifact is transactional. A failed commit returns no usable command. Retrying a browser generation request with the same idempotency key returns its existing result safely, rather than making duplicate records; returned capabilities require appropriate secure artifact design, not regeneration that changes identity.

Revocation stops future retrieval and new execution registrations. A script already downloaded cannot be remotely recalled. A running execution keeps scoped reporting authority so its real outcome can arrive. Permission changes stop future command operations, not the target's disk writes.

Protect all generator alternatives: the current `/api/installer/page-command`, `/reusable-command` and legacy `/commands` must require the new permission or be retired. Plain password-free alternate download helpers must not remain an anonymous route around the private installer. Existing capability callbacks may continue for already-running old scripts, without exposing admin history or credentials.

## 8. Execution registration and automatic history

On each invocation, the script generates an execution nonce and keeps it stable for registration retries. It reports group/command reference, actual hostname, detected disk, RDP port, public IP and optional explicitly supplied target label. The server validates the scoped registration capability and creates a single execution for that nonce. A retry after a lost HTTP response returns the original execution grant instead of creating duplicates; store any recoverable response grant encrypted or use a verified client-provided run secret with an appropriate hash binding.

The **reported IP appears when the script registers**. There is no IP to show while an unused command sits in the list. Report source and observed client address can differ under NAT; record the distinction if necessary. Do not treat a browser-request IP as the future VPS. Validate IPv4/IPv6 and display **Not reported** instead of guessing.

The execution joins its immutable configuration to show Windows username, masked credential, RDP and source. Credentials do not need to travel in callbacks. Running the same command on five VPSs produces five independent executions, normally with the same configured password; offer a clear option to generate separate commands with unique passwords instead. Do not claim the installer can invent a different password and have history know it without a defined reporting/credential protocol.

A warning identifies another active execution for the same reported IP/disk. It does not silently cancel or combine attempts. Reinstalling a VPS creates a new attempt; IP reuse does not replace the previous record or prove it is the same machine. Provider name is manual/unverified metadata unless a provider API integration is added later.

Public tracker registration requires issued capability, not an admin browser cookie, so unattended execution still works. Registration failure stops before boot staging; later callback delivery retries are bounded and do not invent success.

## 9. Precise progress model, time and download reporting

Use separate fields for `generatedAt`, `registeredAt`, `installationStartedAt`, `stageChangedAt`, `lastHeartbeatAt`, `lastEventAt`, `finishedAt` and server-received timestamp. Time is persisted in UTC and displayed locally; monotonic timers in the UI are derived from server baselines.

**Execution stages:** starting, preflight passed, boot staging, rebooting, temporary installer booted, media checking/downloading, media verified, Windows/driver preparation, Windows Setup handoff, Windows boot reported and local RDP ready. Preserve compatibility with current stage enums; new versioned fields distinguish full integrity scanning from final ISO download instead of pretending they are the same progress.

Use two independent dimensions:

1. **Outcome:** pending, installing, completed or reported failure.
2. **Freshness:** current contact, delayed contact, stale/unknown or no ongoing monitor after completion.

A completed install remains completed after its one-time reporter stops. Heartbeats never advance its stage or resurrect a failed attempt. Missing callbacks for more than three minutes show stale/unknown. Reboot naturally creates a reporting gap; do not make “rebooting for 180 seconds” an automatic error. Show why fresh/stale changed and when the last real stage event happened.

The visible timer starts at actual execution/start, not at script generation. It freezes at terminal outcome. A stale running attempt can show elapsed time with an explicit unknown status; that timer is not proof of active disk work.

**Overall progress is a step rail, not a fake percentage.** Add exact byte count/speed/percentage only from trustworthy downloader metrics for a specific download. Include the operation label and phase: verifying source, downloading installation ISO, processing Windows image or reboot. Never infer completed download from the sparse file's reserved size. If a downloader offers no reliable counters, show indeterminate progress. ETA is optional and labeled an estimate based on recent observed transfer, not a promised completion time.

Keep callback frequency controlled: lightweight heartbeat every 15 seconds during long operations; phase/download telemetry no faster than approximately once per 10–15 seconds; stage events when actual stages change. Do not flood the database with a timeline entry for every heartbeat.

## 10. Durable stage timeline and truthful completion

Append sanitized, versioned events with event ID/sequence, phase, safe code, proof fields and client/server times. Capability checks and state transitions run transactionally. Repeated event IDs are idempotent; older out-of-order stages cannot regress a newer stage. Terminal attempts reject new progress except allowed duplicate terminal reports.

Keep the current evidence requirement: Windows Professional with a valid Windows 11 build and a local RDP listener. Add separate outcome evidence badges: **Installer callback verified**, **Local RDP listening**, **External login not tested** and **Desktop not inspected**. Do not promote external verification based on a checkbox. A later actual authorized RDP test may add evidence including timestamp and method.

Treat callback evidence as client-reported technical observations, not proof against a compromised client holding its own reporter capability. That capability cannot reveal passwords, alter defaults or edit other executions.

Optional progress-only tracking link remains available from detail/history, but admin history never requires opening it. Link sharing is deliberate, has an expiry, omits credentials and can be revoked independently of an ongoing reporter. Read tokens remain in URL fragments and requests use protected headers. Long-term admin history must not disappear when the seven-day tracker namespace expires.

## 11. Central history interface

The history page prioritizes IP/hostname, username, masked password action, RDP, **Created date and time**, label/provider, phase/outcome, elapsed duration and last contact. Created is a visible sortable field, not hidden only in details. Deployment Created means its first accepted execution registration; the Commands page separately shows command Generated date. Columns can expand into metadata without rendering every full script in the list.

Search by IP, hostname, username, label, command ID or execution ID. Filter by outcome/freshness, date, source version, creator, provider/tags and archived state. Server-side pagination and deterministic ordering keep it usable as history grows. Distinguish **Commands awaiting execution** from real deployments rather than mixing them into an inflated installing count.

Show active, completed, failed and stale counts for the filtered authorized scope. Refresh visible active records every five seconds while open; pause unnecessary polling when hidden and refetch on focus. Two tabs sharing a session must not keep each other logged in through passive polling. The backend records callbacks regardless of whether a page is open.

Click an execution for full detail. Allow quick **Copy IP**, **Copy RDP address**, **Reveal/Copy password**, **Open timeline**, **Open optional tracker** and **Download RDP file**. The `.rdp` file contains address/port and optionally username; it never contains a password. Do not call a browser button “Connect automatically” unless it actually launches a supported native client.

Empty state explains what to do. Network errors show the last received snapshot and its age rather than resetting records to failed. Session expiry clears secrets and returns to login. Pagination/filter changes do not expose records outside role scope.

## 12. Credential vault and connection helpers

Each generated Windows credential is an AES-256-GCM encrypted vault record, bound through authenticated associated data to workspace, generation ID and credential version. Use a dedicated 32-byte protected vault key and unique nonce per encryption. Store cipher/IV/tag/key ID only. The server cannot safely recover these credentials if the vault key is lost; protect its backup separately from database exports.

Password hashing is appropriate for admin login, while reversible encrypted storage is necessary for the explicitly requested external Windows credentials. The distinction follows OWASP's hashing-versus-encryption guidance. [1]

History queries return `credentialAvailable`, not plaintext. Reveal and Copy use the same separate permission-checked API, `private, no-store` responses and audit event. Auto-hide after 30 seconds, blur/navigation/logout and tab visibility change. Passwords remain absent from browser drafts, analytics, exception logs, tracker pages, metadata CSV, invitation/reset emails and RDP files. Clipboard may retain a copied password on the user's PC; the page explains this rather than promising universal clipboard erasure.

Owner can disable reveal for roles, require step-up and purge a selected vault record with confirmation. Purge makes historical password unavailable but does not change the Windows machine. Updating a stored password is marked **Recorded credential update — remote change not performed**; it is not advertised as password rotation.

Credential keys are versioned. A controlled rotation encrypts new records with the active key and migrates old records after verified decryption, with old keys preserved until migration is complete. No key-reset button that silently makes all saved credentials unreadable. Wrong/missing key yields a clear vault-readiness problem; generation requiring saved credentials fails before returning a command.

## 13. Defaults, presets and bulk workflow

Preserve the direct source:

`(no preset ISO URL)`

Configured expected SHA-256:

`bd4307df32bc8af33b39ccecb1174aeb345386630f89a2b86c7a4e36b55ea650`

Global defaults are server-persisted and revisioned. Admin changes require an explicit save, proper permissions and an audit record. A settings version conflict asks the user to reload/reconcile instead of overwriting another administrator's change. The advanced source editor makes hash changes deliberate; normal installer UI does not show unwanted checksum clutter. Custom sources retain current fingerprint behavior, clearly distinct from an independently verified authenticity digest.

Presets save non-secret label, username strategy, RDP, direct source and retry choices. Password defaults are never populated from the admin account. A unique-per-command random Windows password option reduces accidental shared credentials. Metadata records whether a credential came from manual input/random generation/cloned secret, without logging the password.

Support batch preparation later in this release as **generate N independent commands**, not “install N servers remotely.” Proposed bound: 1–20 commands per batch with labels and optional known target notes. Unique passwords are the default for independent batch commands. Batch export is sensitive if it contains runnable bearer commands; it requires permission and a clear warning. No plaintext-password CSV by default.

A single reusable command can still execute on multiple compatible VPSs during its validity window; this is a different feature from unique-password batch commands. The Commands page makes the difference visible.

## 14. Full admin controls that have real effects

**Archive/unarchive:** reversible list organization; does not delete telemetry, vault records or target machines. **Notes/tags:** timestamped metadata edits and safe text rendering. **Revoke unused command:** blocks delivery/registration with its limited scope stated. **Generate fresh attempt:** opens the installer with non-secret settings or permitted credential reuse; never automatically wipes the same IP.

**Settings/access:** enable/disable permitted roles, change global defaults, enforce MFA/reveal policy and manage private tracker sharing. Role/access changes require confirmation when they alter who can read credentials; disabled accounts lose sessions. Preserve the last owner.

**Export:** default CSV/JSON metadata without passwords, tokens, encrypted-command keys or raw scripts. Neutralize spreadsheet formula prefixes on CSV fields to avoid executing hostile labels. An optional encrypted workspace backup can include encrypted vault rows; its key is not embedded into the same backup.

**Delete old RDP records:** core functionality, not a deferred idea. Selected eligible completed/failed records can move to Trash, be restored, or be permanently removed with explicit confirmation. Delete includes a date/status/IP/count preview, role checks, recent authentication and server-side concurrency checks. Running or merely stale/unknown installs cannot be silently purged. Shared command/vault dependencies are handled per Section 26 so deleting one VPS row cannot erase other VPS credentials. This deletes website records, not the actual Windows VPS. Audit retention is independent and policy-driven; database administrators still have authority over their database, so this is not advertised as tamper-proof evidence.

**Do not implement fake remote buttons:** Cancel running install, restart Windows, remote password reset, destroy VPS or remote cleanup are absent until an authenticated remote/provider mechanism and approval flow exists.

## 15. Failure codes, support and next actions

Add bounded safe codes to the reporter protocol: unsupported virtualization, ambiguous disk, insufficient RAM/storage, Secure Boot incompatibility, source fetch failure, non-ISO content, ISO checksum mismatch, boot-stage failure, driver/preparation failure, callback transport unavailable and Windows proof mismatch. Map codes to explanatory text and a relevant next action.

For **source/ISO errors**, show the selected source, failed phase and digest error; advise obtaining the intended media, not disabling checks. The previous Google quota failure stays historical diagnosis; the current default no longer uses it. For **stale reboot**, advise checking provider console/temporary SSH rather than claim failure. For **RDP readiness mismatch**, distinguish an SSH banner/wrong OS from a Windows client protocol issue; don't weaken security or claim graphics problems without evidence.

Do not store whole installer logs in the database by default because they can contain URLs, credentials and tokens. Provide a short sanitized diagnostic summary and documented provider-console commands. A downloadable support bundle contains redacted IDs/version/phase/error/time only. Redaction happens before storage/export, not after a raw-secret dump is recorded.

Command not started, command expired, registration rejected, installation failure and monitoring failure are distinct. A monitoring outage does not prove the target failed, and a successful downloader doesn't prove Windows booted.

## 16. In-app notifications and service health

Overview shows active work, recent outcomes and unread completion/failure notices. Browser-open notifications are part of this release; persist notification state/read markers. Toasts never reveal passwords. Optional native browser notifications require user permission and contain labels/status only, not secret details.

Transactional email/webhook alerts require a separately selected integration and protected credentials. No working email recovery or external alert claim until delivery is tested. A future webhook signs payloads, uses controlled destinations and excludes passwords/tokens.

The readiness panel separates frontend available, database connected, vault configured, account initialized, callback service available, source URL configured and current application version. Public health exposes only a minimal success/not-ready signal; detailed errors are admin-only. Source link checks are deliberate read-only actions, not constant 9 GB downloads.

Show callback age and version drift. Existing scripts continue their pinned artifact, while new scripts use the saved release version. A version update does not rewrite old command digests or old evidence.

## 17. Storage and persistence choice

**Build the whole app for independent VPS operation, with durable self-hosted MySQL storage.** Existing managed MySQL remains a transitional data source while the standalone code/package is developed; final production connects only to your own compatible pinned MySQL 8 database. Migrate schema and desired historical data deliberately. Accounts, sessions, commands, encrypted credentials, timelines, created dates and settings must survive website restarts, container replacement and VPS reboot. Moving the website must not require rebuilding your account or deleting history.

For the future VPS deployment, use a dedicated persistent host directory mounted into the MySQL container, outside the application image and release directory. Store database data under a planned `/srv/win11desk/data/mysql` directory, not in disposable container memory, source code or browser local storage. Use a named/configured mount, explicit permissions and version-pinned database image. Upgrading the app does not replace that directory. Database consistency/backup procedures, not copying live raw files, protect the contents.

The standalone app reads the database connection and trusted public origin from runtime configuration. It must not require Manus OAuth, platform secrets or temporary Preview addresses after migration. Custom admin sessions, account hashes and encrypted vault data remain application-owned. Preserve the exact vault key/key versions securely during migration; a database export without its independent key backup cannot recover Windows passwords. Human-readable metadata exports remain available, but text files are not the primary account/credential store.

Prepare a portable production package containing the Node application, frontend, pinned installer source, migrations, reverse-proxy configuration, Docker Compose deployment definition, environment example containing names only, and backup/restore instructions. Database listens only on the private container network; public access is HTTPS through the proxy. No MySQL port is exposed publicly. A separate Linux VPS hosts the dashboard and is never an installation target.

Backups include a consistent database export encrypted at rest, schema/version metadata and separately protected vault-key recovery material. Proposed future retention is seven daily and four weekly backup sets with at least one off-host destination; exact destination/schedule activation is confirmed at deployment. Test restore before declaring migration complete. Local backups alone do not survive host loss. Sections 25 and 26 define the migration, created-date and delete behavior in detail.

Proposed durable entities are `adminAccounts`, `adminSessions`, `authChallenges`, `recoveryGrants`, `rolePermissions`, `workspaceSettings`, `configurationPresets`, `commandGenerations`, `credentialVault`, linked tracking groups/runs, `deploymentEvents`, `auditEvents` and notifications. Exact table names can remain consistent with the existing code. Use unique normalized account email, generation references, execution idempotency keys and practical workspace/status/date indexes. A narrow schema should support actual flows rather than speculative tables that have no implementation.

## 18. API and module design

Use separate custom admin-auth modules rather than adapting Manus identity claims into a fake account. Remove active platform auth/config/header/service dependencies from the standalone application; merely moving the current Dockerfile onto a VPS is insufficient. Keep React/Express/tRPC/Drizzle where useful, since these libraries are not platform hosting dependencies. Proposed modules:

- `server/adminAuth/`: accounts, password hashing, bootstrap, sessions, MFA, recovery and authorization.
- `server/admin/`: command issuance, history query/detail, vault actions, presets/settings, invitations and audit.
- `shared/admin/`: validated request/response types, permissions and non-secret list DTOs.
- `client/src/pages/admin/` and `AdminLayout`: workspace UI, role guards and account routes.
- Existing `shared/installer*`, `server/installTracking.ts` and source vendor modules: retained with versioned optional callback extensions.

Authentication routes include login/me/logout, setup, step-up, session revoke, password change, MFA and recovery. Admin routes include paginated commands/deployments, generation, detail/events, reveal, notes/archive, defaults/presets and audit. VPS routes remain capability-protected script delivery and register/event/heartbeat endpoints. Sources/licenses may stay publicly readable because they're not command or credential access.

All DTOs specify allowed fields; generic record serializers must never leak vault ciphertext/master keys/session hashes or plaintext passwords. Error codes are stable and bounded. Security headers prevent referrer leaks; sensitive responses use no-store and private caching. Limit JSON sizes for each route instead of applying the existing 50 MB parser as the only protection for tiny auth requests.

Validate callback destinations against the trusted configured app origin; never allow the browser to choose an arbitrary host to receive installer callbacks. Validate user-supplied source URLs and don't build a server-side arbitrary URL proxy. WebSocket/SSE can be considered later; five-second paginated polling is the initial low-complexity design.

## 19. Legacy records and upgrade safety

Old tracking groups are unowned. Do not let the first custom account automatically view every old row or recover a password that never existed in storage. Provide an owner-only **Import existing tracker** action requiring its valid private read capability. Import claims metadata/history for the workspace in a transaction, audits the operation and prevents claiming another owner's group.

Legacy password status is **Not saved for this attempt**. The owner may explicitly record a supplied Windows credential as manual historical metadata; mark its basis and remote verification status. Do not mine logs, guess credentials from current defaults or equate username with authentication success.

Already-running scripts keep scoped callbacks after the custom login release. New generation must be protected immediately when the access stage is enabled. Existing issued v1 delivery receives a clearly bounded compatibility window, or is explicitly invalidated after notice—never leave unlimited public generation as an invisible bypass. Record which endpoints serve legacy behavior and remove that exception once the window closes.

Migration is additive, versioned and applied once. Shared development/production MySQL means testing is not a throwaway production copy. Use isolated synthetic accounts/runs, delete only their specifically known IDs and preserve actual deployment evidence. Rollback restores code but must not assume a schema rollback can destroy new history or vault records.

## 20. Design specification and daily usability

Evolve the existing navy/cyan technical-minimalist theme into a scan-first operations workspace. A narrow sidebar and full-width table/detail canvas are more useful than oversized dashboard cards. Use the current four-pane wordmark, cyan interactive accents, Inter UI and JetBrains Mono for IPs, ports, IDs and commands.

Overview contains compact genuine counters, active operations and recent outcomes, with **New installation** as the clear primary action. History is dense but readable; default rows do not expose a password, long script or six paragraphs of warning. A right-side detail drawer or route reveals the timeline. Sensitive fields use an intentional Reveal/Copy control and short auto-hide affordance.

Green means Windows proof completed, red explicit failure and amber missing contact. Labels/icons accompany color. The stage rail shows actual reported steps; stage duration is nearby. Status changes must not bounce rows unexpectedly while someone is copying credentials. Use 120–180 ms focus/drawer transitions, reduced-motion support, keyboard focus and accessible labels.

On mobile, use stacked rows with IP/status/elapsed/connection actions, keeping reveal behind the same permissions. Preserve contrast, 44px primary touch targets and usable keyboard forms. Show the signed-in account name in navigation, with profile/security and logout accessible everywhere.

Brand voice is direct and operational: **“All deployments. One control center.”**, **“Waiting for the script to run.”**, **“No recent callback. Check the provider console.”** Never show “Installed” while only media has downloaded.

## 21. Release scope, stages and evidence gates

### Stage 1 — Custom account foundation

Implement a platform-independent runtime/config baseline, custom owner bootstrap, email/password login, secure revocable sessions, CSRF/throttling, logged-out/access-denied states and admin navigation. Gate every command-generation alternative. Existing progress-only callback capabilities remain compatible. Remove active Manus OAuth/SDK/current platform-config loading and platform-cookie fallback from the admin path. No Manus auth may grant a custom session.

**Stage result:** the owner can set up, login, reach a protected workspace and logout with only application-owned runtime configuration; anonymous/platform-auth-only requests cannot generate scripts or read history. Restart does not erase account/session state. Develop against the existing database only as a transition and test the standalone connection path without requiring Manus-specific variables. A security/account setup input is needed here; no VPS credentials are required. Stop and show the stage result before continuing.

### Stage 2 — Issued command records and credential vault

Provision the independent vault key securely; implement immutable issued artifacts, hashed delivery capabilities, encrypted Windows passwords, owned groups, global defaults and non-secret presets. Generation and expiry/revocation become real server-side records. Command digest remains stable across generator updates. Separate database/configuration access from platform helpers so the same code can later run with self-hosted MySQL; persist immutable creation timestamps and migration versions.

**Stage result:** Generate creates an owned issued record and masked recoverable credential; Reveal/Copy is separately authorized/audited; no valid vault key means no unsafe plaintext fallback. Test expiry, revoked delivery, unauthorized access, wrong-key behavior and atomic generation. No live disk changes.

### Stage 3 — Automatic live history and durable timeline

Link registrations to commands, add idempotent execution creation, separate timings, sanitized error/events and history/detail queries. Implement search/filter/pagination, summary counts, visible sortable Created date/time, live elapsed duration and optional tracker. Existing real evidence survives expiration and migration. Date filtering distinguishes execution creation from command generation, completion and recent update.

**Stage result:** two synthetic VPS executions under one command appear independently with IP/username/credential/RDP and truthful live stages, without opening tracker links. Duplicate registration does not inflate history; heartbeat/stale/completion behavior works after restart. Test terminal/out-of-order/event replay semantics without touching real disks.

### Stage 4 — Security and administrator operations

Add MFA/recovery codes, profile/password/session management, role invitation/scope, step-up actions, audit, tags/notes/archive/export, **old-RDP record Delete/Trash/Restore/Permanent delete**, and safe RDP helpers. Add readiness and in-app notifications. Import authorized legacy tracker metadata and mark unsaved legacy credentials correctly. Implement selection previews and shared credential/artifact dependency checks; no target-server delete action.

**Stage result:** demonstrate owner/admin/operator/viewer isolation, revoked sessions, password reset/recovery, MFA flow, CSV secret/formula protection, record Trash/Restore/Purge and audit metadata redaction. Verify deleting one of multiple same-command executions preserves the others' passwords/history; running/stale-only targets are not purged. Do not claim email delivery until configured and tested. Sensitive access changes follow explicit confirmation.

### Stage 5 — Real progress instrumentation and usability polish

Instrument supported download operations for actual phase bytes/speed, bounded telemetry and clear errors; add batch command preparation/unique-password option if the earlier single flow is stable. Polish responsive tables/drawers, empty/error/session states and duplicate-active-target warnings. Run the full integrated read-only review.

**Stage result:** real metrics are not simulated, optional unavailable metrics are indeterminate, batch artifacts have independent ownership/credentials and UI never promises remote cancellation. Production gate requires owner MFA and durable service/key configuration.

### Stage 6 — Approved target test and permanent release

Choose a fresh disposable Linux VPS, run current read-only preflight, present exact target/settings/disk and get erasure/reboot approval. Test a new custom-admin-generated artifact, execution appearing automatically, media/driver stages, Windows proof and authorized external RDP login. Preserve evidence and inspect first-login state without silently choosing privacy settings.

Deploy the entire application on the separately authorized Linux dashboard VPS under Sections 25 and 27. The dashboard must not be hosted on the VPS it erases. Deliver the portable source/release plus Docker Compose/proxy/migration/backup package, rehearse a database-plus-key restore, migrate the same account/history/created dates, verify reboot/container replacement persistence and resolve callback-domain continuity before cutover. Use the dashboard's stable HTTPS domain for final generated-command testing so no temporary Preview origin is in the production artifact. No managed-platform Publish is the final release mechanism. VPS provisioning, public exposure, DNS, firewall and security changes require their actual approval boundaries.

**Stage result:** save the tested release, give the correct live/Preview URL and real remaining limits. Do not label every possible VPS provider certified from a single success. Stop at each stage for review and **proceed** unless you explicitly authorize the whole staged build in one go.

## 22. Verification strategy and operating targets

Each stage has one focused read-only implementation review plus relevant type/unit/integration/build checks, not repeated destructive install tests. Security tests cover anonymous requests, wrong role, wrong workspace, expired/revoked sessions, CSRF, forged delivery envelopes, event replay, vault misuse, token leakage and protected endpoint enumeration.

Default operational targets: five-second visible dashboard refresh; a separate three-minute stale threshold; bounded fifteen-second heartbeats; generation delivery thirty minutes; optional tracker read seven days; custom admin idle thirty minutes/absolute eight hours; one active versioned owner bootstrap; no secret-bearing list/export responses. These are explicit initial defaults, not guarantees of service latency or installation duration.

Performance checks exercise paginated synthetic history and concurrent callbacks before selecting more infrastructure. Proposed first load target is comfortable handling of thousands of stored records through indexed pagination, without promising measured timings until benchmarked. Data is durable in MySQL; process memory is cache only.

The release checklist includes backup/key recovery, account recovery, last-owner safety, schema compatibility, callback trusted origin, no open generator routes, no default credentials, dependency review and no secrets in Git/output. Changes to scope/hosting/security assumptions update this document before implementation.

## 23. Decisions needed, assumptions and exclusions

**Chosen by you:** standalone email/password app login, more complete planning, Windows 11 Pro only, automatic install, saved IP/Windows username/password in central history, live progress without separate tracker and optional deeper tracking.

**Recommended defaults in this revision:** the entire app self-hosted on your Linux VPS; custom auth and self-hosted MySQL; current workspace/database for development/transition only; single owner first and invited roles later; salted Argon2id login hashes; encrypted Windows vault; private no-open-registration console; TOTP before production; visible sortable Created date; old-RDP record trash/restore/permanent deletion; metadata-only export; no automatic purging by default; direct source unchanged.

**Protected setup needed during build:** owner account creation bootstrap, actual owner email/password entered securely, vault key and recovery material. **Optional external input:** transactional email integration for email recovery/alerts. **Release input:** permanent dashboard host/domain and a disposable target with exact test approval. These are not questions about whether existing user-supplied checksum verification is valid.

Out of this release: payment plans, public customers, additional OSs, remote SSH/RDP fleet agent, provider provisioning/destruction, automatic remote password rotation, guaranteed continuous uptime monitoring and unattended delete/restore of targets. Do not build unused ecommerce/profile sections merely because a generic auth template includes them.

## 24. What happens after approval

Approve Revision 4 to begin **Stage 1: standalone runtime foundation, custom owner setup and email/password login**, with no Manus runtime/login dependency in the final app. We will configure secure bootstrap access, implement and verify the protected shell/generator boundary, save that stage, show the result and wait for the next-stage instruction. The later deployment vault/history will follow the same concrete contracts above rather than be improvised after the UI is built. This revision makes independent hosting of the whole project, persistent VPS data, visible created dates and old-RDP record deletion core requirements. Actual host/domain access is needed at deployment, not guessed from a previously disposable Windows target.

## 25. Persistent VPS deployment, backup and migration contract

### 25.1 Components and host layout

The future dashboard host is a dedicated Linux VPS with persistent disk. Proposed portable stack: reverse proxy with HTTPS, Node application container and compatible pinned MySQL 8 container. The app and database restart automatically after a host reboot. Health checks and bounded startup retries distinguish a database-not-ready state from an application crash. The app uses a least-privilege database user; migrations/backups use separately controlled authority where needed.

Planned paths, to be finalized after inspecting the selected host:

- `/opt/win11desk/` — versioned release and Docker Compose/proxy configuration, not the database.
- `/srv/win11desk/data/mysql/` — database persistent mount outside replaceable app images.
- `/srv/win11desk/backups/` — encrypted consistent backup sets with safe permissions.
- `/srv/win11desk/proxy/` — persistent certificate/proxy state if the chosen proxy requires it.
- `/etc/win11desk/` — runtime secrets/key files with restrictive host permissions, never publicly served or committed.

Bind the internal application/database on private interfaces/networks; expose HTTPS and only separately authorized management SSH. Restrict database access, log secrets never, and use log rotation/disk-space alerts so telemetry cannot fill the host. The deploy package documents that `docker compose down -v`, deletion of the data directory or provider rebuild can destroy data; a normal app release never performs those operations.

The database contains accounts, password hashes, session digests, encrypted vault/artifacts, presets/defaults, generation/execution links, immutable dates, timeline and admin activity. Browser storage is non-secret convenience only. No operation depends on an in-process map surviving a restart. ISO content stays at the user's configured direct host; this is not an ISO-mirror storage plan.

### 25.2 Backup and restore

Provide a consistent logical SQL export plus schema migration version, application version and manifest/checksums. Encrypt backup sets and place at least one copy off-host. Back up all required vault-key versions separately under controlled access; database ciphertext without those keys is not recoverable. Back up proxy/runtime configuration with secrets handled deliberately, not copied into a public ZIP.

Recommended future schedule is daily backups with seven daily/four weekly retained sets. It is a proposal, not an active schedule; confirm the destination and retention at VPS deployment and use host-native automation. Initial proposed recovery-point target is up to 24 hours with daily-only backups, not guaranteed zero data loss. Require a successful isolated restore rehearsal before marking Backup ready; verify login, sample credential decryption, created dates and ownership/event joins. Do not promise a restoration time until tested.

Physical VPS disk persistence is not protection from deletion, corruption or host loss. Keep backup status/age visible to admins and restore documentation outside the same host. Backup/key restore is restricted; do not expose arbitrary restore upload as an unauthenticated API.

### 25.3 Managed-to-VPS cutover

1. Select the dashboard VPS/domain and inspect its capacity, filesystem and existing workloads under authorized read-only access. Obtain approval for provisioning/configuration changes separately.
2. Prepare the standalone app with no application-login dependency on Manus OAuth or managed runtime endpoints. Preserve database schema semantics, timestamps, row IDs and key versions.
3. Export via an actually available SQL-client/application path; do not assume a managed point-in-time/full-export API. If a proposed export command lacks privileges, use a tested compatible application export or request the required authority rather than inventing access.
4. Rehearse restore into the private new database, verify row counts/link integrity, decrypt a test credential with the separately provisioned key and confirm custom login works. Do not run two uncontrolled writable masters.
5. Choose a quiet cutover window without active target installs where practical. Pause generation/admin writes, drain callbacks or maintain a controlled forwarding path, perform the final consistent export/import and verify again. A simple read-only snapshot while callbacks continue is not a lossless migration.
6. Set the stable public origin/HTTPS and issue new commands pointing to it. **Existing commands contain the old origin:** history import alone cannot change them. Retain an available old-origin forwarding route where authorized, or invalidate unused old commands and wait for active runs to finish. Temporary Preview cannot be promised indefinitely; do not rely on a permanent redirect to rescue every HTTPS POST/capability request.
7. Verify live callbacks and history on the new host, then reboot/recreate only the app container to prove persistent accounts/history/key access survive. Remove old write access only after validation and a defined rollback checkpoint.

Rollbacks preserve new writes: after the new host accepts production callbacks, do not simply restore an earlier old database and lose them. Quiesce or reconcile the authoritative dataset before any switch back. No migration, DNS change or service restart occurs merely because this plan is approved.

## 26. Created dates and old-RDP record deletion

### 26.1 Dates displayed everywhere they matter

Each history row visibly shows **Created date and time**, meaning first accepted execution registration. Command rows show **Generated date and time**. Detail shows both, plus actual installation start, finished time and latest callback. Use an unambiguous local date/time format with timezone context; export UTC ISO timestamps. Relative age is optional alongside, not a replacement for the actual created date.

Created timestamps are immutable: heartbeat, edit, password recording, migration, archive and restore do not reset them. Sort ascending/descending by Created; date filters use a declared user timezone converted to UTC on the server. Legacy imported rows preserve their existing creation time and add a separate Imported date. Missing historical installation-start proof is shown as unknown, not set equal to import time.

### 26.2 Delete means delete a website record

The user's old “RDP” is represented as a deployment/connection-history record. A Delete action removes that record from the console according to this lifecycle. **It does not uninstall Windows, delete the provider VPS, stop RDP, revoke the actual Windows password or remove an RDP file already downloaded on the user's PC.** Button/confirmation text states that distinction.

Actions are **Archive**, **Move to Trash**, **Restore** and **Delete permanently**. Trash is accessible to authorized administrators. Moving to Trash hides the record from normal results and changes its deleted metadata; it does not alter immutable created/completed dates. Restore returns the same record and links, not a new execution. Suggested restore window is 30 days, with no scheduled auto-purge enabled by default; records remain restorable until actually purged. An opt-in automatic retention cleanup requires a separate configured/approved policy, never an unannounced timer.

### 26.3 Single and bulk deletion workflow

Select eligible completed/failed records, or filter **Created before a chosen date** and explicitly select records. Bulk selection has a bounded count and is not silently “all records on every page.” Preview shows exact count, affected IP/label/created date/status, credential consequences and whether any command/grant remains shared. A confirmation applies only to the selected IDs and versions.

Server-side permission and state checks run again in a transaction so a row that became active after preview is not purged. Operators/viewers cannot delete without the explicit permission. Owner or permitted administrator can Move to Trash; irreversible purge requires recent step-up and clear confirmation. Active or merely stale/unknown executions are excluded from permanent purge; an explicit terminal failure or completed outcome is required. They can be archived without pretending their disk activity stopped.

Purge removes that execution's stored connection metadata, event timeline, notes and direct secret associations; it invalidates its progress-view/report access where applicable so future callbacks cannot recreate a deleted record. Keep only the minimal non-secret tombstone needed to reject retries and a policy-scoped audit entry (actor, ID, time, action); do not keep the password/IP secretly in a purge audit message. The data-retention description tells the user which minimal audit/tombstone remains.

### 26.4 Shared secrets, commands and trackers

One generated command can have several VPS executions. Therefore deleting one execution must never delete the shared credential needed by another execution or revoke a whole shared tracker group by accident. Credential/artifact cleanup is reference-aware. Keep shared items while another retained execution or usable generation needs them; show **Shared configuration remains for other deployments** in the preview. If the user wants all copies of that credential purged, preview every affected reference and require explicit broader confirmation.

For an otherwise unreferenced generation, credential/artifact cleanup also requires revoking future delivery/registration first. Deleting an old execution while its command remains usable does not silently erase that command or prevent a genuinely new attempt; new executions receive new IDs. Existing callbacks with the purged execution's capability are rejected/ignored according to the documented protocol rather than reinserted. Restoring a trashed row can preserve existing read capability within its original validity, but purge cannot resurrect expired tokens.

Deletion applies to live application storage; encrypted retained backups may contain an older copy until their retention period ends. Restoration must honor recorded deletion/tombstone policy and must not silently republish purged credentials. Do not promise immediate physical erasure from all historical backups or cryptographic erasure of a single row while a workspace/shared key remains in use. State this beside the purge confirmation and backup policy.

### 26.5 Required behavior evidence

Stage 3 verifies visible Created dates, sorting/timezone filters and immutable timestamps after callbacks/edits/import. Stage 4 verifies Trash/Restore/Purge, single/bulk preview permissions, terminal-state concurrency checks, deletion retry/tombstone behavior, original dates after restore and a multi-VPS shared-command example. Stage 6 verifies those records/dates/deletions persist across future dashboard-VPS reboot and backup/restore rehearsal. Tests use specifically synthetic IDs, never mass-delete actual installed-VPS history.

## 27. Whole-project independence and self-hosted release contract

### 27.1 Final traffic and service architecture

Your browser and target VPS scripts connect to **your dashboard domain**, whose HTTPS reverse proxy forwards to your application. The application authenticates custom admin accounts, serves the built frontend, issues/verifies scripts, processes tracking callbacks and reads/writes your private database. Nothing goes through a Manus gateway in production. The direct ISO download remains a separate user-controlled source, not the dashboard database/storage server.

Recommended initial runtime: one Linux dashboard VPS, Docker Compose, Caddy reverse proxy for domain HTTPS, Node 22 application and a specifically pinned compatible MySQL 8 release. Container/app processes run with restricted privileges where supported. No Docker socket is mounted into the web application. OS package/security updates and off-host backup policy remain host operations, not a website button that claims to patch the machine remotely.

Start capacity planning at approximately 2 vCPU, 4 GB RAM and 40 GB durable disk for the dashboard/database, then verify the selected host and workload before commitment. This is a provisional sizing recommendation, not measured capacity or a purchase request; this server does not download/store the 9 GB ISO by default. Argon2 concurrency, MySQL buffer limits, telemetry retention and backup space must be bounded. No Redis/queue/Kubernetes requirement is introduced for the initial fleet console.

### 27.2 Remove or replace current dependencies

The current source inspection found active platform-config loading in `client/index.html`, platform-cookie fallback in `client/src/main.tsx` and command components, OAuth registration in `server/_core/index.ts`, platform SDK/environment dependencies and owner notification routes. The existing Dockerfile only builds the current source; it does **not** make those dependencies independent.

The standalone release will replace those pieces with application-owned configuration, custom session context and internal notifications. It will not load `/api/platform/config.js`, read `manus-cookie`, invoke Manus login or accept `webdev_app_session` as a custom admin account. Unused platform LLM/image/maps/storage/notification helpers are removed from the runtime dependency graph and unused public API routes rather than kept as required services. Existing source/version notices and open-source license obligations remain intact.

Self-host MySQL is the final database; the managed database is only a migration source. No MANUS API keys or managed database credentials are copied into the final environment. Do not dump the whole development environment to migrate it; enumerate necessary application variables and provision the new database/key material deliberately. Local fonts/icons/build assets must be shipped with the release where needed; platform-hosted branding assets cannot be the only way to render the app. Google Fonts can be self-hosted with applicable licensing so the login/dashboard works without a third-party font request.

The deleted ISO-mirror data is not a production dependency. Do not resurrect that implementation or migrate unused stored ISO chunks merely because they existed historically. Final installer/profile/download endpoints use your app domain and the configured direct source. Optional email delivery is an independently selected external service; if absent, offline recovery and in-app notifications function honestly.

### 27.3 Portable files and runtime configuration

Deliver complete source with lockfile, migrations, tests, vendor source/licenses and local UI assets, plus an independent production Dockerfile and `compose.yaml`. Include Caddy configuration, a secret-free `.env.example`, documented database migration/start/health commands, backup/restore utilities and installation/upgrade/rollback runbooks. A source/release archive or user-selected private Git repository is usable without fetching from a Manus-managed Git remote. Do not switch the user's repository or delete the existing project during planning.

The standalone config allowlist covers `APP_PUBLIC_URL`, allowed origins/trusted-proxy configuration, app listener port, private database connection, dedicated vault key/key versions, bootstrap-secret fingerprint or protected setup secret, cookie/embedding policy, log level and optional mail/backup destinations. Exact names are finalized in Stage 1. Secrets are provisioned at runtime, never compiled into frontend JS or baked into the image. Required configuration validation fails clearly before exposing unsafe routes.

Production defaults to a same-origin standalone HTTPS cookie/CSRF policy; current embedded Preview behavior is a development compatibility setting, not an authorization bypass. Trusted proxy hops are explicit so remote clients cannot spoof IPs, HTTPS or rate-limit identities through arbitrary forwarded headers. App APIs use relative browser URLs and configured absolute callback origin for installer scripts. Public health is minimal; detailed readiness/version/source/vault/database information is admin-only.

Migration is a deliberate one-time release step with schema locking/history; application replicas must not each run competing migrations or reset owner/defaults on startup. A healthy website does not mean a schema migration or backup succeeded. Database initialization and owner bootstrap are separate gates.

### 27.4 Installation and upgrade sequence

Prepare the independent package before actual host deployment. On an approved dedicated host: inspect existing services and SSH/firewall access, provision private directories/configuration, install the chosen container runtime only if needed, restore or initialize the private database, apply recorded migrations, provision key versions, start the app/proxy and verify readiness. Set the approved dashboard domain DNS/HTTPS only with the necessary authorization. Keep current SSH accessible until replacement management access is verified.

Then verify custom login/roles/history/credentials on the new domain, actual data survival on app-container replacement, and host reboot recovery when expressly approved. Only after the new callback origin is ready, generate the final test command and test a **different disposable Linux target** with exact erasure approval. Test completion appearing in the history automatically, timestamps, failure/status evidence and permitted RDP verification.

Updates use pinned versioned artifacts, pre-upgrade consistent backups, compatibility checks, one-time migrations and a documented code rollback. Routine app updates do not recreate the database volume, erase owner setup, regenerate the vault key or reset history. A breaking schema change has an explicit migration/rollback data plan rather than an assumption that copying an old binary fixes it. No auto-update job is enabled without its approved policy.

### 27.5 Independence evidence and handover

Before claiming self-host readiness, run the app with all Manus-specific variables absent and without relying on its gateway, API/storage hosts or temporary Preview origin. Test custom login/logout, permission isolation, source-preserving script generation/retrieval, database writes, callbacks, central history, credential reveal, Created dates, old-record Trash/Restore/Purge, reboot/container persistence and isolated backup restore. A failed required outbound platform call is a portability defect, not a reason to retain a hidden dependency.

Document exact release version, host/domain, private mount paths, how to start/stop/upgrade, where secrets are provisioned, backup destination/status and recovery steps—without embedding secret values. Hand over the deployable source/package and actual independently hosted HTTPS URL. Retain the old project/data until migration and the user's retirement decision are complete; independent hosting does not authorize deletion of the original project or changing its sharing settings.

**Stage boundaries:** Stage 1 builds the independent runtime/auth foundation; Stages 2–5 build portable data/admin/telemetry functionality; Stage 6 deploys the whole project to the approved VPS and completes migration/live testing. Current development tools may remain in the working repository as optional tooling, but the production start path, image and core workflows cannot require them.

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html "OWASP Password Storage Cheat Sheet: salted password hashing and reversible-storage distinction"
[2]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet: session lifecycle, cookie protection and revocation"
[3]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html "OWASP Authentication Cheat Sheet: password policy, login defenses and reauthentication"
[4]: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html "OWASP Forgot Password Cheat Sheet: secure recovery tokens and reset behavior"
