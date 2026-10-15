import { describe, expect, it } from "vitest";
import {
  installationDuration,
  transferProgress,
  rdpAddress,
  profileOptionLabel,
} from "./deploymentPresentation";
describe("truthful deployment presentation", () => {
  it("shows only saved profile names without merging distinct profile IDs", () => {
    expect(profileOptionLabel("Windows11Pro", "Windows 11 Pro")).toBe(
      "Windows11Pro"
    );
    expect(profileOptionLabel("Windows 11 Pro", "Windows 11 Pro")).toBe(
      "Windows 11 Pro"
    );
    expect(profileOptionLabel("  windows  11 pro  ", "Windows 11 Pro")).toBe(
      "windows  11 pro"
    );
    expect(profileOptionLabel("Company Europe", "Windows 11 Pro")).toBe(
      "Company Europe"
    );
    expect(profileOptionLabel("", "Windows 11 Pro")).toBe("Windows 11 Pro");
  });
  it("counts from Started and freezes at the persisted terminal timestamp", () => {
    const start = "2026-01-01T00:00:00Z",
      end = "2026-01-01T00:23:45Z";
    expect(installationDuration(start, null, Date.parse(end))).toBe("00:23:45");
    expect(
      installationDuration(start, end, Date.parse("2026-01-02T00:00:00Z"))
    ).toBe("00:23:45");
    expect(installationDuration(null, null)).toBe("—");
    expect(installationDuration(start, null, Date.parse(start) - 1000)).toBe(
      "00:00:00"
    );
  });
  it("does not convert null counters to fake zero progress", () => {
    expect(transferProgress(null, 1024).percent).toBeNull();
    expect(transferProgress(512, null).percent).toBeNull();
    expect(transferProgress(512, 1024).percent).toBe(50);
    expect(transferProgress(0, 1024).percent).toBe(0);
    expect(transferProgress(5, 0).percent).toBeNull();
    expect(transferProgress(-1, 1024).percent).toBeNull();
  });
  it("combines the actual RDP port and does not invent missing IP/port", () => {
    expect(rdpAddress("64.177.9.58", 22)).toBe("64.177.9.58:22");
    expect(rdpAddress(null, 22)).toBeNull();
    expect(rdpAddress("64.177.9.58", null)).toBeNull();
    expect(rdpAddress("2001:db8::1", 22)).toBe("[2001:db8::1]:22");
  });
});
