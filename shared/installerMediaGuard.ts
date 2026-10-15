// pv lives in Alpine community; a missing optional meter must not break core HTTPS preparation.
export function mediaDependenciesShell() {
  return `win11desk_media_https_ready() {
  command -v curl >/dev/null 2>&1 && [ -s /etc/ssl/certs/ca-certificates.crt ] &&
    curl --version 2>/dev/null | grep -Eq '^Protocols:.*[[:space:]]https([[:space:]]|$)'
}
win11desk_media_apk_add() {
  # Bypass the upstream apk shell wrapper (which retries independently).
  # Live Alpine provides BusyBox timeout; never permit an unbounded package fetch.
  command -v timeout >/dev/null 2>&1 || return 1
  timeout 90 apk add --no-cache "$@" >/dev/null 2>&1
}
win11desk_media_prepare() {
  local attempt=1
  if ! win11desk_media_https_ready; then
    while [ "$attempt" -le 3 ]; do
      if win11desk_media_apk_add curl ca-certificates; then
        if command -v update-ca-certificates >/dev/null 2>&1; then
          update-ca-certificates >/dev/null 2>&1 || true
        fi
      fi
      win11desk_media_https_ready && break
      [ "$attempt" -eq 3 ] || sleep 3
      attempt=$((attempt + 1))
    done
  fi
  if ! win11desk_media_https_ready; then
    echo 'MEDIA_HTTPS_CLIENT_UNAVAILABLE: curl with HTTPS support and a trusted CA bundle could not be prepared after bounded retries. No media or partition operation started.' >&2
    return 1
  fi
  if ! command -v pv >/dev/null 2>&1; then
    # Use the pinned upstream helper: same existing mirror and running Alpine release,
    # never an edge repository injected into a stable live system.
    if command -v add_community_repo >/dev/null 2>&1; then
      if ! add_community_repo; then
        echo 'MEDIA_PROGRESS_UNAVAILABLE: optional progress repository could not be prepared; integrity verification remains enabled.' >&2
      fi
    fi
    if ! win11desk_media_apk_add pv; then
      echo 'MEDIA_PROGRESS_UNAVAILABLE: optional byte meter could not be installed; continuing with verified HTTPS and full SHA-256. Integrity percentage may be unavailable.' >&2
    fi
  fi
  return 0
}
`;
}

// Range probes validate content rather than trusting HTTP 200/HEAD for quota-limited hosts.
export function mediaProbeShell() {
  return `win11desk_media_probe() {
  local media_url="$1" probe code signature
  probe=$(mktemp /tmp/win11desk-iso-probe.XXXXXX) || return 1
  if ! code=$( (ulimit -f 128; curl --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --location --range 0-65535 --max-filesize 1048576 --retry 2 --connect-timeout 20 --max-time 90 "$media_url" -o "$probe" -w '%{http_code}' 2>/dev/null) ); then
    rm -f "$probe"; echo 'MEDIA_UNAVAILABLE: ISO download endpoint unavailable, expired, or not range-capable.' >&2; return 1
  fi
  if grep -qi 'quota exceeded\\|download quota\\|too many users' "$probe"; then
    rm -f "$probe"; echo 'MEDIA_QUOTA_EXCEEDED: Google Drive download quota reached. Use another accessible direct ISO source; no disk changes will proceed.' >&2; return 1
  fi
  signature=$(dd if="$probe" bs=1 skip=32769 count=5 2>/dev/null)
  rm -f "$probe"
  if [ "$code" != 206 ] && [ "$code" != 200 ]; then echo "MEDIA_UNAVAILABLE: ISO probe HTTP $code." >&2; return 1; fi
  if [ "$signature" != CD001 ]; then echo 'MEDIA_NOT_ISO: source returned an HTML/error page or unsupported media, not Windows installation ISO.' >&2; return 1; fi
}
`;
}
export function mediaVerifyShell() {
  return `win11desk_media_total_from_headers() {
  awk '
    tolower($0) ~ /^[[:space:]]*http\\/[0-9.]+[[:space:]]+[0-9]+/ { length_value=""; range_value=""; seen=1; next }
    seen && tolower($0) ~ /^[[:space:]]*content-length:[[:space:]]*[0-9]+/ {
      value=$0; sub(/^[^:]*:[[:space:]]*/, "", value); gsub(/[[:space:]]/, "", value)
      if (value ~ /^[0-9]+$/) length_value=value; next
    }
    seen && tolower($0) ~ /^[[:space:]]*content-range:[[:space:]]*bytes[[:space:]]+[0-9]+-[0-9]+\\/[0-9]+/ {
      value=tolower($0); sub(/^[^:]*:[[:space:]]*bytes[[:space:]]*[0-9]+-[0-9]+\\//, "", value); gsub(/[[:space:]]/, "", value)
      if (value ~ /^[0-9]+$/) range_value=value; next
    }
    END { if (range_value ~ /^[0-9]+$/) print range_value; else if (length_value ~ /^[0-9]+$/) print length_value }
  ' "$1" 2>/dev/null
}
win11desk_media_header_total() {
  local headers="$1" total
  [ -s "$headers" ] || return 0
  total=$(win11desk_media_total_from_headers "$headers")
  case "$total" in ''|*[!0-9]*) return 0 ;; esac
  printf '%s\\n' "$total"
}
win11desk_media_progress() {
  local downloaded="$1" total="$2" phase="\${3:-integrity}"
  case "$downloaded:$total" in *[!0-9:]*|:*) return 0 ;; esac
  if command -v track_progress >/dev/null 2>&1; then
    # total=0 explicitly means the origin did not disclose a trustworthy size.
    track_progress "$downloaded" "$total" "$phase" || true
  fi
}
win11desk_media_pv_bytes() {
  # pv -n -b emits the exact transferred byte count as a numeric side channel.
  tr '\\r' '\\n' < "$1" 2>/dev/null | awk '
    $1 ~ /^[0-9]+$/ { latest=$1 }
    END { if (latest ~ /^[0-9]+$/) print latest }
  '
}
win11desk_media_monitor() {
  local progress_file="$1" headers="$2" parent_pid="$3" tick=0 downloaded total interval=15 interval_override
  interval_override=$(printenv WIN11DESK_PROGRESS_INTERVAL 2>/dev/null || printf '')
  [ -n "$interval_override" ] && interval="$interval_override"
  trap 'exit 143' INT TERM HUP
  while [ "$tick" -lt 720 ]; do
    sleep "$interval"
    kill -0 "$parent_pid" 2>/dev/null || exit 0
    downloaded=$(win11desk_media_pv_bytes "$progress_file")
    case "$downloaded" in ''|*[!0-9]*) tick=$((tick + 1)); continue ;; esac
    total=$(win11desk_media_header_total "$headers")
    case "$total" in ''|*[!0-9]*) total=0 ;; esac
    win11desk_media_progress "$downloaded" "$total" integrity
    tick=$((tick + 1))
  done
}
win11desk_media_verify() {
  local media_url="$1" digest="$2" actual='' attempt=1 max_attempts=3 transfer_pid='' monitor_pid='' use_pv=0 total=0 downloaded interval=15 interval_override
  local work progress_file headers digest_file error_file
  work=$(mktemp -d /tmp/win11desk-media-verify.XXXXXX) || { echo 'MEDIA_TRANSFER_FAILED: unable to allocate verification workspace.' >&2; return 1; }
  progress_file="$work/progress"; headers="$work/headers"; digest_file="$work/digest"; error_file="$work/curl.error"
  command -v pv >/dev/null 2>&1 && use_pv=1
  interval_override=$(printenv WIN11DESK_PROGRESS_INTERVAL 2>/dev/null || printf '')
  [ -n "$interval_override" ] && interval="$interval_override"
  while [ "$attempt" -le "$max_attempts" ]; do
    # Every retry starts at zero. The ISO is never materialized: curl feeds pv
    # and sha256sum directly, so the complete digest is available first.
    rm -f "$progress_file" "$headers" "$digest_file" "$error_file"
    : > "$progress_file"
    win11desk_media_progress 0 0 integrity
    if [ "$use_pv" -eq 1 ]; then
      (set -o pipefail; curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --dump-header "$headers" --retry 0 --connect-timeout 20 --max-time 7200 --speed-time 120 --speed-limit 1024 "$media_url" 2>"$error_file" | pv -n -b -i "$interval" 2>"$progress_file" | sha256sum > "$digest_file") &
    else
      (set -o pipefail; curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --dump-header "$headers" --retry 0 --connect-timeout 20 --max-time 7200 --speed-time 120 --speed-limit 1024 "$media_url" 2>"$error_file" | sha256sum > "$digest_file") &
    fi
    transfer_pid=$!
    if [ "$use_pv" -eq 1 ]; then
      win11desk_media_monitor "$progress_file" "$headers" "$transfer_pid" &
      monitor_pid=$!
    fi
    if wait "$transfer_pid"; then
      [ -z "$monitor_pid" ] || { kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; monitor_pid=''; }
      actual=$(awk 'NF { print $1; exit }' "$digest_file" 2>/dev/null || printf '')
      total=$(win11desk_media_header_total "$headers")
      case "$total" in ''|*[!0-9]*) total=0 ;; esac
      if [ "$use_pv" -eq 1 ]; then
        downloaded=$(win11desk_media_pv_bytes "$progress_file")
        case "$downloaded" in ''|*[!0-9]*) downloaded=0 ;; esac
      else
        downloaded=0
      fi
      win11desk_media_progress "$downloaded" "$total" integrity
      rm -rf "$work"
      [ "$actual" = "$digest" ] || { echo 'ISO_SHA256_MISMATCH: complete ISO failed integrity before partition replacement.' >&2; return 1; }
      return 0
    fi
    [ -z "$monitor_pid" ] || { kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; monitor_pid=''; }
    downloaded=$(win11desk_media_pv_bytes "$progress_file")
    case "$downloaded" in ''|*[!0-9]*) downloaded=0 ;; esac
    total=$(win11desk_media_header_total "$headers")
    case "$total" in ''|*[!0-9]*) total=0 ;; esac
    win11desk_media_progress "$downloaded" "$total" integrity
    if [ "$attempt" -eq "$max_attempts" ]; then
      rm -rf "$work"
      echo 'MEDIA_TRANSFER_FAILED: complete ISO could not be verified; no partition changes started.' >&2
      return 1
    fi
    attempt=$((attempt + 1))
  done
  rm -rf "$work"
  echo 'MEDIA_TRANSFER_FAILED: complete ISO could not be verified; no partition changes started.' >&2
  return 1
}
`;
}
export function secondStageMediaGuardShell() {
  return `# Validate the media endpoint BEFORE create_part; HTTP200 alone may be Drive quota HTML.
WIN11_MEDIA_GUARD="$WORK/media-guard.sh"
cat > "$WIN11_MEDIA_GUARD" <<'MEDIAGUARD'
${mediaDependenciesShell()}${mediaProbeShell()}${mediaVerifyShell()}MEDIAGUARD
# Functions are portable ash; transfer this independent helper into configs.
awk '{ print } $0 == "    mkdir -p $initrd_dir/configs" { print "    cp /root/win11desk/media-guard.sh $initrd_dir/configs/" }' "$WORK/reinstall.sh" > "$WORK/reinstall.media.sh"
mv "$WORK/reinstall.media.sh" "$WORK/reinstall.sh"
# At runtime load helper, prepare HTTPS transport, validate source before any destructive partition operation.
awk -v digest="$ISO_SHA256" '
{ print }
index($0, "part_size=") && index($0, "size_bytes / 1024 / 1024 + 200") { print "        [ \\\"\${part_size%MiB}\\\" -ge 10440 ] || part_size=10440MiB" }
$0 == "trans() {" { print "    if [ \\"$distro\\" = windows ]; then"; print "        [ -s /configs/media-guard.sh ] || error_and_exit MEDIA_GUARD_MISSING"; print "        . /configs/media-guard.sh || error_and_exit MEDIA_GUARD_INVALID"; print "        win11desk_media_prepare || error_and_exit MEDIA_HTTPS_CLIENT_UNAVAILABLE"; print "        win11desk_media_probe \\"$iso\\" || error_and_exit MEDIA_PREFLIGHT_FAILED"; print "        win11desk_media_verify \\\"$iso\\\" \\\"" digest "\\\" || error_and_exit MEDIA_INTEGRITY_FAILED"; print "    fi" }
' "$WORK/trans.sh" > "$WORK/trans.media.sh"
mv "$WORK/trans.media.sh" "$WORK/trans.sh"
`;
}
