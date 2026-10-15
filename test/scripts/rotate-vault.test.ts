import { describe, expect, it } from "vitest";
import {
  decryptAdminEnvelope,
  decryptAuthEnvelope,
  encryptAdminEnvelope,
  encryptAuthEnvelope,
  parseVaultKey,
  rotateDatabase,
  RotationError,
} from "../../scripts/rotate-vault";

const oldKey = parseVaultKey("11".repeat(32), "OLD_VAULT_KEY");
const newKey = parseVaultKey("22".repeat(32), "NEW_VAULT_KEY");
const commandId = "00000000-0000-4000-8000-000000000001";
const digest = "aa".repeat(32);

function commandFixture(key: Buffer) {
  const wrap = (value: string, aad: string) => encryptAdminEnvelope(value, key, aad);
  const artifact = wrap("#!/bin/sh\nprintf immutable\\n", `artifact:${commandId}:${digest}`);
  const credential = wrap("password-value", `credential:${commandId}:7`);
  const read = wrap("read-token-value", `read-token:${commandId}`);
  const write = wrap("write-token-value", `write-token:${commandId}`);
  return {
    id: commandId,
    installer_digest: digest,
    credential_version: 7,
    artifact_ciphertext: artifact.ciphertext,
    artifact_iv: artifact.iv,
    artifact_tag: artifact.tag,
    artifact_key_id: "vault-v1",
    credential_ciphertext: credential.ciphertext,
    credential_iv: credential.iv,
    credential_tag: credential.tag,
    credential_key_id: "vault-v1",
    read_token_ciphertext: read.ciphertext,
    read_token_iv: read.iv,
    read_token_tag: read.tag,
    write_token_ciphertext: write.ciphertext,
    write_token_iv: write.iv,
    write_token_tag: write.tag,
  };
}

function authFixture(key: Buffer) {
  return JSON.stringify(encryptAuthEnvelope("TOTP-SECRET", key, `mfa:account-1`));
}

describe("vault rotation crypto helpers", () => {
  it("round-trips the admin AES-256-GCM format and generates a fresh IV", () => {
    const a = encryptAdminEnvelope("script bytes", oldKey, "artifact:id:hash");
    const b = encryptAdminEnvelope("script bytes", oldKey, "artifact:id:hash");
    expect(decryptAdminEnvelope(a, oldKey, "artifact:id:hash")).toBe("script bytes");
    expect(a.iv).not.toBe(b.iv);
    expect(() => decryptAdminEnvelope(a, newKey, "artifact:id:hash")).toThrow(RotationError);
    expect(() => decryptAdminEnvelope(a, oldKey, "artifact:id:other")).toThrow(RotationError);
  });

  it("round-trips the auth JSON envelope format used by MFA", () => {
    const envelope = encryptAuthEnvelope("MFA secret", oldKey, "mfa:account-1");
    expect(decryptAuthEnvelope(envelope, oldKey, "mfa:account-1")).toBe("MFA secret");
    expect(() => decryptAuthEnvelope(envelope, newKey, "mfa:account-1")).toThrow(RotationError);
  });
});

describe("rotateDatabase isolated fixtures", () => {
  it("validates old-key envelopes and performs no UPDATE in default dry-run", async () => {
    const command = commandFixture(oldKey);
    const delivery = encryptAdminEnvelope("delivery-capability", oldKey, `delivery:${commandId}`);
    const account = authFixture(oldKey);
    const updates: string[] = [];
    let rolledBack = false;
    const db = {
      async beginTransaction() {},
      async commit() { throw new Error("dry-run must not commit"); },
      async rollback() { rolledBack = true; },
      async end() {},
      async execute(sql: string) {
        if (/^UPDATE/i.test(sql)) updates.push(sql);
        if (sql.includes("FROM wc_commands")) return [[command]];
        if (sql.includes("FROM wc_delivery_secrets")) return [[{ command_id: commandId, capability_envelope: JSON.stringify(delivery) }]];
        if (sql.includes("FROM wc_accounts")) return [[{ id: "account-1", mfa_secret_envelope: account, mfa_pending_envelope: null }]];
        return [[]];
      },
    };
    const result = await rotateDatabase(db, { oldKey, newKey });
    expect(result).toMatchObject({ commands: 1, deliverySecrets: 1, accounts: 1, envelopes: 6, dryRun: true });
    expect(updates).toHaveLength(0);
    expect(rolledBack).toBe(true);
  });

  it("rejects a wrong old key before any update and rolls back", async () => {
    const command = commandFixture(oldKey);
    let rolledBack = false;
    const updates: string[] = [];
    const db = {
      async beginTransaction() {},
      async commit() {},
      async rollback() { rolledBack = true; },
      async end() {},
      async execute(sql: string) {
        if (/^UPDATE/i.test(sql)) updates.push(sql);
        if (sql.includes("FROM wc_commands")) return [[command]];
        if (sql.includes("FROM wc_delivery_secrets")) return [[]];
        if (sql.includes("FROM wc_accounts")) return [[]];
        return [[]];
      },
    };
    await expect(rotateDatabase(db, { oldKey: newKey, newKey: oldKey })).rejects.toThrow("Vault authentication failed");
    expect(updates).toHaveLength(0);
    expect(rolledBack).toBe(true);
  });
});
