#!/usr/bin/env python3
"""
Mint enrollment secret + POST /api/agent/v1/enroll from Windows against localhost API,
then write ~/.fleet-agent.token via \\\\wsl$\\\\ (avoid Bash CRLF quirks on /mnt/d/).

Reads SEED_ADMIN_* from repo .env (quoted values OK).

Usage:
  python scripts/enroll-agent-win-to-wsl.py [WSL-distro-name]

Default distro: Ubuntu-22.04
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]


def strip_q(s: str) -> str:
    t = s.strip()
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        return t[1:-1]
    return t


def load_dot_env(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        ls = line.strip()
        if not ls or ls.startswith("#"):
            continue
        i = ls.find("=")
        if i == -1:
            continue
        k, v = ls[:i].strip(), strip_q(ls[i + 1 :])
        out[k] = v
    return out


def req_json(method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    h = dict(headers)
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            txt = resp.read().decode()
            ct = resp.headers.get("Content-Type", "")
            if "json" in ct and txt.strip():
                return resp.status, json.loads(txt)
            return resp.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except json.JSONDecodeError:
            return e.code, txt


def wsl_text(dist: str, *args: str, timeout: int = 25) -> str | None:
    try:
        r = subprocess.run(
            ["wsl.exe", "-d", dist, "--", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if r.returncode != 0:
            return None
        s = (r.stdout or "").strip()
        return s or None
    except OSError | subprocess.TimeoutExpired:
        return None


def main() -> int:
    dist = sys.argv[1].strip() if len(sys.argv) > 1 else "Ubuntu-22.04"

    dot = ROOT / ".env"
    if not dot.is_file():
        print(".env missing at", dot, file=sys.stderr)
        return 1
    cfg = load_dot_env(dot)
    email = cfg.get("SEED_ADMIN_EMAIL", "").strip() or "admin@localhost"
    pwd = cfg.get("SEED_ADMIN_PASSWORD", "").strip()
    if not pwd:
        print("SEED_ADMIN_PASSWORD not set in .env", file=sys.stderr)
        return 1

    base = os.environ.get("FLEET_CENTRAL_URL", "http://127.0.0.1:4000").rstrip("/")

    linux_user = (
        os.environ.get("WSL_AGENT_USER") or os.environ.get("USER") or wsl_text(dist, "bash", "-lc", "whoami") or "jackson"
    ).strip()

    hn = wsl_text(dist, "hostname", "-s") or wsl_text(dist, "hostname") or "unknown-wsl"

    token_unc = pathlib.Path(f"//wsl$/{dist}/home/{linux_user}/.fleet-agent.token")

    status, payload = req_json("POST", f"{base}/api/auth/login", {"email": email, "password": pwd}, {})
    if status != 200:
        print("Login failed:", status, payload, file=sys.stderr)
        return 1

    jwt = payload["token"]  # type: ignore[index]

    status2, payload2 = req_json(
        "POST",
        f"{base}/api/enrollment-tokens",
        {"ttlMinutes": 720},
        {"Authorization": f"Bearer {jwt}"},
    )
    if status2 != 200:
        status2b, payload2b = req_json(
            "POST",
            f"{base}/api/enrollment-tokens/",
            {"ttlMinutes": 720},
            {"Authorization": f"Bearer {jwt}"},
        )
        status2, payload2 = status2b, payload2b
    if status2 != 200:
        print("Mint failed:", status2, payload2, file=sys.stderr)
        return 1

    pairing = payload2["token"]  # type: ignore[index]

    enroll_body = {
        "token": pairing,
        "hostname": hn,
        "osType": "linux",
        "osDetail": "wsl-agent",
        "version": "0.2.0-rust-win-enroll",
    }
    h3_status, h3_body = req_json("POST", f"{base}/api/agent/v1/enroll", enroll_body, {})
    if h3_status != 200:
        print("Enroll failed:", h3_status, h3_body, file=sys.stderr)
        return 1
    api_tok = h3_body["apiToken"]  # type: ignore[index]

    try:
        token_unc.parent.mkdir(parents=True, exist_ok=True)
        token_unc.write_text(api_tok, encoding="utf8")
    except OSError:
        r = subprocess.run(
            ["wsl.exe", "-d", dist, "--", "bash", "-lc", "umask 077; cat > \"$HOME/.fleet-agent.token\""],
            input=api_tok.encode("utf8"),
            check=False,
        )
        if r.returncode != 0:
            print("Writing token failed (UNC + WSL fallback).", file=sys.stderr)
            return 1

    print(f"Enrollment OK -> {token_unc}  ({len(api_tok)} bytes)")
    print(f"[info] distro={dist} user={linux_user} hostname={hn}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
