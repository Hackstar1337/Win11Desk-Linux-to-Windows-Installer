#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo 'First run python3 deploy/configure.py' >&2; exit 1; }
docker compose config --quiet
docker compose build app remote-worker
docker compose up -d --wait database
docker compose run --rm --no-deps app node dist/migrate.js
docker compose up -d app remote-worker proxy
echo 'Check HTTPS health and complete owner setup. Never delete DB volume/directory or regenerate vault keys during upgrades.'
