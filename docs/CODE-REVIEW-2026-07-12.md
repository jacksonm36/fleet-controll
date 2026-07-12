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

## 2. [HIGH] Audit logging is documented as shipped but doesn't exist

`SECURITY-IMPROVEMENTS.md` claims a comprehensive audit trail (admin changes, agent enrollment,
patch execution, token generation, auth failures) implemented in `apps/api/src/lib/audit.ts`
(marked "NEW") and stored in an `AuditEvent` table.

Reality:
- `apps/api/src/lib/audit.ts` does not exist.
- `AuditEvent` model exists in `packages/db/prisma/schema.prisma:373` (id, actorId, action, meta,
  createdAt) but has **zero references** anywhere in `apps/` or `packages/` TypeScript code —
  nothing ever writes to it.

None of the sensitive operations listed in the doc are actually being audit-logged. This is a
real compliance/forensics gap, not just a doc typo — worth prioritizing given the system executes
privileged actions (package upgrades, kernel maintenance) across a fleet of machines.

## 3. [MEDIUM — architectural note, not a bug] Controller compromise = fleet-wide code execution

The Go agent's self-update path (`agent/cmd/agent/upgrade.go`: `spawnDetachedBinaryUpgrade` /
`buildUpgradeHelperScript`, invoked via `exec.Command("/bin/sh", scriptPath)`) lets the central
controller push a binary update that the agent writes to disk (0700) and executes. This is
intentional design (that's how fleet-wide agent updates get distributed), but it means the API
server is a high-value target: anyone who compromises `apps/api` gets code execution on every
enrolled host. That raises the stakes on findings #1 and #2 — the component with this much blast
radius is the one whose hardening turned out to be weaker than documented.

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
2. Fix #2 (audit logging) — either implement it for real or remove the false claim from the doc.
3. Reconcile #1 (rate limits) — pick the real target numbers and make code match doc (or vice
   versa).
4. Track #3 as a standing risk note; not an action item on its own, but context for how much #1/#2
   matter.
5. #4 is a quick, low-risk cleanup whenever someone is next in `run.go`.
