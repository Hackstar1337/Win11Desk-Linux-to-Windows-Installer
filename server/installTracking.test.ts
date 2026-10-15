import { describe, expect, it } from "vitest";
import {
  compareCapabilityHash,
  isCanonicalCapability,
  isCanonicalTrackingId,
  isTrackingExpiryValid,
  sha256Capability,
  trackingExpiryFrom,
  validateHostname,
  validatePublicIP,
  validateTrackingEvent,
  validateTrackingMetadata,
  validateWholeDisk,
} from "./installTracking";
import {
  canAdvanceInstallTrackingStage,
  hasWindowsProfessionalProof,
  hasWindowsReadyProof,
  installTrackingFreshness,
  INSTALL_TRACKING_STALE_MS,
} from "../shared/installTracking";

describe("durable installer tracking capabilities", () => {
  it("uses canonical ids/tokens and compares only the SHA-256 capability hash", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const token = "a".repeat(64);
    const hash = sha256Capability(token);
    expect(isCanonicalTrackingId(id)).toBe(true);
    expect(isCanonicalCapability(token)).toBe(true);
    expect(compareCapabilityHash(hash, token)).toBe(true);
    expect(compareCapabilityHash(hash, "b".repeat(64))).toBe(false);
    expect(compareCapabilityHash(hash, token.slice(0, -1))).toBe(false);
    expect(isCanonicalCapability("A".repeat(64))).toBe(false);
  });

  it("keeps the seven-day expiry boundary strict and does not accept expired groups", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const expiry = trackingExpiryFrom(now);
    expect(expiry.getTime() - now).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isTrackingExpiryValid(expiry, now)).toBe(true);
    expect(isTrackingExpiryValid(expiry, expiry.getTime())).toBe(false);
  });

  it("validates safe execution metadata without accepting path or network names", () => {
    expect(validateHostname("win11.example.test")).toBe("win11.example.test");
    expect(validateWholeDisk("/dev/nvme0n1")).toBe("/dev/nvme0n1");
    expect(validatePublicIP("2001:db8::1")).toBe("2001:db8::1");
    expect(() => validateHostname("bad host")).toThrow();
    expect(() => validateWholeDisk("/dev/sda; rm -rf /")).toThrow();
    expect(() => validatePublicIP("attacker.example")).toThrow();
    expect(() =>
      validateTrackingMetadata({
        hostname: "win11",
        wholeDisk: "/dev/sda",
        rdpPort: 3389,
        password: "must-not-be-stored",
      })
    ).toThrow();
  });

  it("allows only monotonic stages, with failed terminal", () => {
    expect(canAdvanceInstallTrackingStage("starting", "preflight")).toBe(true);
    expect(
      canAdvanceInstallTrackingStage("windows_setup", "windows_setup")
    ).toBe(true);
    expect(canAdvanceInstallTrackingStage("windows_setup", "preparing")).toBe(
      false
    );
    expect(canAdvanceInstallTrackingStage("windows_ready", "failed")).toBe(
      true
    );
    expect(canAdvanceInstallTrackingStage("failed", "windows_ready")).toBe(
      false
    );
  });

  it("requires Professional build proof for boot and a local listener for ready", () => {
    expect(hasWindowsProfessionalProof("Windows 11 Pro", 22631)).toBe(true);
    expect(hasWindowsProfessionalProof("Windows 11 Home", 22631)).toBe(false);
    expect(hasWindowsProfessionalProof("Windows 11 Professional", 21999)).toBe(
      false
    );
    expect(hasWindowsReadyProof("Windows 11 Pro", 22631, true)).toBe(true);
    expect(hasWindowsReadyProof("Windows 11 Pro", 22631, false)).toBe(false);
    expect(() =>
      validateTrackingEvent({ stage: "windows_booted" })
    ).not.toThrow();
  });

  it("marks an update stale as unknown after three minutes, never as failed", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(
      installTrackingFreshness(
        now + INSTALL_TRACKING_STALE_MS,
        now + INSTALL_TRACKING_STALE_MS
      )
    ).toBe("fresh");
    expect(
      installTrackingFreshness(now, now + INSTALL_TRACKING_STALE_MS + 1)
    ).toBe("unknown");
  });
});
