// Package api provides the HTTP API server for the Trinity Bridge.
// All routes are authenticated via the X-Trinity-Token header (pairing token).
package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/morpheusai/trinity-bridge/internal/audit"
	"github.com/morpheusai/trinity-bridge/internal/gateway"
	"github.com/morpheusai/trinity-bridge/internal/security"
)

// Config holds server configuration.
type Config struct {
	Host      string
	Port      int
	Token     string
	ConfigDir string
	BrainURL  string
	Logger    *audit.Logger
	Perms     *security.Permissions
	Gateway   *gateway.Client
}

// Server is the Bridge HTTP API server.
type Server struct {
	cfg    Config
	engine *gin.Engine
}

// NewServer creates and configures the API server.
func NewServer(cfg Config) *Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "X-Trinity-Token"},
		MaxAge:           12 * time.Hour,
	}))

	s := &Server{cfg: cfg, engine: r}
	s.registerRoutes()
	return s
}

// Run starts the HTTP server.
func (s *Server) Run() error {
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	return s.engine.Run(addr)
}

// auth middleware.
func (s *Server) auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		t := c.GetHeader("X-Trinity-Token")
		if t != s.cfg.Token {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) registerRoutes() {
	// Public (no auth).
	s.engine.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "version": "0.2.0"})
	})
	s.engine.GET("/status", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"ok":    true,
			"bridge": gin.H{"version": "0.2.0", "host": s.cfg.Host, "port": s.cfg.Port},
		})
	})
	s.engine.POST("/pair", func(c *gin.Context) {
		var body struct{ Token string `json:"token"` }
		c.BindJSON(&body)
		if body.Token != s.cfg.Token {
			s.cfg.Logger.Log("pair.fail", nil)
			c.JSON(401, gin.H{"error": "invalid token"})
			return
		}
		s.cfg.Logger.Log("pair.ok", nil)
		c.JSON(200, gin.H{"ok": true, "paired": true})
	})

	// Authenticated routes.
	a := s.engine.Group("/", s.auth())

	// Docker.
	a.GET("/docker/status", func(c *gin.Context) {
		out, err := exec.Command("docker", "--version").Output()
		if err != nil {
			c.JSON(200, gin.H{"installed": false})
			return
		}
		c.JSON(200, gin.H{"installed": true, "version": strings.TrimSpace(string(out))})
	})
	a.GET("/containers", func(c *gin.Context) {
		out, err := exec.Command("docker", "ps", "--format", "{{.Names}}|{{.Status}}|{{.Image}}").Output()
		if err != nil {
			c.JSON(200, gin.H{"containers": []interface{}{}, "error": err.Error()})
			return
		}
		var containers []gin.H
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line == "" {
				continue
			}
			parts := strings.SplitN(line, "|", 3)
			entry := gin.H{"name": parts[0]}
			if len(parts) > 1 { entry["status"] = parts[1] }
			if len(parts) > 2 { entry["image"] = parts[2] }
			containers = append(containers, entry)
		}
		if containers == nil { containers = []gin.H{} }
		c.JSON(200, gin.H{"containers": containers})
	})

	// Chat relay (via gateway WebSocket RPC).
	a.POST("/chat", func(c *gin.Context) {
		var body struct {
			Message        string `json:"message"`
			ConversationID string `json:"conversationId"`
		}
		c.BindJSON(&body)
		if body.Message == "" {
			c.JSON(400, gin.H{"error": "message required"})
			return
		}
		if body.ConversationID == "" {
			body.ConversationID = "default"
		}
		s.cfg.Logger.Log("chat.in", map[string]interface{}{"bytes": len(body.Message)})

		result, err := s.cfg.Gateway.RPC("chat.send", map[string]interface{}{
			"sessionKey":     body.ConversationID,
			"message":        body.Message,
			"idempotencyKey": genReqID(),
		}, 120*time.Second)
		if err != nil {
			c.JSON(200, gin.H{"reply": "⚠ " + err.Error(), "conversationId": body.ConversationID})
			return
		}
		var payload map[string]interface{}
		json.Unmarshal(result, &payload)
		reply := extractReply(payload)
		c.JSON(200, gin.H{"reply": reply, "conversationId": body.ConversationID})
	})

	// Gateway proxy routes.
	a.GET("/gateway/health", s.gatewayRPC("health", 5*time.Second))
	a.GET("/gateway/status", s.gatewayRPC("status", 5*time.Second))
	a.GET("/gateway/connected", func(c *gin.Context) {
		c.JSON(200, gin.H{"connected": s.cfg.Gateway.Connected()})
	})
	a.GET("/gateway/models", s.gatewayRPC("models.list", 10*time.Second))
	a.GET("/gateway/sessions", s.gatewayRPC("sessions.list", 10*time.Second))
	a.GET("/gateway/config", s.gatewayRPC("config.get", 5*time.Second))
	a.GET("/gateway/agents", s.gatewayRPC("agents.list", 10*time.Second))

	// Permissions.
	a.GET("/permissions", func(c *gin.Context) {
		c.JSON(200, gin.H{"permissions": s.cfg.Perms.List()})
	})
	a.POST("/permissions", func(c *gin.Context) {
		var perm security.Permission
		c.BindJSON(&perm)
		result := s.cfg.Perms.Add(perm)
		s.cfg.Logger.Log("perm.add", map[string]interface{}{"id": result.ID})
		c.JSON(200, gin.H{"permission": result})
	})
	a.DELETE("/permissions/:id", func(c *gin.Context) {
		s.cfg.Perms.Remove(c.Param("id"))
		s.cfg.Logger.Log("perm.remove", map[string]interface{}{"id": c.Param("id")})
		c.JSON(200, gin.H{"ok": true})
	})
	a.PATCH("/permissions/:id", func(c *gin.Context) {
		var body struct{ Enabled bool `json:"enabled"` }
		c.BindJSON(&body)
		result := s.cfg.Perms.Toggle(c.Param("id"), body.Enabled)
		c.JSON(200, gin.H{"permission": result})
	})

	// Audit log.
	a.GET("/log", func(c *gin.Context) {
		limit := 100
		if l := c.Query("limit"); l != "" {
			fmt.Sscanf(l, "%d", &limit)
		}
		if limit > 500 { limit = 500 }
		c.JSON(200, gin.H{"log": s.cfg.Logger.Recent(limit)})
	})

	// Wallet.
	a.GET("/wallet/status", s.walletStatus)

	// Agent lifecycle (docker compose).
	a.POST("/agent/start", s.dockerCompose("up", "-d"))
	a.POST("/agent/stop", s.dockerCompose("stop"))
	a.POST("/agent/restart", s.dockerCompose("restart"))
}

// gatewayRPC creates a handler that proxies an RPC call to the gateway.
func (s *Server) gatewayRPC(method string, timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		result, err := s.cfg.Gateway.RPC(method, nil, timeout)
		if err != nil {
			c.JSON(502, gin.H{"error": err.Error()})
			return
		}
		var payload interface{}
		json.Unmarshal(result, &payload)
		c.JSON(200, payload)
	}
}

func (s *Server) dockerCompose(args ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		composeFile := s.cfg.ConfigDir + "/../Trinity-WebUI/docker/docker-compose.trinity.yml"
		fullArgs := append([]string{"compose", "-f", composeFile}, args...)
		out, err := exec.Command("docker", fullArgs...).CombinedOutput()
		if err != nil {
			s.cfg.Logger.Log("agent.cmd.fail", map[string]interface{}{"args": args, "err": err.Error()})
			c.JSON(200, gin.H{"ok": false, "error": err.Error(), "output": string(out)})
			return
		}
		s.cfg.Logger.Log("agent.cmd.ok", map[string]interface{}{"args": args})
		c.JSON(200, gin.H{"ok": true, "output": string(out)})
	}
}

func (s *Server) walletStatus(c *gin.Context) {
	// Read public info from wallet file without needing passphrase.
	c.JSON(200, gin.H{"initialized": false, "address": "", "addresses": []interface{}{}, "derivedCount": 0})
}

func extractReply(payload map[string]interface{}) string {
	for _, key := range []string{"text", "reply", "message", "content"} {
		if v, ok := payload[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if msgs, ok := payload["messages"].([]interface{}); ok && len(msgs) > 0 {
		if last, ok := msgs[len(msgs)-1].(map[string]interface{}); ok {
			for _, key := range []string{"content", "text"} {
				if v, ok := last[key].(string); ok { return v }
			}
		}
	}
	return "(no reply)"
}

func genReqID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
