import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  oneCommand,
  sealInstaller,
  unsealInstaller,
  ticketDownloadLimit,
} from "./installerTicketCrypto";

describe("private installer command tickets", () => {
  it("stores encrypted script but not raw credentials or decryption key", () => {
    const script = "#!/bin/bash\n# synthetic password TEST_SECRET_12345\n";
    const ticket = sealInstaller(script, 12);
    expect(JSON.stringify(ticket.row)).not.toContain("TEST_SECRET_12345");
    expect(JSON.stringify(ticket.row)).not.toContain(
      ticket.token.split(".")[2]
    );
    expect(unsealInstaller(ticket.row, ticket.token)).toBe(script);
    const command = oneCommand(
      "https://example.com",
      ticket.token,
      ticket.row.scriptHash
    );
    expect(command).not.toContain("TEST_SECRET_12345");
    expect(command).toContain("Authorization: Bearer $ticket");
    expect(command).toContain("sha256sum --check --status");
    expect(command).toContain('bash "$work/setup.sh" --install');
    const dir = mkdtempSync(path.join(tmpdir(), "win11-command-syntax-"));
    try {
      const file = path.join(dir, "command.sh");
      writeFileSync(file, command);
      execFileSync("bash", ["-n", file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects expired, exhausted, invalid and tampered tickets", () => {
    const ticket = sealInstaller("test", 12);
    expect(() =>
      unsealInstaller({ ...ticket.row, expiresAt: new Date(0) }, ticket.token)
    ).toThrow();
    expect(() =>
      unsealInstaller(
        { ...ticket.row, downloads: ticketDownloadLimit },
        ticket.token
      )
    ).toThrow();
    expect(() =>
      unsealInstaller({ ...ticket.row, ciphertext: "AAAA" }, ticket.token)
    ).toThrow();
    expect(() =>
      unsealInstaller(
        ticket.row,
        ticket.token.replace(/.$/, ticket.token.endsWith("A") ? "B" : "A")
      )
    ).toThrow();
    expect(() =>
      oneCommand("http://example.com", ticket.token, ticket.row.scriptHash)
    ).toThrow();
    expect(() =>
      oneCommand(
        "https://example.com/unsafe",
        ticket.token,
        ticket.row.scriptHash
      )
    ).toThrow();
  });
});
