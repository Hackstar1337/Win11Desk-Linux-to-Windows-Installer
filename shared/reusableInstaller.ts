import { z } from "zod";
import { defaults, type DeploymentConfig } from "./deployment";
import {
  bashQuote,
  installTargetSchema,
  installerIssues,
  linuxInstaller,
  type InstallTarget,
} from "./installer";

export const testedMedia = {
  build: "26300.9457",
  sha256: "bd4307df32bc8af33b39ccecb1174aeb345386630f89a2b86c7a4e36b55ea650",
  evidence:
    "Windows boot and RDP 22 authenticated on two Vultr UEFI VPSs (4 GB, 2 vCPU), including an unchanged website-generated command with the same verified ISO content. First-login privacy setup remained for the owner.",
};
export const reusableSettingsSchema = z
  .object({
    username: z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,19}$/),
    remotePort: z.number().int().min(1).max(65535),
    retries: z.number().int().min(1).max(20),
    target: installTargetSchema.strict(),
  })
  .strict();
export function reusableSettings(
  config: DeploymentConfig,
  target: InstallTarget
) {
  return reusableSettingsSchema.parse({
    username: config.username,
    remotePort: config.remotePort,
    retries: config.initScript ? config.retries : 3,
    target: { ...target, autoReboot: true },
  });
}
export function reusableScript(input: unknown) {
  const data = reusableSettingsSchema.parse(input);
  const config = {
    ...defaults,
    username: data.username,
    remotePort: data.remotePort,
    initScript: true,
    retries: data.retries,
  };
  const issues = installerIssues(config, data.target);
  if (issues.length) throw new Error("Invalid installer inputs.");
  return linuxInstaller(config, data.target, false);
}
export function reusableCommand(
  origin: string,
  encoded: string,
  digest: string
) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw new Error("Public HTTPS origin required.");
  if (
    !/^[A-Za-z0-9_-]{1,12000}$/.test(encoded) ||
    !/^[a-f0-9]{64}$/.test(digest)
  )
    throw new Error("Invalid installer reference.");
  return `# Reusable Windows 11 Pro installer. Password is requested privately in SSH.
# Keep the command private if the ISO link is private; refresh expiring media links.
(
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run sudo -i on the intended Linux VPS first.' >&2; exit 1; }
umask 077
work=$(mktemp -d /root/win11desk-command.XXXXXX)
trap 'rm -rf "$work"' EXIT
settings=${bashQuote(JSON.stringify({ settings: encoded }))}
printf '%s' "$settings" | curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --retry 3 --connect-timeout 20 --max-time 90 -H 'Content-Type: application/json' --data-binary @- ${bashQuote(origin + "/api/installer/setup.sh")} -o "$work/setup.sh"
unset settings
printf '%s  %s\\n' ${bashQuote(digest)} "$work/setup.sh" | sha256sum --check --status || { echo 'Installer hash mismatch.' >&2; exit 1; }
bash "$work/setup.sh" --install
)`;
}
const mediaSchema = z
  .object({
    isoUrl: installTargetSchema.shape.isoUrl,
    isoSha256: installTargetSchema.shape.isoSha256,
  })
  .strict();
export function mediaDraft(target: InstallTarget) {
  return mediaSchema.parse({
    isoUrl: target.isoUrl,
    isoSha256: target.isoSha256,
  });
}
export function restoreMedia(raw: string) {
  return mediaSchema.parse(JSON.parse(raw));
}
export function mediaExpiry(isoUrl: string): number | null {
  try {
    const url = new URL(isoUrl);
    if (url.hostname !== "software.download.prss.microsoft.com") return null;
    const value = url.searchParams.get("P1");
    if (!value || !/^\d{10}$/.test(value)) return null;
    return Number(value) * 1000;
  } catch {
    return null;
  }
}
