#!/usr/bin/env python3
"""Write bounded status only; never include archive path, contents or keys."""
import datetime, hashlib, json, os, sys, tempfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'operations-status'
root.mkdir(mode=0o755, exist_ok=True)
status = {'outcome': 'failed', 'lastBackupAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'encryptedBytes': None, 'checksumVerified': False, 'lastRestoreVerifiedAt': None}
try:
    prior = json.loads((root / 'backup.json').read_text())
    value = prior.get('lastRestoreVerifiedAt')
    if isinstance(value, str) and len(value) < 64:
        datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        status['lastRestoreVerifiedAt'] = value
except (OSError, ValueError, TypeError):
    pass
failed = sys.argv[1:] == ['--failed']
if not failed:
    try:
        archive = Path(sys.argv[1])
        expected = Path(str(archive) + '.sha256').read_text().split()[0]
        h = hashlib.sha256()
        with archive.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        if h.hexdigest() != expected or archive.stat().st_size <= 0:
            raise ValueError('checksum mismatch')
        status.update(outcome='success', encryptedBytes=archive.stat().st_size, checksumVerified=True)
    except (OSError, ValueError, IndexError):
        failed = True
fd, name = tempfile.mkstemp(prefix='backup-status-', suffix='.tmp', dir=root)
try:
    with os.fdopen(fd, 'w') as f:
        f.write(json.dumps(status, indent=2) + '\n')
    os.chmod(name, 0o644)
    os.replace(name, root / 'backup.json')
finally:
    if os.path.exists(name): os.unlink(name)
print('Secret-free backup attempt metadata recorded; restore evidence remains separate.')
if failed and sys.argv[1:] != ['--failed']:
    raise SystemExit('Encrypted archive verification failed; failure status recorded.')
