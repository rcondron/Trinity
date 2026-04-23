#!/usr/bin/env bash
# =============================================================================
# Trinity Agent — Deployment Script for macOS (Apple Silicon / 128 GB Laptop)
# =============================================================================
#
# This script deploys the Trinity Decentralized AI Agent on a SEPARATE macOS
# user account for full workspace isolation.
#
# Architecture:
#   - Trinity Agent (Node.js/TS) — AI gateway in Docker
#   - Trinity Brain (Python/FastAPI) — memory/vectors/graph in Docker
#   - Trinity Bridge (Go binary) — host-side security gatekeeper
#   - Trinity App (Go tray app) — desktop launcher
#   - Supporting infra: Milvus, Neo4j, etcd, MinIO, Ollama (all Docker)
#
# Configuration:
#   - Inference: Morpheus P2P (MOR token staking)
#   - Channel: Signal
#   - Fork: profbernardoj/Trinity-Test (independent)
#
# Usage:
#   1. Create a dedicated macOS user (see trinity-create-user.sh)
#   2. Log into that user account
#   3. Run: bash trinity-deploy.sh
#
# Requirements:
#   - macOS 14+ (Sonoma) on Apple Silicon
#   - 16 GB RAM minimum (32 GB+ recommended, 128 GB ideal)
#   - 40 GB free disk
#   - Internet access
#
# Author: Bernardo (OpenClaw agent)
# Date: 2026-04-22
# =============================================================================

set -euo pipefail

# ─── ANSI Colors (disabled when not a terminal) ─────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' BOLD='' NC=''
fi

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
step()  { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# ─── Configuration ───────────────────────────────────────────────────────────
TRINITY_HOME="${TRINITY_HOME:-$HOME/Trinity}"
TRINITY_REPO="profbernardoj/Trinity-Test"
TRINITY_BRANCH="main"
TRINITY_DATA_DIR="$HOME/.trinity"
SIGNAL_NUMBER="${SIGNAL_NUMBER:-}"  # Set before running or prompted

# Morpheus config
MORPHEUS_RPC_URL="${MORPHEUS_RPC_URL:-https://mainnet.base.org}"
MORPHEUS_TESTNET="${MORPHEUS_TESTNET:-false}"

# Create directories early
mkdir -p "$TRINITY_DATA_DIR"

# ─── Pre-flight Checks ──────────────────────────────────────────────────────
step "Phase 1: Pre-flight Checks"

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
    fail "This script is designed for macOS. Detected: $(uname)"
fi
ok "macOS detected"

# Apple Silicon check
if [[ "$(uname -m)" != "arm64" ]]; then
    warn "Expected Apple Silicon (arm64), got $(uname -m). Continuing..."
else
    ok "Apple Silicon (arm64)"
fi

# RAM check (minimum 16 GB, recommend 32 GB+)
RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [[ $RAM_GB -lt 16 ]]; then
    fail "Insufficient RAM: ${RAM_GB} GB. Trinity requires at least 16 GB."
elif [[ $RAM_GB -lt 32 ]]; then
    warn "RAM: ${RAM_GB} GB (32 GB+ recommended for full stack with local LLMs)"
else
    ok "RAM: ${RAM_GB} GB"
fi

# Disk check (need 40 GB free)
FREE_GB=$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')
if [[ -z "$FREE_GB" ]]; then
    # Fallback: df -h parsing
    FREE_GB=$(df -h "$HOME" | awk 'NR==2 {gsub(/[^0-9]/,"",$4); print $4}')
    warn "Disk free estimate: ~${FREE_GB} GB (parsed from df -h)"
elif [[ $FREE_GB -lt 40 ]]; then
    fail "Insufficient disk: ${FREE_GB} GB free. Need at least 40 GB."
else
    ok "Disk: ${FREE_GB} GB free"
fi

# macOS version check (need 14+)
MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
if [[ $MACOS_MAJOR -lt 14 ]]; then
    warn "macOS $MACOS_VERSION detected. Recommended: 14.0+ (Sonoma)"
else
    ok "macOS $MACOS_VERSION"
fi

# Xcode CLI tools (required for git, compilers, etc.)
if ! xcode-select -p &>/dev/null; then
    info "Installing Xcode Command Line Tools..."
    xcode-select --install 2>/dev/null || true
    echo ""
    warn "Xcode CLI tools installation triggered."
    warn "If a dialog appeared, complete the installation and re-run this script."
    echo ""
    # Wait a bit to see if it completes quickly
    for i in $(seq 1 30); do
        if xcode-select -p &>/dev/null; then
            break
        fi
        sleep 2
    done
    if ! xcode-select -p &>/dev/null; then
        fail "Xcode CLI tools not installed. Install them and re-run."
    fi
fi
ok "Xcode CLI tools: $(xcode-select -p)"

# ─── Install Dependencies ───────────────────────────────────────────────────
step "Phase 2: Dependencies"

# Homebrew
if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Source Homebrew into current shell
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
else
    ok "Homebrew: $(brew --version | head -1)"
fi

# Ensure Homebrew is in PATH for this session
if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
fi

# Git (should be available from Xcode CLI tools, but ensure)
if ! command -v git &>/dev/null; then
    info "Installing git..."
    brew install git
fi
ok "Git: $(git --version)"

# GitHub CLI
if ! command -v gh &>/dev/null; then
    info "Installing GitHub CLI..."
    brew install gh
fi
ok "GitHub CLI: $(gh --version | head -1)"

# Check gh auth
if ! gh auth status &>/dev/null 2>&1; then
    warn "GitHub CLI not authenticated. Running: gh auth login"
    gh auth login
fi
ok "GitHub CLI authenticated"

# Node.js 22+ (for agent builds)
NODE_VERSION=0
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
fi
if [[ $NODE_VERSION -lt 22 ]]; then
    info "Installing Node.js 22..."
    brew install node@22
    brew link --overwrite node@22 2>/dev/null || true
fi
ok "Node.js: $(node -v)"

# pnpm
if ! command -v pnpm &>/dev/null; then
    info "Installing pnpm..."
    if command -v corepack &>/dev/null; then
        corepack enable 2>/dev/null || true
        corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm
    else
        npm install -g pnpm
    fi
fi
ok "pnpm: $(pnpm --version)"

# Go 1.22+ (for bridge + app builds)
GO_MINOR=0
if command -v go &>/dev/null; then
    GO_MINOR=$(go version | sed -E 's/.*go[0-9]+\.([0-9]+).*/\1/')
fi
if [[ $GO_MINOR -lt 22 ]]; then
    info "Installing Go..."
    brew install go
fi
ok "Go: $(go version)"

# Docker
if ! command -v docker &>/dev/null; then
    info "Docker not found. Installing Docker Desktop..."
    brew install --cask docker
    echo ""
    info "Docker Desktop installed. Launching..."
    open -a Docker
    info "Waiting for Docker daemon (up to 120s)..."
    info "You may need to approve System Extension prompts in System Settings."
    for i in $(seq 1 120); do
        if docker info &>/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! docker info &>/dev/null 2>&1; then
        echo ""
        warn "Docker daemon hasn't started yet."
        warn "Please complete Docker Desktop setup (approve extensions, etc.) and re-run this script."
        exit 1
    fi
fi

# Check Docker daemon is running
if ! docker info &>/dev/null 2>&1; then
    warn "Docker daemon not running. Starting Docker Desktop..."
    open -a Docker
    info "Waiting for Docker daemon (up to 90s)..."
    for i in $(seq 1 90); do
        if docker info &>/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! docker info &>/dev/null 2>&1; then
        fail "Docker daemon did not start. Open Docker Desktop manually and re-run."
    fi
fi
ok "Docker: $(docker --version)"
ok "Docker Compose: $(docker compose version)"

# signal-cli (for Signal channel)
if ! command -v signal-cli &>/dev/null; then
    info "Installing signal-cli..."
    brew install signal-cli
fi
ok "signal-cli: $(signal-cli --version 2>/dev/null || echo 'installed')"

# ─── Clone Repository ───────────────────────────────────────────────────────
step "Phase 3: Clone Repository"

if [[ -d "$TRINITY_HOME/.git" ]]; then
    info "Repository already cloned at $TRINITY_HOME"
    cd "$TRINITY_HOME"
    git fetch origin "$TRINITY_BRANCH"
    git checkout "$TRINITY_BRANCH"
    git pull origin "$TRINITY_BRANCH"
    ok "Repository updated"
else
    info "Cloning $TRINITY_REPO → $TRINITY_HOME"
    gh repo clone "$TRINITY_REPO" "$TRINITY_HOME" -- -b "$TRINITY_BRANCH"
    ok "Repository cloned"
fi

cd "$TRINITY_HOME"

# Validate expected directory structure
for dir in Trinity-Agent Trinity-Brain Trinity-Bridge Trinity-App Trinity-WebUI; do
    if [[ ! -d "$TRINITY_HOME/$dir" ]]; then
        fail "Expected directory '$dir' not found in cloned repo. Is the fork structure correct?"
    fi
done
ok "Repository structure validated"

# ─── Build Go Binaries ──────────────────────────────────────────────────────
step "Phase 4: Build Bridge & Desktop App"

mkdir -p "$TRINITY_HOME/bin"

# Build Trinity Bridge (Go)
info "Building Trinity Bridge..."
cd "$TRINITY_HOME/Trinity-Bridge"
go mod download || warn "go mod download had issues (may work anyway)"
if ! go build -ldflags "-s -w" -o "$TRINITY_HOME/bin/trinity-bridge" ./cmd/bridge; then
    fail "Trinity Bridge build failed. Check Go dependencies and error output above."
fi
ok "Bridge built: $TRINITY_HOME/bin/trinity-bridge"

# Build Trinity App (Go)
info "Building Trinity Desktop App..."
cd "$TRINITY_HOME/Trinity-App"
go mod download || warn "go mod download had issues (may work anyway)"
if ! go build -ldflags "-s -w" -o "$TRINITY_HOME/bin/Trinity" ./cmd/app; then
    fail "Trinity App build failed. Check Go dependencies and error output above."
fi
ok "Desktop App built: $TRINITY_HOME/bin/Trinity"

# ─── Build Docker Stack ─────────────────────────────────────────────────────
step "Phase 5: Build & Start Docker Stack"

cd "$TRINITY_HOME/Trinity-Agent"

# Create .env if not exists
if [[ ! -f .env ]]; then
    info "Creating .env from template..."

    # Generate a random gateway token
    GATEWAY_TOKEN=$(openssl rand -hex 32)

    cat > .env << DOTENV
# Trinity Agent Environment
NODE_ENV=production

# Morpheus Compute (MOR staking mode)
MORPHEUS_ENABLED=true
MORPHEUS_TESTNET=${MORPHEUS_TESTNET}
MORPHEUS_RPC_URL=${MORPHEUS_RPC_URL}

# Brain integration
TRINITY_BRAIN_API=http://brain-api:8100
TRINITY_BRAIN_ENABLED=true

# Gateway security
MORPHEUS_GATEWAY_TOKEN=${GATEWAY_TOKEN}

# Signal channel (configure after linking signal-cli)
# SIGNAL_PHONE_NUMBER=+1XXXXXXXXXX
DOTENV

    # Secure permissions on .env (contains gateway token)
    chmod 600 .env
    ok ".env created with auto-generated gateway token (mode 600)"
    info "View token with: grep MORPHEUS_GATEWAY_TOKEN .env"
else
    ok ".env already exists (not overwriting)"
fi

# Build Docker images (use cache on re-runs, pull latest base images)
info "Building Docker images (first run may take several minutes)..."
if ! docker compose build --pull 2>&1 | tail -20; then
    fail "Docker build failed. Check error output above."
fi

info "Starting Docker stack..."
if ! docker compose up -d 2>&1; then
    fail "Docker compose up failed. Check error output above."
fi

# Wait for services — check for healthy containers
info "Waiting for services to become healthy (up to 180s)..."
HEALTHY=false
for i in $(seq 1 90); do
    # Check if at least brain-api container shows (healthy)
    if docker compose ps 2>/dev/null | grep -q "(healthy)"; then
        HEALTHY=true
        break
    fi
    sleep 2
done

if [[ "$HEALTHY" == "true" ]]; then
    ok "Docker stack is healthy"
else
    warn "Some services may still be starting (Ollama model pulls can take a while)."
    warn "Check with: cd $TRINITY_HOME/Trinity-Agent && docker compose ps"
fi

# Show container status
echo ""
docker compose ps
echo ""

# ─── Signal Setup ────────────────────────────────────────────────────────────
step "Phase 6: Signal Configuration"

if [[ -z "$SIGNAL_NUMBER" ]]; then
    echo ""
    echo -e "${CYAN}Signal channel setup${NC}"
    echo "To connect Trinity to Signal, you need to link signal-cli as a"
    echo "secondary device to your Signal account."
    echo ""
    echo "Option A: Link as secondary device (recommended)"
    echo "  signal-cli link -n 'Trinity Agent'"
    echo "  (Scan the QR code with Signal on your phone)"
    echo ""
    echo "Option B: Register a new number"
    echo "  signal-cli -u +1XXXXXXXXXX register --captcha CAPTCHA_TOKEN"
    echo ""
    echo "After linking, update .env with your Signal number:"
    echo "  SIGNAL_PHONE_NUMBER=+1XXXXXXXXXX"
    echo ""
    warn "Skipping Signal auto-setup — complete manually after install."
else
    info "Signal number configured: $SIGNAL_NUMBER"
    # Update .env — use | as sed delimiter to avoid conflicts with phone number chars
    sed -i '' "s|# SIGNAL_PHONE_NUMBER=.*|SIGNAL_PHONE_NUMBER=${SIGNAL_NUMBER}|" \
        "$TRINITY_HOME/Trinity-Agent/.env"
    ok "Signal number set in .env"
fi

# ─── Morpheus Wallet Setup ──────────────────────────────────────────────────
step "Phase 7: Morpheus Wallet & MOR Staking"

echo ""
echo -e "${CYAN}Morpheus Compute Setup${NC}"
echo ""
echo "Trinity uses MOR token staking for decentralized inference."
echo "The wallet is created during the WebUI onboarding wizard."
echo ""
echo "What you'll need:"
echo "  1. MOR tokens on Base chain (for staking)"
echo "  2. A small amount of ETH on Base (for gas fees)"
echo "  3. A wallet passphrase (encrypts the HD wallet at rest)"
echo ""
echo "The onboarding wizard will guide you through wallet creation"
echo "and MOR staking. See 'Next Steps' below."
echo ""

# ─── Create macOS App Bundle ────────────────────────────────────────────────
step "Phase 8: macOS App Bundle"

info "Creating Trinity.app bundle..."

APP_BUNDLE="$TRINITY_HOME/dist/Trinity.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Copy binaries
cp "$TRINITY_HOME/bin/Trinity" "$APP_BUNDLE/Contents/MacOS/Trinity"
cp "$TRINITY_HOME/bin/trinity-bridge" "$APP_BUNDLE/Contents/Resources/trinity-bridge"

# Copy WebUI
cp -r "$TRINITY_HOME/Trinity-WebUI" "$APP_BUNDLE/Contents/Resources/Trinity-WebUI"

# Info.plist (no variable expansion — static content)
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Trinity</string>
  <key>CFBundleDisplayName</key>
  <string>Trinity</string>
  <key>CFBundleIdentifier</key>
  <string>org.morpheus.trinity</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>Trinity</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# Validate plist
if command -v plutil &>/dev/null; then
    plutil -lint "$APP_BUNDLE/Contents/Info.plist" >/dev/null || warn "Info.plist validation failed"
fi

ok "App bundle: $APP_BUNDLE"

# Create LaunchAgent wrapper script (avoids variable expansion in plist)
cat > "$TRINITY_HOME/bin/trinity-launch" << 'LAUNCH'
#!/usr/bin/env bash
# Wrapper for LaunchAgent — starts Trinity App
exec "$(dirname "$0")/../dist/Trinity.app/Contents/MacOS/Trinity"
LAUNCH
chmod +x "$TRINITY_HOME/bin/trinity-launch"

# LaunchAgent plist (uses wrapper script, no variable expansion)
LAUNCH_AGENT="$HOME/Library/LaunchAgents/org.morpheus.trinity.plist"
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$TRINITY_DATA_DIR"

# Write plist with proper escaping via python to avoid XML issues
python3 -c "
import plistlib, os, sys
home = os.path.expanduser('~')
trinity_home = os.environ.get('TRINITY_HOME', os.path.join(home, 'Trinity'))
data_dir = os.path.join(home, '.trinity')
plist = {
    'Label': 'org.morpheus.trinity',
    'ProgramArguments': [os.path.join(trinity_home, 'bin', 'trinity-launch')],
    'RunAtLoad': True,
    'KeepAlive': False,
    'LimitLoadToSessionType': 'Aqua',
    'StandardOutPath': os.path.join(data_dir, 'trinity-app.log'),
    'StandardErrorPath': os.path.join(data_dir, 'trinity-app.err'),
}
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(plist, f)
" "$LAUNCH_AGENT"

# Validate the generated plist
if command -v plutil &>/dev/null; then
    plutil -lint "$LAUNCH_AGENT" >/dev/null || warn "LaunchAgent plist validation failed"
fi

ok "LaunchAgent: $LAUNCH_AGENT"

# Optionally copy to /Applications
echo ""
read -p "Copy Trinity.app to /Applications? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf /Applications/Trinity.app
    cp -r "$APP_BUNDLE" /Applications/Trinity.app
    ok "Trinity.app installed to /Applications"
fi

# ─── Create Convenience Scripts ──────────────────────────────────────────────
step "Phase 9: Convenience Scripts"

# Start script
cat > "$TRINITY_HOME/bin/trinity-start" << 'START'
#!/usr/bin/env bash
# Start the full Trinity stack
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Trinity Docker stack..."
cd "$SCRIPT_DIR/Trinity-Agent"
docker compose up -d

echo "Starting Trinity Bridge..."
"$SCRIPT_DIR/bin/trinity-bridge" \
    --gateway ws://127.0.0.1:18789 \
    --brain http://127.0.0.1:8100 \
    --daemon

echo ""
echo "Trinity is running."
echo "  Gateway: http://127.0.0.1:18789"
echo "  Brain:   http://127.0.0.1:8100"
echo "  Bridge:  http://127.0.0.1:4711"
echo ""
echo "Open the WebUI:"
echo "  open '$SCRIPT_DIR/Trinity-WebUI/pages/dashboard.html'"
START
chmod +x "$TRINITY_HOME/bin/trinity-start"

# Stop script
cat > "$TRINITY_HOME/bin/trinity-stop" << 'STOP'
#!/usr/bin/env bash
# Stop the full Trinity stack
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping Trinity Bridge..."
# Use specific match to avoid killing unrelated processes
BRIDGE_PID=$(pgrep -f "$SCRIPT_DIR/bin/trinity-bridge" 2>/dev/null || true)
if [[ -n "$BRIDGE_PID" ]]; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    echo "  Bridge stopped (PID $BRIDGE_PID)"
else
    echo "  Bridge not running"
fi

echo "Stopping Trinity Docker stack..."
cd "$SCRIPT_DIR/Trinity-Agent"
docker compose down

echo "Trinity stopped."
STOP
chmod +x "$TRINITY_HOME/bin/trinity-stop"

# Status script
cat > "$TRINITY_HOME/bin/trinity-status" << 'STATUS'
#!/usr/bin/env bash
# Show Trinity stack status
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══ Trinity Status ═══"
echo ""

echo "Docker containers:"
cd "$SCRIPT_DIR/Trinity-Agent"
docker compose ps 2>/dev/null || echo "  (not running)"
echo ""

echo "Bridge:"
BRIDGE_PID=$(pgrep -f "$SCRIPT_DIR/bin/trinity-bridge" 2>/dev/null || true)
if [[ -n "$BRIDGE_PID" ]]; then
    echo "  Running (PID $BRIDGE_PID)"
else
    echo "  Not running"
fi
echo ""

echo "Ports:"
for port in 18789 8100 4711 19530 7474 11434; do
    if lsof -i ":$port" &>/dev/null 2>&1; then
        SERVICE=""
        case $port in
            18789) SERVICE="gateway" ;;
            8100)  SERVICE="brain" ;;
            4711)  SERVICE="bridge" ;;
            19530) SERVICE="milvus" ;;
            7474)  SERVICE="neo4j" ;;
            11434) SERVICE="ollama" ;;
        esac
        echo "  :$port ($SERVICE) — active"
    else
        echo "  :$port — free"
    fi
done
STATUS
chmod +x "$TRINITY_HOME/bin/trinity-status"

ok "Created: trinity-start, trinity-stop, trinity-status"

# Add bin to PATH hint
if ! echo "$PATH" | grep -q "$TRINITY_HOME/bin"; then
    echo ""
    info "Add Trinity to your PATH by adding this to ~/.zshrc:"
    echo "  export PATH=\"$TRINITY_HOME/bin:\$PATH\""
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
step "Deployment Complete!"

echo -e "${GREEN}Trinity Agent has been deployed successfully.${NC}"
echo ""
echo -e "${BOLD}Locations:${NC}"
echo "  Repository:    $TRINITY_HOME"
echo "  Data:          $TRINITY_DATA_DIR"
echo "  App Bundle:    $APP_BUNDLE"
echo "  Bridge:        $TRINITY_HOME/bin/trinity-bridge"
echo "  LaunchAgent:   $LAUNCH_AGENT"
echo ""
echo -e "${BOLD}Commands:${NC}"
echo "  trinity-start    Start the full stack"
echo "  trinity-stop     Stop everything"
echo "  trinity-status   Check service status"
echo ""
echo -e "${BOLD}Services (after start):${NC}"
echo "  Gateway:  http://127.0.0.1:18789"
echo "  Brain:    http://127.0.0.1:8100"
echo "  Bridge:   http://127.0.0.1:4711"
echo "  Milvus:   http://127.0.0.1:19530"
echo "  Neo4j:    http://127.0.0.1:7474"
echo "  Ollama:   http://127.0.0.1:11434"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "  1. Open the onboarding wizard:"
echo "     open $TRINITY_HOME/StartHere.html"
echo ""
echo "  2. Complete Signal setup:"
echo "     signal-cli link -n 'Trinity Agent'"
echo "     Then update $TRINITY_HOME/Trinity-Agent/.env with your number"
echo ""
echo "  3. Configure Morpheus wallet & MOR staking:"
echo "     Complete in WebUI Settings → Model Access Mode → MOR Token"
echo ""
echo "  4. Change default Neo4j password:"
echo "     Open http://127.0.0.1:7474 and change password on first login"
echo ""
echo "  5. Start Trinity:"
echo "     $TRINITY_HOME/bin/trinity-start"
echo "     (or launch Trinity.app from Applications)"
echo ""
echo -e "${YELLOW}Security Notes:${NC}"
echo "  - The Bridge runs on the host and gates ALL container access"
echo "  - Change the default Neo4j password immediately"
echo "  - Gateway token is in .env — keep it safe, do not share"
echo "  - All containers run as non-root with CAP_DROP: ALL"
echo ""
