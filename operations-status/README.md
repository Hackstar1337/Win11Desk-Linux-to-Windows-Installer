# Operations backup metadata

This directory is mounted read-only at `/app/operations-status`. It holds only `backup.json`, written by `deploy/write-backup-status.py` after the existing encrypted backup succeeds and its checksum verifies. It never contains SQL, paths, passwords or encryption keys. The app accepts a bounded allowlisted JSON schema; absent/unreadable/invalid metadata means **Not reported**, not success. Archive checksum verification is not a tested restore.

Retain encrypted archives and their keys outside this directory and off-host according to the backup runbook. Do not fabricate a `lastRestoreVerifiedAt` timestamp; add it only after an actual isolated restore test with documented evidence. This UI does not perform backup/restore or key rotation.
