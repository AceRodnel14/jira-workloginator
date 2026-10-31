package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
)

const schema = `CREATE TABLE IF NOT EXISTS settings (
	id int PRIMARY KEY CHECK (id = 1),
	data jsonb NOT NULL,
	updated_at timestamptz NOT NULL
)`

// Postgres stores the settings as one jsonb row. The connection is made lazily by
// Connect (with backoff), so the app starts while the database is still down.
type Postgres struct {
	url  string
	pool atomic.Pointer[pgxpool.Pool]
}

// NewPostgres returns a store that is unavailable until Connect succeeds.
func NewPostgres(url string) *Postgres { return &Postgres{url: url} }

// Connect retries with backoff (1s doubling to 30s) until the database answers and
// the table exists, or ctx ends. Run it in a goroutine.
func (p *Postgres) Connect(ctx context.Context) {
	cfg, err := pgxpool.ParseConfig(p.url)
	if p.url == "" || err != nil { // ParseConfig("") would fall back to libpq env defaults
		slog.Error("DATABASE_URL is not usable; /readyz stays 503", "err", "invalid or empty connection string")
		return
	}
	backoff := time.Second
	for {
		if err := p.tryConnect(ctx, cfg); err == nil {
			slog.Info("database connected")
			return
		} else if ctx.Err() != nil {
			return
		} else {
			slog.Warn("database not reachable, will retry", "in", backoff.String(), "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (p *Postgres) tryConnect(ctx context.Context, cfg *pgxpool.Config) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return err
	}
	p.pool.Store(pool)
	return nil
}

// Close releases the pool.
func (p *Postgres) Close() {
	if pool := p.pool.Load(); pool != nil {
		pool.Close()
	}
}

func (p *Postgres) conn() (*pgxpool.Pool, error) {
	pool := p.pool.Load()
	if pool == nil {
		return nil, ErrUnavailable
	}
	return pool, nil
}

// Load implements Store.
func (p *Postgres) Load(ctx context.Context) (settings.Settings, bool, error) {
	pool, err := p.conn()
	if err != nil {
		return settings.Settings{}, false, err
	}
	var data []byte
	err = pool.QueryRow(ctx, `SELECT data FROM settings WHERE id = 1`).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings.Default(), false, nil
	}
	if err != nil {
		return settings.Settings{}, false, fmt.Errorf("load settings: %w", err)
	}
	s := settings.Default()
	if err := json.Unmarshal(data, &s); err != nil {
		return settings.Settings{}, false, fmt.Errorf("parse settings: %w", err)
	}
	return s, true, nil
}

// Save implements Store.
func (p *Postgres) Save(ctx context.Context, s settings.Settings) error {
	pool, err := p.conn()
	if err != nil {
		return err
	}
	data, err := json.Marshal(s)
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO settings (id, data, updated_at) VALUES (1, $1, now())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`, data)
	if err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// Ping implements Store.
func (p *Postgres) Ping(ctx context.Context) error {
	pool, err := p.conn()
	if err != nil {
		return err
	}
	return pool.Ping(ctx)
}
