//! Windows-side helper: mint an enrollment secret + POST /api/agent/v1/enroll against the
//! local API, then write ~/.fleet-agent.token via \\wsl$\ (avoids Bash CRLF quirks on /mnt/*).
//! Reads SEED_ADMIN_* from the repo .env (quoted values OK). Rust port of
//! scripts/enroll-agent-win-to-wsl.py.
//!
//! Usage: enroll-win-wsl [WSL-DISTRO-NAME]   (default: Ubuntu-22.04)

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context};
use serde_json::Value;

fn repo_root() -> PathBuf {
    if let Ok(r) = std::env::var("FLEET_REPO_ROOT") {
        return PathBuf::from(r);
    }
    // rust-agent/src/bin/enroll_win_wsl.rs -> repo root is two levels above the crate manifest.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn strip_q(s: &str) -> &str {
    let t = s.trim();
    let b = t.as_bytes();
    if b.len() >= 2
        && ((b[0] == b'"' && b[b.len() - 1] == b'"') || (b[0] == b'\'' && b[b.len() - 1] == b'\''))
    {
        &t[1..t.len() - 1]
    } else {
        t
    }
}

fn load_dot_env(path: &Path) -> anyhow::Result<HashMap<String, String>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {:?}", path))?;
    let mut out = HashMap::new();
    for line in text.lines() {
        let ls = line.trim();
        if ls.is_empty() || ls.starts_with('#') {
            continue;
        }
        if let Some(i) = ls.find('=') {
            let k = ls[..i].trim().to_string();
            let v = strip_q(&ls[i + 1..]).to_string();
            out.insert(k, v);
        }
    }
    Ok(out)
}

/// Run `wsl.exe -d <dist> -- <args>`, returning trimmed stdout, or None on any failure.
fn wsl_text(dist: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("wsl.exe")
        .arg("-d")
        .arg(dist)
        .arg("--")
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

async fn req_json(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
    bearer: Option<&str>,
) -> anyhow::Result<(u16, Value)> {
    let mut req = client.request(method, url);
    if let Some(b) = body {
        req = req.json(b);
    }
    if let Some(tok) = bearer {
        req = req.header("Authorization", format!("Bearer {}", tok));
    }
    let res = req.send().await.with_context(|| format!("request {}", url))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let payload = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    Ok((status, payload))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dist = std::env::args().nth(1).unwrap_or_else(|| "Ubuntu-22.04".to_string());
    let dist = dist.trim().to_string();

    let root = repo_root();
    let dot = root.join(".env");
    if !dot.is_file() {
        bail!(".env missing at {:?}", dot);
    }
    let cfg = load_dot_env(&dot)?;

    let email = cfg
        .get("SEED_ADMIN_EMAIL")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "admin@localhost".to_string());
    let pwd = cfg
        .get("SEED_ADMIN_PASSWORD")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if pwd.is_empty() {
        bail!("SEED_ADMIN_PASSWORD not set in .env");
    }

    let base = std::env::var("FLEET_CENTRAL_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4000".to_string());
    let base = base.trim_end_matches('/').to_string();

    let linux_user = std::env::var("WSL_AGENT_USER")
        .ok()
        .or_else(|| std::env::var("USER").ok())
        .or_else(|| wsl_text(&dist, &["bash", "-lc", "whoami"]))
        .unwrap_or_else(|| "jackson".to_string())
        .trim()
        .to_string();

    let hn = wsl_text(&dist, &["hostname", "-s"])
        .or_else(|| wsl_text(&dist, &["hostname"]))
        .unwrap_or_else(|| "unknown-wsl".to_string());

    let token_unc = PathBuf::from(format!(
        "\\\\wsl$\\{}\\home\\{}\\.fleet-agent.token",
        dist, linux_user
    ));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .context("reqwest Client::builder")?;

    let (status, payload) = req_json(
        &client,
        reqwest::Method::POST,
        &format!("{}/api/auth/login", base),
        Some(&serde_json::json!({ "email": email, "password": pwd })),
        None,
    )
    .await?;
    if status != 200 {
        bail!("Login failed: {} {}", status, payload);
    }
    let jwt = payload["token"]
        .as_str()
        .context("login response missing token")?
        .to_string();

    let mint_body = serde_json::json!({ "ttlMinutes": 720 });
    let (mut status2, mut payload2) = req_json(
        &client,
        reqwest::Method::POST,
        &format!("{}/api/enrollment-tokens", base),
        Some(&mint_body),
        Some(&jwt),
    )
    .await?;
    if status2 != 200 {
        let (s, p) = req_json(
            &client,
            reqwest::Method::POST,
            &format!("{}/api/enrollment-tokens/", base),
            Some(&mint_body),
            Some(&jwt),
        )
        .await?;
        status2 = s;
        payload2 = p;
    }
    if status2 != 200 {
        bail!("Mint failed: {} {}", status2, payload2);
    }
    let pairing = payload2["token"]
        .as_str()
        .context("mint response missing token")?
        .to_string();

    let enroll_body = serde_json::json!({
        "token": pairing,
        "hostname": hn,
        "osType": "linux",
        "osDetail": "wsl-agent",
        "version": "0.2.0-rust-win-enroll",
    });
    let (h3_status, h3_body) = req_json(
        &client,
        reqwest::Method::POST,
        &format!("{}/api/agent/v1/enroll", base),
        Some(&enroll_body),
        None,
    )
    .await?;
    if h3_status != 200 {
        bail!("Enroll failed: {} {}", h3_status, h3_body);
    }
    let api_tok = h3_body["apiToken"]
        .as_str()
        .context("enroll response missing apiToken")?
        .to_string();

    let mut wrote_via_unc = false;
    if let Some(parent) = token_unc.parent() {
        if std::fs::create_dir_all(parent).is_ok()
            && std::fs::write(&token_unc, &api_tok).is_ok()
        {
            wrote_via_unc = true;
        }
    }
    if !wrote_via_unc {
        use std::io::Write as _;
        let mut child = Command::new("wsl.exe")
            .args([
                "-d",
                &dist,
                "--",
                "bash",
                "-lc",
                "umask 077; cat > \"$HOME/.fleet-agent.token\"",
            ])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .context("spawn wsl.exe fallback")?;
        child
            .stdin
            .as_mut()
            .context("wsl.exe fallback stdin")?
            .write_all(api_tok.as_bytes())?;
        let status = child.wait().context("wait wsl.exe fallback")?;
        if !status.success() {
            bail!("Writing token failed (UNC + WSL fallback).");
        }
    }

    println!(
        "Enrollment OK -> {}  ({} bytes)",
        token_unc.display(),
        api_tok.len()
    );
    println!("[info] distro={} user={} hostname={}", dist, linux_user, hn);

    Ok(())
}
