import type { RemoteReceipt, RemoteJobState } from "@shared/remoteInstall";
import { isProvenPrelaunchReceiptFailure } from "@shared/remoteInstall";

type Outcome = {
  state: RemoteJobState;
  errorCode: string | null;
  clearSecrets: boolean;
};

/** Only explicit checks before the bootstrap runs prove that no OS work started. */
export function failedReceiptOutcome(errorCode: string): Outcome {
  return {
    state: isProvenPrelaunchReceiptFailure(errorCode)
      ? "blocked"
      : "launch_uncertain",
    errorCode,
    clearSecrets: true,
  };
}

export function reconciliationOutcome(receipt: RemoteReceipt): Outcome | null {
  if (receipt.state === "launched")
    return { state: "handed_off", errorCode: null, clearSecrets: true };
  if (receipt.state === "failed")
    return failedReceiptOutcome(receipt.errorCode || "RECONCILE_FAILED");
  if (receipt.state === "absent")
    return {
      state: "blocked",
      errorCode: "RECONCILE_NOT_DISPATCHED",
      clearSecrets: true,
    };
  return null;
}
