# Encrypted Fleet traffic (nginx)

Fleet uses **nginx** for HTTPS — the same model as any normal website:

- `ssl_certificate` → `/etc/fleet/ssl/fullchain.pem`
- `ssl_certificate_key` → `/etc/fleet/ssl/privkey.pem`
- `proxy_pass` → web UI (`:3000`) and API (`:4000`)

Agents and the UI both use **`https://your-controller`** on port 443.

## Quick setup

On the controller:

```bash
export FLEET_DOMAIN=192.168.1.178
sudo bash scripts/setup-fleet-tls-nginx.sh
sudo systemctl restart fleet-api fleet-web
```

This generates an openssl self-signed cert (or uses your own via `FLEET_SSL_CERT` / `FLEET_SSL_KEY`).

## Use your own certificate (Let's Encrypt, corporate CA, etc.)

```bash
export FLEET_DOMAIN=fleet.example.com
export FLEET_SSL_CERT=/etc/letsencrypt/live/fleet.example.com/fullchain.pem
export FLEET_SSL_KEY=/etc/letsencrypt/live/fleet.example.com/privkey.pem
sudo bash scripts/setup-fleet-tls-nginx.sh
```

With a **public CA**, agents do **not** need `FLEET_CA_FILE` — the system trust store is enough.

## Self-signed (default openssl cert)

1. Download `https://YOUR_HOST/api/public/tls-ca.crt` (or from Fleet UI → TLS / CA).
2. Import into the browser trusted store once.
3. On Linux agents (only for self-signed):

```bash
curl -fsSL 'https://YOUR_HOST/api/public/tls-ca.crt' -o /etc/fleet/ca.crt
export FLEET_CA_FILE=/etc/fleet/ca.crt
export FLEET_CENTRAL_URL=https://YOUR_HOST
```

Install script picks up the CA automatically.

## Controller `.env`

```env
FLEET_AUTO_ENCRYPT=1
FLEET_REQUIRE_TLS=1
TRUST_PROXY=1
FLEET_PUBLIC_URL=https://192.168.1.178
FLEET_TLS_PROXY=nginx
FLEET_CA_CERT_PATH=/etc/fleet/ca.crt
```

## TLS ciphers vs pinning (different jobs)

| Mechanism | Role | Fleet usage |
|-----------|------|-------------|
| **SHA-512 SPKI pin** | Fingerprint the controller **public key** | `FLEET_TLS_PIN` — optional, out-of-band trust |
| **ChaCha20-Poly1305** (AEAD) | **Encrypt + authenticate** bytes on the wire | Negotiated inside TLS 1.2/1.3 (agent prefers this suite when available) |
| **SHA-256/384 in TLS** | Handshake PRF / cert signatures | Built into TLS; not something you configure instead of pinning |

You want **both**: pinning answers “is this the right server key?”; ChaCha20-Poly1305 answers “is the live channel confidential and intact?”. They are not interchangeable.

Agents prefer **ChaCha20-Poly1305** and **X25519**, then AES-GCM. nginx uses the same cipher preference on port 443.

**Install (both enabled by default on controller):**

- `FLEET_TLS_PIN_AUTO=1` — install scripts fetch `tls-pin.json` and set `FLEET_TLS_PIN` + `~/.fleet/tls-pin`
- Agent env from `~/.config/fleet-agent/env` includes pin + optional `FLEET_TLS_MIN_VERSION`

Optional controller `.env`: `FLEET_TLS_MIN_VERSION=1.3` to push TLS 1.3-only to new agents.

## Certificate pinning (optional, agents)

Pins the controller **public key** (SPKI) using **SHA-512** in addition to normal CA verification.
Useful for self-signed fleets when you want to limit trust to one key.

1. Fetch pin: `curl -fsSL https://YOUR_HOST/api/public/tls-pin.json`
2. On each agent: `export FLEET_TLS_PIN='<fleetTlsPin from JSON>'` (e.g. `sha512:<128 hex chars>`)

Legacy agents may still use `FLEET_TLS_PIN_SHA256` (SHA-256 SPKI, 64 hex chars).

Agents without a pin behave exactly as before. Pinning does not replace `FLEET_CA_FILE` for self-signed CAs.

Optional: `FLEET_TLS_SERVER_NAME` overrides SNI/hostname verification.

## Central rollout (controller)

From the **Fleet controller** (recommended after upgrading the codebase):

```bash
# Rebuild agent, push binary to online agents, queue TLS fix jobs
bash scripts/rollout-fleet-agent-tls.sh
```

Or in the UI: **Agents → Roll out TLS config** (queues `fix-agent-connection.sh` on each **online** host).

API (operator session):

```bash
curl -X POST https://YOUR_HOST/api/fleet/rollout-agent-tls \
  -H "Cookie: …" -H "Content-Type: application/json" \
  -d '{"queueJobs":true}'
```

What each online agent runs (via job or manual curl):

- Downloads CA + SHA-512 pin from the controller
- Rewrites `~/.config/fleet-agent/env`
- Restarts systemd `fleet-agent`

**Also do:** **Agents → Push update to online agents** (or `NOTIFY=1 bash scripts/rebuild-fleet-agent.sh`) so hosts get the new Go binary with pin + ChaCha20 prefs.

**Requirements:** `AUTOMATION_DISABLE_SHELL` must not be set; agents need a **valid** API token (re-enroll if you see `invalid_token`).

**Offline hosts:** run manually on the VM:

```bash
curl -kfsSL 'https://YOUR_HOST/api/public/fix-agent-connection.sh' | bash
```

## Agent mTLS (optional, non-breaking)

Bearer tokens remain required. When enabled, agents **may** present a client certificate; nginx and the API can require the cert CN to match the enrolled agent id.

**Controller setup:**

```bash
sudo bash scripts/setup-fleet-mtls-ca.sh
sudo systemctl restart fleet-api
```

`.env`:

```env
FLEET_AGENT_MTLS=optional
FLEET_MTLS_CA_CERT=/etc/fleet/mtls/ca.crt
FLEET_MTLS_CA_KEY=/etc/fleet/mtls/ca.key
```

- `optional` — old agents (token only) still work; if a client cert is sent, it must match the agent id.
- `required` — only use after every agent has a client cert (re-enroll or deploy certs).

New enrollments receive `mtlsCert` / `mtlsKey` in the enroll response; the agent stores them under `~/.fleet/agent-client.{crt,key}`.

## Lab-only HTTP

```env
FLEET_AUTO_ENCRYPT=0
FLEET_REQUIRE_TLS=0
```

On agents: `FLEET_ALLOW_INSECURE_HTTP=1` and `http://` central URL.
