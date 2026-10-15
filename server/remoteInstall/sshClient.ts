import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { lookup } from "node:dns/promises";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import ipaddr from "ipaddr.js";
import type {
  RemoteTarget,
  TargetInventory,
  RemoteReceipt,
} from "@shared/remoteInstall";
import { preflightTarget } from "./preflight.js";
import { launchTarget, reconcileTarget } from "./runner.js";

export type RemoteSshErrorCode =
  | "INVALID_TARGET"
  | "UNSAFE_TARGET"
  | "BLOCKED_TARGET"
  | "HOST_KEY_MISMATCH"
  | "HOST_KEY_UNAVAILABLE"
  | "CONNECTION_FAILED"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "CONNECTION_UNREACHABLE"
  | "SSH_HANDSHAKE_TIMEOUT"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "OUTPUT_LIMIT"
  | "CHANNEL_FAILED"
  | "PREFLIGHT_FAILED"
  | "PREFLIGHT_ORIGIN_INVALID"
  | "PREFLIGHT_TOOL_MISSING"
  | "PREFLIGHT_VIRTUALIZATION_UNSUPPORTED"
  | "PREFLIGHT_DISK_UNSUPPORTED"
  | "PREFLIGHT_DISK_AMBIGUOUS"
  | "PREFLIGHT_DATA_MOUNTS"
  | "PREFLIGHT_SECURE_BOOT_ENABLED"
  | "PREFLIGHT_ROOT_REQUIRED"
  | "PREFLIGHT_ARCH_UNSUPPORTED"
  | "PREFLIGHT_MEMORY_INSUFFICIENT"
  | "PREFLIGHT_CPU_INSUFFICIENT"
  | "PREFLIGHT_DISK_TOO_SMALL"
  | "PREFLIGHT_HOSTNAME_INVALID"
  | "PREFLIGHT_RUNNER_UNAVAILABLE"
  | "PREFLIGHT_HTTPS_UNREACHABLE"
  | "PREFLIGHT_OUTPUT_INVALID"
  | "PREFLIGHT_EXECUTION_FAILED"
  | "LAUNCH_FAILED"
  | "LAUNCH_UNCERTAIN"
  | "PROTOCOL_ERROR";

/** An intentionally secret-free, stable error for API and job-event boundaries. */
export class RemoteSshError extends Error {
  readonly name = "RemoteSshError";
  constructor(
    readonly code: RemoteSshErrorCode,
    message = safeMessage(code)
  ) {
    super(message);
  }
}

function safeMessage(code: RemoteSshErrorCode): string {
  const messages: Record<RemoteSshErrorCode, string> = {
    INVALID_TARGET: "The target address is invalid.",
    UNSAFE_TARGET: "The target address is not a permitted public address.",
    BLOCKED_TARGET: "The target address is blocked by server policy.",
    HOST_KEY_MISMATCH:
      "The target SSH host key did not match the approved fingerprint.",
    HOST_KEY_UNAVAILABLE: "The target SSH host key could not be read.",
    CONNECTION_FAILED:
      "Could not connect to SSH on this VPS. Check its Linux SSH service, SSH port and provider firewall.",
    CONNECTION_REFUSED:
      "This VPS refused the SSH connection. Check that SSH is running and the selected port is correct and allowed by the provider firewall.",
    CONNECTION_RESET:
      "The VPS closed the SSH connection before login completed. Check its SSH service and connection limits before testing again.",
    CONNECTION_UNREACHABLE:
      "The dashboard cannot reach this VPS over the network. Check its address, routing and provider firewall.",
    SSH_HANDSHAKE_TIMEOUT:
      "No SSH response was received on this port. Check that the VPS is running Linux and this is its SSH port, not its Windows RDP port.",
    AUTH_FAILED:
      "The VPS rejected the SSH login. Re-enter its current root password and check that password login is enabled.",
    TIMEOUT: "The target SSH operation timed out.",
    OUTPUT_LIMIT: "The target SSH operation returned too much output.",
    CHANNEL_FAILED: "The target SSH channel failed.",
    PREFLIGHT_FAILED: "The target did not pass the read-only preflight.",
    PREFLIGHT_ORIGIN_INVALID:
      "The dashboard callback URL is not a valid HTTPS origin. Ask the dashboard administrator to check its public URL.",
    PREFLIGHT_TOOL_MISSING:
      "A required Linux command is missing. Install the prerequisite through your Linux package manager and check again. No installation started.",
    PREFLIGHT_VIRTUALIZATION_UNSUPPORTED:
      "This target uses unsupported virtualization. A full x64 VM is required; container VPSs are not supported.",
    PREFLIGHT_DISK_UNSUPPORTED:
      "The root system disk is not a supported plain whole disk. LVM, RAID and encrypted root disks require a separately reviewed path.",
    PREFLIGHT_DISK_AMBIGUOUS:
      "The check could not identify exactly one root system disk. No disk was selected and no installation started.",
    PREFLIGHT_DATA_MOUNTS:
      "The system disk contains additional mounted data. Review or move that data before installing; no installation started.",
    PREFLIGHT_SECURE_BOOT_ENABLED:
      "Secure Boot is enabled. The retained installer requires it disabled through the VPS provider settings.",
    PREFLIGHT_ROOT_REQUIRED:
      "The SSH session must be root. No installation started.",
    PREFLIGHT_ARCH_UNSUPPORTED:
      "An x86_64 Linux VPS is required. ARM and non-Linux targets are not supported.",
    PREFLIGHT_MEMORY_INSUFFICIENT:
      "The VPS does not meet the retained installer memory requirement (approximately 4 GB nominal and 1 GB usable). No installation started.",
    PREFLIGHT_CPU_INSUFFICIENT:
      "At least 2 CPU cores are required. No installation started.",
    PREFLIGHT_DISK_TOO_SMALL:
      "The root system disk must be at least 64 GB. No installation started.",
    PREFLIGHT_HOSTNAME_INVALID:
      "The Linux hostname cannot be safely bound to an installer. Use a valid hostname, then check again.",
    PREFLIGHT_RUNNER_UNAVAILABLE:
      "The target needs systemd-run or both setsid and nohup for a detached installation runner. No installation started.",
    PREFLIGHT_HTTPS_UNREACHABLE:
      "The target cannot reach the dashboard over verified HTTPS. Check its DNS, clock, CA certificates and outbound HTTPS access. No installation started.",
    PREFLIGHT_OUTPUT_INVALID:
      "The read-only check returned incomplete inventory. No installation started.",
    PREFLIGHT_EXECUTION_FAILED:
      "The read-only Bash check could not run. Verify bash and standard Linux tools are available to the root SSH session. No installation started.",

    LAUNCH_FAILED: "The remote launch was rejected before handoff.",
    LAUNCH_UNCERTAIN:
      "Remote launch state is uncertain; reconcile before retrying.",
    PROTOCOL_ERROR: "The target returned an invalid response.",
  };
  return messages[code];
}

export type TargetSession = {
  preflight(origin: string): Promise<TargetInventory>;
  launch(
    jobId: string,
    bootstrap: string,
    expected: TargetInventory
  ): Promise<RemoteReceipt>;
  reconcile(jobId: string): Promise<RemoteReceipt>;
  close(): void;
};

type ExecResult = { stdout: string; stderr: string };
type ExecOptions = {
  input?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};
type SessionExecutor = (
  command: string,
  options?: ExecOptions
) => Promise<ExecResult>;
const executors = new WeakMap<object, SessionExecutor>();

/** Used only by the fixed-command preflight/runner modules; it is not a shell API. */
export async function executeFixedCommand(
  session: TargetSession,
  command: string,
  options?: ExecOptions
): Promise<ExecResult> {
  const executor = executors.get(session as object);
  if (!executor) throw new RemoteSshError("CHANNEL_FAILED");
  return executor(command, options);
}

const MAX_COMMAND_OUTPUT = 256 * 1024;
const COMMAND_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 15_000;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]+={0,2}$/;

function normalizeFingerprint(value: string): string {
  return value.trim();
}

function fingerprintFromKey(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/g, "")}`;
}

function fail(code: RemoteSshErrorCode): never {
  throw new RemoteSshError(code);
}

export function asSafeError(
  error: unknown,
  fallback: RemoteSshErrorCode
): RemoteSshError {
  if (error instanceof RemoteSshError) return error;
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : "";
  const networkCode =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  if (networkCode === "ECONNREFUSED")
    return new RemoteSshError("CONNECTION_REFUSED");
  if (networkCode === "ECONNRESET" || networkCode === "EPIPE")
    return new RemoteSshError("CONNECTION_RESET");
  if (networkCode === "EHOSTUNREACH" || networkCode === "ENETUNREACH")
    return new RemoteSshError("CONNECTION_UNREACHABLE");
  if (/timed out.*handshake|handshake.*timed out/.test(text))
    return new RemoteSshError("SSH_HANDSHAKE_TIMEOUT");
  if (networkCode === "ETIMEDOUT") return new RemoteSshError("TIMEOUT");
  if (/connection (?:was )?(?:closed|lost)|socket hang up/.test(text))
    return new RemoteSshError("CONNECTION_RESET");
  if (/auth|authentication|permission denied/.test(text))
    return new RemoteSshError("AUTH_FAILED");
  if (/host|fingerprint|key/.test(text))
    return new RemoteSshError("HOST_KEY_MISMATCH");
  if (/timeout|timed out/.test(text)) return new RemoteSshError("TIMEOUT");
  return new RemoteSshError(fallback);
}

function ipToBytes(
  value: string
): { version: 4 | 6; bytes: Uint8Array } | null {
  const unbracketed = value.replace(/^\[|\]$/g, "");
  const version = isIP(unbracketed);
  if (version === 4) {
    const octets = unbracketed.split(".").map(Number);
    return { version: 4, bytes: Uint8Array.from(octets) };
  }
  if (version !== 6) return null;
  const [leftRaw, rightRaw] = unbracketed.split("::");
  const hasCompression = unbracketed.includes("::");
  const expand = (part: string): number[] => {
    if (!part) return [];
    const pieces = part.split(":");
    const out: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const ipv4 = ipToBytes(piece);
        if (!ipv4 || ipv4.version !== 4) return [];
        out.push(
          (ipv4.bytes[0] << 8) | ipv4.bytes[1],
          (ipv4.bytes[2] << 8) | ipv4.bytes[3]
        );
      } else out.push(parseInt(piece, 16));
    }
    return out;
  };
  const left = expand(leftRaw);
  const right = hasCompression ? expand(rightRaw) : [];
  if (
    left.some(v => !Number.isInteger(v) || v < 0 || v > 0xffff) ||
    right.some(v => !Number.isInteger(v) || v < 0 || v > 0xffff)
  )
    return null;
  if (
    (!hasCompression && left.length !== 8) ||
    (hasCompression && left.length + right.length >= 8)
  )
    return null;
  const groups = hasCompression
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : left;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return { version: 6, bytes };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

function startsWithBits(
  value: bigint,
  prefix: bigint,
  bits: number,
  width: number
): boolean {
  return value >> BigInt(width - bits) === prefix;
}

function isBlockedAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return true;
  let address = ipaddr.parse(value);
  if (
    address.kind() === "ipv6" &&
    (address as ipaddr.IPv6).isIPv4MappedAddress()
  )
    address = (address as ipaddr.IPv6).toIPv4Address();
  return address.range() !== "unicast";
}

export function canonicalIp(value: string): string {
  try {
    let parsed = ipaddr.parse(value);
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.kind() === "ipv6"
      ? (parsed as ipaddr.IPv6).toRFC5952String()
      : parsed.toString();
  } catch {
    return value.toLowerCase();
  }
}

function configuredBlockedIps(): string[] {
  return (process.env.REMOTE_BLOCKED_IPS ?? "").split(/[\s,]+/).filter(Boolean);
}

function configuredPublicUrlHost(): string | null {
  const value = process.env.APP_PUBLIC_URL?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return isIP(parsed.hostname) ? canonicalIp(parsed.hostname) : null;
  } catch {
    return null;
  }
}

async function configuredPublicUrlIps(): Promise<string[]> {
  const value = process.env.APP_PUBLIC_URL?.trim();
  if (!value) return [];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RemoteSshError("BLOCKED_TARGET");
  }
  if (isIP(parsed.hostname)) return [canonicalIp(parsed.hostname)];
  try {
    const records = await Promise.race([
      lookup(parsed.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), 2_000)
      ),
    ]);
    return records.map(record => canonicalIp(record.address));
  } catch {
    throw new RemoteSshError("BLOCKED_TARGET");
  }
}

/** Fail closed for every non-literal or non-public target. */
export async function assertPublicTarget(target: RemoteTarget): Promise<void> {
  if (
    !target ||
    target.username !== "root" ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535
  )
    fail("INVALID_TARGET");
  const host = target.host.trim();
  if (!ipaddr.isValid(host) || isIP(host) === 0) fail("INVALID_TARGET");
  const normalized = canonicalIp(host);
  if (isBlockedAddress(host)) fail("UNSAFE_TARGET");
  const configured = new Set(configuredBlockedIps().map(ip => canonicalIp(ip)));
  if (configured.has(normalized) || configured.has(host.toLowerCase()))
    fail("BLOCKED_TARGET");
  if (configuredPublicUrlHost() === normalized) fail("BLOCKED_TARGET");
  if ((await configuredPublicUrlIps()).includes(normalized))
    fail("BLOCKED_TARGET");
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address && canonicalIp(address.address) === normalized)
        fail("BLOCKED_TARGET");
    }
  }
}

function extractKeyType(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9@._+-]+$/.test(value))
    return value;
  if (Buffer.isBuffer(value) && value.length >= 4) {
    const length = value.readUInt32BE(0);
    const type = value.subarray(4, 4 + length).toString("ascii");
    if (/^[A-Za-z0-9@._+-]+$/.test(type)) return type;
  }
  return "unknown";
}

function connectRaw(
  target: RemoteTarget,
  config: ConnectConfig,
  verifier: (key: Buffer, verify: (valid: boolean) => void) => void
): Promise<{ client: Client; keyType: string }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let keyType = "unknown";
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) {
        client.end();
        reject(asSafeError(error, "CONNECTION_FAILED"));
      } else resolve({ client, keyType });
    };
    client.once("handshake", info => {
      keyType = info.serverHostKey;
    });
    client.once("ready", () => done());
    // ssh2 can emit a second protocol/socket error after a timeout or end().
    // Keep a guarded listener so a late error cannot crash the app/worker.
    client.on("error", error => done(error));
    client.once("close", () => done(new RemoteSshError("CONNECTION_RESET")));
    try {
      client.connect({
        ...config,
        host: target.host,
        port: target.port,
        username: target.username,
        hostVerifier: verifier,
        readyTimeout: CONNECT_TIMEOUT_MS,
        tryKeyboard: false,
        agent: undefined,
        privateKey: undefined,
        password: config.password,
      });
    } catch (error) {
      done(error);
    }
  });
}

export async function discoverHost(
  target: RemoteTarget
): Promise<{ fingerprint: string; keyType: string }> {
  await assertPublicTarget(target);
  let fingerprint = "";
  let keyType = "unknown";
  try {
    const result = await connectRaw(
      target,
      { username: target.username },
      (key, verify) => {
        fingerprint = fingerprintFromKey(key);
        keyType = extractKeyType(key);
        verify(false);
      }
    );
    keyType = result.keyType;
    result.client.end();
  } catch (error) {
    if (!fingerprint) throw asSafeError(error, "HOST_KEY_UNAVAILABLE");
  }
  if (!FINGERPRINT_RE.test(fingerprint))
    throw new RemoteSshError("HOST_KEY_UNAVAILABLE");
  return { fingerprint, keyType };
}

function createSession(client: Client): TargetSession {
  const session: TargetSession = {
    preflight: origin => preflightTarget(session, origin),
    launch: (jobId, bootstrap, expected) =>
      launchTarget(session, jobId, bootstrap, expected),
    reconcile: jobId => reconcileTarget(session, jobId),
    close: () => client.end(),
  };
  executors.set(session, (command, options = {}) =>
    execute(client, command, options)
  );
  return session;
}

export async function connectTarget(
  target: RemoteTarget,
  password: string,
  fingerprint: string
): Promise<TargetSession> {
  await assertPublicTarget(target);
  if (!FINGERPRINT_RE.test(normalizeFingerprint(fingerprint)))
    throw new RemoteSshError("HOST_KEY_MISMATCH");
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.includes("\0")
  )
    throw new RemoteSshError("AUTH_FAILED");
  try {
    const { client } = await connectRaw(
      target,
      { username: target.username, password },
      (key, verify) => {
        verify(fingerprintFromKey(key) === normalizeFingerprint(fingerprint));
      }
    );
    return createSession(client);
  } catch (error) {
    throw asSafeError(error, "CONNECTION_FAILED");
  }
}

function execute(
  client: Client,
  command: string,
  options: ExecOptions
): Promise<ExecResult> {
  if (command.length > 32 * 1024 || /[\0]/.test(command))
    return Promise.reject(new RemoteSshError("PROTOCOL_ERROR"));
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? COMMAND_TIMEOUT_MS, 100),
    COMMAND_TIMEOUT_MS
  );
  const maxBytes = Math.min(
    Math.max(options.maxOutputBytes ?? MAX_COMMAND_OUTPUT, 1024),
    MAX_COMMAND_OUTPUT
  );
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    let activeChannel: ClientChannel | undefined;
    let exitCode: number | null = null;
    const finish = (error?: RemoteSshError) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (error) {
        activeChannel?.destroy();
        reject(error);
      } else if (exitCode !== null && exitCode !== 0)
        reject(new RemoteSshError("CHANNEL_FAILED"));
      else resolve({ stdout, stderr });
    };
    const onData =
      (target: "stdout" | "stderr") => (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += text.length;
        if (bytes > maxBytes) {
          finish(new RemoteSshError("OUTPUT_LIMIT"));
          return;
        }
        if (target === "stdout") stdout += text.toString("utf8");
        else stderr += text.toString("utf8");
      };
    timer = setTimeout(() => finish(new RemoteSshError("TIMEOUT")), timeoutMs);
    try {
      client.exec(command, (error, channel: ClientChannel) => {
        if (error) {
          finish(asSafeError(error, "CHANNEL_FAILED"));
          return;
        }
        activeChannel = channel;
        channel.on("data", onData("stdout"));
        channel.stderr.on("data", onData("stderr"));
        channel.once("exit", (code: number | null) => {
          exitCode = code;
        });
        channel.once("error", () =>
          finish(new RemoteSshError("CHANNEL_FAILED"))
        );
        channel.once("close", () => finish());
        if (options.input !== undefined) channel.stdin.end(options.input);
        else channel.stdin.end();
      });
    } catch {
      finish(new RemoteSshError("CHANNEL_FAILED"));
    }
  });
}
