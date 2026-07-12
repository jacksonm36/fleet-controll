//! OS detail collection. Rust port of the Linux/generic paths of
//! agent/cmd/agent/inventory_os.go — Windows/macOS/FreeBSD branches are not ported yet (out of
//! scope for this slice; the Go agent still owns those platforms).

use std::process::Command;

fn run_text(name: &str, args: &[&str]) -> String {
    Command::new(name)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn truncate_os_detail(s: &str) -> String {
    let s = s.trim();
    if s.len() > 512 {
        s[..512].to_string()
    } else {
        s.to_string()
    }
}

fn collect_os_detail_linux() -> String {
    for path in ["/etc/os-release", "/usr/lib/os-release"] {
        if let Ok(b) = std::fs::read_to_string(path) {
            if !b.trim().is_empty() {
                return b.trim().to_string();
            }
        }
    }
    collect_os_detail_generic()
}

fn collect_os_detail_generic() -> String {
    let kernel = run_text("uname", &["-s"]);
    let release = run_text("uname", &["-r"]);
    let machine = run_text("uname", &["-m"]);
    let pretty = format!("{} {}", kernel, release).trim().to_string();
    let pretty = if pretty.is_empty() {
        std::env::consts::OS.to_string()
    } else {
        pretty
    };
    format!(
        "NAME={}\nPRETTY_NAME={}\nVERSION_ID={}\nID={}\nMACHINE={}",
        kernel,
        pretty,
        release,
        std::env::consts::OS,
        machine
    )
}

/// Matches Go's collectOSDetail() for the linux/generic branches.
pub fn collect_os_detail() -> String {
    let raw = match std::env::consts::OS {
        "linux" => collect_os_detail_linux(),
        _ => collect_os_detail_generic(),
    };
    truncate_os_detail(&raw)
}
