// Package tray provides a cross-platform system tray icon.
// Platform-specific implementations are in tray_windows.go, tray_darwin.go, tray_linux.go.
package tray

// Status represents the tray icon state.
type Status int

const (
	StatusStarting Status = iota
	StatusRunning
	StatusError
	StatusUpdateAvailable
)

// Callbacks are invoked when the user interacts with the tray.
type Callbacks struct {
	OnOpen    func()
	OnQuit    func()
	OnUpdate  func()
}

// Icon manages the system tray icon.
type Icon struct {
	status    Status
	callbacks Callbacks
}

// New creates a tray icon.
func New(cb Callbacks) *Icon {
	return &Icon{callbacks: cb}
}

// SetStatus updates the tray icon state.
func (i *Icon) SetStatus(s Status) {
	i.status = s
}
