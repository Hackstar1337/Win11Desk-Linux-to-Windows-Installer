import { targetDefaults, type InstallTarget } from "./installer";

export const defaultIsoUrl = "";
export const defaultIsoSha256 =
  "bd4307df32bc8af33b39ccecb1174aeb345386630f89a2b86c7a4e36b55ea650";

/** Every chosen source is used directly; there is no media proxy or alternate fallback. */
export function downloadIsoUrl(value: string) {
  return value.trim();
}
export function automaticTarget(value: string): InstallTarget {
  const isoUrl = downloadIsoUrl(value);
  return {
    ...targetDefaults,
    isoUrl,
    isoSha256: defaultIsoUrl && isoUrl === defaultIsoUrl ? defaultIsoSha256 : "auto",
    targetDisk: "auto",
    expectedHostname: "auto",
    autoReboot: true,
    backupReady: true,
    recoveryReady: true,
    unsupportedHardwareAccepted: true,
  };
}
