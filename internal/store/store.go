// Package store persists the saved settings: a JSON file or PostgreSQL.
package store

import (
	"context"
	"errors"

	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
)

// ErrUnavailable means the backing store cannot be reached right now.
var ErrUnavailable = errors.New("store unavailable")

// Store keeps one Settings document.
type Store interface {
	// Load returns the saved settings; ok is false (and the defaults are returned) when none exist.
	Load(ctx context.Context) (s settings.Settings, ok bool, err error)
	Save(ctx context.Context, s settings.Settings) error
	// Ping reports whether the store is ready (backs /readyz).
	Ping(ctx context.Context) error
}
