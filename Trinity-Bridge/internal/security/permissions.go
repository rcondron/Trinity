package security

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Permission is an allow-list entry.
type Permission struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`    // fs, exec, net, device
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Host      string `json:"host,omitempty"`
	Command   string `json:"command,omitempty"`
	Mode      string `json:"mode"`    // ro, rw, exec
	Enabled   bool   `json:"enabled"`
	BuiltIn   bool   `json:"builtin"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// Permissions manages the allow-list.
type Permissions struct {
	mu   sync.RWMutex
	list []Permission
	path string
}

// NewPermissions loads or creates the permission store.
func NewPermissions(configDir string) *Permissions {
	p := &Permissions{path: filepath.Join(configDir, "permissions.json")}
	p.load()
	if len(p.list) == 0 {
		cwd, _ := os.Getwd()
		p.list = []Permission{{
			ID: "default-workspace", Kind: "fs", Name: "Workspace folder",
			Path: filepath.Join(cwd, "workspace"), Mode: "rw", Enabled: true, BuiltIn: true,
		}}
		p.save()
	}
	return p
}

func (p *Permissions) load() {
	data, err := os.ReadFile(p.path)
	if err != nil {
		return
	}
	json.Unmarshal(data, &p.list)
}

func (p *Permissions) save() {
	data, _ := json.MarshalIndent(p.list, "", "  ")
	os.WriteFile(p.path, data, 0600)
}

func genID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return "perm_" + hex.EncodeToString(b)
}

// List returns all permissions.
func (p *Permissions) List() []Permission {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]Permission, len(p.list))
	copy(result, p.list)
	return result
}

// Add creates a new permission.
func (p *Permissions) Add(perm Permission) Permission {
	p.mu.Lock()
	defer p.mu.Unlock()
	if perm.ID == "" {
		perm.ID = genID()
	}
	p.list = append(p.list, perm)
	p.save()
	return perm
}

// Remove deletes a permission by ID (non-builtin only).
func (p *Permissions) Remove(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, v := range p.list {
		if v.ID == id && !v.BuiltIn {
			p.list = append(p.list[:i], p.list[i+1:]...)
			p.save()
			return
		}
	}
}

// Toggle enables/disables a permission.
func (p *Permissions) Toggle(id string, enabled bool) *Permission {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range p.list {
		if p.list[i].ID == id {
			p.list[i].Enabled = enabled
			p.save()
			result := p.list[i]
			return &result
		}
	}
	return nil
}

// Check validates an access request against the allow-list.
func (p *Permissions) Check(permID, op, target string) (bool, string) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, perm := range p.list {
		if perm.ID == permID {
			if !perm.Enabled {
				return false, "permission disabled"
			}
			if perm.Kind == "fs" && target != "" {
				abs, _ := filepath.Abs(target)
				rel, err := filepath.Rel(perm.Path, abs)
				if err != nil || strings.HasPrefix(rel, "..") {
					return false, "path outside allowed root"
				}
				if (op == "write" || op == "delete") && perm.Mode != "rw" {
					return false, "read-only permission"
				}
			}
			return true, ""
		}
	}
	return false, "unknown permission"
}
