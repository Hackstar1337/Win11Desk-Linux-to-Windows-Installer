# Start here — Win11Desk standalone

## 1. Use a separate Linux dashboard VPS

Do not host this control center on a VPS you will replace with Windows. Use your own domain pointed to the dashboard host; allow TCP 80/443, preserve provider/SSH recovery access, and install Docker Engine + Compose v2, Python 3 and OpenSSL.

## 2. Extract the release

The ZIP has a top-level `win11desk/` folder. Enter that folder after extraction.

```bash
python3 deploy/configure.py
bash deploy/start.sh
```

Configuration asks for your domain and durable data root, then generates independent secrets in a protected `.env`. Keep this file/key backup private and stable. It refuses to overwrite existing secrets.

## 3. Create your owner account

Open `https://YOUR-DOMAIN/setup`. Enter the private one-time setup secret printed during configuration and choose your email, name and password. Save the recovery codes, then enable MFA under Account security. There is **no default admin password**.

## 4. Use the installer

Sign in → Installer → Windows username/password/port → Generate → Copy. Paste only into root SSH on an authorized separate target. The command is private and expires after 30 minutes. It erases the detected system disk/reboots automatically after preflight. Your direct ISO is the default and can be changed.

Deployment history updates in the dashboard after target registration: IP, username, masked password, Created time, progress, heartbeat and completion evidence. Use Reveal/Copy after verification; the tracker link is optional. Trash/Restore/Delete affects dashboard records, not the Windows VPS.

## 5. Protect persistent data

MySQL files live beneath your configured data root. Never delete that root or regenerate `VAULT_KEY` during upgrades. Make encrypted off-host backups and retain the matching key separately. Read `DEPLOY.md`, `deploy/KEY-ROTATION.md` and `TEST-REPORT.md` before production use.

## Operations and navigation

Presets, Default settings and the standalone Activity page are removed; manage installer defaults/media through Deployment profiles. Account security, users and internal audit remain. Read `OPERATIONS-GUIDE.md` for Health, Attention, scoped notifications, diagnostics and honest backup/restore evidence. Ready-OS-only generation and the compact launcher remain the next stage.

Ready OS workflow and versioned automatic command: see **READY-OS-GUIDE.md**. ISO links are configured only in Deployment profiles, not New installer.
