#!/usr/bin/env bash
# Fleet TLS — standard nginx reverse proxy (replaces legacy Caddy internal CA).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-fleet-tls-nginx.sh" "$@"
