import { describe, it, expect } from "vitest";
import { reconciliationOutcome } from "./reconciliation";
import { remoteJobStateLabel } from "../../shared/remoteInstall";
describe("Conservative remote receipt reconciliation", () => {
  it("labels historical installer receipts without falsely claiming SSH failure", () => {
    expect(remoteJobStateLabel("connection_failed", "INSTALLER_EXITED")).toBe(
      "Installation needs review"
    );
    expect(remoteJobStateLabel("connection_failed", "WRONG_DISK")).toBe(
      "Stopped before installing"
    );
    expect(remoteJobStateLabel("connection_failed", "AUTH_FAILED")).toBe(
      "Connection failed"
    );
    expect(remoteJobStateLabel("handed_off")).toBe("Installer sent");
  });
  it("closes a proven undispatched job without queuing or launching it", () => {
    expect(reconciliationOutcome({ state: "absent" })).toEqual({
      state: "blocked",
      errorCode: "RECONCILE_NOT_DISPATCHED",
      clearSecrets: true,
    });
  });
  it.each(["unknown", "prepared"] as const)(
    "keeps %s uncertain without releasing secrets or dispatching",
    state => {
      expect(reconciliationOutcome({ state })).toBeNull();
    }
  );
  it.each(["INSTALLER_EXITED", "TARGET_ALREADY_DISPATCHED", "RUNNER_FAILED"])(
    "keeps %s under review rather than falsely calling it an SSH failure",
    code => {
      expect(
        reconciliationOutcome({ state: "failed", errorCode: code })
      ).toEqual({
        state: "launch_uncertain",
        errorCode: code,
        clearSecrets: true,
      });
    }
  );
  it("retains actual launched and failed evidence", () => {
    expect(reconciliationOutcome({ state: "launched" })).toEqual({
      state: "handed_off",
      errorCode: null,
      clearSecrets: true,
    });
    expect(
      reconciliationOutcome({ state: "failed", errorCode: "WRONG_DISK" })
    ).toEqual({
      state: "blocked",
      errorCode: "WRONG_DISK",
      clearSecrets: true,
    });
  });
});
