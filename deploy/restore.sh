#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# -eq 1 && -f "$1" ]] || { echo 'Usage deploy/restore.sh BACKUP.sql.enc' >&2; exit 1; }
file=$(realpath "$1")
echo 'RESTORE writes this database. Rehearse on a fresh isolated database; retain matching vault key and deletion tombstones.'
read -rp 'Type RESTORE THIS DATABASE: ' confirm
[[ "$confirm" == 'RESTORE THIS DATABASE' ]] || exit 1
read -rsp 'Encryption passphrase: ' pass;echo
umask 077;work=$(mktemp -d);trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$file" -out "$work/restore.sql" -pass fd:3 3<<<"$pass"
unset pass
docker compose stop app remote-worker
docker compose exec -T database sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' < "$work/restore.sql"
echo 'Verify restored counts/keys/deletion policy before restarting services. Keep remote-worker stopped until restored pending/uncertain jobs have been reviewed; start only app initially.'
