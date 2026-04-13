# Trinity App — Desktop Application & Installers

The Trinity App is the user-facing desktop application. It runs a system tray
icon, spawns the Trinity Bridge as a child process, and opens the WebUI in your
browser (or a native webview). Platform-specific installers provide a
one-click setup experience.

## Project Structure

```
Trinity-App/
├── cmd/app/main.go             Entry point (tray + bridge launcher)
├── internal/tray/              Platform-native tray icon
│   ├── tray.go                 Cross-platform interface
│   ├── tray_windows.go         Win32 Shell_NotifyIcon
│   ├── tray_darwin.go          Cocoa NSStatusItem
│   └── tray_linux.go           No-op (systemd handles lifecycle)
├── installer/
│   └── trinity.iss             Inno Setup script → TrinitySetup.exe
├── scripts/
│   ├── build-windows.ps1       Windows build + installer
│   ├── create-dmg.sh           macOS build + DMG
│   └── install-linux.sh        Linux install + systemd
├── assets/
│   ├── icon.ico                Windows icon (add before building)
│   └── icon.icns               macOS icon (add before building)
├── go.mod                      Go module
└── README.md                   This file
```

## Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| Go | 1.22+ | All platforms |
| Docker | Any | Running Trinity containers |
| Inno Setup 6 | Latest | Windows installer only |
| Xcode CLI tools | Latest | macOS DMG only |
| create-dmg | Optional | Pretty macOS DMG (falls back to hdiutil) |

### Install prerequisites

**Go** (all platforms):
```bash
# macOS
brew install go

# Linux
sudo apt install golang-go    # Debian/Ubuntu
sudo dnf install golang        # Fedora

# Windows — download from https://go.dev/dl/
winget install GoLang.Go
```

**Inno Setup** (Windows only):
```
# Download from https://jrsoftware.org/isdl.php
# Or via winget:
winget install JRSoftware.InnoSetup
```

**create-dmg** (macOS, optional):
```bash
brew install create-dmg
```

---

## Building — Windows

### Step 1: Build the Go binaries

Open PowerShell in the project root:

```powershell
# Build the bridge binary
cd Trinity-Bridge
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -o "dist\trinity-bridge.exe" .\cmd\bridge\
cd ..

# Build the desktop app (GUI mode — no console window)
cd Trinity-App
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -ldflags "-H windowsgui" -o "dist\windows\trinity app.exe" .\cmd\app\
cd ..
```

### Step 2: Add the icon

Place your `icon.ico` file in `Trinity-App/assets/icon.ico`. A 256×256 multi-resolution
ICO file works best.

### Step 3: Build the installer

Make sure Inno Setup's `iscc.exe` is in your PATH (typically
`C:\Program Files (x86)\Inno Setup 6\`):

```powershell
cd Trinity-App

# Copy the bridge binary to the dist folder
copy ..\Trinity-Bridge\dist\trinity-bridge.exe dist\windows\

# Run Inno Setup compiler
iscc.exe installer\trinity.iss /O"dist\windows" /F"TrinitySetup"
```

The installer will be at `Trinity-App/dist/windows/TrinitySetup.exe`.

### Automated build (all-in-one)

```powershell
cd Trinity-App
.\scripts\build-windows.ps1
```

This builds both binaries, bundles the WebUI, and runs Inno Setup automatically.

### What TrinitySetup.exe does

1. Installs to `%LOCALAPPDATA%\Programs\Trinity` (per-user, no admin)
2. Copies `trinity app.exe`, `trinity-bridge.exe`, and `Trinity-WebUI/`
3. Adds the install directory to the user's PATH
4. Registers the `trinity://` URL scheme
5. Creates a desktop shortcut
6. Launches the app after install

---

## Building — macOS

### Step 1: Build universal binaries

```bash
cd Trinity-Bridge

# Build bridge for both architectures
GOOS=darwin GOARCH=arm64 go build -o dist/trinity-bridge-arm64 ./cmd/bridge
GOOS=darwin GOARCH=amd64 go build -o dist/trinity-bridge-amd64 ./cmd/bridge
lipo -create dist/trinity-bridge-arm64 dist/trinity-bridge-amd64 -output dist/trinity-bridge
rm dist/trinity-bridge-arm64 dist/trinity-bridge-amd64

cd ../Trinity-App

# Build app for both architectures
GOOS=darwin GOARCH=arm64 go build -o dist/Trinity-arm64 ./cmd/app
GOOS=darwin GOARCH=amd64 go build -o dist/Trinity-amd64 ./cmd/app
lipo -create dist/Trinity-arm64 dist/Trinity-amd64 -output dist/Trinity
rm dist/Trinity-arm64 dist/Trinity-amd64
```

### Step 2: Add the icon

Place your `icon.icns` file in `Trinity-App/assets/icon.icns`. Create it from
a 1024×1024 PNG:

```bash
# Create .icns from a PNG
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o assets/icon.icns
rm -rf icon.iconset
```

### Step 3: Create the DMG

```bash
cd Trinity-App
chmod +x scripts/create-dmg.sh
./scripts/create-dmg.sh
```

The DMG will be at `Trinity-App/dist/macos/Trinity.dmg`.

### Automated build (all-in-one)

```bash
cd Trinity-App && ./scripts/create-dmg.sh
```

### What Trinity.dmg contains

- `Trinity.app` — drag to Applications
  - `Contents/MacOS/Trinity` — universal binary (arm64 + amd64)
  - `Contents/Resources/trinity-bridge` — the Go bridge binary
  - `Contents/Resources/Trinity-WebUI/` — the web interface
  - `Contents/Library/LaunchAgents/org.morpheus.trinity.plist` — auto-start

### Code signing (optional, for distribution)

```bash
codesign --force --deep --sign "Developer ID Application: Your Name" \
  dist/macos/Trinity.app

# Notarize for Gatekeeper
xcrun notarytool submit dist/macos/Trinity.dmg \
  --apple-id "you@example.com" \
  --team-id "XXXXXXXXXX" \
  --password "@keychain:AC_PASSWORD" \
  --wait

xcrun stapler staple dist/macos/Trinity.dmg
```

---

## Building — Linux

### Option A: Install script (recommended)

```bash
cd Trinity-App/scripts
sudo ./install-linux.sh
```

This will:
1. Build `trinity-bridge` from source (or use a pre-built binary)
2. Install to `/usr/local/bin/trinity-bridge`
3. Copy `Trinity-WebUI` to `/usr/local/share/trinity/`
4. Create a `trinity` system user
5. Install and start a systemd service

### Option B: Manual build

```bash
# Build the bridge
cd Trinity-Bridge
go build -o trinity-bridge ./cmd/bridge

# Run it
./trinity-bridge

# Or install as a systemd service manually:
sudo cp trinity-bridge /usr/local/bin/
sudo cat > /etc/systemd/system/trinity-bridge.service << 'EOF'
[Unit]
Description=Trinity Bridge
After=network-online.target docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/trinity-bridge
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now trinity-bridge
```

### Verify the installation

```bash
# Check the service
systemctl status trinity-bridge

# Check the API
curl http://127.0.0.1:4711/health

# View logs
journalctl -u trinity-bridge -f

# Open the WebUI
xdg-open http://127.0.0.1:4711
```

---

## Development

### Run locally without building an installer

```bash
# Terminal 1: Start the bridge
cd Trinity-Bridge
go run ./cmd/bridge

# Terminal 2: Start the app (opens browser)
cd Trinity-App
go run ./cmd/app

# Or just open the WebUI directly:
open Trinity-WebUI/Setup.html
```

### Cross-compile

```bash
# Windows from Linux/macOS
GOOS=windows GOARCH=amd64 go build -o trinity-bridge.exe ./cmd/bridge

# Linux from macOS/Windows
GOOS=linux GOARCH=amd64 go build -o trinity-bridge ./cmd/bridge

# macOS from Linux/Windows (won't have CGo tray, browser-only mode)
GOOS=darwin GOARCH=arm64 go build -o trinity-bridge ./cmd/bridge
```

---

## How it works (architecture)

```
TrinitySetup.exe / Trinity.dmg
installs:
    ├── trinity app        ← desktop tray app (Go binary)
    │   ├── spawns trinity-bridge as child process
    │   ├── opens Trinity-WebUI in browser/webview
    │   ├── system tray icon with status
    │   └── auto-update checker
    │
    ├── trinity-bridge     ← security gatekeeper (Go binary)
    │   ├── HTTP API on 127.0.0.1:4711
    │   ├── persistent WebSocket to gateway container
    │   ├── permission engine + audit log
    │   └── wallet + Morpheus session management
    │
    └── Trinity-WebUI/     ← browser interface (static files)
        ├── Setup.html     onboarding wizard
        ├── pages/         dashboard, chat, settings, skills
        └── css/js/        cyberpunk theme + controllers
```

The user runs `TrinitySetup.exe` (or drags `Trinity.app` to Applications).
The app starts as a tray icon, spawns the bridge in the background, and
opens the WebUI. Docker containers are pulled and started from the Setup
wizard. Everything auto-starts on boot.
