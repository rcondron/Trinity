#!/usr/bin/env bash
# Download a permissively-licensed default VRM avatar into apps/web/public/avatars/.
# Assets are never vendored in the repo — see CREDITS.md for licenses.
#
# Default: the CC0-1.0 sample VRM from pixiv/three-vrm's examples.
# Pass a URL to use any other model instead:
#   scripts/setup_avatar.sh https://example.com/your.vrm
set -euo pipefail

cd "$(dirname "$0")/.."
DEST_DIR="apps/web/public/avatars"
DEST="$DEST_DIR/default.vrm"
mkdir -p "$DEST_DIR"

# CC0-licensed sample VRM shipped with @pixiv/three-vrm's examples
# (https://github.com/pixiv/three-vrm — models/VRM1_Constraint_Twist_Sample.vrm, CC0-1.0).
URL="${1:-https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm}"

echo "==> Downloading default avatar"
echo "    $URL"
curl -fL --retry 3 -o "$DEST" "$URL"
echo "==> Saved to $DEST"
echo "    The web app now loads it automatically (VITE_DEFAULT_AVATAR=/avatars/default.vrm)."
echo "    Verify the model's license before shipping your own build — see CREDITS.md."
