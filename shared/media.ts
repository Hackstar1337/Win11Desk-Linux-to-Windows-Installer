import { targetDefaults, type InstallTarget } from "./installer";

// Supply a direct official ISO link in the dashboard; no ISO is bundled or preconfigured.
export const defaultIsoUrl = "";
export const defaultIsoSha256 = "auto";

/** Every chosen source is used directly; there is no media proxy or alternate fallback. */
export function downloadIsoUrl(value: string) {
  return value.trim();
}
export function automaticTarget(value: string): InstallTarget {
  const isoUrl = downloadIsoUrl(value);
  return {
    ...targetDefaults,
    isoUrl,
    isoSha256: "auto",
    targetDisk: "auto",
    expectedHostname: "auto",
    autoReboot: true,
    backupReady: true,
    recoveryReady: true,
    unsupportedHardwareAccepted: true,
  };
}
