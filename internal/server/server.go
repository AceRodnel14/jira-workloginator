// Package server holds the app's HTTP handlers.
package server

import (
	"context"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"gitlab.com/acerodnel/jira-workloginator/internal/jira"
	"gitlab.com/acerodnel/jira-workloginator/internal/store"
)

// Server is the HTTP handler.
type Server struct {
	cfg     Config
	store   store.Store
	auth    *auth // nil: no login
	jira    *http.Client
	limiter *limiter // login attempts per TCP peer
	handler http.Handler
}

// Option customises a Server (tests).
type Option func(*Server)

// WithJiraClient replaces the HTTP client used for Jira calls.
func WithJiraClient(c *http.Client) Option { return func(s *Server) { s.jira = c } }

// New returns the app's handler; static is the web UI (nil for API only).
func New(cfg Config, static fs.FS, st store.Store, opts ...Option) (*Server, error) {
	a, err := newAuth(cfg)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, store: st, auth: a, jira: jira.NewHTTPClient(), limiter: newLimiter(maxFails, failWindow)}
	for _, o := range opts {
		o(s)
	}
	s.handler = securityHeaders(sameOrigin(cfg.BaseURL, limitBody(s.requireLogin(s.routes(static)))))
	return s, nil
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

// Sweep expires old limiter entries hourly until ctx ends.
func (s *Server) Sweep(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.limiter.sweep()
		}
	}
}

// publicAPI are the /api/ routes reachable without a session. Logout is open so a
// stale cookie can always be cleared.
var publicAPI = map[string]bool{"/api/info": true, "/api/session": true, "/api/login": true, "/api/logout": true}

// requireLogin answers 401 for /api/ requests without a valid cookie when LOGIN_PASS is set.
func (s *Server) requireLogin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.auth != nil && strings.HasPrefix(r.URL.Path, "/api/") && !publicAPI[r.URL.Path] && !s.auth.valid(r) {
			writeError(w, http.StatusUnauthorized, "Login required.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) routes(static fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
	mux.HandleFunc("GET /readyz", s.handleReady)
	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"base_url": s.cfg.BaseURL})
	})
	mux.HandleFunc("GET /api/session", s.handleSession)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handlePutSettings)
	mux.HandleFunc("POST /api/worklogs", s.handleWorklogs)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "Not found.") })
	if static != nil {
		mux.Handle("/", spa(static))
	}
	return mux
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
		return
	}
	_, _ = w.Write([]byte("ok"))
}

// spa serves the built UI; unknown paths get index.html so client-side routes work.
func spa(static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "."
		}
		if _, err := fs.Stat(static, name); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		files.ServeHTTP(w, r)
	})
}
