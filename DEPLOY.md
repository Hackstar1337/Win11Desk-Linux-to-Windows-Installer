# Win11Desk independent VPS deployment

The ZIP contains frontend/backend, custom email/password authentication, private MySQL, encrypted credential/artifact vault, installer delivery, tracking and source. No Manus login/API/database/storage is needed by production. The default ISO stays at your direct d3m0nbox.online URL; no mirror/fallback. Run the dashboard on a **separate permanent Linux VPS**, never on a target you erase.

## Requirements and first installation

Linux x86-64, Docker Engine/Compose v2, Python3/OpenSSL and your own dashboard domain pointed to this host. A provisional starting allocation is 2vCPU/4GBRAM/40GBpersistent disk; actual capacity depends on workload/retention. Inspect existing services/firewall/SSH before installing anything. Keep database private, inbound TCP80/443 available to Caddy and provider management access intact.

Extract ZIP into `/opt/win11desk` (or your chosen permanent release directory). Run:

```bash
python3 deploy/configure.py
bash deploy/start.sh
```

Configuration asks for your dashboard domain and creates `.env` mode600 with independent random DB/vault/bootstrap secrets. It refuses to overwrite an existing .env. No hardcoded admin account exists. Start builds the image, starts private MySQL, applies recorded migrations once and launches app/proxy. Check `docker compose ps`, `docker compose logs --tail=100 app`, and `https://YOUR-DOMAIN/api/health`. Correct domain DNS and TCP80/443 are required for HTTPS.

Open `https://YOUR-DOMAIN/setup`; use the private setup secret printed by configuration and choose your owner email/name/password. Owner setup closes after creation. Store offline recovery codes safely and enroll authenticator MFA before production use. No account recovery email is claimed without an actual configured provider; offline code recovery is available. Website passwords are hashed; Windows credentials are encrypted for authorized Reveal/Copy.

## Persistent storage

`DATA_ROOT` defaults to `/srv/win11desk`; database data is a host-mounted directory under data/mysql and proxy certificate state under proxy. App releases/images are replaceable. Keep `.env` and VAULT_KEY stable across restarts/upgrades. **Never remove the data directory, run down -v, regenerate vault keys or rebuild the provider VPS to update the app.** All accounts/history/Created dates/issued artifacts/events/settings persist in SQL. Persistence is not a backup; a database without the matching vault key cannot decrypt Windows credentials.

## Installer and history

Login → Installer → set Windows username/password/RDP/source → Generate → Copy → paste into root SSH on a separate compatible target. This authorizes automatic system-disk replacement/reboot; no terminal prompts. Private expiring commands are bearer secrets. Target IP appears when it first registers, not when the command is created. Central history shows created timestamp, current reported phase, liveness, credentials and optional tracker. Completion is Windows11 Professional/build/local-listener evidence, not independent external login/desktop certification. Stale means no recent callback, not proven failure. First-login/privacy/licensing may remain yours to finish.

History Trash/Restore/Purge changes website records only—not the remote Windows VPS. Terminal records can be purged with permissions/confirmation; shared command credentials must survive other retained runs. Backup copies may still contain old rows until retention expires. No blanket erasure from all backups is promised.

## Backups/restore

`bash deploy/backup.sh /srv/win11desk/backups` makes a consistent encrypted SQL export, prompts for a passphrase and saves checksum. Copy it off-host; back up .env/all vault-key versions separately. Rehearse `bash deploy/restore.sh BACKUP.sql.enc` on an isolated fresh deployment first. Restore decrypts completely before importing and stops app writes. Verify row counts/dates/credential decryptability and deletion tombstones before restarting. Backup schedule/destination/retention must be chosen by the host owner; no timer is silently enabled.

## Upgrade/migrate

Take consistent backup, record version, keep same configuration/data/key, extract new release into a separate directory, build, apply pending migrations once and switch app/proxy. Migration lock/records prevent parallel initialization, but failed DDL must be inspected before retry. Code rollback doesn't undo incompatible database changes. Do not reset owner/defaults. Logs are size-bounded in Compose; monitor disk, backup age and host security updates.

For existing database transition, export consistently and rehearse on the new private MySQL. Preserve IDs/UTC timestamps/vault keys. Old legacy trackers do not contain passwords; import needs a valid capability and cannot invent them. The new migration runner targets a fresh instance; don't blindly rerun earlier CREATE against an imported schema. Validate existing tables before marking adopted versions. New scripts use APP_PUBLIC_URL, old issued commands contain old URLs—drain active installations or maintain an authorized forwarding endpoint during cutover. Do not operate two unrelated writable histories or delete the old project until migration is verified.

## Test boundaries

Read `TEST-REPORT.md` for measured checks, unresolved limitations and the release version. No production host/domain was supplied for this packaging task; DNS, firewall, HTTPS issuance, host reboot/backup destination and a new destructive installation test require that real environment/authorization. A working deploy package is not a claim that an unprovided host has already been configured.
