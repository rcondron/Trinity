#!/usr/bin/env bash
# Trinity Linux Installer
#
# Usage:
#   curl -fsSL https://trinity.morpheus.ai/install.sh | bash
#   # or
#   ./install-linux.sh
#
# What it does:
#   1. Downloads trinity-bridge binary to /usr/local/bin/
#   2. Copies Trinity-WebUI to /usr/local/share/trinity/
#   3. Creates a 'trinity' system user
#   4. Installs a systemd service
#   5. Starts the bridge

set -euo pipefail

INSTALL_DIR="/usr/local/bin"
SHARE_DIR="/usr/local/share/trinity"
SERVICE_USER="trinity"
SERVICE_FILE="/etc/systemd/system/trinity-bridge.service"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "  ╭─────────────────────────────────────────────────╮"
echo "  │          Trinity Linux Installer                │"
echo "  ╰─────────────────────────────────────────────────╯"
echo ""

# Check for root/sudo.
if [ "$(id -u)" -ne 0 ]; then
  echo "This installer requires root. Re-running with sudo…"
  exec sudo "$0" "$@"
fi

# Check Docker.
if ! command -v docker &>/dev/null; then
  echo "⚠  Docker not found. Install it first:"
  echo "   curl -fsSL https://get.docker.com | sh"
  echo ""
fi

# Build or use pre-built binary.
if [ -f "$PROJECT_ROOT/Trinity-Bridge/dist/linux/trinity-bridge" ]; then
  BRIDGE_BIN="$PROJECT_ROOT/Trinity-Bridge/dist/linux/trinity-bridge"
elif command -v go &>/dev/null; then
  echo "Building trinity-bridge…"
  cd "$PROJECT_ROOT/Trinity-Bridge"
  go build -o /tmp/trinity-bridge ./cmd/bridge
  BRIDGE_BIN="/tmp/trinity-bridge"
else
  echo "Error: No pre-built binary and Go is not installed."
  echo "Install Go 1.22+ or provide a pre-built binary."
  exit 1
fi

# Create user.
if ! id "$SERVICE_USER" &>/dev/null; then
  echo "Creating user: $SERVICE_USER"
  useradd -r -s /bin/false -m -d /var/lib/trinity "$SERVICE_USER"
  usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
fi

# Install binary.
echo "Installing trinity-bridge to $INSTALL_DIR/"
install -m 755 "$BRIDGE_BIN" "$INSTALL_DIR/trinity-bridge"

# Install WebUI.
echo "Installing Trinity-WebUI to $SHARE_DIR/"
mkdir -p "$SHARE_DIR"
cp -r "$PROJECT_ROOT/Trinity-WebUI" "$SHARE_DIR/Trinity-WebUI"
chown -R "$SERVICE_USER:$SERVICE_USER" "$SHARE_DIR"

# Create systemd service.
echo "Creating systemd service…"
cat > "$SERVICE_FILE" << 'UNIT'
[Unit]
Description=Trinity Bridge — host-side gatekeeper for the Trinity agent
Documentation=https://github.com/rcondron/Trinity-Test
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=trinity
Group=trinity
ExecStart=/usr/local/bin/trinity-bridge
WorkingDirectory=/var/lib/trinity
Restart=always
RestartSec=3
Environment=HOME=/var/lib/trinity

# Security hardening.
ProtectSystem=full
ProtectHome=read-only
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
UNIT

# Enable and start.
systemctl daemon-reload
systemctl enable trinity-bridge
systemctl start trinity-bridge

echo ""
echo "✅ Trinity installed!"
echo ""
echo "  Bridge:   systemctl status trinity-bridge"
echo "  Logs:     journalctl -u trinity-bridge -f"
echo "  WebUI:    open http://127.0.0.1:4711"
echo "  Config:   /var/lib/trinity/.trinity-bridge/"
echo ""
echo "  Next: open the WebUI and run through the Setup wizard."
echo ""
