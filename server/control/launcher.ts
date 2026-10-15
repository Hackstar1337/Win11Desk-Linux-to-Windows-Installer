import { createHash } from "node:crypto";
import type { Express } from "express";

export const LAUNCHER_VERSION = "v1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const REVISION_RE = /^[1-9][0-9]{0,9}$/;
const HTTPS_ORIGIN_RE =
  /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](?::[0-9]{1,5})?$/;
const LOCAL_HTTP_ORIGIN_RE = /^http:\/\/localhost(?::[0-9]{1,5})?$/;

/** Quote a value for a single-quoted POSIX/Bash literal. */
function bashQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/[\x00-\x20'"`$\\]/.test(value)) return false;
  if (!HTTPS_ORIGIN_RE.test(value) && !LOCAL_HTTP_ORIGIN_RE.test(value))
    return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === "/"
    );
  } catch {
    return false;
  }
}

function validRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
  );
}

/**
 * This text is intentionally pinned here rather than generated from a current
 * profile or installer. Old commands must continue to retrieve the exact
 * launcher version they were issued with.
 */
export const LAUNCHER_TEXT = `#!/usr/bin/env bash
# Win11Desk first-party launcher v1. Immutable and non-interactive.
set -euo pipefail
set +x
fail() { printf '%s\\n' "$1" >&2; exit 1; }
[[ "\$EUID" -eq 0 ]] || fail 'Run this command as root on the intended Linux VPS.'
umask 077
command -v mktemp >/dev/null 2>&1 || fail 'Required command is missing: mktemp.'
command -v sha256sum >/dev/null 2>&1 || fail 'Required command is missing: sha256sum.'
command -v wc >/dev/null 2>&1 || fail 'Required command is missing: wc.'
read_field() {
  local limit="\$1" value
  IFS= read -r -n "\$((limit + 1))" value || return 1
  [[ "\${#value}" -le "\$limit" ]] || return 1
  REPLY="\$value"
}
read_field 2048 || fail 'Invalid launcher input.'; origin="\$REPLY"
read_field 36 || fail 'Invalid launcher input.'; id="\$REPLY"
read_field 64 || fail 'Invalid launcher input.'; token="\$REPLY"
read_field 64 || fail 'Invalid launcher input.'; artifact_hash="\$REPLY"
read_field 36 || fail 'Invalid launcher input.'; profile_id="\$REPLY"
read_field 10 || fail 'Invalid launcher input.'; revision="\$REPLY"
extra=''
if IFS= read -r -n 1 extra || [[ -n "\$extra" ]]; then fail 'Invalid launcher input.'; fi
[[ "\$origin" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](:[0-9]{1,5})?\$ || "\$origin" =~ ^http://localhost(:[0-9]{1,5})?\$ ]] || fail 'Invalid delivery origin.'
if [[ "\$origin" =~ :([0-9]+)\$ ]] && ((10#\${BASH_REMATCH[1]} > 65535)); then fail 'Invalid delivery origin.'; fi
[[ "\$id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\$ ]] || fail 'Invalid launcher input.'
[[ "\$token" =~ ^[0-9a-fA-F]{64}\$ ]] || fail 'Invalid launcher input.'
[[ "\$artifact_hash" =~ ^[0-9a-fA-F]{64}\$ ]] || fail 'Invalid launcher input.'
[[ "\$profile_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\$ ]] || fail 'Invalid launcher input.'
[[ "\$revision" =~ ^[1-9][0-9]{0,9}\$ ]] || fail 'Invalid launcher input.'
((10#\$revision <= 2147483647)) || fail 'Invalid launcher input.'
work="\$(mktemp -d /root/win11desk-launcher.XXXXXX)" || fail 'Could not create a private temporary directory.'
chmod 700 "\$work"
trap 'rm -rf "\$work"' EXIT
part="\$work/setup.sh.part"
artifact="\$work/setup.sh"
request="\$work/request.json"
url="\$origin/api/installer/delivery"
json_body() { builtin printf '{"id":"%s","token":"%s","profileId":"%s","profileRevision":%s}' "\$id" "\$token" "\$profile_id" "\$revision"; }
downloaded=0
for attempt in 1 2 3; do
  rm -f "\$part"
  if command -v curl >/dev/null 2>&1; then
    if [[ "\$origin" == https://* ]]; then proto='=https'; else proto='=http,https'; fi
    if json_body | curl --proto "\$proto" --proto-redir "\$proto" --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 --max-filesize 4194304 -H 'Content-Type: application/json' --data-binary @- -o "\$part" "\$url"; then
      [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]] && downloaded=1
    fi
  fi
  if [[ "\$downloaded" -ne 1 ]] && command -v wget >/dev/null 2>&1; then
    command -v timeout >/dev/null 2>&1 || fail 'Bounded wget fallback requires timeout.'
    rm -f "\$part" "\$request"
    json_body > "\$request"
    chmod 600 "\$request"
    wget_args=(--timeout=90 --tries=1 --quiet --max-redirect=0 --header='Content-Type: application/json' --post-file="\$request" -O "\$part")
    [[ "\$origin" == https://* ]] && wget_args+=(--https-only)
    if timeout 100s wget "\${wget_args[@]}" "\$url"; then [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]] && downloaded=1; fi
  fi
  [[ "\$downloaded" -eq 1 ]] && break
  rm -f "\$part" "\$request"
  [[ "\$attempt" -eq 3 ]] || sleep 1
done
[[ "\$downloaded" -eq 1 && -s "\$part" ]] || fail 'Delivery expired, revoked, unavailable, or empty.'
mv -f "\$part" "\$artifact"
printf '%s  %s\\n' "\$artifact_hash" "\$artifact" | sha256sum --check --status || fail 'Installer integrity mismatch.'
rm -f "\$request"
unset -v token artifact_hash id profile_id revision
unset -f json_body
bash "\$artifact" --install
`;

// Frozen v1 release identity. Do not edit published v1 bytes: add a new version instead.
export const LAUNCHER_SHA256 =
  "e784ef51dad79e30213c5aa1ba89815fc8dcd0768ce08779ac6bdee3f7d709ac";
if (
  createHash("sha256").update(LAUNCHER_TEXT, "utf8").digest("hex") !==
  LAUNCHER_SHA256
)
  throw new Error(
    "Immutable launcher v1 changed; publish a new retained version."
  );

export function buildCompactDeliveryCommand(
  origin: string,
  id: string,
  token: string,
  artifactHash: string,
  profileId: string,
  revision: number
): string {
  if (!validOrigin(origin)) throw new Error("Delivery origin must be HTTPS.");
  if (!UUID_RE.test(id) || !UUID_RE.test(profileId))
    throw new Error("Invalid command identity.");
  if (!HEX64_RE.test(token) || !HEX64_RE.test(artifactHash))
    throw new Error("Invalid command capability or artifact hash.");
  if (!validRevision(revision)) throw new Error("Invalid profile revision.");

  const launcherUrl = `${origin}/api/installer/launcher/${LAUNCHER_VERSION}.sh`;
  const protocol = origin.startsWith("https:")
    ? { curl: "=https", wget: "--https-only" }
    : { curl: "=http,https", wget: "" };
  const wgetHttps = protocol.wget ? ` ${protocol.wget}` : "";
  const revisionText = String(revision);
  return `#!/usr/bin/env bash
# PRIVATE: pasting this command authorizes an automatic disk-erasing install and reboot.
(
set -euo pipefail; set +x
[[ "$EUID" -eq 0 ]] || { printf '%s\\n' 'Run as root on the intended Linux VPS.' >&2; exit 1; }
umask 077; command -v sha256sum >/dev/null || exit 1
w=$(mktemp -d /root/win11desk-bootstrap.XXXXXX); trap 'rm -rf "$w"' EXIT; u=${bashQuote(launcherUrl)}; l="$w/launcher"
ok() { [[ -s "$l" && $(wc -c < "$l") -le 4194304 ]]; }
fetch() { rm -f "$l"; if command -v curl >/dev/null 2>&1 && curl --proto '${protocol.curl}' --proto-redir '${protocol.curl}' --tlsv1.2 --fail --silent --show-error --location --connect-timeout 20 --max-time 90 --max-filesize 4194304 -o "$l" "$u" && ok; then return 0; fi; rm -f "$l"; if command -v wget >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1 && timeout 100s wget --timeout=90 --tries=1 --quiet${wgetHttps} -O "$l" "$u" && ok; then return 0; fi; return 1; }
for n in 1 2 3; do fetch && break; rm -f "$l"; done
ok || { printf '%s\\n' 'Launcher unavailable or empty.' >&2; exit 1; }
printf '%s  %s\\n' ${bashQuote(LAUNCHER_SHA256)} "$l" | sha256sum --check --status || { printf '%s\\n' 'Launcher integrity mismatch.' >&2; exit 1; }
printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n' ${bashQuote(origin)} ${bashQuote(id)} ${bashQuote(token.toLowerCase())} ${bashQuote(artifactHash.toLowerCase())} ${bashQuote(profileId)} ${bashQuote(revisionText)} | bash "$l"
)
`;
}

export function registerLauncherRoutes(app: Express): void {
  app.get(`/api/installer/launcher/${LAUNCHER_VERSION}.sh`, (_req, res) => {
    res
      .set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        ETag: `"${LAUNCHER_SHA256}"`,
      })
      .type("text/plain")
      .send(LAUNCHER_TEXT);
  });
}
