mod client;

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context as _;
use clap::Parser;

use crate::client::FleetClient;

/// Fleet control-plane agent — enroll, heartbeat, inventory, long-poll jobs.
#[derive(Parser)]
#[command(name = "fleet-agent")]
struct Args {
    #[arg(long, env = "FLEET_CENTRAL_URL", default_value = "http://127.0.0.1:4000")]
    central: String,

    /// One-shot enrollment secret (from Fleet UI enrollment token mint).
    #[arg(long, env = "FLEET_ENROLL_TOKEN")]
    enroll_token: Option<String>,

    #[arg(long, env = "FLEET_AGENT_TOKEN")]
    agent_token: Option<String>,

    #[arg(long, env = "FLEET_AGENT_TOKEN_FILE")]
    token_file: Option<PathBuf>,

    #[arg(long)]
    hostname: Option<String>,

    #[arg(long = "agent-version", env = "FLEET_AGENT_VERSION", default_value = "0.2.0-rust")]
    agent_version: String,
}

fn default_token_file() -> PathBuf {
    #[cfg(windows)]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("FleetPatchControl")
            .join("agent.token")
    }
    #[cfg(not(windows))]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".fleet-agent.token")
    }
}

fn fleet_os_type() -> &'static str {
    match std::env::consts::OS {
        "linux" => "linux",
        "windows" => "windows",
        "macos" => "darwin",
        _ => "linux",
    }
}

fn resolve_hostname(hostname: Option<String>) -> anyhow::Result<String> {
    if let Some(ref h) = hostname {
        if !h.trim().is_empty() {
            return Ok(h.trim().to_string());
        }
    }
    hostname::get()
        .context("hostname::get")?
        .into_string()
        .map_err(|_| anyhow::anyhow!("hostname is invalid UTF-8"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("fleet_agent=info,info")
            }),
        )
        .init();

    let args = Args::parse();
    let client = FleetClient::new(&args.central)?;

    let token_path = args.token_file.clone().unwrap_or_else(default_token_file);

    if let Some(ref secret) = args.enroll_token {
        let secret = secret.trim();
        anyhow::ensure!(
            secret.len() >= 8,
            "enrollment token must be at least 8 characters"
        );

        let hostname = resolve_hostname(args.hostname.clone())?;
        let os_detail = format!(
            "{} {} ({})",
            std::env::consts::OS,
            env!("CARGO_PKG_VERSION"),
            fleet_os_type()
        );

        let out = client
            .enroll(
                secret,
                &hostname,
                Some(&os_detail),
                &args.agent_version,
                fleet_os_type(),
            )
            .await
            .context("enroll")?;

        if let Some(parent) = token_path.parent() {
          tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("create token dir {:?}", parent))?;
        }

        tokio::fs::write(&token_path, out.api_token.as_bytes())
            .await
            .with_context(|| format!("write {:?}", token_path))?;

        #[cfg(unix)]
        perms_secure_0600(&token_path).await;

        tracing::info!(path = ?token_path, "saved api token after enroll");
    }

    let mut api_token = args.agent_token.unwrap_or_default();
    api_token.retain(|c| !c.is_whitespace());

    if api_token.is_empty() {
        api_token = tokio::fs::read_to_string(&token_path).await.unwrap_or_default();
        api_token.retain(|c| !c.is_whitespace());
    }

    anyhow::ensure!(
        !api_token.is_empty(),
        "missing api token — pass --enroll-token once, or env FLEET_AGENT_TOKEN, or place token in {}",
        token_path.display()
    );

    let hostname = resolve_hostname(args.hostname)?;
    tracing::info!(%hostname, central = %args.central.trim_end_matches('/'), "fleet-agent connected");

    client
        .heartbeat(&api_token, &args.agent_version)
        .await
        .context("initial heartbeat")?;
    client.post_inventory_stub(&api_token).await?;

    tokio::spawn({
        let c = client.clone();
        let t = api_token.clone();
        let v = args.agent_version.clone();
        async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(45));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if let Err(e) = c.heartbeat(&t, &v).await {
                    tracing::warn!("heartbeat: {:#}", e);
                }
            }
        }
    });

    tokio::spawn({
        let c = client.clone();
        let t = api_token.clone();
        async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(600));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if let Err(e) = c.post_inventory_stub(&t).await {
                    tracing::warn!("inventory: {:#}", e);
                }
            }
        }
    });

    command_loop(client, api_token.clone(), args.agent_version).await;

    Ok(())
}

#[cfg(unix)]
async fn perms_secure_0600(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = tokio::fs::metadata(path).await {
        let mut p = meta.permissions();
        p.set_mode(0o600);
        let _ = tokio::fs::set_permissions(path, p).await;
    }
}

async fn command_loop(cli: FleetClient, token: String, agent_ver: String) {
    loop {
        match cli.fetch_next_job(&token).await {
            Ok(None) => continue,
            Ok(Some(job)) => run_job(&cli, &token, &job, &agent_ver).await,
            Err(e) => {
                tracing::warn!("commands poll: {:#}", e);
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

async fn job_log(cli: &FleetClient, token: &str, job_id: &str, line: &str) {
    if let Err(e) = cli.post_job_log(token, job_id, line).await {
        tracing::warn!("job log: {:#}", e);
    }
}

async fn run_job(cli: &FleetClient, token: &str, job: &serde_json::Value, agent_ver: &str) {
    let id = match job["id"].as_str() {
        Some(s) => s.to_string(),
        None => {
            tracing::error!("job missing id: {}", job);
            return;
        }
    };

    let job_type = job["type"]
        .as_str()
        .or_else(|| job["job_type"].as_str())
        .unwrap_or("UNKNOWN");

    job_log(
        cli,
        token,
        &id,
        &format!(
            "rust fleet-agent {} starting job {}",
            agent_ver, job_type
        ),
    )
    .await;

    match job_type {
        "PACKAGE_REFRESH" => match cli.post_inventory_stub(token).await {
            Ok(_) => {
                job_log(cli, token, &id, "inventory refreshed (stub snapshot)").await;
                if let Err(e) = cli.post_job_complete(token, &id, true, None).await {
                    tracing::error!("complete: {:#}", e);
                }
            }
            Err(e) => {
                let m = format!("{:#}", e);
                job_log(cli, token, &id, &format!("error: {}", m)).await;
                let _ = cli.post_job_complete(token, &id, false, Some(&m)).await;
            }
        },
        other => {
            let m = format!(
                "job type '{}' not implemented in rust fleet-agent (use Go agent for privileged actions)",
                other
            );
            job_log(cli, token, &id, &m).await;
            let _ = cli.post_job_complete(token, &id, false, Some(&m)).await;
        }
    }
}
