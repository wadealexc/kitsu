#!/usr/bin/env bash
set -euo pipefail

# Set up environment for use with systemd
# Note that your nvm/llama-server locations might differ.

## load nvm so we can call `exec node ...`
source "$HOME/.nvm/nvm.sh"

# https://pptr.dev/troubleshooting#using-setuid-sandbox
# export CHROME_DEVEL_SANDBOX env variable
#
# This only gets used if you enable browser and set up the browser sandbox
# (see README for details)
export CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox

cd "$(dirname "$0")"
exec node dist/src/index.js