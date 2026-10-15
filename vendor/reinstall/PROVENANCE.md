# Upstream installer provenance

Source: https://github.com/bin456789/reinstall

Pinned commit: `98f1e21013233d42750cc2e7a298a0818461d686`

Original `reinstall.sh` SHA-256: `b7ae1e185355d9e1ef0635828f9e7bbd0393475e38e1df72cba87fa415c7a255`

Retrieved 2026-10-12 UTC. Original source and GPL v3 license are included in this directory. The Win11Desk Bash launcher first downloads the exact original commit and verifies this hash. It patches the `confhome` URL to the fixed commit, disables alternate mutable `confhome_cn`, clears proxy overrides and removes main-stage curl certificate bypass. The pinned `trans.sh` source SHA-256 is `33d7e6afbff53a97c030057723623be6a070635b65bd055012f93b781b136f1d`. Its patched copy removes the certificate-bypass flag and verifies the supplied ISO SHA-256 before mounting; the main stage copies this verified/modified second stage into its initramfs. The upstream script still downloads external packages, images and drivers; pinning source is not a complete supply-chain audit.

The wrapper is distributed under GPL v3. Upstream is not affiliated with Win11Desk. No upstream installation has been run on the development host. Upstream Windows setup automatically bypasses some Windows 11 hardware checks and requires Secure Boot disabled for its temporary boot environment. Those mechanics do not establish Microsoft support, provider permission, licensing, network reachability or driver compatibility.

**Download integrity:** Win11Desk removes the upstream main-stage `curl --insecure` flags, clears inherited GitHub proxy overrides, verifies the pinned second-stage source hash, removes its certificate-bypass flag, and injects a required ISO SHA-256 check immediately after ISO download and before mounting. Obtain the expected ISO hash from Microsoft or a trusted independent source, not from the same untrusted download server. Driver/package downloads and provider compatibility are not fully audited; a live test is still required.
