package security

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadOrCreateToken reads or generates the pairing token (TRN-xxxx-xxxx-xxxx).
func LoadOrCreateToken(configDir string) string {
	p := filepath.Join(configDir, "pairing-token")
	if data, err := os.ReadFile(p); err == nil {
		return strings.TrimSpace(string(data))
	}
	raw := make([]byte, 9)
	rand.Read(raw)
	h := strings.ToUpper(hex.EncodeToString(raw))
	token := fmt.Sprintf("TRN-%s-%s-%s", h[:4], h[4:8], h[8:12])
	os.WriteFile(p, []byte(token+"\n"), 0600)
	return token
}
