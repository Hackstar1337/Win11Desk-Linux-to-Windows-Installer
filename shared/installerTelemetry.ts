/**
 * Source patch for the Alpine second-stage installer.
 *
 * The upstream downloader may preallocate a sparse file, so its file size is
 * not a transfer counter. The pinned final ISO fetch is replaced with curl's
 * sequential output and a bounded monitor. The monitor reads the response
 * headers written by curl (the last redirect response wins), not a guessed
 * denominator. A missing Content-Length/Content-Range is reported as an
 * indeterminate total (zero in the shell callback contract).
 */
export function telemetryPatchShell(): string {
  return String.raw`# Replace only the verified final ISO fetch with measured, bounded telemetry.
ISO_LINE='    download $iso /os/windows.iso'
grep -Fxq "$ISO_LINE" "$WORK/trans.sh" || fail 'Pinned ISO telemetry hook changed.'
[ "$(grep -Fxc "$ISO_LINE" "$WORK/trans.sh")" = 1 ] || fail 'Pinned ISO telemetry hook is ambiguous.'
grep -Fxq 'set -eE' "$WORK/trans.sh" || fail 'Pinned telemetry initialization hook changed.'
TELEMETRY_FUNCTIONS="$WORK/telemetry.functions"
cat > "$TELEMETRY_FUNCTIONS" <<'WIN11DESK_TELEMETRY'
win11desk_total_from_headers() {
  # Header blocks are CRLF terminated and redirects append more blocks. Reset
  # on every HTTP status line so only the final response contributes a total.
  awk '
    tolower($0) ~ /^[[:space:]]*http\/[0-9.]+[[:space:]]+[0-9]+/ { length_value=""; range_value=""; seen=1; next }
    seen && tolower($0) ~ /^[[:space:]]*content-length:[[:space:]]*[0-9]+/ {
      value=$0; sub(/^[^:]*:[[:space:]]*/, "", value); gsub(/[[:space:]]/, "", value)
      if (value ~ /^[0-9]+$/) length_value=value; next
    }
    seen && tolower($0) ~ /^[[:space:]]*content-range:[[:space:]]*bytes[[:space:]]+[0-9]+-[0-9]+\/[0-9]+/ {
      value=tolower($0); sub(/^[^:]*:[[:space:]]*bytes[[:space:]]*[0-9]+-[0-9]+\//, "", value); gsub(/[[:space:]]/, "", value)
      if (value ~ /^[0-9]+$/) range_value=value; next
    }
    END { if (range_value ~ /^[0-9]+$/) print range_value; else if (length_value ~ /^[0-9]+$/) print length_value }
  ' "$1" 2>/dev/null
}
win11desk_header_total() {
  local headers="$1" total
  [ -s "$headers" ] || return 0
  total=$(win11desk_total_from_headers "$headers")
  case "$total" in ''|*[!0-9]*) return 0 ;; esac
  printf '%s\n' "$total"
}
win11desk_download_progress() {
  local downloaded="$1" total="$2"
  case "$downloaded:$total" in *[!0-9:]*|:*) return 0 ;; esac
  if command -v track_progress >/dev/null 2>&1; then
    # total=0 is the explicit indeterminate-total contract; never invent one.
    track_progress "$downloaded" "$total" payload || true
  fi
}
win11desk_download_monitor() {
  local destination="$1" headers="$2" parent_pid="$3" tick=0 downloaded total interval=15 interval_override
  interval_override=$(printenv WIN11DESK_PROGRESS_INTERVAL 2>/dev/null || printf '')
  [ -n "$interval_override" ] && interval="$interval_override"
  trap 'exit 143' INT TERM HUP
  while [ "$tick" -lt 720 ]; do
    sleep "$interval"
    kill -0 "$parent_pid" 2>/dev/null || exit 0
    downloaded=$(stat -c %s "$destination" 2>/dev/null || printf '')
    case "$downloaded" in ''|*[!0-9]*) tick=$((tick + 1)); continue ;; esac
    total=$(win11desk_header_total "$headers")
    case "$total" in ''|*[!0-9]*) total=0 ;; esac
    win11desk_download_progress "$downloaded" "$total"
    tick=$((tick + 1))
  done
}
win11desk_download_iso() {
  local iso_url="$1" destination="$2" attempt=1 max_attempts=5 monitor_pid='' curl_pid='' downloaded total headers
  local header_file="$WORK/iso.headers"
  case "$iso_url" in https://*) ;; *) error_and_exit ISO_URL_NOT_HTTPS; return 1 ;; esac
  [ "$destination" = /os/windows.iso ] || { error_and_exit ISO_DESTINATION_CHANGED; return 1; }
  while [ "$attempt" -le "$max_attempts" ]; do
    # Remove every prior attempt before reporting or writing. This prevents a
    # retry from inheriting stale bytes and reports the reset honestly.
    rm -f "$destination" "$header_file"
    win11desk_download_progress 0 0
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --dump-header "$header_file" --connect-timeout 20 --max-time 7200 --speed-time 120 --speed-limit 1024 "$iso_url" -o "$destination" &
    curl_pid=$!
    win11desk_download_monitor "$destination" "$header_file" "$curl_pid" &
    monitor_pid=$!
    if wait "$curl_pid"; then
      [ -z "$monitor_pid" ] || { kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; monitor_pid=''; }
      downloaded=$(stat -c %s "$destination" 2>/dev/null || printf '')
      case "$downloaded" in ''|*[!0-9]*) downloaded=0 ;; esac
      total=$(win11desk_header_total "$header_file")
      case "$total" in ''|*[!0-9]*) total=0 ;; esac
      win11desk_download_progress "$downloaded" "$total"
      return 0
    fi
    [ -z "$monitor_pid" ] || { kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; monitor_pid=''; }
    downloaded=$(stat -c %s "$destination" 2>/dev/null || printf '')
    case "$downloaded" in ''|*[!0-9]*) downloaded=0 ;; esac
    total=$(win11desk_header_total "$header_file")
    case "$total" in ''|*[!0-9]*) total=0 ;; esac
    win11desk_download_progress "$downloaded" "$total"
    rm -f "$destination" "$header_file"
    if [ "$attempt" -eq "$max_attempts" ]; then
      error_and_exit ISO_DOWNLOAD_FAILED
      return 1
    fi
    attempt=$((attempt + 1))
  done
  error_and_exit ISO_DOWNLOAD_FAILED
  return 1
}
WIN11DESK_TELEMETRY
awk -v functions="$TELEMETRY_FUNCTIONS" '
$0 == "set -eE" && inserted == 0 {
  print
  while ((getline line < functions) > 0) print line
  close(functions)
  inserted=1
  next
}
{ print }
END { if (inserted != 1) exit 1 }
' "$WORK/trans.sh" > "$WORK/trans.telemetry.sh" || fail 'Could not add bounded ISO telemetry.'
sed 's|^    download \$iso /os/windows.iso$|    win11desk_download_iso "$iso" "/os/windows.iso"|' "$WORK/trans.telemetry.sh" > "$WORK/trans.telemetry.replaced.sh"
grep -Fxq '    win11desk_download_iso "$iso" "/os/windows.iso"' "$WORK/trans.telemetry.replaced.sh" || fail 'Could not replace the exact ISO download hook.'
mv "$WORK/trans.telemetry.replaced.sh" "$WORK/trans.sh"
rm -f "$WORK/trans.telemetry.sh" "$TELEMETRY_FUNCTIONS"
`;
}
