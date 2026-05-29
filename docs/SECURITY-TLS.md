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

## Lab-only HTTP

```env
FLEET_AUTO_ENCRYPT=0
FLEET_REQUIRE_TLS=0
```

On agents: `FLEET_ALLOW_INSECURE_HTTP=1` and `http://` central URL.
