use std::time::Duration;

use anyhow::Context as _;

#[derive(Clone)]
pub struct FleetClient {
    central: String,
    client: reqwest::Client,
    poll_client: reqwest::Client,
}

impl FleetClient {
    pub fn new(central: &str) -> anyhow::Result<Self> {
        let central = central.trim_end_matches('/').to_string();

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent(format!("fleet-agent-rust/{}/{}", env!("CARGO_PKG_VERSION"), std::env::consts::OS))
            .build()
            .context("reqwest Client::builder")?;

        let poll_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(40))
            .user_agent(format!("fleet-agent-rust/{}/{}", env!("CARGO_PKG_VERSION"), std::env::consts::OS))
            .build()
            .context("reqwest poll client")?;

        Ok(Self {
            central,
            client,
            poll_client,
        })
    }

    fn url(&self, path: &str) -> String {
        let p = path.trim_start_matches('/');
        format!("{}/{}", self.central, p)
    }

    pub async fn enroll(
        &self,
        enrollment_secret: &str,
        hostname: &str,
        os_detail: Option<&str>,
        version: &str,
        os_type: &str,
    ) -> anyhow::Result<EnrollResponse> {
        let body = serde_json::json!({
            "token": enrollment_secret,
            "hostname": hostname,
            "osType": os_type,
            "osDetail": os_detail.unwrap_or(version),
            "version": version,
        });

        let res = self
            .client
            .post(self.url("/api/agent/v1/enroll"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("enroll HTTP {}: {}", status, text.trim());
        }

        serde_json::from_str(&text).with_context(|| format!("enroll decode: {}", text))
    }

    pub async fn heartbeat(&self, token: &str, agent_version: &str) -> anyhow::Result<()> {
        let body = serde_json::json!({ "version": agent_version });
        self.post_bearer_expect_ok(&self.url("/api/agent/v1/heartbeat"), token, &body)
            .await
    }

    pub async fn post_inventory_stub(&self, token: &str) -> anyhow::Result<()> {
        let collected = chrono::Utc::now().to_rfc3339();
        let body = serde_json::json!({
            "schemaVersion": 1,
            "collectedAt": collected,
            "packages": [],
            "services": [],
            "crowdsecInstalled": false,
        });

        self.post_bearer_expect_ok(&self.url("/api/agent/v1/inventory"), token, &body)
            .await
    }

    pub async fn fetch_next_job(&self, token: &str) -> anyhow::Result<Option<serde_json::Value>> {
        let res = self
            .poll_client
            .get(self.url("/api/agent/v1/commands"))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let status = res.status();
        if status == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if !status.is_success() {
            let t = res.text().await.unwrap_or_default();
            anyhow::bail!("commands HTTP {}: {}", status, t.trim());
        }
        let json: serde_json::Value = res.json().await?;
        Ok(Some(json))
    }

    pub async fn post_job_log(&self, token: &str, job_id: &str, msg: &str) -> anyhow::Result<()> {
        let body = serde_json::json!({ "message": msg });
        self.post_bearer_expect_ok(
            &self.url(&format!("/api/agent/v1/jobs/{}/log", job_id)),
            token,
            &body,
        )
        .await
    }

    pub async fn post_job_complete(
        &self,
        token: &str,
        job_id: &str,
        ok: bool,
        err_msg: Option<&str>,
    ) -> anyhow::Result<()> {
        let body = match err_msg {
            Some(e) => serde_json::json!({
                "status": if ok { "COMPLETED" } else { "FAILED" },
                "errorMessage": e,
            }),
            None => serde_json::json!({
                "status": if ok { "COMPLETED" } else { "FAILED" },
            }),
        };

        self.post_bearer_expect_ok(
            &self.url(&format!("/api/agent/v1/jobs/{}/complete", job_id)),
            token,
            &body,
        )
        .await
    }

    async fn post_bearer_expect_ok(
        &self,
        url: &str,
        token: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<()> {
        let res = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await?;

        let status = res.status();
        if !status.is_success() {
            let t = res.text().await.unwrap_or_default();
            anyhow::bail!("{} HTTP {}: {}", url, status, t.trim());
        }
        Ok(())
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    #[allow(dead_code)]
    pub agent_id: String,
    pub api_token: String,
}
