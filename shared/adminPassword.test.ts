import { describe, expect, it } from "vitest";
import {
  ADMIN_PASSWORD_HINT,
  ADMIN_PASSWORD_MIN_LENGTH,
  adminPasswordIssue,
} from "./adminPassword";

describe("clear administrator password policy", () => {
  it("explains the 15 character minimum rather than treating a new password as wrong", () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(15);
    const issue = adminPasswordIssue("a".repeat(14));
    expect(issue?.code).toBe("INVALID_PASSWORD_LENGTH");
    expect(issue?.message).toContain("14 characters");
    expect(issue?.message).toContain("at least 15 characters");
    expect(ADMIN_PASSWORD_HINT).toContain("15–128");
  });
  it("accepts the existing exact minimum and maximum without requiring new composition rules", () => {
    expect(adminPasswordIssue("a".repeat(15))).toBeNull();
    expect(adminPasswordIssue("a".repeat(128))).toBeNull();
    expect(adminPasswordIssue("a".repeat(129))?.message).toContain("128");
  });
  it("retains common-password blocking case insensitively", () => {
    for (const value of [
      "passwordpassword",
      "123456789012345",
      "letmeinletmein12",
      "changemechangeme",
    ])
      expect(adminPasswordIssue(value.toUpperCase())?.code).toBe(
        "WEAK_PASSWORD"
      );
  });
  it("allows a passphrase with spaces and does not trim or reveal a chosen password", () => {
    expect(adminPasswordIssue("one long unique phrase ")).toBeNull();
    const value = "hidden-example";
    expect(adminPasswordIssue(value)?.message).not.toContain(value);
  });
  it("rejects missing or non-string values clearly", () => {
    for (const value of [undefined, null, 123456789012345, {}, ""])
      expect(adminPasswordIssue(value)?.code).toBe("INVALID_PASSWORD_LENGTH");
  });
});
