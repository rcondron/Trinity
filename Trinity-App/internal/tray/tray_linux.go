//go:build linux

package tray

// Linux tray implementation.
// On Linux, the app runs as a background service (systemd) and the user
// interacts via the browser-based WebUI. No tray icon needed.

func init() {
	// No-op on Linux. The systemd service handles lifecycle.
}
