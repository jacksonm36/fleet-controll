# Inspiration and acknowledgments

## PatchMon

[PatchMon](https://github.com/PatchMon/PatchMon) is an enterprise-oriented Linux patch management
platform (AGPL-3.0). Fleet Patch Control borrows **ideas**, not source code, from that project.

### Concepts adopted (clean-room)

| Idea | Fleet Patch Control implementation |
|------|-----------------------------------|
| Dry-run before production changes | `PACKAGE_PATCH_PLAN` job + `PatchPlan` records |
| Approve then execute | `POST /api/patch-plans/:id/approve` → `PACKAGE_UPGRADE` |
| Selective patching | `packageNames` on upgrade jobs and approve payload |
| Security-only updates | `securityOnly` flag (apt/dnf security paths) |
| Live patch output | Existing job log streaming (`job-bus` + agent `streamCommand`) |
| Patch history & audit | `PatchRun` model + `AuditEvent` on approve/reject/execute |

### Not in scope (yet)

These PatchMon capabilities may be considered in future work:

- apk / pacman / FreeBSD package managers and repository inventory
- OpenSCAP CIS benchmarks and Docker Bench compliance
- Scheduled maintenance-window policies
- Browser-based SSH and AI terminal assistant
- Full OIDC / enterprise RBAC beyond ADMIN / OPERATOR / VIEWER

### License note

PatchMon is licensed under **AGPL-3.0**. Fleet Patch Control is **MIT** licensed and does not
distribute PatchMon code. If you combine this project with PatchMon itself, comply with AGPL
requirements for that combined distribution separately.
