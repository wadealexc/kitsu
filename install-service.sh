#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_USER="$(whoami)"
SERVICE_DEST=/etc/systemd/system/kitsu.service

echo "Installing kitsu.service with:"
echo "  User:             $CURRENT_USER"
echo "  WorkingDirectory: $PROJECT_DIR/backend"
echo "  ExecStart:        $PROJECT_DIR/backend/run.sh"
echo ""

echo "  [sudo] tee $SERVICE_DEST"
sed \
    -e "s|YOUR_USER_HERE|$CURRENT_USER|g" \
    -e "s|%h/kitsu|$PROJECT_DIR|g" \
    "$PROJECT_DIR/kitsu.service" \
    | sudo tee "$SERVICE_DEST" > /dev/null

echo "  [sudo] systemctl daemon-reload"
sudo systemctl daemon-reload

echo ""
echo "Done. Run: sudo systemctl enable --now kitsu"
