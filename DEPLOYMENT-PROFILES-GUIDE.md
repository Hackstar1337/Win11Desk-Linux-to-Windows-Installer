# Deployment profiles — Win11Desk

## Create once, deploy many times

Open **Deployment profiles** in the authenticated dashboard. Create a named profile, choose the operating system, and save your direct HTTPS ISO URL. Set optional username, RDP port and retry defaults. Passwords belong to generated commands, not profiles.

Choose **Use profile**, enter a Windows password, and generate a command. Paste that command into root SSH on the intended Linux VPS. Running it automatically erases that VPS system disk and reboots; merely creating a profile does not install anything.

History keeps the selected profile name/revision and exact issued OS/media snapshot. Use **History** from a profile or the profile filter on Deployment history to see all its runs. Existing Copy/Reveal, progress, elapsed timer, Details and RDP controls remain unchanged.

## OS catalog:32 selections

| Family | Selections |
| --- | --- |
| Windows11 x64 | Pro, Pro N, Enterprise, Enterprise N, Education, Education N, Pro Education, Pro Education N, Pro for Workstations, Pro N for Workstations |
| Windows10 x64 | The same ten client edition choices; check release support/ESU/licensing before use |
| Windows Server2019 x64 | Standard and Datacenter; licensed and Evaluation media each, Desktop Experience only |
| Windows Server2022 x64 | Standard and Datacenter; licensed and Evaluation media each, Desktop Experience only |
| Windows Server2025 x64 | Standard and Datacenter; licensed and Evaluation media each, Desktop Experience only |

**Testing boundary:** the prior Windows11Pro installation/RDP tests remain the only real-target evidence. The additional OS adapters have generated-script, exact-image, registry edition/build/installation-type and safe callback tests—not a completed installation test for each edition or provider. The dashboard clearly labels that distinction. A reported RDP listener is not external RDP authentication.

Windows Home is excluded because it cannot act as a supported incoming RDP host. Server Core is excluded because this product targets desktop access. Ubuntu/Debian and arbitrary Linux ISOs are not misrepresented as Windows-compatible installation media. RAW/QCOW disk-image profiles, IoT/LTSC-specific identity variants and custom post-install scripts are not part of this release.

## Media requirements

Use a genuine matching **x64 Windows installation ISO** containing `sources/boot.wim` and `install.wim`, `install.esd` or split `install.swm` files. The selected WIM image must match exactly (case-insensitive); wrong single-image media also fails rather than silently installing its only image. The image name must be the English name stored in the WIM, not an arbitrary display label.

The **Exact ISO image name** advanced field overrides the catalog default. Some Server ISOs omit the year or use different Desktop Experience wording. Obtain the actual image name with DISM `/Get-ImageInfo /ImageFile:<path-to-install.wim>` and enter it exactly. An override only selects an image; it does not bypass the chosen OS edition/build/installation-type proof.

A saved URL is not advertised as verified reachable. Saving profiles does not download the ISO or probe arbitrary URLs from the dashboard. Actual target-side TLS, ISO signature, fingerprint/integrity and final consistency checks remain active. The approved Windows11Pro default retains its fixed trusted SHA-256. There is no alternate mirror fallback.

You may save a profile with its URL blank; it appears as **Needs ISO URL** and cannot issue commands. Evaluation and licensed Server profiles are distinct. Evaluation licensing/activation limits and Windows10 lifecycle requirements are the administrator's responsibility; this feature supplies no license or activation bypass.

## Editing and history

Edits increment a revision. Stale forms/issuance requests are rejected instead of silently taking a different source. New installer only lists active configured Operating system profiles. The server resolves their authoritative OS/source; direct URL, nested target and custom-mode overrides cannot create new commands. Configure all media in Deployment profiles. See READY-OS-GUIDE.md for the versioned automatic command workflow.

**Duplicate** creates an independent profile. **Archive** blocks new issuance but keeps historical links and already-issued commands. **Restore** re-enables the profile. Old commands retain their original encrypted artifact, hash, credential and source even if the profile is edited or archived. Custom/legacy commands are not guessed-linked by matching URLs.

Owner/admin roles manage profiles; authenticated read permissions control catalog/history access. CSRF and existing role/vault protections still apply. CSV exports add profile name, OS and revision, never passwords or bearer capabilities.

## Persistence and upgrading

The additive `control-profiles-v1` migration creates `wc_profiles` and `wc_command_profiles` and seeds one Default Windows11Pro profile from existing settings once. It does not reset accounts, settings, presets, history or vault keys. Legacy retry values above20 are clamped only for the derived profile; original settings remain unchanged. Repeated migration preserves all profile edits and archive state.

Normal encrypted MySQL backups include the new tables. For a standalone upgrade, preserve your existing `.env` and volumes, back up source/database, rebuild the app image, run its packaged `dist/migrate.js`, then recreate only the app service. Never rerun initial setup or replace the database to add this feature.

## Reference distinction

[TinyInstaller's catalog](https://tinyinstaller.top/deployments?p=) inspired the separate profile/history workflow. Its [custom-profile image documentation](https://docs.tinyinstaller.top/custom-profiles/host-image.html) describes disk-image formats. Win11Desk instead implements Windows setup ISO profiles through its pinned installer; these media types are not interchangeable.
