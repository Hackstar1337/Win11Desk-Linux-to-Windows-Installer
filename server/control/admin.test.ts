import { describe, expect, it } from "vitest";
import {
  buildDeliveryCommand,
  commandStatus,
  safeCsvField,
  toCsv,
  validateCommandInput,
  validateProfileCommandInput,
} from "./admin";

const valid = {
  idempotencyKey: "idempotency-key-123456",
  username: "Administrator",
  password: "Safe password 123!",
  isoUrl: "https://example.com/windows.iso",
};

describe("control admin pure contracts", () => {
  it("requires configured profile identity and rejects every new media/target override", () => {
    const input = {
      idempotencyKey: "new-profile-only-key-12345",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileRevision: 2,
      password: "Win123!x",
    };
    expect(validateProfileCommandInput(input).profileRevision).toBe(2);
    expect(() =>
      validateProfileCommandInput({ idempotencyKey: input.idempotencyKey })
    ).toThrow(/profile/);
    for (const extra of [
      { isoUrl: "https://example.test/override.iso" },
      { target: {} },
      { input: { settings: {} } },
      { osId: "windows-11-pro" },
      { profileRevision: 0 },
    ])
      expect(() =>
        validateProfileCommandInput({ ...input, ...extra })
      ).toThrow();
  });
  it("accepts only direct HTTPS sources and rejects unknown fields", () => {
    expect(validateCommandInput(valid).isoUrl).toBe(valid.isoUrl);
    expect(() =>
      validateCommandInput({ ...valid, password: "short" })
    ).toThrow();
    expect(() => validateCommandInput({ ...valid, unknown: true })).toThrow(
      /Unsupported field/
    );
    expect(() =>
      validateCommandInput({
        ...valid,
        isoUrl: "http://example.com/windows.iso",
      })
    ).toThrow();
  });

  it("requires bounded unique-password batches", () => {
    expect(() =>
      validateCommandInput({ ...valid, count: 21, uniquePasswords: true })
    ).toThrow();
    expect(() => validateCommandInput({ ...valid, count: 2 })).toThrow(
      /uniquePasswords/
    );
    expect(
      validateCommandInput({ ...valid, count: 2, uniquePasswords: true }).count
    ).toBe(2);
  });

  it("builds a retrying HTTPS delivery command without a password or python dependency", () => {
    const command = buildDeliveryCommand(
      "https://dashboard.example",
      "11111111-1111-4111-8111-111111111111",
      "a".repeat(64),
      "b".repeat(64)
    );
    expect(command).toContain("/api/installer/delivery");
    expect(command).toContain("sha256sum --check --status");
    expect(command).toContain('bash "$t" --install');
    expect(command).toContain("for n in 1 2 3");
    expect(command).not.toContain("python");
    expect(command).not.toContain("password");
  });

  it("distinguishes terminal, stale, and active executions", () => {
    const at = Date.parse("2026-01-01T00:10:00Z");
    expect(commandStatus({ stage: "windows_ready" }, at)).toBe("completed");
    expect(commandStatus({ stage: "failed" }, at)).toBe("failed");
    expect(
      commandStatus(
        { stage: "downloading", lastHeartbeatAt: "2026-01-01T00:00:00Z" },
        at
      )
    ).toBe("stale");
    expect(
      commandStatus(
        { stage: "downloading", lastHeartbeatAt: "2026-01-01T00:09:00Z" },
        at
      )
    ).toBe("installing");
  });

  it("neutralizes spreadsheet formulas and excludes secrets from metadata CSV", () => {
    expect(safeCsvField('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    const csv = toCsv([
      {
        id: "run-1",
        label: "=danger",
        username: "Administrator",
        notes: "normal",
        password: "never export",
      },
    ]);
    expect(csv).toContain("'=danger");
    expect(csv).not.toContain("never export");
  });
});
