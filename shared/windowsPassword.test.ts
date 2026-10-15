import { describe, expect, it } from "vitest";
import { windowsPasswordIssue } from "./windowsPassword";
import { validateCommandInput } from "../server/control/admin";
import { adminPasswordIssue } from "./adminPassword";

const input = {
  idempotencyKey: "windows-eight-char-regression",
  username: "Administrator",
  isoUrl: "https://example.com/windows.iso",
};
describe("Windows password policy remains separate from admin login", () => {
  it("rejects seven, accepts eight and permits128 printable ASCII characters", () => {
    expect(windowsPasswordIssue("abcde12")).toMatch(/at least8|at least 8/);
    expect(windowsPasswordIssue("Win123!x")).toBeNull();
    expect(windowsPasswordIssue("x".repeat(128))).toBeNull();
    expect(windowsPasswordIssue("x".repeat(129))).toMatch(/128/);
    expect(() =>
      validateCommandInput({ ...input, password: "Win123!x" })
    ).not.toThrow();
    expect(() =>
      validateCommandInput({ ...input, password: "Win12!x" })
    ).toThrow();
  });
  it("rejects control characters and keeps admin minimum15", () => {
    expect(windowsPasswordIssue("password\n8")).toMatch(/printable/);
    expect(windowsPasswordIssue("unicode£88")).toMatch(/printable/);
    expect(adminPasswordIssue("Win123!x")).not.toBeNull();
  });
  it("accepts only the actual installer retry bounds", () => {
    expect(() =>
      validateCommandInput({ ...input, password: "Win123!x", retries: 20 })
    ).not.toThrow();
    expect(() =>
      validateCommandInput({ ...input, password: "Win123!x", retries: 21 })
    ).toThrow();
  });
});
