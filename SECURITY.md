# Security

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Contact the repository maintainers privately with reproduction steps, affected versions, and the smallest safe proof of impact.

## Deployment safety

- Use a dedicated dashboard VPS and a separate disposable target VPS.
- Keep .env, VAULT_KEY, database backups, recovery codes, and generated commands private.
- Use HTTPS and restrict database access to the internal Docker network.
- Treat direct ISO URLs as untrusted input and use official Microsoft media.
- Rotate secrets if they are exposed and revoke compromised credentials immediately.