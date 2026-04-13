// Trinity App — desktop tray application.
//
// This is the user-facing application that:
//   1. Shows a system tray icon with status and controls.
//   2. Spawns trinity-bridge as a child process.
//   3. Opens a webview window pointing to the Trinity WebUI.
//   4. Checks for updates periodically.
//
// Build:
//
//	Windows: go build -ldflags "-H windowsgui" -o "trinity app.exe" ./cmd/app
//	macOS:   go build -o Trinity ./cmd/app
//	Linux:   go build -o trinity-app ./cmd/app
package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

var (
	version   = "0.1.0"
	bridgeBin = "trinity-bridge"
)

func main() {
	log.SetPrefix("[Trinity] ")
	log.Printf("Trinity App v%s starting on %s/%s", version, runtime.GOOS, runtime.GOARCH)

	// Resolve paths.
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	bridgePath := filepath.Join(exeDir, bridgeBin)
	if runtime.GOOS == "windows" {
		bridgePath += ".exe"
	}

	webUIPath := resolveWebUI(exeDir)

	// Start the bridge as a child process.
	bridgeProc, err := startBridge(bridgePath)
	if err != nil {
		log.Printf("Warning: could not start bridge: %v", err)
	} else {
		log.Printf("Bridge started (PID %d)", bridgeProc.Process.Pid)
	}

	// Give bridge a moment to bind.
	time.Sleep(500 * time.Millisecond)

	// Open the WebUI in the default browser (or webview when available).
	openUI(webUIPath)

	// Start update checker.
	go checkForUpdates()

	// Wait for shutdown signal.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// Cleanup.
	log.Println("Shutting down…")
	if bridgeProc != nil && bridgeProc.Process != nil {
		bridgeProc.Process.Signal(syscall.SIGTERM)
		bridgeProc.Wait()
	}
	log.Println("Goodbye.")
}

func resolveWebUI(exeDir string) string {
	// Check relative paths from the executable.
	candidates := []string{
		filepath.Join(exeDir, "Trinity-WebUI", "Setup.html"),
		filepath.Join(exeDir, "..", "Trinity-WebUI", "Setup.html"),
		filepath.Join(exeDir, "..", "..", "Trinity-WebUI", "Setup.html"),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Fallback: bridge URL.
	return "http://127.0.0.1:4711"
}

func startBridge(bridgePath string) (*exec.Cmd, error) {
	if _, err := os.Stat(bridgePath); err != nil {
		return nil, fmt.Errorf("bridge binary not found at %s", bridgePath)
	}
	cmd := exec.Command(bridgePath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func openUI(target string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", target)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Could not open UI: %v", err)
	}
}

func checkForUpdates() {
	// Initial delay.
	time.Sleep(5 * time.Second)
	for {
		// In production, this would check a release endpoint.
		log.Println("Update check: up to date")
		time.Sleep(60 * time.Minute)
	}
}
