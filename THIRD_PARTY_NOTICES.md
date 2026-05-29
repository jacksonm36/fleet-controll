# Third-party notices and inspiration

## PatchMon (conceptual inspiration)

Fleet Patch Control’s patch-plan workflow (dry-run preview, operator approval, selective and
security-only upgrades, patch run history) was **inspired by** the design and product goals of
[PatchMon](https://github.com/PatchMon/PatchMon), an open-source Linux patch management platform.

- **Upstream repository:** https://github.com/PatchMon/PatchMon  
- **Upstream license:** GNU Affero General Public License v3.0 (AGPL-3.0)  
- **Relationship:** This project is an **independent clean-room implementation**. It does not
  incorporate PatchMon source code. Behavior was studied from public documentation and observable
  agent patterns (e.g. simulated package upgrades); all code in this repository is original to
  Fleet Patch Control unless otherwise noted here.

See also [docs/INSPIRATION.md](docs/INSPIRATION.md).
