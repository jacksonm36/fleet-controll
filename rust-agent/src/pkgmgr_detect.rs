//! Package-manager detection. Rust port of agent/cmd/agent/pkgmgr_detect.go's Linux path
//! (detectLinuxPatchManager) — non-Linux branches are not ported yet (out of scope this slice).

/// Mirrors Go's exec.LookPath: true if `name` resolves to an executable file on $PATH.
/// Read-only — never executes the candidate.
pub fn path_lookup(name: &str) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(name);
        candidate
            .metadata()
            .map(|m| m.is_file() && is_executable(&m))
            .unwrap_or(false)
    })
}

#[cfg(unix)]
fn is_executable(m: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    m.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_m: &std::fs::Metadata) -> bool {
    true
}

/// Picks the primary native package manager on this Linux host, matching Go's
/// detectLinuxPatchManager priority order.
pub fn detect_linux_patch_manager() -> &'static str {
    if path_lookup("pacman") {
        return "pacman";
    }
    if path_lookup("apk") {
        return "apk";
    }
    if path_lookup("zypper") {
        return "zypper";
    }
    if path_lookup("dnf") {
        return "dnf";
    }
    if path_lookup("yum") {
        return "yum";
    }
    if path_lookup("apt-get") {
        return "apt";
    }
    if path_lookup("emerge") {
        return "emerge";
    }
    if path_lookup("rpm") {
        return "dnf";
    }
    "apt"
}
