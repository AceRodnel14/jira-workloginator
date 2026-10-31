package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
)

// JSON stores the settings in one file, written atomically with mode 0600.
type JSON struct {
	mu   sync.Mutex
	path string
}

// NewJSON returns a file store at path.
func NewJSON(path string) *JSON { return &JSON{path: path} }

// Load implements Store.
func (j *JSON) Load(context.Context) (settings.Settings, bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	data, err := os.ReadFile(j.path)
	if errors.Is(err, fs.ErrNotExist) {
		return settings.Default(), false, nil
	}
	if err != nil {
		return settings.Settings{}, false, fmt.Errorf("read settings: %w", err)
	}
	s := settings.Default()
	if err := json.Unmarshal(data, &s); err != nil {
		return settings.Settings{}, false, fmt.Errorf("parse settings: %w", err)
	}
	return s, true, nil
}

// Save implements Store: temp file in the same directory, fsync, rename.
func (j *JSON) Save(_ context.Context, s settings.Settings) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	data, err := json.Marshal(s)
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	dir := filepath.Dir(j.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create settings dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp") // created with mode 0600
	if err != nil {
		return fmt.Errorf("create temp settings: %w", err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write settings: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync settings: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close settings: %w", err)
	}
	if err := os.Rename(tmp.Name(), j.path); err != nil {
		return fmt.Errorf("replace settings: %w", err)
	}
	return nil
}

// Ping implements Store; a file store is always ready.
func (j *JSON) Ping(context.Context) error { return nil }
