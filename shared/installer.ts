import type { PostInstallPayload } from "./postInstall";
import {
  WINDOWS_PASSWORD_MIN_LENGTH,
  windowsPasswordIssue,
} from "./windowsPassword";
import { telemetryPatchShell } from "./installerTelemetry";
import { z } from "zod";
import {
  mediaProbeShell,
  secondStageMediaGuardShell,
} from "./installerMediaGuard";
import { deploymentSchema, type DeploymentConfig } from "./deployment";
import { getOs, osCatalog, type OsDefinition } from "./deploymentProfiles";
import {
  trackingShell,
  trackingPatchShell,
  type InstallerTrackingConfig,
} from "./installerTrackingHooks";

export const installerVersion = {
  engine: "bin456789/reinstall",
  commit: "98f1e21013233d42750cc2e7a298a0818461d686",
  sha256: "b7ae1e185355d9e1ef0635828f9e7bbd0393475e38e1df72cba87fa415c7a255",
  transSha256:
    "33d7e6afbff53a97c030057723623be6a070635b65bd055012f93b781b136f1d",
  source: "https://github.com/bin456789/reinstall",
  license: "GPL-3.0",
  endToEndTested: false,
  copyAndRunBootAndRdpVerified: true,
  testScope:
    "Website-generated command tested unchanged on a second Vultr UEFI VPS using the same verified ISO content: media digest, Windows 11 Pro selection, boot and configured-password RDP 22 authentication passed. First-login privacy choices and ordinary desktop/live edition inspection remain user-owned.",
};
function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !/[\x00-\x20'"`$\\]/.test(value)
    );
  } catch {
    return false;
  }
}
export const installTargetSchema = z.object({
  isoUrl: z
    .string()
    .max(4096, "ISO URL must be 4096 characters or fewer.")
    .refine(httpsUrl, "Enter a direct HTTPS Windows 11 x64 ISO download URL."),
  isoSha256: z
    .string()
    .regex(
      /^(auto|[a-fA-F0-9]{64})$/,
      "Enter the ISO SHA-256 from a trusted independent source."
    ),
  targetDisk: z
    .string()
    .regex(
      /^(auto|\/dev\/(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme[0-9]+n[0-9]+))$/,
      "Use auto or a whole disk such as /dev/vda; not a partition."
    ),
  expectedHostname: z
    .string()
    .min(1, "Enter the target Linux hostname.")
    .max(253)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      "Use the exact Linux hostname, without spaces."
    ),
  logSshPort: z.number().int().min(1).max(65535),
  autoReboot: z.boolean().default(false),
  backupReady: z
    .boolean()
    .refine(v => v, "Confirm a usable backup or disposable server."),
  recoveryReady: z
    .boolean()
    .refine(v => v, "Confirm provider recovery-console access."),
  unsupportedHardwareAccepted: z
    .boolean()
    .refine(
      v => v,
      "Acknowledge the upstream hardware bypass and Secure Boot requirement."
    ),
});
export type InstallTarget = z.infer<typeof installTargetSchema>;
export const targetDefaults: InstallTarget = {
  isoUrl: "",
  isoSha256: "",
  targetDisk: "auto",
  expectedHostname: "auto",
  logSshPort: 22,
  autoReboot: false,
  backupReady: false,
  recoveryReady: false,
  unsupportedHardwareAccepted: false,
};
export function installerIssues(
  config: DeploymentConfig,
  target: InstallTarget
) {
  const result = installTargetSchema.safeParse(target);
  const issues = result.success ? [] : result.error.issues.map(i => i.message);
  const settings = deploymentSchema.safeParse(config);
  if (!settings.success)
    issues.push(...settings.error.issues.map(i => i.message));
  if (
    !/^[A-Za-z][A-Za-z0-9._-]{0,19}$/.test(config.username) ||
    config.username.toLowerCase() === "none"
  )
    issues.push(
      "Installer username must start with an ASCII letter and contain only letters, digits, period, underscore or hyphen (20 characters maximum); not none."
    );
  if (config.password) {
    const passwordIssue = windowsPasswordIssue(config.password);
    if (passwordIssue) issues.push(passwordIssue);
  }
  return issues;
}
export function bashQuote(value: string) {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}
function selectedImageGuardShell() {
  // The upstream script otherwise offers an interactive image fallback. Fail before that fallback,
  // using its already shell-quoted --image-name argument rather than interpolating user labels into AWK.
  return String.raw`grep -Fq 'all_image_names=' "$WORK/trans.sh" || fail 'Pinned image selection hook changed.'
awk '
index($0, "all_image_names=") && index($0, "wiminfo") {
 print
 q=sprintf("%c",34)
 print "    printf " q "%s\\n" q " " q "$all_image_names" q " | grep -Fix -- " q "$image_name" q " >/dev/null || error_and_exit " q "Required selected image missing; use the exact requested media." q
 next
}
{ print }
' "$WORK/trans.sh" > "$WORK/trans.image-checked.sh"
mv "$WORK/trans.image-checked.sh" "$WORK/trans.sh"
`;
}
function resolveInstallerOs(
  config: DeploymentConfig,
  options: { osId?: string; imageName?: string }
): { os: OsDefinition; imageName: string } {
  const os = options.osId
    ? getOs(options.osId)
    : osCatalog.find(
        candidate =>
          candidate.name === config.os || candidate.imageName === config.os
      );
  if (!os) throw new Error("Unsupported operating system.");
  const imageName = options.imageName ?? os.imageName;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .()_-]{0,159}$/.test(imageName))
    throw new Error("Selected image name is invalid.");
  return { os, imageName };
}

export function linuxInstaller(
  config: DeploymentConfig,
  target: InstallTarget,
  embedPassword = false,
  options: {
    automatic?: boolean;
    tracking?: InstallerTrackingConfig;
    osId?: string;
    imageName?: string;
    postInstall?: PostInstallPayload;
  } = {}
) {
  const selected = resolveInstallerOs(config, options);
  const { os, imageName } = selected;
  const confirmationTag =
    os.id === "windows-11-pro"
      ? "WINDOWS11PRO"
      : os.id.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  const isoSourceLine =
    os.id === "windows-11-pro"
      ? "printf 'ISO source must be a genuine Windows 11 x64 multi-edition image containing Windows 11 Pro.\\n'"
      : "printf 'ISO source must be a genuine x64 image containing the exact selected image: %s.\\n' \"$OS_IMAGE_NAME\"";
  const issues = installerIssues(config, target);
  if (issues.length) throw new Error(issues.join(" "));
  if (
    options.automatic &&
    (!embedPassword || config.password.length < WINDOWS_PASSWORD_MIN_LENGTH)
  )
    throw new Error("Automatic installation needs the page password.");
  const constants = {
    EXPECTED_HOST: target.expectedHostname,
    TARGET_DISK: target.targetDisk,
    ISO_URL: target.isoUrl,
    ISO_SHA256: target.isoSha256.toLowerCase(),
    WIN_USER: config.username,
    RDP_PORT: String(config.remotePort),
    LOG_SSH_PORT: String(target.logSshPort),
    AUTO_REBOOT: target.autoReboot ? "1" : "0",
    AUTOMATIC: options.automatic ? "1" : "0",
    RETRIES: String(config.initScript ? config.retries : 3),
    UPSTREAM_COMMIT: installerVersion.commit,
    UPSTREAM_SHA256: installerVersion.sha256,
    TRANS_SHA256: installerVersion.transSha256,
    EMBEDDED_PASSWORD: embedPassword ? config.password : "",
    OS_ID: os.id,
    OS_IMAGE_NAME: imageName,
  };
  return `#!/usr/bin/env bash
# Win11Desk Linux VPS -> ${imageName} x64
# Wrapper GPL-3.0; upstream bin456789/reinstall GPL-3.0.
# Default: read-only preflight. --install ${options.automatic ? "automatically erases/reboots after compatibility checks; no prompts." : "stages a destructive reinstall AFTER confirmation."}
# Never run this on your dashboard host. A reboot later erases the selected disk.
set -euo pipefail
umask 077
${Object.entries(constants)
  .map(([key, value]) => `${key}=${bashQuote(value)}`)
  .join("\n")}
MODE="\$\{1:---preflight\}"
case "$MODE" in --preflight|--install|--cancel) ;; *) echo 'Usage: bash win11pro-install.sh [--preflight|--install|--cancel]' >&2; exit 2;; esac
fail() { printf 'BLOCKED: %s\\n' "$*" >&2; if declare -F track_report >/dev/null; then track_report failed; fi; exit 1; }
${options.tracking ? trackingShell(options.tracking) : "track_report() { return 0; }"}
for cmd in uname hostname lsblk findmnt awk grep curl sha256sum sed tr getconf; do command -v "$cmd" >/dev/null || fail "Missing required command: $cmd (install it through your Linux package manager)"; done
[[ "$(uname -s)" == Linux ]] || fail 'Only Linux is supported.'
[[ "$(uname -m)" == x86_64 ]] || fail 'Windows 11 x64 requires an x86_64 VPS.'
[[ "$EUID" -eq 0 ]] || fail 'Run as root on the intended VPS.'
ACTUAL_HOST=$(hostname)
if [[ "$EXPECTED_HOST" == auto ]]; then EXPECTED_HOST="$ACTUAL_HOST"; fi
[[ "$ACTUAL_HOST" == "$EXPECTED_HOST" ]] || fail "Wrong host: expected $EXPECTED_HOST, got $ACTUAL_HOST"
if [[ "$MODE" == --cancel ]]; then
  [[ -r /dev/tty && -w /dev/tty ]] || fail 'Interactive SSH terminal required for cancellation.'
  SAVED=/root/win11desk/reinstall.sh
  [[ -f "$SAVED" ]] || fail 'No staged Win11Desk upstream script found.'
  printf 'Type CANCEL %s to remove the staged boot entry: ' "$EXPECTED_HOST" >/dev/tty
  IFS= read -r reply </dev/tty
  [[ "$reply" == "CANCEL $EXPECTED_HOST" ]] || fail 'Cancellation not confirmed.'
  bash "$SAVED" reset
  exit 0
fi
if command -v systemd-detect-virt >/dev/null; then
  if systemd-detect-virt --container --quiet; then fail 'Container VPS (LXC/OpenVZ/Docker) is not supported.'; fi
else
  [[ ! -e /.dockerenv && ! -e /run/.containerenv && ! -d /proc/vz ]] || fail 'Container virtualization is not supported.'
fi
if [[ "$TARGET_DISK" == auto ]]; then
  ROOT_AUTO=$(findmnt -n -o SOURCE /)
  [[ "$ROOT_AUTO" == /dev/* ]] || fail 'Cannot detect a plain block-device root disk. Specify it manually.'
  ROOT_TYPE=$(lsblk -dn -o TYPE "$ROOT_AUTO")
  [[ "$ROOT_TYPE" == part || "$ROOT_TYPE" == disk ]] || fail 'Auto-detection does not support LVM, RAID or encrypted root disks.'
  DETECTED_DISKS=$(lsblk -s -nr -o PATH,TYPE "$ROOT_AUTO" | awk '$2 == "disk" {print $1}')
  [[ -n "$DETECTED_DISKS" && "$DETECTED_DISKS" != *$'\\n'* ]] || fail 'Cannot unambiguously detect one root disk.'
  TARGET_DISK="$DETECTED_DISKS"
fi
[[ -b "$TARGET_DISK" ]] || fail "Not a block device: $TARGET_DISK"
[[ "$(lsblk -dn -o TYPE "$TARGET_DISK")" == disk ]] || fail 'Select a whole disk, not a partition/LVM/RAID device.'
DISK_TYPES=$(lsblk -rn -o TYPE "$TARGET_DISK") || fail 'Cannot inspect system disk topology.'
if printf '%s\n' "$DISK_TYPES" | grep -E '^(crypt|lvm|raid.*)$' >/dev/null; then fail 'Encrypted/LVM/RAID disks require a separately reviewed installation path.'; fi
DISK_MOUNTS=$(lsblk -rn -o MOUNTPOINT "$TARGET_DISK") || fail 'Cannot inspect system disk mounts.'
if printf '%s\n' "$DISK_MOUNTS" | grep -E '^/' | grep -vE '^(/|/boot|/boot/efi)$' >/dev/null; then fail 'Disk has extra data mounts. Review or move data before proceeding.'; fi
ROOT_DEVICE=$(findmnt -n -o SOURCE /)
if [[ "$ROOT_DEVICE" != /dev/* ]] || ! lsblk -s -nr -o PATH "$ROOT_DEVICE" | grep -Fxq "$TARGET_DISK"; then fail "Selected disk is not the current root-system disk: $ROOT_DEVICE"; fi
RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
CRASH_BYTES=0
if [[ -r /sys/kernel/kexec_crash_size ]]; then read -r CRASH_BYTES < /sys/kernel/kexec_crash_size || true; fi
[[ "$CRASH_BYTES" =~ ^[0-9]+$ ]] || CRASH_BYTES=0
NOMINAL_RAM_KB=$((RAM_KB + CRASH_BYTES / 1024))
[[ "$RAM_KB" -ge 1000000 && "$NOMINAL_RAM_KB" -ge 3900000 ]] || fail 'Approximately 4 GB nominal RAM and at least 1 GB usable Linux memory required. Crash-reserved RAM is counted separately.'
DISK_BYTES=$(lsblk -bdn -o SIZE "$TARGET_DISK" | tr -d ' ')
[[ "$DISK_BYTES" -ge 64000000000 ]] || fail 'Selected disk must be at least 64 GB.'
CORES=$(getconf _NPROCESSORS_ONLN)
[[ "$CORES" -ge 2 ]] || fail 'At least 2 CPU cores are required.'
if command -v mokutil >/dev/null; then
  SECURE_BOOT=$(mokutil --sb-state 2>/dev/null || true)
  [[ "$SECURE_BOOT" != *'SecureBoot enabled'* ]] || fail 'Upstream requires Secure Boot disabled; review this with your VPS provider.'
fi
printf '\\nPREFLIGHT: host=%s disk=%s RAM_KB=%s cores=%s\\n' "$ACTUAL_HOST" "$TARGET_DISK" "$RAM_KB" "$CORES"
printf 'Nominal RAM including Linux crash reservation: %s KiB (crash reserve %s bytes)\\n' "$NOMINAL_RAM_KB" "$CRASH_BYTES"
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT "$TARGET_DISK"
printf '\\n%s | user=%s | RDP TCP=%s | installer SSH=%s\\n' "$OS_IMAGE_NAME" "$WIN_USER" "$RDP_PORT" "$LOG_SSH_PORT"
${isoSourceLine}
printf 'Preflight does not verify ISO authenticity, provider permission, TPM, drivers or successful Windows boot.\\n'
if [[ "$MODE" == --preflight ]]; then
  printf 'Read-only preflight passed. No bootloader/disk settings were changed and no ISO was downloaded.\\n'
  printf 'After backup and console verification: bash win11pro-install.sh --install\\n'
  exit 0
fi
${options.tracking ? "track_start" : ""}
if [[ "$AUTOMATIC" == 1 ]]; then
  printf 'AUTOMATIC INSTALL: detected host=%s disk=%s. All partitions will be replaced and VPS rebooted without prompts.\\n' "$EXPECTED_HOST" "$TARGET_DISK"
else
[[ -r /dev/tty && -w /dev/tty ]] || fail 'Interactive SSH terminal required. Do not pipe this script into bash.'
printf '\\nWARNING: after reboot, ALL partitions on %s are permanently replaced with %s.\\n' "$TARGET_DISK" "$OS_IMAGE_NAME" >/dev/tty
printf 'SSH to the original Linux system will disconnect; retain recovery-console access.\\n' >/dev/tty
# Confirmation acknowledgement accepts case and surrounding terminal whitespace.
while true; do
  printf 'Have a verified backup/disposable target and provider console? Type yes to continue or no to cancel: ' >/dev/tty
  IFS= read -r reply </dev/tty || fail 'Confirmation input closed; nothing staged.'
  reply=$(printf '%s' "$reply" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "\$\{reply,,\}" in
    yes) break ;;
    no|n) fail 'Cancelled by user before installation staging.' ;;
    *) printf 'Not confirmed. Type yes (any letter case) or no. No installation changes have been made.\\n' >/dev/tty ;;
  esac
done
printf 'Type exactly: ERASE %s %s ${confirmationTag}\\n> ' "$EXPECTED_HOST" "$TARGET_DISK" >/dev/tty
IFS= read -r reply </dev/tty
[[ "$reply" == "ERASE $EXPECTED_HOST $TARGET_DISK ${confirmationTag}" ]] || fail 'Disk erasure not confirmed.'
fi
password="$EMBEDDED_PASSWORD"
unset EMBEDDED_PASSWORD
if [[ -z "$password" ]]; then
  [[ "$AUTOMATIC" != 1 ]] || fail 'Automatic mode requires the dashboard password.'
  printf 'Choose Windows password (input hidden): ' >/dev/tty
  IFS= read -rs password </dev/tty; printf '\\n' >/dev/tty
  printf 'Repeat Windows password: ' >/dev/tty
  IFS= read -rs password_again </dev/tty; printf '\\n' >/dev/tty
  [[ "$password" == "$password_again" ]] || fail 'Passwords do not match.'
  unset password_again
fi
[[ "\$\{#password\}" -ge 8 && "\$\{#password\}" -le 128 ]] || fail 'Password must be 8-128 characters.'
[[ "$password" != *$'\\n'* && "$password" != *$'\\r'* ]] || fail 'Password must be a single line.'
LC_ALL=C; [[ ! "$password" =~ [^[:print:]] ]] || fail 'Password must use printable ASCII characters.'
# Reused media links may expire. Fail before upstream boot changes; full media hash remains checked after download.
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --head --retry 2 --connect-timeout 20 --max-time 90 "$ISO_URL" -o /dev/null || fail 'ISO URL unavailable or expired. Obtain a fresh link before staging.'
# Credential is inherited via environment, not shell history or argv. Trusted root can still inspect it.
WORK=/root/win11desk
mkdir -p "$WORK"; chmod 700 "$WORK"
${mediaProbeShell()}
win11desk_media_probe "$ISO_URL" || fail 'MEDIA_PREFLIGHT_FAILED: ISO is inaccessible or not genuine ISO bytes. No boot/disk settings changed.'
# A custom ISO can be fingerprinted automatically before any boot staging.
# This detects changed transfer bytes later, not publisher authenticity.
if [[ "$ISO_SHA256" == auto ]]; then
  MEDIA="$WORK/media.verify.iso"
  printf 'Downloading custom ISO for automatic integrity check before staging.\\n'
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --retry "$RETRIES" --connect-timeout 20 "$ISO_URL" -o "$MEDIA" || { rm -f "$MEDIA"; fail 'ISO download failed; boot settings were not changed.'; }
  [[ "$(dd if="$MEDIA" bs=1 skip=32769 count=5 2>/dev/null)" == CD001 ]] || { rm -f "$MEDIA"; fail 'Source did not return an ISO image (Drive permissions/quota or a web page).'; }
  ISO_SHA256=$(sha256sum "$MEDIA" | awk '{print $1}')
  rm -f "$MEDIA"
fi
DOWNLOAD="$WORK/reinstall.original.sh"
SOURCE="https://raw.githubusercontent.com/bin456789/reinstall/$UPSTREAM_COMMIT/reinstall.sh"
track_report staging
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --retry "$RETRIES" --connect-timeout 20 "$SOURCE" -o "$DOWNLOAD"
printf '%s  %s\\n' "$UPSTREAM_SHA256" "$DOWNLOAD" | sha256sum --check --status || fail 'Upstream script integrity check failed.'
# Pin support scripts too. Upstream --commit currently does not reliably pin all support URLs.
unset github_proxy force_cn
sed -e "s|^confhome=https://raw.githubusercontent.com/bin456789/reinstall/main$|confhome=https://raw.githubusercontent.com/bin456789/reinstall/$UPSTREAM_COMMIT|" \\
    -e "s|^confhome_cn=.*|confhome_cn=|" \\
    -e 's/command curl --insecure /command curl /g' \\
    -e 's/echo "Password: $password"/echo "Password: [REDACTED - use your configured password]"/g' "$DOWNLOAD" > "$WORK/reinstall.sh"
# Verify and patch the pinned second-stage Windows installer before building the initramfs.
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --retry "$RETRIES" \\
  "https://raw.githubusercontent.com/bin456789/reinstall/$UPSTREAM_COMMIT/trans.sh" -o "$WORK/trans.original.sh"
printf '%s  %s\\n' "$TRANS_SHA256" "$WORK/trans.original.sh" | sha256sum --check --status || fail 'Second-stage source integrity failed.'
sed 's/--no-check-certificate //g' "$WORK/trans.original.sh" > "$WORK/trans.sh"
ISO_LINE='    download $iso /os/windows.iso'
grep -Fxq "$ISO_LINE" "$WORK/trans.sh" || fail 'Pinned Windows ISO download hook changed.'
awk -v digest="$ISO_SHA256" '{ print } $0 == "    download $iso /os/windows.iso" { print "    echo \\"" digest "  /os/windows.iso\\" | sha256sum -c - || error_and_exit ISO_SHA256_MISMATCH" }' "$WORK/trans.sh" > "$WORK/trans.checked.sh"
mv "$WORK/trans.checked.sh" "$WORK/trans.sh"
# Only replace the exact trans.sh fetch; other helpers retain pinned HTTPS URLs.
TRANS_LINE='    curl -Lo $initrd_dir/trans.sh $confhome/trans.sh'
grep -Fxq "$TRANS_LINE" "$WORK/reinstall.sh" || fail 'Pinned second-stage hook changed.'
sed -i 's|^    curl -Lo $initrd_dir/trans.sh $confhome/trans.sh$|    cp /root/win11desk/trans.sh $initrd_dir/trans.sh|' "$WORK/reinstall.sh"
${secondStageMediaGuardShell()}
${selectedImageGuardShell()}
${options.tracking ? trackingPatchShell(os, imageName, options.postInstall) + telemetryPatchShell() : ""}
chmod 700 "$WORK/reinstall.sh"
# Real upstream Windows ISO installation path; no raw-disk custom image or alternative edition.
export password
bash "$WORK/reinstall.sh" windows --image-name ${bashQuote(imageName)} --iso "$ISO_URL" \\
  --username "$WIN_USER" --rdp-port "$RDP_PORT" --ssh-port "$LOG_SSH_PORT" --target-disk "$TARGET_DISK" ${options.automatic ? "</dev/null" : ""}
unset password
if [[ "$AUTOMATIC" == 1 ]]; then
  printf 'Staging completed. Rebooting automatically to replace the selected disk. Follow the private dashboard tracker.\\n'
  track_report rebooting
  sync
  reboot
  exit 0
fi
printf '\\nSTAGED, NOT INSTALLED. Keep credentials safe and inspect provider firewall/network settings.\\n'
printf 'Before reboot you can cancel: sudo bash /root/win11desk/reinstall.sh reset\\n'
printf 'To begin disk replacement after your final review, run manually: reboot\\n'
printf 'After Windows boots, use Remote Desktop with the configured user and port. Verify OS edition and change the initial password.\\n'
if [[ "$AUTO_REBOOT" == 1 ]]; then
  printf 'Installation is staged. To reboot and start disk replacement, type REBOOT %s %s ${confirmationTag}: ' "$EXPECTED_HOST" "$TARGET_DISK" >/dev/tty
  IFS= read -r reboot_reply </dev/tty
  [[ "$reboot_reply" == "REBOOT $EXPECTED_HOST $TARGET_DISK ${confirmationTag}" ]] || fail 'Reboot not confirmed; staging remains cancellable.'
  sync
  reboot
fi
`;
}
function psQuote(value: string) {
  return "'" + value.replace(/'/g, "''") + "'";
}
export function postInstallScript(config: DeploymentConfig) {
  const appIds = {
    chrome: "Google.Chrome",
    firefox: "Mozilla.Firefox",
    edge: "Microsoft.Edge",
    brave: "Brave.Brave",
    "7zip": "7zip.7zip",
  };
  return `# Win11Desk optional post-install settings. Run as Administrator on installed Windows 11 Pro.
# This is not a Linux-to-Windows installer. It does not include account passwords.
# Review third-party app licenses before installation.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$edition = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID
$build = [int](Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').CurrentBuildNumber
if ($edition -ne 'Professional' -or $build -lt 22000) { throw 'Windows 11 Pro (Professional, build 22000+) required.' }
Set-TimeZone -Id ${psQuote(config.timezone)}
${config.hostname ? `Rename-Computer -NewName ${psQuote(config.hostname)} -Force\nWrite-Host 'Hostname changed; restart manually when ready.'` : "# No hostname change requested."}
${config.apps.length ? `if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Microsoft App Installer (winget) before running app setup.' }\n` + config.apps.map(a => `winget install --id ${psQuote(appIds[a])} --exact --source winget --accept-source-agreements --accept-package-agreements\nif ($LASTEXITCODE -ne 0) { throw 'App installation failed: ${appIds[a]}' }`).join("\n") : "# No optional apps selected."}
${config.fileUrl ? `$destination = Join-Path ([Environment]::GetFolderPath('Desktop')) 'win11desk-download.${new URL(config.fileUrl).pathname.toLowerCase().endsWith(".iso") ? "iso" : "zip"}'\nInvoke-WebRequest -Uri ${psQuote(config.fileUrl)} -OutFile $destination\nWrite-Host 'File downloaded. It is not automatically executed or extracted.'` : "# No file download requested."}
Write-Host 'Optional settings complete. Restart manually if hostname changed.'
`;
}
