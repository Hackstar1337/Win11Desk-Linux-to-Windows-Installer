#!/usr/bin/env bash
# Isolated container package test only. No disks, installer execution or credentials.
set -euo pipefail
image=${ALPINE_TEST_IMAGE:-caddy:2.10.2-alpine}
helper=$(mktemp /tmp/win11desk-alpine-helper.XXXXXX)
trap 'rm -f "$helper"' EXIT
pnpm exec tsx -e 'import {writeFileSync} from "node:fs";import {mediaDependenciesShell} from "./shared/installerMediaGuard";writeFileSync(process.argv[1],mediaDependenciesShell());' "$helper"
docker run --rm --network host --entrypoint /bin/sh -v "$helper:/test/helper.sh:ro" "$image" -c '
set -eu
printf "Alpine release: ";cat /etc/alpine-release
# Reproduce the live installer main-only repository state using the existing matching-release mirror.
grep "/main$" /etc/apk/repositories > /tmp/main.repo
cp /tmp/main.repo /etc/apk/repositories
if timeout 90 apk add --no-cache curl ca-certificates pv > /tmp/old-apk.log 2>&1; then
 echo "Unexpected: obsolete main-only combined transaction succeeded" >&2; exit 1
fi
grep -q "pv" /tmp/old-apk.log
printf "PASS reproduced old main-only transaction failure: "
grep -E "pv|no such package" /tmp/old-apk.log | head -3
# Remove curl to verify the core-transport installation path rather than relying on the image default.
if command -v curl >/dev/null 2>&1; then apk del curl >/dev/null 2>&1; fi
! command -v curl >/dev/null 2>&1
add_community_repo() {
 mirror=$(grep "/main$" /etc/apk/repositories | head -1 | sed "s,/main$,/community,")
 [ -n "$mirror" ] || return 1
 printf "%s\n" "$mirror" >> /etc/apk/repositories
}
. /test/helper.sh
win11desk_media_prepare
win11desk_media_https_ready
command -v pv >/dev/null
printf "PASS repaired helper installs required curl/CA and optional pv after matching-release community setup\n"
# Real certificate-verified network access; no full ISO transfer or private callback.
curl --proto "=https" --proto-redir "=https" --tlsv1.2 --fail --silent --show-error --connect-timeout 10 --max-time 30 https://installer.d3m0nbox.online/api/health
printf "\nPASS trusted HTTPS health fetch\n"
# Required transport already exists: deliberately fail only optional pv acquisition.
apk del pv >/dev/null 2>&1
win11desk_media_apk_add(){ return 2; }
win11desk_media_prepare
win11desk_media_https_ready
printf "PASS optional meter failure does not abort ready HTTPS transport\n"
'
