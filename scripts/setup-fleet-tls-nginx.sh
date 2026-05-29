#!/usr/bin/env bash
# Standard nginx TLS in front of Fleet (normal ssl_certificate / ssl_certificate_key).
#
#   export FLEET_DOMAIN=192.168.1.178
#   sudo bash scripts/setup-fleet-tls-nginx.sh
#
# Uses openssl self-signed certs by default. To use your own (e.g. Let's Encrypt):
#   export FLEET_SSL_CERT=/etc/letsencrypt/live/example.com/fullchain.pem
#   export FLEET_SSL_KEY=/etc/letsencrypt/live/example.com/privkey.pem
#   sudo bash scripts/setup-fleet-tls-nginx.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEET_DOMAIN="${FLEET_DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
FLEET_DOMAIN="${FLEET_DOMAIN:-localhost}"
SSL_DIR="${FLEET_SSL_DIR:-/etc/fleet/ssl}"
CERT="${FLEET_SSL_CERT:-$SSL_DIR/fullchain.pem}"
KEY="${FLEET_SSL_KEY:-$SSL_DIR/privkey.pem}"
CA_EXPORT="${FLEET_CA_CERT_PATH:-/etc/fleet/ca.crt}"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
	apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx openssl
fi

mkdir -p "$SSL_DIR" /etc/fleet

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
	echo "--- generating self-signed certificate (openssl, nginx-style)"
	mkdir -p "$SSL_DIR"
	openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
		-keyout "$KEY" \
		-out "$CERT" \
		-subj "/CN=${FLEET_DOMAIN}/O=Fleet Control/C=US" \
		-addext "subjectAltName=DNS:${FLEET_DOMAIN},IP:${FLEET_DOMAIN}" 2>/dev/null \
		|| openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
			-keyout "$KEY" \
			-out "$CERT" \
			-subj "/CN=${FLEET_DOMAIN}"
	chmod 600 "$KEY"
	chmod 644 "$CERT"
fi

# For self-signed: browsers/agents import this PEM once (same as server cert).
cp -f "$CERT" "$CA_EXPORT"
chmod 644 "$CA_EXPORT"

export FLEET_DOMAIN
envsubst '$FLEET_DOMAIN' <"$ROOT/deploy/nginx/fleet.conf" >/etc/nginx/sites-available/fleet.conf
ln -sf /etc/nginx/sites-available/fleet.conf /etc/nginx/sites-enabled/fleet.conf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl enable nginx
systemctl reload nginx

# Stop Caddy if it was used previously (avoid port 443 conflict)
systemctl stop caddy 2>/dev/null || true
systemctl disable caddy 2>/dev/null || true

ENV_FILE="$ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
	HTTPS_BASE="https://${FLEET_DOMAIN}"
	set_kv() {
		local k="$1" v="$2"
		if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
			sed -i "s|^${k}=.*|${k}=\"${v}\"|" "$ENV_FILE"
		else
			echo "${k}=\"${v}\"" >>"$ENV_FILE"
		fi
	}
	set_kv NEXT_PUBLIC_API_URL "$HTTPS_BASE"
	set_kv CORS_ORIGIN "$HTTPS_BASE"
	set_kv FLEET_PUBLIC_URL "$HTTPS_BASE"
	set_kv FLEET_PUBLIC_HOST "$FLEET_DOMAIN"
	set_kv TRUST_PROXY 1
	set_kv FLEET_AUTO_ENCRYPT 1
	set_kv FLEET_REQUIRE_TLS 1
	set_kv SESSION_COOKIE_SECURE 1
	set_kv FLEET_CA_CERT_PATH "$CA_EXPORT"
	set_kv FLEET_TLS_PROXY nginx
	mkdir -p "$ROOT/apps/web"
	cat >"$ROOT/apps/web/.env.local" <<WEBENV
NEXT_PUBLIC_API_URL=${HTTPS_BASE}
API_UPSTREAM_URL=http://127.0.0.1:4000
WEBENV
fi

echo ""
echo "nginx TLS active: https://${FLEET_DOMAIN}"
echo "  ssl_certificate     $CERT"
echo "  ssl_certificate_key $KEY"
echo ""
	echo "Restart Fleet: sudo systemctl restart fleet-api fleet-web nginx"
	echo ""
	echo "Web UI: https://${FLEET_DOMAIN}/   (not https://${FLEET_DOMAIN}:3000)"
echo ""
echo "Agents (self-signed only — skip FLEET_CA_FILE if you use a public CA cert):"
echo "  export FLEET_CENTRAL_URL=https://${FLEET_DOMAIN}"
echo "  export FLEET_CA_FILE=${CA_EXPORT}   # copy to agent if browser/agent warns"
echo "  curl -fsSL 'https://${FLEET_DOMAIN}/api/public/agent-install.sh' | FLEET_ENROLL_TOKEN='…' bash"
