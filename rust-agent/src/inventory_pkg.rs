//! apt/dpkg package inventory. Rust port of the dpkg branch of
//! agent/cmd/agent/inventory_apps.go (collectDpkgPackages) and the apt branch of
//! agent/cmd/agent/inventory_updates.go (collectAptUpgradable) / inventory_updates.go's
//! applyPendingToPackages.
//!
//! NOTE: the Go implementation calls `exec.Command("apt-get", "list", "--upgradable")`, but
//! `apt-get` has no `list` subcommand — on this host that command errors out (`E: Command line
//! option --upgradable is not understood...`), so collectAptUpgradable silently returns nil and
//! pending-update detection is broken for apt/dpkg hosts (see docs/CODE-REVIEW-2026-07-12.md,
//! finding added after discovering this). This port uses the correct `apt list --upgradable`
//! (the `apt` binary, not `apt-get`) so the Rust path doesn't inherit the bug.

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

use crate::pkgmgr_detect::path_lookup;

#[derive(Debug, Clone, Serialize)]
pub struct PackageRow {
    pub name: String,
    pub version: String,
    pub manager: &'static str,
    pub source: &'static str,
    #[serde(rename = "updateAvailable", skip_serializing_if = "Option::is_none")]
    pub update_available: Option<bool>,
    #[serde(rename = "availableVersion", skip_serializing_if = "Option::is_none")]
    pub available_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PendingUpdate {
    pub name: String,
    #[allow(dead_code)]
    pub current: String,
    pub available: String,
    pub manager: &'static str,
}

fn parse_package_lines(out: &str, manager: &'static str, source: &'static str) -> Vec<PackageRow> {
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.splitn(2, '\t');
            let name = parts.next()?;
            let version = parts.next()?;
            Some(PackageRow {
                name: name.to_string(),
                version: version.to_string(),
                manager,
                source,
                update_available: None,
                available_version: None,
            })
        })
        .collect()
}

/// dpkg-query -W -f '${Package}\t${Version}\n' — installed Debian/Ubuntu packages.
pub fn collect_dpkg_packages() -> Vec<PackageRow> {
    if !path_lookup("dpkg-query") {
        return Vec::new();
    }
    let out = Command::new("dpkg-query")
        .args(["-W", "-f", "${Package}\t${Version}\n"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            parse_package_lines(&String::from_utf8_lossy(&o.stdout), "dpkg", "installed")
        }
        _ => Vec::new(),
    }
}

/// `apt list --upgradable` (correct binary — see module doc comment). Read-only: does not run
/// `apt-get update` first, so results reflect whatever the local apt index was last refreshed to.
pub fn collect_apt_upgradable() -> Vec<PendingUpdate> {
    if !path_lookup("apt") {
        return Vec::new();
    }
    let out = Command::new("apt").args(["list", "--upgradable"]).output();
    let out = match out {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Listing") || line.starts_with("WARNING") {
            continue;
        }
        // pkg/arch ver [upgradable from: old]
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 2 {
            continue;
        }
        let name = fields[0].split('/').next().unwrap_or(fields[0]).to_string();
        if name.starts_with("linux-image") || name.starts_with("linux-headers") {
            continue; // kernel tracked separately in the Go agent; not ported this slice
        }
        let available = fields[1].to_string();
        let current = line
            .find("upgradable from:")
            .map(|idx| {
                let rest = line[idx + "upgradable from:".len()..].trim();
                let rest = rest.trim_end_matches(']');
                rest.split_whitespace().next().unwrap_or("").to_string()
            })
            .unwrap_or_default();
        rows.push(PendingUpdate {
            name,
            current,
            available,
            manager: "dpkg",
        });
        if rows.len() >= 800 {
            break;
        }
    }
    rows
}

/// Matches Go's applyPendingToPackages: mark packages with a pending update, matching by
/// (name, manager) first, falling back to name-only.
pub fn apply_pending_to_packages(packages: &mut [PackageRow], pending: &[PendingUpdate]) {
    if pending.is_empty() {
        return;
    }
    let mut by_key: HashMap<String, &PendingUpdate> = HashMap::new();
    let mut by_name: HashMap<&str, &PendingUpdate> = HashMap::new();
    for p in pending {
        by_key.insert(format!("{}\0{}", p.name, p.manager), p);
        by_name.insert(p.name.as_str(), p);
    }
    for pkg in packages.iter_mut() {
        let key = format!("{}\0{}", pkg.name, pkg.manager);
        let hit = by_key.get(key.as_str()).or_else(|| by_name.get(pkg.name.as_str()));
        if let Some(pu) = hit {
            pkg.update_available = Some(true);
            if !pu.available.is_empty() {
                pkg.available_version = Some(pu.available.clone());
            }
        }
    }
}
