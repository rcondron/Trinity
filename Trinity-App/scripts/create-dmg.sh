#!/usr/bin/env bash
# Create Trinity.dmg for macOS distribution.
#
# Usage: ./scripts/create-dmg.sh
#
# Prerequisites:
#   - Go 1.22+ (for building the binaries)
#   - create-dmg (brew install create-dmg) or hdiutil as fallback
#
# This script:
#   1. Builds trinity-bridge and trinity app as universal (arm64+amd64) binaries.
#   2. Creates a Trinity.app bundle.
#   3. Packages it into Trinity.dmg.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$SCRIPT_DIR/.."
BUILD_DIR="$APP_DIR/dist/macos"
APP_BUNDLE="$BUILD_DIR/Trinity.app"
DMG_OUTPUT="$BUILD_DIR/Trinity.dmg"

VERSION="${VERSION:-0.1.0}"

echo "=== Building Trinity.dmg v$VERSION ==="

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# --- Build binaries ---

echo "Building trinity-bridge (universal)..."
cd "$PROJECT_ROOT/Trinity-Bridge"
GOOS=darwin GOARCH=arm64 go build -o "$BUILD_DIR/trinity-bridge-arm64" ./cmd/bridge
GOOS=darwin GOARCH=amd64 go build -o "$BUILD_DIR/trinity-bridge-amd64" ./cmd/bridge
lipo -create "$BUILD_DIR/trinity-bridge-arm64" "$BUILD_DIR/trinity-bridge-amd64" \
  -output "$BUILD_DIR/trinity-bridge"
rm "$BUILD_DIR/trinity-bridge-arm64" "$BUILD_DIR/trinity-bridge-amd64"

echo "Building trinity app (universal)..."
cd "$APP_DIR"
GOOS=darwin GOARCH=arm64 go build -o "$BUILD_DIR/Trinity-arm64" ./cmd/app
GOOS=darwin GOARCH=amd64 go build -o "$BUILD_DIR/Trinity-amd64" ./cmd/app
lipo -create "$BUILD_DIR/Trinity-arm64" "$BUILD_DIR/Trinity-amd64" \
  -output "$BUILD_DIR/Trinity"
rm "$BUILD_DIR/Trinity-arm64" "$BUILD_DIR/Trinity-amd64"

# --- Create .app bundle ---

echo "Creating Trinity.app bundle..."
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BUILD_DIR/Trinity" "$APP_BUNDLE/Contents/MacOS/Trinity"
cp "$BUILD_DIR/trinity-bridge" "$APP_BUNDLE/Contents/Resources/trinity-bridge"
cp -r "$PROJECT_ROOT/Trinity-WebUI" "$APP_BUNDLE/Contents/Resources/Trinity-WebUI"

# Copy icon if available.
if [ -f "$APP_DIR/assets/icon.icns" ]; then
  cp "$APP_DIR/assets/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"
fi

# Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Trinity</string>
  <key>CFBundleDisplayName</key>
  <string>Trinity</string>
  <key>CFBundleIdentifier</key>
  <string>org.morpheus.trinity</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleExecutable</key>
  <string>Trinity</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>trinity</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# LaunchAgent plist for auto-start.
mkdir -p "$APP_BUNDLE/Contents/Library/LaunchAgents"
cat > "$APP_BUNDLE/Contents/Library/LaunchAgents/org.morpheus.trinity.plist" << LAUNCHD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.morpheus.trinity</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Trinity.app/Contents/MacOS/Trinity</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
LAUNCHD

# --- Create DMG ---

echo "Creating DMG..."
if command -v create-dmg &>/dev/null; then
  create-dmg \
    --volname "Trinity" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon "Trinity.app" 150 185 \
    --app-drop-link 450 185 \
    "$DMG_OUTPUT" \
    "$APP_BUNDLE"
else
  # Fallback: plain hdiutil
  hdiutil create -volname "Trinity" -srcfolder "$APP_BUNDLE" \
    -ov -format UDZO "$DMG_OUTPUT"
fi

echo ""
echo "=== Done ==="
echo "  DMG: $DMG_OUTPUT"
echo "  App: $APP_BUNDLE"
echo ""
