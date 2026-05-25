#!/usr/bin/env sh
# Run as root in WSL: toolchain for building fleet-agent (no sudo prompt).
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y build-essential pkg-config curl ca-certificates python3 cron
