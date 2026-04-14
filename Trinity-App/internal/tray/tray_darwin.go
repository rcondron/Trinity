//go:build darwin

package tray

// macOS menu bar implementation.
// Uses NSStatusItem from AppKit via CGo (same pattern as Ollama).
// This is a stub — the full implementation would use Objective-C via CGo
// to create a menu bar item with NSStatusItem.
//
// For the initial release, the app opens the browser instead of a webview.

func init() {
	// Register NSStatusItem on macOS.
	// Full Cocoa implementation follows the pattern from:
	// https://github.com/ollama/ollama/blob/main/app/cmd/app/app_darwin.go
}
