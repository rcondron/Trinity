// Trinity Bridge — host-side security gatekeeper.
//
// Single Go binary that replaces the Node.js bridge-server.js.
// Runs on the host (not in Docker), exposes an HTTP API on 127.0.0.1:4711,
// maintains a persistent WebSocket to the Trinity gateway container,
// and enforces permission-based access control for all host resources.
//
// Usage:
//
//	trinity-bridge                    # foreground
//	trinity-bridge --daemon           # background
//	trinity-bridge --port 4711        # custom port
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/morpheusai/trinity-bridge/internal/api"
	"github.com/morpheusai/trinity-bridge/internal/audit"
	"github.com/morpheusai/trinity-bridge/internal/gateway"
	"github.com/morpheusai/trinity-bridge/internal/security"
)

var (
	version = "0.2.0"
	commit  = "dev"
)

func main() {
	host := flag.String("host", "127.0.0.1", "Bind address (loopback-only by default)")
	port := flag.Int("port", 4711, "HTTP API port")
	gatewayURL := flag.String("gateway", "ws://127.0.0.1:18789", "Trinity gateway WebSocket URL")
	brainURL := flag.String("brain", "http://127.0.0.1:8100", "Trinity brain API URL")
	daemon := flag.Bool("daemon", false, "Run in daemon mode")
	showVersion := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *showVersion {
		fmt.Printf("trinity-bridge %s (%s)\n", version, commit)
		os.Exit(0)
	}

	// Config directory: ~/.trinity-bridge/
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".trinity-bridge")
	os.MkdirAll(configDir, 0700)

	// Initialize subsystems.
	logger := audit.NewLogger(configDir)
	perms := security.NewPermissions(configDir)
	gw := gateway.NewClient(*gatewayURL)
	token := security.LoadOrCreateToken(configDir)

	// Print banner.
	fmt.Println()
	fmt.Println("  ╭─────────────────────────────────────────────────────────╮")
	fmt.Println("  │                 TRINITY BRIDGE · v" + version + "                │")
	fmt.Println("  │     host-side gatekeeper for the Trinity container      │")
	fmt.Println("  ╰─────────────────────────────────────────────────────────╯")
	fmt.Println()
	fmt.Printf("  Listening    : http://%s:%d\n", *host, *port)
	fmt.Printf("  Gateway      : %s\n", *gatewayURL)
	fmt.Printf("  Brain        : %s\n", *brainURL)
	fmt.Printf("  Config dir   : %s\n", configDir)
	fmt.Printf("  Pairing token: %s\n", token)
	fmt.Println()

	if *daemon {
		log.Println("Running in daemon mode. Kill with: kill", os.Getpid())
	}

	logger.Log("bridge.start", map[string]interface{}{"port": *port, "version": version})

	// Start the gateway WebSocket connection.
	go gw.ConnectLoop()

	// Start the HTTP API server.
	srv := api.NewServer(api.Config{
		Host:      *host,
		Port:      *port,
		Token:     token,
		ConfigDir: configDir,
		BrainURL:  *brainURL,
		Logger:    logger,
		Perms:     perms,
		Gateway:   gw,
	})

	// Graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.Run(); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	logger.Log("bridge.stop", map[string]interface{}{"signal": "shutdown"})
	gw.Close()
	fmt.Println("\n  Bridge stopped.")
}
