import { targetDefaults, type InstallTarget } from "./installer";

export const defaultIsoUrl = "";
export const defaultIsoSha256 = "";

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
