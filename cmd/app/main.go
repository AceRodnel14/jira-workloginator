// Command app serves the HTTP API, and the embedded web UI when built from the
// app-web template. Plain HTTP only: a reverse proxy terminates TLS.
package main

import (
	"cmp"
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // time zones without a system tzdata (distroless)

	"gitlab.com/acerodnel/jira-workloginator/internal/server"
	"gitlab.com/acerodnel/jira-workloginator/internal/store"
)

// version is the release; override at build time with
// -ldflags "-X main.version=1.2.3".
var version = "1.0.0"

// static is the embedded web UI; nil for a backend-only app (web.go sets it).
var static fs.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		slog.Error("exit", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := server.LoadConfig(os.Getenv)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st store.Store = store.NewJSON(cfg.JSONPath)
	if cfg.Storage == "postgres" {
		pg := store.NewPostgres(cfg.DatabaseURL)
		defer pg.Close()
		go pg.Connect(ctx) // retries with backoff; /readyz is 503 until it succeeds
		st = pg
	}
	app, err := server.New(cfg, static, st)
	if err != nil {
		return err
	}
	go app.Sweep(ctx)

	// No WriteTimeout: /api/worklogs streams for as long as the Jira fetch takes.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           app,
		ReadHeaderTimeout: 10 * time.Second,
	}
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return err
	}
	slog.Info("listening", "addr", srv.Addr, "version", version, "base_url", cfg.BaseURL, "storage", cfg.Storage, "login", cfg.LoginPass != "")
	return serve(ctx, srv, ln)
}

// serve runs srv until it fails or ctx ends. Request contexts derive from ctx, so a
// shutdown signal cancels in-flight streaming fetches at once. A shutdown that still
// times out force-closes the server and is not an error (the exit code stays 0).
func serve(ctx context.Context, srv *http.Server, ln net.Listener) error {
	srv.BaseContext = func(net.Listener) context.Context { return ctx }
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil {
		slog.Warn("graceful shutdown timed out, closing", "err", err)
		_ = srv.Close()
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// healthcheck backs the image's HEALTHCHECK (distroless has no curl).
func healthcheck() int {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + cmp.Or(os.Getenv("PORT"), "8080") + "/healthz")
	if err != nil {
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
