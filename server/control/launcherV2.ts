import { createHash } from "node:crypto";
import type { Express } from "express";

export const SETUP_V2_VERSION = "v2" as const;

const HEX64_RE = /^[0-9a-f]{64}$/i;
const ORIGIN_HOST_RE =
  /[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*/;
const HTTPS_ORIGIN_RE = new RegExp(
  `^https://${ORIGIN_HOST_RE.source}(?::[0-9]{1,5})?$`
);
const LOCAL_HTTP_ORIGIN_RE = /^http:\/\/localhost(?::[0-9]{1,5})?$/;

function bashQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/[\u0000-\u0020\u007f'"`$\\]/.test(value)) return false;
  if (!HTTPS_ORIGIN_RE.test(value) && !LOCAL_HTTP_ORIGIN_RE.test(value))
    return false;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== value ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return false;
    const port = parsed.port ? Number(parsed.port) : null;
    return (
      port === null || (Number.isInteger(port) && port >= 1 && port <= 65535)
    );
  } catch {
    return false;
  }
}

/**
 * This text is a generic transport-only setup program. It is deliberately
 * pinned: settings and the installer implementation are delivered privately.
 */
export const SETUP_V2_TEXT = `#!/usr/bin/env bash
# Win11Desk first-party setup launcher v2. Immutable and non-interactive.
set -euo pipefail
set +x
fail() { printf '%s\\n' "$1" >&2; exit 1; }
[[ "\$EUID" -eq 0 ]] || fail 'Run this command as root on the intended Linux VPS.'
umask 077
for tool in mktemp sha256sum wc rm mv chmod head sleep bash; do command -v "\$tool" >/dev/null 2>&1 || fail "Required command is missing: \${tool}."; done
if ! command -v curl >/dev/null 2>&1 && ! (command -v wget >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1); then fail 'A bounded curl or wget downloader is required.'; fi
[[ "\$#" -eq 3 && "\$1" == '--origin' && "\$3" == '-y' ]] || fail 'Usage: setup.sh --origin ORIGIN -y.'
origin="\$2"; [[ "\${#origin}" -le 2048 ]] || fail 'Invalid delivery origin.'
if [[ ! "\$origin" =~ ^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?\$ && ! "\$origin" =~ ^http://localhost(:[0-9]+)?\$ ]]; then fail 'Invalid delivery origin.'; fi
if [[ "\$origin" =~ :([0-9]+)\$ ]]; then port="\${BASH_REMATCH[1]}"; [[ "\${#port}" -le 5 ]] || fail 'Invalid delivery origin.'; ((10#\$port >= 1 && 10#\$port <= 65535)) || fail 'Invalid delivery origin.'; [[ "\$port" != 0* ]] || fail 'Invalid delivery origin.'; [[ "\$origin" != https://*:* || "\$port" != 443 ]] || fail 'Invalid delivery origin.'; [[ "\$origin" != http://localhost:80 ]] || fail 'Invalid delivery origin.'; fi
read_field() { local limit="\$1" value; IFS= read -r -n "\$((limit + 1))" value || return 1; [[ "\${#value}" -le "\$limit" ]] || return 1; REPLY="\$value"; }
read_field 64 || fail 'Invalid launcher input.'; ticket="\$REPLY"
read_field 64 || fail 'Invalid launcher input.'; artifact_hash="\$REPLY"
extra=''; if IFS= read -r -n 1 extra || [[ -n "\$extra" ]]; then fail 'Invalid launcher input.'; fi
[[ "\$ticket" =~ ^[0-9a-f]{64}\$ && "\$artifact_hash" =~ ^[0-9a-f]{64}\$ ]] || fail 'Invalid launcher input.'
work="\$(mktemp -d /root/win11desk-launcher-v2.XXXXXX)" || fail 'Could not create a private temporary directory.'
chmod 700 "\$work"; trap 'rm -rf "\$work"' EXIT
part="\$work/artifact.part"; artifact="\$work/artifact.sh"; request="\$work/request.json"; marker="\$work/.download-ok"; url="\$origin/api/installer/launch/v2"; proto='=https'; [[ "\$origin" == http://localhost* ]] && proto='=http,https'
downloaded=0
for attempt in 1 2 3; do
  rm -f "\$part" "\$request" "\$marker"
  if command -v curl >/dev/null 2>&1; then
    if printf '{"ticket":"%s"}' "\$ticket" | curl --proto "\$proto" --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 --max-filesize 4194304 -H 'Content-Type: application/json' --data-binary @- -o "\$part" "\$url"; then
      [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]] && : > "\$marker"
    fi
  fi
  if [[ ! -f "\$marker" ]] && command -v wget >/dev/null 2>&1; then
    command -v timeout >/dev/null 2>&1 || fail 'Bounded wget fallback requires timeout.'
    rm -f "\$part" "\$request"; printf '{"ticket":"%s"}' "\$ticket" > "\$request"; chmod 600 "\$request"
    if [[ "\$origin" == https://* ]]; then wget_args=(--https-only); else wget_args=(); fi; if (ulimit -c 0 && ulimit -f 4096 && timeout 100s wget "\${wget_args[@]}" --timeout=90 --tries=1 --quiet --max-redirect=0 --header='Content-Type: application/json' --post-file="\$request" -O "\$part" "\$url"); then
      [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]] && : > "\$marker"
    fi
  fi
  [[ -f "\$marker" ]] && break
  rm -f "\$part" "\$request" "\$marker"
  [[ "\$attempt" -eq 3 ]] || sleep 1
done
[[ -f "\$marker" && -s "\$part" ]] || fail 'Delivery expired, revoked, unavailable, or empty.'
mv -f "\$part" "\$artifact"
printf '%s  %s\\n' "\$artifact_hash" "\$artifact" | sha256sum --check --status || fail 'Installer integrity mismatch.'
header="\$(head -c 256 "\$artifact" 2>/dev/null || true)"; shopt -s nocasematch
[[ "\$header" != *'<html'* && "\$header" != *'<!doctype html'* ]] || fail 'Installer response was not executable content.'
rm -f "\$request" "\$marker"; unset -v ticket artifact_hash origin url request part marker downloaded attempt
bash "\$artifact" --install
`;

export const SETUP_V2_SHA256 =
  "b29b8dc8d5ab31acebe074bd60d6e6f84c5d15e5dfbe24c47263cd2fe1cf04d5";
if (
  createHash("sha256").update(SETUP_V2_TEXT, "utf8").digest("hex") !==
  SETUP_V2_SHA256
)
  throw new Error(
    "Immutable setup launcher v2 changed; publish a new retained version."
  );

export function buildPrivateSetupCommand(
  origin: string,
  ticket: string,
  artifactHash: string
): string {
  if (!validOrigin(origin))
    throw new Error("Delivery origin must be canonical HTTPS.");
  if (!HEX64_RE.test(ticket) || !HEX64_RE.test(artifactHash))
    throw new Error("Invalid private ticket or artifact hash.");
  const normalizedTicket = ticket.toLowerCase();
  const normalizedHash = artifactHash.toLowerCase();
  const setupUrl = `${origin}/setup/${SETUP_V2_VERSION}.sh`;
  const curlProto = origin.startsWith("https:") ? "=https" : "=http,https";
  return `#!/usr/bin/env bash
# PRIVATE: pasting this command authorizes an automatic disk-erasing install and reboot.
(
set -euo pipefail; set +x
[[ "\$EUID" -eq 0 ]] || { printf '%s\\n' 'Run as root on the intended Linux VPS.' >&2; exit 1; }; umask 077
for tool in mktemp sha256sum wc rm chmod sleep bash; do command -v "\$tool" >/dev/null 2>&1 || { printf '%s\\n' 'Required command is missing.' >&2; exit 1; }; done
if ! command -v curl >/dev/null 2>&1 && ! (command -v wget >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1); then printf '%s\\n' 'A bounded curl or wget downloader is required.' >&2; exit 1; fi
b=\"\$(mktemp -d /root/win11desk-bootstrap-v2.XXXXXX)\"; trap 'rm -rf \"\$b\"' EXIT; l=\"\$b/setup.sh\"; m=\"\$b/.download-ok\"; u=${bashQuote(setupUrl)}
for n in 1 2 3; do rm -f \"\$l\" \"\$m\"; if command -v curl >/dev/null 2>&1 && curl --proto '${curlProto}' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 --max-filesize 4194304 -o \"\$l\" \"\$u\" && [[ -s \"\$l\" && \"\$(wc -c < \"\$l\")\" -le 4194304 ]]; then : > \"\$m\"; fi; if [[ ! -f \"\$m\" ]] && command -v wget >/dev/null 2>&1; then (ulimit -c 0 && ulimit -f 4096 && timeout 100s wget --timeout=90 --tries=1 --quiet --max-redirect=0${origin.startsWith("https:") ? " --https-only" : ""} -O \"\$l\" \"\$u\") && [[ -s \"\$l\" && \"\$(wc -c < \"\$l\")\" -le 4194304 ]] && : > \"\$m\"; fi; [[ -f \"\$m\" ]] && break; done
[[ -f \"\$m\" ]] || { printf '%s\\n' 'Setup launcher unavailable or empty.' >&2; exit 1; }; printf '%s  %s\\n' ${bashQuote(SETUP_V2_SHA256)} \"\$l\" | sha256sum --check --status || { printf '%s\\n' 'Setup launcher integrity mismatch.' >&2; exit 1; }
printf '%s\\n%s\\n' ${bashQuote(normalizedTicket)} ${bashQuote(normalizedHash)} | bash \"\$l\" --origin ${bashQuote(origin)} -y
)
`;
}

export function registerSetupV2Routes(app: Express): void {
  app.get("/setup/v2.sh", (_req, res) => {
    res
      .set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        ETag: `"${SETUP_V2_SHA256}"`,
      })
      .type("text/plain")
      .send(SETUP_V2_TEXT);
  });
}
