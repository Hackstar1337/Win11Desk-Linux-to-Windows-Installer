# Win11Desk

Windows 11 Pro-only configuration dashboard with automatic Linux VPS installation and private progress tracking.

## ISO source configuration

No default ISO download URL is configured. Set a direct HTTPS ISO URL in Deployment profiles before issuing an installer command. The VPS downloads directly from the selected address; no mirror or alternate-source fallback is used.

## Workflow and architecture

Set username/password/RDP (default TCP22), generate an automatic script and paste it in root SSH on a compatible disposable/backed-up VPS. Pasting authorizes system-disk erasure and automatic reboot; new page scripts have no terminal confirmation questions. Generated commands are private and expire after30 minutes; regenerate after changing settings or source. No OS is installed by the webpage itself.

`server/pageInstallerDelivery.ts` seals validated settings into AES-GCM envelopes delivered by private HTTPS POST. Passwords are transiently processed, are not saved in browser drafts/tracker records, and can be recovered by anyone holding the command and its key. Source pinning and script hashes remain enforced.

`server/installTracking.ts` and `/track/:id` provide durable managed-MySQL runs with separate hashed capability access, per-execution rows and seven-day tracker expiry. Callbacks report real stages, Windows edition/build and local RDP listening. Completion persists after the bounded Windows reporter exits; it is not continuous uptime monitoring or external authentication/desktop verification. Nonterminal stale reports stay unknown. Tracker URL secrets use fragments.

## Serving and verification

Use `pnpm dev`, `pnpm check`, `pnpm test`, `pnpm build`, `pnpm start`; additive migrations use `pnpm db:migrate`. The main tracked generator requires managed database availability. `server/verifyDefaultIso.py` streams the configured default and verifies full trusted SHA256 without installing anything. The safe public transport verifiers use synthetic runs/impossible target guards and never execute OS installation.

Pinned upstream source is bin456789/reinstall commit `98f1e21013233d42750cc2e7a298a0818461d686`; source/license/provenance are in `vendor/reinstall`. Actual historic tests and recovery passed Windows11 Pro/build26300 and RDP22 authentication on Vultr. The source-host-only change is not a fresh destructive VPS installation test. Previous Drive-quota/mirror diagnostics remain historical records, not current serving instructions.

Optional apps/files/desktop settings remain separate post-install exports. Windows licensing/activation, first-login privacy choices, provider firewall and hardware compatibility remain user/provider responsibilities. RDP and temporary installer SSH can both use22 sequentially; an SSH banner is not RDP.

Current Preview remains temporary and unpublished. Script delivery/tracking require the HTTPS backend online; ISO transfer now depends only on the selected direct host, not on the website media stream. Permanent dashboard hosting is separate and must never use the VPS being reinstalled. No affiliation with Microsoft, TinyInstaller or upstream maintainers; browser logos are their owners' trademarks.

## Current standalone control center

Custom email/password owner login, MFA/recovery, encrypted issued commands, live history/Created dates, credential Reveal, Trash/Restore/confirmed purge, presets and notes, audit, notifications and local legacy import are implemented. Production uses your private MySQL and domain with no required Manus service. See DEPLOY.md, deploy/KEY-ROTATION.md and TEST-REPORT.md.
