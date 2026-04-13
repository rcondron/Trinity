// Package gateway maintains a persistent WebSocket connection to the Trinity
// gateway container and provides RPC methods for interacting with it.
package gateway

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Client maintains a persistent WebSocket to the Trinity gateway.
type Client struct {
	url            string
	conn           *websocket.Conn
	mu             sync.Mutex
	connected      bool
	pending        map[string]chan rpcResult
	pendingMu      sync.Mutex
	reconnectDelay time.Duration
	done           chan struct{}
}

type rpcResult struct {
	OK      bool
	Payload json.RawMessage
	Error   string
}

type rpcRequest struct {
	Type   string      `json:"type"`
	ID     string      `json:"id"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

type rpcResponse struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// NewClient creates a gateway client.
func NewClient(url string) *Client {
	return &Client{
		url:            url,
		pending:        make(map[string]chan rpcResult),
		reconnectDelay: time.Second,
		done:           make(chan struct{}),
	}
}

// Connected returns whether the WebSocket is up.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// ConnectLoop connects and reconnects forever until Close() is called.
func (c *Client) ConnectLoop() {
	for {
		select {
		case <-c.done:
			return
		default:
		}

		conn, _, err := websocket.DefaultDialer.Dial(c.url, nil)
		if err != nil {
			time.Sleep(c.reconnectDelay)
			if c.reconnectDelay < 30*time.Second {
				c.reconnectDelay = c.reconnectDelay * 3 / 2
			}
			continue
		}

		c.mu.Lock()
		c.conn = conn
		c.connected = true
		c.reconnectDelay = time.Second
		c.mu.Unlock()

		log.Printf("[Gateway] Connected to %s", c.url)
		c.readLoop(conn)

		c.mu.Lock()
		c.connected = false
		c.conn = nil
		c.mu.Unlock()

		// Reject all pending RPCs.
		c.pendingMu.Lock()
		for id, ch := range c.pending {
			ch <- rpcResult{Error: "connection lost"}
			delete(c.pending, id)
		}
		c.pendingMu.Unlock()

		log.Printf("[Gateway] Disconnected. Reconnecting in %v…", c.reconnectDelay)
	}
}

func (c *Client) readLoop(conn *websocket.Conn) {
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var resp rpcResponse
		if json.Unmarshal(msg, &resp) != nil {
			continue
		}
		if resp.Type == "res" && resp.ID != "" {
			c.pendingMu.Lock()
			ch, ok := c.pending[resp.ID]
			if ok {
				delete(c.pending, resp.ID)
			}
			c.pendingMu.Unlock()
			if ok {
				errMsg := ""
				if resp.Error != nil {
					errMsg = resp.Error.Message
				}
				ch <- rpcResult{OK: resp.OK, Payload: resp.Payload, Error: errMsg}
			}
		}
	}
}

// RPC sends a request and waits for the response.
func (c *Client) RPC(method string, params interface{}, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	if conn == nil {
		return nil, fmt.Errorf("gateway not connected at %s", c.url)
	}

	id := genReqID()
	ch := make(chan rpcResult, 1)

	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	req := rpcRequest{Type: "req", ID: id, Method: method, Params: params}
	data, _ := json.Marshal(req)

	c.mu.Lock()
	err := conn.WriteMessage(websocket.TextMessage, data)
	c.mu.Unlock()
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("write failed: %w", err)
	}

	select {
	case res := <-ch:
		if !res.OK && res.Error != "" {
			return nil, fmt.Errorf("RPC %s: %s", method, res.Error)
		}
		return res.Payload, nil
	case <-time.After(timeout):
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("RPC %s timed out after %v", method, timeout)
	}
}

// Close shuts down the client.
func (c *Client) Close() {
	close(c.done)
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.mu.Unlock()
}

func genReqID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
