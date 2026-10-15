# Win11Desk

```
██╗    ██╗██╗███╗   ██╗ ██╗ ██╗███████╗███████╗██╗  ██╗
██║    ██║██║████╗  ██║ ██║ ██║██╔════╝██╔════╝██║ ██╔╝
██║ █╗ ██║██║██╔██╗ ██║ ███████║█████╗  ███████╗█████╔╝
██║███╗██║██║██║╚██╗██║ ██╔══██║██╔══╝  ╚════██║██╔═██╗
╚███╔███╔╝██║██║ ╚████║ ██║  ██║███████╗███████║██║  ██╗
 ╚══╝╚══╝ ╚═╝╚═╝  ╚═══╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
              Linux-to-Windows Installer
```

Windows 11 Pro-only configuration dashboard with automatic Linux VPS installation and private progress tracking.

## ISO source configuration

No default ISO download URL is configured. Set a direct HTTPS ISO URL in Deployment profiles before issuing an installer command. The VPS downloads directly from the selected address; no mirror or alternate-source fallback is used.

## Workflow and architecture

Set username/password/RDP (default TCP22), generate an automatic script, and paste it in root SSH on a compatible disposable/backed-up VPS. Pasting authorizes system-disk erasure and automatic reboot. Generated commands are private and expire after 30 minutes; regenerate after changing settings or source. No OS is installed by the webpage itself.

`server/pageInstallerDelivery.ts` seals validated settings into AES-GCM envelopes delivered by private HTTPS POST. Passwords are transiently processed, are not saved in browser drafts/tracker records, and can be recovered by anyone holding the command and its key. Source pinning and script hashes remain enforced.

`server/installTracking.ts` and `/track/:id` provide durable managed-MySQL runs with separate hashed capability access, per-execution rows and seven-day tracker expiry. Callbacks report real stages, Windows edition/build and local RDP listening. Completion persists after the bounded Windows reporter exits; it is not continuous uptime monitoring or external authentication/desktop verification. Tracker URL secrets use fragments.

## Serving and verification

Use:

```bash
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm start
```

Additive migrations use `pnpm db:migrate`. The main tracked generator requires managed database availability. `server/verifyDefaultIso.py` streams the configured default and verifies the full trusted SHA256 without installing anything. Safe public transport verifiers use synthetic runs and impossible-target guards; they never execute OS installation.

Pinned upstream source is `bin456789/reinstall` at commit `98f1e21013233d42750cc2e7a298a0818461d686`. Source, license, and provenance are in `vendor/reinstall`. Windows licensing/activation, first-login privacy choices, provider firewall, and hardware compatibility remain user/provider responsibilities.

## Standalone control center

Custom email/password owner login, MFA/recovery, encrypted issued commands, live history, credential reveal, trash/restore, confirmed purge, presets, notes, audit, notifications, and local legacy import are implemented.

Production uses private MySQL and a domain with no required Manus service. Script delivery and tracking require the HTTPS backend online. Permanent dashboard hosting must never use the VPS being reinstalled.

> Not affiliated with Microsoft, TinyInstaller, or upstream maintainers. Browser logos are the property of their respective owners.
