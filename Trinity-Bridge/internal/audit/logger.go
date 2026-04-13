package audit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const maxRingSize = 500

// Entry is a single audit log entry.
type Entry struct {
	Timestamp string                 `json:"ts"`
	Kind      string                 `json:"kind"`
	Meta      map[string]interface{} `json:"meta,omitempty"`
}

// Logger provides an append-only audit log with an in-memory ring buffer.
type Logger struct {
	mu       sync.Mutex
	ring     []Entry
	file     *os.File
	filePath string
}

// NewLogger creates a logger that writes to configDir/audit.log.
func NewLogger(configDir string) *Logger {
	p := filepath.Join(configDir, "audit.log")
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	return &Logger{filePath: p, file: f, ring: make([]Entry, 0, maxRingSize)}
}

// Log records an event.
func (l *Logger) Log(kind string, meta map[string]interface{}) {
	e := Entry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Kind:      kind,
		Meta:      meta,
	}

	l.mu.Lock()
	l.ring = append(l.ring, e)
	if len(l.ring) > maxRingSize {
		l.ring = l.ring[len(l.ring)-maxRingSize:]
	}
	l.mu.Unlock()

	if l.file != nil {
		b, _ := json.Marshal(e)
		l.file.Write(b)
		l.file.WriteString("\n")
	}

	fmt.Printf("[%s] %-16s %v\n", e.Timestamp[11:19], kind, meta)
}

// Recent returns the last n entries.
func (l *Logger) Recent(n int) []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	if n > len(l.ring) {
		n = len(l.ring)
	}
	result := make([]Entry, n)
	copy(result, l.ring[len(l.ring)-n:])
	return result
}
