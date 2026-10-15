import { z } from "zod";
import { postInstallOptionsSchema } from "./postInstall";

export const remoteTargetSchema = z
  .object({
    host: z.string().min(2).max(64),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.literal("root").default("root"),
  })
  .strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;
export const remoteSettingsSchema = z
  .object({
    profileId: z.string().uuid(),
    profileRevision: z.number().int().positive(),
    username: z.string().min(1).max(64),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[\x20-\x7e]+$/),
    remotePort: z.number().int().min(1).max(65535),
    retries: z.number().int().min(1).max(10).default(10),
    label: z.string().max(120).default(""),
    postInstall: postInstallOptionsSchema.optional(),
  })
  .strict();
export type RemoteSettings = z.infer<typeof remoteSettingsSchema>;
export type TargetInventory = {
  hostname: string;
  architecture: string;
  root: boolean;
  virtualization: string;
  memoryMiB: number;
  nominalMemoryMiB?: number;
  crashReservedBytes?: number;
  cpuCount: number;
  disk: string;
  diskBytes: number;
  diskSerial: string | null;
  bootMode: string;
  runner: "systemd" | "detached";
  httpsReachable: boolean;
  checkedAt: string;
};
export const remoteJobStates = [
  "queued",
  "connecting",
  "checking",
  "sending",
  "launching",
  "handed_off",
  "blocked",
  "connection_failed",
  "launch_uncertain",
  "cancelled",
] as const;
export type RemoteJobState = (typeof remoteJobStates)[number];
export const remoteJobLabels: Record<RemoteJobState, string> = {
  queued: "Queued",
  connecting: "Connecting",
  checking: "Checking target",
  sending: "Sending installer",
  launching: "Starting installer",
  handed_off: "Installer sent",
  blocked: "Blocked",
  connection_failed: "Connection failed",
  launch_uncertain: "Installation needs review",
  cancelled: "Cancelled",
};
export type RemoteJob = {
  id: string;
  target: RemoteTarget;
  state: RemoteJobState;
  label: string;
  profileName: string;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  commandId: string | null;
  groupId: string | null;
  runId: string | null;
  canCancel: boolean;
};
export type RemoteReview = {
  id: string;
  approvalDigest: string;
  expiresAt: string;
  target: RemoteTarget;
  fingerprint: string;
  inventory: TargetInventory;
  settings: Omit<RemoteSettings, "password">;
  profileName: string;
};
export type RemoteHealth = {
  enabled: boolean;
  workerAlive: boolean;
  workerHeartbeatAt: string | null;
  queued: number;
  oldestQueuedAt: string | null;
  uncertain: number;
};
export type RemoteReceipt = {
  state: "absent" | "prepared" | "launched" | "failed" | "unknown";
  errorCode?: string;
};

/** Safe, plain-language explanations for stored job reference codes. */
export function remoteJobErrorExplanation(code: string): string {
  const messages: Record<string, string> = {
    WRONG_HOST:
      "The VPS hostname changed since approval. Run a fresh connection check and review before trying again.",
    WRONG_DISK:
      "The target disk changed since approval. The installer was stopped before it ran; review the new disk carefully.",
    DISK_SIZE_CHANGED:
      "The target disk size changed since approval. The installer was stopped before it ran; check the VPS again.",
    RUNNER_CHANGED:
      "The Linux launch service changed since approval. The installer was stopped before it ran; check the VPS again.",
    INVALID_BOOTSTRAP:
      "The installer files could not be prepared. No bootstrap was run; check the server package before a fresh review.",
    INSTALLER_EXITED:
      "The installer process reported an error. Check Deployment history and the target logs before any new installation attempt.",
    TARGET_ALREADY_DISPATCHED:
      "The VPS has a marker from an earlier installation attempt. Check its existing installation before trying again.",
    RUNNER_FAILED:
      "The Linux launch service reported an error. Check the installation records before attempting to start again.",
    LAUNCH_FAILED:
      "Starting the installer failed. Check the target and installation records before attempting again.",
    RECONCILE_FAILED:
      "The saved installer receipt reports a failure. Review the installation records before attempting again.",
    AUTH_FAILED:
      "The VPS rejected the SSH login. Re-enter its current root password and check that password login is enabled.",
    CONNECTION_FAILED:
      "Could not connect to SSH. Check the VPS address, Linux SSH service, SSH port and provider firewall.",
    CONNECTION_REFUSED:
      "The VPS refused the connection. Check that SSH is running on the selected port and allowed by the provider firewall.",
    CONNECTION_RESET:
      "The VPS closed the SSH connection before login completed. Check its SSH service and connection limits.",
    CONNECTION_UNREACHABLE:
      "The dashboard cannot reach this VPS. Check its address, routing and provider firewall.",
    SSH_HANDSHAKE_TIMEOUT:
      "No SSH response was received on this port. Check that the VPS is running Linux and use its SSH port, not its Windows RDP port.",
    TIMEOUT:
      "The SSH operation timed out. Review the installation state before starting another attempt.",
    HOST_KEY_MISMATCH:
      "The SSH fingerprint changed. Verify the VPS identity with your provider before approving it again.",
    HOST_KEY_UNAVAILABLE:
      "The SSH fingerprint could not be read. Check that this VPS and port provide a Linux SSH service.",
    LAUNCH_UNCERTAIN:
      "It is not clear whether the installer started. Check the installation records; do not send it again blindly.",
    WORKER_RESTART:
      "The worker stopped before the job outcome was confirmed. Check the installation records before any new attempt.",
    QUEUE_EXPIRED:
      "This queued installation expired before it started. Run a fresh connection check and review before trying again.",
    SECRET_UNAVAILABLE:
      "The temporary login details are unavailable. Run a fresh connection check and review.",
    ACTOR_INACTIVE:
      "The account that approved this installation no longer has permission to start it.",
  };
  return (
    messages[code] ||
    "The installation reported an issue. Use this reference code when reviewing its details."
  );
}

export function isProvenPrelaunchReceiptFailure(
  code: string | null | undefined
): boolean {
  return [
    "WRONG_HOST",
    "WRONG_DISK",
    "DISK_SIZE_CHANGED",
    "RUNNER_CHANGED",
    "INVALID_BOOTSTRAP",
  ].includes(code || "");
}

/** Also gives correct labels to older receipts stored as connection_failed. */
export function remoteJobStateLabel(
  state: string,
  errorCode?: string | null
): string {
  if (
    (state === "blocked" || state === "connection_failed") &&
    isProvenPrelaunchReceiptFailure(errorCode)
  )
    return "Stopped before installing";
  if (
    state === "connection_failed" &&
    [
      "INSTALLER_EXITED",
      "TARGET_ALREADY_DISPATCHED",
      "RUNNER_FAILED",
      "LAUNCH_FAILED",
      "RECONCILE_FAILED",
    ].includes(errorCode || "")
  )
    return "Installation needs review";
  return remoteJobLabels[state as RemoteJobState] || state.replaceAll("_", " ");
}
