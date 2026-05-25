#!/usr/bin/env bash
# Free Turbo/Next/API listeners on typical dev ports inside WSL.
set -euo pipefail
PORTS="${*:-3000 4000}"
for port in $PORTS; do
  while IFS= read -r line; do
    [[ "$line" =~ pid=([0-9]+) ]] || continue
    kill -9 "${BASH_REMATCH[1]}" 2>/dev/null || true
  done < <(ss -tlnp 2>/dev/null | grep ":$port " || true)
done
sleep 1
