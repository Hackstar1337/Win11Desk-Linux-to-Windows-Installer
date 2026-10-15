import { createHash } from "node:crypto";
import type { Express } from "express";

export const SETUP_V3_VERSION = "v3" as const;

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

/** Generic, immutable transport. The private installer is delivered only after its ticket POST. */
export const SETUP_V3_TEXT = `#!/usr/bin/env bash
# Win11Desk first-party setup launcher v3. Transport only; installer stays private.
set -euo pipefail
set +x
fail() { printf '%s\\n' "$1" >&2; exit 1; }
[[ "\$EUID" -eq 0 ]] || fail 'Run this command as root on the intended Linux VPS.'
umask 077
for tool in mktemp sha256sum wc rm mv chmod head sleep bash cat setsid; do command -v "\$tool" >/dev/null 2>&1 || fail "Required command is missing: \${tool}."; done
if ! command -v curl >/dev/null 2>&1 && ! (command -v wget >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1); then fail 'A bounded curl or wget downloader is required.'; fi
[[ "\$#" -eq 3 && "\$1" == '--origin' && "\$3" == '-y' ]] || fail 'Usage: setup.sh --origin ORIGIN -y.'
origin="\$2"; [[ "\${#origin}" -le 2048 ]] || fail 'Invalid delivery origin.'
if [[ ! "\$origin" =~ ^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?\$ && ! "\$origin" =~ ^http://localhost(:[0-9]+)?\$ ]]; then fail 'Invalid delivery origin.'; fi
if [[ "\$origin" =~ :([0-9]+)\$ ]]; then port="\${BASH_REMATCH[1]}"; [[ "\${#port}" -le 5 && "\$port" != 0* ]] || fail 'Invalid delivery origin.'; ((10#\$port >= 1 && 10#\$port <= 65535)) || fail 'Invalid delivery origin.'; [[ "\$origin" != https://*:* || "\$port" != 443 ]] || fail 'Invalid delivery origin.'; [[ "\$origin" != http://localhost:80 ]] || fail 'Invalid delivery origin.'; fi
read_field() { local limit="\$1" value; IFS= read -r -n "\$((limit + 1))" value || return 1; [[ "\${#value}" -le "\$limit" ]] || return 1; REPLY="\$value"; }
read_field 64 || fail 'Invalid launcher input.'; ticket="\$REPLY"
read_field 64 || fail 'Invalid launcher input.'; artifact_hash="\$REPLY"
extra=''; if IFS= read -r -n 1 extra || [[ -n "\$extra" ]]; then fail 'Invalid launcher input.'; fi
[[ "\$ticket" =~ ^[0-9a-f]{64}\$ && "\$artifact_hash" =~ ^[0-9a-f]{64}\$ ]] || fail 'Invalid launcher input.'
work="\$(mktemp -d /root/win11desk-launcher-v3.XXXXXX)" || fail 'Could not create a private temporary directory.'
chmod 700 "\$work"; part="\$work/artifact.part"; artifact="\$work/artifact.sh"; request="\$work/request.json"; marker="\$work/.download-ok"; url="\$origin/api/installer/launch/v3"; proto='=https'; [[ "\$origin" == http://localhost* ]] && proto='=http,https'; diag="\$(mktemp /root/win11desk-installer-v3.XXXXXX)"; chmod 600 "\$diag"; child=0; child_group=0; keep_diag=0
stop_tree() { local pid="\$1" sub; if [[ -r "/proc/\$pid/task/\$pid/children" ]]; then for sub in \$(cat "/proc/\$pid/task/\$pid/children" 2>/dev/null); do stop_tree "\$sub"; done; fi; kill "\$pid" 2>/dev/null || true; }
stop_child() { if [[ "\$child" -gt 0 ]]; then if [[ "\$child_group" -eq 1 ]]; then kill -- "-\$child" 2>/dev/null || true; else stop_tree "\$child"; fi; wait "\$child" 2>/dev/null || true; fi; child=0; child_group=0; }
finish() { stop_child; if [[ "\$keep_diag" -eq 0 ]]; then rm -f "\$diag"; fi; rm -rf "\$work"; }
on_signal() { stop_child; printf '%s\\n' 'Win11Desk: interrupted; outcome unconfirmed. Check dashboard and provider console before retrying.' >&2; exit 130; }
trap finish EXIT; trap on_signal INT TERM HUP
fetch_artifact() { local n; for n in 1 2 3; do rm -f "\$part" "\$request" "\$marker"; if command -v curl >/dev/null 2>&1 && printf '{"ticket":"%s"}' "\$ticket" | curl --proto "\$proto" --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 20 --max-time 90 --max-filesize 4194304 -H 'Content-Type: application/json' --data-binary @- -o "\$part" "\$url" 2>/dev/null && [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]]; then : > "\$marker"; fi; if [[ ! -f "\$marker" ]] && command -v wget >/dev/null 2>&1; then command -v timeout >/dev/null 2>&1 || return 1; rm -f "\$part" "\$request"; printf '{"ticket":"%s"}' "\$ticket" > "\$request"; chmod 600 "\$request"; if (ulimit -c 0 && ulimit -f 4096 && timeout 100s wget \$( [[ "\$origin" == https://* ]] && printf '%s' --https-only ) --timeout=90 --tries=1 --quiet --max-redirect=0 --header='Content-Type: application/json' --post-file="\$request" -O "\$part" "\$url" 2>/dev/null) && [[ -s "\$part" && "\$(wc -c < "\$part")" -le 4194304 ]]; then : > "\$marker"; fi; fi; [[ -f "\$marker" ]] && return 0; rm -f "\$part" "\$request" "\$marker"; [[ "\$n" -eq 3 ]] || sleep 1; done; return 1; }
run_activity() { local label="\$1"; shift; if [[ -t 1 ]]; then printf '%s ' "\$label"; set +e; "\$@" & child=\$!; set -e; local i=0 frames='|/-\\'; while kill -0 "\$child" 2>/dev/null; do printf '\\r%s %s' "\$label" "\${frames:i++%4:1}"; sleep .2; done; set +e; wait "\$child"; local code=\$?; set -e; child=0; printf '\\r%s %s\\n' "\$label" \$([[ \$code -eq 0 ]] && printf '%s' done || printf '%s' failed); return "\$code"; else printf '%s\\n' "\$label"; "\$@"; fi; }
run_activity 'Win11Desk: Downloading installer package' fetch_artifact || fail 'Installer package unavailable, revoked, expired, empty, or oversized.'
mv -f "\$part" "\$artifact"; printf '%s  %s\\n' "\$artifact_hash" "\$artifact" | sha256sum --check --status || fail 'Installer integrity mismatch.'
header="\$(head -c 256 "\$artifact" 2>/dev/null || true)"; shopt -s nocasematch; [[ "\$header" != *'<html'* && "\$header" != *'<!doctype html'* ]] || fail 'Installer response was not executable content.'; shopt -u nocasematch
rm -f "\$request" "\$marker"; unset -v origin url request part marker
unset -v ticket artifact_hash
printf '%s\n' 'Win11Desk: Preparing first stage.'
# New session owns only this installer pipeline, so interrupt cleans its children.
# Drain stdout after a 256KiB cap instead of breaking the pipe or limiting ISO writes.
setsid bash -c 'set -o pipefail; bash "\$1" --install </dev/null 2>&1 | { head -c 262144 >"\$2"; cat >/dev/null; }' win11desk "\$artifact" "\$diag" & child=\$!; child_group=1
if [[ -t 1 ]]; then i=0; frames='|/-\\'; while kill -0 "\$child" 2>/dev/null; do printf '\r%s %s' 'Win11Desk: Preparing first stage' "\${frames:i++%4:1}"; sleep .2; done; fi
set +e; wait "\$child"; code=\$?; set -e; child=0; child_group=0
if [[ "\$code" -ne 0 ]]; then keep_diag=1; printf 'Win11Desk: Installer preparation failed (exit %s). Private diagnostics: %s\\n' "\$code" "\$diag" >&2; exit "\$code"; fi
rm -f "\$diag"; printf '%s\\n' 'Handoff prepared / VPS will reboot; follow dashboard.'
`;

export const SETUP_V3_SHA256 =
  "28cef62c58017bec84f7b4dd6e5f6fb41bc8fa72da1e1f7b5175693053482bbb";
if (
  createHash("sha256").update(SETUP_V3_TEXT, "utf8").digest("hex") !==
  SETUP_V3_SHA256
)
  throw new Error("Immutable setup v3 changed; use a new retained version.");

export function buildCleanSetupCommand(
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
  const setupUrl = `${origin}/setup/${SETUP_V3_VERSION}.sh`;
  const curlProto = origin.startsWith("https:") ? "=https" : "=http,https";
  const wgetTls = origin.startsWith("https:") ? " --https-only" : "";
  return `# PRIVATE: automatic disk-erasing installation and reboot.
(
set -euo pipefail; set +x; [[ "\$EUID" -eq 0 ]] || { echo 'Root required.' >&2; exit 1; }; umask 077
b="\$(mktemp -d /root/win11desk-bootstrap-v3.XXXXXX)"; trap 'rm -rf "\$b"' EXIT; l="\$b/setup.sh"; u=${bashQuote(setupUrl)}
f(){ rm -f "\$l"; if command -v curl >/dev/null 2>&1 && curl --proto '${curlProto}' --tlsv1.2 -fs -m90 --connect-timeout 15 --max-filesize 4194304 -o "\$l" "\$u" && [[ -s "\$l" && "\$(wc -c < "\$l")" -le 4194304 ]]; then return 0; fi; rm -f "\$l"; command -v wget >/dev/null 2>&1 && (ulimit -c 0 && ulimit -f 4096 && timeout 100s wget${wgetTls} -t1 -q --max-redirect=0 -O "\$l" "\$u") && [[ -s "\$l" && "\$(wc -c < "\$l")" -le 4194304 ]]; }; o=0; for n in 1 2 3; do if f; then o=1; break; fi; done
[[ "\$o" == 1 ]] || { echo 'Setup unavailable.' >&2; exit 1; }; printf '%s  %s\\n' ${bashQuote(SETUP_V3_SHA256)} "\$l" | sha256sum --check --status || { echo 'Setup hash mismatch.' >&2; exit 1; }
printf '%s\\n%s\\n' ${bashQuote(normalizedTicket)} ${bashQuote(normalizedHash)} | bash "\$l" --origin ${bashQuote(origin)} -y
)
`;
}

export function registerSetupV3Routes(app: Express): void {
  app.get("/setup/v3.sh", (_req, res) => {
    res
      .set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        ETag: `"${SETUP_V3_SHA256}"`,
      })
      .type("text/plain")
      .send(SETUP_V3_TEXT);
  });
}
