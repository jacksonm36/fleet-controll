# Fleet Patch Control — Code Review (2026-07-12)

Scope: auth/security surface (`apps/api`), agent core (`agent/cmd/agent`, Go), DB schema
(`packages/db/prisma`), web app structure (`apps/web`). Report-only — no code changed as part of
this pass.

## 0. [CRITICAL — FIXED this session] Pending apt/dpkg update detection was silently broken

Found while porting apt/dpkg inventory to Rust (`rust-agent/src/inventory_pkg.rs`) and
cross-checking output against ground truth on the live controller host.

`agent/cmd/agent/inventory_updates.go`'s `collectAptUpgradable` and `aptKernelUpgradesPending`
both run:

```go
exec.Command("apt-get", "list", "--upgradable")
```

`apt-get` has no `list` subcommand — the correct binary for this is `apt` (the wrapper), not
`apt-get`. Confirmed on the controller host:

```
$ apt-get list --upgradable
E: Command line option --upgradable is not understood in combination with the other options
$ apt list --upgradable
caddy/any-version 2.11.4 amd64 [upgradable from: 2.11.3]
grafana/stable 13.1.0 amd64 [upgradable from: 13.0.1-01]
```

Both Go functions swallow the resulting error and return `nil`/`false` silently — no log line, no
error surfaced anywhere. Net effect: **on every apt/dpkg-based host in the fleet (the most common
target — Debian/Ubuntu), the agent reports zero pending updates and zero pending kernel upgrades,
even when real updates are available.** This is the core "detect what needs patching" feature of a
product called Fleet *Patch Control* — likely the single highest-impact bug in the repo. It would
not be visible from the UI/API side at all; it looks like "this host is fully patched" rather than
an error.

Fixed: changed `"apt-get"` → `"apt"` at both call sites in `agent/cmd/agent/inventory_updates.go`
(`aptKernelUpgradesPending`, `collectAptUpgradable`). `go build ./...` and `go test ./...` both
pass after the change. The Rust port done this session
(`rust-agent/src/inventory_pkg.rs::collect_apt_upgradable`) already used the correct `apt` binary
and was verified against `dpkg-query`/`apt list --upgradable` ground truth on this host (488/488
installed packages matched, both pending upgrades correctly detected).

## 1. [HIGH] Documented rate limits don't match actual code

`SECURITY-IMPROVEMENTS.md` claims:
- Login: 5 attempts / 15 min (was 30)
- Global: 120 req/min (was 240)
- Enrollment: 10 attempts / 1 hour (new)

Actual current defaults in `apps/api/src/plugins/security.ts`:
- `registerAuthRateLimit`: `isProduction() ? 30 : 120` per **15 min** — 6x looser than documented.
- `globalRateLimitMax`: `isProduction() ? 600 : 1200` per **minute** — 5x looser than documented.
- `registerEnrollRateLimit`: `isProduction() ? 20 : 60` per **15 minutes**, not 10/hour.

The production security posture is materially weaker than what the security doc claims was
shipped. Either the doc is stale (values were loosened after writing it, maybe during debugging)
or the intended values were never applied. Since this doc reads like a compliance/audit artifact,
this is worth fixing in one direction or the other — tighten the code to match the doc, or correct
the doc to match reality.

## 2. [CORRECTED] Audit logging: my original finding here was wrong

**Retraction:** the first version of this report claimed audit logging didn't exist, based on
`grep -rn 'AuditEvent'` returning zero hits. That grep was wrong — it searched for the Prisma
*model* name (`AuditEvent`, PascalCase), but application code calls the generated Prisma *client*
accessor, which is camelCase: `prisma.auditEvent.create(...)`. Re-checking with the correct casing
finds audit logging wired into **19 call sites across 12 files** — `auth.ts`, `users.ts`,
`agents.ts`, `jobs.ts`, `patch-plans.ts`, `enrollment.ts`, `agent-enroll.ts`, `scripts.ts`,
`crowdsec-human.ts`, `fleet-agent-tls-rollout.ts`, `agent-delete.ts` — covering logins (each MFA
method), profile/password changes, TOTP/passkey enrollment, agent enrollment/deletion, job
approval, patch-plan approve/execute, script runs, and more. `apps/api/src/lib/audit.ts` still
doesn't exist as a standalone file (the helper is a small inline `audit()` function local to
`auth.ts`, and other routes call `prisma.auditEvent.create` directly), so that specific file-path
claim in the doc is still inaccurate, but "audit logging isn't implemented" was false. Apologies
for the bad grep — flagging this prominently so nothing gets "fixed" based on the wrong premise.

**What actually holds up as a real, narrower gap:** every route above logs *successful* sensitive
actions, but none of the `401 invalid_credentials` / `invalid_totp` / `invalid_recovery_code`
failure paths in `auth.ts` call `audit()` — e.g. `apps/api/src/routes/auth.ts` lines 137, 179, 217,
446, 510, 539 all `return reply.code(401)...` with no audit call before them. `SECURITY-IMPROVEMENTS.md`
specifically lists "Authentication failures" as covered, which isn't accurate — failed login/TOTP/
recovery/password attempts aren't recorded anywhere, only successes. This matters for detecting
brute-force/credential-stuffing after the fact. Worth adding `audit(user?.id ?? null,
"user_login_failed", { reason: ... })` (or similar) at each of those failure points.

## 3. [MEDIUM — architectural note, not a bug] Controller compromise = fleet-wide code execution

The Go agent's self-update path (`agent/cmd/agent/upgrade.go`: `spawnDetachedBinaryUpgrade` /
`buildUpgradeHelperScript`, invoked via `exec.Command("/bin/sh", scriptPath)`) lets the central
controller push a binary update that the agent writes to disk (0700) and executes. This is
intentional design (that's how fleet-wide agent updates get distributed), but it means the API
server is a high-value target: anyone who compromises `apps/api` gets code execution on every
enrolled host. That raises the stakes on finding #1 (rate limits) and the failed-login-audit gap
in #2 — the component with this much blast radius is the one whose hardening turned out to be
weaker than documented in places.

## 4. [LOW] Duplicate CLI flag parsing in agent/cmd/agent/run.go

`runAgent()` first resolves `centralURL`/`enrollToken`/etc. via a `flagString()` helper, then
immediately re-parses the same values from `os.Args[1:]` with a manual `strings.HasPrefix(arg,
"-central=")`-style loop that overwrites them again. Looks like leftover duplication from a
refactor rather than intentional — one of the two parsing paths should be removed.

## 5. [INFO — positive finding] No obvious shell-injection risk in agent exec.Command usage

Every `exec.Command(...)` call across the Go agent (40+ call sites checked: apt/dpkg, dnf/rpm,
zypper, apk, pacman, brew, snap, flatpak, docker/podman, systemctl, trivy, debsecan, etc.) passes
arguments as a Go `[]string` slice rather than building a shell string, so there's no classic
shell-injection surface from package/version names. Worth preserving this pattern in any future
Rust port (`std::process::Command` args, never a shell string).

## 6. [INFO] agent/ (Go) and rust-agent/ (Rust) are intentionally coexisting, not dead code

`rust-agent/`'s own README says upgrade/systemd/CrowdSec are "intentionally not implemented" —
it's a deliberate minimal stub, not an abandoned parallel implementation. The Go agent
(`agent/cmd/agent`, ~7,800 lines) remains the real, fully-featured agent serving the fleet. This
session added an `inventory` slice to `rust-agent` (OS detection, package-manager detection,
apt/dpkg inventory) as the first step of an incremental migration — see git history for that
change. The two trees should keep coexisting until `rust-agent` reaches feature parity; no
premature deletion of `agent/` is warranted yet.

## Suggested priority order

1. Fix #0 (broken pending-update detection) — one-line binary-name fix, highest real-world impact.
2. Reconcile #1 (rate limits) — pick the real target numbers and make code match doc (or vice
   versa).
3. Add failure-path audit logging per #2's corrected finding (auth.ts's 401 branches).
4. Track #3 as a standing risk note; not an action item on its own, but context for how much #1/#2
   matter.
5. #4 is a quick, low-risk cleanup whenever someone is next in `run.go`.
