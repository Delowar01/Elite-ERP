# Infrastructure Security — Elite ERP

Stage 11 Part 7. This is the operational hardening guide for a self-hosted
Elite ERP deployment (plain Node.js + PostgreSQL behind a reverse proxy, per
the primary path in the root `README.md`). It complements the application-level
controls already in the codebase (auth, MFA, field encryption, immutable audit,
signed file URLs, security headers, rate limiting).

> Scope note: Elite ERP does not provision infrastructure. These are the
> settings an operator must apply to the host, database, and proxy. Nothing here
> requires application code changes.

## 1. Secrets management

- **Never commit secrets.** `.env*` is gitignored; `gitleaks` runs in CI
  (`.github/workflows/devsecops.yml`) to catch accidental commits.
- Required secrets and how to generate them (see `.env.example`):
  - `AUTH_SECRET` — `openssl rand -hex 32`. Rotating it invalidates all sessions.
  - `FIELD_ENCRYPTION_KEYS` — one or more `version:base64-32-byte` entries,
    newest first. Generate a key with `openssl rand -base64 32`.
  - `DATABASE_URL` — points at your own PostgreSQL; use a dedicated least-priv role.
- In production, inject secrets from the platform's secret store (systemd
  `EnvironmentFile` with `0600` perms, Docker secrets, or a cloud secrets
  manager) — not from a world-readable `.env` on disk.
- **Encryption-key rotation:** prepend a new key version to
  `FIELD_ENCRYPTION_KEYS`; new writes use it, old envelopes still decrypt under
  their pinned version. Re-encrypt at rest by reading and re-saving affected
  rows. Never remove a key version still referenced by stored envelopes.

## 2. Database hardening

- Run the app under a **least-privilege role** that owns only the app schema —
  not a superuser. It needs `SELECT/INSERT/UPDATE/DELETE` on app tables and
  `USAGE` on the schema, nothing more.
- Install the immutable-audit triggers once against the production DB:
  `psql "$DATABASE_URL" -f drizzle/immutable_audit.sql`. These reject
  `UPDATE`/`DELETE` on `audit_logs` and `security_events` at the database level,
  so the trail is append-only even if the app role is compromised.
- Require TLS for DB connections (`sslmode=require` or stricter in
  `DATABASE_URL`) whenever the DB is not on the same host over a unix socket.
- Restrict network reachability: bind PostgreSQL to `localhost` (or a private
  subnet), and gate access with `pg_hba.conf` + a host firewall.
- Take encrypted, tested backups on a schedule (see `backup-dr.md`).

## 3. Transport & reverse proxy

- Terminate TLS at the proxy (nginx/Caddy). Redirect all HTTP → HTTPS.
- The app already sets HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, a strict CSP, and `Referrer-Policy` (see `next.config.ts` /
  middleware). Do not strip these at the proxy.
- Cookies are `__Host-`-prefixed, `Secure`, `HttpOnly`, `SameSite` in
  production — which requires the site to be served over HTTPS on the apex path.
- Set sensible proxy limits: request body size cap (uploads are small images),
  and a connection/timeout policy to blunt slow-loris style abuse.
- Forward the real client IP (`X-Forwarded-For`); the app reads the first hop
  for audit/rate-limit context (`lib/security/request-context.ts`).

## 4. Host & process hardening

- Run the Node process as a **non-root** service user with a read-only app
  directory except for `uploads/` and `.next/`.
- Keep the OS, Node runtime, and dependencies patched. `npm audit` (high) runs
  in CI; triage findings promptly.
- Supervise with a process manager (systemd/pm2) with automatic restart. Ship
  logs to a central store; retain `security_events` in the DB for investigation.
- Firewall: expose only 443 (and 22 from admin ranges). The app port (3000) and
  PostgreSQL must not be publicly reachable.
- The private `uploads/` directory is served only through the authenticated /
  signed route (`/uploads/[folder]/[file]`); never map it as a static web root.

## 5. Least-privilege access

- Elite ERP enforces RBAC (owner/admin/staff) and tenant isolation on every
  query (`tenantScope`). Grant application roles conservatively.
- MFA can be required for privileged roles per-org
  (`orgs.mfa_required_for_privileged`); enable it for owner/admin in production.
- Administrative DB/host access should itself be MFA-gated and logged outside
  the application.

## 6. Verification checklist (pre-go-live)

- [ ] `AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`, `DATABASE_URL` set from a secret
      store, not a committed file.
- [ ] `drizzle/immutable_audit.sql` applied; `UPDATE audit_logs` is rejected.
- [ ] DB role is non-superuser; DB not publicly reachable; TLS on.
- [ ] HTTPS enforced; security headers present on responses; `__Host-` cookie set.
- [ ] Backups running and a restore has been rehearsed (see `backup-dr.md`).
- [ ] `npm audit` and `gitleaks` clean in CI on the release commit.
