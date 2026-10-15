#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
read -rsp 'Backup encryption passphrase (16+ characters): ' pass; echo
[[ ${#pass} -ge 16 ]] || exit 1
read -rsp 'Confirm: ' confirm; echo
[[ "$pass" == "$confirm" ]] || exit 1
trap 'python3 deploy/write-backup-status.py --failed >/dev/null 2>&1 || true' ERR
folder=${1:-./backups};mkdir -p "$folder";chmod 700 "$folder"
file="$folder/win11desk-$(date -u +%Y%m%dT%H%M%SZ).sql.enc"
if ! docker compose exec -T database sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces --skip-lock-tables "$MYSQL_DATABASE"' | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -out "$file" -pass fd:3 3<<<"$pass";then rm -f "$file";python3 deploy/write-backup-status.py --failed >/dev/null 2>&1 || true;echo 'Backup failed' >&2;exit 1;fi
unset pass confirm
sha256sum "$file" > "$file.sha256"
python3 deploy/write-backup-status.py "$file"
trap - ERR
echo "Encrypted SQL saved: $file. Copy off-host and retain matching VAULT_KEY separately."
