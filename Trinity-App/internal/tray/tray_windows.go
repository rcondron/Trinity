//go:build windows

package tray

// Windows system tray implementation.
// Uses Shell_NotifyIcon from the Win32 API (same pattern as Ollama).
// This is a stub — the full implementation would use golang.org/x/sys/windows
// to call Shell_NotifyIconW, CreatePopupMenu, TrackPopupMenu, etc.
//
// For the initial release, the app opens the browser instead of a webview.
// The tray icon will be added in a subsequent release when the CGo webview
// integration is in place.

func init() {
	// Register window class and create notification icon on Windows.
	// Full Win32 implementation follows the pattern from:
	// https://github.com/ollama/ollama/tree/main/app/wintray
}
