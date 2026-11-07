#!/usr/bin/env bash
# Installs llama-manager as a systemd service, for running inference on this
# machine. kitsu itself runs in docker (see README).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_USER="$(whoami)"

echo "Installing llama-manager.service with:"
echo "  User:             $CURRENT_USER"
echo "  WorkingDirectory: $PROJECT_DIR/llama-manager"
echo "  ExecStart:        $PROJECT_DIR/llama-manager/run.sh"
echo "  MANAGER_CONFIG:   $PROJECT_DIR/config.yaml"
echo ""

echo "  [sudo] tee /etc/systemd/system/llama-manager.service"
sed \
    -e "s|YOUR_USER_HERE|$CURRENT_USER|g" \
    -e "s|%h/kitsu|$PROJECT_DIR|g" \
    "$PROJECT_DIR/llama-manager.service" \
    | sudo tee /etc/systemd/system/llama-manager.service > /dev/null

echo "  [sudo] systemctl daemon-reload"
sudo systemctl daemon-reload

echo ""
echo "Done. Run: sudo systemctl enable --now llama-manager"
