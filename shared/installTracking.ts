export const INSTALL_TRACKING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INSTALL_TRACKING_STALE_MS = 3 * 60 * 1000;

export const INSTALL_TRACKING_STAGES = [
  "starting",
  "preflight",
  "staging",
  "rebooting",
  "installer_booted",
  "downloading",
  "media_verified",
  "preparing",
  "windows_setup",
  "windows_booted",
  "windows_ready",
  "failed",
] as const;

export type InstallTrackingStage = (typeof INSTALL_TRACKING_STAGES)[number];

/** Numeric order is deliberately sparse so future generic stages can fit between them. */
export const INSTALL_TRACKING_STAGE_RANK: Record<InstallTrackingStage, number> =
  {
    starting: 0,
    preflight: 10,
    staging: 20,
    rebooting: 30,
    installer_booted: 40,
    downloading: 45,
    media_verified: 50,
    preparing: 55,
    windows_setup: 58,
    windows_booted: 60,
    windows_ready: 70,
    failed: 100,
  };

export const INSTALL_TRACKING_STAGE_LABELS: Record<
  InstallTrackingStage,
  string
> = {
  starting: "Starting",
  preflight: "Preflight",
  staging: "Staging",
  rebooting: "Rebooting",
  installer_booted: "Installer booted",
  downloading: "Downloading",
  media_verified: "Media verified",
  preparing: "Preparing",
  windows_setup: "Windows setup",
  windows_booted: "Windows booted (self-reported)",
  windows_ready: "Windows ready (self-reported)",
  failed: "Failed",
};

export const INSTALL_TRACKING_STAGE_SUMMARIES: Record<
  InstallTrackingStage,
  string
> = {
  starting: "This execution has started; it is not a success signal.",
  preflight:
    "The installer is checking prerequisites; no installation result is implied.",
  staging:
    "The installer is staging its next step; no installation result is implied.",
  rebooting: "The target is rebooting; the next report may be delayed.",
  installer_booted:
    "The installer environment reported a boot; Windows is not yet proven.",
  downloading:
    "Installation media is being downloaded; downloaded does not mean installed or successful.",
  media_verified:
    "The client reported media verification; Windows is not yet proven.",
  preparing:
    "The installer is preparing the Windows setup; no installation result is implied.",
  windows_setup:
    "Windows setup is running; readiness has not been established.",
  windows_booted:
    "The client self-reported Windows 11 Professional running (build proof required); this is not external authentication.",
  windows_ready:
    "The client self-reported Windows 11 Professional running and a local RDP listener; external RDP authentication has not been performed.",
  failed:
    "The client reported a terminal failure stage; no arbitrary error message is retained.",
};

export interface InstallTrackingRunView {
  runId: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  hostname: string;
  wholeDisk: string;
  rdpPort: number;
  publicIP?: string;
  windowsEdition?: string;
  windowsBuild?: number;
  rdpListening?: boolean;
  stage: InstallTrackingStage;
  sequence: number;
  errorStage?: Exclude<InstallTrackingStage, "failed">;
}

export interface InstallTrackingGroupView {
  groupId: string;
  createdAt: string;
  expiresAt: string;
  runs: InstallTrackingRunView[];
}

export type InstallTrackingFreshness = "fresh" | "unknown";

export function isInstallTrackingStage(
  value: unknown
): value is InstallTrackingStage {
  return (
    typeof value === "string" &&
    (INSTALL_TRACKING_STAGES as readonly string[]).includes(value)
  );
}

export function installTrackingStageRank(stage: InstallTrackingStage): number {
  return INSTALL_TRACKING_STAGE_RANK[stage];
}

export function canAdvanceInstallTrackingStage(
  current: InstallTrackingStage,
  next: InstallTrackingStage
): boolean {
  if (current === "failed") return false;
  return (
    next === "failed" ||
    installTrackingStageRank(next) >= installTrackingStageRank(current)
  );
}

/** Windows proof is client-reported metadata, intentionally not a server-side authentication claim. */
export function hasWindowsProfessionalProof(
  windowsEdition: unknown,
  windowsBuild: unknown
): boolean {
  if (typeof windowsEdition !== "string" || typeof windowsBuild !== "number")
    return false;
  if (!Number.isInteger(windowsBuild) || windowsBuild < 22000) return false;
  const edition = windowsEdition.trim().toLowerCase();
  return /^(?:windows\s+11\s+)?(?:pro|professional)$/.test(edition);
}

export function hasWindowsReadyProof(
  windowsEdition: unknown,
  windowsBuild: unknown,
  rdpListening: unknown
): boolean {
  return (
    hasWindowsProfessionalProof(windowsEdition, windowsBuild) &&
    rdpListening === true
  );
}

export function installTrackingFreshness(
  updatedAt: Date | string | number,
  now: Date | string | number = Date.now()
): InstallTrackingFreshness {
  const updateMs = new Date(updatedAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(updateMs) || !Number.isFinite(nowMs)) return "unknown";
  return nowMs - updateMs > INSTALL_TRACKING_STALE_MS ? "unknown" : "fresh";
}

export function isInstallTrackingStale(
  updatedAt: Date | string | number,
  now: Date | string | number = Date.now()
): boolean {
  return installTrackingFreshness(updatedAt, now) === "unknown";
}

export function installTrackingStageLabel(stage: InstallTrackingStage): string {
  return INSTALL_TRACKING_STAGE_LABELS[stage];
}

export function installTrackingStageSummary(
  stage: InstallTrackingStage,
  updatedAt?: Date | string | number,
  now: Date | string | number = Date.now()
): string {
  const freshness =
    updatedAt === undefined
      ? "fresh"
      : installTrackingFreshness(updatedAt, now);
  return freshness === "unknown"
    ? `No update for over three minutes; current state is unknown, not failed. ${INSTALL_TRACKING_STAGE_SUMMARIES[stage]}`
    : INSTALL_TRACKING_STAGE_SUMMARIES[stage];
}

// Short aliases make the shared contract convenient for tracker UI consumers.
export const trackerStages = INSTALL_TRACKING_STAGES;
export const trackerStageRanks = INSTALL_TRACKING_STAGE_RANK;
export const trackerStageLabels = INSTALL_TRACKING_STAGE_LABELS;
export const trackerStageSummaries = INSTALL_TRACKING_STAGE_SUMMARIES;
