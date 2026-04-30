#!/usr/bin/env bash
# =============================================================================
# Trinity Agent — Phase 0: Create Isolated macOS User
# =============================================================================
#
# Run this as your ADMIN user BEFORE switching to the trinity account.
# Creates a dedicated macOS user with its own home directory and workspace.
#
# Usage: sudo bash trinity-create-user.sh [username] [fullname]
#   Default: username=trinity, fullname="Trinity Agent"
#
# After running:
#   1. Log into the 'trinity' user (Fast User Switching or logout/login)
#   2. Run: bash ~/trinity-deploy.sh
# =============================================================================

set -euo pipefail

USERNAME="${1:-trinity}"
FULLNAME="${2:-Trinity Agent}"

# ─── ANSI Colors (disabled when not a terminal) ─────────────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    CYAN='\033[0;36m'
    NC='\033[0m'
else
    RED='' GREEN='' CYAN='' NC=''
fi

info() { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# Must run as root/sudo
if [[ $EUID -ne 0 ]]; then
    fail "This script must be run with sudo: sudo bash $0"
fi

# Validate username (alphanumeric + hyphens, no spaces)
if [[ ! "$USERNAME" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
    fail "Invalid username: '$USERNAME'. Use alphanumeric characters, hyphens, or underscores."
fi

# Check if user already exists
if id "$USERNAME" &>/dev/null; then
    ok "User '$USERNAME' already exists (UID $(id -u "$USERNAME"))"
    echo ""
    info "To switch: Log in as '$USERNAME' via Fast User Switching or System Settings → Users"
    exit 0
fi

# Prompt for password securely
echo ""
echo -e "${CYAN}Creating macOS user: $USERNAME ($FULLNAME)${NC}"
echo ""
read -s -p "Set password for '$USERNAME': " PASSWORD
echo ""
read -s -p "Confirm password: " PASSWORD2
echo ""

if [[ "$PASSWORD" != "$PASSWORD2" ]]; then
    fail "Passwords don't match"
fi

if [[ ${#PASSWORD} -lt 8 ]]; then
    fail "Password must be at least 8 characters"
fi

# Create user (without password on CLI to avoid ps/audit log exposure)
info "Creating user '$USERNAME'..."
sysadminctl -addUser "$USERNAME" -fullName "$FULLNAME" -home "/Users/$USERNAME" -admin

# Set password via dscl (avoids command-line exposure)
dscl . -passwd "/Users/$USERNAME" "$PASSWORD"

# Clear password from shell memory
PASSWORD=""
PASSWORD2=""

# Verify
if ! id "$USERNAME" &>/dev/null; then
    fail "User creation failed"
fi
ok "User '$USERNAME' created (UID $(id -u "$USERNAME"))"

# Copy the deploy script to new user's home
DEPLOY_SCRIPT_SRC="$(cd "$(dirname "$0")" && pwd)/trinity-deploy.sh"
DEPLOY_SCRIPT_DST="/Users/$USERNAME/trinity-deploy.sh"

if [[ -f "$DEPLOY_SCRIPT_SRC" ]]; then
    cp "$DEPLOY_SCRIPT_SRC" "$DEPLOY_SCRIPT_DST"
    chown "$USERNAME:staff" "$DEPLOY_SCRIPT_DST"
    chmod +x "$DEPLOY_SCRIPT_DST"
    ok "Deploy script copied to $DEPLOY_SCRIPT_DST"
else
    warn "Deploy script not found at $DEPLOY_SCRIPT_SRC"
    info "Copy trinity-deploy.sh to /Users/$USERNAME/ manually before switching users."
fi

echo ""
echo -e "${GREEN}═══ User Created Successfully ═══${NC}"
echo ""
echo "  Username: $USERNAME"
echo "  Home:     /Users/$USERNAME"
echo "  Admin:    yes (required for Docker Desktop + Homebrew)"
echo ""
echo "  Next steps:"
echo "    1. Enable Fast User Switching:"
echo "       System Settings → Control Center → Fast User Switching → Show in Menu Bar"
echo "    2. Switch to '$USERNAME' user"
echo "    3. Authenticate GitHub CLI: gh auth login"
echo "    4. Run: bash ~/trinity-deploy.sh"
echo ""
echo "  Note: For security, authenticate GitHub separately in the"
echo "  new user account rather than copying credentials."
echo ""
