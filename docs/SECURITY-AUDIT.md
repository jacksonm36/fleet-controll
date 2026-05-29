# Security review

Deployment checklist for Fleet Patch Control. Not a formal certification.

## Implemented controls

| Control | Location |
|---------|----------|
| Strong passwords (12+ chars, letter+digit, block common) | `@fleet/types` / API auth / users |
| JWT + optional `TOKEN_PEPPER` required in production | `security-config.ts`, `env.ts` |
| Session `SameSite=Lax` in production (CSRF reduction) | `session.ts` |
| Enrollment rate limit per IP | `registerEnrollRateLimit` → `/api/agent/v1/enroll` |
| Hostname validation on enroll | `agent-enroll.ts` |
| Legacy SHA-256 agent tokens upgraded on use | `agent-auth.ts` |
| WebSocket: query `?token=` rejected in production | `agent-ws.ts` |
| `AUTOMATION_DISABLE_SHELL` blocks shell jobs | `automation-guard.ts` |
| Admin security checklist API | `GET /api/fleet/security` |
| Stale job reconciliation | `job-reconcile.ts` |
| Service allowlist regex | `SERVICE_ALLOWLIST` |
| CSP report-only (optional) | `CSP_REPORT_ONLY=1` |

## Production checklist

1. `npm run env:generate` → set `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, `TOKEN_PEPPER`
2. `FLEET_REQUIRE_TLS=1`, nginx/Caddy, do not expose API :4000 publicly
3. Tighten `SERVICE_ALLOWLIST` (not `.*`)
4. Set `CORS_ORIGIN` to your UI origin(s)
5. `AUTOMATION_DISABLE_SHELL=1` if you do not need arbitrary shell jobs
6. Enable MFA / passkeys for admin accounts (Settings)
7. Review **Settings → Controller security** (admin only)
8. Replace Influx/Grafana default passwords; firewall observability ports

## Residual risks

- **Automation** (Ansible, Terraform, shell) runs code on agents with agent privileges.
- **curl \| bash** install path — use HTTPS and pinned CA.
- **CSP** is off by default; enable report-only first (`CSP_REPORT_ONLY=1`).
- **VIEWER** role can read fleet data; cannot mutate.

## Reporting

Open a security issue on [github.com/jacksonm36/fleet-controll](https://github.com/jacksonm36/fleet-controll).
