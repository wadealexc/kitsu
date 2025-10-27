#!/usr/bin/env bash
set -euo pipefail

# Set up environment for use with systemd
# Note that your nvm/llama-server locations might differ.

## load nvm so we can call `exec node ...`
source "$HOME/.nvm/nvm.sh"

## place `llama-server` in PATH
##
## NOTE: If you have an existing `llama-server` installation and you want
##       to use that, uncomment this line and make sure it correctly points
##       to your install.
##       Then ensure `shim-config.json` is set to `llamaServer.useSubmodule = false`
##
# export PATH="$HOME/llama.cpp/build/bin:$PATH"

exec node dist/index.js