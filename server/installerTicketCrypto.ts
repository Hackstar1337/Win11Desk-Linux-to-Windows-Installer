import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { bashQuote } from "../shared/installer";

export const ticketLifetimeMs = 30 * 60 * 1000;
export const ticketDownloadLimit = 5;
export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
export function sealInstaller(script: string, userId: number) {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([
    cipher.update(script, "utf8"),
    cipher.final(),
  ]);
  return {
    row: {
      id,
      userId,
      secretHash: sha256(secret),
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      scriptHash: sha256(script),
      expiresAt: new Date(Date.now() + ticketLifetimeMs),
      downloads: 0,
    },
    token: `${id}.${secret}.${key.toString("base64url")}`,
  };
}
export function parseTicket(token: string) {
  if (!/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Invalid ticket");
  const [id, secret, key] = token.split(".");
  for (const value of [secret, key]) {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length !== 32 || decoded.toString("base64url") !== value)
      throw new Error("Invalid ticket");
  }
  return { id, secret, key: Buffer.from(key, "base64url") };
}
export function unsealInstaller(
  row: Omit<ReturnType<typeof sealInstaller>["row"], "id"> & { id: string },
  token: string
) {
  const parsed = parseTicket(token);
  if (
    parsed.id !== row.id ||
    row.expiresAt.getTime() <= Date.now() ||
    row.downloads >= ticketDownloadLimit
  )
    throw new Error("Ticket unavailable");
  const received = Buffer.from(sha256(parsed.secret));
  const expected = Buffer.from(row.secretHash);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error("Invalid ticket");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    parsed.key,
    Buffer.from(row.iv, "base64url")
  );
  decipher.setAAD(Buffer.from(row.id));
  decipher.setAuthTag(Buffer.from(row.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  if (sha256(plaintext) !== row.scriptHash)
    throw new Error("Integrity check failed");
  return plaintext;
}
export function oneCommand(origin: string, token: string, scriptHash: string) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw new Error("Public HTTPS origin required");
  parseTicket(token);
  if (!/^[a-f0-9]{64}$/.test(scriptHash)) throw new Error("Invalid digest");
  return `#!/usr/bin/env bash
# PRIVATE command: bearer ticket expires in 30 minutes. Never share it.
# Run in root SSH on the VPS. Confirmation identifies the actual disk before erasure.
(
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run as root: sudo -i, then paste this command.' >&2; exit 1; }
umask 077
work=$(mktemp -d /root/win11desk-command.XXXXXX)
trap 'rm -rf "$work"' EXIT
ticket=${bashQuote(token)}
url=${bashQuote(origin + "/api/installer/run")}
tries=10
downloaded=0
while [[ "$tries" -gt 0 ]]; do
  if command -v curl >/dev/null; then
    if curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --connect-timeout 20 --max-time 90 -H "Authorization: Bearer $ticket" "$url" -o "$work/setup.sh"; then downloaded=1; break; fi
  elif command -v wget >/dev/null; then
    if wget --https-only --timeout=90 --tries=1 --header="Authorization: Bearer $ticket" "$url" -O "$work/setup.sh"; then downloaded=1; break; fi
  else echo 'Install curl or wget first.' >&2; exit 1; fi
  tries=$((tries-1))
  [[ "$tries" -gt 0 ]] && { echo "Download failed, $tries attempts remaining"; sleep 10; }
done
[[ "$downloaded" == 1 ]] || { echo 'Ticket expired, unavailable, or download failed. Generate a new command.' >&2; exit 1; }
unset ticket
printf '%s  %s\\n' ${bashQuote(scriptHash)} "$work/setup.sh" | sha256sum --check --status || { echo 'Installer hash mismatch.' >&2; exit 1; }
bash "$work/setup.sh" --install
)
`;
}
