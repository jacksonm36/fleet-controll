# Security review (pre-publish)

Last reviewed before public GitHub push. Use as a deployment checklist, not a formal certification.

## Strengths

- **Session auth**: Operator UI uses JWT in httpOnly cookies; agent API uses per-agent bearer tokens (Argon2id-hashed at rest).
- **RBAC**: `VIEWER` vs operator roles; destructive actions require operator/admin.
- **Rate limiting**: Global API limits plus stricter login rate limits (`apps/api/src/plugins/security.ts`).
- **Helmet**: Security headers; optional HSTS when TLS is enabled.
- **Patch safety**: Direct `PACKAGE_UPGRADE` without an approved patch plan is rejected by the API.
- **Service jobs**: Linux service actions gated by `SERVICE_ALLOWLIST` regex.
- **Secrets**: `.env` is gitignored; `.env.example` uses placeholders only.
- **Job lifecycle**: Stale `RUNNING` jobs are requeued/failed (`apps/api/src/lib/job-reconcile.ts`).

## Risks to mitigate in production

| Area | Risk | Mitigation |
|------|------|------------|
| Bootstrap | Default seed password if `SEED_ADMIN_PASSWORD` unset | Run `npm run env:generate`, set strong password, `npm run db:seed` |
| JWT | Weak `JWT_SECRET` | 32+ random bytes; never commit `.env` |
| TLS | Cleartext controller traffic | `FLEET_REQUIRE_TLS=1`, nginx/Caddy, valid certs |
| Automation | `SHELL_SCRIPT` / Ansible / Terraform jobs run arbitrary code on agents | Restrict operator accounts; audit `AuditEvent`; least-privilege agent sudo |
| Enrollment | One-time enrollment tokens | Short TTL; mint per host; HTTPS only |
| Influx/Grafana | Example tokens in `.env.example` | Replace in production |
| Agent binary | Supply-chain on install scripts | Pin release SHA / use private mirror |

## Known limitations (accepted for lab/homelab)

- Enrollment install scripts may use `curl \| bash` (documented; use HTTPS + pinned CA).
- `SHELL_SCRIPT` is intentionally powerful for automation.
- CSP is disabled for Next.js compatibility (`contentSecurityPolicy: false`).

## Bug fixes included in this release

- Stuck jobs reconciled on heartbeat, poll, and periodic timer.
- Binary upgrade deadlock avoided via detached upgrade helper.
- Agent presence grace during binary upgrades.

## Reporting

Open a private security issue on [github.com/jacksonm36/fleet-controll](https://github.com/jacksonm36/fleet-controll) for vulnerabilities.
