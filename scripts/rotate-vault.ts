import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import mysql from "mysql2/promise";
import { config as loadDotenv } from "dotenv";

type AdminEnvelope = { ciphertext: string; iv: string; tag: string };
type AuthEnvelope = { v: 1; iv: string; data: string; tag: string };
type Db = {
  beginTransaction: () => Promise<unknown>;
  commit: () => Promise<unknown>;
  rollback: () => Promise<unknown>;
  execute: (sql: string, params?: unknown[]) => Promise<any>;
  end: () => Promise<unknown>;
};
type RotationOptions = {
  oldKey: Buffer;
  newKey: Buffer;
  dryRun?: boolean;
  keyId?: string;
};
type RotationSummary = {
  commands: number;
  deliverySecrets: number;
  accounts: number;
  envelopes: number;
  dryRun: boolean;
};

const ADMIN_AAD_PREFIX = "win11desk-control:v4:";
const DEFAULT_KEY_ID = "vault-v2";
const HEX_KEY = /^[0-9a-f]{64}$/i;

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RotationError";
  }
}

/** Parse a 32-byte vault key without ever including its value in an error. */
export function parseVaultKey(value: unknown, name: string): Buffer {
  if (typeof value !== "string" || !HEX_KEY.test(value.trim()))
    throw new RotationError(
      `${name} must be exactly 64 hexadecimal characters`
    );
  return Buffer.from(value.trim(), "hex");
}

function adminAad(value: string): Buffer {
  return Buffer.from(ADMIN_AAD_PREFIX + value, "utf8");
}

/** The envelope format used by server/control/admin.ts (base64 ciphertext, hex IV/tag). */
export function encryptAdminEnvelope(
  value: string,
  key: Buffer,
  associatedData: string
): AdminEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(adminAad(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptAdminEnvelope(
  envelope: AdminEnvelope,
  key: Buffer,
  associatedData: string
): string {
  if (!envelope || typeof envelope !== "object")
    throw new RotationError("Invalid admin envelope");
  const iv = Buffer.from(String(envelope.iv), "hex");
  const tag = Buffer.from(String(envelope.tag), "hex");
  if (
    iv.length !== 12 ||
    tag.length !== 16 ||
    typeof envelope.ciphertext !== "string"
  )
    throw new RotationError("Invalid admin envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(adminAad(associatedData));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new RotationError("Vault authentication failed");
  }
}

/** The JSON envelope format used by server/control/crypto.ts for MFA secrets. */
export function encryptAuthEnvelope(
  value: string,
  key: Buffer,
  associatedData: string
): AuthEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64url"),
    data: data.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptAuthEnvelope(
  envelope: AuthEnvelope,
  key: Buffer,
  associatedData: string
): string {
  if (
    !envelope ||
    envelope.v !== 1 ||
    typeof envelope.iv !== "string" ||
    typeof envelope.data !== "string" ||
    typeof envelope.tag !== "string"
  )
    throw new RotationError("Invalid authentication envelope");
  try {
    const iv = Buffer.from(envelope.iv, "base64url");
    const tag = Buffer.from(envelope.tag, "base64url");
    if (iv.length !== 12 || tag.length !== 16)
      throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new RotationError("Vault authentication failed");
  }
}

function parseJsonEnvelope(value: unknown): AdminEnvelope {
  if (typeof value !== "string")
    throw new RotationError("Invalid delivery envelope");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RotationError("Invalid delivery envelope");
  }
  if (!parsed || typeof parsed !== "object")
    throw new RotationError("Invalid delivery envelope");
  return parsed as AdminEnvelope;
}

function json(value: AdminEnvelope): string {
  return JSON.stringify(value);
}
function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}
function isPartial(values: readonly unknown[]): boolean {
  const present = values.map(nonEmpty).filter(Boolean).length;
  return present !== 0 && present !== values.length;
}
function rowError(table: string, id: unknown, cause: unknown): never {
  const message =
    cause instanceof RotationError
      ? cause.message
      : "Envelope validation failed";
  throw new RotationError(`${table} row ${String(id)}: ${message}`);
}

async function rows<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [result] = await db.execute(sql, params);
  return result as T[];
}

async function rewrapCommandRow(
  db: Db,
  row: any,
  oldKey: Buffer,
  newKey: Buffer,
  keyId: string,
  dryRun: boolean
): Promise<number> {
  const id = String(row.id);
  const digest = String(row.installer_digest);
  const version = Number(row.credential_version);
  const specs = [
    [
      "artifact",
      [row.artifact_ciphertext, row.artifact_iv, row.artifact_tag],
      `artifact:${id}:${digest}`,
    ],
    [
      "credential",
      [row.credential_ciphertext, row.credential_iv, row.credential_tag],
      `credential:${id}:${version}`,
    ],
    [
      "read token",
      [row.read_token_ciphertext, row.read_token_iv, row.read_token_tag],
      `read-token:${id}`,
    ],
    [
      "write token",
      [row.write_token_ciphertext, row.write_token_iv, row.write_token_tag],
      `write-token:${id}`,
    ],
  ] as const;
  const next: Record<string, string> = {};
  let changed = 0;
  for (const [name, parts, aad] of specs) {
    if (isPartial(parts))
      rowError(
        "wc_commands",
        id,
        new RotationError(`partial ${name} envelope`)
      );
    if (!nonEmpty(parts[0])) continue;
    try {
      const plain = decryptAdminEnvelope(
        {
          ciphertext: String(parts[0]),
          iv: String(parts[1]),
          tag: String(parts[2]),
        },
        oldKey,
        aad
      );
      const wrapped = encryptAdminEnvelope(plain, newKey, aad);
      const prefix =
        name === "read token"
          ? "read_token"
          : name === "write token"
            ? "write_token"
            : name;
      next[`${prefix}_ciphertext`] = wrapped.ciphertext;
      next[`${prefix}_iv`] = wrapped.iv;
      next[`${prefix}_tag`] = wrapped.tag;
      changed++;
    } catch (error) {
      rowError("wc_commands", id, error);
    }
  }
  if (changed) {
    next.artifact_key_id = keyId;
    next.credential_key_id = keyId;
  }
  if (!changed) return 0;
  if (dryRun) return changed;
  await db.execute(
    "UPDATE wc_commands SET artifact_ciphertext=?,artifact_iv=?,artifact_tag=?,artifact_key_id=?,credential_ciphertext=?,credential_iv=?,credential_tag=?,credential_key_id=?,read_token_ciphertext=?,read_token_iv=?,read_token_tag=?,write_token_ciphertext=?,write_token_iv=?,write_token_tag=? WHERE id=?",
    [
      next.artifact_ciphertext ?? row.artifact_ciphertext,
      next.artifact_iv ?? row.artifact_iv,
      next.artifact_tag ?? row.artifact_tag,
      next.artifact_key_id ?? row.artifact_key_id,
      next.credential_ciphertext ?? row.credential_ciphertext,
      next.credential_iv ?? row.credential_iv,
      next.credential_tag ?? row.credential_tag,
      next.credential_key_id ?? row.credential_key_id,
      next.read_token_ciphertext ?? row.read_token_ciphertext,
      next.read_token_iv ?? row.read_token_iv,
      next.read_token_tag ?? row.read_token_tag,
      next.write_token_ciphertext ?? row.write_token_ciphertext,
      next.write_token_iv ?? row.write_token_iv,
      next.write_token_tag ?? row.write_token_tag,
      id,
    ]
  );
  return changed;
}

async function rewrapDeliveryRow(
  db: Db,
  row: any,
  oldKey: Buffer,
  newKey: Buffer,
  dryRun: boolean
): Promise<number> {
  const id = String(row.command_id);
  try {
    const oldEnvelope = parseJsonEnvelope(row.capability_envelope);
    const plain = decryptAdminEnvelope(oldEnvelope, oldKey, `delivery:${id}`);
    const next = json(encryptAdminEnvelope(plain, newKey, `delivery:${id}`));
    if (!dryRun)
      await db.execute(
        "UPDATE wc_delivery_secrets SET capability_envelope=? WHERE command_id=?",
        [next, id]
      );
    return 1;
  } catch (error) {
    rowError("wc_delivery_secrets", id, error);
  }
}

async function rewrapAccountRow(
  db: Db,
  row: any,
  oldKey: Buffer,
  newKey: Buffer,
  dryRun: boolean
): Promise<number> {
  const id = String(row.id);
  const specs = [
    ["mfa_secret_envelope", row.mfa_secret_envelope],
    ["mfa_pending_envelope", row.mfa_pending_envelope],
  ] as const;
  const next: Record<string, string | null> = {};
  let changed = 0;
  for (const [column, raw] of specs) {
    if (!nonEmpty(raw)) continue;
    try {
      const plain = decryptAuthEnvelope(
        JSON.parse(String(raw)) as AuthEnvelope,
        oldKey,
        `mfa:${id}`
      );
      next[column] = JSON.stringify(
        encryptAuthEnvelope(plain, newKey, `mfa:${id}`)
      );
      changed++;
    } catch (error) {
      rowError("wc_accounts", id, error);
    }
  }
  if (!changed) return 0;
  if (!dryRun)
    await db.execute(
      "UPDATE wc_accounts SET mfa_secret_envelope=?,mfa_pending_envelope=? WHERE id=?",
      [
        next.mfa_secret_envelope ?? row.mfa_secret_envelope,
        next.mfa_pending_envelope ?? row.mfa_pending_envelope,
        id,
      ]
    );
  return changed;
}

/** Lock, validate, rewrap, and verify every supported secret in one transaction. */
export async function rotateDatabase(
  db: Db,
  options: RotationOptions
): Promise<RotationSummary> {
  const keyId = options.keyId ?? DEFAULT_KEY_ID;
  if (options.oldKey.length !== 32 || options.newKey.length !== 32)
    throw new RotationError("Vault keys must be 32 bytes");
  const dryRun = options.dryRun !== false;
  let summary: RotationSummary = {
    commands: 0,
    deliverySecrets: 0,
    accounts: 0,
    envelopes: 0,
    dryRun,
  };
  await db.beginTransaction();
  try {
    const commandRows = await rows<any>(
      db,
      "SELECT id,installer_digest,credential_version,artifact_ciphertext,artifact_iv,artifact_tag,artifact_key_id,credential_ciphertext,credential_iv,credential_tag,credential_key_id,read_token_ciphertext,read_token_iv,read_token_tag,write_token_ciphertext,write_token_iv,write_token_tag FROM wc_commands FOR UPDATE"
    );
    const deliveryRows = await rows<any>(
      db,
      "SELECT command_id,capability_envelope FROM wc_delivery_secrets FOR UPDATE"
    );
    const accountRows = await rows<any>(
      db,
      "SELECT id,mfa_secret_envelope,mfa_pending_envelope FROM wc_accounts FOR UPDATE"
    );
    for (const row of commandRows)
      summary.envelopes += await rewrapCommandRow(
        db,
        row,
        options.oldKey,
        options.newKey,
        keyId,
        dryRun
      );
    for (const row of deliveryRows)
      summary.envelopes += await rewrapDeliveryRow(
        db,
        row,
        options.oldKey,
        options.newKey,
        dryRun
      );
    for (const row of accountRows)
      summary.envelopes += await rewrapAccountRow(
        db,
        row,
        options.oldKey,
        options.newKey,
        dryRun
      );
    summary.commands = commandRows.length;
    summary.deliverySecrets = deliveryRows.length;
    summary.accounts = accountRows.length;
    if (dryRun) {
      await db.rollback();
      return summary;
    }
    // Every UPDATE above is followed by a complete new-key authentication pass before commit.
    const verifyCommands = await rows<any>(
      db,
      "SELECT id,installer_digest,credential_version,artifact_ciphertext,artifact_iv,artifact_tag,credential_ciphertext,credential_iv,credential_tag,read_token_ciphertext,read_token_iv,read_token_tag,write_token_ciphertext,write_token_iv,write_token_tag FROM wc_commands FOR UPDATE"
    );
    for (const row of verifyCommands) {
      const id = String(row.id),
        digest = String(row.installer_digest),
        version = Number(row.credential_version);
      const checks: [unknown[], string][] = [
        [
          [row.artifact_ciphertext, row.artifact_iv, row.artifact_tag],
          `artifact:${id}:${digest}`,
        ],
        [
          [row.credential_ciphertext, row.credential_iv, row.credential_tag],
          `credential:${id}:${version}`,
        ],
        [
          [row.read_token_ciphertext, row.read_token_iv, row.read_token_tag],
          `read-token:${id}`,
        ],
        [
          [row.write_token_ciphertext, row.write_token_iv, row.write_token_tag],
          `write-token:${id}`,
        ],
      ];
      for (const [parts, aad] of checks)
        if (nonEmpty(parts[0])) {
          try {
            decryptAdminEnvelope(
              {
                ciphertext: String(parts[0]),
                iv: String(parts[1]),
                tag: String(parts[2]),
              },
              options.newKey,
              aad
            );
          } catch (error) {
            rowError("wc_commands", id, error);
          }
        }
    }
    for (const row of await rows<any>(
      db,
      "SELECT command_id,capability_envelope FROM wc_delivery_secrets FOR UPDATE"
    )) {
      const id = String(row.command_id);
      try {
        decryptAdminEnvelope(
          parseJsonEnvelope(row.capability_envelope),
          options.newKey,
          `delivery:${id}`
        );
      } catch (error) {
        rowError("wc_delivery_secrets", id, error);
      }
    }
    for (const row of await rows<any>(
      db,
      "SELECT id,mfa_secret_envelope,mfa_pending_envelope FROM wc_accounts FOR UPDATE"
    )) {
      for (const raw of [row.mfa_secret_envelope, row.mfa_pending_envelope])
        if (nonEmpty(raw)) {
          try {
            decryptAuthEnvelope(
              JSON.parse(String(raw)) as AuthEnvelope,
              options.newKey,
              `mfa:${String(row.id)}`
            );
          } catch (error) {
            rowError("wc_accounts", row.id, error);
          }
        }
    }
    await db.commit();
    return summary;
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

function usage(): string {
  return [
    "Usage: rotate-vault --database NAME --maintenance-acknowledged [--apply --confirm ROTATE]",
    "",
    "Default is a read/validate dry-run; --apply is required for writes.",
    "OLD_VAULT_KEY and NEW_VAULT_KEY are read from the environment (or NEW_VAULT_KEY via --new-key-stdin).",
  ].join("\n");
}

function parseArgs(argv: string[]) {
  let database = "";
  let apply = false;
  let confirm = "";
  let maintenance = false;
  let newKeyStdin = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true } as const;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--new-key-stdin") {
      newKeyStdin = true;
      continue;
    }
    if (
      arg === "--maintenance" ||
      arg === "--maintenance-acknowledged" ||
      arg === "--app-stopped"
    ) {
      maintenance = true;
      continue;
    }
    if (arg === "--confirm") {
      confirm = argv[++i] ?? "";
      continue;
    }
    if (arg === "--database" || arg === "--database-name") {
      database = argv[++i] ?? "";
      continue;
    }
    throw new RotationError(`Unknown argument: ${arg}`);
  }
  return { help: false, database, apply, confirm, maintenance, newKeyStdin };
}

async function readNewKeyFromStdin(): Promise<string> {
  const rl = createInterface({ input, output, terminal: false });
  try {
    return (
      await rl.question("New vault key (hidden only by your terminal): ")
    ).trim();
  } finally {
    rl.close();
  }
}

function assertDatabaseUrl(database: string, env: NodeJS.ProcessEnv): URL {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new RotationError("DATABASE_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RotationError("DATABASE_URL is invalid");
  }
  if (parsed.protocol !== "mysql:")
    throw new RotationError("DATABASE_URL must use mysql://");
  if (!database || parsed.pathname.slice(1) !== database)
    throw new RotationError("DATABASE_URL database does not match --database");
  return parsed;
}

/** Remote grants are short-lived; drain them before rotating the persistent vault. */
export async function assertRemoteSecretsDrained(
  db: Pick<Db, "execute">
): Promise<void> {
  let pending: any[];
  try {
    [pending] = await db.execute(
      "SELECT id FROM wc_remote_secrets WHERE cleared_at IS NULL LIMIT 1"
    );
  } catch (error) {
    if ((error as any)?.code === "ER_NO_SUCH_TABLE") return;
    throw new RotationError(
      "Cannot verify remote credential maintenance state"
    );
  }
  if (pending.length)
    throw new RotationError(
      "Pending remote credentials exist. Disable new remote installs, drain/cancel queued jobs and allow secret expiry maintenance before stopping app/worker and rotating the vault."
    );
}

export async function runCli(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  loadDotenv({ path: env.DOTENV_CONFIG_PATH || ".env" });
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (!args.maintenance)
    throw new RotationError(
      "Refusing to run: acknowledge stopped application maintenance with --maintenance-acknowledged"
    );
  if (args.apply && args.confirm !== "ROTATE")
    throw new RotationError("--apply requires --confirm ROTATE");
  const databaseUrl = assertDatabaseUrl(args.database, env);
  const oldKey = parseVaultKey(env.OLD_VAULT_KEY, "OLD_VAULT_KEY");
  const newKeyText = args.newKeyStdin
    ? await readNewKeyFromStdin()
    : env.NEW_VAULT_KEY;
  const newKey = parseVaultKey(newKeyText, "NEW_VAULT_KEY");
  if (oldKey.equals(newKey))
    throw new RotationError("OLD_VAULT_KEY and NEW_VAULT_KEY must differ");
  const connection = await mysql.createConnection({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 3306),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.slice(1),
    timezone: "Z",
    ...(env.DATABASE_TLS === "1" ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await assertRemoteSecretsDrained(connection);
    const summary = await rotateDatabase(connection, {
      oldKey,
      newKey,
      dryRun: !args.apply,
    });
    console.log(
      `${summary.dryRun ? "Dry-run validated" : "Rotation committed"}: ${summary.envelopes} envelopes across ${summary.commands} commands, ${summary.deliverySecrets} delivery secrets, ${summary.accounts} accounts.`
    );
    return 0;
  } finally {
    await connection.end();
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && resolve(fileURLToPath(import.meta.url)) === entry) {
  runCli().catch(error => {
    console.error(
      error instanceof RotationError ? error.message : "Vault rotation failed"
    );
    process.exitCode = 1;
  });
}
