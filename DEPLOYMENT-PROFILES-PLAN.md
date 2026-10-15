# Win11Desk deployment profiles — implementation plan

## What the feature will do

Create a reusable deployment profile, choose its operating system and set its direct download link once. When generating an installation command, select the profile, enter the target Windows credentials and generate the command. The issued command retains the exact profile configuration it was created with, and its executions appear in the existing compact deployment history.

Profiles describe what to install. Deployment history records where that installation ran and what happened. They remain separate navigation sections.

## Reference findings and scope decision

TinyInstaller’s `/deployments` page is a searchable catalog of OS profiles, with separate profile details. Its custom-profile documentation describes a name, a custom image URL or base profile, and an optional post-deployment command. Its custom images are RAW or QEMU-supported virtual disk formats, not ordinary Windows installation ISOs. [1] [2] [3]

Win11Desk currently has a real Windows 11 Pro ISO installer. Its configuration schema requires Windows 11 Pro, its script selects that image, and its Windows-ready callback checks Professional edition/build 22000+. Existing presets save non-secret installer fields but are not a versioned OS/media catalog and do not provide historical profile attribution.

**Scope resolved:** user approved broad OS expansion with administrator-supplied ISO links. Implement32 catalog selections: ten RDP-capable Windows11 client editions, matching ten Windows10 editions, and Standard/Datacenter licensed/evaluation Desktop Experience selections for Server2019/2022/2025. Exclude Home, Server Core and Linux arbitrary ISO workflows. New adapters have exact image and edition/build/installation-type gates, but remain not end-to-end VPS certified.

Preserve the tested Windows11Pro default. Profiles may be saved without a source as Needs ISO URL; no command can issue until a source is configured. No new target installation is authorized by catalog creation.

## Profile creation and management

Add **Deployment profiles** to the authenticated navigation at `/profiles`, separate from `/deployments` history. Use the existing full-width navy/cyan workspace, compact searchable profile rows and a clear create/edit form; no pricing, fake deployment counters or borrowed compatibility claims.

A profile contains:

- Required descriptive name and supported operating-system selection.
- Optional direct HTTPS ISO download URL; blank profiles remain unconfigured/nondeployable, with the existing approved URL prefilled only for a new Windows11Pro profile. Each custom profile has its own source; no mirror or alternate-source fallback.
- Read-only media type and x64 architecture derived from the selected adapter, rather than letting an ISO be mistaken for a RAW disk image.
- Optional description and non-secret defaults: Windows username, RDP port and retry count.
- Active/archived state, Created/Updated timestamps, stable ID and revision number.

Passwords, SSH credentials, delivery capabilities and tracker tokens are never saved in profiles. The user enters Windows passwords at issuance; existing unique-password batch behavior remains available. No arbitrary post-install commands in this release: they are not part of the requested feature and would require additional execution and completion semantics.

Provide Create, Edit, Duplicate, Use profile and Archive/Restore. Duplicate makes an independent profile. Archive removes it from new selections but preserves its details and historical links. Archiving never deletes deployment records, revokes previously issued commands or changes any VPS. Permanent deletion can be omitted in favor of archive, avoiding broken references.

Search by name, OS or description. Profile details show configuration, revision, timestamps and real usage counts derived from issued commands/runs. Zero usage remains zero; no external provider-compatibility claims are invented.

## Installer selection workflow

1. Create a profile and save its OS/download URL.
2. Click **Use profile**, or choose it in the New installer form.
3. Show the selected profile, OS, source and revision clearly. Apply its username/port/retry defaults once without overwriting a password.
4. Enter username/password and optional command label or batch settings.
5. Generate an immutable installer command through the existing authenticated API.
6. Paste the generated command into the intended root SSH terminal. The website does not execute an installation merely by selecting or saving a profile.
7. Follow the existing history progress, Windows-ready evidence and RDP actions.

While a profile is selected, its OS and media URL are authoritative. To use a different media link, edit/duplicate the profile or select the existing Custom configuration mode. Do not retain a profile label while silently issuing from an unrelated manually changed source.

`/installer?p=<profile-id>` preselects an authorized profile. Missing, archived or unavailable selections show a clear message instead of silently substituting the global default. Existing `/installer` custom behavior remains usable. Existing presets remain available as non-secret convenience settings; they must not silently override selected profile media.

## Command snapshots and deployment history

The server, not only the browser, resolves and validates the selected profile ID/revision when issuing. Unsupported adapters, invalid sources or stale revisions are rejected before creating a command. A stale-profile response asks the user to reload and review the changed source; it does not silently issue a different revision.

Persist a command-to-profile snapshot containing profile ID, name, revision, OS, media type and exact selected source/defaults. Keep the existing encrypted immutable installer artifact and Windows credential vault unchanged. Editing a profile only changes future commands. Existing commands and their ciphertext/hash/settings stay unchanged.

Include profile attribution in Commands, deployment Details and history filtering. Preserve the recently corrected compact RDP table; show a short profile label inline with Created/label rather than adding another wide column. Provide `/deployments?p=<profile-id>` and a Profile filter for grouping all executions of that profile. Custom and old commands are honestly labeled Custom/Legacy unless actual linkage exists. Do not relabel old commands by guessing from matching URLs.

Expose profile metadata only to authenticated roles that can read profiles/history. CSV exports may include profile name/OS/revision, but never passwords or capability tokens. Archived profile links still explain the historical snapshot.

## Persistent storage and module structure

Continue independent MySQL on the authorized dashboard VPS. Add a new migration, not edits that depend on rerunning already-applied schema files.

- `shared/deploymentProfiles.ts`: strict profile input/output types, OS adapter registry, direct-source validation and non-secret snapshot rules.
- `server/control/profiles.ts`: authenticated CRUD, revision checks, profile resolution and usage metadata. Reuse existing settings/read/write permissions, CSRF and secret-free audit.
- `server/control/profiles-schema.sql`: additive `wc_profiles` and `wc_command_profiles` tables with scope/revision/indexes. A separate command link table avoids rewriting old command ciphertext/config rows.
- `scripts/migrate.ts`: register the new migration under a unique name; use existing migration lock/journal. Repeat startup preserves user-edited profiles.
- `server/control/admin.ts`: resolve selected profile before issuance, include profile snapshot in issuance idempotency, attach linkage, add profile-filtered command/history queries and metadata responses.
- `client/src/pages/control/ProfilesPage.tsx`: catalog, create/edit and detail UI using existing controls. Split components if needed rather than expanding the existing large page module.
- `client/src/pages/control/ControlPages.tsx`: installer selection and compact history attribution/filter integration.
- `client/src/App.tsx`, sidebar and route manifest: add `/profiles`, `/profiles/:id` and new navigation without changing existing history URLs.
- Existing packager, Dockerfile and backup/restore: include new sources/migration; new MySQL tables participate in normal logical backups.

Seed one default Windows 11 Pro profile from the workspace’s existing saved defaults on first migration only, preserving its current URL/settings. Do not overwrite user edits on subsequent startup and do not auto-convert/erase existing presets. Legacy commands/runs remain accessible without profile links.

Profile names are unique within their intended workspace scope after whitespace normalization. Revision-checked edits prevent one administrator overwriting another’s newer source. SQL queries remain parameterized and scope-aware.

## Media and failure handling

Saving a profile validates syntax and adapter/media compatibility without downloading an entire ISO or probing arbitrary URLs from the dashboard server. This avoids introducing an SSRF-capable URL checker. Do not label a saved URL as verified reachable or its OS as verified from the name alone.

Keep actual target-side HTTPS/media signature/full-integrity checks and the trusted default checksum. Custom Windows ISO sources retain the existing full pre-staging fingerprint and final consistency checks. Profiles must not lower checks, bypass wrong-edition failure, invent percentages, or add another default mirror.

If a link expires, returns HTML/quota content or provides the wrong image, the normal installer reports the actual failure. Edit the profile and issue a new command for a future authorized run; never mutate/restart an already executing installer from the profile page.

Database migration failure must stop the new feature cleanly rather than reset data. Source backup and compatible additive tables support app rollback; old app behavior continues to ignore new profile tables. No destructive down-migration.

## Delivery stages

**Stage 1 — Profile foundation:** OS scope resolution, schema/types, durable CRUD, default seed, catalog/details and revision/permission controls.

**Stage 2 — Real issuance integration:** selector/deep link, authoritative server resolution, immutable snapshots, custom-mode compatibility and existing preset/batch integration.

**Stage 3 — History and operations:** profile attribution/filtering, archive/restore, real usage counts and password-free exports without disturbing compact row alignment.

**Stage 4 — Validation and release:** unit and isolated MySQL/HTTP checks, synthetic UI workflow, typecheck/build and one focused read-only implementation review. Exercise profile edit-versus-command immutability, stale revision rejection, archived selection, invalid media, roles/CSRF, grouping, old-command compatibility and repeated migration. Do not test by installing an OS on a real target.

**Stage 5 — Authorized dashboard update:** take source/database backup using existing protected tooling, deploy additive migration/app on the already-authorized dashboard host, preserve `.env`, account hashes, issued artifact/credential ciphertext and run IDs, verify trusted HTTPS and private access, then regenerate/verify the standalone ZIP. Database/proxy and installer target disks are not recreated or erased. Additional OS end-to-end certification, if requested, requires separately identified disposable targets and exact installation authorization.

Proceed continuously through the selected scope; do not add routine intermediate approval pauses. OS scope is resolved. Pause only for actual permission/approval gates or a material product choice not covered by the request.

## References

[1]: https://tinyinstaller.top/deployments?p= "TinyInstaller deployment-profile catalog"
[2]: https://docs.tinyinstaller.top/custom-profiles/add-profile.html "TinyInstaller Add a Custom Profile"
[3]: https://docs.tinyinstaller.top/custom-profiles/host-image.html "TinyInstaller Host an Image"
