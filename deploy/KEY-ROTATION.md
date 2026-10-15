# Vault key rotation

This procedure rotates the single `VAULT_KEY` used by the control vault. It rewraps, without changing plaintext bytes, every supported secret in:

- `wc_commands`: `artifact_*`, `credential_*`, `read_token_*`, and `write_token_*` AES-256-GCM envelopes;
- `wc_delivery_secrets.capability_envelope`;
- `wc_accounts.mfa_secret_envelope` and `mfa_pending_envelope` JSON AES-256-GCM envelopes, bound to `mfa:{account_id}`.

The script uses the raw MySQL database named by `DATABASE_URL`, locks all three tables with `FOR UPDATE`, authenticates every non-empty old envelope, generates a new random 12-byte IV for every envelope, verifies the complete new-key result, and commits only after all checks pass. `installer_digest`, artifact/script bytes, credential versions, immutable metadata, and dates are not changed. Command key IDs are changed to `vault-v2`; `credential_version` is deliberately preserved because it is part of credential AAD.

## Preconditions (mandatory)

1. Disable new remote installs and drain/cancel pending jobs. Allow the worker to clear expired review/check credentials. The CLI refuses rotation while any uncleared remote credential remains; it never silently leaves a queued grant on the old key. Then schedule a maintenance window. Stop the app and all workers that can write to the control database. Do not rely on the script to detect a running process.
2. Enable the deployment's maintenance page/gate and verify the app is not accepting requests. The CLI requires an explicit `--maintenance-acknowledged` acknowledgement.
3. Take and verify a restorable database backup **and** securely back up both the old and new key material. Never put either key in shell history, a command argument, source control, or logs.
4. Confirm `DATABASE_URL` points to the intended MySQL database. The CLI also requires the exact database name through `--database`; it aborts if the URL database differs.
5. Run the project build/checks and ensure the standalone script entry is present in the deployment build. The release build includes `dist/rotate-vault.js`.

The old key must be the currently deployed `VAULT_KEY`; the new key must be a different, protected 32-byte value. Generate a new value outside the command line, for example with a secret manager or a protected terminal:

```sh
umask 077
export OLD_VAULT_KEY="$(secret-manager read win11desk/VAULT_KEY)"
export NEW_VAULT_KEY="$(openssl rand -hex 32)"
export DATABASE_URL='mysql://USER:PASSWORD@HOST:3306/DBNAME'
```

Use a secret-manager injection instead of exporting when possible. The script reads only `OLD_VAULT_KEY` and `NEW_VAULT_KEY`; it does not accept key values as command-line arguments. For an interactive one-time new-key entry, omit `NEW_VAULT_KEY` and use `--new-key-stdin` (the prompt is not a secure terminal masking facility; prefer a secret manager).

## Dry-run (default, no database writes)

Run this while the app is stopped:

```sh
node dist/rotate-vault.js \
  --database DBNAME \
  --maintenance-acknowledged
```

The default is a dry-run. It locks and reads the rows, authenticates all old-key envelopes, exercises re-encryption in memory, and rolls the transaction back. It must print only counts (never keys, plaintext, ciphertext, or secret values). A wrong old key, malformed/partial envelope, unexpected AAD, or wrong database aborts the run.

## Apply rotation

Only after a successful dry-run and verified backup, run:

```sh
node dist/rotate-vault.js \
  --database DBNAME \
  --maintenance-acknowledged \
  --apply --confirm ROTATE
```

`--apply` and the exact `--confirm ROTATE` token are both required for writes. The transaction is all-or-nothing: any authentication, parsing, post-rewrap verification, lock, or update error rolls back every update. The process must exit successfully before considering the rotation committed.

## Cutover and verification

1. Keep the app stopped until the command reports `Rotation committed`.
2. Replace the deployed `.env` value `VAULT_KEY` with the **new** key. Do this through the deployment secret manager or a protected file; do not print it.
3. Remove `OLD_VAULT_KEY` and `NEW_VAULT_KEY` from the rotation shell/session and secret-manager temporary bindings. Retain the old key only in the encrypted, access-controlled recovery backup until the retention policy permits destruction.
4. Start the app and perform non-destructive checks: login, MFA challenge/enrollment read path, command retrieval/delivery, tracking URL read, and credential reveal against a safe test record. Confirm logs contain no key material.
5. Verify the database backup remains available. Do not hand-edit envelopes or key IDs.

## Failure and rollback

- A dry-run or apply failure before commit leaves database rows unchanged. The CLI explicitly rolls back on every error.
- If the process is interrupted, leave the app stopped, inspect transaction/backup state, and rerun the dry-run with the old deployed key. Never guess which key was committed.
- If apply reports success but the app cannot decrypt after cutover, stop the app immediately and inspect that the new key was installed correctly. Do not revert only the key against an already-rewrapped database. To roll back, restore the matching pre-rotation database backup and old key together. Do not run a second rotation until the committed state is established.
- If a database restore is required, restore the matching old-key environment first, verify the service, then plan a new rotation window.

This script intentionally does not modify `server/control/admin.ts`, configuration, schemas, authentication code, or the package build definition.

Version 2 lifecycle: stop **both app and remote-worker**. After a database restore, inspect restored remote jobs before enabling the worker; restored grants must not be dispatched automatically without review. No vault rotation or database restoration was performed by the Version 2 release.
